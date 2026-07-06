"use client";

import { deleteUserForm } from "@/app/actions/workspace";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Trash2 } from "lucide-react";
import { useTransition } from "react";

// Themen-konformer Löschen-Button für die Nutzerverwaltung: ersetzt das
// frühere window.confirm durch den ConfirmDialog (destructive) und ruft
// anschließend die Server-Action auf (redirect passiert dort).

export function DeleteUserButton({ userId, username }: { userId: string; username: string }) {
  const { confirm, dialog } = useConfirm();
  const [isPending, startTransition] = useTransition();

  async function handleDelete() {
    const ok = await confirm({
      title: "Nutzer löschen?",
      message: `"${username}" wirklich löschen? Alle Daten bleiben erhalten.`,
      confirmLabel: "Löschen",
      cancelLabel: "Abbrechen",
      destructive: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("user_id", userId);
    startTransition(async () => {
      await deleteUserForm(fd);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending}
        title="Nutzer löschen"
        style={{
          background: "var(--color-error-bg)",
          border: "1px solid var(--color-error-border)",
          borderRadius: 8,
          padding: "6px 10px",
          cursor: isPending ? "default" : "pointer",
          color: "var(--color-error-text)",
          display: "flex",
          alignItems: "center",
          gap: "0.25rem",
          fontSize: "0.75rem",
          fontWeight: 600,
          opacity: isPending ? 0.6 : 1,
          transition: "all 0.12s",
        }}
      >
        <Trash2 size={13} />
        {isPending ? "Löschen…" : "Löschen"}
      </button>
      {dialog}
    </>
  );
}
