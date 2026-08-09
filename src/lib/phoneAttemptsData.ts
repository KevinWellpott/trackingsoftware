// Datenbeschaffung für das Anruf-Log (`phone_call_attempts`, Migration 0028).
//
// Bewusst eine eigene Datei neben analyseData.ts: Das Log ist die einzige
// EREIGNIS-Quelle des Telefon-Funnels. Alles andere dort zählt Leads (Zustände)
// — wer denselben Lead dreimal anrief, erzeugte eine Zählung. Erst hier lässt
// sich „lohnt es sich, Mailboxen nochmal anzurufen, oder lieber neue Leads
// scrapen?" beantworten, weil jede Anwahl eine eigene Zeile ist.
//
// Zwei Eigenheiten, die den Rest der Datei erklären:
//   1. Das Log startet mit Migration 0028 bei NULL — es gibt keine Ereignisse
//      aus der Zeit davor und bewusst keinen Backfill (siehe Migration §8).
//      Auswertungen über ältere Zeiträume sind deshalb legitim leer.
//   2. Solange die Migration nicht eingespielt ist, existiert die Tabelle gar
//      nicht. Der Loader gibt dann `available: false` zurück, statt die Seite
//      mit einem Fehler abzuräumen.
//
// SERVER-ONLY: importiert `@/lib/supabase/server` (cookies()).

import type { AccessContext } from "@/lib/access";
import type { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { addDaysISO } from "@/lib/dates";
import { berlinDateISO } from "@/lib/apptTime";
import type { PhoneCallKind, PhoneCallOutcome } from "@/lib/types";

type Client = Awaited<ReturnType<typeof createClient>>;

export type AnalyseCallAttempt = {
  id: string;
  created_by_user_id: string | null;
  /** Snapshot der Listen-Zuordnung im Moment des Anrufs — hat Owner-Vorrang. */
  owner_name: string | null;
  called_at: string;
  attempt_no: number;
  kind: PhoneCallKind;
  outcome: PhoneCallOutcome;
  mailbox: boolean | null;
};

export type CallAttemptData = {
  /** Anwahlen im Zeitraum, nach Berlin-Kalendertag zugeschnitten. */
  rows: AnalyseCallAttempt[];
  /**
   * Älteste protokollierte Anwahl überhaupt (ohne Zeitraumfilter). Trägt die
   * Fußnote: ohne diesen Anker sieht ein Zeitraum vor der Einführung des Logs
   * wie ein Ausfall aus, statt wie „gab es damals noch nicht".
   */
  firstCalledAt: string | null;
  /** false = Tabelle (noch) nicht da oder Abfrage fehlgeschlagen. */
  available: boolean;
};

const ATTEMPT_COLUMNS =
  "id, created_by_user_id, owner_name, called_at, attempt_no, kind, outcome, mailbox";

/**
 * Personen-Scope mit Owner-Vorrang — dieselbe Regel wie `list_owned_by_user()`
 * in SQL und `buildOwnScope()` in access.ts: `owner_name` entscheidet, der
 * Ersteller greift nur, solange kein Name gesetzt ist. Ein Admin, der FÜR ein
 * Mitglied telefoniert hat, zählt damit beim Mitglied.
 *
 * Der Name wird gequotet, weil PostgREST `,` und `.` im or-Ausdruck als
 * Trennzeichen liest.
 */
function ownerScopeOr(access: AccessContext): string {
  const name = access.username.replace(/["\\]/g, "");
  return `owner_name.eq."${name}",and(owner_name.is.null,created_by_user_id.eq.${access.user.id})`;
}

/**
 * Anwahlen eines Zeitraums.
 *
 * `called_at` ist `timestamptz`; gefiltert wird in SQL mit einem Tag Puffer auf
 * beiden Seiten und anschließend exakt über den Berlin-Kalendertag (docs §6) —
 * sonst rutschen Abendanrufe in den Nachbartag, während der Rest des
 * Telefon-Tabs bereits nach Berlin bucketet.
 */
export async function loadCallAttempts(
  supabase: Client,
  access: AccessContext,
  canCompare: boolean,
  from: string,
  to: string,
): Promise<CallAttemptData> {
  try {
    const [rows, firstRes] = await Promise.all([
      fetchAllRows((f, t) => {
        let q = supabase
          .from("phone_call_attempts")
          .select(ATTEMPT_COLUMNS)
          .eq("workspace_id", access.workspace_id)
          .gte("called_at", addDaysISO(from, -1))
          .lt("called_at", addDaysISO(to, 2));
        if (!canCompare) q = q.or(ownerScopeOr(access));
        return q.order("id").range(f, t);
      }),
      supabase
        .from("phone_call_attempts")
        .select("called_at")
        .eq("workspace_id", access.workspace_id)
        .order("called_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    if (firstRes.error) throw new Error(firstRes.error.message);

    const inRange = (rows as unknown as AnalyseCallAttempt[]).filter((r) => {
      const day = berlinDateISO(r.called_at);
      return day >= from && day <= to;
    });

    return {
      rows: inRange,
      firstCalledAt: (firstRes.data as { called_at: string } | null)?.called_at ?? null,
      available: true,
    };
  } catch (err) {
    // Häufigster Fall: Migration 0028 ist noch nicht eingespielt, die Tabelle
    // fehlt. Der Telefon-Tab soll deswegen nicht ausfallen.
    console.error("phoneAttemptsData:", err instanceof Error ? err.message : err);
    return { rows: [], firstCalledAt: null, available: false };
  }
}

// ── Auswertung ───────────────────────────────────────────────

/** Reihenfolge = Erzählung: erster Anruf, erneuter Versuch, verabredeter Rückruf. */
export const CALL_KINDS: PhoneCallKind[] = ["erstanruf", "folgeanruf", "rueckruf"];

export const CALL_KIND_LABELS: Record<PhoneCallKind, string> = {
  erstanruf: "Erstanruf",
  folgeanruf: "Folgeanruf",
  rueckruf: "Rückruf",
};

export type CallKindSummary = {
  kind: PhoneCallKind;
  /** Anwahlen — Ereignisse, nicht Leads. */
  calls: number;
  appointments: number;
  mailbox: number;
};

/**
 * Anwahlen je Topf. Terminquote und Mailbox-Anteil werden bewusst NICHT hier
 * gerechnet, sondern in der Sektion über `pct()` — dieselbe Rundung wie überall
 * sonst im Analyse-Bereich.
 */
export function summarizeAttemptsByKind(rows: AnalyseCallAttempt[]): CallKindSummary[] {
  const byKind = new Map<PhoneCallKind, CallKindSummary>(
    CALL_KINDS.map((kind) => [kind, { kind, calls: 0, appointments: 0, mailbox: 0 }]),
  );
  for (const r of rows) {
    const entry = byKind.get(r.kind);
    if (!entry) continue; // unbekannter Wert (neuer Topf, alter Client) — nicht raten
    entry.calls += 1;
    if (r.outcome === "termin") entry.appointments += 1;
    if (r.mailbox === true) entry.mailbox += 1;
  }
  return CALL_KINDS.map((kind) => byKind.get(kind)!);
}
