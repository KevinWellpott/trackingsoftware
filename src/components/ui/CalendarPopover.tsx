"use client";

import { AnchoredPopover } from "@/components/ui/AnchoredPopover";
import { buildMonthGrid, localDateISO, monthLabelDe, WEEKDAYS_DE } from "@/lib/dates";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

// Monatskalender im Brand-Design, Montag-Start. Liegt bewusst getrennt vom
// DatePicker: das Datum-Zeit-Feld (DateTimeField) braucht denselben Kalender,
// aber einen anderen Trigger.

export const CALENDAR_WIDTH = 252;

function parseISO(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

/** "2026-07-27" → "27.07.2026" (Anzeige de-DE). */
export function formatDateDe(iso: string | null | undefined, opts?: { short?: boolean }): string {
  if (!iso) return "";
  const { y, m, d } = parseISO(iso);
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return opts?.short ? `${dd}.${mm}.` : `${dd}.${mm}.${y}`;
}

const navBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  border: "1px solid var(--border-default)",
  borderRadius: "var(--r-sm)",
  background: "var(--surface-1)",
  color: "var(--text-muted)",
  cursor: "pointer",
};

const footBtn: React.CSSProperties = {
  border: "1px solid var(--border-default)",
  borderRadius: "var(--r-sm)",
  background: "var(--surface-1)",
  color: "var(--text-secondary)",
  fontSize: "var(--fs-xs)",
  fontWeight: 500,
  padding: "0.25rem 0.625rem",
  cursor: "pointer",
};

export function CalendarPopover({
  anchor,
  value,
  clearable,
  onPick,
  onClear,
  onClose,
}: {
  anchor: DOMRect;
  value: string | null;
  clearable: boolean;
  onPick: (iso: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const today = localDateISO();
  const [view, setView] = useState(() => {
    const { y, m } = parseISO(value ?? today);
    return { y, m };
  });

  const grid = buildMonthGrid(view.y, view.m);

  function shiftMonth(delta: number) {
    setView((v) => {
      const dt = new Date(v.y, v.m - 1 + delta, 1);
      return { y: dt.getFullYear(), m: dt.getMonth() + 1 };
    });
  }

  return (
    // Glass-Popover-Rezept (DESIGN.md §4.2) — Dropdowns sind Glas, Dialoge solid.
    <AnchoredPopover
      anchor={anchor}
      onClose={onClose}
      label="Datum wählen"
      width={CALENDAR_WIDTH}
      style={{ padding: "var(--sp-5)" }}
    >
      {/* Monat-Navigation */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <button type="button" onClick={() => shiftMonth(-1)} aria-label="Voriger Monat" style={navBtn}>
          <ChevronLeft size={14} />
        </button>
        <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text-primary)", textTransform: "capitalize" }}>
          {monthLabelDe(view.y, view.m)}
        </span>
        <button type="button" onClick={() => shiftMonth(1)} aria-label="Nächster Monat" style={navBtn}>
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Wochentage */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 2 }}>
        {WEEKDAYS_DE.map((wd) => (
          <span
            key={wd}
            style={{
              textAlign: "center",
              fontSize: "var(--fs-2xs)",
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "var(--ls-eyebrow)",
              color: "var(--text-muted)",
              padding: "0.25rem 0",
            }}
          >
            {wd}
          </span>
        ))}
      </div>

      {/* Tage */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {grid.map((cell) => {
          const selected = cell.iso === value;
          const isToday = cell.iso === today;
          return (
            <button
              key={cell.iso}
              type="button"
              onClick={() => onPick(cell.iso)}
              className={selected ? undefined : "dp-day"}
              style={{
                height: 30,
                // Gewaehlt = Orange-Flaeche mit dunklem Text (7.1:1);
                // heute = nur Orange-Rand, damit nie zwei Orange-Flaechen
                // im selben Raster stehen.
                border: isToday && !selected ? "1px solid var(--border-accent)" : "1px solid transparent",
                borderRadius: "var(--r-sm)",
                background: selected ? "var(--orange-500)" : "transparent",
                color: selected ? "#0a0a0b" : cell.inMonth ? "var(--text-secondary)" : "var(--text-disabled)",
                fontSize: "var(--fs-xs)",
                fontWeight: selected || isToday ? 600 : 400,
                fontVariantNumeric: "tabular-nums",
                cursor: "pointer",
                padding: 0,
              }}
            >
              {cell.day}
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", marginTop: "0.625rem" }}>
        <button
          type="button"
          onClick={() => onPick(today)}
          style={{ ...footBtn, color: "var(--orange-300)", borderColor: "var(--border-accent)", background: "var(--accent-muted)" }}
        >
          Heute
        </button>
        {clearable && value && (
          <button type="button" onClick={onClear} style={footBtn}>
            Leeren
          </button>
        )}
      </div>
    </AnchoredPopover>
  );
}
