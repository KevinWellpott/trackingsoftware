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

export const dynamic = "force-dynamic";

type AssigneeRow = { entity_id: string; user_id: string; profiles: { username: string } | null };

export default async function TerminePage() {
  const access = await getAccessContext();
  if (!access) return null;

  const supabase = await createClient();

  // fetchAllRows: ohne order/range cappt PostgREST bei 1000 Zeilen.
  // try/catch bei den Assignees: ohne FK auf profiles soll die Seite trotzdem
  // rendern (nur ohne Avatare).
  const loadAssignees = (entityType: "setting_call" | "closing_call") =>
    fetchAllRows((from, to) =>
      supabase
        .from("call_assignees")
        .select("entity_id, user_id, profiles ( username )")
        .eq("entity_type", entityType)
        .eq("workspace_id", access.workspace_id)
        .order("id", { ascending: true })
        .range(from, to),
    )
      .then((rows) => rows as unknown as AssigneeRow[])
      .catch((e) => {
        console.error(`${entityType} assignees:`, e instanceof Error ? e.message : e);
        return [] as AssigneeRow[];
      });

  const [settings, closings, settingRows, closingRows, members] = await Promise.all([
    fetchAllRows<SettingCall>((from, to) => {
      let q = supabase.from("setting_calls").select("*").eq("workspace_id", access.workspace_id);
      if (access.effective_user_id) q = q.eq("created_by_user_id", access.effective_user_id);
      return q
        .order("appointment_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to);
    }),
    fetchAllRows<ClosingCall>((from, to) => {
      let q = supabase.from("closing_calls").select("*").eq("workspace_id", access.workspace_id);
      if (access.effective_user_id) q = q.eq("created_by_user_id", access.effective_user_id);
      return q
        .order("call_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to);
    }),
    loadAssignees("setting_call"),
    loadAssignees("closing_call"),
    listDataViewUsers(access.workspace_id).catch(() => []),
  ]);

  const group = (rows: AssigneeRow[]): Record<string, { user_id: string; username: string }[]> => {
    const out: Record<string, { user_id: string; username: string }[]> = {};
    for (const row of rows) {
      (out[row.entity_id] ??= []).push({
        user_id: row.user_id,
        username: row.profiles?.username ?? row.user_id,
      });
    }
    return out;
  };

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
        settingAssignees={group(settingRows)}
        closingAssignees={group(closingRows)}
        members={members.map((m) => ({ user_id: m.user_id, username: m.username }))}
        canFilterPersons={!access.effective_user_id}
      />
    </div>
  );
}
