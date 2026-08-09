import { ClosingCallEditor } from "@/components/closing/ClosingCallEditor";
import type { SettingContext } from "@/components/closing/SettingMirror";
import { getAccessContext, listDataViewUsers } from "@/lib/access";
import { formatTermin } from "@/lib/apptTime";
import { createClient } from "@/lib/supabase/server";
import type { ClosingCall } from "@/lib/types";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/PageHeader";
import { CalendarClock } from "lucide-react";
import { notFound } from "next/navigation";

// Closing-Detail: Header + Script-Runner-Editor. Lädt den Call (workspace-
// und personen-gescoped), die Nutzerliste und den verlinkten Setting-Call als
// read-only Kontext für den Closer. Die Zuweisung steht als Spalte am Call
// selbst und wird direkt mitgelesen.

const STATUS_META: Record<ClosingCall["status"], { label: string; color: string; bg: string; border: string }> = {
  offen: { label: "Offen", color: "var(--text-secondary)", bg: "var(--surface-3)", border: "var(--border-default)" },
  gewonnen: {
    label: "Gewonnen",
    color: "var(--success-fg)",
    bg: "var(--success-bg)",
    border: "rgb(63 179 127 / 0.28)",
  },
  verloren: {
    label: "Verloren",
    color: "var(--danger-fg)",
    bg: "var(--danger-bg)",
    border: "rgb(214 90 82 / 0.28)",
  },
  nachfassen: {
    label: "Nachfassen",
    color: "var(--color-warning-text)",
    bg: "var(--color-warning-bg)",
    border: "var(--color-warning-border)",
  },
};

export default async function ClosingCallPage({ params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;
  const access = await getAccessContext();
  if (!access) notFound();

  const supabase = await createClient();

  let callQuery = supabase
    .from("closing_calls")
    .select("*")
    .eq("id", callId)
    .eq("workspace_id", access.workspace_id);
  if (access.effective_user_id) {
    // Zugewiesen ODER angelegt — dieselbe Bedingung wie die RLS-Policy aus
    // Migration 0028 §5. Ein Closing entsteht immer beim Qualifizieren des
    // Settings; ohne den Zuweisungs-Zweig saehe der zustaendige Closer sein
    // eigenes Gespraech nicht.
    callQuery = callQuery.or(
      `created_by_user_id.eq.${access.effective_user_id},assigned_user_id.eq.${access.effective_user_id}`,
    );
  }
  const { data: rawCall } = await callQuery.maybeSingle();
  if (!rawCall) notFound();
  const call = rawCall as ClosingCall;

  // Ungefiltert: Die Auswahl erscheint nur fuer Owner mit workspace-weiter
  // Datensicht (can_switch_view), und die Namensaufloesung unten braucht auch
  // fremde Nutzer — sonst bliebe die Zeile fuer ein Mitglied leer.
  const allUsers = await listDataViewUsers(access.workspace_id);
  const users = allUsers.map((u) => ({ user_id: u.user_id, username: u.username }));
  const assignedName = allUsers.find((u) => u.user_id === call.assigned_user_id)?.username ?? null;
  const creatorName =
    allUsers.find((u) => u.user_id === call.created_by_user_id)?.username ?? null;

  // Verlinkter Setting-Call (read-only Kontext für den Closer)
  let settingContext: SettingContext | null = null;
  if (call.setting_call_id) {
    const { data: setting } = await supabase
      .from("setting_calls")
      // Eine einzige String-Literal-Zeile: Supabase leitet den Zeilentyp aus
      // dem Literal ab — eine Konkatenation mit + macht daraus `string` und
      // die Inferenz kippt auf GenericStringError.
      .select(
        "script_answers, notes, ist_pain, warmth, soll_ziel, objections_handled, objections_open, has_budget_8k, branche, sole_decider, can_decide_now, clear_need, show_status, status, appointment_at, recording_link",
      )
      .eq("id", call.setting_call_id)
      .maybeSingle();
    if (setting) settingContext = setting as SettingContext;
  }

  const termin = formatTermin(call.call_at);
  const status = STATUS_META[call.status];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      {/* ── Header ── */}
      <BackLink href="/termine" label="Termine" />

      <PageHeader
        eyebrow="Closing-Call"
        title={call.lead_name ?? "Unbenannter Lead"}
        meta={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-5)", flexWrap: "wrap" }}>
            <span className="badge" style={{ color: status.color, background: status.bg }}>
              {status.label}
            </span>
            <span
              className="tnum"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--sp-3)",
                color: termin ? "var(--text-secondary)" : "var(--text-muted)",
              }}
            >
              <CalendarClock size={13} style={{ color: "var(--text-muted)" }} />
              {termin ?? "Kein Termin"}
            </span>
            {call.company && <span>{call.company}</span>}
          </span>
        }
      />

      <ClosingCallEditor
        call={call}
        canAssign={access.can_switch_view}
        assignedName={assignedName}
        creatorName={creatorName}
        users={users}
        settingContext={settingContext}
      />
    </div>
  );
}
