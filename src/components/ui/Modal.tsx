"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// Leichtgewichtiges, token-gestyltes Modal. Wiederverwendbar in allen Bereichen.
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 460,
  closeOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  width?: number;
  closeOnBackdrop?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "12vh 1rem 1rem",
        background: "rgb(0 0 0 / 0.45)",
        backdropFilter: "blur(2px)",
        animation: "fade-up 0.15s ease both",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: "100%",
          maxWidth: width,
          background: "var(--surface-100)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {(title || subtitle) && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "0.75rem",
              padding: "1.125rem 1.375rem",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              {title && (
                <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
                  {title}
                </div>
              )}
              {subtitle && (
                <div style={{ fontSize: "0.8125rem", color: "var(--text-subtle)", marginTop: 2 }}>{subtitle}</div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Schließen"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--text-subtle)",
                padding: 4,
                borderRadius: "var(--radius-sm)",
                display: "flex",
                flexShrink: 0,
              }}
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div style={{ padding: "1.25rem 1.375rem", overflowY: "auto" }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
