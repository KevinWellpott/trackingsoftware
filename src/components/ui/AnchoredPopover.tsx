"use client";

import { useLayoutEffect, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Gemeinsamer Unterbau fuer alle Dropdowns im Brand-Design (Kalender, Select,
// Uhrzeit). Vorher lag diese Logik nur im DatePicker; jeder weitere Selektor
// haette sie kopiert.
//
// Warum Portal + position:fixed: die Selektoren stehen u. a. in der
// virtualisierten Kontakt-Tabelle und in Modals. Ein absolut positioniertes
// Popover wuerde dort am naechsten overflow-Container abgeschnitten.

const GAP = 6;
const EDGE = 8;

export type PopoverAlign = "start" | "end";

/**
 * Misst das Popover NACH dem ersten Paint und klappt bei Platzmangel nach oben.
 * Bis die Messung steht, wird es unsichtbar (nicht `display:none`) gerendert —
 * sonst haette es keine Hoehe, die man messen koennte.
 */
export function AnchoredPopover({
  anchor,
  onClose,
  children,
  label,
  id,
  width,
  align = "start",
  maxHeight,
  role = "dialog",
  className = "glass-popover",
  style,
  popoverRef,
}: {
  anchor: DOMRect;
  onClose: () => void;
  children: React.ReactNode;
  label: string;
  id?: string;
  /** Feste Breite; ohne Angabe mindestens so breit wie der Trigger. */
  width?: number;
  align?: PopoverAlign;
  maxHeight?: number;
  role?: "dialog" | "listbox";
  className?: string;
  style?: React.CSSProperties;
  popoverRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const ref = popoverRef ?? innerRef;
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    const fitsBelow = anchor.bottom + GAP + h <= window.innerHeight;
    const fitsAbove = anchor.top - GAP - h >= 0;
    const below = fitsBelow || !fitsAbove;
    const rawLeft = align === "end" ? anchor.right - w : anchor.left;
    setPos({
      top: below ? anchor.bottom + GAP : anchor.top - GAP - h,
      left: Math.max(EDGE, Math.min(rawLeft, window.innerWidth - w - EDGE)),
    });
  }, [anchor, align, ref]);

  // Outside-Click, Escape, Scroll und Resize schliessen. Scrollen innerhalb des
  // Popovers (lange Optionsliste) ist ausgenommen, sonst schliesst es sich
  // beim Blaettern selbst.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onScroll(e: Event) {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose, ref]);

  return createPortal(
    <div
      ref={ref}
      id={id}
      role={role}
      aria-label={label}
      className={className}
      style={{
        position: "fixed",
        top: pos?.top ?? anchor.bottom + GAP,
        left: pos?.left ?? anchor.left,
        zIndex: 130,
        boxSizing: "border-box",
        width,
        minWidth: width ?? anchor.width,
        maxHeight,
        overflowY: maxHeight ? "auto" : undefined,
        visibility: pos ? "visible" : "hidden",
        animation: pos ? "fade-up var(--dur-2) var(--ease-out) both" : undefined,
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Trigger-Rect holen bzw. beim zweiten Klick wieder schliessen. */
export function useAnchor() {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLElement | null>(null);
  function toggle() {
    const rect = ref.current?.getBoundingClientRect();
    setAnchor((a) => (a || !rect ? null : rect));
  }
  function open() {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setAnchor(rect);
  }
  return { anchor, setAnchor, ref, toggle, open, close: () => setAnchor(null) };
}
