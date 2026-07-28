"use client";

import { moveSettingAppointment } from "@/app/actions/settingCalls";
import { updateClosingCall } from "@/app/actions/closingCalls";
import { ManualAppointmentModal } from "@/components/appointment/ManualAppointmentModal";
import { slotToIso } from "@/lib/apptTime";
import { localDateISO } from "@/lib/dates";
import { buildEvents, type TerminEvent } from "@/lib/termine";
import type { ClosingCall, SettingCall } from "@/lib/types";
import { Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { CalendarMonth } from "./CalendarMonth";
import { CalendarTimeGrid, type TimeGridHandle } from "./CalendarTimeGrid";
import { EventChip } from "./EventChip";
import { EventPopover } from "./EventPopover";
import { TermineFilterBar, type Member } from "./TermineFilterBar";
import { TermineList } from "./TermineList";
import { useDragReschedule, type DragGeometry, type DragTarget } from "./useDragReschedule";
import {
  daysForView,
  parseTermineParams,
  periodLabel,
  rangeForView,
  stepDate,
  type TerminView,
} from "./viewState";

// Client-Shell des Termine-Kalenders: hält Filter- und Ansichts-State (in der
// URL), normalisiert Setting + Closing zu einem Event-Modell und verteilt es an
// Monat / Woche / Tag / Liste. Alle Daten kommen komplett vom Server-Parent —
// Ansichtswechsel und Navigation laufen darum ohne Server-Roundtrip.

type Assignee = { user_id: string; username: string };

export function TermineBoard({
  settings,
  closings,
  settingAssignees,
  closingAssignees,
  members,
  canFilterPersons,
}: {
  settings: SettingCall[];
  closings: ClosingCall[];
  settingAssignees: Record<string, Assignee[]>;
  closingAssignees: Record<string, Assignee[]>;
  members: Member[];
  canFilterPersons: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  const today = localDateISO();
  const params = useMemo(() => parseTermineParams(sp, today), [sp, today]);

  const [popover, setPopover] = useState<{ event: TerminEvent; anchor: DOMRect } | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geometry, setGeometry] = useState<TimeGridHandle>({ pxPerMin: 0.9, colWidth: 120 });
  /** Optimistisch verschobene Termine: Event-ID → { dayISO, startMin }. */
  const [moved, setMoved] = useState<Record<string, DragTarget>>({});

  // ── URL-State ──────────────────────────────────────────────
  const commit = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(sp.toString());
      mutate(next);
      startTransition(() => {
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      });
    },
    [sp, pathname, router],
  );

  const setParam = useCallback(
    (key: string, value: string | null) =>
      commit((p) => {
        if (value === null || value === "") p.delete(key);
        else p.set(key, value);
      }),
    [commit],
  );

  // ── Events aufbauen + filtern ──────────────────────────────
  const { events: allEvents, ohneTermin: allOhneTermin } = useMemo(
    () => buildEvents(settings, closings, settingAssignees, closingAssignees),
    [settings, closings, settingAssignees, closingAssignees],
  );

  /** Optimistische Verschiebungen einrechnen, bevor gefiltert wird. */
  const withMoves = useCallback(
    (list: TerminEvent[]): TerminEvent[] =>
      list.map((e) => {
        const m = moved[e.id];
        if (!m) return e;
        return { ...e, dayISO: m.dayISO, startMin: m.startMin, endMin: m.startMin + (e.endMin - e.startMin) };
      }),
    [moved],
  );

  const matchesPerson = useCallback(
    (e: TerminEvent) => {
      if (params.persons.size === 0) return true;
      if (e.ownerId && params.persons.has(e.ownerId)) return true;
      return e.assignees.some((a) => params.persons.has(a.user_id));
    },
    [params.persons],
  );

  const baseFiltered = useMemo(
    () => withMoves(allEvents).filter((e) => params.kinds.has(e.kind) && matchesPerson(e)),
    [allEvents, withMoves, params.kinds, matchesPerson],
  );

  const hiddenCount = useMemo(() => baseFiltered.filter((e) => e.hidden).length, [baseFiltered]);

  // Suchbegriff greift in ALLEN Ansichten — vorher filterte er nur die Liste
  // und ging beim Wechsel auf den Kalender verloren.
  const matchesSearch = useCallback(
    (e: TerminEvent) => {
      const q = params.search.trim().toLowerCase();
      if (!q) return true;
      return [e.title, e.company].filter(Boolean).join(" ").toLowerCase().includes(q);
    },
    [params.search],
  );

  const filtered = useMemo(
    () =>
      (params.showHidden ? baseFiltered : baseFiltered.filter((e) => !e.hidden)).filter(matchesSearch),
    [baseFiltered, params.showHidden, matchesSearch],
  );

  const ohneTermin = useMemo(
    () =>
      allOhneTermin
        .filter((e) => params.kinds.has(e.kind) && matchesPerson(e))
        .filter((e) => params.showHidden || !e.hidden)
        .filter(matchesSearch),
    [allOhneTermin, params.kinds, matchesPerson, params.showHidden, matchesSearch],
  );

  // Typ-Zähler zeigen den Bestand VOR dem Typ-Filter, damit man sieht, was das
  // Einschalten bringt.
  const counts = useMemo(() => {
    const pool = withMoves(allEvents)
      .concat(allOhneTermin)
      .filter((e) => matchesPerson(e) && (params.showHidden || !e.hidden));
    return {
      setting: pool.filter((e) => e.kind === "setting").length,
      closing: pool.filter((e) => e.kind === "closing").length,
    };
  }, [allEvents, allOhneTermin, withMoves, matchesPerson, params.showHidden]);

  // Auf den sichtbaren Zeitraum eingrenzen (Liste zeigt alles).
  const range = rangeForView(params.view, params.date);
  const inRange = useMemo(
    () => (range ? filtered.filter((e) => e.dayISO! >= range.from && e.dayISO! <= range.to) : filtered),
    [filtered, range],
  );

  // ── Drag & Drop ────────────────────────────────────────────
  const days = daysForView(params.view, params.date);

  const dragGeometry: DragGeometry =
    params.view === "monat"
      ? { mode: "month" }
      : { mode: "time", pxPerMin: geometry.pxPerMin, colWidth: geometry.colWidth, days };

  const handleDrop = useCallback(
    (event: TerminEvent, target: DragTarget) => {
      setError(null);
      setMoved((m) => ({ ...m, [event.id]: target }));
      const iso = slotToIso(target.dayISO, target.startMin);
      startTransition(async () => {
        const res =
          event.kind === "setting"
            ? await moveSettingAppointment(event.refId, iso)
            : await updateClosingCall(event.refId, { call_at: iso });
        if (res?.error) {
          // Zurückrollen — der Server hat den alten Wert behalten.
          setMoved((m) => {
            const next = { ...m };
            delete next[event.id];
            return next;
          });
          setError(res.error);
          return;
        }
        router.refresh();
      });
    },
    [router],
  );

  const handleClick = useCallback((event: TerminEvent, anchor: DOMRect) => {
    setPopover({ event, anchor });
  }, []);

  const { drag, handlers } = useDragReschedule({
    geometry: dragGeometry,
    onDrop: handleDrop,
    onClick: handleClick,
  });

  // ── Render ─────────────────────────────────────────────────
  const [ay, am] = params.date.split("-").map(Number);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.75rem" }}>
        <button
          type="button"
          onClick={() => setShowManual(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
            padding: "0.45rem 0.875rem",
            borderRadius: "var(--r-full)",
            border: "none",
            background: "var(--grad-cta)",
            color: "var(--text-on-accent)",
            boxShadow: "var(--shadow-btn-primary)",
            fontSize: "0.8125rem",
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          <Plus size={15} /> Termin manuell
        </button>
      </div>

      <ManualAppointmentModal
        open={showManual}
        onClose={() => setShowManual(false)}
        onSaved={() => router.refresh()}
      />

      <TermineFilterBar
        view={params.view}
        periodLabel={periodLabel(params.view, params.date)}
        kinds={params.kinds}
        persons={params.persons}
        members={members}
        showHidden={params.showHidden}
        hiddenCount={hiddenCount}
        counts={counts}
        canFilterPersons={canFilterPersons}
        search={params.search}
        zeit={params.zeit}
        onSearch={(q) => setParam("q", q.trim() ? q : null)}
        onZeit={(z) => setParam("zeit", z === "anstehend" ? null : z)}
        onView={(v: TerminView) => setParam("view", v)}
        onStep={(dir) => setParam("date", stepDate(params.view, params.date, dir))}
        onToday={() => setParam("date", today)}
        onToggleKind={(k) => {
          const next = new Set(params.kinds);
          if (next.has(k)) next.delete(k);
          else next.add(k);
          // Beide aktiv = Default → Parameter raus aus der URL.
          setParam("typ", next.size === 0 || next.size === 2 ? null : [...next].join(","));
        }}
        onTogglePerson={(id) => {
          const next = new Set(params.persons);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          setParam("person", next.size === 0 ? null : [...next].join(","));
        }}
        onResetPersons={() => setParam("person", null)}
        onToggleHidden={() => setParam("versteckt", params.showHidden ? null : "1")}
      />

      {error && (
        <div
          style={{
            fontSize: "0.8125rem",
            color: "var(--color-error-text)",
            background: "var(--color-error-bg)",
            border: "1px solid var(--color-error-border)",
            borderRadius: "var(--radius-sm)",
            padding: "0.5rem 0.75rem",
            marginBottom: "0.75rem",
          }}
        >
          {error}
        </div>
      )}

      {params.view === "liste" ? (
        <TermineList events={filtered} ohneTermin={ohneTermin} zeit={params.zeit} today={today} />
      ) : params.view === "monat" ? (
        <CalendarMonth
          year={ay}
          month={am}
          events={inRange}
          drag={drag}
          dragHandlers={handlers}
          onOpenDay={(dayISO) =>
            commit((p) => {
              p.set("view", "tag");
              p.set("date", dayISO);
            })
          }
        />
      ) : (
        <CalendarTimeGrid
          days={days}
          events={inRange}
          drag={drag}
          dragHandlers={handlers}
          onGeometry={setGeometry}
        />
      )}

      {/* Ghost am Zeiger (Monatsansicht: Zielzelle wird zusätzlich hervorgehoben) */}
      {drag?.active && params.view === "monat" && (
        <div
          className="cal-event-ghost"
          style={{ left: drag.pointer.x + 10, top: drag.pointer.y + 10, width: 150 }}
        >
          <EventChip event={drag.event} compact />
        </div>
      )}

      {popover && (
        <EventPopover event={popover.event} anchor={popover.anchor} onClose={() => setPopover(null)} />
      )}
    </div>
  );
}
