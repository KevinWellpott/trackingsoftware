"use client";

import { setAssignees, type AssigneeEntity } from "@/app/actions/assignees";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

// Kompakter Multi-Select für Call-Zuweisungen (Setter/Closer).
// Auswahl als entfernbare Chips mit Initialen; Änderungen werden sofort
// per setAssignees gespeichert. Wird von Setting UND Closing genutzt.

type UserOption = { user_id: string; username: string };

type Props = {
  entityType: AssigneeEntity;
  entityId: string;
  users: UserOption[];
  initial: UserOption[];
};

const CHIP_PALETTE = ["#6366f1", "#8b5cf6", "#10b981", "#0ea5e9", "#f59e0b", "#ec4899", "#14b8a6"];

function chipColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
  return CHIP_PALETTE[hash % CHIP_PALETTE.length];
}

export function AssigneeMultiSelect({ entityType, entityId, users, initial }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() => initial.map((a) => a.user_id));
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

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
          const color = chipColor(u.username);
          return (
            <span
              key={u.user_id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.375rem",
                background: `${color}18`,
                border: `1px solid ${color}55`,
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
                  background: color,
                  color: "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.5625rem",
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                {u.username.charAt(0).toUpperCase()}
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
          type="button"
          onClick={() => setOpen((v) => !v)}
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
          {users.map((u) => {
            const active = selectedIds.includes(u.user_id);
            const color = chipColor(u.username);
            return (
              <button
                key={u.user_id}
                type="button"
                onClick={() => toggle(u.user_id)}
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
                    background: `${color}22`,
                    border: `1px solid ${color}66`,
                    color,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.625rem",
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {u.username.charAt(0).toUpperCase()}
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
