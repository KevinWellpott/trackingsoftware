import { getAssignees } from "@/app/actions/assignees";
import { ClosingCallEditor, type SettingContext } from "@/components/closing/ClosingCallEditor";
import { getAccessContext, listDataViewUsers } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import type { ClosingCall } from "@/lib/types";
import { ArrowLeft, CalendarClock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

// Closing-Detail: Header + Script-Runner-Editor. Lädt den Call (workspace-
// und personen-gescoped), Zuweisungen, Nutzerliste und den verlinkten
// Setting-Call als read-only Kontext für den Closer.

function formatTermin(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(d)} Uhr`;
}

const STATUS_META: Record<ClosingCall["status"], { label: string; color: string; bg: string; border: string }> = {
  offen: { label: "Offen", color: "var(--text-muted)", bg: "var(--surface-150)", border: "var(--border)" },
  gewonnen: {
    label: "Gewonnen",
    color: "var(--color-success-text)",
    bg: "var(--color-success-bg)",
    border: "var(--color-success-border)",
  },
  verloren: {
    label: "Verloren",
    color: "var(--color-error-text)",
    bg: "var(--color-error-bg)",
    border: "var(--color-error-border)",
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
    callQuery = callQuery.eq("created_by_user_id", access.effective_user_id);
  }
  const { data: rawCall } = await callQuery.maybeSingle();
  if (!rawCall) notFound();
  const call = rawCall as ClosingCall;

  const [assignees, allUsers] = await Promise.all([
    getAssignees("closing_call", call.id),
    listDataViewUsers(access.workspace_id),
  ]);
  const users = (access.data_scope === "own"
    ? allUsers.filter((u) => u.user_id === access.user.id)
    : allUsers
  ).map((u) => ({ user_id: u.user_id, username: u.username }));

  // Verlinkter Setting-Call (read-only Kontext für den Closer)
  let settingContext: SettingContext | null = null;
  if (call.setting_call_id) {
    const { data: setting } = await supabase
      .from("setting_calls")
      .select(
        "script_answers, notes, ist_pain, warmth, soll_ziel, objections_handled, objections_open, has_budget_8k, branche",
      )
      .eq("id", call.setting_call_id)
      .maybeSingle();
    if (setting) settingContext = setting as SettingContext;
  }

  const termin = formatTermin(call.call_at);
  const status = STATUS_META[call.status];

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: "1.25rem" }}>
        <Link
          href="/closing"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
            fontSize: "0.8125rem",
            color: "var(--text-subtle)",
            textDecoration: "none",
            marginBottom: "0.75rem",
          }}
        >
          <ArrowLeft size={13} /> Closing
        </Link>

        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap", marginBottom: "0.25rem" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  fontSize: "0.6875rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: status.color,
                  background: status.bg,
                  border: `1px solid ${status.border}`,
                  padding: "2px 8px",
                  borderRadius: 99,
                }}
              >
                {status.label}
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  color: termin ? "var(--text-secondary)" : "var(--text-subtle)",
                }}
              >
                <CalendarClock size={13} style={{ color: "var(--text-subtle)" }} />
                {termin ?? "Kein Termin"}
              </span>
            </div>
            <h1
              style={{
                fontSize: "1.5rem",
                fontWeight: 800,
                color: "var(--text-primary)",
                letterSpacing: "-0.03em",
                margin: 0,
              }}
            >
              {call.lead_name ?? "Unbenannter Lead"}
            </h1>
            {call.company && (
              <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", margin: "0.125rem 0 0" }}>{call.company}</p>
            )}
          </div>
        </div>
      </div>

      <ClosingCallEditor call={call} assignees={assignees} users={users} settingContext={settingContext} />
    </div>
  );
}
