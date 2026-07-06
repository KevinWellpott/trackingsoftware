"use client";

import { setDataViewForm, signOut } from "@/app/actions/workspace";
import { createListForm } from "@/app/actions/lists";
import {
  ArrowRight,
  BarChart2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Download,
  Handshake,
  LogOut,
  Phone,
  Plus,
  Settings,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ownerColor, ownerInitials } from "@/lib/ownerColor";

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
  phoneLists?: SidebarPhoneList[];
  dataScope?: DataScope;
  dataView?: DataViewState;
  onClose?: () => void;
};

// Echtes LinkedIn-Logo (lucide führt keine Brand-Icons mehr).
function LinkedInIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#0A66C2" aria-hidden="true" style={{ flexShrink: 0 }}>
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
  // Aktiv auch auf Unterseiten (/setting/abc → "Setting"); "/" nur exakt.
  const isActive = pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`sidebar-link${isActive ? " active" : ""}`}
    >
      <Icon size={15} strokeWidth={isActive ? 2.5 : 2} />
      <span style={{ flex: 1 }}>{label}</span>
      {isActive && <ChevronRight size={13} style={{ opacity: 0.4 }} />}
    </Link>
  );
}

function ListLink({
  id,
  name,
  onClick,
}: {
  id: string;
  name: string;
  onClick?: () => void;
}) {
  const pathname = usePathname();
  const href = `/lists/${id}`;
  const isActive = pathname === href;
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`sidebar-link${isActive ? " active" : ""}`}
      style={{ paddingLeft: "1.5rem" }}
      title={name}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          flexShrink: 0,
          background: isActive ? "var(--brand-500)" : "var(--text-subtle)",
        }}
      />
      <span
        style={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: "0.8125rem",
        }}
      >
        {name}
      </span>
    </Link>
  );
}

const PHONE_KIND_BADGE: Record<"rueckruf" | "nicht_erreicht", { label: string; color: string; bg: string; border: string }> = {
  rueckruf: { label: "RR", color: "var(--brand-500)", bg: "var(--brand-50)", border: "var(--brand-200)" },
  nicht_erreicht: {
    label: "NE",
    color: "var(--color-warning-text)",
    bg: "var(--color-warning-bg)",
    border: "var(--color-warning-border)",
  },
};

function PhoneListLink({
  list,
  onClick,
}: {
  list: SidebarPhoneList;
  onClick?: () => void;
}) {
  const pathname = usePathname();
  const href = `/telefon/${list.id}`;
  const isActive = pathname === href;
  const badge = list.list_kind !== "akquise" ? PHONE_KIND_BADGE[list.list_kind] : null;
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`sidebar-link${isActive ? " active" : ""}`}
      style={{ paddingLeft: "1.5rem" }}
      title={list.list_kind === "rueckruf" ? `${list.name} (Rückruf-Liste)` : list.list_kind === "nicht_erreicht" ? `${list.name} (Nicht-erreicht-Liste)` : list.name}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          flexShrink: 0,
          background: isActive ? "var(--brand-500)" : "var(--text-subtle)",
        }}
      />
      <span
        style={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: "0.8125rem",
        }}
      >
        {list.name}
      </span>
      {badge && (
        <span
          style={{
            fontSize: "0.5625rem",
            fontWeight: 800,
            letterSpacing: "0.04em",
            color: badge.color,
            background: badge.bg,
            border: `1px solid ${badge.border}`,
            borderRadius: 99,
            padding: "0.05rem 0.3rem",
            flexShrink: 0,
          }}
        >
          {badge.label}
        </span>
      )}
    </Link>
  );
}

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
  const oc = ownerColor(isReset ? null : label);
  return (
    <form action={setDataViewForm}>
      <input type="hidden" name="next" value={pathname} />
      <input type="hidden" name="view_user_id" value={userId} />
      <button
        type="submit"
        className="sidebar-link"
        style={{
          width: "100%",
          border: "none",
          cursor: "pointer",
          background: active ? "var(--brand-50)" : "none",
          color: active ? "var(--brand-600)" : undefined,
          fontWeight: active ? 700 : undefined,
        }}
        title={isReset ? "Zur eigenen Datensicht zurückkehren" : `Datensicht von ${label} anzeigen`}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: isReset ? "var(--surface-200)" : oc.bg,
            color: isReset ? "var(--text-secondary)" : oc.fg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.625rem",
            fontWeight: 700,
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
        {active && <ChevronRight size={13} style={{ opacity: 0.5 }} />}
      </button>
    </form>
  );
}

