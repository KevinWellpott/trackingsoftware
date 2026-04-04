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
        style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", padding: "0.4rem 0.875rem", borderRadius: 8, border: "1px solid rgba(248,113,113,0.25)", background: "rgba(248,113,113,0.06)", color: "#f87171", fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer", transition: "all 0.15s" }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(248,113,113,0.12)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(248,113,113,0.4)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(248,113,113,0.06)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(248,113,113,0.25)"; }}
      >
        <Trash2 size={13} />
        Liste löschen
      </button>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
      <div style={{ background: "#0d0d10", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 16, padding: "1.75rem 2rem", maxWidth: 420, width: "calc(100% - 2rem)", boxShadow: "0 0 50px rgba(248,113,113,0.12), 0 24px 48px rgba(0,0,0,0.6)" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <AlertTriangle size={18} color="#f87171" />
            </div>
            <div>
              <div style={{ fontSize: "1rem", fontWeight: 800, color: "#fafafa" }}>Liste wirklich löschen?</div>
              <div style={{ fontSize: "0.75rem", color: "#71717a", marginTop: 1 }}>Diese Aktion kann nicht rückgängig gemacht werden</div>
            </div>
          </div>
          <button type="button" onClick={() => { setStep("idle"); setTyped(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#52525b", padding: 4, borderRadius: 6, display: "flex" }}>
            <X size={16} />
          </button>
        </div>

        {/* Warning box */}
        <div style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.18)", borderRadius: 10, padding: "0.875rem 1rem", marginBottom: "1.25rem" }}>
          <div style={{ fontSize: "0.8125rem", color: "#fca5a5", fontWeight: 600, marginBottom: "0.375rem" }}>
            "{listName}"
          </div>
          <div style={{ fontSize: "0.75rem", color: "#71717a", lineHeight: 1.5 }}>
            {contactCount > 0 ? (
              <><span style={{ color: "#f87171", fontWeight: 700 }}>{contactCount} Kontakte</span> werden unwiderruflich gelöscht.</>
            ) : (
              "Die Liste ist leer und wird gelöscht."
            )}
          </div>
        </div>

        {/* Confirmation input */}
        <div style={{ marginBottom: "1.25rem" }}>
          <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#71717a", marginBottom: "0.5rem" }}>
            Tippe <span style={{ color: "#fca5a5", fontFamily: "monospace", background: "rgba(248,113,113,0.08)", padding: "1px 5px", borderRadius: 4 }}>{listName}</span> zur Bestätigung:
          </label>
          <input
            type="text"
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && confirmed) handleDelete(); if (e.key === "Escape") { setStep("idle"); setTyped(""); } }}
            placeholder={listName}
            style={{ width: "100%", boxSizing: "border-box", background: "#09090b", border: `1px solid ${confirmed ? "rgba(248,113,113,0.5)" : "#27272a"}`, borderRadius: 8, padding: "0.5rem 0.75rem", fontSize: "0.875rem", color: "#fafafa", outline: "none", transition: "border-color 0.15s" }}
          />
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: "0.625rem" }}>
          <button type="button" onClick={() => { setStep("idle"); setTyped(""); }}
            style={{ flex: 1, padding: "0.5rem", borderRadius: 8, border: "1px solid #27272a", background: "transparent", color: "#71717a", fontSize: "0.875rem", fontWeight: 600, cursor: "pointer" }}>
            Abbrechen
          </button>
          <button type="button" onClick={handleDelete} disabled={!confirmed || isPending}
            style={{ flex: 1, padding: "0.5rem", borderRadius: 8, border: "none", background: confirmed ? "#ef4444" : "#1c1c1f", color: confirmed ? "white" : "#3f3f46", fontSize: "0.875rem", fontWeight: 700, cursor: confirmed ? "pointer" : "not-allowed", transition: "all 0.15s", boxShadow: confirmed ? "0 0 16px rgba(239,68,68,0.35)" : "none" }}>
            {isPending ? "Wird gelöscht…" : "Endgültig löschen"}
          </button>
        </div>
      </div>
    </div>
  );
}
