"use client";

import { minToHHMM } from "@/lib/apptTime";
import { localDateISO } from "@/lib/dates";
import { groupByDay, type TerminEvent } from "@/lib/termine";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { chipSizeFor, EventChip } from "./EventChip";
import { packEvents, visibleRange } from "./layout";
import type { DragState } from "./useDragReschedule";

// Zeitraster für Woche (7 Spalten) und Tag (1 Spalte) — dieselbe Komponente,
// nur mit unterschiedlich vielen Tagen.
//
// Zwei Dinge sind hier bewusst gelöst:
//  1. Kopfzeile und Raster liegen im SELBEN Scroll-Container und teilen sich
//     dasselbe grid-template — sonst schiebt die vertikale Scrollbar den Body
//     gegenüber dem Kopf um ihre Breite und die Spalten stehen schief.
//  2. Die Stundenlinien sind Hintergrund-Gradienten der Spalten (siehe
//     .cal-col in globals.css), nicht eine Ebene darunter. Sonst verdecken die
//     getönten Wochenend-/Heute-Spalten sie und das Raster wirkt löchrig.

/**
 * 60 px pro Stunde (vorher 78). Zusammen mit dem gestrafften Tagesfenster
 * (08–19 Uhr, siehe layout.ts) und der entfallenen zweiten Filterzeile passt
 * eine Woche damit ohne Scrollen auf einen üblichen Laptop-Viewport:
 * 11 h × 60 px + Kopfzeile = 700 px.
 *
 * Untergrenze der Straffung ist der kleinste Chip: Ein 30-Minuten-Setting
 * bekommt 30 px (abzüglich 2 px Luft = 28) und fällt damit auf die
 * einzeilige xs-Variante — Uhrzeit, Name und Owner-Avatar bleiben lesbar,
 * der Typ steht in der Füllfarbe. Weniger als 60 px/Stunde würde den Avatar
 * unter 13 px drücken; dort hört Erkennbarkeit auf.
 */
const PX_PER_MIN = 1.0;
const TIME_COL_PX = 46;
const HEADER_PX = 38;

const WEEKDAY_FMT = new Intl.DateTimeFormat("de-DE", { weekday: "short" });

function dayLabel(iso: string): { wd: string; num: string } {
  const [y, m, d] = iso.split("-").map(Number);
  return { wd: WEEKDAY_FMT.format(new Date(y, m - 1, d)), num: String(d) };
}

function isWeekend(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = new Date(y, m - 1, d).getDay();
  return wd === 0 || wd === 6;
}

export type TimeGridHandle = { pxPerMin: number; colWidth: number };

