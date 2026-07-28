"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";

// Themen-konformer Ersatz für window.confirm, aufgebaut auf Modal.
// Destruktive Aktionen nutzen --color-ember/Error-Tokens.

export interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destruktive Aktion: Bestätigen-Button in Ember/Error-Farben. */
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** Spinner auf dem Bestätigen-Button (z. B. während Server-Action). */
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  title = "Bist du sicher?",
  message,
  confirmLabel = "Bestätigen",
  cancelLabel = "Abbrechen",
  destructive = false,
  onConfirm,
  onClose,
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} width={480} closeOnBackdrop={!loading}>
      {message != null && (
        <div style={{ fontSize: "var(--fs-base)", color: "var(--text-secondary)", lineHeight: "var(--lh-base)" }}>
          {message}
        </div>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: "var(--sp-4)",
          marginTop: message != null ? "var(--sp-8)" : 0,
        }}
      >
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? "danger" : "primary"}
          onClick={onConfirm}
          loading={loading}
          // Erst im Bestaetigungs-Dialog wird die Flaeche voll --danger mit
          // dunklem Text (COMPONENTS.md §2.4) — nie Orange fuer Destruktives.
          style={
            destructive
              ? { background: "var(--danger)", color: "#0a0a0b", borderColor: "var(--danger)", fontWeight: 600 }
              : undefined
          }
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

// Convenience-Hook: `const { confirm, dialog } = useConfirm();`
// `dialog` einmal ins JSX rendern, dann `if (await confirm({...})) …`.

export type ConfirmOptions = Omit<ConfirmDialogProps, "open" | "onConfirm" | "onClose" | "loading">;

export function useConfirm(): {
  confirm: (opts?: ConfirmOptions) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [state, setState] = useState<{
    opts: ConfirmOptions;
    resolve: (result: boolean) => void;
  } | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions = {}) =>
      new Promise<boolean>((resolve) => {
        setState({ opts, resolve });
      }),
    [],
  );

  const dialog: ReactNode = state ? (
    <ConfirmDialog
      open
      {...state.opts}
      onConfirm={() => {
        state.resolve(true);
        setState(null);
      }}
      onClose={() => {
        state.resolve(false);
        setState(null);
      }}
    />
  ) : null;

  return { confirm, dialog };
}
