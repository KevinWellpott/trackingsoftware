"use client";

import { Segmented } from "@/components/ui/Segmented";
import { Input } from "@/components/ui/Input";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TerminTab, TerminView, TermineWer, TerminZeit } from "./viewState";

// Kopfleiste des Termine-Bereichs — EINE Zeile, plus die Reiter darüber.
//
// ── Die Umkehrung des Rückbaus ────────────────────────────────────────────
// Bis hierher war der Kalender die Seite und die Arbeitsliste ein
// unbeschrifteter Umschalt-Knopf ganz rechts außen. Jetzt stehen die drei
// Ansichten als gleichrangige Reiter nebeneinander — Liste zuerst —, und die
// Monat/Woche/Tag-Auswahl ist das, was sie immer war: eine Frage INNERHALB des
// Kalenders. Sie erscheint nur, wenn der Kalender offen ist.
//
// ── WARUM DIE REITER KEINE SEGMENTED-PILLE MEHR SIND ──────────────────────
// Sie waren eine: dieselbe orange gefüllte Pille wie das Zeitfenster und der
// Personenschalter, nur ganz rechts außen hinter dem Suchfeld. Drei optisch
// gleiche Bedienelemente in einer Zeile, von denen eines die SEITE wechselt
// und zwei nur filtern — dazu der Primär-CTA daneben, macht bis zu vier
// orange Flächen in einem Viewport (DESIGN.md §3.8: „Ein Primär-CTA pro View
// … Orange-Flächen nur als Tint").
//
// Für Ansichts-Untergliederung ist die Tab-Leiste zuständig (COMPONENTS.md
// §10.3: Text 14px/500, aktiver Reiter mit 2px-Unterstrich in --orange-500),
// und /ablage löst dieselbe Aufgabe längst genau so (`AblageNav`). Die
// Segmented-Controls bleiben den beiden FILTERN — dort sind sie richtig
// (COMPONENTS.md §3.6).
//
// Der Personenschalter daneben ist die zweite Vorgabe des Auftraggebers: „Eine
// Liste pro Person." Er zeigt sich nur, wenn es etwas zu schalten gibt — bei
// aktiver Datensicht hat der Server die Menge längst zugeschnitten.

export type Member = { user_id: string; username: string };

const TAB_OPTIONS = [
  { value: "liste", label: "Liste" },
  { value: "kalender", label: "Kalender" },
  { value: "rueckruf", label: "Rückrufe" },
] as const;

/**
 * Die drei Ansichten als Textreiter — Optik und Klassen wortgleich zu
 * `AblageNav` (`.tab-scroller`/`.ui-tab`, COMPONENTS.md §10.3).
 *
 * Knöpfe statt `Link`s, anders als in der Ablage: Dort hängt genau EIN
 * URL-Parameter an der Auswahl, hier räumt der Wechsel zusätzlich die
 * Kalenderstufe auf (`handleTab` im Board setzt `view` auf `woche`, wenn man
 * in den Kalender geht). Ein `href` müsste diese Regel ein zweites Mal
 * formulieren.
 */
export function TermineTabs({ tab, onTab }: { tab: TerminTab; onTab: (t: TerminTab) => void }) {
  return (
    <nav className="tab-scroller" aria-label="Ansicht" style={{ marginBottom: "var(--sp-5)" }}>
      {TAB_OPTIONS.map((o) => {
        const active = o.value === tab;
        return (
          <button
            key={o.value}
            type="button"
            className="ui-tab"
            data-active={active}
            aria-current={active ? "page" : undefined}
            onClick={() => onTab(o.value)}
            style={{ flexShrink: 0, whiteSpace: "nowrap" }}
          >
            {o.label}
          </button>
        );
      })}
    </nav>
  );
}

const KALENDER_OPTIONS = [
  { value: "monat", label: "Monat" },
  { value: "woche", label: "Woche" },
  { value: "tag", label: "Tag" },
] as const;

// Ausschnitt der Arbeitsliste. In den Kalenderansichten setzt der Zeitraum
// bereits die Grenze — dort steht an dieser Stelle die Datums-Navigation.
//
// ── AUS DREI AUSSCHNITTEN WURDEN VIER ────────────────────────────────────
// Der mittlere hieß „Termin steht" und führte Erstgespräche und Closings in
// einer Liste. Der Auftraggeber hat beides beanstandet: Das Wort benennt einen
// ZUSTAND, die Ansicht hat aber eine AUFGABE — dort werden die zwei
// Erinnerungen vor dem Termin abgearbeitet. Und die beiden Termin-Arten
// gehören getrennt, weil man sonst seine fünf Closings zwischen vierzig
// Settings heraussucht.
//
// Der ZUSTAND heißt weiterhin „Termin steht" (`TERMIN_ZUSTAND_LABEL`,
// src/lib/dranRegel.ts) — nur eben im Status-Pill, wo er hingehört. Hier stehen
// die Aufgaben.
//
// DIE ZAHL DANEBEN ist die der Zeilen, die der Ausschnitt wirklich zeigt —
// gebildet über dieselbe Menge, die die Liste rendert (`zeitCounts` im Board).
const ZEIT_OPTIONS = [
  { value: "zu_tun", label: "Zu tun" },
  { value: "erinnerung_setting", label: "Erinnerung Setting" },
  { value: "erinnerung_closing", label: "Erinnerung Closing" },
  { value: "alle", label: "Alle" },
] as const;

