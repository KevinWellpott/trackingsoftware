"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { berlinDateISO } from "@/lib/apptTime";
import { getPipelineSettings } from "@/app/actions/reminders";
import {
  DROPOUT_LISTS,
  isDropoutListKey,
  listFeedsRecycling,
  recycleBlockedReason,
  type DropoutAppointmentEntity,
  type DropoutEntity,
  type DropoutListKey,
} from "@/lib/dropoutLists";

// Der Ablage-Bereich: liest die sechs gesonderten Listen aus `dropout_lists()`
// (Migration 0033) und trägt die beiden Aktionen, die es dort gibt.
//
// Gelesen wird nur — die Zugehörigkeit zu einer Liste ist abgeleiteter
// Zeilenzustand und lässt sich hier gar nicht setzen. Geschrieben wird
// ausschließlich am Recycling: vorziehen (`pullRecycleForward`) oder dauerhaft
// sperren (`excludeFromRecycle` aus actions/recycle.ts, unverändert
// weiterverwendet).

/* ------------------------------------------------------------------ *
 * Verfügbarkeits-Probe
 * ------------------------------------------------------------------ */

/**
 * Fehlt das Schema (Migration 0033 nicht eingespielt), muss das von „Liste ist
 * leer" unterscheidbar sein — sonst zeigt die Ablage in beiden Fällen denselben
 * ruhigen Leerzustand, obwohl im einen Fall gar nichts erfasst wird. Muster
 * `loadCallAttempts` (src/lib/phoneAttemptsData.ts) und `loadRecycleTasks`.
 *
 * Geprüft wird der Fehlercode bzw. der Meldungstext, NICHT die leere
 * Ergebnismenge: eine fehlende Funktion meldet 42883/PGRST202, eine fehlende
 * Spalte oder Relation 42P01/42703/PGRST204/PGRST205. Dritte Kopie desselben
 * Prädikats (recycle.ts, reminders.ts) — sie wandern zusammen, sobald es die
 * gemeinsame `schemaProbe.ts` gibt.
 */
