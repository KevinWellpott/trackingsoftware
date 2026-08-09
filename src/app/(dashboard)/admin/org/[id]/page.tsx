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
// Ein Raster fuer alle Formularfelder: Text- und Auswahlfelder stehen damit in
// denselben Spalten und fluchten an derselben Kante — vorher gaben feste
// Trigger-Breiten (176/208 px) den Selects eine eigene, zufaellige Rasterung.
// auto-fit klappt das Raster auf schmalen Karten von selbst einspaltig.
const FIELD_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: "var(--sp-6)",
};
// Danger-Rahmen bei 40 % (COMPONENTS.md §15, wie in ui/DangerZone): die
// Gefahrenzone soll klar abgesetzt sein, aber nicht schreien. Voll deckendes
// --danger zog vorher eine Alarmlinie um die halbe Seite.
const DANGER_BORDER = "color-mix(in srgb, var(--danger) 40%, transparent)";

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
          // Der Org-Wechsel ist die Aktion DIESER Seite und gehoert damit in den
          // Aktionsbereich des Seitenkopfs — als loser Knopf zwischen Meldung und
          // erster Karte hing er vorher ohne Bezug im Raum.
          actions={
            isActive ? undefined : (
              <form action={setActiveOrgForm}>
                <input type="hidden" name="workspace_id" value={organization.id} />
                <Button type="submit" variant="secondary">
                  In diese Organisation wechseln
                </Button>
              </form>
            )
          }
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
                    // Mittig statt oben: Avatar (36 px), Namensblock und
                    // Zeilenaktion sind unterschiedlich hoch — oben gebunden
                    // saessen sie sichtbar versetzt zueinander.
                    alignItems: "center",
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
            anlegt, will meistens jemanden umziehen, nicht neu erfinden.
            Beide Formularbloecke liegen auf --surface-1: die Karte trennt so
            Bestand (oben) von Eingabe (unten) — vorher trug nur der zweite
            Block die Tiefstufe und wirkte wie versehentlich eingefaerbt. */}
        <div
          style={{
            borderTop: "1px solid var(--border-default)",
            padding: "var(--sp-7) var(--sp-8)",
            background: "var(--surface-1)",
          }}
        >
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
        <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "var(--sp-7) var(--sp-8)", background: "var(--surface-1)" }}>
          <div className="eyebrow eyebrow-muted" style={{ marginBottom: "var(--sp-6)", display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
            <Plus size={12} /> Neuen Nutzer anlegen
          </div>
          <form action={createUserInOrgForm} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
            <input type="hidden" name="workspace_id" value={organization.id} />
            <div style={FIELD_GRID}>
              <div>
                <label htmlFor="org-username" style={FIELD_LABEL}>Benutzername</label>
                <input id="org-username" name="username" required placeholder="z. B. Thomas" className="ui-input" />
              </div>
              <div>
                <label htmlFor="org-password" style={FIELD_LABEL}>Passwort</label>
                <input id="org-password" name="password" type="text" required placeholder="Frei wählbar" className="ui-input" />
              </div>
            </div>
            <div style={FIELD_GRID}>
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
                />
              </div>
            </div>
            <p style={{ margin: 0, fontSize: "var(--fs-xs)", color: "var(--text-subtle)", lineHeight: "var(--lh-base)" }}>
              Benutzernamen gelten <strong style={{ color: "var(--text-muted)" }}>organisationsübergreifend</strong> —
              die Login-Adresse wird aus ihnen abgeleitet. Der erste Nutzer einer
              Kunden-Organisation sollte <strong style={{ color: "var(--text-muted)" }}>Owner</strong> sein,
              sonst kann dort niemand weitere Nutzer anlegen.
            </p>
            {/* Der Absende-Knopf steht in einer eigenen Fusszeile statt in der
                Feldzeile: als rohe .btn-primary war er 40 px hoch neben 32 px
                hohen Feldern und ueberragte deren Zeile. Rechtsbuendig wie in
                jedem Dialog-Footer — die Aktion schliesst das Formular ab. */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button type="submit" variant="primary" icon={<Plus size={15} />}>
                Anlegen
              </Button>
            </div>
          </form>
        </div>
      </div>

      {/* ── Gefahrenzone ── */}
      {/* Bewusst als eigene Karte ganz unten und optisch abgesetzt: Loeschen
          ist irreversibel und darf nicht neben harmlosen Aktionen stehen. */}
      <div
        className="card"
        style={{ overflow: "hidden", borderColor: DANGER_BORDER }}
      >
        <div style={{ ...SECTION_HEAD, borderBottomColor: DANGER_BORDER }}>
          <Trash2 size={16} color="var(--danger-fg)" />
          <span style={{ ...SECTION_TITLE, color: "var(--danger-fg)" }}>Gefahrenzone</span>
        </div>
        {/* Erklaerung links, Knopf rechts — dieselbe Anordnung wie in
            ui/DangerZone, damit jede Gefahrenzone der App gleich aussieht.
            In der frueheren Spalte (flexDirection: column) streckte
            align-items: stretch den Loesch-Knopf ueber die volle Kartenbreite;
            eine randlose Pille quer durch die Karte las sich wie ein Banner,
            nicht wie eine Schaltflaeche. */}
        <div
          style={{
            padding: "var(--sp-7) var(--sp-8)",
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-7)",
            flexWrap: "wrap",
          }}
        >
          <p
            style={{
              flex: "1 1 280px",
              minWidth: 0,
              margin: 0,
              fontSize: "var(--fs-sm)",
              color: "var(--text-muted)",
              lineHeight: "var(--lh-base)",
            }}
          >
            Beim Löschen verschwindet die Organisation mitsamt allen Listen,
            Kontakten, Telefon-Leads und Terminen. Das lässt sich nicht
            rückgängig machen.
          </p>
          {/* Kein membersHref: die Mitgliederliste steht auf dieser Seite. */}
          <DeleteOrgButton
            workspaceId={organization.id}
            workspaceName={organization.name}
            memberCount={members.length}
            isHome={organization.id === access.home_workspace_id}
            afterDeleteHref="/admin"
            size="lg"
          />
        </div>
      </div>
    </div>
  );
}