export function CalendarTimeGrid({
  days,
  events,
  drag,
  dragHandlers,
  onGeometry,
}: {
  days: string[];
  events: TerminEvent[];
  drag: DragState | null;
  dragHandlers: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>, ev: TerminEvent) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: () => void;
  };
  onGeometry: (g: TimeGridHandle) => void;
}) {
  const today = localDateISO();
  const byDay = useMemo(() => groupByDay(events), [events]);
  const range = useMemo(() => visibleRange(events), [events]);
  const totalMin = range.end - range.start;
  const bodyHeight = totalMin * PX_PER_MIN;

  const firstColRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nowMin, setNowMin] = useState<number | null>(null);

  // Echte Spaltenbreite messen (statt sie zu rechnen) — die Drag-Logik leitet
  // daraus den Tageswechsel ab.
  useLayoutEffect(() => {
    function report() {
      const w = firstColRef.current?.getBoundingClientRect().width ?? 0;
      if (w > 0) onGeometry({ pxPerMin: PX_PER_MIN, colWidth: w });
    }
    report();
    window.addEventListener("resize", report);
    return () => window.removeEventListener("resize", report);
  }, [days.length, onGeometry]);

  // „Jetzt"-Linie, minütlich nachgeführt.
  useEffect(() => {
    function tick() {
      const [hh, mm] = new Intl.DateTimeFormat("de-DE", {
        timeZone: "Europe/Berlin",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
        .format(new Date())
        .split(":")
        .map(Number);
      setNowMin(hh * 60 + mm);
    }
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // Beim Ansichtswechsel auf 8 Uhr scrollen.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = Math.max(0, (8 * 60 - range.start) * PX_PER_MIN - 16);
    // Bewusst nur am Tageswechsel, nicht bei jeder Range-Änderung.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0], days.length]);

  const hours: number[] = [];
  for (let m = Math.ceil(range.start / 60) * 60; m <= range.end; m += 60) hours.push(m);

  const template = `${TIME_COL_PX}px repeat(${days.length}, minmax(0, 1fr))`;
  const lineVars = {
    ["--cal-hour-px" as string]: `${60 * PX_PER_MIN}px`,
    ["--cal-half-px" as string]: `${30 * PX_PER_MIN}px`,
  } as React.CSSProperties;

  return (
    <div
      className="cal-scroll-x"
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        background: "var(--surface-100)",
      }}
    >
      <div className="cal-scroll-x-inner">
        {/* 208px = Topbar + PageHeader + die eine verbliebene Filterzeile.
            Vorher 268px — die zweite Filterzeile ist ersatzlos entfallen. */}
        <div ref={scrollRef} style={{ maxHeight: "calc(100vh - 208px)", overflowY: "auto" }}>
          {/* Kopfzeile — klebt oben IM Scroll-Container, teilt sich das Template
              mit dem Raster darunter. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: template,
              position: "sticky",
              top: 0,
              zIndex: 6,
              background: "var(--surface-100)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div />
            {days.map((d) => {
              const { wd, num } = dayLabel(d);
              const isToday = d === today;
              const weekend = isWeekend(d);
              return (
                <div
                  key={d}
                  style={{
                    height: HEADER_PX,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 2,
                    borderLeft: "1px solid var(--border)",
                    background: weekend ? "var(--surface-150)" : "transparent",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.625rem",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: isToday
                        ? "var(--brand-500)"
                        : weekend
                          ? "var(--text-subtle)"
                          : "var(--text-muted)",
                    }}
                  >
                    {wd}
                  </span>
                  <span
                    style={{
                      fontSize: "0.875rem",
                      fontWeight: 600,
                      lineHeight: 1,
                      // Dunkler Text auf Orange (7.1:1), nie Weiss.
                      color: isToday ? "#0a0a0b" : "var(--text-primary)",
                      background: isToday ? "var(--orange-500)" : "transparent",
                      borderRadius: "50%",
                      width: 22,
                      height: 22,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {num}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Raster — identisches Template, damit die Spalten exakt fluchten. */}
          <div style={{ display: "grid", gridTemplateColumns: template }}>
            {/* Stundenskala */}
            <div className="cal-time-col" style={{ ...lineVars, height: bodyHeight }}>
              {hours.map((m) => (
                <span
                  key={m}
                  style={{
                    position: "absolute",
                    // Die Beschriftung sitzt mittig auf der Stundenlinie — beim
                    // allerersten Wert wuerde sie sonst oben abgeschnitten.
                    top: Math.max(1, (m - range.start) * PX_PER_MIN - 6),
                    right: 6,
                    fontSize: "0.625rem",
                    fontWeight: 600,
                    color: "var(--text-subtle)",
                  }}
                >
                  {minToHHMM(m)}
                </span>
              ))}
            </div>

            {/* Tagesspalten */}
            {days.map((d, colIdx) => {
              const placed = packEvents(byDay.get(d) ?? []);
              const isToday = d === today;
              return (
                <div
                  key={d}
                  ref={colIdx === 0 ? firstColRef : undefined}
                  className="cal-col"
                  data-day={d}
                  data-weekend={isWeekend(d)}
                  data-today={isToday}
                  style={{ ...lineVars, height: bodyHeight }}
                >
                  {isToday && nowMin != null && nowMin >= range.start && nowMin <= range.end && (
                    <div className="cal-now-line" style={{ top: (nowMin - range.start) * PX_PER_MIN }} />
                  )}

                  {placed.map(({ event, left, width }) => {
                    const dragging = Boolean(drag?.active && drag.event.id === event.id);
                    const preview = dragging && drag?.target?.dayISO === d ? drag.target.startMin : null;
                    const startMin = preview ?? event.startMin;
                    const height = Math.max((event.endMin - event.startMin) * PX_PER_MIN - 2, 18);
                    const movedAway = dragging && drag?.target != null && drag.target.dayISO !== d;
                    return (
                      <EventChip
                        key={event.id}
                        event={event}
                        previewStartMin={startMin}
                        size={chipSizeFor(height)}
                        isPast={isPastEvent(event, today, nowMin)}
                        isDragging={dragging}
                        style={{
                          position: "absolute",
                          top: (startMin - range.start) * PX_PER_MIN,
                          left: `calc(${left * 100}% + 2px)`,
                          width: `calc(${width * 100}% - 4px)`,
                          height,
                          zIndex: dragging ? 5 : 2,
                          visibility: movedAway ? "hidden" : undefined,
                        }}
                        onPointerDown={(e) => dragHandlers.onPointerDown(e, event)}
                        onPointerMove={dragHandlers.onPointerMove}
                        onPointerUp={dragHandlers.onPointerUp}
                        onPointerCancel={dragHandlers.onPointerCancel}
                      />
                    );
                  })}

                  {/* Vorschau, wenn ein Termin auf DIESEN Tag gezogen wird */}
                  {drag?.active && drag.target?.dayISO === d && drag.event.dayISO !== d && (
                    <EventChip
                      event={drag.event}
                      previewStartMin={drag.target.startMin}
                      size={chipSizeFor((drag.event.endMin - drag.event.startMin) * PX_PER_MIN)}
                      style={{
                        position: "absolute",
                        top: (drag.target.startMin - range.start) * PX_PER_MIN,
                        left: 2,
                        right: 2,
                        height: Math.max((drag.event.endMin - drag.event.startMin) * PX_PER_MIN - 2, 18),
                        zIndex: 6,
                        pointerEvents: "none",
                        boxShadow: "var(--shadow-lg)",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function isPastEvent(event: TerminEvent, today: string, nowMin: number | null): boolean {
  if (!event.dayISO) return false;
  if (event.dayISO < today) return true;
  if (event.dayISO > today) return false;
  return nowMin != null && event.endMin <= nowMin;
}
