"use client";

// Die Filter EINER Serie: gesetzte Filter als entfernbare Chips, alles andere
// hinter „+ Filter".
//
// Vorher stand je Serie ein Dropdown FÜR JEDE Dimension in der Zeile — fünf
// gleich aussehende Felder mit „…: alle". Bei zwei Serien waren das zehn
// Bedienelemente, die nichts filtern, und die sticky Leiste wuchs mit jeder
// Serie um eine volle Feldzeile. Sichtbar ist jetzt nur, was auch wirkt: die
// Regel aus COMPONENTS.md §12 („aktive Filter immer sichtbar als Chips,
// + Filter öffnet die Feldauswahl").
//
// Beide Bausteine sind bewusst `Select` und kein eigenes Popover: Damit erbt
// die Chip-Bedienung die vorhandene Tastatursteuerung (Pfeiltasten, Enter,
// Escape, aria-activedescendant) statt sie ein zweites Mal — und schlechter —
// nachzubauen. Die Zweistufigkeit („welche Dimension?" → „welcher Wert?")
// entfällt dabei komplett: Die Auswahlliste zeigt alle noch freien Dimensionen
// in EINER Liste, gegliedert durch die Gruppenköpfe des Select.

import { AlertTriangle, X } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { Select, type SelectOption } from "@/components/ui/Select";
import { filterConflict, seriesConflicts, type CompareMetric } from "@/lib/compare/metrics";
import {
  DIMENSION_KEYS, DIMENSION_LABEL, type CompareOption, type DimensionKey,
} from "@/lib/compare/model";

/** Pill-Optik für Chip und „+ Filter". */
const CHIP_TRIGGER = {
  // .field-trigger bringt Fokusring, Hover und den Rahmen bei offener Liste
  // mit; hier werden nur die Maße auf Chip-Größe gezogen. `width: auto` muss
  // sein — die Klasse setzt width: 100 % für Formularfelder.
  width: "auto",
  minHeight: 26,
  maxWidth: 240,
  padding: "0 var(--sp-3) 0 var(--sp-4)",
  borderRadius: "var(--r-full)",
  fontSize: "var(--fs-xs)",
  gap: "var(--sp-2)",
} as const;

const POPOVER_WIDTH = 260;

