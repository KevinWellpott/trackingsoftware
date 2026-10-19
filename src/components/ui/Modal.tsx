"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useKeyboardInset, useSheetMode } from "./useViewport";

// Leichtgewichtiges, token-gestyltes Modal. Wiederverwendbar in allen Bereichen.
// A11y: Focus-Trap (Tab/Shift+Tab), Fokus-Restore beim Schließen,
// aria-labelledby auf den Titel; Backdrop schließt nur, wenn mousedown UND
// mouseup auf dem Backdrop landen (kein Schließen beim Drag-Select).

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropMouseDown = useRef(false);
  const titleId = useId();
  const sheet = useSheetMode();
  const keyboard = useKeyboardInset(open && sheet);
  // Ab gut 80px fehlender Höhe ist es die Tastatur, nicht die Adressleiste.
  const keyboardOpen = sheet && keyboard.bottom > 80;

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusables = Array.from(
          dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        );
        if (focusables.length === 0) {
          e.preventDefault();
          dialog.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        const inside = active instanceof Node && dialog.contains(active);
        if (e.shiftKey) {
          if (!inside || active === first) {
            e.preventDefault();
            last.focus();
          }
        } else if (!inside || active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // Fokus beim Öffnen ins Modal setzen, beim Schließen zurückgeben.
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const active = document.activeElement;
    // Hat ein Feld im Modal den Fokus schon selbst genommen (`autoFocus` —
    // React setzt ihn VOR diesem Effekt), bleibt er dort. Vorher zog dieser
    // Effekt ihn auf das erste fokussierbare Element, den Schließen-Knopf im
    // Kopf: Wer die Suche öffnete und sofort tippte, tippte ins Leere.
    const focusAlreadyInside = !!dialog && active instanceof Node && dialog.contains(active);
    const prevActive = !focusAlreadyInside && active instanceof HTMLElement ? active : null;
    if (dialog && !focusAlreadyInside) {
      const first = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? dialog).focus();
    }
    return () => {
      prevActive?.focus();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      onMouseDown={(e) => {
        backdropMouseDown.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        const upOnBackdrop = e.target === e.currentTarget;
        if (closeOnBackdrop && backdropMouseDown.current && upOnBackdrop) onClose();
        backdropMouseDown.current = false;
      }}
      // Am Handy ein Bottom-Sheet (globals.css, `.ui-modal-scrim`): von unten,
      // volle Breite, Knöpfe im Daumenbereich statt in der oberen Bildhälfte.
      //
      // Bei offener Tastatur sitzt das Sheet genau im sichtbaren Bildschirm:
      // `position: fixed` hängt am Layout-Viewport, und der reicht unter die
      // Tastatur — Speichern-Knopf und das gerade getippte Feld lagen dahinter.
      className="ui-modal-scrim"
      data-keyboard={keyboardOpen ? "" : undefined}
      style={{
        position: "fixed",
        top: keyboardOpen ? keyboard.top : 0,
        right: 0,
        bottom: keyboardOpen ? keyboard.bottom : 0,
        left: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "12vh 1rem 1rem",
        background: "var(--surface-scrim)",
        animation: "modal-scrim var(--dur-2) var(--ease-out) both",
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className="ui-modal"
        // Das fokussierte Feld nach dem Aufgehen der Tastatur in die Mitte
        // holen — sonst steht es unter der klebenden Knopf-Reihe.
        onFocus={(e) => {
          if (!sheet) return;
          const t = e.target;
          if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement)) return;
          window.setTimeout(() => t.scrollIntoView({ block: "center", behavior: "smooth" }), 320);
        }}
        style={{
          width: "100%",
          maxWidth: width,
          // Dialoge sind bewusst SOLID (surface-4) — Inhalte muessen ruhig
          // lesbar sein. Glas bleibt Nav, Popover und Palette vorbehalten.
          background: "var(--surface-4)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--r-xl)",
          boxShadow: "var(--shadow-overlay)",
          overflow: "hidden",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          outline: "none",
          animation: "modal-enter var(--dur-3) var(--ease-spring) both",
        }}
      >
        {(title || subtitle) && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "var(--sp-5)",
              padding: "var(--sp-7) var(--sp-8)",
              borderBottom: "1px solid var(--border-default)",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              {title && (
                <div
                  id={titleId}
                  style={{
                    fontSize: "var(--fs-md)",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    letterSpacing: "var(--ls-tight)",
                  }}
                >
                  {title}
                </div>
              )}
              {subtitle && (
                <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", marginTop: 2 }}>{subtitle}</div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Schließen"
              className="ui-btn ui-modal-close"
              data-variant="ghost"
              style={{
                width: 28,
                height: 28,
                minHeight: 28,
                padding: 0,
                background: "transparent",
                border: "1px solid transparent",
                color: "var(--text-muted)",
                flexShrink: 0,
              }}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="ui-modal-body" style={{ padding: "var(--sp-8)", overflowY: "auto" }}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
