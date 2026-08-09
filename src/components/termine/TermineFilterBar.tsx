"use client";

import { Segmented } from "@/components/ui/Segmented";
import { Input } from "@/components/ui/Input";
import { CalendarDays, ChevronLeft, ChevronRight, List, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TerminView, TerminZeit } from "./viewState";

// Kopfleiste des Termine-Bereichs — EINE Zeile.
//
// Die frühere zweite Zeile (Typ · Person · Versteckte) ist ersatzlos weg:
//  · Setting/Closing steht als Füllfarbe im Chip selbst,
//  · die Person als Owner-Avatar im Chip,
//  · und „Versteckte" war kein Filter, sondern eine Falle — Unqualifizierte
//    und tote Termine verschwanden dort lautlos. Sie haben jetzt eine eigene
//    Farbe und bleiben sichtbar (siehe lib/terminMeta.ts).
//
// Übrig bleibt, was die Ansicht wirklich steuert: Zeitraum, Suche, Darstellung.
// Der Platzgewinn kommt direkt dem Kalender zugute — genau das war die
// Vorgabe („oben eig fast alles raus").

export type Member = { user_id: string; username: string };

const VIEW_OPTIONS = [
  { value: "monat", label: "Monat" },
  { value: "woche", label: "Woche" },
  { value: "tag", label: "Tag" },
] as const;

// Zeitfenster der Arbeitsliste. In den Kalenderansichten setzt der Zeitraum
// bereits die Grenze — dort steht an dieser Stelle die Datums-Navigation.
const ZEIT_OPTIONS = [
  { value: "anstehend", label: "Anstehend" },
  { value: "vergangen", label: "Vergangen" },
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
  periodLabel,
  search,
  zeit,
  onSearch,
  onZeit,
  onView,
  onStep,
  onToday,
}: {
  view: TerminView;
  periodLabel: string;
  search: string;
  zeit: TerminZeit;
  onSearch: (q: string) => void;
  onZeit: (z: TerminZeit) => void;
  onView: (v: TerminView) => void;
  onStep: (dir: -1 | 1) => void;
  onToday: () => void;
}) {
  const isList = view === "liste";

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
      {/* Links: Datums-Navigation (Kalender) bzw. Zeitfenster (Liste).
          Dieselbe Stelle, dieselbe Aufgabe — „welcher Ausschnitt?". */}
      {isList ? (
        <Segmented
          options={ZEIT_OPTIONS}
          value={zeit}
          onChange={(z) => onZeit(z)}
          ariaLabel="Zeitfenster"
        />
      ) : (
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
        </>
      )}

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
        <Segmented
          options={VIEW_OPTIONS}
          value={isList ? "woche" : view}
          onChange={(v) => onView(v)}
          ariaLabel="Kalender-Ansicht"
        />
        <button
          type="button"
          onClick={() => onView(isList ? "woche" : "liste")}
          title={isList ? "Zurück zum Kalender" : "Arbeitsliste"}
          aria-pressed={isList}
          style={{
            ...navBtn,
            borderColor: isList ? "var(--border-strong)" : "var(--border-default)",
            background: isList ? "var(--surface-3)" : "var(--surface-2)",
            color: isList ? "var(--text-primary)" : "var(--text-muted)",
          }}
        >
          {isList ? <CalendarDays size={15} /> : <List size={15} />}
        </button>
      </div>
    </div>
  );
}
