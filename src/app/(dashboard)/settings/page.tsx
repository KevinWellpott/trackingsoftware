import { createUserForm, listUsers } from "@/app/actions/workspace";
import { PageHeader } from "@/components/ui/PageHeader";
import { getTargets, setTargetForm } from "@/app/actions/targets";
import { getFollowupTemplates } from "@/app/actions/templates";
import {
  resolveTarget,
  type TargetChannel,
  type TargetMetric,
  type TargetPeriod,
} from "@/lib/targets";
import { getAccessContext } from "@/lib/access";
import { getMembership } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { ownerColor } from "@/lib/ownerColor";
import { DeleteUserButton } from "@/components/settings/DeleteUserButton";
import { RenameUserButton } from "@/components/settings/RenameUserButton";
import { FollowupTemplatesEditor } from "@/components/settings/FollowupTemplatesEditor";
import { MessageSquareText, Plus, Shield, Target, UserCheck, Users } from "lucide-react";

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
  const m = await getMembership();
  if (!m) return null;

  const supabase = await createClient();
  const { data: { user: currentUser } } = await supabase.auth.getUser();

  const q = await searchParams;
  const isOwner = m.role === "owner";
  const { users } = isOwner ? await listUsers(m.workspace_id) : { users: [] };
  const targets = isOwner ? await getTargets() : [];

  // FU-Vorlagen des eingeloggten Nutzers (bzw. der aktiven Admin-Datensicht)
  const access = await getAccessContext();
  const templates = access
    ? await getFollowupTemplates(access.effective_user_id ?? access.user.id)
    : [];

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
          <span style={{ fontSize: "var(--fs-base)", fontWeight: 500, color: "var(--text-primary)" }}>{m.workspaces.name}</span>
          <span style={ROW_LABEL}>Invite-Code</span>
          <code style={{ width: "fit-content", fontFamily: "var(--font-mono-stack)", fontSize: "var(--fs-sm)", color: "var(--orange-300)", background: "var(--accent-muted)", border: "1px solid var(--border-accent)", borderRadius: "var(--r-sm)", padding: "3px 8px", letterSpacing: "0.08em" }}>{m.workspaces.invite_code}</code>
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
                      {u.role === "owner" ? "Owner" : "Mitglied"} · {u.data_scope === "own" ? "Nur eigene Daten" : "Alle Daten"}
                    </span>
                  </div>
                  {/* Rename + Delete (not self) */}
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
                  <select id="new-role" name="role" defaultValue="member" className="ui-input" style={{ width: "auto" }}>
                    <option value="member">Member</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="new-scope" style={FIELD_LABEL}>Datensicht</label>
                  <select id="new-scope" name="data_scope" defaultValue="workspace" className="ui-input" style={{ width: "auto" }}>
                    <option value="workspace">Alle Daten</option>
                    <option value="own">Nur eigene Daten</option>
                  </select>
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

      {/* ── Follow-up-Vorlagen ── */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={SECTION_HEAD}>
          <MessageSquareText size={16} color="var(--text-muted)" />
          <span style={SECTION_TITLE}>Follow-up-Vorlagen</span>
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>FU1–FU3</span>
        </div>
        <div style={{ padding: "var(--sp-7) var(--sp-8)" }}>
          <FollowupTemplatesEditor initial={templates} />
        </div>
      </div>

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
