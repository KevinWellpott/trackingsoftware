"use client";

import { renameUserForm } from "@/app/actions/workspace";
import { Check, Pencil, X } from "lucide-react";
import { useState, useTransition } from "react";

export function RenameUserButton({ userId, username }: { userId: string; username: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(username);
  const [isPending, startTransition] = useTransition();

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setValue(username); setEditing(true); }}
        title="Umbenennen"
        style={{
          background: "var(--surface-150)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-full)",
          padding: "6px 8px",
          cursor: "pointer",
          color: "var(--text-subtle)",
          display: "flex",
          alignItems: "center",
        }}
      >
        <Pencil size={13} />
      </button>
    );
  }

  function handleSave() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === username) { setEditing(false); return; }
    const fd = new FormData();
    fd.set("user_id", userId);
    fd.set("username", trimmed);
    startTransition(async () => {
      await renameUserForm(fd);
    });
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
      <input
        autoFocus
        value={value}
        disabled={isPending}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") setEditing(false);
        }}
        style={{
          background: "var(--surface-0)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "0.3rem 0.5rem",
          fontSize: "0.8125rem",
          color: "var(--text-primary)",
          outline: "none",
          width: 140,
        }}
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={isPending}
        title="Speichern"
        style={{ background: "var(--color-success-bg)", border: "1px solid var(--color-success-border)", borderRadius: "var(--r-full)", padding: "6px", cursor: "pointer", color: "var(--color-success-text)", display: "flex" }}
      >
        <Check size={13} />
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        disabled={isPending}
        title="Abbrechen"
        style={{ background: "var(--surface-150)", border: "1px solid var(--border)", borderRadius: "var(--r-full)", padding: "6px", cursor: "pointer", color: "var(--text-subtle)", display: "flex" }}
      >
        <X size={13} />
      </button>
    </div>
  );
}
