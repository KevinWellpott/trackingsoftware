"use client";

import { setDataViewForm, signOut } from "@/app/actions/workspace";
import { createListForm } from "@/app/actions/lists";
import { SearchTrigger } from "@/components/search/SearchDialog";
import { ViewTree } from "@/components/listen/ViewTree";
import type { ViewNode } from "@/lib/listViews";
import {
  ArrowRight,
  BarChart2,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  Download,
  LogOut,
  Phone,
  Plus,
  Settings,
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

/** Eine Zeile der Team-Ansicht: Formular, das die Datensicht wechselt. */
function TeamViewRow({
  userId,
  label,
  pathname,
  active,
  isReset,
}: {
  userId: string;
  label: string;
  pathname: string;
  active: boolean;
  isReset?: boolean;
}) {
  return (
    <form action={setDataViewForm}>
      <input type="hidden" name="next" value={pathname} />
      <input type="hidden" name="view_user_id" value={userId} />
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
        title={isReset ? "Zur eigenen Datensicht zurückkehren" : `Datensicht von ${label} anzeigen`}
      >
        {/* Avatare in der Sidebar bleiben grau — die Owner-Palette lebt in
            Dashboards und Charts, wo sie Datenreihen unterscheidet. */}
        <span
          style={{
            width: 22,
            height: 22,
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
          {isReset ? <Users size={12} /> : ownerInitials(label)}
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
      </button>
    </form>
  );
}

/** Einklappbarer Abschnitt: Eyebrow-Kopf + optionale Aktion rechts. */
function CollapsibleSection({
  icon,
  label,
  action,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  action?: (ctx: { open: boolean; setOpen: (open: boolean) => void }) => React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", padding: "var(--sp-5) var(--sp-3) var(--sp-3)" }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={open ? `${label} einklappen` : `${label} ausklappen`}
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "0 var(--sp-2)",
            color: "var(--text-muted)",
          }}
        >
          <Chevron size={12} style={{ flexShrink: 0 }} />
          {icon}
          <span
            className="eyebrow eyebrow-muted"
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
        </button>
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
  onClose,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const isOwnScope = dataScope === "own";
  const [showNewList, setShowNewList] = useState(false);
  const [showManualAppt, setShowManualAppt] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const isImpersonating = Boolean(dataView?.activeUserId);
  const teamUsers = (dataView?.users ?? []).filter((u) => u.username !== username);

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

      {/* Datensicht-Banner (Impersonation aktiv) */}
      {dataView?.canSwitch && isImpersonating && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-4)",
            margin: "var(--sp-5) var(--sp-5) 0",
            padding: "var(--sp-3) var(--sp-4)",
            borderRadius: "var(--r-md)",
            // Fremde Datensicht ist ein AKTIVER Modus, kein Status —
            // deshalb der Akzent-Tint und nicht Warning-Gold.
            border: "1px solid var(--border-accent)",
            background: "var(--accent-muted)",
            color: "var(--orange-300)",
            flexShrink: 0,
          }}
        >
          <Users size={13} style={{ flexShrink: 0 }} />
          <span
            style={{
              flex: 1,
              fontSize: "var(--fs-xs)",
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={`Datensicht: ${dataView.activeLabel}`}
          >
            {dataView.activeLabel}
          </span>
          <form action={setDataViewForm} style={{ display: "flex", flexShrink: 0 }}>
            <input type="hidden" name="next" value={pathname} />
            <input type="hidden" name="view_user_id" value="" />
            <button
              type="submit"
              title="Datensicht zurücksetzen"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--orange-300)",
                padding: 2,
                display: "flex",
                alignItems: "center",
              }}
            >
              <X size={13} />
            </button>
          </form>
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

          {/* Uebersicht aller Listen inkl. Archiv-Reiter. */}
          <ListRow href="/listen" name="Alle Listen" onClick={onClose} />
          {lists.map((l) => (
            <ListRow key={l.id} href={`/lists/${l.id}`} name={l.name} onClick={onClose} />
          ))}
          {lists.length === 0 && (
            <p style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", padding: "var(--sp-2) var(--sp-8)" }}>
              Noch keine Listen.
            </p>
          )}

          {/* Gefilterte Ansichten und Ordner — additiv neben den echten
              Listen, die weiterhin die Heimat der Kontakte sind. */}
          <div style={{ marginTop: "var(--sp-4)", paddingTop: "var(--sp-4)", borderTop: "1px solid var(--border-subtle)" }}>
            <ViewTree tree={viewTree} lists={lists} onNavigate={onClose} />
          </div>
        </CollapsibleSection>

        {/* ── Telefon ── */}
        <div style={{ borderTop: "1px solid var(--border-subtle)", marginTop: "var(--sp-4)" }} />
        <CollapsibleSection
          icon={<Phone size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />}
          label="Telefon"
          action={() => (
            <SectionAction title="Telefon-Übersicht öffnen" href="/telefon" onClick={onClose}>
              <ArrowRight size={12} />
            </SectionAction>
          )}
        >
          {phoneLists.map((l) => (
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
          {phoneLists.length === 0 && (
            <p style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", padding: "var(--sp-2) var(--sp-8)" }}>
              Noch keine Listen.
            </p>
          )}
        </CollapsibleSection>

        <div style={{ flex: 1, minHeight: "var(--sp-6)" }} />

        {/* ── Team-Ansicht (nur Admin/Owner) ── */}
        {dataView?.canSwitch && teamUsers.length > 0 && (
          <>
            <div style={{ borderTop: "1px solid var(--border-subtle)" }} />
            <CollapsibleSection
              icon={<Users size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />}
              label="Team-Ansicht"
            >
              {isImpersonating && (
                <TeamViewRow userId="" label="Meine Daten" pathname={pathname} active={false} isReset />
              )}
              {teamUsers.map((u) => (
                <TeamViewRow
                  key={u.user_id}
                  userId={u.user_id}
                  label={u.username}
                  pathname={pathname}
                  active={u.user_id === dataView.activeUserId}
                />
              ))}
            </CollapsibleSection>
          </>
        )}

        <div style={{ borderTop: "1px solid var(--border-subtle)", marginTop: "var(--sp-4)", paddingTop: "var(--sp-4)" }}>
          <NavLink href="/export" icon={Download} label="Export (CSV)" onClick={onClose} />
          <NavLink href="/settings" icon={Settings} label="Einstellungen" onClick={onClose} />
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
          onClose={onClose}
        />
      </div>
    </>
  );
}
