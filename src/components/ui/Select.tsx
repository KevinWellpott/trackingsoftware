"use client";

import { AnchoredPopover, useAnchor, type PopoverAlign } from "@/components/ui/AnchoredPopover";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Dropdown im Brand-Design (ersetzt natives <select>).
//
// Ein natives <select> laesst sich nur im geschlossenen Zustand gestalten — die
// aufgeklappte Liste rendert das Betriebssystem. Genau die fiel aus dem Branding
// heraus. Hier ist die Liste ein Glass-Popover (DESIGN.md §4.2), identisch zum
// Kalender-Popover.
//
// Fokus bleibt bewusst auf dem Trigger (aria-activedescendant-Muster): so
// funktionieren Pfeiltasten, Enter und Escape, ohne Fokus hin- und herzureichen.

/**
 * Unkontrollierte Variante fuer klassische <form action>-Formulare: haelt den
 * Wert selbst und reicht ihn ueber ein verstecktes Feld an die Server-Action
 * weiter — das Gegenstueck zu `<select name=… defaultValue=…>`.
 */
export function FormSelect({
  name,
  defaultValue = "",
  ...rest
}: Omit<React.ComponentProps<typeof Select>, "value" | "onChange"> & {
  name: string;
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return <Select {...rest} name={name} value={value} onChange={setValue} />;
}

export type SelectOption = {
  value: string;
  label: string;
  /** Faerbt Label im Trigger und in der Liste — fuer Kategorien. */
  color?: string;
  /** Zusatzzeile unter dem Label. */
  hint?: string;
  disabled?: boolean;
};

const LIST_MAX_HEIGHT = 288;

export function Select({
  value,
  onChange,
  options,
  placeholder = "—",
  variant = "input",
  align = "start",
  name,
  id,
  ariaLabel,
  title,
  disabled = false,
  triggerStyle,
  triggerClassName,
  width,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  /** input = Formularfeld · cell = kompakter Tabellen-Chip. */
  variant?: "input" | "cell";
  align?: PopoverAlign;
  /** Setzt ein verstecktes Feld — fuer <form action>-Formulare. */
  name?: string;
  id?: string;
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
  triggerStyle?: React.CSSProperties;
  triggerClassName?: string;
  /** Feste Popover-Breite; ohne Angabe so breit wie der Trigger. */
  width?: number;
}) {
  const { anchor, ref, close, open } = useAnchor();
  const listRef = useRef<HTMLDivElement>(null);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const [active, setActive] = useState(selectedIndex < 0 ? 0 : selectedIndex);

  const current = selectedIndex >= 0 ? options[selectedIndex] : null;
  const isOpen = Boolean(anchor);

  const listboxId = `${id ?? "sel"}-listbox`;

  // Oeffnen setzt den aktiven Eintrag auf den gewaehlten — bewusst im Handler
  // und nicht per Effekt, sonst rendert die Liste zweimal.
  function openList() {
    setActive(selectedIndex < 0 ? 0 : selectedIndex);
    open();
  }

  function toggleList() {
    if (isOpen) close();
    else openList();
  }

  // Aktiven Eintrag in den sichtbaren Bereich holen (lange Listen).
  useEffect(() => {
    if (!isOpen) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [isOpen, active]);

  function pick(idx: number) {
    const opt = options[idx];
    if (!opt || opt.disabled) return;
    close();
    if (opt.value !== value) onChange(opt.value);
  }

  function step(delta: number) {
    setActive((cur) => {
      let next = cur;
      for (let i = 0; i < options.length; i++) {
        next = (next + delta + options.length) % options.length;
        if (!options[next]?.disabled) return next;
      }
      return cur;
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); step(1); break;
      case "ArrowUp": e.preventDefault(); step(-1); break;
      case "Home": e.preventDefault(); setActive(0); break;
      case "End": e.preventDefault(); setActive(options.length - 1); break;
      case "Enter":
      case " ": e.preventDefault(); pick(active); break;
      case "Tab": close(); break;
    }
  }

  const baseTrigger: React.CSSProperties =
    variant === "input"
      ? // Box kommt aus .field-trigger — inline nur Wert-abhaengiges.
        {
          justifyContent: "space-between",
          color: current ? (current.color ?? "var(--text-primary)") : "var(--text-muted)",
          opacity: disabled ? 0.55 : 1,
        }
      : {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 4,
          maxWidth: "100%",
          border: "none",
          background: "transparent",
          borderRadius: "var(--r-xs)",
          padding: "2px 4px",
          fontSize: "var(--fs-xs)",
          fontWeight: current?.color ? 600 : 400,
          fontFamily: "inherit",
          color: current ? (current.color ?? "var(--text-secondary)") : "var(--text-muted)",
          cursor: disabled ? "not-allowed" : "pointer",
          whiteSpace: "nowrap",
        };

  return (
    <>
      {name && <input type="hidden" name={name} value={value} />}
      <button
        ref={ref as React.RefObject<HTMLButtonElement>}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        aria-activedescendant={isOpen ? `${id ?? "sel"}-opt-${active}` : undefined}
        title={title}
        disabled={disabled}
        className={triggerClassName ?? (variant === "input" ? "field-trigger" : "lbv2-editable")}
        onClick={() => !disabled && toggleList()}
        onKeyDown={onKeyDown}
        style={{ ...baseTrigger, ...triggerStyle }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {current?.label ?? placeholder}
        </span>
        <ChevronDown
          size={variant === "input" ? 14 : 11}
          style={{
            flexShrink: 0,
            opacity: 0.6,
            color: "var(--text-muted)",
            transform: isOpen ? "rotate(180deg)" : undefined,
            transition: "transform var(--dur-2) var(--ease-out)",
          }}
        />
      </button>

      {anchor && (
        <AnchoredPopover
          anchor={anchor}
          onClose={close}
          label={ariaLabel ?? title ?? "Auswahl"}
          role="listbox"
          id={listboxId}
          align={align}
          width={width}
          maxHeight={LIST_MAX_HEIGHT}
          popoverRef={listRef}
          style={{ padding: "var(--sp-2)" }}
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isActive = idx === active;
            return (
              <div
                key={opt.value || `__empty-${idx}`}
                id={`${id ?? "sel"}-opt-${idx}`}
                data-idx={idx}
                role="option"
                aria-selected={isSelected}
                aria-disabled={opt.disabled || undefined}
                onMouseEnter={() => !opt.disabled && setActive(idx)}
                onClick={() => pick(idx)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.375rem 0.5rem",
                  borderRadius: "var(--r-sm)",
                  fontSize: "var(--fs-sm)",
                  lineHeight: 1.35,
                  cursor: opt.disabled ? "not-allowed" : "pointer",
                  // Gewaehlt = Orange wie im Kalender; nur-aktiv = neutrale Flaeche.
                  background: isSelected ? "var(--accent-muted)" : isActive ? "var(--surface-2)" : "transparent",
                  color: opt.disabled
                    ? "var(--text-disabled)"
                    : (opt.color ?? (isSelected ? "var(--orange-300)" : "var(--text-secondary)")),
                  fontWeight: isSelected ? 600 : 400,
                }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {opt.label}
                  {opt.hint && (
                    <span style={{ display: "block", fontSize: "var(--fs-2xs)", color: "var(--text-muted)", fontWeight: 400 }}>
                      {opt.hint}
                    </span>
                  )}
                </span>
                {isSelected && <Check size={13} style={{ flexShrink: 0, color: "var(--orange-300)" }} />}
              </div>
            );
          })}
        </AnchoredPopover>
      )}
    </>
  );
}
