"use client";

import { setAssignees, type AssigneeEntity } from "@/app/actions/assignees";
import { ownerColor, ownerInitials } from "@/lib/ownerColor";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";

// Kompakter Multi-Select für Call-Zuweisungen (Setter/Closer).
// Auswahl als entfernbare Chips mit Initialen; Änderungen werden sofort
// per setAssignees gespeichert. Wird von Setting UND Closing genutzt.
// Tastatur: Pfeiltasten navigieren, Enter/Space toggelt, Escape schließt.

type UserOption = { user_id: string; username: string };

type Props = {
  entityType: AssigneeEntity;
  entityId: string;
  users: UserOption[];
  initial: UserOption[];
};

export function AssigneeMultiSelect({ entityType, entityId, users, initial }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() => initial.map((a) => a.user_id));
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Beim Öffnen: erste Option fokussieren (roving tabIndex). Der Index wird in
  // den Öffnungs-Handlern zurückgesetzt; hier nur der Fokus-Side-Effect.
  useEffect(() => {
    if (!open) return;
    const first = listRef.current?.querySelector<HTMLElement>('[role="option"]');
    first?.focus();
  }, [open]);

  function openList() {
    setActiveIndex(0);
    setOpen(true);
  }

  function closeAndRefocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onListKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeAndRefocus();
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    const options = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    if (options.length === 0) return;
    const current = options.findIndex((el) => el === document.activeElement);
    let next = -1;
    if (e.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % options.length;
    else if (e.key === "ArrowUp") next = current < 0 ? options.length - 1 : (current - 1 + options.length) % options.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    if (next >= 0) {
      e.preventDefault();
      options[next].focus();
      setActiveIndex(next);
    }
    // Enter/Space toggeln nativ über den Button-Click der fokussierten Option.
  }

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openList();
    }
  }

  function commit(nextIds: string[]) {
    setSelectedIds(nextIds);
    startTransition(async () => {
      const res = await setAssignees(entityType, entityId, nextIds);
      setError(res?.error ?? null);
    });
  }

  function toggle(userId: string) {
    commit(
      selectedIds.includes(userId)
        ? selectedIds.filter((id) => id !== userId)
        : [...selectedIds, userId],
    );
  }

  const selectedUsers = selectedIds
    .map((id) => users.find((u) => u.user_id === id) ?? initial.find((a) => a.user_id === id))
    .filter((u): u is UserOption => Boolean(u));

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", alignItems: "center" }}>
        {selectedUsers.map((u) => {
          const oc = ownerColor(u.username);
          return (
            <span
              key={u.user_id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.375rem",
                background: oc.bg,
                border: `1px solid color-mix(in srgb, ${oc.fg} 33%, transparent)`,
                borderRadius: 99,
                padding: "0.2rem 0.45rem 0.2rem 0.25rem",
                fontSize: "0.75rem",
                fontWeight: 700,
                color: "var(--text-secondary)",
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: oc.bg,
                  color: oc.fg,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.5625rem",
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                {ownerInitials(u.username)}
              </span>
              {u.username}
              <button
                type="button"
                onClick={() => toggle(u.user_id)}
                aria-label={`${u.username} entfernen`}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-subtle)",
                  padding: 0,
                  display: "inline-flex",
                }}
              >
                <X size={11} strokeWidth={2.5} />
              </button>
            </span>
          );
        })}

        <button
          ref={triggerRef}
          type="button"
          onClick={() => (open ? setOpen(false) : openList())}
          onKeyDown={onTriggerKeyDown}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.3rem",
            background: "var(--surface-50)",
            border: "1px dashed var(--border-bright)",
            borderRadius: 99,
            padding: "0.25rem 0.625rem",
            fontSize: "0.75rem",
            fontWeight: 700,
            color: "var(--text-muted)",
            cursor: "pointer",
            opacity: isPending ? 0.6 : 1,
            transition: "all var(--transition-fast)",
          }}
        >
          <Plus size={11} strokeWidth={2.5} />
          {selectedUsers.length === 0 ? "Zuweisen" : "Mehr"}
          <ChevronDown size={11} style={{ opacity: 0.6 }} />
        </button>
      </div>

      {error && (
        <p style={{ fontSize: "0.6875rem", color: "var(--color-error-text)", margin: "0.375rem 0 0", fontWeight: 600 }}>
          {error}
        </p>
      )}

      {open && (
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-multiselectable="true"
          aria-label="Nutzer zuweisen"
          onKeyDown={onListKeyDown}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 30,
            minWidth: 220,
            background: "var(--surface-100)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-lg)",
            padding: "0.375rem",
            maxHeight: 260,
            overflowY: "auto",
          }}
        >
          {users.length === 0 && (
            <p style={{ fontSize: "0.75rem", color: "var(--text-subtle)", padding: "0.5rem 0.625rem", margin: 0 }}>
              Keine Nutzer verfügbar.
            </p>
          )}
          {users.map((u, i) => {
            const active = selectedIds.includes(u.user_id);
            const oc = ownerColor(u.username);
            return (
              <button
                key={u.user_id}
                type="button"
                role="option"
                aria-selected={active}
                tabIndex={i === activeIndex ? 0 : -1}
                onClick={() => toggle(u.user_id)}
                onFocus={() => setActiveIndex(i)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  background: active ? "var(--surface-150)" : "none",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  padding: "0.4rem 0.5rem",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background var(--transition-fast)",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--surface-150)")}
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLElement).style.background = active ? "var(--surface-150)" : "none")
                }
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: oc.bg,
                    border: `1px solid color-mix(in srgb, ${oc.fg} 40%, transparent)`,
                    color: oc.fg,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.625rem",
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {ownerInitials(u.username)}
                </span>
                <span
                  style={{
                    flex: 1,
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {u.username}
                </span>
                {active && <Check size={13} strokeWidth={2.5} style={{ color: "var(--brand-500)", flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
