import Link from "next/link";
import { Building2, UserX, Users } from "lucide-react";
import type { PlatformUserGroup } from "@/app/actions/platform";
import { PlatformAdminToggle } from "@/components/admin/PlatformAdminToggle";
import { ownerColor } from "@/lib/ownerColor";

// Plattformweite Nutzeruebersicht, nach Organisation gruppiert.
//
// Server-Komponente: die Zeilen kommen fertig vom Server, nur der
// Rechte-Schalter ist eine Client-Insel. Damit landet nichts im Browser, was
// nicht ohnehin in der Tabelle steht — insbesondere kein Auth-Objekt.
//
// Bewusst auf /admin und nicht in /settings: die Einstellungen zeigen immer
// nur die aktive Organisation. Dort haette diese Liste hinter dem Owner-Gate
// gestanden, und ein Kunden-Owner saehe fremde Mandanten.

// Berlin fest verdrahtet, nicht Serverzeit: Vercel laeuft in UTC, lokal steht
// Berlin — sonst zeigte dieselbe Anmeldung je nach Umgebung eine andere Uhrzeit
// (vgl. docs §6).
const LOGIN_FMT = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

const GROUP_HEAD: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-4)",
  padding: "var(--sp-5) var(--sp-5)",
  background: "var(--surface-1)",
  borderTop: "1px solid var(--border-default)",
  borderBottom: "1px solid var(--border-subtle)",
};

export function PlatformUsersCard({
  groups,
  currentUserId,
  activeWorkspaceId,
}: {
  groups: PlatformUserGroup[];
  currentUserId: string;
  activeWorkspaceId: string;
}) {
  const total = groups.reduce((n, g) => n + g.users.length, 0);

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-4)",
          padding: "var(--sp-6) var(--sp-8)",
          borderBottom: "1px solid var(--border-default)",
        }}
      >
        <Users size={16} color="var(--text-muted)" />
        <span
          style={{
            fontSize: "var(--fs-md)",
            fontWeight: 600,
            letterSpacing: "var(--ls-tight)",
            color: "var(--text-primary)",
          }}
        >
          Alle Nutzer
        </span>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
          nach Organisation
        </span>
        <span className="count-pill" style={{ marginLeft: "auto" }}>{total}</span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Nutzer</th>
              <th>Rolle</th>
              <th>Datensicht</th>
              <th>Letzter Login</th>
              <th style={{ textAlign: "right" }}>Plattform-Rechte</th>
            </tr>
          </thead>

          {groups.map((group) => (
            <tbody key={group.workspace_id ?? "__orphans"}>
              <tr>
                <td colSpan={5} style={{ padding: 0 }}>
                  <div style={GROUP_HEAD}>
                    {group.workspace_id ? (
                      <Building2 size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                    ) : (
                      <UserX size={14} color="var(--warning-fg)" style={{ flexShrink: 0 }} />
                    )}
                    {group.workspace_id ? (
                      <Link
                        href={`/admin/org/${group.workspace_id}`}
                        style={{
                          fontSize: "var(--fs-sm)",
                          fontWeight: 500,
                          color: "var(--text-primary)",
                          textDecoration: "none",
                        }}
                      >
                        {group.workspace}
                      </Link>
                    ) : (
                      <span style={{ fontSize: "var(--fs-sm)", fontWeight: 500, color: "var(--warning-fg)" }}>
                        {group.workspace}
                      </span>
                    )}
                    {group.workspace_id === activeWorkspaceId && (
                      <span className="badge badge-amber">aktiv</span>
                    )}
                    <span style={{ marginLeft: "auto", fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
                      {group.users.length} Nutzer
                    </span>
                  </div>
                </td>
              </tr>

              {group.users.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: "var(--text-subtle)", fontSize: "var(--fs-xs)" }}>
                    Keine Nutzer — diese Organisation lässt sich löschen.
                  </td>
                </tr>
              )}

              {group.users.map((u) => {
                const name = u.username ?? "Konto ohne Profil";
                const avatar = ownerColor(name);
                const isMe = u.user_id === currentUserId;
                return (
                  <tr key={u.user_id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
                        <span
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: "var(--r-full)",
                            background: avatar.bg,
                            color: avatar.fg,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "var(--fs-2xs)",
                            fontWeight: 600,
                            flexShrink: 0,
                          }}
                        >
                          {name[0]?.toUpperCase() ?? "?"}
                        </span>
                        <span
                          style={{
                            fontWeight: 500,
                            color: u.username ? "var(--text-primary)" : "var(--text-muted)",
                            fontStyle: u.username ? undefined : "italic",
                          }}
                        >
                          {name}
                        </span>
                        {isMe && <span className="badge badge-gray">Du</span>}
                      </div>
                    </td>
                    <td style={{ fontSize: "var(--fs-sm)" }}>
                      {u.role === "owner" ? (
                        <span className="badge badge-indigo">Owner</span>
                      ) : u.role === "member" ? (
                        <span className="badge badge-gray">Mitglied</span>
                      ) : (
                        <span style={{ color: "var(--text-subtle)" }}>—</span>
                      )}
                    </td>
                    <td style={{ fontSize: "var(--fs-sm)", color: "var(--text-secondary)" }}>
                      {u.data_scope === "own"
                        ? "Nur eigene Daten"
                        : u.data_scope === "workspace"
                          ? "Alle Daten"
                          : "—"}
                    </td>
                    <td style={{ fontSize: "var(--fs-sm)", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                      {u.last_sign_in_at ? (
                        LOGIN_FMT.format(new Date(u.last_sign_in_at))
                      ) : (
                        <span style={{ color: "var(--text-subtle)" }}>nie angemeldet</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        {/* Ohne Profil gibt es keinen Namen, unter dem der
                            Eintrag spaeter wiedererkennbar waere — die
                            Server-Action lehnt solche Konten ohnehin ab. */}
                        {u.username ? (
                          <PlatformAdminToggle
                            userId={u.user_id}
                            username={u.username}
                            isAdmin={u.is_platform_admin}
                            isSelf={isMe}
                          />
                        ) : (
                          <span style={{ fontSize: "var(--fs-2xs)", color: "var(--text-subtle)" }}>
                            kein Profil
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>

      <div
        style={{
          borderTop: "1px solid var(--border-default)",
          padding: "var(--sp-5) var(--sp-8)",
          background: "var(--surface-1)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-3)",
        }}
      >
        <p style={{ margin: 0, fontSize: "var(--fs-xs)", color: "var(--text-muted)", lineHeight: 1.6 }}>
          Ein <strong style={{ color: "var(--text-secondary)" }}>Plattform-Admin</strong> steht
          oberhalb der Organisationen: er sieht und bearbeitet jede von ihnen org-weit,
          eine Einschränkung auf &bdquo;nur eigene Daten&ldquo; gilt für ihn nicht mehr. Er wird
          dabei in keiner Kunden-Organisation Mitglied und taucht deshalb weder im
          Team-Dashboard noch in deren Datensicht-Auswahl auf.
        </p>
        <p style={{ margin: 0, fontSize: "var(--fs-xs)", color: "var(--text-muted)", lineHeight: 1.6 }}>
          Rolle und Datensicht einer Person änderst du in den{" "}
          <Link href="/settings" style={{ color: "var(--orange-300)", textDecoration: "none" }}>
            Einstellungen
          </Link>{" "}
          der jeweiligen Organisation — dafür vorher oben dorthin wechseln.
        </p>
      </div>
    </div>
  );
}