// „Alle Personen" statt schlicht „Alle": In derselben Leiste steht beim
// Zeitfenster ebenfalls ein „Alle", und es bedeutet etwas anderes (alle
// Zustände statt aller Personen). Zwei gleich beschriftete Pillen
// nebeneinander, die Verschiedenes tun, kosten beim ersten Fehlgriff mehr als
// das eine Wort an Platz.
const WER_OPTIONS = [
  { value: "mein", label: "Meine" },
  { value: "alle", label: "Alle Personen" },
] as const;

const navBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "var(--h-control)",
  height: "var(--h-control)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--r-md)",
  background: "var(--surface-2)",
  color: "var(--text-muted)",
  cursor: "pointer",
};

export function TermineFilterBar({
  view,
  tab,
  periodLabel,
  search,
  zeit,
  zeitCounts,
  wer,
  canSeeAll,
  onSearch,
  onZeit,
  onWer,
  onView,
  onStep,
  onToday,
}: {
  view: TerminView;
  /** Nur zur Frage „was steht links?" — umgeschaltet wird über `TermineTabs`. */
  tab: TerminTab;
  periodLabel: string;
  search: string;
  zeit: TerminZeit;
  /** Zeilenzahl je Ausschnitt, aus derselben Menge wie die Liste darunter. */
  zeitCounts: Record<TerminZeit, number>;
  wer: TermineWer;
  /** Owner mit Team-Sicht: nur er darf über die eigene Liste hinaussehen. */
  canSeeAll: boolean;
  onSearch: (q: string) => void;
  onZeit: (z: TerminZeit) => void;
  onWer: (w: TermineWer) => void;
  onView: (v: TerminView) => void;
  onStep: (dir: -1 | 1) => void;
  onToday: () => void;
}) {
  const isKalender = tab === "kalender";

  // Die Zahl steht IM Segment-Label, nicht als zweite Pille daneben: Das
  // Badge-Budget erlaubt ein farbiges Element je Zeile (DESIGN.md §3.6), und
  // eine Zähl-Pille auf einem Segment wäre genau das zweite. Kein neues
  // Bauteil, keine neue Farbe — derselbe Trenner „·" wie in jeder Meta-Zeile.
  const zeitOptions = useMemo(
    () => ZEIT_OPTIONS.map((o) => ({ value: o.value, label: `${o.label} · ${zeitCounts[o.value]}` })),
    [zeitCounts],
  );

  // Eingabe lokal puffern und verzoegert in die URL schreiben. setParam macht
  // ein router.replace — pro Tastendruck waere das ein Server-Roundtrip.
  // Die URL bleibt trotzdem die Wahrheit (teilbar, ueberlebt Ansichtswechsel).
  const [draft, setDraft] = useState(search);
  const [syncedSearch, setSyncedSearch] = useState(search);
  if (search !== syncedSearch) {
    setSyncedSearch(search);
    setDraft(search);
  }

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function onSearchInput(value: string) {
    setDraft(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onSearch(value), 250);
  }

  return (
    <div
      className="glass-nav filter-bar-row"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        // Sticky-Kopf im Glass-Nav-Rezept: eine der drei Glasflaechen dieser View.
        paddingBottom: "var(--sp-4)",
        marginBottom: "var(--sp-5)",
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-4)",
        flexWrap: "wrap",
      }}
    >
      {/* Links: was den Ausschnitt steuert. Im Kalender die Datums-Navigation,
          in der Liste der Ausschnitt samt seiner Zahl, bei den Rückrufen nichts
          — dort ist die Fälligkeit der Ausschnitt. */}
      {isKalender ? (
        <>
          <button type="button" onClick={() => onStep(-1)} aria-label="Zurück" style={navBtn}>
            <ChevronLeft size={15} />
          </button>
          <button type="button" onClick={() => onStep(1)} aria-label="Vor" style={navBtn}>
            <ChevronRight size={15} />
          </button>
          <button
            type="button"
            onClick={onToday}
            style={{
              ...navBtn,
              width: "auto",
              padding: "0 var(--sp-6)",
              fontSize: "var(--fs-sm)",
              fontWeight: 500,
              fontFamily: "inherit",
            }}
          >
            Heute
          </button>
          <Segmented
            options={KALENDER_OPTIONS}
            value={view === "monat" || view === "tag" ? view : "woche"}
            onChange={(v) => onView(v)}
            ariaLabel="Kalender-Ansicht"
          />
        </>
      ) : tab === "liste" ? (
        <Segmented options={zeitOptions} value={zeit} onChange={(z) => onZeit(z)} ariaLabel="Ausschnitt" />
      ) : null}

      <span
        style={{
          fontSize: "var(--fs-lg)",
          fontWeight: 600,
          letterSpacing: "var(--ls-display)",
          color: "var(--text-primary)",
          textTransform: "capitalize",
          marginLeft: "var(--sp-3)",
        }}
      >
        {periodLabel}
      </span>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
        {/* Suche gilt in ALLEN Ansichten und liegt in der URL — vorher hielt
            die Listenansicht sie lokal und verlor sie beim Umschalten. */}
        <div style={{ position: "relative", width: 208 }}>
          <Search
            size={13}
            style={{
              position: "absolute",
              left: "0.625rem",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-subtle)",
              pointerEvents: "none",
            }}
          />
          <Input
            type="search"
            placeholder="Lead oder Firma…"
            value={draft}
            onChange={(e) => onSearchInput(e.target.value)}
            aria-label="Termine durchsuchen"
            style={{ minHeight: "var(--h-control)", padding: "0.35rem 0.75rem 0.35rem 2rem", fontSize: "var(--fs-sm)" }}
          />
        </div>
        {canSeeAll && (
          <Segmented options={WER_OPTIONS} value={wer} onChange={(w) => onWer(w)} ariaLabel="Wessen Termine" />
        )}
      </div>
    </div>
  );
}
