"use client";

import { setDataViewForm, signOut } from "@/app/actions/workspace";
import { setActiveOrgForm } from "@/app/actions/platform";
import { createListForm } from "@/app/actions/lists";
import { SearchTrigger } from "@/components/search/SearchDialog";
import { ViewTree } from "@/components/listen/ViewTree";
import type { ViewNode } from "@/lib/listViews";
import {
  BarChart2,
  Building2,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  Download,
  LineChart,
  LogOut,
  Phone,
  Plus,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ManualAppointmentModal } from "@/components/appointment/ManualAppointmentModal";
import { ownerInitials } from "@/lib/ownerColor";

// Sidebar im Ember-Glass-System (COMPONENTS.md §10.1):
// 248px, Flaeche surface-2 (SOLID — kein Glas im Body), rechte Kante als
// 1px-Linie. Nav-Item 36px mit 2px-Orange-Rail im Aktiv-Zustand.
//
// FARBREGEL DIESER DATEI: ausschliesslich Graustufen + Orange. Keine Kanal-,
// Owner- oder Semantikfarben — die Navigation ist die ruhigste Flaeche der
// App, Orange markiert allein „hier bist du" bzw. „das ist aktiv".

/** Ab wie vielen Listen die Sidebar auf die Uebersichtsseite verweist. */
const SIDEBAR_LIST_CAP = 7;

type SidebarList = { id: string; name: string; owner_name: string | null };
type SidebarPhoneList = {
  id: string;
  name: string;
  owner_name: string | null;
  list_kind: "akquise" | "rueckruf" | "nicht_erreicht";
};
type DataScope = "workspace" | "own";
type DataViewUser = { user_id: string; username: string; data_scope: DataScope };
type DataViewState = {
  canSwitch: boolean;
  activeUserId: string | null;
  activeLabel: string;
  users: DataViewUser[];
};

/**
 * Organisations-Umschalter — nur fuer Plattform-Admins befuellt. Die aeussere
 * Grenze: waehrend die Datensicht innerhalb EINER Organisation die Person
 * wechselt, wechselt dies die Organisation selbst.
 */
type OrgSwitchState = {
  activeId: string;
  activeName: string;
  homeId: string | null;
  isForeign: boolean;
  orgs: { id: string; name: string }[];
};

type Props = {
  workspaceName: string;
  username: string;
  workspaceId: string;
  lists: SidebarList[];
  /** Smart-View-Baum unter der LinkedIn-Sektion. */
  viewTree?: ViewNode[];
  phoneLists?: SidebarPhoneList[];
  dataScope?: DataScope;
  dataView?: DataViewState;
  orgSwitch?: OrgSwitchState;
  onClose?: () => void;
};

// LinkedIn-Glyphe (lucide fuehrt keine Brand-Icons mehr). Sie erbt die
// Textfarbe ihrer Zeile — die Sidebar ist monochrom, LinkedIn-Blau haette
// hier nichts zu suchen.
function LinkedInIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.55C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}

function NavLink({
  href,
  icon: Icon,
  label,
  onClick,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  onClick?: () => void;
}) {
  const pathname = usePathname();
  // Aktiv auch auf Unterseiten (/setting/abc → „Setting"); "/" nur exakt.
  const isActive = pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
  return (
    <Link href={href} onClick={onClick} className={`sidebar-link${isActive ? " active" : ""}`}>
      <Icon size={16} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
    </Link>
  );
}

/**
 * Listeneintrag: Punkt + Name. Der Punkt kodiert nur „aktiv" (Orange) vs.
 * „inaktiv" (Grau) — welcher Kanal gemeint ist, sagt der Abschnittskopf
 * darueber, nicht eine zweite Farbe.
 */
function ListRow({
  href,
  name,
  badge,
  title,
  onClick,
}: {
  href: string;
  name: string;
  badge?: { label: string } | null;
  title?: string;
  onClick?: () => void;
}) {
  const pathname = usePathname();
  const isActive = pathname === href;
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`sidebar-link${isActive ? " active" : ""}`}
      style={{ paddingLeft: "var(--sp-8)", height: 32, fontSize: "var(--fs-sm)", fontWeight: 400 }}
      title={title ?? name}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "var(--r-full)",
          flexShrink: 0,
          background: isActive ? "var(--orange-500)" : "var(--text-disabled)",
        }}
      />
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {name}
      </span>
      {badge && (
        <span
          style={{
            fontSize: "var(--fs-2xs)",
            fontWeight: 500,
            letterSpacing: "0.04em",
            color: "var(--text-secondary)",
            background: "var(--surface-3)",
            borderRadius: "var(--r-full)",
            padding: "1px 6px",
            flexShrink: 0,
          }}
        >
          {badge.label}
        </span>
      )}
    </Link>
  );
}

