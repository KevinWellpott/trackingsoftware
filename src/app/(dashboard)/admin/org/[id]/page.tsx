import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRightLeft, Plus, Trash2, Users } from "lucide-react";
import { getAccessContext } from "@/lib/access";
import {
  createUserInOrgForm,
  listOrganizations,
  listOrgMembers,
  listUsersOutsideOrg,
  setActiveOrgForm,
} from "@/app/actions/platform";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { FormSelect } from "@/components/ui/Select";
import { MoveUserButton, PullUserPanel } from "@/components/admin/MoveUserButton";
import { DeleteOrgButton } from "@/components/admin/DeleteOrgButton";
import { ownerColor } from "@/lib/ownerColor";

// Mitglieder EINER Organisation. Bewusst schlank: Umbenennen, Löschen und
// Ziele laufen weiter ueber /settings — dorthin kommt man mit einem
// Org-Wechsel, und dann gilt dort automatisch diese Organisation.

export const dynamic = "force-dynamic";

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

export default async function AdminOrgPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ err?: string; ok?: string }>;
}) {
  const access = await getAccessContext();
  if (!access?.is_platform_admin) redirect("/");

  const { id } = await params;
  const q = await searchParams;
  const [{ organization, members, error }, { organizations }, { users: outsideUsers }] =
    await Promise.all([listOrgMembers(id), listOrganizations(), listUsersOutsideOrg(id)]);
  if (!organization) redirect("/admin");

  const isActive = organization.id === access.workspace_id;
  // Zielorganisationen fuer einen Umzug: alle ausser der aktuellen.
  const moveTargets = organizations
    .filter((o) => o.id !== organization.id)
    .map((o) => ({ id: o.id, name: o.name }));

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <div>
        <Link
          href="/admin"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            fontSize: "var(--fs-xs)",
            color: "var(--text-muted)",
            textDecoration: "none",
            marginBottom: "var(--sp-5)",
          }}
        >
          <ArrowLeft size={13} /> Alle Organisationen
        </Link>
        <PageHeader
          eyebrow="Organisation"
          title={organization.name}
          meta={`${members.length} ${members.length === 1 ? "Mitglied" : "Mitglieder"}`}
        />
      </div>

      {q.ok && (
        <div
          role="status"
          style={{ ...FEEDBACK_BASE, background: "var(--success-bg)", borderLeft: "2px solid var(--success)", color: "var(--success-fg)" }}
        >
          Nutzer angelegt.
        </div>
      )}
      {(q.err || error) && (
        <div
          role="alert"
          style={{ ...FEEDBACK_BASE, background: "var(--danger-bg)", borderLeft: "2px solid var(--danger)", color: "var(--danger-fg)" }}
        >
          {q.err ?? error}
        </div>
      )}

      {!isActive && (
        <form action={setActiveOrgForm}>
          <input type="hidden" name="workspace_id" value={organization.id} />
          <Button type="submit" variant="secondary" size="sm">
            In diese Organisation wechseln
          </Button>
        </form>
      )}

      {/* ── Mitglieder ── */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={SECTION_HEAD}>
          <Users size={16} color="var(--text-muted)" />
          <span style={SECTION_TITLE}>Mitglieder</span>
          <span className="count-pill" style={{ marginLeft: "auto" }}>{members.length}</span>
        </div>

        {members.length === 0 ? (
          <p style={{ margin: 0, padding: "var(--sp-7) var(--sp-8)", fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
            Noch keine Mitglieder. Lege unten den ersten Nutzer an — er kann sich
            danach sofort unter /login anmelden.
          </p>
        ) : (
          <div>
            {members.map((u, i) => {
              const avatar = ownerColor(u.username);
              return (
                <div
                  key={u.user_id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "var(--sp-6)",
                    padding: "var(--sp-6) var(--sp-8)",
                    borderBottom: i < members.length - 1 ? "1px solid var(--border-subtle)" : "none",
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "var(--r-full)",
                      background: avatar.bg,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 600,
                      color: avatar.fg,
                      fontSize: "var(--fs-sm)",
                      flexShrink: 0,
                    }}
                  >
                    {u.username[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontSize: "var(--fs-base)", fontWeight: 500, color: "var(--text-primary)" }}>
                      {u.username}
                    </div>
                    <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
                      {u.role === "owner" ? "Owner" : "Mitglied"} ·{" "}
                      {u.data_scope === "own" ? "Nur eigene Daten" : "Alle Daten"}
                    </span>
                  </div>
                  <MoveUserButton
                    userId={u.user_id}
                    username={u.username}
                    targets={moveTargets}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* ── Bestehenden Nutzer hierher holen ── */}
        {/* Bewusst VOR dem Anlegen-Formular: wer eine Organisation frisch
            anlegt, will meistens jemanden umziehen, nicht neu erfinden. */}
        <div style={{ borderTop: "1px solid var(--border-default)", padding: "var(--sp-7) var(--sp-8)" }}>
          <div className="eyebrow eyebrow-muted" style={{ marginBottom: "var(--sp-6)", display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
            <ArrowRightLeft size={12} /> Bestehenden Nutzer hierher holen
          </div>
          <PullUserPanel
            workspaceId={organization.id}
            workspaceName={organization.name}
            candidates={outsideUsers}
          />
        </div>

        {/* ── Nutzer anlegen ── */}
        <div style={{ borderTop: "1px solid var(--border-default)", padding: "var(--sp-7) var(--sp-8)", background: "var(--surface-1)" }}>
          <div className="eyebrow eyebrow-muted" style={{ marginBottom: "var(--sp-6)", display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
            <Plus size={12} /> Neuen Nutzer anlegen
          </div>
          <form action={createUserInOrgForm} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
            <input type="hidden" name="workspace_id" value={organization.id} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-6)" }}>
              <div>
                <label htmlFor="org-username" style={FIELD_LABEL}>Benutzername</label>
                <input id="org-username" name="username" required placeholder="z. B. Thomas" className="ui-input" />
              </div>
              <div>
                <label htmlFor="org-password" style={FIELD_LABEL}>Passwort</label>
                <input id="org-password" name="password" type="text" required placeholder="Frei wählbar" className="ui-input" />
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--sp-6)", flexWrap: "wrap" }}>
              <div>
                <label htmlFor="org-role" style={FIELD_LABEL}>Rolle</label>
                <FormSelect
                  id="org-role"
                  name="role"
                  defaultValue="owner"
                  ariaLabel="Rolle"
                  options={[
                    { value: "owner", label: "Owner" },
                    { value: "member", label: "Member" },
                  ]}
                  triggerStyle={{ width: 176 }}
                />
              </div>
              <div>
                <label htmlFor="org-scope" style={FIELD_LABEL}>Datensicht</label>
                <FormSelect
                  id="org-scope"
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
              <button type="submit" className="btn-primary">
                <Plus size={15} /> Anlegen
              </button>
            </div>
            <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-subtle)" }}>
              Benutzernamen gelten <strong style={{ color: "var(--text-muted)" }}>organisationsübergreifend</strong> —
              die Login-Adresse wird aus ihnen abgeleitet. Der erste Nutzer einer
              Kunden-Organisation sollte <strong style={{ color: "var(--text-muted)" }}>Owner</strong> sein,
              sonst kann dort niemand weitere Nutzer anlegen.
            </p>
          </form>
        </div>
      </div>

      {/* ── Gefahrenzone ── */}
      {/* Bewusst als eigene Karte ganz unten und optisch abgesetzt: Loeschen
          ist irreversibel und darf nicht neben harmlosen Aktionen stehen. */}
      <div
        className="card"
        style={{ overflow: "hidden", borderColor: "var(--danger)" }}
      >
        <div style={{ ...SECTION_HEAD, borderBottomColor: "var(--danger)" }}>
          <Trash2 size={16} color="var(--danger-fg)" />
          <span style={{ ...SECTION_TITLE, color: "var(--danger-fg)" }}>Gefahrenzone</span>
        </div>
        <div style={{ padding: "var(--sp-7) var(--sp-8)", display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
          <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-secondary)", lineHeight: 1.6 }}>
            Beim Löschen verschwindet die Organisation mitsamt allen Listen,
            Kontakten, Telefon-Leads und Terminen. Das lässt sich nicht
            rückgängig machen.
          </p>
          <DeleteOrgButton
            workspaceId={organization.id}
            workspaceName={organization.name}
            memberCount={members.length}
            isHome={organization.id === access.home_workspace_id}
          />
        </div>
      </div>
    </div>
  );
}
