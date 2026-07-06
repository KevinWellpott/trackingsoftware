"use client";

import { deletePhoneList } from "@/app/actions/phone";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

// Löscht eine komplette Telefonliste (Leads hängen per ON DELETE CASCADE dran).
// Zwei Darstellungen: voller Button (Listen-Detailseite) oder icon-only
// (Listen-Karten auf der Übersicht; dort stoppt der Click die Link-Navigation).

export function DeletePhoneListButton({
  listId,
  listName,
  redirectTo,
  iconOnly = false,
}: {
  listId: string;
  listName: string;
  redirectTo?: string;
  /** Nur das Trash-Icon rendern (für Listen-Karten). */
  iconOnly?: boolean;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    // Karten sind Links — Navigation/Bubbling unterbinden.
    e.preventDefault();
    e.stopPropagation();
    const ok = await confirm({
      title: "Liste löschen?",
      message: `Liste "${listName}" und alle enthaltenen Leads löschen?`,
      confirmLabel: "Löschen",
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deletePhoneList(listId);
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  if (iconOnly) {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClick}
          loading={isPending}
          aria-label={`Liste "${listName}" löschen`}
          title={error ?? "Liste löschen"}
          icon={<Trash2 size={13} />}
          style={{
            minHeight: 0,
            padding: "0.25rem",
            color: error ? "var(--color-error-text)" : "var(--text-subtle)",
          }}
        />
        {dialog}
      </>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleClick}
        loading={isPending}
        icon={<Trash2 size={13} />}
        style={{ color: "var(--color-error-text)" }}
      >
        Liste löschen
      </Button>
      {error && (
        <span role="alert" style={{ fontSize: "0.75rem", color: "var(--color-error-text)" }}>
          {error}
        </span>
      )}
      {dialog}
    </>
  );
}
