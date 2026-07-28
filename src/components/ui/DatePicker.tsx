"use client";

import { buildMonthGrid, localDateISO, monthLabelDe, WEEKDAYS_DE } from "@/lib/dates";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Datum-Selektor im Brand-Design (ersetzt native <input type="date">):
// Trigger-Chip + Kalender-Popover (Portal, position: fixed — funktioniert damit
// auch in Scroll-/Overflow-Containern wie der virtualisierten Kontakt-Tabelle).
// Montag-Start, „Heute“-Shortcut, optional „Leeren“; Tokens für Light + Dark.

const POPOVER_WIDTH = 252;

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

function CalendarPopover({
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
  const base = value ?? today;
  const [view, setView] = useState(() => {
    const { y, m } = parseISO(base);
    return { y, m };
  });
  const popRef = useRef<HTMLDivElement>(null);

  // Outside-Click, Escape und Scrollen (fixed-Popover würde sonst „davonschweben“).
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (popRef.current && e.target instanceof Node && !popRef.current.contains(e.target)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onScroll(e: Event) {
      if (popRef.current && e.target instanceof Node && popRef.current.contains(e.target)) return;
      onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  // Position: unter dem Trigger, horizontal eingeklemmt, bei Platzmangel darüber.
  const estHeight = 322;
  const below = anchor.bottom + 6 + estHeight <= window.innerHeight || anchor.top - 6 - estHeight < 0;
  const top = below ? anchor.bottom + 6 : anchor.top - 6 - estHeight;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - POPOVER_WIDTH - 8));

  const grid = buildMonthGrid(view.y, view.m);

  function shiftMonth(delta: number) {
    setView((v) => {
      const dt = new Date(v.y, v.m - 1 + delta, 1);
      return { y: dt.getFullYear(), m: dt.getMonth() + 1 };
    });
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

  return createPortal(
    // Glass-Popover-Rezept (DESIGN.md §4.2) — Dropdowns sind Glas, Dialoge solid.
    <div
      ref={popRef}
      role="dialog"
      aria-label="Datum wählen"
      className="glass-popover"
      style={{
        position: "fixed",
        top,
        left,
        zIndex: 130,
        width: POPOVER_WIDTH,
        boxSizing: "border-box",
        padding: "var(--sp-5)",
        animation: "fade-up var(--dur-2) var(--ease-out) both",
      }}
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
        <button type="button" onClick={() => onPick(today)} style={{ ...footBtn, color: "var(--orange-300)", borderColor: "var(--border-accent)", background: "var(--accent-muted)" }}>
          Heute
        </button>
        {clearable && value && (
          <button type="button" onClick={onClear} style={footBtn}>
            Leeren
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function DatePicker({
  value,
  onChange,
  clearable = false,
  placeholder = "Datum",
  variant = "cell",
  shortFormat = false,
  triggerStyle,
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
  clearable?: boolean;
  placeholder?: string;
  /** cell = kompakter Tabellen-Chip, input = Formularfeld-Optik. */
  variant?: "cell" | "input";
  /** Anzeige ohne Jahr (Tabellen-Spalte). */
  shortFormat?: boolean;
  triggerStyle?: React.CSSProperties;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const baseTrigger: React.CSSProperties =
    variant === "input"
      ? {
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          width: "100%",
          minHeight: "var(--h-control)",
          boxSizing: "border-box",
          background: "var(--surface-1)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--r-md)",
          padding: "0 var(--sp-5)",
          fontSize: "var(--fs-base)",
          fontFamily: "inherit",
          fontVariantNumeric: "tabular-nums",
          color: value ? "var(--text-primary)" : "var(--text-muted)",
          cursor: "pointer",
          textAlign: "left",
        }
      : {
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          border: "none",
          background: "transparent",
          borderRadius: "var(--r-xs)",
          padding: "2px 4px",
          fontSize: "var(--fs-xs)",
          fontFamily: "inherit",
          fontVariantNumeric: "tabular-nums",
          color: value ? "var(--text-secondary)" : "var(--text-muted)",
          cursor: "pointer",
          whiteSpace: "nowrap",
        };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="lbv2-editable"
        title="Datum wählen"
        onClick={() => {
          const rect = triggerRef.current?.getBoundingClientRect();
          if (rect) setAnchor(anchor ? null : rect);
        }}
        style={{ ...baseTrigger, ...triggerStyle }}
      >
        <CalendarIcon size={variant === "input" ? 14 : 11} style={{ flexShrink: 0, opacity: 0.7 }} />
        {value ? formatDateDe(value, { short: shortFormat }) : placeholder}
      </button>
      {anchor && (
        <CalendarPopover
          anchor={anchor}
          value={value}
          clearable={clearable}
          onPick={(iso) => {
            setAnchor(null);
            onChange(iso);
          }}
          onClear={() => {
            setAnchor(null);
            onChange(null);
          }}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}
