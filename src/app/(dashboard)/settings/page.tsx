import { createUserForm, deleteUserForm, listUsers } from "@/app/actions/workspace";
import { getTargets, setTargetForm } from "@/app/actions/targets";
import {
  resolveTarget,
  type TargetChannel,
  type TargetMetric,
  type TargetPeriod,
} from "@/lib/targets";
import { getMembership } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { Plus, Settings, Shield, Target, Trash2, UserCheck, Users } from "lucide-react";

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

  const OWNER_COLORS: Record<string, string> = {
    Kevin:  "#6366f1",
    Simon:  "#8b5cf6",
    Daniel: "#10b981",
    "Samuel Kerber": "#0ea5e9",
  };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: "1.25rem" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--brand-500)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-sm)", flexShrink: 0 }}>
          <Settings size={17} color="white" />
        </div>
        <div>
          <h1 style={{ fontSize: "1.375rem", fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.03em", margin: 0 }}>Einstellungen</h1>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-subtle)", margin: 0 }}>Workspace & Nutzerverwaltung</p>
        </div>
      </div>

      {/* Feedback */}
      {q.userOk && (
        <div style={{ background: "var(--color-success-bg)", border: "1px solid var(--color-success-border)", borderRadius: 10, color: "var(--color-success-text)", fontSize: "0.875rem", padding: "0.75rem 1rem", fontWeight: 500 }}>
          ✓ Nutzer erfolgreich angelegt.
        </div>
      )}
      {q.deleted && (
        <div style={{ background: "var(--color-success-bg)", border: "1px solid var(--color-success-border)", borderRadius: 10, color: "var(--color-success-text)", fontSize: "0.875rem", padding: "0.75rem 1rem", fontWeight: 500 }}>
          ✓ Nutzer gelöscht.
        </div>
      )}
      {q.userErr && (
        <div style={{ background: "var(--color-error-bg)", border: "1px solid var(--color-error-border)", borderRadius: 10, color: "var(--color-error-text)", fontSize: "0.875rem", padding: "0.75rem 1rem", fontWeight: 500 }}>
          Fehler: {q.userErr}
        </div>
      )}

      {/* ── Workspace ── */}
      <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
        <div style={{ padding: "1rem 1.375rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Shield size={14} color="var(--brand-500)" />
          <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary)" }}>Workspace</span>
        </div>
        <div style={{ padding: "1.125rem 1.375rem", display: "grid", gridTemplateColumns: "140px 1fr", rowGap: "0.625rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.8125rem", color: "var(--text-subtle)", fontWeight: 600 }}>Name</span>
          <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-primary)" }}>{m.workspaces.name}</span>
          <span style={{ fontSize: "0.8125rem", color: "var(--text-subtle)", fontWeight: 600 }}>Invite-Code</span>
          <code style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--brand-500)", background: "rgb(24 98 184 / 0.10)", border: "1px solid rgb(24 98 184 / 0.20)", borderRadius: 6, padding: "2px 8px", letterSpacing: "0.08em" }}>{m.workspaces.invite_code}</code>
          <span style={{ fontSize: "0.8125rem", color: "var(--text-subtle)", fontWeight: 600 }}>Deine Rolle</span>
          <span style={{ display: "inline-flex", width: "fit-content", padding: "2px 10px", borderRadius: 99, background: isOwner ? "rgb(24 98 184 / 0.12)" : "var(--surface-150)", border: `1px solid ${isOwner ? "rgb(24 98 184 / 0.30)" : "var(--border-bright)"}`, color: isOwner ? "var(--brand-500)" : "var(--text-subtle)", fontSize: "0.75rem", fontWeight: 700 }}>
            {isOwner ? "Owner" : "Member"}
          </span>
        </div>
      </div>

      {/* ── Nutzer ── */}
      {isOwner && (
        <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          <div style={{ padding: "1rem 1.375rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Users size={14} color="var(--brand-400)" />
            <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary)" }}>Team ({users.length})</span>
          </div>

          {/* User list */}
          <div>
            {users.map((u, i) => {
              const isMe = u.user_id === currentUser?.id;
              const avatarColor = OWNER_COLORS[u.username] ?? "#71717a";
              return (
                <div key={u.user_id} style={{ display: "flex", alignItems: "center", gap: "0.875rem", padding: "0.875rem 1.375rem", borderBottom: i < users.length - 1 ? "1px solid var(--border)" : "none" }}>
                  {/* Avatar */}
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: `${avatarColor}18`, border: `1.5px solid ${avatarColor}40`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: avatarColor, fontSize: "0.9375rem", flexShrink: 0 }}>
                    {u.username[0].toUpperCase()}
                  </div>
                  {/* Info */}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-primary)" }}>{u.username}</span>
                      {isMe && <span style={{ fontSize: "0.6875rem", color: "var(--text-subtle)", background: "var(--surface-200)", borderRadius: 99, padding: "1px 6px" }}>Du</span>}
                    </div>
                    <span style={{ fontSize: "0.75rem", color: u.role === "owner" ? "var(--brand-500)" : "var(--text-subtle)", fontWeight: 600 }}>
                      {u.role === "owner" ? "Owner" : "Mitglied"} · {u.data_scope === "own" ? "Nur eigene Daten" : "Alle Daten"}
                    </span>
                  </div>
                  {/* Delete (not self) */}
                  {!isMe && (
                    <form action={deleteUserForm}>
                      <input type="hidden" name="user_id" value={u.user_id} />
                      <button
                        type="submit"
                        onClick={(e) => { if (!confirm(`"${u.username}" wirklich löschen? Alle Daten bleiben erhalten.`)) e.preventDefault(); }}
                        title="Nutzer löschen"
                        style={{ background: "var(--color-error-bg)", border: "1px solid var(--color-error-border)", borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: "var(--color-error-text)", display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", fontWeight: 600, transition: "all 0.12s" }}
                      >
                        <Trash2 size={13} />
                        Löschen
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>

          {/* Create user form */}
          <div style={{ borderTop: "1px solid var(--border)", padding: "1.125rem 1.375rem", background: "rgb(24 98 184 / 0.02)" }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-subtle)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.875rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <Plus size={12} /> Neuen Nutzer anlegen
            </div>
            <form action={createUserForm} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-subtle)", marginBottom: "0.3rem" }}>Benutzername</label>
                  <input
                    name="username"
                    required
                    placeholder="z. B. Thomas"
                    style={{ width: "100%", background: "var(--surface-0)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.4rem 0.625rem", fontSize: "0.875rem", color: "var(--text-primary)", outline: "none", boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-subtle)", marginBottom: "0.3rem" }}>Passwort</label>
                  <input
                    name="password"
                    type="text"
                    required
                    placeholder="Frei wählbar"
                    style={{ width: "100%", background: "var(--surface-0)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.4rem 0.625rem", fontSize: "0.875rem", color: "var(--text-primary)", outline: "none", boxSizing: "border-box" }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-subtle)", marginBottom: "0.3rem" }}>Rolle</label>
                  <select name="role" defaultValue="member" style={{ background: "var(--surface-0)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.4rem 0.625rem", fontSize: "0.875rem", color: "var(--text-primary)", outline: "none" }}>
                    <option value="member">Member</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-subtle)", marginBottom: "0.3rem" }}>Datensicht</label>
                  <select name="data_scope" defaultValue="workspace" style={{ background: "var(--surface-0)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.4rem 0.625rem", fontSize: "0.875rem", color: "var(--text-primary)", outline: "none" }}>
                    <option value="workspace">Alle Daten</option>
                    <option value="own">Nur eigene Daten</option>
                  </select>
                </div>
                <button type="submit" style={{ marginTop: "1.25rem", display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.5rem 1rem", borderRadius: 9, border: "none", background: "var(--brand-500)", color: "white", fontWeight: 700, fontSize: "0.875rem", cursor: "pointer", boxShadow: "var(--shadow-sm)", whiteSpace: "nowrap" }}>
                  <Plus size={14} /> Anlegen
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
        <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          <div style={{ padding: "1rem 1.375rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Target size={14} color="var(--color-warning-text)" />
            <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary)" }}>Ziele</span>
            <span style={{ fontSize: "0.75rem", color: "var(--text-subtle)", fontWeight: 500 }}>Tages- und Wochenziele je Nutzer</span>
          </div>
          <div>
            {users.map((u, i) => {
              const accentColor = OWNER_COLORS[u.username] ?? "#71717a";
              return (
                <div key={u.user_id} style={{ padding: "0.875rem 1.375rem", borderBottom: i < users.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.625rem" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: accentColor, flexShrink: 0 }} />
                    <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary)" }}>{u.username}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.625rem" }}>
                    {TARGET_FIELDS.map((f) => {
                      const value = resolveTarget(targets, u.user_id, f.channel, f.period, f.metric);
                      return (
                        <form key={`${u.user_id}-${f.channel}-${f.period}-${f.metric}`} action={setTargetForm}>
                          <input type="hidden" name="user_id" value={u.user_id} />
                          <input type="hidden" name="channel" value={f.channel} />
                          <input type="hidden" name="period" value={f.period} />
                          <input type="hidden" name="metric" value={f.metric} />
                          <label style={{ display: "block", fontSize: "0.6875rem", fontWeight: 600, color: "var(--text-subtle)", marginBottom: "0.25rem" }}>{f.label}</label>
                          <div style={{ display: "flex", gap: "0.25rem" }}>
                            <input
                              type="number"
                              name="target_value"
                              min={0}
                              step={1}
                              defaultValue={value}
                              style={{ width: "100%", minWidth: 0, background: "var(--surface-0)", border: "1px solid var(--border)", borderRadius: 6, padding: "0.3rem 0.5rem", fontSize: "0.8125rem", color: "var(--text-primary)", outline: "none", boxSizing: "border-box" }}
                            />
                            <button
                              type="submit"
                              title="Ziel speichern"
                              style={{ background: "var(--surface-150)", border: "1px solid var(--border)", borderRadius: 6, padding: "0 0.5rem", fontSize: "0.75rem", fontWeight: 700, color: "var(--text-secondary)", cursor: "pointer", flexShrink: 0 }}
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

      {/* ── Passwort-Info ── */}
      <div style={{ background: "var(--color-warning-bg)", border: "1px solid var(--color-warning-border)", borderRadius: "var(--radius-lg)", padding: "1rem 1.375rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.375rem" }}>
          <UserCheck size={14} color="var(--color-warning-text)" />
          <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--color-warning-text)" }}>Passwort ändern</span>
        </div>
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--text-subtle)", lineHeight: 1.6 }}>
          Um ein Passwort zu ändern: Nutzer löschen und neu anlegen. Die Pitch-Daten (Listen + Kontakte) bleiben dabei vollständig erhalten.
        </p>
      </div>

    </div>
  );
}
