"use client";

import { signOut } from "@/app/actions/workspace";
import { createListForm } from "@/app/actions/lists";
import {
  BarChart2,
  ChevronDown,
  ChevronRight,
  Download,
  FolderOpen,
  FolderClosed,
  LogOut,
  Plus,
  Settings,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

type SidebarList = { id: string; name: string; owner_name: string | null };

type Props = {
  workspaceName: string;
  username: string;
  workspaceId: string;
  lists: SidebarList[];
  onClose?: () => void;
};

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
  const isActive = pathname === href;
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

const OWNER_COLORS: Record<string, string> = {
  Kevin: "#6366f1",
  Simon: "#8b5cf6",
};

function OwnerFolder({
  owner,
  lists,
  onClose,
}: {
  owner: string;
  lists: SidebarList[];
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const hasActive = lists.some((l) => pathname === `/lists/${l.id}`);
  const [open, setOpen] = useState<boolean>(hasActive || true);
  const color = OWNER_COLORS[owner] ?? "var(--brand-500)";

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.375rem 0.75rem",
          background: "none",
          border: "none",
          cursor: "pointer",
          borderRadius: "var(--radius-md)",
          color: "var(--text-secondary)",
          fontSize: "0.8125rem",
          fontWeight: 600,
          transition: "background var(--transition-fast)",
        }}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLElement).style.background =
            "var(--surface-100)")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLElement).style.background = "none")
        }
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: color + "22",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {open ? (
            <FolderOpen size={13} color={color} />
          ) : (
            <FolderClosed size={13} color={color} />
          )}
        </div>
        <span style={{ flex: 1, color, textAlign: "left" }}>{owner}</span>
        <span
          style={{
            fontSize: "0.6875rem",
            color: "var(--text-subtle)",
            background: "var(--surface-100)",
            borderRadius: 99,
            padding: "0.1rem 0.4rem",
          }}
        >
          {lists.length}
        </span>
        {open ? (
          <ChevronDown size={13} style={{ color: "var(--text-subtle)" }} />
        ) : (
          <ChevronRight size={13} style={{ color: "var(--text-subtle)" }} />
        )}
      </button>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 1 }}>
          {lists.map((l) => (
            <ListLink key={l.id} id={l.id} name={l.name} onClick={onClose} />
          ))}
          {lists.length === 0 && (
            <p
              style={{
                fontSize: "0.75rem",
                color: "var(--text-subtle)",
                padding: "0.25rem 1.5rem",
              }}
            >
              Noch keine Listen.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function SidebarContent({ workspaceName, username, workspaceId, lists, onClose }: Props) {
  const [showNewList, setShowNewList] = useState(false);
  const [newListOwner, setNewListOwner] = useState<"Kevin" | "Simon">("Kevin");
  const nameRef = useRef<HTMLInputElement>(null);

  // Gruppiere nach owner_name
  const owners = Array.from(
    new Set(["Kevin", "Simon", ...lists.map((l) => l.owner_name ?? "Ohne Zuordnung")]),
  ).filter((o) => o === "Kevin" || o === "Simon" || lists.some((l) => (l.owner_name ?? "Ohne Zuordnung") === o));

  const grouped: Record<string, SidebarList[]> = {};
  for (const l of lists) {
    const key = l.owner_name ?? "Ohne Zuordnung";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(l);
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--surface-50)",
      }}
    >
      {/* Header */}
      <div
        style={{
          height: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 0.875rem",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          background: "linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(139,92,246,0.04) 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "var(--brand-500)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Zap size={14} color="white" fill="white" />
          </div>
          <div>
            <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.2 }}>
              Pitch Tracker
            </div>
            <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", lineHeight: 1.2 }}>
              {workspaceName}
            </div>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "0.25rem" }}
          >
            <X size={17} />
          </button>
        )}
      </div>

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

        {/* Pitch-Listen Header */}
        <div style={{ display: "flex", alignItems: "center", padding: "0.75rem 0.75rem 0.25rem", gap: "0.25rem" }}>
          <span style={{ flex: 1, fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-subtle)" }}>
            Pitch-Listen
          </span>
          <button
            type="button"
            onClick={() => { setShowNewList((v) => !v); setTimeout(() => nameRef.current?.focus(), 50); }}
            style={{ width: 22, height: 22, borderRadius: 6, background: showNewList ? "var(--brand-500)" : "var(--surface-200)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: showNewList ? "white" : "var(--text-subtle)", transition: "all 0.15s", flexShrink: 0 }}
            title="Neue Liste"
          >
            <Plus size={12} strokeWidth={2.5} />
          </button>
        </div>

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
              <div style={{ display: "flex", gap: "0.375rem", marginBottom: "0.375rem" }}>
                {(["Kevin", "Simon"] as const).map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setNewListOwner(o)}
                    style={{ flex: 1, padding: "0.25rem", borderRadius: 6, border: "1px solid", borderColor: newListOwner === o ? OWNER_COLORS[o] : "var(--border)", background: newListOwner === o ? OWNER_COLORS[o] + "22" : "transparent", color: newListOwner === o ? OWNER_COLORS[o] : "var(--text-subtle)", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", transition: "all 0.1s" }}
                  >
                    {o}
                  </button>
                ))}
              </div>
              <input type="hidden" name="owner_name" value={newListOwner} />
              <div style={{ display: "flex", gap: "0.25rem" }}>
                <button type="submit" style={{ flex: 1, background: "var(--brand-500)", color: "white", border: "none", borderRadius: 6, padding: "0.3rem", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}>
                  Anlegen
                </button>
                <button type="button" onClick={() => setShowNewList(false)} style={{ background: "var(--surface-200)", color: "var(--text-subtle)", border: "none", borderRadius: 6, padding: "0.3rem 0.5rem", fontSize: "0.75rem", cursor: "pointer" }}>
                  ✕
                </button>
              </div>
            </form>
          </div>
        )}

        {owners.map((owner) => (
          <OwnerFolder
            key={owner}
            owner={owner}
            lists={grouped[owner] ?? []}
            onClose={onClose}
          />
        ))}

        <div style={{ flex: 1 }} />
        <div style={{ borderTop: "1px solid var(--border)", marginTop: "0.5rem", paddingTop: "0.5rem" }}>
          <NavLink href="/export" icon={Download} label="Export (CSV)" onClick={onClose} />
          <NavLink href="/settings" icon={Settings} label="Einstellungen" onClick={onClose} />
        </div>
      </nav>

      {/* Footer */}
      <div style={{ borderTop: "1px solid var(--border)", padding: "0.625rem 0.375rem", flexShrink: 0 }}>
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
  open, onClose, workspaceName, username, workspaceId, lists,
}: {
  open: boolean;
  onClose: () => void;
  workspaceName: string;
  username: string;
  workspaceId: string;
  lists: SidebarList[];
}) {
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 40 }} />
      <div style={{ position: "fixed", top: 0, left: 0, bottom: 0, width: 260, zIndex: 50, boxShadow: "4px 0 32px rgba(0,0,0,0.8)" }}>
        <SidebarContent workspaceName={workspaceName} username={username} workspaceId={workspaceId} lists={lists} onClose={onClose} />
      </div>
    </>
  );
}
