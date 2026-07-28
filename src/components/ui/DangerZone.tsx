"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ui/ConfirmDialog";

// Danger-Zone (COMPONENTS.md §15): eigene Karte am Seitenende, Danger-Rahmen,
// Titel in --danger-fg, destruktiver Button. Nie Orange — Loeschen ist kein
// Akzent, sondern eine Warnung.
//
// Bewusst am Ende und optisch abgesetzt: wer bis hierher scrollt, sucht das
// hier. Ueber dem Fold hat ein Loeschen-Button nichts verloren.

export function DangerZone({
  title,
  description,
  confirmTitle,
  confirmMessage,
  confirmLabel = "Endgültig löschen",
  onDelete,
  redirectTo,
  children,
}: {
  title: string;
  description: ReactNode;
  confirmTitle: string;
  confirmMessage: ReactNode;
  confirmLabel?: string;
  onDelete: () => Promise<{ error?: string }>;
  /** Wohin nach erfolgreichem Loeschen. */
  redirectTo: string;
  children?: ReactNode;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    const ok = await confirm({
      title: confirmTitle,
      message: confirmMessage,
      confirmLabel,
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    const res = await onDelete();
    if (res?.error) {
      setError(res.error);
      setBusy(false);
      return;
    }
    // Der Datensatz ist weg — zurueck zur Uebersicht, nicht auf eine 404.
    router.replace(redirectTo);
    router.refresh();
  }

  return (
    <div
      style={{
        border: "1px solid rgb(214 90 82 / 0.40)",
        borderRadius: "var(--r-lg)",
        background: "var(--surface-2)",
        padding: "var(--sp-7) var(--sp-8)",
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-7)",
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: "1 1 280px", minWidth: 0 }}>
        <div
          style={{
            fontSize: "var(--fs-md)",
            fontWeight: 600,
            letterSpacing: "var(--ls-tight)",
            color: "var(--danger-fg)",
            marginBottom: "var(--sp-3)",
          }}
        >
          {title}
        </div>
        <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-muted)", lineHeight: "var(--lh-base)" }}>
          {description}
        </p>
        {error && (
          <p role="alert" style={{ margin: "var(--sp-4) 0 0", fontSize: "var(--fs-sm)", color: "var(--danger-fg)" }}>
            {error}
          </p>
        )}
        {children}
      </div>

      <button
        type="button"
        className="btn-danger"
        onClick={handleDelete}
        disabled={busy}
        style={{ height: "var(--h-control-lg)", flexShrink: 0 }}
      >
        <Trash2 size={15} /> {busy ? "Wird gelöscht…" : "Löschen"}
      </button>

      {dialog}
    </div>
  );
}
