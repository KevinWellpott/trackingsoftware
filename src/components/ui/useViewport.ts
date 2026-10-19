"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

// Gemeinsame Viewport-Hooks für Handy-Sheets (AnchoredPopover, Modal).
// Unter 768px werden beide zu Bottom-Sheets; dort entscheidet die Tastatur,
// wie viel vom Bildschirm überhaupt noch sichtbar ist.

const SHEET_QUERY = "(max-width: 767px)";

function subscribeSheet(onChange: () => void) {
  const mq = window.matchMedia(SHEET_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** true unter 768px — dort sind Popover und Dialoge Bottom-Sheets. */
export function useSheetMode(): boolean {
  return useSyncExternalStore(
    subscribeSheet,
    () => window.matchMedia(SHEET_QUERY).matches,
    () => false,
  );
}

export type KeyboardInset = {
  /** Abstand des sichtbaren Bildschirms zum oberen Layout-Rand (iOS schiebt ihn beim Fokus). */
  top: number;
  /** Abstand zum unteren Layout-Rand — praktisch die Höhe der Tastatur. */
  bottom: number;
  /** Höhe des sichtbaren Bildschirms. */
  height: number;
};

/**
 * Lage des sichtbaren Bildschirms (`visualViewport`) im Layout-Viewport.
 * `position: fixed` hängt am Layout-Viewport — die Tastatur verkleinert aber
 * nur den sichtbaren. Ohne diese Werte läge alles, was unten klebt, hinter ihr.
 */
export function useKeyboardInset(active: boolean): KeyboardInset {
  const [inset, setInset] = useState<KeyboardInset>({ top: 0, bottom: 0, height: 0 });
  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    function update() {
      const height = vv ? vv.height : window.innerHeight;
      const top = vv ? Math.max(0, vv.offsetTop) : 0;
      const bottom = vv ? Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)) : 0;
      setInset({ top, bottom, height });
    }
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [active]);
  return inset;
}
