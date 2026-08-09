import { TermineBoard } from "@/components/termine/TermineBoard";
import { getAccessContext, listDataViewUsers } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import type { ClosingCall, SettingCall } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";

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
      {/* ── Page Header ── */}
      <PageHeader
        eyebrow="Kalender"
        title="Termine"
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
