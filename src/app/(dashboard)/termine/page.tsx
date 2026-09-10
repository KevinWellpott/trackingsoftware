import type { ReactNode } from "react";
import { TermineBoard } from "@/components/termine/TermineBoard";
import { getAccessContext, listDataViewUsers } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import type { ClosingCall, SettingCall } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { InfoPopover } from "@/components/ui/InfoPopover";

// Termine: Setting- und Closing-Calls in einem Kalender (Monat / Woche / Tag)
// plus versteckter Listenansicht. Beide Tabellen werden komplett geladen und
// clientseitig gefiltert — Navigation und Ansichtswechsel bleiben dadurch ohne
// Server-Roundtrip. (Für größere Datenmengen existieren die Range-Indizes
// idx_setting_calls_ws_appt / idx_closing_calls_ws_call_at.)
//
// Die Personen-Zuordnung kommt seit Migration 0028 als `assigned_user_id` mit
// dem normalen Select mit. Vorher liefen dafür zwei zusätzliche Volldurchläufe
// über `call_assignees` (polymorph, ohne Fremdschlüssel → nicht einbettbar),
// deren Ergebnis im Speicher gruppiert wurde. Den Namen liefert die ohnehin
// geladene Mitgliederliste.

export const dynamic = "force-dynamic";

/**
 * Datensicht-Filter: „zugewiesen ODER (nicht zugewiesen UND selbst angelegt)".
 *
 * Dieselbe Reihenfolge wie `personOf()` (src/lib/personResolution.ts) und
 * `buildOwnScope()` für Listen. Ein reiner `created_by_user_id`-Filter würde
 * jeden Termin, den jemand FÜR eine andere Person gelegt hat, aus der Sicht des
 * Zuständigen verschwinden lassen — er stünde nur beim Ersteller, der ihn gar
 * nicht bearbeitet. Deckungsgleich mit den RLS-Policies aus Migration 0028 §5.
 */
function personScope(userId: string): string {
  return `assigned_user_id.eq.${userId},and(assigned_user_id.is.null,created_by_user_id.eq.${userId})`;
}

/* ------------------------------------------------------------------ *
 * Legende
 * ------------------------------------------------------------------ */

/**
 * Ein Kalender-Chip als Muster — mit denselben `data-*`-Attributen, aus denen
 * globals.css §7 die echten Chips baut. Bewusst kein nachgebautes Kästchen: Ein
 * zweites Rezept liefe beim nächsten Farbwechsel auseinander, und eine Legende,
 * die anders aussieht als die Sache, die sie erklärt, ist schlimmer als keine.
 */
function LegendChip({
  kind,
  tone = "neutral",
  dashed = false,
  dimmed = false,
  children,
}: {
  kind: "setting" | "closing";
  tone?: string;
  dashed?: boolean;
  dimmed?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className="cal-event"
      data-size="xs"
      data-kind={kind}
      data-tone={tone}
      data-dashed={dashed}
      data-dimmed={dimmed}
      aria-hidden
      style={{ width: 58, flexShrink: 0, cursor: "default", padding: "1px 4px" }}
    >
      {children}
    </span>
  );
}

function LegendRow({ chips, text }: { chips: ReactNode; text: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}>{chips}</span>
      <span style={{ minWidth: 0 }}>{text}</span>
    </div>
  );
}

/**
 * Was ein Chip alles sagt — vier Eigenschaften auf einmal.
 *
 * Das System steht seit Runde 1 in `lib/terminMeta.ts` und in globals.css §7
 * ausführlich begründet, war aber ausschließlich dort zu lesen: Auf der Seite
 * gab es weder Legende noch Info-Icon. Am ersten Tag ist ein Kalender damit ein
 * Farbraster, das man erst durch Ausprobieren versteht.
 */
function ChipLegende() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
        <strong style={{ color: "var(--text-primary)" }}>Füllung = Art</strong>
        <LegendRow
          chips={
            <>
              <LegendChip kind="setting">Setting</LegendChip>
              <LegendChip kind="closing">Closing</LegendChip>
            </>
          }
          text="Dunkel ist ein Setting, hell ein Closing."
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
        <strong style={{ color: "var(--text-primary)" }}>Rahmen = Stand</strong>
        <LegendRow chips={<LegendChip kind="setting">10:00</LegendChip>} text="Durchgezogen: steht noch an." />
        <LegendRow
          chips={
            <LegendChip kind="setting" tone="success" dashed>
              10:00
            </LegendChip>
          }
          text="Gestrichelt: das Ergebnis steht fest."
        />
        <LegendRow
          chips={
            <LegendChip kind="setting" tone="danger" dashed dimmed>
              10:00
            </LegendChip>
          }
          text="Abgeblendet: erledigt und aus der Planung raus."
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
        <strong style={{ color: "var(--text-primary)" }}>Farbe = Ausgang</strong>
        <span>
          Grün weitergekommen oder gewonnen · Rot geplatzt oder verloren · Gold da muss jemand ran · Grau noch
          offen.
        </span>
      </div>

      <span>
        Ausgeblendet wird nichts — auch ein toter Lead bleibt sichtbar und anklickbar, nur zurückgenommen.
      </span>
    </div>
  );
}

export default async function TerminePage() {
  const access = await getAccessContext();
  if (!access) return null;

  const supabase = await createClient();

  // fetchAllRows: ohne order/range cappt PostgREST bei 1000 Zeilen.
  const [settings, closings, members] = await Promise.all([
    fetchAllRows<SettingCall>((from, to) => {
      let q = supabase.from("setting_calls").select("*").eq("workspace_id", access.workspace_id);
      if (access.effective_user_id) q = q.or(personScope(access.effective_user_id));
      return q
        .order("appointment_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to);
    }),
    fetchAllRows<ClosingCall>((from, to) => {
      let q = supabase.from("closing_calls").select("*").eq("workspace_id", access.workspace_id);
      if (access.effective_user_id) q = q.or(personScope(access.effective_user_id));
      return q
        .order("call_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to);
    }),
    listDataViewUsers(access.workspace_id).catch(() => []),
  ]);

  const offen =
    settings.filter((c) => c.status === "offen").length + closings.filter((c) => c.status === "offen").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      {/* ── Page Header ──
          Die Legende hängt am Titel und nicht im Aktionsbereich: Dort steht mit
          der Zähl-Pille schon eine Aussage über den Bestand, das Info-Icon
          beantwortet dagegen eine Frage zum Inhalt darunter — dieselbe Stelle
          wie auf /ablage. */}
      <PageHeader
        eyebrow="Kalender"
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" }}>
            Termine
            <InfoPopover label="Wie die Chips zu lesen sind" width={380}>
              <ChipLegende />
            </InfoPopover>
          </span>
        }
        meta="Setting &amp; Closing in einem Kalender · Setting 30 min · Closing 60 min"
        actions={
          <span className="badge badge-gray tnum">
            {(settings.length + closings.length).toLocaleString("de-DE")} Termine · {offen.toLocaleString("de-DE")} offen
          </span>
        }
      />

      <TermineBoard
        settings={settings}
        closings={closings}
        members={members.map((m) => ({ user_id: m.user_id, username: m.username }))}
        canFilterPersons={!access.effective_user_id}
      />
    </div>
  );
}
