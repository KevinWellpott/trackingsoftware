"use client";

import { minToHHMM } from "@/lib/apptTime";
import { buildMonthGrid, buildWeekDays, WEEKDAYS_DE } from "@/lib/dates";
import { ownerColor, ownerInitials } from "@/lib/ownerColor";
import { groupByDay, type TerminEvent } from "@/lib/termine";
import { Phone, Video } from "lucide-react";
import { useMemo, useRef } from "react";
import { CalendarTimeGrid, type TimeGridHandle } from "./CalendarTimeGrid";
import { kindLabel } from "./EventChip";
import type { DragState } from "./useDragReschedule";

// Der Kalender am Handy.
//
// Das Desktop-Raster passt nicht auf 360px: Sieben Wochenspalten werden je
// rund 45px schmal (die Woche lief deshalb auf 640px Mindestbreite und
// scrollte in zwei Richtungen zugleich), die Monatszellen tragen Chips, auf
// denen kein Name mehr steht. Am Handy gilt deshalb das Muster, das man aus
// jeder Kalender-App kennt:
//
//   Monat — kompaktes Raster mit Punkten je Termin, darunter die Termine des
//           angetippten Tages als Karten.
//   Woche — Tagesleiste zum Springen, darunter die ganze Woche als Agenda.
//   Tag   — Tagesleiste, darunter das Zeitraster in voller Breite — die
//           Ansicht für „wann habe ich Zeit?".
//
// Überall gilt: wischen blättert (Monat / Woche / Tag), Antippen eines
// Termins öffnet dieselbe Kurzinfo wie am Desktop. Ziehen zum Verschieben
// gibt es auf Touch bewusst nicht (useDragReschedule) — verschoben wird über
// die Kurzinfo bzw. die Detailseite.

type DragHandlers = {
  onPointerDown: (e: React.PointerEvent<HTMLElement>, ev: TerminEvent) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
};

const DAY_HEAD_FMT = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });
const WD_SHORT_FMT = new Intl.DateTimeFormat("de-DE", { weekday: "short" });

