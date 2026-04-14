import { createUserForm, deleteUserForm, listUsers } from "@/app/actions/workspace";
import { getMembership } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { Plus, Settings, Shield, Trash2, UserCheck, Users } from "lucide-react";

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

  const OWNER_COLORS: Record<string, string> = {
    Kevin:  "#818cf8",
    Simon:  "#a78bfa",
    Daniel: "#34d399",
  };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: "1.25rem" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 12px rgba(99,102,241,0.4)", flexShrink: 0 }}>
          <Settings size={17} color="white" />
        </div>
        <div>
          <h1 style={{ fontSize: "1.375rem", fontWeight: 800, color: "#fafafa", letterSpacing: "-0.03em", margin: 0 }}>Einstellungen</h1>
          <p style={{ fontSize: "0.8125rem", color: "#52525b", margin: 0 }}>Workspace & Nutzerverwaltung</p>
        </div>
      </div>

      {/* Feedback */}
      {q.userOk && (
        <div style={{ background: "rgba(74,222,128,0.07)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 10, color: "#4ade80", fontSize: "0.875rem", padding: "0.75rem 1rem", fontWeight: 500 }}>
          ✓ Nutzer erfolgreich angelegt.
        </div>
      )}
      {q.deleted && (
        <div style={{ background: "rgba(74,222,128,0.07)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 10, color: "#4ade80", fontSize: "0.875rem", padding: "0.75rem 1rem", fontWeight: 500 }}>
          ✓ Nutzer gelöscht.
        </div>
      )}
      {q.userErr && (
        <div style={{ background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10, color: "#f87171", fontSize: "0.875rem", padding: "0.75rem 1rem", fontWeight: 500 }}>
          Fehler: {q.userErr}
        </div>
      )}

      {/* ── Workspace ── */}
      <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
        <div style={{ padding: "1rem 1.375rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Shield size={14} color="#818cf8" />
          <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#fafafa" }}>Workspace</span>
        </div>
        <div style={{ padding: "1.125rem 1.375rem", display: "grid", gridTemplateColumns: "140px 1fr", rowGap: "0.625rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.8125rem", color: "#52525b", fontWeight: 600 }}>Name</span>
          <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "#fafafa" }}>{m.workspaces.name}</span>
          <span style={{ fontSize: "0.8125rem", color: "#52525b", fontWeight: 600 }}>Invite-Code</span>
          <code style={{ fontSize: "0.875rem", fontWeight: 700, color: "#818cf8", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 6, padding: "2px 8px", letterSpacing: "0.08em" }}>{m.workspaces.invite_code}</code>
          <span style={{ fontSize: "0.8125rem", color: "#52525b", fontWeight: 600 }}>Deine Rolle</span>
          <span style={{ display: "inline-flex", width: "fit-content", padding: "2px 10px", borderRadius: 99, background: isOwner ? "rgba(99,102,241,0.12)" : "rgba(113,113,122,0.12)", border: `1px solid ${isOwner ? "rgba(99,102,241,0.3)" : "#3f3f46"}`, color: isOwner ? "#818cf8" : "#71717a", fontSize: "0.75rem", fontWeight: 700 }}>
            {isOwner ? "Owner" : "Member"}
          </span>
        </div>
      </div>

      {/* ── Nutzer ── */}
      {isOwner && (
        <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          <div style={{ padding: "1rem 1.375rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Users size={14} color="#a78bfa" />
            <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#fafafa" }}>Team ({users.length})</span>
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
                      <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "#fafafa" }}>{u.username}</span>
                      {isMe && <span style={{ fontSize: "0.6875rem", color: "#52525b", background: "#27272a", borderRadius: 99, padding: "1px 6px" }}>Du</span>}
                    </div>
                    <span style={{ fontSize: "0.75rem", color: u.role === "owner" ? "#818cf8" : "#52525b", fontWeight: 600 }}>{u.role === "owner" ? "Owner" : "Mitglied"}</span>
                  </div>
                  {/* Delete (not self) */}
                  {!isMe && (
                    <form action={deleteUserForm}>
                      <input type="hidden" name="user_id" value={u.user_id} />
                      <button
                        type="submit"
                        onClick={(e) => { if (!confirm(`"${u.username}" wirklich löschen? Alle Daten bleiben erhalten.`)) e.preventDefault(); }}
                        title="Nutzer löschen"
                        style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: "#f87171", display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", fontWeight: 600, transition: "all 0.12s" }}
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
          <div style={{ borderTop: "1px solid var(--border)", padding: "1.125rem 1.375rem", background: "rgba(99,102,241,0.02)" }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#52525b", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.875rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <Plus size={12} /> Neuen Nutzer anlegen
            </div>
            <form action={createUserForm} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#52525b", marginBottom: "0.3rem" }}>Benutzername</label>
                  <input
                    name="username"
                    required
                    placeholder="z. B. Thomas"
                    style={{ width: "100%", background: "#09090b", border: "1px solid #27272a", borderRadius: 8, padding: "0.4rem 0.625rem", fontSize: "0.875rem", color: "#fafafa", outline: "none", boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#52525b", marginBottom: "0.3rem" }}>Passwort</label>
                  <input
                    name="password"
                    type="text"
                    required
                    placeholder="Frei wählbar"
                    style={{ width: "100%", background: "#09090b", border: "1px solid #27272a", borderRadius: 8, padding: "0.4rem 0.625rem", fontSize: "0.875rem", color: "#fafafa", outline: "none", boxSizing: "border-box" }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#52525b", marginBottom: "0.3rem" }}>Rolle</label>
                  <select name="role" defaultValue="member" style={{ background: "#09090b", border: "1px solid #27272a", borderRadius: 8, padding: "0.4rem 0.625rem", fontSize: "0.875rem", color: "#fafafa", outline: "none" }}>
                    <option value="member">Member</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>
                <button type="submit" style={{ marginTop: "1.25rem", display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.5rem 1rem", borderRadius: 9, border: "none", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "white", fontWeight: 700, fontSize: "0.875rem", cursor: "pointer", boxShadow: "0 2px 8px rgba(99,102,241,0.3)", whiteSpace: "nowrap" }}>
                  <Plus size={14} /> Anlegen
                </button>
              </div>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "#3f3f46" }}>
                Nutzer kann sich sofort unter <strong style={{ color: "#52525b" }}>/login</strong> anmelden — kein Invite-Code nötig.
              </p>
            </form>
          </div>
        </div>
      )}

      {/* ── Passwort-Info ── */}
      <div style={{ background: "rgba(251,191,36,0.04)", border: "1px solid rgba(251,191,36,0.15)", borderRadius: "var(--radius-lg)", padding: "1rem 1.375rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.375rem" }}>
          <UserCheck size={14} color="#fbbf24" />
          <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#fbbf24" }}>Passwort ändern</span>
        </div>
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "#71717a", lineHeight: 1.6 }}>
          Um ein Passwort zu ändern: Nutzer löschen und neu anlegen. Die Pitch-Daten (Listen + Kontakte) bleiben dabei vollständig erhalten.
        </p>
      </div>

    </div>
  );
}
