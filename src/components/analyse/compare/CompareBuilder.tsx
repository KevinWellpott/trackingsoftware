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

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DatePicker } from "@/components/ui/DatePicker";
import { Segmented } from "@/components/ui/Segmented";
import { Select, type SelectOption } from "@/components/ui/Select";
import type { Granularity, RangeKey } from "@/lib/analyse";
import { METRICS } from "@/lib/compare/metrics";
import {
  DIMENSION_KEYS, DIMENSION_LABEL, type CompareOption, type DimensionKey,
} from "@/lib/compare/model";
import { MAX_SERIES, serializeSeries, type SeriesSpec } from "@/lib/compare/series";

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

const METRIC_OPTIONS: SelectOption[] = METRICS.map((m) => ({
  value: m.key,
  label: m.label,
  hint: m.hint ? `${m.group} · ${m.hint}` : m.group,
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
              {activeDims.map((dim) => (
                <Select
                  key={dim}
                  value={spec.filters[dim] ?? ""}
                  onChange={(v) => setFilter(i, dim, v)}
                  options={[
                    { value: "", label: `${DIMENSION_LABEL[dim]}: alle` },
                    ...options[dim].map((o) => ({ value: o.value, label: o.label, hint: o.hint })),
                  ]}
                  ariaLabel={`${DIMENSION_LABEL[dim]} der Serie ${i + 1}`}
                  id={`dim-${i}-${dim}`}
                  triggerStyle={{ ...SELECT_TRIGGER, width: 160 }}
                  width={240}
                />
              ))}
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
                  }}
                >
                  <X size={12} aria-hidden />
                </button>
              )}
            </div>
          ))}

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
