"use client";

import { createContact } from "@/app/actions/contacts";
import { Modal } from "@/components/ui/Modal";
import { Check, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

const LAST_LIST_KEY = "qt_last_list";

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Globaler Schnell-Eintrag: Floating Button + Ctrl/Cmd+K → LinkedIn-Kontakt in
// Sekunden anlegen. Modal bleibt für Rapid-Multi-Add offen.
export function QuickAddLinkedIn({
  lists,
}: {
  lists: { id: string; name: string; owner_name: string | null }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [listId, setListId] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [isPending, startTransition] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Zuletzt genutzte Liste vorauswählen (localStorage), sonst erste Liste.
  useEffect(() => {
    if (!open) return;
    const remembered = typeof window !== "undefined" ? localStorage.getItem(LAST_LIST_KEY) : null;
    setListId((prev) => {
      if (prev && lists.some((l) => l.id === prev)) return prev;
      if (remembered && lists.some((l) => l.id === remembered)) return remembered;
      return lists[0]?.id ?? "";
    });
    setError(null);
  }, [open, lists]);

  // Keyboard-Shortcut Ctrl/Cmd+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!listId || !trimmedName) {
      setError("Liste und Name sind erforderlich.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createContact({
        list_id: listId,
        name: trimmedName,
        linkedin_url: url.trim() || null,
        pitched_at: localToday(),
      });
      if (res?.error) {
        setError(res.error);
        return;
      }
      localStorage.setItem(LAST_LIST_KEY, listId);
      // Modal offen lassen für Rapid-Multi-Add
      setName("");
      setUrl("");
      setFlash(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(false), 1600);
      nameRef.current?.focus();
      router.refresh();
    });
  }

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.75rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    marginBottom: "0.375rem",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    background: "var(--surface-50)",
    border: "1px solid var(--border-bright)",
    borderRadius: "var(--radius-sm)",
    padding: "0.5rem 0.75rem",
    fontSize: "0.875rem",
    color: "var(--text-primary)",
    outline: "none",
  };

  return (
    <>
      {/* Floating Action Button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Schnell tracken (Strg/Cmd+K)"
        style={{
          position: "fixed",
          right: "1.5rem",
          bottom: "1.5rem",
          zIndex: 40,
          display: "inline-flex",
          alignItems: "center",
          gap: "0.5rem",
          background: "var(--btn-primary-bg)",
          color: "var(--btn-primary-fg)",
          border: "none",
          borderRadius: 999,
          padding: "0.625rem 1.125rem",
          fontSize: "0.875rem",
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <Zap size={15} /> Schnell-Track
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Schnell tracken"
        subtitle="Neuen LinkedIn-Kontakt in Sekunden anlegen"
        width={440}
      >
        {lists.length === 0 ? (
          <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", margin: 0 }}>
            Lege zuerst eine Liste an.
          </p>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label htmlFor="qt-list" style={labelStyle}>Liste</label>
              <select
                id="qt-list"
                required
                value={listId}
                onChange={(e) => setListId(e.target.value)}
                style={{ ...inputStyle, cursor: "pointer" }}
              >
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.owner_name ? `${l.owner_name} — ${l.name}` : l.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="qt-name" style={labelStyle}>Name</label>
              <input
                id="qt-name"
                ref={nameRef}
                autoFocus
                required
                placeholder="Vor- und Nachname…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label htmlFor="qt-url" style={labelStyle}>LinkedIn-URL (optional)</label>
              <input
                id="qt-url"
                type="url"
                placeholder="https://www.linkedin.com/in/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                style={inputStyle}
              />
            </div>

            {error && (
              <div
                style={{
                  fontSize: "0.8125rem",
                  color: "var(--color-error-text)",
                  background: "var(--color-error-bg)",
                  border: "1px solid var(--color-error-border)",
                  borderRadius: "var(--radius-sm)",
                  padding: "0.5rem 0.75rem",
                }}
              >
                {error}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <button
                type="submit"
                disabled={isPending}
                style={{
                  background: "var(--btn-primary-bg)",
                  color: "var(--btn-primary-fg)",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  padding: "0.5625rem 1.125rem",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  cursor: isPending ? "default" : "pointer",
                  opacity: isPending ? 0.6 : 1,
                  transition: "opacity 0.15s",
                }}
              >
                {isPending ? "Speichern…" : "Hinzufügen"}
              </button>
              {flash && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.25rem",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    color: "var(--color-success-text)",
                  }}
                >
                  <Check size={14} /> hinzugefügt
                </span>
              )}
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