/** Einklappbarer Sidebar-Abschnitt: Kopfzeile (Chevron + Icon + Label + optionale Aktion), Inhalt per Klick ein-/ausblendbar. */
function CollapsibleSection({
  icon,
  label,
  action,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  /** Optionale Aktion rechts im Header; erhält Zugriff auf den Auf-/Zuklapp-Status. */
  action?: (ctx: { open: boolean; setOpen: (open: boolean) => void }) => React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", padding: "0.5rem 0.5rem 0.25rem 0.375rem" }}>
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
            gap: "0.375rem",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "0.125rem 0.25rem",
            color: "var(--text-subtle)",
          }}
        >
          <Chevron size={12} strokeWidth={2.5} style={{ flexShrink: 0, opacity: 0.7 }} />
          {icon}
          <span
            style={{
              flex: 1,
              textAlign: "left",
              fontSize: "0.6875rem",
              fontWeight: 700,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
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
      {open && <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{children}</div>}
    </div>
  );
}

export function SidebarContent({
  username,
  workspaceId,
  lists,
  phoneLists = [],
  dataScope = "workspace",
  dataView,
  onClose,
}: Props) {
  const pathname = usePathname();
  const isOwnScope = dataScope === "own";
  const [showNewList, setShowNewList] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const isImpersonating = Boolean(dataView?.activeUserId);
  const teamUsers = (dataView?.users ?? []).filter((u) => u.username !== username);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--surface-50)",
      }}
    >
      {/* Datensicht-Banner (Impersonation aktiv) */}
      {dataView?.canSwitch && isImpersonating && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            margin: "0.5rem 0.5rem 0",
            padding: "0.375rem 0.5rem 0.375rem 0.625rem",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--color-warning-border)",
            background: "var(--color-warning-bg)",
            color: "var(--color-warning-text)",
            flexShrink: 0,
          }}
        >
          <Users size={13} style={{ flexShrink: 0 }} />
          <span
            style={{
              flex: 1,
              fontSize: "0.75rem",
              fontWeight: 700,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={`Datensicht: ${dataView.activeLabel}`}
          >
            Datensicht: {dataView.activeLabel}
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
                color: "var(--color-warning-text)",
                padding: "0.125rem",
                display: "flex",
                alignItems: "center",
              }}
            >
              <X size={13} strokeWidth={2.5} />
            </button>
          </form>
        </div>
      )}

      {/* Schließen-Button (nur im mobilen Drawer) */}
      {onClose && (
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "0.375rem 0.5rem 0", flexShrink: 0 }}>
          <button
            onClick={onClose}
            aria-label="Menü schließen"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "0.25rem", display: "flex", alignItems: "center" }}
          >
            <X size={17} />
          </button>
        </div>
      )}

      {/* Nav */}
      <nav
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0.625rem 0.375rem",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <NavLink href="/" icon={BarChart2} label="Dashboard" onClick={onClose} />
        {dataView?.canSwitch && <NavLink href="/team" icon={Users} label="Team" onClick={onClose} />}
        <NavLink href="/setting" icon={ClipboardCheck} label="Setting" onClick={onClose} />
        <NavLink href="/closing" icon={Handshake} label="Closing" onClick={onClose} />
        <NavLink href="/nachfassen" icon={Clock} label="Nachfassen" onClick={onClose} />

        {/* ── LinkedIn Section ── */}
        <div style={{ marginTop: "0.375rem" }} />
        <CollapsibleSection
          icon={<LinkedInIcon size={13} />}
          label="LinkedIn"
          action={({ open, setOpen }) => (
            <button
              type="button"
              onClick={() => {
                if (!open) {
                  setOpen(true);
                  setShowNewList(true);
                } else {
                  setShowNewList((v) => !v);
                }
                setTimeout(() => nameRef.current?.focus(), 50);
              }}
              style={{ width: 22, height: 22, borderRadius: 6, background: showNewList && open ? "var(--brand-500)" : "var(--surface-200)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: showNewList && open ? "white" : "var(--text-subtle)", transition: "all 0.15s", flexShrink: 0 }}
              title="Neue Liste"
            >
              <Plus size={12} strokeWidth={2.5} />
            </button>
          )}
        >
          {/* Inline new list form */}
          {showNewList && (
            <div style={{ margin: "0.25rem 0.5rem 0.5rem", background: "var(--surface-150)", border: "1px solid var(--border-bright)", borderRadius: "var(--radius-md)", padding: "0.625rem 0.75rem" }}>
              <form action={async (fd) => { await createListForm(fd); setShowNewList(false); }}>
                <input type="hidden" name="workspace_id" value={workspaceId} />
                <input
                  ref={nameRef}
                  name="name"
                  required
                  placeholder="Listenname…"
                  style={{ width: "100%", background: "var(--surface-0)", border: "1px solid var(--border)", borderRadius: 6, padding: "0.3125rem 0.5rem", fontSize: "0.8125rem", color: "var(--text-primary)", outline: "none", marginBottom: "0.375rem" }}
                />
                <input type="hidden" name="owner_name" value={username} />
                <div style={{ display: "flex", gap: "0.25rem" }}>
                  <button type="submit" style={{ flex: 1, background: "var(--brand-500)", color: "white", border: "none", borderRadius: 6, padding: "0.3rem", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}>
                    Anlegen
                  </button>
                  <button type="button" onClick={() => setShowNewList(false)} style={{ background: "var(--surface-200)", color: "var(--text-subtle)", border: "none", borderRadius: 6, padding: "0.3rem 0.5rem", fontSize: "0.75rem", cursor: "pointer", display: "flex", alignItems: "center" }}>
                    <X size={12} />
                  </button>
                </div>
              </form>
            </div>
          )}

          {lists.map((l) => (
            <ListLink key={l.id} id={l.id} name={l.name} onClick={onClose} />
          ))}
          {lists.length === 0 && (
            <p style={{ fontSize: "0.75rem", color: "var(--text-subtle)", padding: "0.25rem 1.5rem" }}>
              Noch keine Listen.
            </p>
          )}
        </CollapsibleSection>

        {/* ── Telefon Section ── */}
        <div style={{ borderTop: "1px solid var(--border)", margin: "0.625rem 0 0" }} />
        <CollapsibleSection
          icon={<Phone size={13} style={{ color: "var(--text-subtle)", flexShrink: 0 }} />}
          label="Telefon"
          action={() => (
            <Link
              href="/telefon"
              onClick={onClose}
              title="Telefon-Übersicht öffnen"
              style={{ width: 22, height: 22, borderRadius: 6, background: "var(--surface-200)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-subtle)", flexShrink: 0 }}
            >
              <ArrowRight size={12} strokeWidth={2.5} />
            </Link>
          )}
        >
          {phoneLists.map((l) => (
            <PhoneListLink key={l.id} list={l} onClick={onClose} />
          ))}
          {phoneLists.length === 0 && (
            <p style={{ fontSize: "0.75rem", color: "var(--text-subtle)", padding: "0.25rem 1.5rem" }}>
              Noch keine Listen.
            </p>
          )}
        </CollapsibleSection>

        <div style={{ flex: 1 }} />

        {/* ── Team-Ansicht (nur Admin/Owner) ── */}
        {dataView?.canSwitch && teamUsers.length > 0 && (
          <>
            <div style={{ borderTop: "1px solid var(--border)", marginTop: "0.5rem" }} />
            <CollapsibleSection
              icon={<Users size={12} style={{ color: "var(--text-subtle)", flexShrink: 0 }} />}
              label="Team-Ansicht"
            >
              {isImpersonating && (
                <TeamViewRow
                  userId=""
                  label="Meine Daten"
                  pathname={pathname}
                  active={false}
                  isReset
                />
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

        <div style={{ borderTop: "1px solid var(--border)", marginTop: "0.5rem", paddingTop: "0.5rem" }}>
          <NavLink href="/export" icon={Download} label="Export (CSV)" onClick={onClose} />
          <NavLink href="/settings" icon={Settings} label="Einstellungen" onClick={onClose} />
        </div>
      </nav>

      {/* Footer */}
      <div style={{ borderTop: "1px solid var(--border)", padding: "0.625rem 0.375rem", flexShrink: 0 }}>
        {isOwnScope && (
          <div style={{ margin: "0 0.75rem 0.5rem", border: "1px solid var(--color-warning-border)", background: "var(--color-warning-bg)", color: "var(--color-warning-text)", borderRadius: 8, padding: "0.35rem 0.5rem", fontSize: "0.6875rem", fontWeight: 700 }}>
            Eigene Datensicht aktiv
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.375rem 0.75rem", marginBottom: "0.125rem" }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "var(--brand-100)",
              color: "var(--brand-600)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.75rem",
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {username.charAt(0).toUpperCase()}
          </div>
          <span style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {username}
          </span>
        </div>
        <div style={{ padding: "0 0.375rem", marginBottom: "0.375rem" }}>
          <ThemeToggle />
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="sidebar-link"
            style={{ width: "100%", color: "var(--color-error-text)", border: "none", background: "none", cursor: "pointer" }}
          >
            <LogOut size={14} />
            <span>Abmelden</span>
          </button>
        </form>
      </div>
    </div>
  );
}

export function MobileDrawer({
  open, onClose, workspaceName, username, workspaceId, lists, phoneLists, dataScope, dataView,
}: {
  open: boolean;
  onClose: () => void;
  workspaceName: string;
  username: string;
  workspaceId: string;
  lists: SidebarList[];
  phoneLists?: SidebarPhoneList[];
  dataScope?: DataScope;
  dataView?: DataViewState;
}) {
  if (!open) return null;
  return (
    <>
      {/* Backdrop über dem FAB (zIndex 40), Panel über dem Backdrop */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 60 }} />
      <div style={{ position: "fixed", top: 0, left: 0, bottom: 0, width: 260, zIndex: 70, boxShadow: "var(--shadow-lg)" }}>
        <SidebarContent
          workspaceName={workspaceName}
          username={username}
          workspaceId={workspaceId}
          lists={lists}
          phoneLists={phoneLists}
          dataScope={dataScope}
          dataView={dataView}
          onClose={onClose}
        />
      </div>
    </>
  );
}