// Die Kuerzel tragen die Bedeutung; der Tooltip der Zeile schreibt sie aus.
const PHONE_KIND_BADGE: Record<"rueckruf" | "nicht_erreicht", { label: string }> = {
  rueckruf: { label: "RR" },
  nicht_erreicht: { label: "NE" },
};

// ---------------------------------------------------------------------------
// Kontext-Umschalter
// ---------------------------------------------------------------------------
// Frueher waren das vier Elemente: zwei Banner ("du bist in Org X" / "du siehst
// die Daten von Y") plus zwei dauerhaft aufgeklappte Listen zum Wechseln. Sie
// sagen dasselbe, also sind sie jetzt EIN Element pro Achse: eine 36px-Zeile,
// die den aktiven Kontext zeigt und ihn per Klick aufklappt. Der Zustand steckt
// in der Faerbung — neutral = Normalfall, Orange = fremde Datensicht,
// Rot = fremde Organisation.

type ContextTone = "neutral" | "accent" | "danger";

const CONTEXT_PALETTE: Record<
  ContextTone,
  { border: string; background: string; fg: string; caption: string }
> = {
  neutral: {
    border: "var(--border-default)",
    background: "var(--surface-1)",
    fg: "var(--text-secondary)",
    caption: "var(--text-muted)",
  },
  accent: {
    border: "var(--border-accent)",
    background: "var(--accent-muted)",
    fg: "var(--orange-300)",
    caption: "var(--orange-300)",
  },
  danger: {
    border: "var(--danger)",
    background: "var(--danger-bg)",
    fg: "var(--danger-fg)",
    caption: "var(--danger-fg)",
  },
};

