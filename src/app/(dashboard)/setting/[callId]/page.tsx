import { SettingCallEditor } from "@/components/scripts/SettingCallEditor";
import { getAccessContext, listDataViewUsers } from "@/lib/access";
import { formatTerminParts } from "@/lib/apptTime";
import { channelColor, channelLabel } from "@/lib/channels";
import { createClient } from "@/lib/supabase/server";
import type { SettingCall } from "@/lib/types";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/PageHeader";
import { Phone } from "lucide-react";
import { notFound } from "next/navigation";

// Setting-Detail: Header + Script-Runner-Editor. Lädt den Call (workspace-
// und personen-gescoped), die Nutzerliste und Quell-Kontext (Notizen aus
// LinkedIn-Kontakt bzw. Telefon-Lead, read-only). Die Zuweisung steht als
// Spalte am Call selbst und wird direkt mitgelesen.

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
    // Zugewiesen ODER angelegt — dieselbe Bedingung wie die RLS-Policy aus
    // Migration 0028 §5. Ohne den Zuweisungs-Zweig koennte genau die Person,
    // der der Termin gehoert, ihn nicht oeffnen, sobald ein Admin ihn fuer
    // sie angelegt hat.
    callQuery = callQuery.or(
      `created_by_user_id.eq.${access.effective_user_id},assigned_user_id.eq.${access.effective_user_id}`,
    );
  }
  const { data: rawCall } = await callQuery.maybeSingle();
  if (!rawCall) notFound();
  const call = rawCall as SettingCall;

  // Ungefiltert: Die Auswahl erscheint nur fuer Owner mit workspace-weiter
  // Datensicht (can_switch_view), und die Namensaufloesung unten braucht auch
  // fremde Nutzer — sonst bliebe die Zeile fuer ein Mitglied leer.
  const allUsers = await listDataViewUsers(access.workspace_id);
  const users = allUsers.map((u) => ({ user_id: u.user_id, username: u.username }));

  // Wem der Termin gehoert bzw. wer ihn angelegt hat — ohne Zuweisungs-Recht
  // ist das die feste Anzeige.
  const assignedName = allUsers.find((u) => u.user_id === call.assigned_user_id)?.username ?? null;
  const creatorName =
    allUsers.find((u) => u.user_id === call.created_by_user_id)?.username ?? null;

  // Quell-Kontext (read-only Notizen aus LinkedIn-Kontakt / Telefon-Lead).
  //
  // `contacts.answer_text` wird bewusst NICHT mehr geladen (Vorgabe: „Antwort
  // aus LinkedIn auch raus"). Die Antwort steht ohnehin in der Listenzeile,
  // aus der der Termin entstanden ist — hier war sie eine Dublette, die als
  // farbige Karte über dem Gespräch klebte.
  const sourceNotes: { label: string; text: string }[] = [];
  if (call.source_contact_id) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("notes")
      .eq("id", call.source_contact_id)
      .maybeSingle();
    const c = contact as { notes: string | null } | null;
    if (c?.notes?.trim()) sourceNotes.push({ label: "Notizen", text: c.notes });
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
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}
              title={`Quelle: ${call.source_detail ?? channelLabel(call.source_type)}`}
            >
              <span aria-hidden className="stage-dot" style={{ background: channelColor(call.source_type) }} />
              {channelLabel(call.source_type)}
            </span>
            {/* Rufnummer direkt im Kopf: Wer kurzfristig für einen Kollegen
                einspringt, findet hier alles, was er zum Wählen braucht —
                vorher stand an dieser Stelle nur das Wort „Telefon-Termin". */}
            {call.meeting_kind === "telefon" && !call.meet_link && (
              call.phone ? (
                <a
                  href={`tel:${call.phone.replace(/[^\d+]/g, "")}`}
                  className="tnum"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--sp-3)",
                    color: "var(--text-primary)",
                    textDecoration: "none",
                  }}
                  title="Anrufen"
                >
                  <Phone size={13} style={{ color: "var(--text-muted)" }} /> {call.phone}
                </a>
              ) : (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)", color: "var(--warning-fg)" }}>
                  <Phone size={13} /> Telefon-Termin ohne Nummer
                </span>
              )
            )}
          </span>
        }
      />

      <SettingCallEditor
        call={call}
        canAssign={access.can_switch_view}
        assignedName={assignedName}
        creatorName={creatorName}
        users={users}
        sourceNotes={sourceNotes.length > 0 ? sourceNotes : undefined}
      />
    </div>
  );
}
