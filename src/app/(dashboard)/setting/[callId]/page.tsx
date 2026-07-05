import { getAssignees } from "@/app/actions/assignees";
import { SettingCallEditor } from "@/components/scripts/SettingCallEditor";
import { getAccessContext, listDataViewUsers } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import type { SettingCall } from "@/lib/types";
import { ArrowLeft, AtSign, CalendarClock, Phone, Video } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

// Setting-Detail: Header + Script-Runner-Editor. Lädt den Call (workspace-
// und personen-gescoped), Zuweisungen, Nutzerliste und Quell-Kontext
// (Notizen aus LinkedIn-Kontakt bzw. Telefon-Lead, read-only).

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

const SOURCE_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  linkedin: { label: "LinkedIn", color: "var(--color-info-text)", bg: "var(--color-info-bg)", border: "var(--color-info-border)" },
  telefon: { label: "Telefon", color: "var(--brand-500)", bg: "var(--brand-50)", border: "var(--brand-200)" },
  inbound: { label: "Inbound", color: "var(--text-muted)", bg: "var(--surface-150)", border: "var(--border)" },
  website: { label: "Website", color: "var(--text-muted)", bg: "var(--surface-150)", border: "var(--border)" },
};

export default async function SettingCallPage({ params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;
  const access = await getAccessContext();
  if (!access) notFound();

  const supabase = await createClient();

  let callQuery = supabase
    .from("setting_calls")
    .select("*")
    .eq("id", callId)
    .eq("workspace_id", access.workspace_id);
  if (access.effective_user_id) {
    callQuery = callQuery.eq("created_by_user_id", access.effective_user_id);
  }
  const { data: rawCall } = await callQuery.maybeSingle();
  if (!rawCall) notFound();
  const call = rawCall as SettingCall;

  const [assignees, allUsers] = await Promise.all([
    getAssignees("setting_call", call.id),
    listDataViewUsers(access.workspace_id),
  ]);
  const users = (access.data_scope === "own"
    ? allUsers.filter((u) => u.user_id === access.user.id)
    : allUsers
  ).map((u) => ({ user_id: u.user_id, username: u.username }));

  // Quell-Kontext (read-only Notizen aus LinkedIn-Kontakt / Telefon-Lead)
  const sourceNotes: { label: string; text: string }[] = [];
  if (call.source_contact_id) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("notes, answer_text")
      .eq("id", call.source_contact_id)
      .maybeSingle();
    const c = contact as { notes: string | null; answer_text: string | null } | null;
    if (c?.notes?.trim()) sourceNotes.push({ label: "Notizen", text: c.notes });
    if (c?.answer_text?.trim()) sourceNotes.push({ label: "Antwort des Leads", text: c.answer_text });
  }
  if (call.source_phone_lead_id) {
    const { data: lead } = await supabase
      .from("phone_leads")
      .select("notes, objection_notes, script")
      .eq("id", call.source_phone_lead_id)
      .maybeSingle();
    const l = lead as { notes: string | null; objection_notes: string | null; script: string | null } | null;
    if (l?.notes?.trim()) sourceNotes.push({ label: "Notizen", text: l.notes });
    if (l?.objection_notes?.trim()) sourceNotes.push({ label: "Einwände", text: l.objection_notes });
    if (l?.script?.trim()) sourceNotes.push({ label: "Script", text: l.script });
  }

  const termin = formatTermin(call.appointment_at);
  const source = call.source_type ? SOURCE_META[call.source_type] : null;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: "1.25rem" }}>
        <Link
          href="/setting"
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
          <ArrowLeft size={13} /> Setting
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
              {source && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.3rem",
                    fontSize: "0.6875rem",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: source.color,
                    background: source.bg,
                    border: `1px solid ${source.border}`,
                    padding: "2px 8px",
                    borderRadius: 99,
                  }}
                >
                  {call.source_type === "linkedin" ? <AtSign size={11} /> : call.source_type === "telefon" ? <Phone size={11} /> : null}
                  {source.label}
                </span>
              )}
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

          {call.meet_link && (
            <a
              href={call.meet_link}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.5rem 0.875rem",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--brand-200)",
                background: "var(--brand-50)",
                color: "var(--brand-500)",
                fontSize: "0.8125rem",
                fontWeight: 700,
                textDecoration: "none",
                flexShrink: 0,
              }}
            >
              <Video size={14} /> Meet öffnen
            </a>
          )}
        </div>
      </div>

      <SettingCallEditor
        call={call}
        assignees={assignees}
        users={users}
        sourceNotes={sourceNotes.length > 0 ? sourceNotes : undefined}
      />
    </div>
  );
}
