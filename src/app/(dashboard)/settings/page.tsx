import { createUserForm, listUsers } from "@/app/actions/workspace";
import { PageHeader } from "@/components/ui/PageHeader";
import { FormSelect } from "@/components/ui/Select";
import { getTargets, setTargetForm } from "@/app/actions/targets";
import {
  resolveTarget,
  type TargetChannel,
  type TargetMetric,
  type TargetPeriod,
} from "@/lib/targets";
import { getAccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { ownerColor } from "@/lib/ownerColor";
import { DeleteUserButton } from "@/components/settings/DeleteUserButton";
import { RenameUserButton } from "@/components/settings/RenameUserButton";
import { DataScopeSelect } from "@/components/settings/DataScopeSelect";
import { RoleSelect } from "@/components/settings/RoleSelect";
import { getReminderSettings, updateReminderSettingsForm } from "@/app/actions/reminders";
import { getRecycleSettings, updateRecycleSettingsForm } from "@/app/actions/recycle";
import { Bell, Plus, RefreshCw, Shield, Target, UserCheck, Users } from "lucide-react";

const TARGET_FIELDS: {
  label: string;
  channel: TargetChannel;
  period: TargetPeriod;
  metric: TargetMetric;
}[] = [
  { label: "LinkedIn Pitches/Tag", channel: "linkedin", period: "daily", metric: "pitches" },
  { label: "LinkedIn Pitches/Woche", channel: "linkedin", period: "weekly", metric: "pitches" },
  { label: "Telefon Anrufe/Tag", channel: "telefon", period: "daily", metric: "calls" },
  { label: "Telefon Anrufe/Woche", channel: "telefon", period: "weekly", metric: "calls" },
  { label: "Termine/Woche", channel: "telefon", period: "weekly", metric: "appointments" },
];

const REMINDER_OFFSET_FIELDS = [
  { field: "offset_1_hours", label: "1. Erinnerung (Std. vorher)" },
  { field: "offset_2_hours", label: "2. Erinnerung (Std. vorher)" },
  { field: "offset_3_hours", label: "3. Erinnerung (Std. vorher)" },
] as const;

const REMINDER_TEMPLATE_FIELDS = [
  { field: "template_setting_reminder", label: "Setting-Erinnerung" },
  { field: "template_closing_reminder", label: "Closing-Erinnerung" },
  { field: "template_followup_reminder", label: "Nachfass-Termin-Erinnerung" },
  { field: "template_no_show_setting", label: "No-Show-Nachfassen (Setting)" },
  { field: "template_no_show_closing", label: "No-Show-Nachfassen (Closing)" },
] as const;

// Reihenfolge = Erzähl-Reihenfolge: kurze Wartezeit zuerst (Timing), lange
// zuletzt (Wettbewerb/Vertrauen). 'falsche_zielgruppe' hat bewusst kein
// Feld — nie automatisches Recycling (§ Konzept-Diskussion).
const RECYCLE_DAY_FIELDS = [
  { field: "days_ghosting_breakup", label: "Ghosting — Breakup-Touch (Tage)" },
  { field: "days_timing", label: "Verlustgrund: Timing (Tage)" },
  { field: "days_preis", label: "Verlustgrund: Preis (Tage)" },
  { field: "days_kein_bedarf", label: "Verlustgrund: Kein Bedarf (Tage)" },
  { field: "days_sonstiges", label: "Verlustgrund: Sonstiges (Tage)" },
  { field: "days_phone_dead", label: "Telefon-Lead dead (Tage)" },
  { field: "days_setting_dead", label: "Setting dead (Tage)" },
  { field: "days_linkedin_exhausted", label: "LinkedIn ohne Antwort (Tage)" },
  { field: "days_entscheider", label: "Verlustgrund: Entscheider (Tage)" },
  { field: "days_ghosting", label: "Ghosting — danach (Tage)" },
  { field: "days_wettbewerb", label: "Verlustgrund: Wettbewerb (Tage)" },
  { field: "days_vertrauen", label: "Verlustgrund: Vertrauen (Tage)" },
] as const;

const RECYCLE_TEMPLATE_FIELDS = [
  { field: "template_recycle_linkedin", label: "LinkedIn" },
  { field: "template_recycle_telefon", label: "Telefon" },
  { field: "template_recycle_setting", label: "Setting" },
  { field: "template_recycle_closing", label: "Closing" },
] as const;

// Gemeinsame Stile des Settings-Layouts (COMPONENTS.md §15).
const SECTION_HEAD: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-4)",
  padding: "var(--sp-6) var(--sp-8)",
  borderBottom: "1px solid var(--border-default)",
};
const SECTION_TITLE: React.CSSProperties = {
  fontSize: "var(--fs-md)",
  fontWeight: 600,
  letterSpacing: "var(--ls-tight)",
  color: "var(--text-primary)",
};
const ROW_LABEL: React.CSSProperties = {
  fontSize: "var(--fs-sm)",
  color: "var(--text-muted)",
};
const FIELD_LABEL: React.CSSProperties = {
  display: "block",
  fontSize: "var(--fs-xs)",
  fontWeight: 500,
  color: "var(--text-secondary)",
  marginBottom: "var(--sp-3)",
};
const FEEDBACK_BASE: React.CSSProperties = {
  borderRadius: "var(--r-sm)",
  fontSize: "var(--fs-base)",
  padding: "var(--sp-5) var(--sp-6)",
};
const FEEDBACK_OK: React.CSSProperties = {
  ...FEEDBACK_BASE,
  background: "var(--success-bg)",
  borderLeft: "2px solid var(--success)",
  color: "var(--success-fg)",
};
const FEEDBACK_ERR: React.CSSProperties = {
  ...FEEDBACK_BASE,
  background: "var(--danger-bg)",
  borderLeft: "2px solid var(--danger)",
  color: "var(--danger-fg)",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ userErr?: string; userOk?: string; deleted?: string }>;
}) {
  // Alles bezieht sich auf die AKTIVE Organisation. Fuer einen Plattform-Admin
  // in einer Kunden-Org ist das deren Workspace — damit laeuft die
  // Nutzerverwaltung des Kunden ueber genau diesen Screen, ohne zweite UI.
  const access = await getAccessContext();
  if (!access) return null;

  const supabase = await createClient();
  const { data: { user: currentUser } } = await supabase.auth.getUser();

  const q = await searchParams;
  const isOwner = access.role === "owner";
  // Strenger als `isOwner`: die Kaskaden-Einstellungen sind Team-weit sichtbar
  // (jeder rendert seine "Meine Erinnerungen heute" gegen dieselben Vorlagen)
  // und deshalb bewusst nur für role='owner' UND data_scope='workspace'
  // änderbar — dasselbe Prädikat wie access.can_switch_view / setAssignee().
  const canManageReminders = access.role === "owner" && access.data_scope === "workspace";
  const { users } = isOwner ? await listUsers(access.workspace_id) : { users: [] };
  const targets = isOwner ? await getTargets() : [];
  const reminderSettings = canManageReminders ? await getReminderSettings() : null;
  const recycleSettings = canManageReminders ? await getRecycleSettings() : null;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>

      {/* Header */}
      <PageHeader eyebrow="Verwaltung" title="Einstellungen" meta="Workspace, Team und Ziele" />

      {/* Feedback */}
      {q.userOk && (
        <div role="status" style={FEEDBACK_OK}>Nutzer angelegt.</div>
      )}
      {q.deleted && (
        <div role="status" style={FEEDBACK_OK}>Nutzer gelöscht.</div>
      )}
      {q.userErr && (
        <div role="alert" style={FEEDBACK_ERR}>{q.userErr}</div>
      )}

      {/* ── Workspace ── */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={SECTION_HEAD}>
          <Shield size={16} color="var(--text-muted)" />
          <span style={SECTION_TITLE}>Workspace</span>
        </div>
        {/* Settings-Layout: Label links (COMPONENTS.md §15). */}
        <div style={{ padding: "var(--sp-7) var(--sp-8)", display: "grid", gridTemplateColumns: "160px 1fr", rowGap: "var(--sp-6)", alignItems: "center" }}>
          <span style={ROW_LABEL}>Name</span>
          <span style={{ fontSize: "var(--fs-base)", fontWeight: 500, color: "var(--text-primary)" }}>{access.workspaces.name}</span>
          <span style={ROW_LABEL}>Invite-Code</span>
          <code style={{ width: "fit-content", fontFamily: "var(--font-mono-stack)", fontSize: "var(--fs-sm)", color: "var(--orange-300)", background: "var(--accent-muted)", border: "1px solid var(--border-accent)", borderRadius: "var(--r-sm)", padding: "3px 8px", letterSpacing: "0.08em" }}>{access.workspaces.invite_code}</code>
          <span style={ROW_LABEL}>Deine Rolle</span>
          <span className={isOwner ? "badge badge-indigo" : "badge badge-gray"} style={{ width: "fit-content" }}>
            {isOwner ? "Owner" : "Member"}
          </span>
        </div>
      </div>

      {/* ── Nutzer ── */}
      {isOwner && (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={SECTION_HEAD}>
            <Users size={16} color="var(--text-muted)" />
            <span style={SECTION_TITLE}>Team</span>
            <span className="count-pill" style={{ marginLeft: "auto" }}>{users.length}</span>
          </div>

          {/* User list */}
          <div>
            {users.map((u, i) => {
              const isMe = u.user_id === currentUser?.id;
              const avatar = ownerColor(u.username);
              return (
                <div key={u.user_id} style={{ display: "flex", alignItems: "center", gap: "var(--sp-6)", padding: "var(--sp-6) var(--sp-8)", borderBottom: i < users.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
                  {/* Avatar */}
                  <div style={{ width: 36, height: 36, borderRadius: "var(--r-full)", background: avatar.bg, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, color: avatar.fg, fontSize: "var(--fs-sm)", flexShrink: 0 }}>
                    {u.username[0].toUpperCase()}
                  </div>
                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
                      <span style={{ fontSize: "var(--fs-base)", fontWeight: 500, color: "var(--text-primary)" }}>{u.username}</span>
                      {isMe && <span className="badge badge-gray">Du</span>}
                    </div>
                    <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
                      {isMe ? "Eigene Rolle nicht änderbar" : "Rolle · Datensicht"}
                    </span>
                  </div>
                  {/* Rolle + Datensicht (beide editierbar) + Rename + Delete (not self) */}
                  <RoleSelect userId={u.user_id} role={u.role} disabled={isMe} />
                  <DataScopeSelect userId={u.user_id} dataScope={u.data_scope} />
                  <RenameUserButton userId={u.user_id} username={u.username} />
                  {!isMe && <DeleteUserButton userId={u.user_id} username={u.username} />}
                </div>
              );
            })}
          </div>

          {/* Create user form */}
          <div style={{ borderTop: "1px solid var(--border-default)", padding: "var(--sp-7) var(--sp-8)", background: "var(--surface-1)" }}>
            <div className="eyebrow eyebrow-muted" style={{ marginBottom: "var(--sp-6)", display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
              <Plus size={12} /> Neuen Nutzer anlegen
            </div>
            <form action={createUserForm} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-6)" }}>
                <div>
                  <label htmlFor="new-username" style={FIELD_LABEL}>Benutzername</label>
                  <input id="new-username" name="username" required placeholder="z. B. Thomas" className="ui-input" />
                </div>
                <div>
                  <label htmlFor="new-password" style={FIELD_LABEL}>Passwort</label>
                  <input id="new-password" name="password" type="text" required placeholder="Frei wählbar" className="ui-input" />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--sp-6)", flexWrap: "wrap" }}>
                <div>
                  <label htmlFor="new-role" style={FIELD_LABEL}>Rolle</label>
                  <FormSelect
                    id="new-role"
                    name="role"
                    defaultValue="member"
                    ariaLabel="Rolle"
                    options={[
                      { value: "member", label: "Member" },
                      { value: "owner", label: "Owner" },
                    ]}
                    triggerStyle={{ width: 176 }}
                  />
                </div>
                <div>
                  <label htmlFor="new-scope" style={FIELD_LABEL}>Datensicht</label>
                  <FormSelect
                    id="new-scope"
                    name="data_scope"
                    defaultValue="workspace"
                    ariaLabel="Datensicht"
                    options={[
                      { value: "workspace", label: "Alle Daten" },
                      { value: "own", label: "Nur eigene Daten" },
                    ]}
                    triggerStyle={{ width: 208 }}
                  />
                </div>
                {/* Der eine Primaer-CTA dieser View. */}
                <button type="submit" className="btn-primary">
                  <Plus size={15} /> Anlegen
                </button>
              </div>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-subtle)" }}>
                Nutzer kann sich sofort unter <strong style={{ color: "var(--text-muted)" }}>/login</strong> anmelden — kein Invite-Code nötig.
              </p>
            </form>
          </div>
        </div>
      )}

      {/* ── Ziele ── */}
      {isOwner && (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={SECTION_HEAD}>
            <Target size={16} color="var(--text-muted)" />
            <span style={SECTION_TITLE}>Ziele</span>
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>Tag &amp; Woche je Nutzer</span>
          </div>
          <div>
            {users.map((u, i) => {
              const accentColor = ownerColor(u.username).fg;
              return (
                <div key={u.user_id} style={{ padding: "var(--sp-6) var(--sp-8)", borderBottom: i < users.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", marginBottom: "var(--sp-6)" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "var(--r-full)", background: accentColor, flexShrink: 0 }} />
                    <span style={{ fontSize: "var(--fs-base)", fontWeight: 500, color: "var(--text-primary)" }}>{u.username}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: "var(--sp-6)" }}>
                    {TARGET_FIELDS.map((f) => {
                      const value = resolveTarget(targets, u.user_id, f.channel, f.period, f.metric);
                      return (
                        <form key={`${u.user_id}-${f.channel}-${f.period}-${f.metric}`} action={setTargetForm}>
                          <input type="hidden" name="user_id" value={u.user_id} />
                          <input type="hidden" name="channel" value={f.channel} />
                          <input type="hidden" name="period" value={f.period} />
                          <input type="hidden" name="metric" value={f.metric} />
                          <label style={{ display: "block", fontSize: "var(--fs-xs)", fontWeight: 500, color: "var(--text-muted)", marginBottom: "var(--sp-3)" }}>{f.label}</label>
                          <div style={{ display: "flex", gap: "var(--sp-3)" }}>
                            <input
                              type="number"
                              name="target_value"
                              min={0}
                              step={1}
                              defaultValue={value}
                              className="ui-input"
                              style={{ minWidth: 0, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                            />
                            <button
                              type="submit"
                              title="Ziel speichern"
                              className="btn-secondary"
                              style={{ padding: "0 var(--sp-5)", flexShrink: 0 }}
                            >
                              ✓
                            </button>
                          </div>
                        </form>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {users.length === 0 && (
              <p style={{ margin: 0, padding: "0.875rem 1.375rem", fontSize: "0.8125rem", color: "var(--text-subtle)" }}>
                Keine Nutzer vorhanden.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Erinnerungs-Kaskade ──
          Sichtbarkeits-Gate bewusst STRENGER als bei „Nutzer"/„Ziele" oben
          (dort reicht role='owner') — siehe Kommentar bei canManageReminders. */}
      {canManageReminders && reminderSettings && (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={SECTION_HEAD}>
            <Bell size={16} color="var(--text-muted)" />
            <span style={SECTION_TITLE}>Erinnerungs-Kaskade</span>
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>Zeitabstände &amp; Vorlagen</span>
          </div>
          <div style={{ padding: "var(--sp-7) var(--sp-8)", display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
            <div>
              <div className="eyebrow eyebrow-muted" style={{ marginBottom: "var(--sp-5)" }}>
                Abstände vor dem Termin
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "var(--sp-6)" }}>
                {REMINDER_OFFSET_FIELDS.map((f) => (
                  <form key={f.field} action={updateReminderSettingsForm}>
                    <input type="hidden" name="field" value={f.field} />
                    <label style={FIELD_LABEL}>{f.label}</label>
                    <div style={{ display: "flex", gap: "var(--sp-3)" }}>
                      <input
                        type="number"
                        name="value"
                        min={1}
                        step={1}
                        defaultValue={reminderSettings[f.field]}
                        className="ui-input"
                        style={{ minWidth: 0, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                      />
                      <button type="submit" title="Speichern" className="btn-secondary" style={{ padding: "0 var(--sp-5)", flexShrink: 0 }}>
                        ✓
                      </button>
                    </div>
                  </form>
                ))}
              </div>
            </div>
            <div>
              <div className="eyebrow eyebrow-muted" style={{ marginBottom: "var(--sp-5)" }}>
                Nachrichtenvorlagen
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
                {REMINDER_TEMPLATE_FIELDS.map((f) => (
                  <form
                    key={f.field}
                    action={updateReminderSettingsForm}
                    style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}
                  >
                    <input type="hidden" name="field" value={f.field} />
                    <label style={FIELD_LABEL}>{f.label}</label>
                    <div style={{ display: "flex", gap: "var(--sp-3)", alignItems: "flex-start" }}>
                      <textarea
                        name="value"
                        defaultValue={reminderSettings[f.field]}
                        rows={2}
                        className="ui-input"
                        style={{ flex: 1, minWidth: 0, resize: "vertical", fontFamily: "inherit", padding: "var(--sp-3) var(--sp-4)" }}
                      />
                      <button
                        type="submit"
                        title="Speichern"
                        className="btn-secondary"
                        style={{ padding: "0 var(--sp-5)", height: "var(--h-control-lg)", flexShrink: 0 }}
                      >
                        ✓
                      </button>
                    </div>
                  </form>
                ))}
              </div>
              <p style={{ margin: "var(--sp-4) 0 0", fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>
                Platzhalter: <code>{"{vorname}"}</code> · <code>{"{firma}"}</code> · <code>{"{datum}"}</code> ·{" "}
                <code>{"{uhrzeit}"}</code>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Recycling ──
          Gleiches Sichtbarkeits-Gate wie Erinnerungs-Kaskade — dieselbe
          Begründung (Team-weit sichtbar unter /nachfassen). */}
      {canManageReminders && recycleSettings && (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={SECTION_HEAD}>
            <RefreshCw size={16} color="var(--text-muted)" />
            <span style={SECTION_TITLE}>Recycling</span>
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>Wartezeiten &amp; Vorlagen</span>
          </div>
          <div style={{ padding: "var(--sp-7) var(--sp-8)", display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
            <div>
              <div className="eyebrow eyebrow-muted" style={{ marginBottom: "var(--sp-5)" }}>
                Wartezeit bis zum nächsten Versuch
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "var(--sp-6)" }}>
                {RECYCLE_DAY_FIELDS.map((f) => (
                  <form key={f.field} action={updateRecycleSettingsForm}>
                    <input type="hidden" name="field" value={f.field} />
                    <label style={FIELD_LABEL}>{f.label}</label>
                    <div style={{ display: "flex", gap: "var(--sp-3)" }}>
                      <input
                        type="number"
                        name="value"
                        min={1}
                        step={1}
                        defaultValue={recycleSettings[f.field]}
                        className="ui-input"
                        style={{ minWidth: 0, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                      />
                      <button type="submit" title="Speichern" className="btn-secondary" style={{ padding: "0 var(--sp-5)", flexShrink: 0 }}>
                        ✓
                      </button>
                    </div>
                  </form>
                ))}
                <form action={updateRecycleSettingsForm}>
                  <input type="hidden" name="field" value="max_attempts" />
                  <label style={FIELD_LABEL}>Max. Recycling-Versuche</label>
                  <div style={{ display: "flex", gap: "var(--sp-3)" }}>
                    <input
                      type="number"
                      name="value"
                      min={1}
                      max={5}
                      step={1}
                      defaultValue={recycleSettings.max_attempts}
                      className="ui-input"
                      style={{ minWidth: 0, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                    />
                    <button type="submit" title="Speichern" className="btn-secondary" style={{ padding: "0 var(--sp-5)", flexShrink: 0 }}>
                      ✓
                    </button>
                  </div>
                </form>
              </div>
              <p style={{ margin: "var(--sp-4) 0 0", fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>
                Verlustgrund &bdquo;Falsche Zielgruppe&ldquo; bekommt bewusst kein automatisches Recycling.
              </p>
            </div>
            <div>
              <div className="eyebrow eyebrow-muted" style={{ marginBottom: "var(--sp-5)" }}>
                Nachrichtenvorlagen je Ursprung
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
                {RECYCLE_TEMPLATE_FIELDS.map((f) => (
                  <form
                    key={f.field}
                    action={updateRecycleSettingsForm}
                    style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}
                  >
                    <input type="hidden" name="field" value={f.field} />
                    <label style={FIELD_LABEL}>{f.label}</label>
                    <div style={{ display: "flex", gap: "var(--sp-3)", alignItems: "flex-start" }}>
                      <textarea
                        name="value"
                        defaultValue={recycleSettings[f.field]}
                        rows={2}
                        className="ui-input"
                        style={{ flex: 1, minWidth: 0, resize: "vertical", fontFamily: "inherit", padding: "var(--sp-3) var(--sp-4)" }}
                      />
                      <button
                        type="submit"
                        title="Speichern"
                        className="btn-secondary"
                        style={{ padding: "0 var(--sp-5)", height: "var(--h-control-lg)", flexShrink: 0 }}
                      >
                        ✓
                      </button>
                    </div>
                  </form>
                ))}
              </div>
              <p style={{ margin: "var(--sp-4) 0 0", fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>
                Platzhalter: <code>{"{vorname}"}</code> · <code>{"{firma}"}</code> · <code>{"{anlass}"}</code>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Die Karte „Follow-up-Vorlagen (FU1–FU3)" ist hier bewusst entfernt.
          Der Datenpfad bleibt unangetastet: `followup_templates` wirkt weiter
          als Fallback, wenn eine Liste keinen eigenen Nachfass-Text hat
          (Vorrang: lists.fuN_text > followup_templates > Standardtext, siehe
          followUpTextFor in actions/nachfassen.ts). Gepflegt wird der Text
          dort, wo er benutzt wird — an der Liste. */}

      {/* ── Passwort-Info ── */}
      <div style={{ background: "var(--warning-bg)", borderLeft: "2px solid var(--warning)", borderRadius: "var(--r-md)", padding: "var(--sp-6) var(--sp-7)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", marginBottom: "var(--sp-3)" }}>
          <UserCheck size={15} color="var(--warning-fg)" />
          <span style={{ fontSize: "var(--fs-base)", fontWeight: 500, color: "var(--warning-fg)" }}>Passwort ändern</span>
        </div>
        <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-secondary)", lineHeight: "var(--lh-base)" }}>
          Um ein Passwort zu ändern: Nutzer löschen und neu anlegen. Die Pitch-Daten (Listen + Kontakte) bleiben dabei vollständig erhalten.
        </p>
      </div>

    </div>
  );
}