function isMissingSchema(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code && ["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(e.code)) return true;
  const msg = (e?.message ?? (err instanceof Error ? err.message : "")).toLowerCase();
  return /does not exist|could not find|schema cache/.test(msg);
}

// Nur die beiden Termin-Tabellen: „Recycling vorziehen" gibt es ausschließlich
// dort. Die beiden Lead-Ursprünge erscheinen nur in der Sperrliste, und ein
// gesperrter Lead bekommt per Definition keine Wiedervorlage mehr.
const TABLE_BY_ENTITY: Record<DropoutAppointmentEntity, string> = {
  setting: "setting_calls",
  closing: "closing_calls",
};

function isDropoutAppointmentEntity(value: unknown): value is DropoutAppointmentEntity {
  return value === "setting" || value === "closing";
}

/** Heute als BERLINER Kalendertag — auf Vercel läuft der Server in UTC, ein
    `new Date()` läge dort abends einen Tag daneben (docs §6). */
function todayBerlin(): string {
  return berlinDateISO(new Date().toISOString());
}

/* ------------------------------------------------------------------ *
 * Lesen
 * ------------------------------------------------------------------ */

/** Rückgabespalten von `dropout_lists()` (Migration 0033, Abschnitt 5). */
export type DropoutRowRaw = {
  /** Vier Ursprünge — 'linkedin' und 'telefon' kommen nur in der Sperrliste vor. */
  entity_type: DropoutEntity;
  entity_id: string;
  lead_name: string | null;
  company: string | null;
  /** `profiles.username` der zuständigen Person (assigned_user_id ?? created_by). */
  owner_name: string | null;
  assigned_user_id: string | null;
  /** Absage-, Disqualifizierungs- oder Verlustgrund — je nach Liste (docs §4). */
  reason_code: string | null;
  /** Freitext daneben: Code ist Statistik, Freitext ist Gedächtnis. */
  reason_text: string | null;
  /** `cancelled_at`, sonst `updated_at`, sonst `created_at`. */
  dropped_at: string | null;
  next_recycle_at: string | null;
  recycle_attempt_count: number;
  excluded: boolean;
  revived_at: string | null;
  reschedule_count: number;
  /**
   * Nur bei 'linkedin'/'telefon' gesetzt. Die beiden Lead-Tabellen haben keine
   * Detailseite — der Verweis führt zu ihrer Liste (`/lists/…` bzw.
   * `/telefon/…`), wie im Nachfassen-Board. Bei Terminen NULL: dort führt er
   * auf `/setting/<id>` bzw. `/closing/<id>`.
   */
  list_id: string | null;
};

export type DropoutRow = DropoutRowRaw & {
  /** null = „Recycling vorziehen" ist möglich, sonst der Grund dagegen. */
  recycle_blocked: string | null;
};

export type DropoutListResult = {
  rows: DropoutRow[];
  /** false = Schema fehlt (Migration 0033). NICHT dasselbe wie „Liste ist leer". */
  available: boolean;
  /** Versuchsdeckel der Organisation — die Karte zeigt „Versuch 1 von 2". */
  maxAttempts: number;
};

/**
 * Eine der sechs Listen laden.
 *
 * Die Datensicht kommt aus dem `AccessContext` und wird NICHT vom Aufrufer
 * entgegengenommen: Als Server Action ist die Funktion per direktem POST
 * erreichbar, und `dropout_lists` läuft als `security definer` — eine
 * mitgelieferte `workspace_id` hätte sie ohne Gegenprüfung übernommen.
 *
 * `p_effective_user_id` ist bewusst `access.effective_user_id` (null = org-weit)
 * und nicht das eigene Konto: Die Ablage ist ein Aktenschrank der Organisation,
 * keine persönliche Aufgabenliste. Ein Mitglied mit `data_scope='own'` wird von
 * `rpc_effective_user` serverseitig ohnehin auf sich selbst gezwungen. Die
 * Sperrliste hebt den Filter zusätzlich in der RPC auf.
 */
export async function loadDropoutList(list: string): Promise<DropoutListResult> {
  const access = await getAccessContext();
  if (!access) return { rows: [], available: false, maxAttempts: 0 };
  if (!isDropoutListKey(list)) return { rows: [], available: true, maxAttempts: 0 };

  const supabase = await createClient();
  // Der Deckel steht in `pipeline_settings` (0032) und wird hier nur angezeigt;
  // durchgesetzt wird er in `recycle_attempt()` bzw. in der Gate-Prüfung unten.
  const settings = await getPipelineSettings();

  try {
    const raw = await fetchAllRows<DropoutRowRaw>((from, to) =>
      supabase
        .rpc("dropout_lists", {
          p_workspace_id: access.workspace_id,
          p_list: list,
          p_effective_user_id: access.effective_user_id,
        })
        // Stabile Sortierung ist Pflicht, sonst überlappen sich die Seiten der
        // Paginierung — die RPC selbst gibt die Union ungeordnet zurück.
        .order("entity_id", { ascending: true })
        .range(from, to),
    );

    const rows = raw
      .map<DropoutRow>((r) => ({
        ...r,
        recycle_blocked: recycleBlockedReason({
          entity: r.entity_type,
          excluded: r.excluded,
          revived: Boolean(r.revived_at),
          // `recycle_responded_at` liefert die RPC nicht mit; ein Lead, der
          // reagiert hat, ist ohnehin über `revived_at` oder einen
          // Statuswechsel aus der Liste heraus. Die Action prüft es zusätzlich
          // an der Zeile selbst.
          responded: false,
          // In den Absage-Listen trägt `reason_code` den ABSAGEgrund, nicht den
          // Verlust- oder Disqualifizierungsgrund — die Sperre „bekommt nie ein
          // Recycling" greift hier also nur, wenn beide Gründe gesetzt sind.
          // Das ist bewusst die optimistische Seite: Die Action liest den
          // maßgeblichen Code an der Zeile und weist den Klick sonst mit
          // derselben Begründung ab.
          reasonCode: r.reason_code,
          attemptCount: r.recycle_attempt_count ?? 0,
          maxAttempts: settings.settings.max_attempts,
          inRecycleBranch: listFeedsRecycling(list, r.entity_type),
        }),
      }))
      // Neueste Zugänge oben: Die Ablage wird von vorn gelesen, nicht von hinten.
      .sort((a, b) => (b.dropped_at ?? "").localeCompare(a.dropped_at ?? ""));

    return { rows, available: true, maxAttempts: settings.settings.max_attempts };
  } catch (e) {
    const missing = isMissingSchema(e);
    if (!missing) console.error("dropout_lists:", e instanceof Error ? e.message : e);
    return { rows: [], available: !missing, maxAttempts: settings.settings.max_attempts };
  }
}

/**
 * Zähler je Liste für die Umschaltleiste.
 *
 * Sechs Abfragen mit `count: 'exact'` und `range(0, 0)`: Postgres zählt, die
 * Antwort trägt eine einzige Zeile. Die Alternative wäre, alle sechs Listen
 * vollständig zu laden, nur um `length` zu lesen — bei einem Aktenschrank, der
 * über Monate wächst, sechs volle Durchläufe pro Seitenaufruf.
 *
 * Fail-soft: Fällt eine Zahl aus, bleibt der Reiter ohne Zähler stehen, statt
 * die Seite abzuräumen — die Liste selbst lädt unabhängig davon.
 */
export async function loadDropoutCounts(): Promise<Partial<Record<DropoutListKey, number>>> {
  const access = await getAccessContext();
  if (!access) return {};

  const supabase = await createClient();
  const entries = await Promise.all(
    DROPOUT_LISTS.map(async (meta) => {
      try {
        const { count, error } = await supabase
          .rpc(
            "dropout_lists",
            {
              p_workspace_id: access.workspace_id,
              p_list: meta.key,
              p_effective_user_id: access.effective_user_id,
            },
            { count: "exact" },
          )
          .range(0, 0);
        if (error || count == null) return null;
        return [meta.key, count] as const;
      } catch {
        return null;
      }
    }),
  );

  return Object.fromEntries(entries.filter((e): e is readonly [DropoutListKey, number] => e !== null));
}

/* ------------------------------------------------------------------ *
 * Recycling vorziehen
 * ------------------------------------------------------------------ */

/** Die Spalten, an denen die Gate-Prüfung hängt — je Termin-Art eine andere Grund-Spalte. */
const GATE_COLUMNS: Record<DropoutAppointmentEntity, string> = {
  setting:
    "id, status, cancel_outlook, no_show_resolution, revived_at, recycle_excluded_at, recycle_responded_at, recycle_attempt_count, disqualify_reason_code",
  closing:
    "id, status, revived_at, recycle_excluded_at, recycle_responded_at, recycle_attempt_count, lost_reason_code",
};

type GateRow = {
  status: string | null;
  cancel_outlook?: string | null;
  no_show_resolution?: string | null;
  revived_at: string | null;
  recycle_excluded_at: string | null;
  recycle_responded_at: string | null;
  recycle_attempt_count: number | null;
  disqualify_reason_code?: string | null;
  lost_reason_code?: string | null;
};

/**
 * Erfüllt die Zeile den Status-Zweig von `recycle_tasks`? Wörtlich dieselbe
 * Bedingung wie dort — hier aus der Zeile gelesen statt aus der Liste
 * abgeleitet, weil ein direkter POST keine Liste mitschickt.
 */
function rowFeedsRecycling(entity: DropoutAppointmentEntity, row: GateRow): boolean {
  if (entity === "closing") return row.status === "verloren";
  return (
    row.status === "dead" ||
    row.status === "unqualifiziert" ||
    row.no_show_resolution === "ohne_antwort" ||
    row.cancel_outlook === "ohne_aussicht"
  );
}

/**
 * „Recycling vorziehen": die Wiedervorlage auf HEUTE setzen, damit der Vorgang
 * beim nächsten Aufruf von `/nachfassen` in der Recycling-Sektion auftaucht.
 *
 * Bewusst kein Aufruf von `schedule_recycle()`: Die RPC rechnet die
 * grundabhängige Wartezeit ab heute NEU aus — sie ist das Gegenteil von
 * „vorziehen". Geschrieben wird deshalb direkt, aber erst hinter derselben
 * Prüfung, die `schedule_recycle()` intern anstellt:
 *
 *  · gesperrte und wiederbelebte Zeilen bleiben unangetastet (der CHECK aus
 *    0033 würde ein Datum neben `recycle_excluded_at` ohnehin abweisen — der
 *    Nutzer bekäme eine rohe Postgres-Meldung statt einer Ansage),
 *  · „falsche Zielgruppe"/„kein Fit"/„keine Zusammenarbeit" bekommen nie ein
 *    Datum,
 *  · der Versuchsdeckel gilt auch für den vorgezogenen Versuch,
 *  · und die Zeile muss überhaupt einen Zweig von `recycle_tasks` speisen,
 *    sonst wäre das Datum unsichtbar.
 *
 * `recycle_attempt_count` bleibt unberührt: Vorziehen ist kein Versuch,
 * sondern nur eine frühere Fälligkeit. Hochgezählt wird erst im Board über
 * `markRecycleContacted`.
 */
export async function pullRecycleForward(
  entity: string,
  entityId: string,
): Promise<{ error?: string; dueAt?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  // 'linkedin'/'telefon' fallen hier bewusst durch: Sie stehen nur in der
  // Sperrliste, und eine Wiedervorlage widerspräche der Sperre.
  if (!isDropoutAppointmentEntity(entity)) return { error: "Unbekannte Termin-Art." };

  const supabase = await createClient();
  const table = TABLE_BY_ENTITY[entity];

  // Immer mit `workspace_id` gelesen UND geschrieben: für einen
  // Plattform-Admin lässt RLS jede Zeile durch, maßgeblich ist die aktive
  // Organisation (Muster canAccessAppointment).
  const { data, error: readError } = await supabase
    .from(table)
    .select(GATE_COLUMNS[entity])
    .eq("id", entityId)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();

  if (readError) {
    return {
      error: isMissingSchema(readError)
        ? "Recycling ist nicht verfügbar — Migration 0033 fehlt."
        : readError.message,
    };
  }
  const row = data as unknown as GateRow | null;
  if (!row) return { error: "Nicht gefunden." };

  const settings = await getPipelineSettings();
  const blocked = recycleBlockedReason({
    entity,
    excluded: Boolean(row.recycle_excluded_at),
    revived: Boolean(row.revived_at),
    responded: Boolean(row.recycle_responded_at),
    reasonCode: entity === "closing" ? row.lost_reason_code ?? null : row.disqualify_reason_code ?? null,
    attemptCount: row.recycle_attempt_count ?? 0,
    maxAttempts: settings.settings.max_attempts,
    inRecycleBranch: rowFeedsRecycling(entity, row),
  });
  if (blocked) return { error: blocked };

  const today = todayBerlin();
  const { error } = await supabase
    .from(table)
    .update({ next_recycle_at: today })
    .eq("id", entityId)
    .eq("workspace_id", access.workspace_id);

  if (error) {
    return {
      error: isMissingSchema(error) ? "Recycling ist nicht verfügbar — Migration 0033 fehlt." : error.message,
    };
  }

  revalidatePath("/ablage");
  revalidatePath("/nachfassen");
  return { dueAt: today };
}
