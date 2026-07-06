import { SettingQueue } from "@/components/setting/SettingQueue";
import { getAccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import type { SettingCall } from "@/lib/types";
import { ClipboardCheck } from "lucide-react";

// Setting-Queue: alle Setting-Calls des Workspace (personen-gescoped bei
// eigener Datensicht), sortiert nach Termin. Filter laufen clientseitig.

export default async function SettingPage() {
  const access = await getAccessContext();
  if (!access) return null;

  const supabase = await createClient();

  const [calls, assigneeRows] = await Promise.all([
    fetchAllRows<SettingCall>((from, to) => {
      let q = supabase
        .from("setting_calls")
        .select("*")
        .eq("workspace_id", access.workspace_id);
      if (access.effective_user_id) q = q.eq("created_by_user_id", access.effective_user_id);
      return q
        .order("appointment_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to);
    }),
    // fetchAllRows: ohne order/range cappt PostgREST bei 1000 Zeilen → Assignees würden stillschweigend fehlen.
    // try/catch: Ohne FK auf profiles darf die Seite trotzdem rendern (nur ohne Avatare).
    fetchAllRows((from, to) =>
      supabase
        .from("call_assignees")
        .select("entity_id, user_id, profiles ( username )")
        .eq("entity_type", "setting_call")
        .eq("workspace_id", access.workspace_id)
        .order("id", { ascending: true })
        .range(from, to),
    )
      .then(
        (rows) =>
          rows as unknown as {
            entity_id: string;
            user_id: string;
            profiles: { username: string } | null;
          }[],
      )
      .catch((e) => {
        console.error("setting assignees:", e instanceof Error ? e.message : e);
        return [] as { entity_id: string; user_id: string; profiles: { username: string } | null }[];
      }),
  ]);

  // Assignees je Call gruppieren (eine Query für alle Calls)
  const assigneesByCall: Record<string, { user_id: string; username: string }[]> = {};
  for (const row of assigneeRows) {
    (assigneesByCall[row.entity_id] ??= []).push({
      user_id: row.user_id,
      username: row.profiles?.username ?? row.user_id,
    });
  }

  const openCount = calls.filter((c) => c.status === "offen").length;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      {/* ── Page Header ── */}
      <div
        style={{
          marginBottom: "1.25rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
            <ClipboardCheck size={18} color="var(--brand-500)" />
            <h1
              style={{
                fontSize: "1.375rem",
                fontWeight: 800,
                margin: 0,
                letterSpacing: "-0.03em",
                color: "var(--text-primary)",
              }}
            >
              Setting
            </h1>
          </div>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", margin: 0 }}>
            Setting-Calls aus LinkedIn &amp; Telefon · Script-Runner · Qualifikation
          </p>
        </div>
        <span
          style={{
            fontSize: "0.75rem",
            color: "var(--text-subtle)",
            background: "var(--surface-100)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "0.25rem 0.625rem",
          }}
        >
          {calls.length.toLocaleString("de-DE")} Calls · {openCount.toLocaleString("de-DE")} offen
        </span>
      </div>

      <SettingQueue
        calls={calls}
        assigneesByCall={assigneesByCall}
        currentUserId={access.effective_user_id ?? access.user.id}
      />
    </div>
  );
}
