"use client";

import { AnchoredPopover, useAnchor, type PopoverAlign } from "@/components/ui/AnchoredPopover";
import { Check, ChevronDown } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";

// Dropdown im Brand-Design (ersetzt natives <select>).
//
// Ein natives <select> laesst sich nur im geschlossenen Zustand gestalten — die
// aufgeklappte Liste rendert das Betriebssystem. Genau die fiel aus dem Branding
// heraus. Hier ist die Liste ein Glass-Popover (DESIGN.md §4.2), identisch zum
// Kalender-Popover.
//
// Fokus bleibt bewusst auf dem Trigger (aria-activedescendant-Muster): so
// funktionieren Pfeiltasten, Enter und Escape, ohne Fokus hin- und herzureichen.
//
// Optionale Gruppenkoepfe: `SelectOption.group` (siehe dort). Die Optionsliste
// bleibt dabei ein FLACHES Array — die Koepfe sind reine Darstellung und
// tauchen in der Tastatursteuerung gar nicht auf.

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
  /**
   * Optionale Ueberschrift ueber dieser Option.
   *
   * Aufeinanderfolgende Optionen mit demselben Text stehen unter EINEM Kopf;
   * die Reihenfolge bleibt die des Arrays (die Liste sortiert nichts um). Ohne
   * `group` rendert die Liste exakt wie vorher — bestehende Aufrufer merken
   * von der Ergaenzung nichts.
   *
   * Warum ueberhaupt: Bei ~30 Eintraegen ist eine flache Liste keine Auswahl
   * mehr, sondern eine Suchaufgabe. Im Serienvergleich stehen dort drei
   * gleichnamige „Termine…"-Kennzahlen aus drei Quellen nebeneinander — ohne
   * Kopf ist nicht erkennbar, welche welche ist.
   */
  group?: string;
};

const LIST_MAX_HEIGHT = 288;

/** Erster (dir=1) bzw. letzter (dir=-1) waehlbarer Index; 0, wenn es keinen gibt. */
function firstEnabled(options: SelectOption[], dir: 1 | -1): number {
  const start = dir === 1 ? 0 : options.length - 1;
  for (let i = start; i >= 0 && i < options.length; i += dir) {
    if (!options[i]?.disabled) return i;
  }
  return 0;
}

/** Ein Lauf aufeinanderfolgender Optionen derselben Gruppe (Index-Bereich). */
type OptionRun = { group?: string; from: number; to: number };

/**
 * Zerlegt die flache Optionsliste in Gruppen-Laeufe.
 *
 * Entscheidend: Die Optionen bleiben EIN flaches Array, die Laeufe tragen nur
 * Index-Bereiche. Damit bleiben `active`, `aria-activedescendant`, `data-idx`
 * und `step()` unveraendert auf den flachen Indizes — und Gruppenkoepfe werden
 * von der Tastatur gar nicht erst beruehrt, weil sie keine Optionen sind.
 */
function buildRuns(options: SelectOption[]): OptionRun[] {
  const runs: OptionRun[] = [];
  for (let i = 0; i < options.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.group === options[i].group) last.to = i;
    else runs.push({ group: options[i].group, from: i, to: i });
  }
  return runs;
}

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
    setActive(selectedIndex < 0 ? firstEnabled(options, 1) : selectedIndex);
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
      // Home/End springen auf den ersten bzw. letzten WAEHLBAREN Eintrag.
      // Seit es deaktivierte Optionen gibt (unpassende Filterwerte im
      // Serienvergleich), landete ein blindes 0 / length-1 sonst auf einem
      // Eintrag, den Enter nicht annimmt — die Liste wirkte kaputt.
      case "Home": e.preventDefault(); setActive(firstEnabled(options, 1)); break;
      case "End": e.preventDefault(); setActive(firstEnabled(options, -1)); break;
      case "Enter":
      case " ": e.preventDefault(); pick(active); break;
      case "Tab": close(); break;
    }
  }

  const runs = buildRuns(options);
  // Ohne eine einzige `group` bleibt der Renderpfad exakt der alte: ein
  // flacher Lauf, kein Wrapper, kein Kopf.
  const hasGroups = runs.some((r) => r.group !== undefined);

  /** Rendert die Optionen eines Laufs — Index bleibt der FLACHE Index. */
  function renderRun(run: { from: number; to: number }) {
    const out = [];
    for (let idx = run.from; idx <= run.to; idx++) {
      const opt = options[idx];
      if (!opt) continue;
      const isSelected = opt.value === value;
      const isActive = idx === active;
      out.push(
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
              <span
                style={{
                  display: "block",
                  fontSize: "var(--fs-2xs)",
                  color: opt.disabled ? "var(--text-disabled)" : "var(--text-muted)",
                  fontWeight: 400,
                  // Der Hinweis traegt bei deaktivierten Eintraegen den GRUND —
                  // der darf nicht auf halbem Wege abgeschnitten werden.
                  whiteSpace: "normal",
                }}
              >
                {opt.hint}
              </span>
            )}
          </span>
          {isSelected && <Check size={13} style={{ flexShrink: 0, color: "var(--orange-300)" }} />}
        </div>,
      );
    }
    return out;
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
          {hasGroups
            ? runs.map((run, r) =>
                run.group === undefined ? (
                  // Optionen vor dem ersten Kopf (z. B. „alle") bleiben ohne
                  // Gruppe stehen — sie gehoeren zu keiner.
                  <Fragment key={`run-${r}`}>{renderRun(run)}</Fragment>
                ) : (
                  // role="group" im Listbox ist die vorgesehene Schachtelung;
                  // der sichtbare Kopf ist damit doppelt und wird versteckt.
                  <div key={`run-${r}`} role="group" aria-label={run.group}>
                    <div
                      aria-hidden
                      className="eyebrow eyebrow-muted"
                      style={{
                        padding: "var(--sp-4) 0.5rem var(--sp-2)",
                        fontSize: "var(--fs-2xs)",
                      }}
                    >
                      {run.group}
                    </div>
                    {renderRun(run)}
                  </div>
                ),
              )
            : renderRun({ from: 0, to: options.length - 1 })}
        </AnchoredPopover>
      )}
    </>
  );
}
