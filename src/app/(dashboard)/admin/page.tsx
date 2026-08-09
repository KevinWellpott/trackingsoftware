import { redirect } from "next/navigation";
import Link from "next/link";
import { Building2, Plus, ShieldCheck } from "lucide-react";
import { getAccessContext } from "@/lib/access";
import {
  createOrganizationForm,
  listOrganizations,
  listPlatformUsers,
} from "@/app/actions/platform";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { OrgRowActions } from "@/components/admin/OrgRowActions";
import { PlatformUsersCard } from "@/components/admin/PlatformUsersCard";

// Plattform-Ebene: alle Organisationen. Nur fuer Plattform-Admins erreichbar
// (Kevin, Simon). Der Gate-Pfad ist derselbe wie bei /team — Pruefung im
// Server Component, kein Verlass auf verstecktes Nav.

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

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; ok?: string }>;
}) {
  const access = await getAccessContext();
  if (!access?.is_platform_admin) redirect("/");

  const q = await searchParams;
  const [{ organizations, error }, { groups, error: usersError }] = await Promise.all([
    listOrganizations(),
    listPlatformUsers(),
  ]);

  const dateFmt = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <PageHeader
        eyebrow="Plattform"
        title="Organisationen"
        meta="Kunden-Mandanten anlegen und verwalten"
      />

      {q.ok && (
        <div
          role="status"
          style={{
            ...FEEDBACK_BASE,
            background: "var(--success-bg)",
            borderLeft: "2px solid var(--success)",
            color: "var(--success-fg)",
          }}
        >
          {q.ok === "org" ? "Organisation angelegt." : "Organisation umbenannt."}
        </div>
      )}
      {(q.err || error || usersError) && (
        <div
          role="alert"
          style={{
            ...FEEDBACK_BASE,
            background: "var(--danger-bg)",
            borderLeft: "2px solid var(--danger)",
            color: "var(--danger-fg)",
          }}
        >
          {q.err ?? error ?? usersError}
        </div>
      )}

      {/* Kurzanleitung: der Ablauf ist zweistufig und ohne Hinweis nicht
          selbsterklaerend — man legt erst eine leere Organisation an und holt
          die Person danach hinein. */}
      <ol
        style={{
          margin: 0,
          padding: "var(--sp-6) var(--sp-7)",
          listStyle: "none",
          counterReset: "step",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-4)",
          borderRadius: "var(--r-md)",
          background: "var(--surface-1)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        {[
          "Organisation anlegen — unten im Formular. Sie startet leer, ohne Mitglieder.",
          "Auf den Namen der neuen Organisation klicken.",
          "Dort unter „Bestehenden Nutzer hierher holen“ die Person wählen, Vorschau ansehen, verschieben. Ihre Listen, Kontakte und Termine ziehen mit.",
        ].map((text, i) => (
          <li key={i} style={{ display: "flex", gap: "var(--sp-4)", alignItems: "flex-start" }}>
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: "var(--r-full)",
                background: "var(--accent-muted)",
                color: "var(--orange-300)",
                fontSize: "var(--fs-2xs)",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {i + 1}
            </span>
            <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-secondary)", lineHeight: 1.55 }}>
              {text}
            </span>
          </li>
        ))}
      </ol>

      {/* ── Alle Organisationen ── */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={SECTION_HEAD}>
          <Building2 size={16} color="var(--text-muted)" />
          <span style={SECTION_TITLE}>Alle Organisationen</span>
          <span className="count-pill" style={{ marginLeft: "auto" }}>{organizations.length}</span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Organisation</th>
                <th>Mitglieder</th>
                <th>Angelegt</th>
                <th style={{ textAlign: "right" }}>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {organizations.map((o) => {
                const isActive = o.id === access.workspace_id;
                const isHome = o.id === access.home_workspace_id;
                return (
                  <tr key={o.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
                        <Link
                          href={`/admin/org/${o.id}`}
                          style={{
                            fontWeight: 500,
                            color: "var(--text-primary)",
                            textDecoration: "none",
                          }}
                        >
                          {o.name}
                        </Link>
                        {isHome && <span className="badge badge-gray">eigene</span>}
                        {isActive && <span className="badge badge-amber">aktiv</span>}
                      </div>
                    </td>
                    <td>{o.member_count}</td>
                    <td style={{ color: "var(--text-muted)" }}>
                      {dateFmt.format(new Date(o.created_at))}
                    </td>
                    <td>
                      {/* Umbenennen, Wechseln und Loeschen liegen als
                          eingeblendete Icons in der Zeile. Vorher stand hier in
                          JEDER Zeile ein Namensfeld plus drei beschriftete
                          Knoepfe — die Aktionsspalte war breiter als die Daten,
                          die sie begleitet. Loeschen sitzt bewusst hier und
                          nicht erst eine Ebene tiefer: Wer aufraeumen will,
                          sucht die Organisation in dieser Tabelle. */}
                      <OrgRowActions
                        workspaceId={o.id}
                        workspaceName={o.name}
                        memberCount={o.member_count}
                        isActive={isActive}
                        isHome={isHome}
                        membersHref={`/admin/org/${o.id}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Neue Organisation ── */}
        {/* Die id ist das Ziel des Sidebar-Eintrags „Neue Organisation";
            scrollMarginTop haelt die Ueberschrift unter der Topbar frei. */}
        <div
          id="neue-organisation"
          style={{
            borderTop: "1px solid var(--border-default)",
            padding: "var(--sp-7) var(--sp-8)",
            background: "var(--surface-1)",
            scrollMarginTop: "var(--h-topbar)",
          }}
        >
          <div className="eyebrow eyebrow-muted" style={{ marginBottom: "var(--sp-6)", display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
            <Plus size={12} /> Neue Organisation anlegen
          </div>
          <form action={createOrganizationForm} style={{ display: "flex", gap: "var(--sp-6)", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label htmlFor="org-name" style={FIELD_LABEL}>Name</label>
              <input
                id="org-name"
                name="name"
                required
                placeholder="z. B. Müller GmbH"
                className="ui-input"
              />
            </div>
            {/* Button-Komponente statt roher .btn-primary-Klasse: die war
                40 px hoch und ueberragte das 32 px hohe Namensfeld in
                derselben Zeile. In der Feldzeile gilt die Toolbar-Hoehe
                --h-control (COMPONENTS.md §2.1). */}
            <Button type="submit" variant="primary" icon={<Plus size={15} />}>
              Anlegen
            </Button>
          </form>
          <p style={{ margin: "var(--sp-5) 0 0", fontSize: "var(--fs-xs)", color: "var(--text-subtle)", lineHeight: "var(--lh-base)" }}>
            Die Organisation startet leer. Anschließend auf ihren Namen in der
            Tabelle klicken — dort holst du bestehende Nutzer herein oder legst
            neue an. Du selbst wirst bewusst{" "}
            <strong style={{ color: "var(--text-muted)" }}>kein</strong> Mitglied —
            sonst tauchtest du im Team-Dashboard des Kunden auf.
          </p>
        </div>
      </div>

      {/* ── Alle Nutzer der Plattform ── */}
      {/* Bewusst hier statt in /settings: dort saehe ein Kunden-Owner fremde
          Mandanten. Diese Liste haengt an is_platform_admin, nicht an der
          Owner-Rolle einer Organisation. */}
      <PlatformUsersCard
        groups={groups}
        currentUserId={access.user.id}
        activeWorkspaceId={access.workspace_id}
      />

      <div
        style={{
          display: "flex",
          gap: "var(--sp-4)",
          alignItems: "flex-start",
          padding: "var(--sp-5) var(--sp-6)",
          borderRadius: "var(--r-md)",
          background: "var(--surface-1)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <ShieldCheck size={15} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: 2 }} />
        <p style={{ margin: 0, fontSize: "var(--fs-xs)", color: "var(--text-muted)", lineHeight: 1.6 }}>
          Als Plattform-Admin siehst du jede Organisation, bist aber in keiner
          Kunden-Organisation Mitglied. Nach einem Wechsel verhält sich die
          gesamte App wie für einen Owner dieser Organisation — inklusive
          Schreibrechten. Ein roter Banner zeigt dir dann durchgehend an, wo du
          gerade bist.
        </p>
      </div>
    </div>
  );
}
