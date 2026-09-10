"use client";

import { Segmented } from "@/components/ui/Segmented";
import { Input } from "@/components/ui/Input";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TerminTab, TerminView, TermineWer, TerminZeit } from "./viewState";

// Kopfleiste des Termine-Bereichs — EINE Zeile.
//
// ── Die Umkehrung des Rückbaus ────────────────────────────────────────────
// Bis hierher war der Kalender die Seite und die Arbeitsliste ein
// unbeschrifteter Umschalt-Knopf ganz rechts außen. Jetzt stehen die drei
// Ansichten als gleichrangige Reiter nebeneinander — Liste zuerst —, und die
// Monat/Woche/Tag-Auswahl ist das, was sie immer war: eine Frage INNERHALB des
// Kalenders. Sie erscheint nur, wenn der Kalender offen ist.
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

const KALENDER_OPTIONS = [
  { value: "monat", label: "Monat" },
  { value: "woche", label: "Woche" },
  { value: "tag", label: "Tag" },
] as const;

// Zeitfenster der Arbeitsliste. In den Kalenderansichten setzt der Zeitraum
// bereits die Grenze — dort steht an dieser Stelle die Datums-Navigation.
const ZEIT_OPTIONS = [
  { value: "zu_tun", label: "Zu tun" },
  { value: "verlegt", label: "Verlegt" },
  { value: "alle", label: "Alle" },
] as const;

const WER_OPTIONS = [
  { value: "mein", label: "Meine" },
  { value: "alle", label: "Alle" },
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
  wer,
  canSeeAll,
  onSearch,
  onZeit,
  onWer,
  onTab,
  onView,
  onStep,
  onToday,
}: {
  view: TerminView;
  tab: TerminTab;
  periodLabel: string;
  search: string;
  zeit: TerminZeit;
  wer: TermineWer;
  /** Owner mit Team-Sicht: nur er darf über die eigene Liste hinaussehen. */
  canSeeAll: boolean;
  onSearch: (q: string) => void;
  onZeit: (z: TerminZeit) => void;
  onWer: (w: TermineWer) => void;
  onTab: (t: TerminTab) => void;
  onView: (v: TerminView) => void;
  onStep: (dir: -1 | 1) => void;
  onToday: () => void;
}) {
  const isKalender = tab === "kalender";

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
          in der Liste das Zeitfenster, bei den Rückrufen nichts — dort ist die
          Fälligkeit der Ausschnitt. */}
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
        <Segmented options={ZEIT_OPTIONS} value={zeit} onChange={(z) => onZeit(z)} ariaLabel="Zeitfenster" />
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
        <Segmented options={TAB_OPTIONS} value={tab} onChange={(t) => onTab(t)} ariaLabel="Ansicht" />
      </div>
    </div>
  );
}
