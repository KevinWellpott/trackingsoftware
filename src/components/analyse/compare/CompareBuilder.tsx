"use client";

// Serien-Baukasten: Zeitraum, Granularität und je Serie „Kennzahl + Filter".
//
// Der gesamte Zustand steht in der URL — jede Auswertung ist damit ein Link,
// den man weitergeben kann. Das ist kein Komfort-Detail: Ein Vergleich, den
// man nicht teilen kann, wird per Screenshot geteilt, und dann diskutiert das
// Team über eine Zahl, deren Filter niemand mehr kennt.
//
// Bewusst NICHT die AnalyseFilterBar: die trägt die acht Flow-Tabs und den
// globalen Nutzerfilter. Hier ist die Person eine Serien-Eigenschaft (genau
// darum geht es), ein globaler Personenfilter wäre ein Widerspruch.
//
// Eine Serienzeile trägt zwei feste Bedienelemente — Kennzahl und „+ Filter" —
// plus einen Chip je GESETZTEM Filter (SeriesFilters.tsx). Vorher standen dort
// fünf Dimensions-Dropdowns, die meist alle „…: alle" zeigten: sechs Elemente
// je Serie, von denen fünf nichts taten, und eine sticky Leiste, die bei sechs
// Serien höher wurde als das Diagramm darunter.

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DatePicker } from "@/components/ui/DatePicker";
import { Segmented } from "@/components/ui/Segmented";
import { Select, type SelectOption } from "@/components/ui/Select";
import type { Granularity, RangeKey } from "@/lib/analyse";
import { METRICS, metricOf } from "@/lib/compare/metrics";
import { DIMENSION_KEYS, type CompareOption, type DimensionKey } from "@/lib/compare/model";
import { MAX_SERIES, serializeSeries, type SeriesSpec } from "@/lib/compare/series";
import { SeriesFilters } from "@/components/analyse/compare/SeriesFilters";

// Dieselben Optionen wie in der Analyse-Filterleiste. Bewusst kopiert statt
// importiert: die Leiste ist eine "use client"-Komponente mit eigener
// Tab-Logik, ein Import zöge sie samt Tabs in diese Seite.
const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: "w", label: "Diese Woche" },
  { value: "m", label: "Dieser Monat" },
  { value: "30", label: "30 Tage" },
  { value: "q", label: "Quartal" },
  { value: "j", label: "Jahr" },
  { value: "custom", label: "Eigener" },
];

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "tag", label: "Tag" },
  { value: "woche", label: "Woche" },
  { value: "monat", label: "Monat" },
];

const DATE_INPUT_STYLE = {
  height: "var(--h-control)",
  padding: "0 var(--sp-5)",
  fontSize: "var(--fs-sm)",
  fontFamily: "inherit",
  fontVariantNumeric: "tabular-nums",
  color: "var(--text-primary)",
  background: "var(--surface-1)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--r-md)",
} as const;

const SELECT_TRIGGER = { minHeight: 28, fontSize: "var(--fs-sm)", padding: "0 var(--sp-4)" } as const;

