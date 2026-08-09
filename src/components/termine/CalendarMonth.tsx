"use client";

import { buildMonthGrid, localDateISO, WEEKDAYS_DE } from "@/lib/dates";
import { groupByDay, type TerminEvent } from "@/lib/termine";
import { useMemo } from "react";
import { EventChip } from "./EventChip";
import type { DragState } from "./useDragReschedule";

// Monatsraster: 6 Wochen à 7 Tage (Montag-Start), gleiche Grid-Berechnung wie
// der DatePicker. Pro Tag maximal MAX_CHIPS Termine, der Rest als „+N weitere"
// (Klick → Tagesansicht). Drag & Drop trifft die Zielzelle über data-day; die
// Uhrzeit bleibt dabei erhalten, nur das Datum ändert sich.

const MAX_CHIPS = 3;

export function CalendarMonth({
  year,
  month,
  events,
  drag,
  dragHandlers,
  onOpenDay,
}: {
  year: number;
  month: number;
  events: TerminEvent[];
  drag: DragState | null;
  dragHandlers: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>, ev: TerminEvent) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: () => void;
  };
  onOpenDay: (dayISO: string) => void;
}) {
  const today = localDateISO();
  const cells = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const byDay = useMemo(() => groupByDay(events), [events]);

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderTop: "none",
        borderLeft: "none",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        background: "var(--surface-100)",
      }}
    >
      {/* Wochentags-Kopf */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          borderLeft: "1px solid var(--border)",
          background: "var(--surface-150)",
        }}
      >
        {WEEKDAYS_DE.map((wd) => (
          <span
            key={wd}
            style={{
              textAlign: "center",
              fontSize: "0.625rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--text-subtle)",
              padding: "0.4rem 0",
            }}
          >
            {wd}
          </span>
        ))}
      </div>

      {/* Tageszellen */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          // 92 statt 108 px: 6 Wochen × 16 px = ein knapper Bildschirm weniger.
          // Drei Chips à ~17 px + Datumszeile + „+N weitere" passen weiterhin.
          gridAutoRows: "minmax(92px, 1fr)",
        }}
      >
        {cells.map((cell, i) => {
          const dayEvents = byDay.get(cell.iso) ?? [];
          const isToday = cell.iso === today;
          const isDropTarget = Boolean(drag?.active && drag.target?.dayISO === cell.iso);
          const shown = dayEvents.slice(0, MAX_CHIPS);
          const rest = dayEvents.length - shown.length;
          const weekend = i % 7 >= 5; // Spalte 5/6 = Sa/So (Montag-Start)

          return (
            <div
              key={cell.iso}
              className="cal-day-cell"
              data-day={cell.iso}
              data-outside={!cell.inMonth}
              data-weekend={weekend}
              data-droptarget={isDropTarget}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 19,
                    height: 19,
                    borderRadius: "50%",
                    fontSize: "0.6875rem",
                    fontWeight: isToday ? 800 : 600,
                    // Dunkler Text auf Orange (7.1:1). Weiss auf Orange waere
                    // nur 2.8:1 und faellt unter jede WCAG-Schwelle.
                    color: isToday
                      ? "#0a0a0b"
                      : cell.inMonth
                        ? "var(--text-secondary)"
                        : "var(--text-disabled)",
                    background: isToday ? "var(--orange-500)" : "transparent",
                  }}
                >
                  {cell.day}
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {shown.map((event) => (
                  <EventChip
                    key={event.id}
                    event={event}
                    compact
                    isPast={cell.iso < today}
                    isDragging={Boolean(drag?.active && drag.event.id === event.id)}
                    onPointerDown={(e) => dragHandlers.onPointerDown(e, event)}
                    onPointerMove={dragHandlers.onPointerMove}
                    onPointerUp={dragHandlers.onPointerUp}
                    onPointerCancel={dragHandlers.onPointerCancel}
                  />
                ))}
                {rest > 0 && (
                  <button
                    type="button"
                    onClick={() => onOpenDay(cell.iso)}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "var(--text-subtle)",
                      fontSize: "0.625rem",
                      fontWeight: 600,
                      fontFamily: "inherit",
                      textAlign: "left",
                      padding: "1px 5px",
                      cursor: "pointer",
                    }}
                  >
                    +{rest} weitere
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