export function SeriesFilters({
  index,
  metric,
  filters,
  dims,
  options,
  onChange,
}: {
  /** Serien-Index — nur für stabile Element-IDs und Vorlese-Namen. */
  index: number;
  metric: CompareMetric;
  filters: Partial<Record<DimensionKey, string>>;
  /** Dimensionen, die in den Daten überhaupt Ausprägungen haben. */
  dims: DimensionKey[];
  options: Record<DimensionKey, CompareOption[]>;
  /** Leerer Wert = Filter entfernen. */
  onChange: (dim: DimensionKey, value: string) => void;
}) {
  // Gesetzte Filter aus DIMENSION_KEYS, nicht aus `dims`: Ein Wert aus einem
  // alten Link muss auch dann als Chip erscheinen, wenn seine Dimension im
  // aktuellen Datenbestand leer ist — sonst filterte er unsichtbar weiter.
  const active = DIMENSION_KEYS.filter((d) => filters[d]);
  const free = dims.filter((d) => !filters[d]);
  const conflicts = seriesConflicts(metric, filters);

  /**
   * Werteliste eines gesetzten Chips. Der Dimensionsname steht mit im Label,
   * weil der Chip sonst nur „LinkedIn" hieße — und das kann Kanal, Liste oder
   * Zielgruppe meinen.
   */
  function chipOptions(dim: DimensionKey, current: string): SelectOption[] {
    const list: SelectOption[] = options[dim].map((o) => {
      const conflict = filterConflict(metric, dim, o.value);
      return {
        value: o.value,
        label: `${DIMENSION_LABEL[dim]}: ${o.label}`,
        hint: conflict ?? o.hint,
        // Der bereits gewählte Wert bleibt wählbar, auch wenn er kollidiert:
        // Ein Eintrag, der als einziger markiert und zugleich gesperrt ist,
        // liest sich wie ein Defekt. Die Warnzeile darunter sagt, was los ist.
        disabled: conflict !== null && o.value !== current,
      };
    });
    if (!list.some((o) => o.value === current)) {
      list.unshift({
        value: current,
        label: `${DIMENSION_LABEL[dim]}: ${current}`,
        hint: "kommt im Zeitraum nicht vor",
      });
    }
    return list;
  }

  /**
   * Alle noch freien Filter in EINER Liste, gruppiert nach Dimension.
   * Strukturell unmögliche Werte stehen sichtbar, aber gesperrt darin — mit
   * dem Grund als Hinweiszeile. Sie zu verstecken beantwortete die Frage
   * „warum kann ich Termine nicht nach Liste filtern?" nie.
   */
  const addOptions: SelectOption[] = free.flatMap((dim) =>
    options[dim].map((o) => {
      const conflict = filterConflict(metric, dim, o.value);
      return {
        value: `${dim}:${o.value}`,
        label: o.label,
        group: DIMENSION_LABEL[dim],
        hint: conflict ?? o.hint,
        disabled: conflict !== null,
      };
    }),
  );

  function addFilter(raw: string) {
    // Erstes „:" trennt — Listenwerte tragen selbst eines („tel:<uuid>").
    const cut = raw.indexOf(":");
    if (cut <= 0) return;
    onChange(raw.slice(0, cut) as DimensionKey, raw.slice(cut + 1));
  }

  return (
    <>
      {active.map((dim) => {
        const value = filters[dim]!;
        const conflict = filterConflict(metric, dim, value);
        return (
          <span key={dim} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
            <Select
              value={value}
              onChange={(v) => onChange(dim, v)}
              options={chipOptions(dim, value)}
              ariaLabel={`${DIMENSION_LABEL[dim]} der Serie ${index + 1}`}
              id={`f${index}-${dim}`}
              title={conflict ?? undefined}
              // Aktiver Filter-Chip nach COMPONENTS.md §12: Akzent-Füllung,
              // Akzent-Rahmen, Orange-Text. Im Konfliktfall stattdessen die
              // Warn-Palette — nie Orange für „stimmt hier nicht".
              triggerStyle={{
                ...CHIP_TRIGGER,
                background: conflict ? "var(--warning-bg)" : "var(--accent-muted)",
                borderColor: conflict ? "var(--warning)" : "var(--border-accent)",
                color: conflict ? "var(--warning-fg)" : "var(--orange-300)",
              }}
              width={POPOVER_WIDTH}
            />
            <IconButton
              label={`${DIMENSION_LABEL[dim]}-Filter der Serie ${index + 1} entfernen`}
              icon={<X size={11} aria-hidden />}
              size={20}
              onClick={() => onChange(dim, "")}
            />
          </span>
        );
      })}

      {addOptions.length > 0 && (
        <Select
          // Bleibt dauerhaft leer: Der Knopf wählt nichts aus, er FÜGT hinzu —
          // ausgewählt ist danach der Chip.
          value=""
          onChange={addFilter}
          options={addOptions}
          placeholder="+ Filter"
          ariaLabel={`Filter zur Serie ${index + 1} hinzufügen`}
          id={`add-${index}`}
          // Neutraler Chip (Fläche und Rahmen kommen aus .field-trigger) —
          // damit der Unterschied „wirkt" ⇄ „wirkt nicht" allein über die
          // Akzentfarbe läuft und nicht über zwei konkurrierende Formen.
          triggerStyle={{ ...CHIP_TRIGGER, color: "var(--text-secondary)" }}
          width={POPOVER_WIDTH}
        />
      )}

      {conflicts.length > 0 && (
        // width: 100 % bricht in der umgebenden Flex-Zeile bewusst um — die
        // Begründung gehört unter die Serie, nicht neben sie.
        <div
          style={{
            width: "100%",
            display: "flex",
            alignItems: "flex-start",
            gap: "var(--sp-3)",
            fontSize: "var(--fs-xs)",
            lineHeight: 1.45,
            color: "var(--warning-fg)",
          }}
        >
          <AlertTriangle size={12} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            {conflicts.map((c) => c.reason).join(" · ")}. Diese Serie bleibt in jedem Zeitraum leer.
          </span>
        </div>
      )}
    </>
  );
}