/** YYYY-MM-DD → DD.MM.YYYY (zeitzonensicher, ohne Date-Parsing). */
function deDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="eyebrow eyebrow-muted" style={{ whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

// Die Registry-Gruppe wird zum Gruppenkopf im Dropdown, nicht mehr zur grauen
// Hinweiszeile unter jedem Eintrag. Bei 29 Kennzahlen ist das der Unterschied
// zwischen Auswahl und Suchaufgabe — und es trennt die drei gleichnamigen
// „Termine…"-Kennzahlen sichtbar nach ihrer Quelle. Die Hinweiszeile bleibt
// dem vorbehalten, was sie erklären soll: der Methodik einzelner Kennzahlen.
const METRIC_OPTIONS: SelectOption[] = METRICS.map((m) => ({
  value: m.key,
  label: m.label,
  group: m.group,
  hint: m.hint,
}));

export function CompareBuilder({
  specs,
  colors,
  options,
  rangeKey,
  from,
  to,
  granularity,
}: {
  specs: SeriesSpec[];
  /** Serienfarben aus viz.ts — identisch zu Chart und Tabelle. */
  colors: string[];
  options: Record<DimensionKey, CompareOption[]>;
  rangeKey: RangeKey;
  from: string;
  to: string;
  granularity: Granularity;
}) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function commit(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(sp.toString());
    mutate(params);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  /** Schreibt die komplette Serienliste neu — `s` ist ein Mehrfach-Parameter. */
  function commitSeries(next: SeriesSpec[]) {
    commit((p) => {
      p.delete("s");
      for (const s of next) p.append("s", serializeSeries(s));
    });
  }

  function setMetric(index: number, metric: string) {
    commitSeries(specs.map((s, i) => (i === index ? { ...s, metric } : s)));
  }

  function setFilter(index: number, dim: DimensionKey, value: string) {
    commitSeries(
      specs.map((s, i) => {
        if (i !== index) return s;
        const filters = { ...s.filters };
        if (value) filters[dim] = value;
        else delete filters[dim];
        return { ...s, filters };
      }),
    );
  }

  function removeSeries(index: number) {
    commitSeries(specs.filter((_, i) => i !== index));
  }

  /**
   * Neue Serie = Kopie der letzten. Der übliche Handgriff ist „dasselbe, aber
   * für Kevin" — eine leere Zeile zwänge dazu, die Kennzahl jedes Mal neu zu
   * suchen.
   */
  function addSeries() {
    const last = specs[specs.length - 1];
    const next: SeriesSpec = last
      ? { metric: last.metric, filters: { ...last.filters } }
      : { metric: METRICS[0].key, filters: {} };
    commitSeries([...specs, next]);
  }

  function selectRange(next: RangeKey) {
    commit((p) => {
      p.set("range", next);
      if (next !== "custom") {
        p.delete("von");
        p.delete("bis");
      }
    });
  }

  function commitCustom(v: string, b: string) {
    if (!v || !b) return;
    commit((p) => {
      p.set("range", "custom");
      p.set("von", v);
      p.set("bis", b);
    });
  }

  function selectGranularity(next: Granularity) {
    commit((p) => {
      if (next === "auto") p.delete("g");
      else p.set("g", next);
    });
  }

  // Eine Dimension ohne Ausprägungen bekommt kein Dropdown: ein Filter, der
  // nur „Alle" anbietet, sieht aus wie ein Defekt. Vor Migration 0029 trifft
  // das z. B. den Skript-Testarm.
  const activeDims = DIMENSION_KEYS.filter((d) => options[d].length > 0);

  return (
    <div
      className="glass-nav"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 30,
        margin: "0 calc(var(--sp-9) * -1)",
        padding: "var(--sp-4) var(--sp-9) var(--sp-5)",
      }}
    >
      {isPending && <span className="route-progress" aria-hidden />}
      <div
        aria-busy={isPending}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-5)",
          opacity: isPending ? 0.6 : 1,
          transition: "opacity var(--transition-fast)",
        }}
      >
        {/* ── Zeitraum + Granularität ──────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4) var(--sp-8)", flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap" }}>
            <GroupLabel>Zeitraum</GroupLabel>
            <Segmented<RangeKey> options={RANGE_OPTIONS} value={rangeKey} onChange={selectRange} size="sm" ariaLabel="Zeitraum" />
            {rangeKey === "custom" && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
                <DatePicker
                  variant="input"
                  value={from}
                  onChange={(v) => commitCustom(v ?? "", to)}
                  placeholder="Von"
                  shortFormat
                  triggerStyle={DATE_INPUT_STYLE}
                />
                <span style={{ color: "var(--text-muted)" }}>–</span>
                <DatePicker
                  variant="input"
                  value={to}
                  onChange={(v) => commitCustom(from, v ?? "")}
                  placeholder="Bis"
                  shortFormat
                  triggerStyle={DATE_INPUT_STYLE}
                />
              </div>
            )}
            <span
              style={{
                fontSize: "var(--fs-xs)",
                color: "var(--text-muted)",
                whiteSpace: "nowrap",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {deDate(from)} → {deDate(to)}
            </span>
          </div>

          <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" }}>
            <GroupLabel>Granularität</GroupLabel>
            <Segmented<Granularity>
              options={GRANULARITY_OPTIONS}
              value={granularity}
              onChange={selectGranularity}
              size="sm"
              ariaLabel="Granularität"
            />
          </div>
        </div>

        {/* ── Serien ───────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          {/* Deckel gegen die wachsende Leiste: Sechs Serien belegten hier mehr
              Hoehe als das Diagramm darunter — man scrollte an der Auswertung
              vorbei, um sie zu bedienen. Die Chips halten die Zeilen flach; ab
              der Grenze scrollt die Serienliste in sich, statt die Seite zu
              verdraengen. „+ Serie" steht bewusst AUSSERHALB des Scrollfensters
              und bleibt damit immer erreichbar; die Popover haengen im Portal
              und werden vom overflow nicht beschnitten. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--sp-4)",
              maxHeight: "min(40vh, 300px)",
              overflowY: "auto",
            }}
          >
            {specs.map((spec, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-4)",
                  flexWrap: "wrap",
                  paddingTop: i > 0 ? "var(--sp-4)" : 0,
                  borderTop: i > 0 ? "1px solid var(--border-subtle)" : undefined,
                }}
              >
                {/* Farbpunkt = Identität der Serie in Chart, Legende und Tabelle. */}
                <span
                  aria-hidden
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: colors[i],
                    flexShrink: 0,
                  }}
                />
                <Select
                  value={spec.metric}
                  onChange={(v) => setMetric(i, v)}
                  options={METRIC_OPTIONS}
                  ariaLabel={`Kennzahl der Serie ${i + 1}`}
                  id={`metric-${i}`}
                  triggerStyle={{ ...SELECT_TRIGGER, width: 190 }}
                  width={280}
                />
                {/* Kennzahl + „+ Filter" sind die zwei festen Bedienelemente der
                    Zeile; alles Weitere erscheint nur, wenn es auch filtert. */}
                <SeriesFilters
                  index={i}
                  metric={metricOf(spec.metric) ?? METRICS[0]}
                  filters={spec.filters}
                  dims={activeDims}
                  options={options}
                  onChange={(dim, value) => setFilter(i, dim, value)}
                />
                {/* Die letzte Serie bleibt stehen: ein Chart ohne Serie wäre ein
                    Zustand, aus dem nur der Reload wieder herausführt. */}
                {specs.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSeries(i)}
                    aria-label={`Serie ${i + 1} entfernen`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 28,
                      height: 28,
                      borderRadius: "var(--r-full)",
                      background: "transparent",
                      color: "var(--text-muted)",
                      border: "1px solid var(--border-default)",
                      cursor: "pointer",
                      flexShrink: 0,
                      // Ans Zeilenende: zwischen Chips wechselnder Breite waere
                      // der Loeschknopf sonst jedes Mal woanders.
                      marginLeft: "auto",
                    }}
                  >
                    <X size={12} aria-hidden />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)" }}>
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus size={13} />}
              onClick={addSeries}
              disabled={specs.length >= MAX_SERIES}
            >
              Serie
            </Button>
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>
              {specs.length >= MAX_SERIES
                ? `Maximal ${MAX_SERIES} Serien — darüber sind die Farben nicht mehr unterscheidbar.`
                : `${specs.length} von ${MAX_SERIES} Serien`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
