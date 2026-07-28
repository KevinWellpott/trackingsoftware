import { getAssignees } from "@/app/actions/assignees";
import { SettingCallEditor } from "@/components/scripts/SettingCallEditor";
import { getAccessContext, listDataViewUsers } from "@/lib/access";
import { formatTerminParts } from "@/lib/apptTime";
import { createClient } from "@/lib/supabase/server";
import type { SettingCall } from "@/lib/types";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/PageHeader";
import { notFound } from "next/navigation";

// Setting-Detail: Header + Script-Runner-Editor. Lädt den Call (workspace-
// und personen-gescoped), Zuweisungen, Nutzerliste und Quell-Kontext
// (Notizen aus LinkedIn-Kontakt bzw. Telefon-Lead, read-only).

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

  // Wer den Termin angelegt hat — fuer alle ohne Zuweisungs-Recht ist das
  // die feste Zuordnung. Aufloesung ueber die UNgefilterte Liste, sonst
  // faende ein Member den Namen eines fremden Erstellers nicht.
  const creatorName =
    allUsers.find((u) => u.user_id === call.created_by_user_id)?.username ?? null;

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

  // Kompaktes Termin-Format: Datum ruhig, Uhrzeit hervorgehoben.
  const termin = formatTerminParts(call.appointment_at);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      {/* ── Header ── */}
      <BackLink href="/termine" label="Termine" />

      <PageHeader
        eyebrow="Setting-Call"
        title={call.lead_name ?? "Unbenannter Lead"}
        meta={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-5)", flexWrap: "wrap" }}>
            <span
              className="tnum"
              style={{ display: "inline-flex", alignItems: "baseline", gap: "var(--sp-3)" }}
            >
              {termin ? (
                <>
                  <span style={{ color: "var(--text-secondary)" }}>{termin.date}</span>
                  <span aria-hidden style={{ color: "var(--text-disabled)" }}>·</span>
                  <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{termin.time}</span>
                </>
              ) : (
                <span style={{ color: "var(--text-muted)" }}>Kein Termin</span>
              )}
            </span>
            {call.company && <span>{call.company}</span>}
            {call.meeting_kind === "telefon" && !call.meet_link && (
              <span style={{ color: "var(--text-muted)" }}>Telefon-Termin</span>
            )}
          </span>
        }
      />

      <SettingCallEditor
        call={call}
        canAssign={access.can_switch_view}
        creatorName={creatorName}
        assignees={assignees}
        users={users}
        sourceNotes={sourceNotes.length > 0 ? sourceNotes : undefined}
      />
    </div>
  );
}