function parts(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Wischen ab 60px, und nur wenn die Bewegung klar waagerecht ist. */
const SWIPE_MIN_PX = 60;

export function CalendarMobile({
  view,
  date,
  today,
  events,
  drag,
  dragHandlers,
  onGeometry,
  onSelectDay,
  onStep,
  onOpen,
}: {
  view: "monat" | "woche" | "tag";
  date: string;
  /** Berliner Kalendertag vom Server (TermineBoard). */
  today: string;
  /** Alle gefilterten Termine — eingegrenzt wird hier. */
  events: TerminEvent[];
  drag: DragState | null;
  dragHandlers: DragHandlers;
  onGeometry: (g: TimeGridHandle) => void;
  onSelectDay: (iso: string) => void;
  onStep: (dir: -1 | 1) => void;
  onOpen: (event: TerminEvent, anchor: DOMRect) => void;
}) {
  const byDay = useMemo(() => {
    const map = groupByDay(events);
    for (const list of map.values()) list.sort((a, b) => a.startMin - b.startMin);
    return map;
  }, [events]);

  const touch = useRef<{ x: number; y: number } | null>(null);

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touch.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    onStep(dx < 0 ? 1 : -1);
  }

  const weekDays = buildWeekDays(date);

  return (
    <div className="cal-mobile only-mobile" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {view === "monat" ? (
        <>
          <MonthDots date={date} today={today} byDay={byDay} onSelectDay={onSelectDay} />
          <DayAgenda iso={date} today={today} events={byDay.get(date) ?? []} onOpen={onOpen} />
        </>
      ) : view === "woche" ? (
        <>
          <WeekStrip
            days={weekDays}
            selected={date}
            today={today}
            byDay={byDay}
            onSelectDay={(iso) => {
              onSelectDay(iso);
              document.getElementById(`kal-tag-${iso}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-7)" }}>
            {weekDays.map((d) => (
              <DayAgenda key={d} iso={d} today={today} events={byDay.get(d) ?? []} onOpen={onOpen} compactEmpty />
            ))}
          </div>
        </>
      ) : (
        <>
          <WeekStrip days={weekDays} selected={date} today={today} byDay={byDay} onSelectDay={onSelectDay} />
          <CalendarTimeGrid
            days={[date]}
            events={byDay.get(date) ?? []}
            drag={drag}
            dragHandlers={dragHandlers}
            onGeometry={onGeometry}
            compact
          />
        </>
      )}
    </div>
  );
}

// ── Punkte statt Chips ────────────────────────────────────────────────────
// Ein Punkt je Termin (höchstens drei, danach „+"), gefärbt wie die Füllung
// des Chips: Setting dunkel, Closing hell — dieselbe Regel wie im Raster.
function Dots({ events }: { events: TerminEvent[] }) {
  if (events.length === 0) return <span className="cal-m-dots" aria-hidden />;
  const shown = events.slice(0, 3);
  return (
    <span className="cal-m-dots" aria-hidden>
      {shown.map((e) => (
        <span key={e.id} className="cal-m-dot" data-kind={e.kind} data-dran={e.dran || undefined} />
      ))}
      {events.length > shown.length && <span className="cal-m-more">+</span>}
    </span>
  );
}

function MonthDots({
  date,
  today,
  byDay,
  onSelectDay,
}: {
  date: string;
  today: string;
  byDay: Map<string, TerminEvent[]>;
  onSelectDay: (iso: string) => void;
}) {
  const [y, m] = date.split("-").map(Number);
  const cells = useMemo(() => buildMonthGrid(y, m), [y, m]);
  // Die sechste Reihe nur, wenn der Monat sie wirklich braucht.
  const rows = cells.slice(35).some((c) => c.inMonth) ? 6 : 5;

  return (
    <div className="cal-m-month">
      <div className="cal-m-weekdays">
        {WEEKDAYS_DE.map((wd) => (
          <span key={wd}>{wd}</span>
        ))}
      </div>
      <div className="cal-m-grid">
        {cells.slice(0, rows * 7).map((cell) => {
          const list = byDay.get(cell.iso) ?? [];
          return (
            <button
              key={cell.iso}
              type="button"
              className="cal-m-cell"
              data-outside={!cell.inMonth || undefined}
              data-today={cell.iso === today || undefined}
              data-selected={cell.iso === date || undefined}
              aria-pressed={cell.iso === date}
              aria-label={`${DAY_HEAD_FMT.format(parts(cell.iso))}, ${list.length} ${list.length === 1 ? "Termin" : "Termine"}`}
              onClick={() => onSelectDay(cell.iso)}
            >
              <span className="cal-m-num">{cell.day}</span>
              <Dots events={list} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WeekStrip({
  days,
  selected,
  today,
  byDay,
  onSelectDay,
}: {
  days: string[];
  selected: string;
  today: string;
  byDay: Map<string, TerminEvent[]>;
  onSelectDay: (iso: string) => void;
}) {
  return (
    <div className="cal-m-strip" role="group" aria-label="Tag wählen">
      {days.map((d) => {
        const list = byDay.get(d) ?? [];
        return (
          <button
            key={d}
            type="button"
            className="cal-m-cell"
            data-today={d === today || undefined}
            data-selected={d === selected || undefined}
            aria-pressed={d === selected}
            aria-label={`${DAY_HEAD_FMT.format(parts(d))}, ${list.length} ${list.length === 1 ? "Termin" : "Termine"}`}
            onClick={() => onSelectDay(d)}
          >
            <span className="cal-m-wd">{WD_SHORT_FMT.format(parts(d)).replace(".", "")}</span>
            <span className="cal-m-num">{Number(d.slice(8))}</span>
            <Dots events={list} />
          </button>
        );
      })}
    </div>
  );
}

function DayAgenda({
  iso,
  today,
  events,
  onOpen,
  compactEmpty = false,
}: {
  iso: string;
  today: string;
  events: TerminEvent[];
  onOpen: (event: TerminEvent, anchor: DOMRect) => void;
  /** Woche: ein freier Tag ist eine Zeile, kein Leerzustand. */
  compactEmpty?: boolean;
}) {
  const head = DAY_HEAD_FMT.format(parts(iso));
  return (
    <section id={`kal-tag-${iso}`} className="cal-m-day">
      <div className="cal-m-day-head" data-today={iso === today || undefined}>
        <span>{iso === today ? `Heute · ${head}` : head}</span>
        {events.length > 0 && (
          <span className="tnum" style={{ color: "var(--text-subtle)", fontWeight: 500 }}>
            {events.length}
          </span>
        )}
      </div>
      {events.length === 0 ? (
        <p className="cal-m-free" data-compact={compactEmpty || undefined}>
          {compactEmpty ? "Frei" : "Keine Termine an diesem Tag."}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
          {events.map((e) => (
            <AgendaCard key={e.id} event={e} past={iso < today} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}

function AgendaCard({
  event,
  past,
  onOpen,
}: {
  event: TerminEvent;
  past: boolean;
  onOpen: (event: TerminEvent, anchor: DOMRect) => void;
}) {
  const Icon = event.meetingKind === "telefon" ? Phone : event.meetLink ? Video : null;
  const oc = event.assignee ? ownerColor(event.assignee.username) : null;
  return (
    <button
      type="button"
      className="cal-m-card"
      data-tone={event.outline.tone}
      data-dashed={event.outline.dashed || undefined}
      data-dimmed={event.outline.dimmed || event.terminal || past || undefined}
      data-dran={event.dran || undefined}
      onClick={(e) => onOpen(event, e.currentTarget.getBoundingClientRect())}
    >
      <span className="cal-m-time tnum">
        <span>{minToHHMM(event.startMin)}</span>
        <span style={{ color: "var(--text-subtle)", fontWeight: 400 }}>{minToHHMM(event.endMin)}</span>
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span className="cal-m-title">{event.title}</span>
        <span className="cal-m-meta">
          <span className="cal-m-kind" data-kind={event.kind}>
            {kindLabel(event.kind)}
          </span>
          {Icon && <Icon size={12} aria-hidden style={{ flexShrink: 0 }} />}
          {event.company && <span className="cal-m-company">{event.company}</span>}
        </span>
      </span>
      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "var(--sp-3)", flexShrink: 0 }}>
        <span
          className="badge"
          style={{
            color: event.statusPill.color,
            backgroundColor: event.statusPill.bg,
            border: `1px solid ${event.statusPill.border}`,
          }}
        >
          {event.statusPill.label}
        </span>
        {oc && event.assignee && (
          <span
            aria-label={event.assignee.username}
            title={event.assignee.username}
            style={{
              width: 20,
              height: 20,
              borderRadius: "var(--r-full)",
              background: oc.bg,
              color: oc.fg,
              boxShadow: `inset 0 0 0 1px ${oc.fg}`,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.5625rem",
              fontWeight: 600,
            }}
          >
            {ownerInitials(event.assignee.username)}
          </span>
        )}
      </span>
    </button>
  );
}