function ContextSwitcher({
  icon,
  caption,
  label,
  tone,
  reset,
  children,
}: {
  icon: React.ReactNode;
  caption: string;
  label: string;
  tone: ContextTone;
  /** Formular zum Zuruecksetzen — nur wenn ein Nicht-Standard-Kontext aktiv ist. */
  reset?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const c = CONTEXT_PALETTE[tone];
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div
      style={{
        border: `1px solid ${c.border}`,
        background: c.background,
        borderRadius: "var(--r-md)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={`${caption}: ${label} — wechseln`}
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            height: 36,
            padding: "0 var(--sp-4)",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: c.fg,
            fontFamily: "inherit",
          }}
        >
          <span style={{ display: "flex", flexShrink: 0 }}>{icon}</span>
          <span style={{ flex: 1, minWidth: 0, textAlign: "left", lineHeight: 1.15 }}>
            <span
              style={{
                display: "block",
                fontSize: "var(--fs-2xs)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: c.caption,
                opacity: 0.75,
              }}
            >
              {caption}
            </span>
            <span
              style={{
                display: "block",
                fontSize: "var(--fs-sm)",
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </span>
          </span>
          <Chevron size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
        </button>
        {reset}
      </div>
      {open && (
        <div
          style={{
            borderTop: `1px solid ${c.border}`,
            padding: "var(--sp-2)",
            display: "flex",
            flexDirection: "column",
            gap: 1,
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** Eine Auswahlzeile innerhalb eines Kontext-Umschalters. */
function ContextOption({
  action,
  fields,
  label,
  badge,
  active,
  title,
  avatar,
}: {
  action: (formData: FormData) => void | Promise<void>;
  fields: { name: string; value: string }[];
  label: string;
  badge?: string;
  active: boolean;
  title: string;
  avatar: React.ReactNode;
}) {
  return (
    <form action={action}>
      {fields.map((f) => (
        <input key={f.name} type="hidden" name={f.name} value={f.value} />
      ))}
      <button
        type="submit"
        className={`sidebar-link${active ? " active" : ""}`}
        style={{
          width: "100%",
          border: "none",
          cursor: "pointer",
          background: active ? undefined : "none",
          fontSize: "var(--fs-sm)",
        }}
        title={title}
      >
        {/* Avatare bleiben grau — die Owner-Palette lebt in Dashboards und
            Charts, wo sie Datenreihen unterscheidet. */}
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: "var(--r-full)",
            background: active ? "var(--accent-muted)" : "var(--surface-3)",
            color: active ? "var(--orange-300)" : "var(--text-secondary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "var(--fs-2xs)",
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {avatar}
        </span>
        <span
          style={{
            flex: 1,
            textAlign: "left",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        {badge && (
          <span className="eyebrow eyebrow-muted" style={{ flexShrink: 0, fontSize: "var(--fs-2xs)" }}>
            {badge}
          </span>
        )}
      </button>
    </form>
  );
}

/** Kleiner X-Knopf rechts in einer Kontext-Zeile (Kontext zuruecksetzen). */
function ContextReset({
  action,
  fields,
  title,
  color,
}: {
  action: (formData: FormData) => void | Promise<void>;
  fields: { name: string; value: string }[];
  title: string;
  color: string;
}) {
  return (
    <form action={action} style={{ display: "flex", flexShrink: 0 }}>
      {fields.map((f) => (
        <input key={f.name} type="hidden" name={f.name} value={f.value} />
      ))}
      <button
        type="submit"
        title={title}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color,
          padding: "0 var(--sp-4) 0 0",
          display: "flex",
          alignItems: "center",
        }}
      >
        <X size={13} />
      </button>
    </form>
  );
}

/** Einklappbarer Abschnitt: Eyebrow-Kopf + optionale Aktion rechts. */
function CollapsibleSection({
  icon,
  label,
  action,
  headerHref,
  headerHrefTitle,
  onHeaderNavigate,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  action?: (ctx: { open: boolean; setOpen: (open: boolean) => void }) => React.ReactNode;
  /** Optionales Ziel hinter dem Abschnitts-Titel (z. B. LinkedIn → /listen). */
  headerHref?: string;
  headerHrefTitle?: string;
  onHeaderNavigate?: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", padding: "var(--sp-6) var(--sp-3) var(--sp-3)" }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={open ? `${label} einklappen` : `${label} ausklappen`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "0 var(--sp-2)",
            color: "var(--text-muted)",
            flexShrink: 0,
          }}
        >
          <Chevron size={12} style={{ flexShrink: 0 }} />
          {icon}
        </button>
        {/* Der Titel fuehrt zur Uebersicht des Abschnitts. Das ersetzt die
            fruehere Extra-Zeile „Alle Listen" — eine Zeile weniger, und der
            Weg dorthin ist da, wo man ihn sucht. */}
        {headerHref ? (
          <Link
            href={headerHref}
            onClick={onHeaderNavigate}
            title={headerHrefTitle ?? label}
            className="eyebrow eyebrow-muted"
            style={{
              flex: 1,
              minWidth: 0,
              textDecoration: "none",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </Link>
        ) : (
          <span
            className="eyebrow eyebrow-muted"
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </span>
        )}
        {action?.({ open, setOpen })}
      </div>
      {open && <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>{children}</div>}
    </div>
  );
}

/** Kleiner quadratischer Aktions-Button im Abschnitts-Kopf. */
function SectionAction({
  title,
  active = false,
  href,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const style: React.CSSProperties = {
    width: 22,
    height: 22,
    borderRadius: "var(--r-sm)",
    background: active ? "var(--orange-500)" : "var(--surface-3)",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: active ? "#0a0a0b" : "var(--text-muted)",
    transition: "background var(--transition-fast), color var(--transition-fast)",
    flexShrink: 0,
  };
  if (href) {
    return (
      <Link href={href} onClick={onClick} title={title} style={style}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} title={title} style={style}>
      {children}
    </button>
  );
}

export function SidebarContent({
  username,
  workspaceId,
  lists,
  viewTree = [],
  phoneLists = [],
  dataScope = "workspace",
  dataView,
  orgSwitch,
  onClose,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const isOwnScope = dataScope === "own";
  // Der Umschalter erscheint nur, wenn es wirklich etwas zu wechseln gibt.
  // Normale Nutzer und ein Plattform-Admin mit nur einer Organisation sehen
  // die Sidebar exakt wie bisher.
  const canSwitchOrg = (orgSwitch?.orgs.length ?? 0) > 1;
  const isForeignOrg = Boolean(orgSwitch?.isForeign);

  // Die Sidebar navigiert, sie inventarisiert nicht. Ab hier uebernehmen
  // /listen bzw. /telefon — beide zeigen ohnehin mehr (Archiv, Zaehler).
  const visibleLists = lists.slice(0, SIDEBAR_LIST_CAP);
  const hiddenListCount = lists.length - visibleLists.length;
  const visiblePhoneLists = phoneLists.slice(0, SIDEBAR_LIST_CAP);
  const hiddenPhoneCount = phoneLists.length - visiblePhoneLists.length;
  const [showNewList, setShowNewList] = useState(false);
  const [showManualAppt, setShowManualAppt] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const isImpersonating = Boolean(dataView?.activeUserId);
  const teamUsers = (dataView?.users ?? []).filter((u) => u.username !== username);
  const canSwitchDataView = Boolean(dataView?.canSwitch) && teamUsers.length > 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--surface-2)",
      }}
    >
      {/* Kopf: Wortmarke. Sitzt auf Topbar-Hoehe, damit die Kanten fluchten. */}
      <div
        style={{
          height: "var(--h-topbar)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--sp-4)",
          padding: "0 var(--sp-6)",
          borderBottom: "1px solid var(--border-default)",
          flexShrink: 0,
        }}
      >
        <Link href="/" onClick={onClose} className="wordmark" style={{ textDecoration: "none" }}>
          titan
        </Link>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Menü schließen"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              padding: 4,
              display: "flex",
            }}
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Kontext-Block: Organisation (aeussere Grenze) ueber Datensicht
          (innere). Beide nur, wenn es etwas zu wechseln gibt — ein normales
          Mitglied sieht hier gar nichts. */}
      {(canSwitchOrg || canSwitchDataView) && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--sp-3)",
            padding: "var(--sp-5)",
            borderBottom: "1px solid var(--border-subtle)",
            flexShrink: 0,
          }}
        >
          {canSwitchOrg && orgSwitch && (
            <ContextSwitcher
              icon={<Building2 size={14} />}
              caption="Organisation"
              label={orgSwitch.activeName}
              tone={isForeignOrg ? "danger" : "neutral"}
              reset={
                isForeignOrg ? (
                  <ContextReset
                    action={setActiveOrgForm}
                    fields={[{ name: "workspace_id", value: "" }]}
                    title="Zurück zur eigenen Organisation"
                    color="var(--danger-fg)"
                  />
                ) : undefined
              }
            >
              {orgSwitch.orgs.map((o) => (
                <ContextOption
                  key={o.id}
                  action={setActiveOrgForm}
                  fields={[{ name: "workspace_id", value: o.id }]}
                  label={o.name}
                  badge={o.id === orgSwitch.homeId ? "eigen" : undefined}
                  active={o.id === orgSwitch.activeId}
                  title={o.id === orgSwitch.activeId ? `${o.name} — aktiv` : `Zu ${o.name} wechseln`}
                  avatar={<Building2 size={11} />}
                />
              ))}
            </ContextSwitcher>
          )}

          {canSwitchDataView && dataView && (
            <ContextSwitcher
              icon={<Users size={14} />}
              caption="Datensicht"
              label={isImpersonating ? dataView.activeLabel : "Alle Daten"}
              tone={isImpersonating ? "accent" : "neutral"}
              reset={
                isImpersonating ? (
                  <ContextReset
                    action={setDataViewForm}
                    fields={[
                      { name: "next", value: pathname },
                      { name: "view_user_id", value: "" },
                    ]}
                    title="Datensicht zurücksetzen"
                    color="var(--orange-300)"
                  />
                ) : undefined
              }
            >
              <ContextOption
                action={setDataViewForm}
                fields={[
                  { name: "next", value: pathname },
                  { name: "view_user_id", value: "" },
                ]}
                label="Alle Daten"
                active={!isImpersonating}
                title="Datensicht zurücksetzen"
                avatar={<Users size={11} />}
              />
              {teamUsers.map((u) => (
                <ContextOption
                  key={u.user_id}
                  action={setDataViewForm}
                  fields={[
                    { name: "next", value: pathname },
                    { name: "view_user_id", value: u.user_id },
                  ]}
                  label={u.username}
                  active={u.user_id === dataView.activeUserId}
                  title={`Datensicht von ${u.username} anzeigen`}
                  avatar={ownerInitials(u.username)}
                />
              ))}
            </ContextSwitcher>
          )}
        </div>
      )}

      {/* Nav */}
      <nav
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "var(--sp-5) var(--sp-5)",
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        {/* Suche ueber ALLE Listen — ein Name muss nicht mehr in drei, vier
            Listen einzeln gesucht werden. */}
        <SearchTrigger onNavigate={onClose} />
        <NavLink href="/" icon={BarChart2} label="Dashboard" onClick={onClose} />
        {dataView?.canSwitch && <NavLink href="/team" icon={Users} label="Team" onClick={onClose} />}
        <NavLink href="/analyse" icon={LineChart} label="Analyse" onClick={onClose} />
        <NavLink href="/termine" icon={CalendarDays} label="Termine" onClick={onClose} />

        {/* Termin ohne Liste manuell buchen (Social Selling / alter Kontakt).
            Ghost-Akzent: die einzige Orange-Textaktion in der Navigation. */}
        <button
          type="button"
          onClick={() => setShowManualAppt(true)}
          className="sidebar-link"
          style={{
            width: "100%",
            border: "none",
            background: "none",
            cursor: "pointer",
            color: "var(--orange-300)",
            textAlign: "left",
          }}
          title="Termin ohne Liste manuell buchen"
        >
          <CalendarPlus size={16} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>Termin buchen</span>
        </button>
        <ManualAppointmentModal
          open={showManualAppt}
          onClose={() => setShowManualAppt(false)}
          onSaved={() => router.refresh()}
        />

        {/* ── LinkedIn ── */}
        <CollapsibleSection
          icon={<LinkedInIcon size={13} />}
          label="LinkedIn"
          headerHref="/listen"
          headerHrefTitle="Alle Listen (inkl. Archiv)"
          onHeaderNavigate={onClose}
          action={({ open, setOpen }) => (
            <SectionAction
              title="Neue Liste"
              active={showNewList && open}
              onClick={() => {
                if (!open) {
                  setOpen(true);
                  setShowNewList(true);
                } else {
                  setShowNewList((v) => !v);
                }
                setTimeout(() => nameRef.current?.focus(), 50);
              }}
            >
              <Plus size={12} />
            </SectionAction>
          )}
        >
          {showNewList && (
            <div
              style={{
                margin: "0 0 var(--sp-4)",
                background: "var(--surface-1)",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--r-md)",
                padding: "var(--sp-5)",
              }}
            >
              <form
                action={async (fd) => {
                  await createListForm(fd);
                  setShowNewList(false);
                }}
              >
                <input type="hidden" name="workspace_id" value={workspaceId} />
                <input
                  ref={nameRef}
                  name="name"
                  required
                  placeholder="Listenname…"
                  className="ui-input"
                  style={{ marginBottom: "var(--sp-4)", fontSize: "var(--fs-sm)" }}
                />
                <input type="hidden" name="owner_name" value={username} />
                <div style={{ display: "flex", gap: "var(--sp-2)" }}>
                  <button
                    type="submit"
                    style={{
                      flex: 1,
                      background: "var(--orange-500)",
                      color: "#0a0a0b",
                      border: "none",
                      borderRadius: "var(--r-full)",
                      height: 28,
                      fontSize: "var(--fs-xs)",
                      fontWeight: 600,
                      fontFamily: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    Anlegen
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNewList(false)}
                    aria-label="Abbrechen"
                    style={{
                      background: "var(--surface-3)",
                      color: "var(--text-muted)",
                      border: "none",
                      borderRadius: "var(--r-full)",
                      height: 28,
                      width: 28,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Lange Listen kappen: ab SIDEBAR_LIST_CAP uebernimmt /listen.
              Eine Sidebar mit 20 Zeilen ist keine Navigation mehr. */}
          {visibleLists.map((l) => (
            <ListRow key={l.id} href={`/lists/${l.id}`} name={l.name} onClick={onClose} />
          ))}
          {hiddenListCount > 0 && (
            <ListRow
              href="/listen"
              name={`${hiddenListCount} weitere …`}
              onClick={onClose}
              title="Alle Listen anzeigen"
            />
          )}
          {lists.length === 0 && (
            <p style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", padding: "var(--sp-2) var(--sp-8)" }}>
              Noch keine Listen.
            </p>
          )}

          {/* Gefilterte Ansichten und Ordner — additiv neben den echten
              Listen, die weiterhin die Heimat der Kontakte sind. Eigene
              Ueberschrift statt nur einer Trennlinie: sonst verschwimmen
              Listen und Ansichten zu einem einzigen langen Block. */}
          {viewTree.length > 0 && (
            <div style={{ marginTop: "var(--sp-4)" }}>
              <div
                className="eyebrow eyebrow-muted"
                style={{ padding: "0 var(--sp-3) var(--sp-2) var(--sp-8)", fontSize: "var(--fs-2xs)" }}
              >
                Ansichten
              </div>
              <ViewTree tree={viewTree} lists={lists} onNavigate={onClose} />
            </div>
          )}
        </CollapsibleSection>

        {/* ── Telefon ── */}
        <CollapsibleSection
          icon={<Phone size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />}
          label="Telefon"
          headerHref="/telefon"
          headerHrefTitle="Telefon-Übersicht öffnen"
          onHeaderNavigate={onClose}
        >
          {visiblePhoneLists.map((l) => (
            <ListRow
              key={l.id}
              href={`/telefon/${l.id}`}
              name={l.name}
              badge={l.list_kind !== "akquise" ? PHONE_KIND_BADGE[l.list_kind] : null}
              title={
                l.list_kind === "rueckruf"
                  ? `${l.name} (Rückruf-Liste)`
                  : l.list_kind === "nicht_erreicht"
                    ? `${l.name} (Nicht-erreicht-Liste)`
                    : l.name
              }
              onClick={onClose}
            />
          ))}
          {hiddenPhoneCount > 0 && (
            <ListRow
              href="/telefon"
              name={`${hiddenPhoneCount} weitere …`}
              onClick={onClose}
              title="Telefon-Übersicht öffnen"
            />
          )}
          {phoneLists.length === 0 && (
            <p style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", padding: "var(--sp-2) var(--sp-8)" }}>
              Noch keine Listen.
            </p>
          )}
        </CollapsibleSection>

        <div style={{ flex: 1, minHeight: "var(--sp-7)" }} />

        <div style={{ borderTop: "1px solid var(--border-subtle)", marginTop: "var(--sp-4)", paddingTop: "var(--sp-4)" }}>
          <NavLink href="/export" icon={Download} label="Export (CSV)" onClick={onClose} />
          <NavLink href="/settings" icon={Settings} label="Einstellungen" onClick={onClose} />
          {/* Nur Plattform-Admins: Organisationen anlegen, Nutzer verschieben. */}
          {orgSwitch && (
            <NavLink href="/admin" icon={ShieldCheck} label="Organisationen" onClick={onClose} />
          )}
        </div>
      </nav>

      {/* Footer */}
      <div style={{ borderTop: "1px solid var(--border-default)", padding: "var(--sp-5)", flexShrink: 0 }}>
        {isOwnScope && (
          <div
            style={{
              marginBottom: "var(--sp-4)",
              border: "1px solid var(--border-default)",
              background: "var(--surface-1)",
              color: "var(--text-muted)",
              borderRadius: "var(--r-sm)",
              padding: "var(--sp-3) var(--sp-4)",
              fontSize: "var(--fs-xs)",
              fontWeight: 500,
            }}
          >
            Eigene Datensicht aktiv
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", padding: "0 var(--sp-3) var(--sp-4)" }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "var(--r-full)",
              background: "var(--surface-3)",
              color: "var(--text-secondary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "var(--fs-xs)",
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {username.charAt(0).toUpperCase()}
          </div>
          <span
            style={{
              fontSize: "var(--fs-sm)",
              fontWeight: 500,
              color: "var(--text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {username}
          </span>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="sidebar-link"
            style={{
              width: "100%",
              color: "var(--text-muted)",
              border: "none",
              background: "none",
              cursor: "pointer",
              fontSize: "var(--fs-sm)",
            }}
          >
            <LogOut size={15} />
            <span>Abmelden</span>
          </button>
        </form>
      </div>
    </div>
  );
}

export function MobileDrawer({
  open,
  onClose,
  workspaceName,
  username,
  workspaceId,
  lists,
  viewTree,
  phoneLists,
  dataScope,
  dataView,
  orgSwitch,
}: {
  open: boolean;
  onClose: () => void;
  workspaceName: string;
  username: string;
  workspaceId: string;
  lists: SidebarList[];
  viewTree?: ViewNode[];
  phoneLists?: SidebarPhoneList[];
  dataScope?: DataScope;
  dataView?: DataViewState;
  orgSwitch?: OrgSwitchState;
}) {
  if (!open) return null;
  return (
    <>
      {/* Scrim ueber dem FAB (zIndex 40), Panel darueber */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "var(--surface-scrim)", zIndex: 60 }} />
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          width: "var(--w-sidebar)",
          zIndex: 70,
          borderRight: "1px solid var(--border-default)",
          boxShadow: "var(--shadow-overlay)",
        }}
      >
        <SidebarContent
          workspaceName={workspaceName}
          username={username}
          workspaceId={workspaceId}
          lists={lists}
          viewTree={viewTree}
          phoneLists={phoneLists}
          dataScope={dataScope}
          dataView={dataView}
          orgSwitch={orgSwitch}
          onClose={onClose}
        />
      </div>
    </>
  );
}
