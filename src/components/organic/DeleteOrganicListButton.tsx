"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, AlertTriangle, X } from "lucide-react";
import { deleteOrganicList } from "@/app/actions/organic";

type Props = {
  listId: string;
  listName: string;
  postCount: number;
};

export function DeleteOrganicListButton({ listId, listName, postCount }: Props) {
  const [step, setStep]    = useState<"idle" | "confirm">("idle");
  const [typed, setTyped]  = useState("");
  const [isPending, start] = useTransition();
  const router = useRouter();

  const confirmed = typed.trim().toLowerCase() === listName.trim().toLowerCase();

  function handleDelete() {
    if (!confirmed) return;
    start(async () => {
      await deleteOrganicList(listId);
      router.push("/organic");
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setStep("confirm")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.375rem",
          padding: "0.375rem 0.75rem",
          background: "rgba(248,113,113,0.08)",
          border: "1px solid rgba(248,113,113,0.2)",
          borderRadius: 8,
          color: "#f87171",
          fontSize: "0.8125rem",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        <Trash2 size={13} />
        Serie löschen
      </button>

      {step === "confirm" && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
          onClick={(e) => { if (e.target === e.currentTarget) setStep("idle"); }}
        >
          <div style={{ background: "var(--surface-100)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 14, padding: "1.75rem", maxWidth: 420, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.8)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <AlertTriangle size={18} color="#f87171" />
                <span style={{ fontWeight: 700, fontSize: "1rem", color: "#f87171" }}>Serie löschen</span>
              </div>
              <button type="button" onClick={() => setStep("idle")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-subtle)" }}>
                <X size={16} />
              </button>
            </div>
            <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: "1rem", lineHeight: 1.6 }}>
              Diese Aktion löscht die Serie <strong style={{ color: "var(--text-primary)" }}>{listName}</strong> und alle <strong style={{ color: "#f87171" }}>{postCount} Posts</strong> darin unwiderruflich.
            </p>
            <p style={{ fontSize: "0.8125rem", color: "var(--text-subtle)", marginBottom: "0.5rem" }}>
              Tippe <strong style={{ color: "var(--text-primary)" }}>{listName}</strong> zum Bestätigen:
            </p>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={listName}
              style={{
                width: "100%",
                background: "var(--surface-0)",
                border: `1px solid ${confirmed ? "rgba(248,113,113,0.5)" : "var(--border)"}`,
                borderRadius: 8,
                padding: "0.5rem 0.75rem",
                fontSize: "0.875rem",
                color: "var(--text-primary)",
                outline: "none",
                marginBottom: "1rem",
              }}
            />
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                onClick={() => setStep("idle")}
                style={{ flex: 1, background: "var(--surface-200)", border: "none", borderRadius: 8, padding: "0.5rem", fontSize: "0.875rem", color: "var(--text-secondary)", cursor: "pointer" }}
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!confirmed || isPending}
                style={{
                  flex: 1,
                  background: confirmed ? "#f87171" : "var(--surface-200)",
                  border: "none",
                  borderRadius: 8,
                  padding: "0.5rem",
                  fontSize: "0.875rem",
                  fontWeight: 700,
                  color: confirmed ? "white" : "var(--text-subtle)",
                  cursor: confirmed ? "pointer" : "not-allowed",
                  transition: "all 0.15s",
                  opacity: isPending ? 0.7 : 1,
                }}
              >
                {isPending ? "Löschen…" : "Endgültig löschen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
