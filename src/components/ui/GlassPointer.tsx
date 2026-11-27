"use client";

import { useEffect } from "react";

// Glanz folgt dem Zeiger — EIN passiver Listener fuer die ganze App.
//
//   .glass           → --lx (Position des Lichtflecks oben in %)
//   Primaerknopf     → --mx / --my (Lichtkreis unter dem Zeiger in px)
//
// Gesetzt wird nur auf dem Element unter dem Zeiger, nie im Render — kein
// React-Zustand, kein Neuzeichnen. Bei „weniger Bewegung" bleibt der Glanz
// an seiner Ruhestelle (Vorgabewerte in globals.css).

const SELECTOR = ".glass, .ui-btn[data-variant='primary'], .btn-primary";

export function GlassPointer() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    function onMove(e: PointerEvent) {
      if (e.pointerType !== "mouse") return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      const el = target.closest<HTMLElement>(SELECTOR);
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (el.classList.contains("glass")) {
        el.style.setProperty("--lx", `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
      } else {
        el.style.setProperty("--mx", `${Math.round(e.clientX - r.left)}px`);
        el.style.setProperty("--my", `${Math.round(e.clientY - r.top)}px`);
      }
    }
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => document.removeEventListener("pointermove", onMove);
  }, []);
  return null;
}
