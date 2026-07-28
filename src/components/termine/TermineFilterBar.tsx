"use client";

import { ownerColor, ownerInitials } from "@/lib/ownerColor";
import { Segmented } from "@/components/ui/Segmented";
import { Input } from "@/components/ui/Input";
import { CalendarDays, ChevronLeft, ChevronRight, Eye, EyeOff, List, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TerminView, TerminZeit } from "./viewState";

// Obere Filterzeile: Navigation + Ansichtswechsel + Typ- und Personenfilter.
// Die Listenansicht ist bewusst kein vierter Tab, sondern ein zurückhaltender
// Icon-Button — sie wird nur geöffnet, wenn man sie wirklich braucht.

export type Member = { user_id: string; username: string };

const VIEW_OPTIONS = [
  { value: "monat", label: "Monat" },
  { value: "woche", label: "Woche" },
  { value: "tag", label: "Tag" },
] as const;

// Zeitfenster der Listenansicht. In den Kalenderansichten setzt der Zeitraum
// bereits die Grenze — dort waere der Filter bedeutungslos und wird ausgeblendet.
const ZEIT_OPTIONS = [
  { value: "anstehend", label: "Anstehend" },
  { value: "vergangen", label: "Vergangen" },
  { value: "alle", label: "Alle" },
] as const;

const chipBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--sp-3)",
  height: 28,
  padding: "0 var(--sp-5)",
  borderRadius: "var(--r-full)",
  fontSize: "var(--fs-sm)",
  fontWeight: 500,
  fontFamily: "inherit",
  cursor: "pointer",
  transition: "background var(--transition-fast), border-color var(--transition-fast)",
};

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
  kinds,
  persons,
  members,
  showHidden,
  hiddenCount,
  counts,
  canFilterPersons,
  search,
  zeit,
  onSearch,
  onZeit,
  onView,
  onStep,
  onToday,
  onToggleKind,
  onTogglePerson,
  onResetPersons,
  onToggleHidden,
}: {
  view: TerminView;
  periodLabel: string;
  kinds: Set<"setting" | "closing">;
  persons: Set<string>;
  members: Member[];
  showHidden: boolean;
  hiddenCount: number;
  counts: { setting: number; closing: number };
  canFilterPersons: boolean;
  search: string;
  zeit: TerminZeit;
  onSearch: (q: string) => void;
  onZeit: (z: TerminZeit) => void;
  onView: (v: TerminView) => void;
  onStep: (dir: -1 | 1) => void;
  onToday: () => void;
  onToggleKind: (k: "setting" | "closing") => void;
  onTogglePerson: (userId: string) => void;
  onResetPersons: () => void;
  onToggleHidden: () => void;
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
      className="glass-nav"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        // Sticky-Kopf im Glass-Nav-Rezept: eine der drei Glasflaechen dieser View.
        paddingBottom: "var(--sp-5)",
        marginBottom: "var(--sp-7)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-5)",
      }}
    >
      {/* ── Zeile 1: Navigation · Zeitraum · Ansicht ── */}
      <div className="filter-bar-row" style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap" }}>
        <button type="button" onClick={() => onStep(-1)} aria-label="Zurück" style={navBtn} disabled={isList}>
          <ChevronLeft size={15} />
        </button>
        <button type="button" onClick={() => onStep(1)} aria-label="Vor" style={navBtn} disabled={isList}>
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
            title={isList ? "Zurück zum Kalender" : "Listenansicht"}
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

      {/* ── Zeile 2: Zeit · Typ · Person · Versteckte ── */}
      <div className="filter-bar-row" style={{ display: "flex", alignItems: "center", gap: "var(--sp-6)", flexWrap: "wrap" }}>
        {isList && (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
            {ZEIT_OPTIONS.map((o) => {
              const active = zeit === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => onZeit(o.value)}
                  aria-pressed={active}
                  style={{
                    ...chipBase,
                    border: `1px solid ${active ? "var(--border-accent)" : "var(--border-default)"}`,
                    background: active ? "var(--accent-muted)" : "var(--surface-1)",
                    color: active ? "var(--orange-300)" : "var(--text-muted)",
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
          {(["setting", "closing"] as const).map((k) => {
            const active = kinds.has(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => onToggleKind(k)}
                aria-pressed={active}
                // Typ hat keine eigene Farbe mehr — Farbe kodiert im Kalender
                // den Status. Der Chip folgt deshalb dem normalen Aktiv-Muster
                // wie alle anderen Filter dieser Leiste.
                style={{
                  ...chipBase,
                  border: `1px solid ${active ? "var(--border-accent)" : "var(--border-default)"}`,
                  background: active ? "var(--accent-muted)" : "var(--surface-1)",
                  color: active ? "var(--orange-300)" : "var(--text-muted)",
                }}
              >
                {k === "setting" ? "Setting" : "Closing"}
                <span className="tnum" style={{ fontSize: "var(--fs-2xs)", opacity: 0.75 }}>{counts[k]}</span>
              </button>
            );
          })}
        </div>

        {canFilterPersons && members.length > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
            <span className="eyebrow eyebrow-muted">Person</span>
            <button
              type="button"
              onClick={onResetPersons}
              aria-pressed={persons.size === 0}
              style={{
                ...chipBase,
                border: `1px solid ${persons.size === 0 ? "var(--border-accent)" : "var(--border-default)"}`,
                background: persons.size === 0 ? "var(--accent-muted)" : "var(--surface-1)",
                color: persons.size === 0 ? "var(--orange-300)" : "var(--text-muted)",
              }}
            >
              Alle
            </button>
            {members.map((m) => {
              const active = persons.has(m.user_id);
              const oc = ownerColor(m.username);
              return (
                <button
                  key={m.user_id}
                  type="button"
                  onClick={() => onTogglePerson(m.user_id)}
                  aria-pressed={active}
                  title={m.username}
                  style={{
                    ...chipBase,
                    paddingLeft: 2,
                    border: `1px solid ${active ? oc.fg : "var(--border-default)"}`,
                    background: active ? oc.bg : "var(--surface-1)",
                    color: active ? oc.fg : "var(--text-muted)",
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "var(--r-full)",
                      background: oc.bg,
                      color: oc.fg,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "var(--fs-2xs)",
                      fontWeight: 600,
                    }}
                  >
                    {ownerInitials(m.username)}
                  </span>
                  {m.username}
                </button>
              );
            })}
          </div>
        )}

        {/* Dead + Unqualifiziert: bewusst versteckt, nur auf Klick sichtbar */}
        <button
          type="button"
          onClick={onToggleHidden}
          aria-pressed={showHidden}
          title={
            showHidden
              ? "Dead & Unqualifiziert wieder ausblenden"
              : "Dead & Unqualifiziert einblenden"
          }
          style={{
            ...chipBase,
            marginLeft: "auto",
            border: `1px solid ${showHidden ? "rgb(209 162 79 / 0.28)" : "var(--border-default)"}`,
            background: showHidden ? "var(--warning-bg)" : "transparent",
            color: showHidden ? "var(--warning-fg)" : "var(--text-muted)",
            opacity: showHidden || hiddenCount > 0 ? 1 : 0.55,
          }}
        >
          {showHidden ? <Eye size={12} /> : <EyeOff size={12} />}
          Versteckte
          <span className="tnum" style={{ fontSize: "var(--fs-2xs)", opacity: 0.75 }}>{hiddenCount}</span>
        </button>
      </div>
    </div>
  );
}
