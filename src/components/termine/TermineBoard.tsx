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
  type TerminSort,
  type TerminView,
} from "./viewState";

// Client-Shell des Termine-Kalenders: hält Ansichts-State (in der URL),
// normalisiert Setting + Closing zu einem Event-Modell und verteilt es an
// Monat / Woche / Tag / Liste. Alle Daten kommen komplett vom Server-Parent —
// Ansichtswechsel und Navigation laufen darum ohne Server-Roundtrip.
//
// Typ-, Personen- und „Versteckte"-Filter sind ersatzlos entfallen (siehe
// viewState.ts). Was übrig bleibt, ist eine Suche und der Zeitraum — alles
// andere liest man jetzt am Chip selbst ab.

export function TermineBoard({
  settings,
  closings,
  members,
}: {
  settings: SettingCall[];
  closings: ClosingCall[];
  /** Nur noch Namensquelle für `assigned_user_id` — kein Filter mehr. */
  members: Member[];
  /**
   * Ohne Wirkung. Der Personenfilter ist mit der zweiten Filterzeile entfallen;
   * die Prop bleibt im Typ, damit `/termine/page.tsx` (fremdes Paket in dieser
   * Runde) unverändert kompiliert. Beim nächsten Anfassen der Seite streichen.
   */
  canFilterPersons?: boolean;
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
  // Die Mitgliederliste ist die Namensquelle für `assigned_user_id` — eine
  // zweite Abfrage dafür gibt es nicht. Seit der Personenfilter weg ist, ist
  // das ihr einziger Zweck.
  const usernameById = useMemo(
    () => new Map(members.map((m) => [m.user_id, m.username])),
    [members],
  );

  const { events: allEvents, ohneTermin: allOhneTermin } = useMemo(
    () => buildEvents(settings, closings, usernameById),
    [settings, closings, usernameById],
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
    () => withMoves(allEvents).filter(matchesSearch),
    [allEvents, withMoves, matchesSearch],
  );

  const ohneTermin = useMemo(
    () => allOhneTermin.filter(matchesSearch),
    [allOhneTermin, matchesSearch],
  );

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

  // Klick auf dieselbe Spalte dreht die Richtung, auf eine andere startet
  // aufsteigend. Default (zeit/asc) fliegt aus der URL.
  const handleSort = useCallback(
    (col: TerminSort) =>
      commit((p) => {
        const nextDir = params.sort === col && params.dir === "asc" ? "desc" : "asc";
        if (col === "zeit") p.delete("sort");
        else p.set("sort", col);
        if (nextDir === "asc") p.delete("dir");
        else p.set("dir", nextDir);
      }),
    [commit, params.sort, params.dir],
  );

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
        search={params.search}
        zeit={params.zeit}
        onSearch={(q) => setParam("q", q.trim() ? q : null)}
        onZeit={(z) => setParam("zeit", z === "anstehend" ? null : z)}
        onView={(v: TerminView) => setParam("view", v)}
        onStep={(dir) => setParam("date", stepDate(params.view, params.date, dir))}
        onToday={() => setParam("date", today)}
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
        <TermineList
          events={filtered}
          ohneTermin={ohneTermin}
          zeit={params.zeit}
          today={today}
          sort={params.sort}
          dir={params.dir}
          onSort={handleSort}
        />
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
