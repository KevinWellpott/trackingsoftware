"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, AlertTriangle, X } from "lucide-react";
import { deleteList } from "@/app/actions/lists";

type Props = {
  listId: string;
  listName: string;
  contactCount: number;
};

export function DeleteListButton({ listId, listName, contactCount }: Props) {
  const [step, setStep]       = useState<"idle" | "confirm">("idle");
  const [typed, setTyped]     = useState("");
  const [isPending, start]    = useTransition();
  const router                = useRouter();

  const confirmed = typed.trim().toLowerCase() === listName.trim().toLowerCase();

  function handleDelete() {
    if (!confirmed) return;
    start(async () => {
      await deleteList(listId);
      router.push("/");
    });
  }

  if (step === "idle") {
    return (
      <button
        type="button"
        onClick={() => setStep("confirm")}
        style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", padding: "0.4rem 0.875rem", borderRadius: "var(--r-full)", border: "1px solid var(--color-error-border)", background: "var(--color-error-bg)", color: "var(--color-error-text)", fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer", transition: "all 0.15s" }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "color-mix(in srgb, var(--color-error-text) 12%, transparent)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "color-mix(in srgb, var(--color-error-text) 40%, transparent)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--color-error-bg)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-error-border)"; }}
      >
        <Trash2 size={13} />
        Liste löschen
      </button>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
      <div style={{ background: "var(--surface-100)", border: "1px solid var(--color-error-border)", borderRadius: 16, padding: "1.75rem 2rem", maxWidth: 420, width: "calc(100% - 2rem)", boxShadow: "var(--shadow-lg)" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--color-error-bg)", border: "1px solid var(--color-error-border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <AlertTriangle size={18} color="var(--color-error-text)" />
            </div>
            <div>
              <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-primary)" }}>Liste wirklich löschen?</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-subtle)", marginTop: 1 }}>Diese Aktion kann nicht rückgängig gemacht werden</div>
            </div>
          </div>
          <button type="button" onClick={() => { setStep("idle"); setTyped(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-subtle)", padding: 4, borderRadius: "var(--r-full)", display: "flex" }}>
            <X size={16} />
          </button>
        </div>

        {/* Warning box */}
        <div style={{ background: "var(--color-error-bg)", border: "1px solid var(--color-error-border)", borderRadius: 10, padding: "0.875rem 1rem", marginBottom: "1.25rem" }}>
          <div style={{ fontSize: "0.8125rem", color: "var(--color-error-text)", fontWeight: 600, marginBottom: "0.375rem" }}>
            &quot;{listName}&quot;
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-subtle)", lineHeight: 1.5 }}>
            {contactCount > 0 ? (
              <><span style={{ color: "var(--color-error-text)", fontWeight: 600 }}>{contactCount} Kontakte</span> werden unwiderruflich gelöscht.</>
            ) : (
              "Die Liste ist leer und wird gelöscht."
            )}
          </div>
        </div>

        {/* Confirmation input */}
        <div style={{ marginBottom: "1.25rem" }}>
          <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-subtle)", marginBottom: "0.5rem" }}>
            Tippe <span style={{ color: "var(--color-error-text)", fontFamily: "monospace", background: "var(--color-error-bg)", padding: "1px 5px", borderRadius: 4 }}>{listName}</span> zur Bestätigung:
          </label>
          <input
            type="text"
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && confirmed) handleDelete(); if (e.key === "Escape") { setStep("idle"); setTyped(""); } }}
            placeholder={listName}
            style={{ width: "100%", boxSizing: "border-box", background: "var(--surface-0)", border: `1px solid ${confirmed ? "var(--color-error-border)" : "var(--border)"}`, borderRadius: 8, padding: "0.5rem 0.75rem", fontSize: "0.875rem", color: "var(--text-primary)", outline: "none", transition: "border-color 0.15s" }}
          />
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: "0.625rem" }}>
          <button type="button" onClick={() => { setStep("idle"); setTyped(""); }}
            style={{ flex: 1, padding: "0.5rem", borderRadius: "var(--r-full)", border: "1px solid var(--border)", background: "transparent", color: "var(--text-subtle)", fontSize: "0.875rem", fontWeight: 600, cursor: "pointer" }}>
            Abbrechen
          </button>
          <button type="button" onClick={handleDelete} disabled={!confirmed || isPending}
            style={{
              flex: 1,
              minHeight: "var(--h-control-lg)",
              padding: "0 var(--sp-7)",
              borderRadius: "var(--r-full)",
              border: "none",
              // Bestaetigter Destruktiv-Button: volle Danger-Flaeche mit
              // dunklem Text (COMPONENTS.md 2.4) — nie Orange, nie Weiss auf Rot.
              background: confirmed ? "var(--danger)" : "var(--surface-3)",
              color: confirmed ? "#0a0a0b" : "var(--text-disabled)",
              fontSize: "var(--fs-base)",
              fontFamily: "inherit",
              fontWeight: 600,
              cursor: confirmed ? "pointer" : "not-allowed",
              transition: "background var(--transition-fast), color var(--transition-fast)",
            }}>
            {isPending ? "Wird gelöscht…" : "Endgültig löschen"}
          </button>
        </div>
      </div>
    </div>
  );
}
