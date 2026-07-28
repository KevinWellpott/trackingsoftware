"use client";

import { useAnchor } from "@/components/ui/AnchoredPopover";
import { CalendarPopover, formatDateDe } from "@/components/ui/CalendarPopover";
import { Calendar as CalendarIcon } from "lucide-react";

// Datum-Selektor im Brand-Design (ersetzt native <input type="date">):
// Trigger-Chip + Kalender-Popover (Portal, position: fixed — funktioniert damit
// auch in Scroll-/Overflow-Containern wie der virtualisierten Kontakt-Tabelle).
//
// Der Kalender selbst liegt in CalendarPopover.tsx, weil ihn das Datum-Zeit-Feld
// mitbenutzt. `formatDateDe` wird hier weiter re-exportiert (bestehende Importe).

export { formatDateDe };

export function DatePicker({
  value,
  onChange,
  clearable = false,
  placeholder = "Datum",
  variant = "cell",
  shortFormat = false,
  triggerStyle,
  id,
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
  id?: string;
}) {
  const { anchor, ref, toggle, close } = useAnchor();

  const baseTrigger: React.CSSProperties =
    variant === "input"
      ? // Box kommt aus .field-trigger — inline nur, was vom Wert abhaengt.
        { color: value ? "var(--text-primary)" : "var(--text-muted)" }
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
        ref={ref as React.RefObject<HTMLButtonElement>}
        id={id}
        type="button"
        className={variant === "input" ? "field-trigger" : "lbv2-editable"}
        title="Datum wählen"
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        onClick={toggle}
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
            close();
            onChange(iso);
          }}
          onClear={() => {
            close();
            onChange(null);
          }}
          onClose={close}
        />
      )}
    </>
  );
}
