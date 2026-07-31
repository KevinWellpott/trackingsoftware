import { redirect } from "next/navigation";
import Link from "next/link";
import { Building2, Plus, ShieldCheck } from "lucide-react";
import { getAccessContext } from "@/lib/access";
import {
  createOrganizationForm,
  listOrganizations,
  renameOrganizationForm,
  setActiveOrgForm,
} from "@/app/actions/platform";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";

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
  const { organizations, error } = await listOrganizations();

  const dateFmt = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
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
      {(q.err || error) && (
        <div
          role="alert"
          style={{
            ...FEEDBACK_BASE,
            background: "var(--danger-bg)",
            borderLeft: "2px solid var(--danger)",
            color: "var(--danger-fg)",
          }}
        >
          {q.err ?? error}
        </div>
      )}

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
                      <div style={{ display: "flex", gap: "var(--sp-4)", justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
                        <form action={renameOrganizationForm} style={{ display: "flex", gap: "var(--sp-3)", alignItems: "center" }}>
                          <input type="hidden" name="workspace_id" value={o.id} />
                          <input
                            name="name"
                            defaultValue={o.name}
                            aria-label={`Name von ${o.name}`}
                            className="ui-input"
                            style={{ width: 160 }}
                          />
                          <Button type="submit" variant="ghost" size="sm">
                            Umbenennen
                          </Button>
                        </form>
                        {!isActive && (
                          <form action={setActiveOrgForm}>
                            <input type="hidden" name="workspace_id" value={o.id} />
                            <Button type="submit" variant="secondary" size="sm">
                              Wechseln
                            </Button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Neue Organisation ── */}
        <div style={{ borderTop: "1px solid var(--border-default)", padding: "var(--sp-7) var(--sp-8)", background: "var(--surface-1)" }}>
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
            <button type="submit" className="btn-primary">
              <Plus size={15} /> Anlegen
            </button>
          </form>
          <p style={{ margin: "var(--sp-5) 0 0", fontSize: "0.75rem", color: "var(--text-subtle)" }}>
            Die Organisation startet leer und ohne Mitglieder. Nutzer legst du danach
            unter <strong style={{ color: "var(--text-muted)" }}>Verwalten</strong> an.
            Du selbst wirst bewusst <strong style={{ color: "var(--text-muted)" }}>kein</strong> Mitglied —
            sonst tauchtest du im Team-Dashboard des Kunden auf.
          </p>
        </div>
      </div>

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
