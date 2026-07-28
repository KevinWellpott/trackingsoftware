"use client";

import { addDaysISO } from "@/lib/dates";
import type { TerminEvent } from "@/lib/termine";
import { useCallback, useRef, useState } from "react";

// Drag & Drop im Kalender — bewusst mit Pointer-Events statt einer Library:
// passt zum handgebauten Stil des Projekts, kostet keine Abhängigkeit und
// erlaubt exaktes Snapping aufs 15-Minuten-Raster.
//
// Die Mechanik ist in beiden Ansichtsarten dieselbe, nur die Umrechnung von
// Pixeln in einen Ziel-Slot unterscheidet sich:
//   Zeitraster (Woche/Tag): dy → Minuten, dx → Tage
//   Monat:                  Ziel-Zelle per data-day, Uhrzeit bleibt erhalten

export const SNAP_MIN = 15;

/** Erst ab dieser Distanz gilt es als Ziehen — darunter bleibt es ein Klick. */
const DRAG_THRESHOLD_PX = 4;

export type DragTarget = { dayISO: string; startMin: number };

export type DragState = {
  event: TerminEvent;
  /** Aktuelles Ziel; null solange die Schwelle nicht überschritten ist. */
  target: DragTarget | null;
  pointer: { x: number; y: number };
  active: boolean;
};

export type DragGeometry =
  | {
      mode: "time";
      /** Pixel pro Minute im Zeitraster. */
      pxPerMin: number;
      /** Breite einer Tagesspalte in px. */
      colWidth: number;
      /** Sichtbare Tage (Mo…So bzw. ein Tag) in Anzeigereihenfolge. */
      days: string[];
    }
  | { mode: "month" };

type Options = {
  geometry: DragGeometry;
  /** Speichert den neuen Slot. Fehler-String → wird zurückgerollt. */
  onDrop: (event: TerminEvent, target: DragTarget) => void;
  /** Klick ohne Ziehen. */
  onClick: (event: TerminEvent, anchor: DOMRect) => void;
};

function snap(min: number): number {
  return Math.round(min / SNAP_MIN) * SNAP_MIN;
}

/** Tageszelle unter dem Zeiger finden (Monatsansicht). */
function dayCellAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y);
  const cell = el?.closest<HTMLElement>("[data-day]");
  return cell?.dataset.day ?? null;
}

export function useDragReschedule({ geometry, onDrop, onClick }: Options) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const startRef = useRef<{ x: number; y: number; rect: DOMRect } | null>(null);
  // Ref statt State: pointermove muss synchron wissen, ob die Schwelle fiel.
  const movedRef = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, event: TerminEvent) => {
      // Nur linke Maustaste / Touch; terminale Termine sind nicht verschiebbar.
      if (e.button !== 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      startRef.current = { x: e.clientX, y: e.clientY, rect };
      movedRef.current = false;
      if (!event.terminal) e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ event, target: null, pointer: { x: e.clientX, y: e.clientY }, active: false });
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const start = startRef.current;
      if (!start || !drag || drag.event.terminal || !drag.event.dayISO) return;

      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!movedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      movedRef.current = true;

      let target: DragTarget;
      if (geometry.mode === "time") {
        const deltaMin = snap(dy / geometry.pxPerMin);
        const deltaDays = geometry.days.length > 1 ? Math.round(dx / geometry.colWidth) : 0;
        const idx = geometry.days.indexOf(drag.event.dayISO);
        const dayIdx = Math.min(Math.max(idx + deltaDays, 0), geometry.days.length - 1);
        target = {
          dayISO: idx === -1 ? drag.event.dayISO : geometry.days[dayIdx],
          startMin: Math.min(Math.max(drag.event.startMin + deltaMin, 0), 24 * 60 - SNAP_MIN),
        };
      } else {
        const day = dayCellAt(e.clientX, e.clientY);
        target = { dayISO: day ?? drag.event.dayISO, startMin: drag.event.startMin };
      }

      setDrag({ event: drag.event, target, pointer: { x: e.clientX, y: e.clientY }, active: true });
    },
    [drag, geometry],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const start = startRef.current;
      startRef.current = null;
      const current = drag;
      setDrag(null);
      if (!current) return;

      if (!movedRef.current || !current.target) {
        onClick(current.event, start?.rect ?? e.currentTarget.getBoundingClientRect());
        return;
      }
      const unchanged =
        current.target.dayISO === current.event.dayISO && current.target.startMin === current.event.startMin;
      if (unchanged) return;
      onDrop(current.event, current.target);
    },
    [drag, onDrop, onClick],
  );

  const cancel = useCallback(() => {
    startRef.current = null;
    movedRef.current = false;
    setDrag(null);
  }, []);

  return {
    drag,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: cancel },
  };
}

/** Slot um `days` Tage verschieben (Monats-Drop über Monatsgrenzen). */
export function shiftDay(dayISO: string, days: number): string {
  return addDaysISO(dayISO, days);
}
