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
    <Modal open={open} onClose={onClose} title={title} width={400} closeOnBackdrop={!loading}>
      {message != null && (
        <div style={{ fontSize: "0.875rem", color: "var(--text-muted)", lineHeight: 1.55 }}>
          {message}
        </div>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: "0.5rem",
          marginTop: message != null ? "1.25rem" : 0,
        }}
      >
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? "danger" : "primary"}
          onClick={onConfirm}
          loading={loading}
          style={
            destructive
              ? {
                  background: "var(--color-ember)",
                  color: "#ffffff",
                  borderColor: "transparent",
                }
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
