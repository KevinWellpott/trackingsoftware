"use client";

import { moveSettingAppointment } from "@/app/actions/settingCalls";
import { updateClosingCall } from "@/app/actions/closingCalls";
import { ManualAppointmentModal } from "@/components/appointment/ManualAppointmentModal";
import { slotToIso } from "@/lib/apptTime";
import { localDateISO } from "@/lib/dates";
import { buildEvents, type RueckrufAufgabe, type TerminEvent, type WithCancellation } from "@/lib/termine";
import type { ClosingCall, SettingCall } from "@/lib/types";
import { Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { CalendarMonth } from "./CalendarMonth";
import { CalendarTimeGrid, type TimeGridHandle } from "./CalendarTimeGrid";
import { EventChip } from "./EventChip";
import { EventPopover } from "./EventPopover";
import { RueckrufListe } from "./RueckrufListe";
import { TermineFilterBar, type Member } from "./TermineFilterBar";
import { TermineList } from "./TermineList";
import { useDragReschedule, type DragGeometry, type DragTarget } from "./useDragReschedule";
import {
  daysForView,
  parseTermineParams,
  periodLabel,
  rangeForView,
  stepDate,
  tabForView,
  type TerminSort,
  type TerminTab,
  type TerminView,
} from "./viewState";

// Client-Shell des Termine-Bereichs: hält den Ansichts-State (in der URL),
// normalisiert Setting + Closing zu einem Event-Modell und verteilt es an
// Arbeitsliste / Kalender / Rückrufe. Alle Daten kommen komplett vom
// Server-Parent — Ansichtswechsel und Navigation laufen darum ohne
// Server-Roundtrip.
//
// Die Reihenfolge ist neu und sie ist die Aussage: Die ARBEITSLISTE ist die
// Vorgabe, der Kalender der zweite Reiter. Wer die Seite morgens öffnet, will
// wissen, wen er nerven muss — nicht, wie die Woche aussieht.

export function TermineBoard({
  settings,
  closings,
  members,
  rueckrufe,
  rueckrufeVerfuegbar,
  scopeUserId,
  canSeeAll,
}: {
  // `WithCancellation`: Die Seite lädt mit `select("*")`, `cancelled_at` und die
  // beiden Nachfass-Spalten sind also da — nur im geteilten Typ stehen sie
  // bewusst nicht (siehe lib/termine).
  settings: WithCancellation<SettingCall>[];
  closings: WithCancellation<ClosingCall>[];
  /** Namensquelle für `assigned_user_id` und für den Nachfass-Stempler. */
  members: Member[];
  /** Fällige Telefon-Rückrufe — der dritte Reiter (docs §1: eigene Zeitkörnung). */
  rueckrufe: RueckrufAufgabe[];
  /** `false` = Abfrage gescheitert. „Nicht ermittelbar" ≠ „nichts zu tun". */
  rueckrufeVerfuegbar: boolean;
  /**
   * Wessen Liste ist die Vorgabe — `effective_user_id ?? user.id`, dieselbe
   * Regel wie bei den Navigations-Zählern (docs §5.4). Bei aktiver Datensicht
   * ist das der Kollege, dessen Liste man gerade abarbeitet, NICHT das eigene
   * Konto; sonst stünde die Seite leer da.
   */
  scopeUserId: string | null;
  /**
   * Darf über die eigene Liste hinausgesehen werden? Nur ein Owner mit
   * Team-Sicht. Bei aktiver Datensicht hat der Server die Menge längst
   * zugeschnitten — ein Schalter „Alle" wäre dort eine Lüge.
   */
  canSeeAll: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  const today = localDateISO();
  const params = useMemo(() => parseTermineParams(sp, today), [sp, today]);
  const tab = tabForView(params.view);

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
  // Die Mitgliederliste ist die Namensquelle für `assigned_user_id` und für den
  // Nachfass-Stempler — eine zweite Abfrage dafür gibt es nicht.
  const usernameById = useMemo(
    () => new Map(members.map((m) => [m.user_id, m.username])),
    [members],
  );

  const { events: allEvents, ohneTermin: allOhneTermin } = useMemo(
    () => buildEvents(settings, closings, usernameById, today),
    [settings, closings, usernameById, today],
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

  /**
   * „Eine Liste pro Person."
   *
   * Der Filter läuft über `assignee` — also über `personOf()` = Zuweisung vor
   * Ersteller (docs §2), dieselbe Achse wie jede Auswertung. Eine Zeile ohne
   * auflösbare Person (gelöschter Nutzer, `on delete set null`) gehört
   * niemandem und fällt aus jeder persönlichen Liste heraus; sie steht unter
   * „Alle", statt jemandem angedichtet zu werden.
   *
   * Der Filter gilt bewusst auch für den KALENDER und nicht nur für die Liste:
   * Ein Schalter, der je nach Reiter etwas anderes bedeutet, ist zwei Schalter.
   */
  const matchesWer = useCallback(
    (e: TerminEvent) => {
      if (params.wer === "alle" || !scopeUserId) return true;
      return e.assignee?.user_id === scopeUserId;
    },
    [params.wer, scopeUserId],
  );

  const filtered = useMemo(
    () => withMoves(allEvents).filter((e) => matchesSearch(e) && matchesWer(e)),
    [allEvents, withMoves, matchesSearch, matchesWer],
  );

  const ohneTermin = useMemo(
    () => allOhneTermin.filter((e) => matchesSearch(e) && matchesWer(e)),
    [allOhneTermin, matchesSearch, matchesWer],
  );

  /**
   * Rückrufe folgen derselben Personenachse — aber über den LISTEN-Owner
   * (`list_owned_by_user()`, docs §2). Das sind die zwei Achsen, die im ganzen
   * Datenmodell nebeneinanderlaufen; sie hier zu vermischen hieße, einen
   * Telefon-Lead demjenigen zuzuschreiben, der zufällig den Termin angelegt hat.
   */
  const rueckrufeGefiltert = useMemo(() => {
    const q = params.search.trim().toLowerCase();
    return rueckrufe.filter((r) => {
      if (params.wer !== "alle" && scopeUserId && r.ownerUserId !== scopeUserId) return false;
      if (!q) return true;
      return [r.company, r.decider].filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  }, [rueckrufe, params.search, params.wer, scopeUserId]);

  // Auf den sichtbaren Zeitraum eingrenzen (Liste und Rückrufe zeigen alles).
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

  // Der Riegel spricht. Die Meldung landet in derselben Fehlerzeile, in der
  // auch eine abgelehnte Server-Antwort steht — der Nutzer hat eine Stelle, an
  // der steht, warum sein letzter Handgriff nichts bewirkt hat.
  const handleBlocked = useCallback((event: TerminEvent) => {
    setError(event.lockedReason);
  }, []);

  const { drag, handlers } = useDragReschedule({
    geometry: dragGeometry,
    onDrop: handleDrop,
    onClick: handleClick,
    onBlocked: handleBlocked,
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

  /**
   * Reiter-Wechsel. „Kalender" landet auf der Woche und nicht auf der zuletzt
   * benutzten Kalenderstufe: Die Stufe steht in derselben URL-Variable wie der
   * Reiter, und ein gemerkter Nebenzustand wäre ein zweiter Ort für dieselbe
   * Frage. Die Liste ist der Vorgabewert und fliegt deshalb aus der URL.
   */
  const handleTab = useCallback(
    (next: TerminTab) =>
      setParam("view", next === "liste" ? null : next === "rueckruf" ? "rueckruf" : "woche"),
    [setParam],
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
        tab={tab}
        periodLabel={periodLabel(params.view, params.date)}
        search={params.search}
        zeit={params.zeit}
        wer={params.wer}
        canSeeAll={canSeeAll}
        onSearch={(q) => setParam("q", q.trim() ? q : null)}
        onZeit={(z) => setParam("zeit", z === "zu_tun" ? null : z)}
        onWer={(w) => setParam("wer", w === "mein" ? null : w)}
        onTab={handleTab}
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

      {tab === "liste" ? (
        <TermineList
          events={filtered}
          ohneTermin={ohneTermin}
          zeit={params.zeit}
          today={today}
          sort={params.sort}
          dir={params.dir}
          onSort={handleSort}
          onError={setError}
        />
      ) : tab === "rueckruf" ? (
        <RueckrufListe aufgaben={rueckrufeGefiltert} verfuegbar={rueckrufeVerfuegbar} />
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
