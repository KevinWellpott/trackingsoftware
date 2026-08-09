// Serien: URL-Format, Aggregation, Formatierung.
//
// Eine Serie ist genau zwei Dinge: eine Kennzahl aus der Registry und ein
// Bündel Dimensionsfilter. „Telefon × LinkedIn" und „Samuel × Kevin" sind
// derselbe Mechanismus — nur eine andere Filterachse. Deshalb gibt es hier
// keinen Sonderfall je Vergleichsart.
//
// Reines Fundament (kein Server-Import): Die Client-Bausteine parsen und
// serialisieren damit die URL, die Server-Seite aggregiert damit die Fakten.

import { bucketOf, eur, fmtPct, type Granularity } from "@/lib/analyse";
import { vizSlot } from "@/lib/viz";
import { metricOf, type CompareMetric, type MetricFormat } from "@/lib/compare/metrics";
import { DIMENSION_KEYS, type CompareFact, type DimensionKey } from "@/lib/compare/model";

/**
 * Mehr als sechs Linien sind nicht mehr lesbar — und die kategoriale Palette
 * hat genau sechs validierte Slots (src/lib/viz.ts). Ab der siebten Serie
 * wiederholte sich die Farbe, und zwei verschiedene Kennzahlen sähen gleich
 * aus. Deshalb eine harte Obergrenze statt einer wackeligen.
 */
export const MAX_SERIES = 6;

export type SeriesSpec = {
  /** Registry-Schlüssel (metrics.ts). */
  metric: string;
  /** Dimension → Wert. Fehlende Dimension = keine Einschränkung. */
  filters: Partial<Record<DimensionKey, string>>;
};

// ── URL-Format ───────────────────────────────────────────────
// Eine Serie = ein `s`-Parameter:  s=termine;kanal=linkedin;person=<uuid>
// Erstes Segment ist die Kennzahl, danach `dimension=wert`. Werte werden
// zusätzlich prozentcodiert, damit Listennamen mit ';' oder '=' die Struktur
// nicht sprengen (URLSearchParams codiert nur die äußere Ebene).

const SEP = ";";

export function serializeSeries(spec: SeriesSpec): string {
  const parts = [spec.metric];
  for (const dim of DIMENSION_KEYS) {
    const v = spec.filters[dim];
    if (v) parts.push(`${dim}=${encodeURIComponent(v)}`);
  }
  return parts.join(SEP);
}

/** Parst einen `s`-Parameter; unbekannte Kennzahl → `null` (Serie entfällt). */
export function parseSeries(raw: string): SeriesSpec | null {
  const [metricKey, ...rest] = raw.split(SEP);
  if (!metricOf(metricKey)) return null;
  const filters: Partial<Record<DimensionKey, string>> = {};
  for (const part of rest) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const dim = part.slice(0, idx) as DimensionKey;
    if (!DIMENSION_KEYS.includes(dim)) continue;
    const value = safeDecode(part.slice(idx + 1));
    if (value) filters[dim] = value;
  }
  return { metric: metricKey, filters };
}

/** `decodeURIComponent`, das bei kaputten Prozent-Sequenzen nicht wirft. */
function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/**
 * Startbelegung ohne `s`-Parameter: der Vergleich, nach dem ausdrücklich
 * gefragt wurde („Telefon x LinkedIn"). Eine einzelne Linie wäre ein
 * Vergleichs-Werkzeug, das nichts vergleicht — und niemand sähe, dass man
 * Serien nebeneinanderlegen kann.
 */
export const DEFAULT_SERIES: SeriesSpec[] = [
  { metric: "termine", filters: { kanal: "linkedin" } },
  { metric: "termine", filters: { kanal: "telefon" } },
];

/** Liest alle `s`-Parameter; leer/ungültig → DEFAULT_SERIES. */
export function parseSeriesList(raw: string[]): SeriesSpec[] {
  const specs = raw
    .map((r) => parseSeries(r))
    .filter((s): s is SeriesSpec => s !== null)
    .slice(0, MAX_SERIES);
  return specs.length > 0 ? specs : DEFAULT_SERIES;
}

// ── Aggregation ──────────────────────────────────────────────

export type SeriesResult = {
  spec: SeriesSpec;
  metric: CompareMetric;
  /** „Termine (Setting) · LinkedIn · Kevin" — Legende, Tabelle, Tooltip. */
  label: string;
  /** Nur die Filter, ohne Kennzahl (Unterzeile in der Tabelle). */
  filterLabel: string;
  color: string;
  /** Ein Wert je Bucket; `null` = kein Nenner in dieser Periode. */
  points: (number | null)[];
  /** Über den ganzen Zeitraum: Summe (Menge) bzw. gewichtete Quote. */
  total: number | null;
  /** Ø je Bucket — nur für Mengen; bei Quoten `null` (siehe Kommentar). */
  avg: number | null;
};

/** Auflösung eines Dimensionswerts auf seinen Anzeigetext. */
export type DimLabeler = (dim: DimensionKey, value: string) => string;

function passesFilters(fact: CompareFact, filters: SeriesSpec["filters"]): boolean {
  for (const dim of DIMENSION_KEYS) {
    const want = filters[dim];
    if (want && fact.dims[dim] !== want) return false;
  }
  return true;
}

/**
 * Verhältnis zweier Summen im Format der Kennzahl.
 * Nenner 0 → `null`, nicht 0: „keine Basis" ist keine Null. Eine 0 im Chart
 * wäre eine Behauptung, eine Lücke ist die Wahrheit.
 */
function ratio(num: number, den: number, format: MetricFormat): number | null {
  if (den === 0) return null;
  if (format === "pct") return Math.round((num / den) * 1000) / 10;
  if (format === "eur") return Math.round(num / den);
  return Math.round((num / den) * 10) / 10;
}

/**
 * Rechnet alle Serien in einem Durchgang über die Fakten.
 *
 * Ein Durchlauf, innen die Serien: bei sechs Serien und zehntausenden Fakten
 * ist das der Unterschied zwischen einmal und sechsmal durch den Speicher.
 */
export function aggregate(
  facts: CompareFact[],
  specs: SeriesSpec[],
  buckets: { key: string; label: string }[],
  from: string,
  to: string,
  g: Granularity,
  labelOf: DimLabeler,
): SeriesResult[] {
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  const metrics = specs.map((s) => metricOf(s.metric)!);
  const num = specs.map(() => new Float64Array(buckets.length));
  const den = specs.map(() => new Float64Array(buckets.length));

  for (const f of facts) {
    if (f.day < from || f.day > to) continue;
    const bi = index.get(bucketOf(f.day, from, to, g));
    if (bi === undefined) continue;
    for (let i = 0; i < specs.length; i++) {
      if (!passesFilters(f, specs[i].filters)) continue;
      const m = metrics[i];
      num[i][bi] += f.m[m.num] ?? 0;
      if (m.den) den[i][bi] += f.m[m.den] ?? 0;
    }
  }

  return specs.map((spec, i) => {
    const m = metrics[i];
    const points: (number | null)[] = [];
    let numSum = 0;
    let denSum = 0;
    for (let b = 0; b < buckets.length; b++) {
      numSum += num[i][b];
      denSum += den[i][b];
      points.push(m.den ? ratio(num[i][b], den[i][b], m.format) : num[i][b]);
    }

    // Gesamt einer Quote ist die GEWICHTETE Quote (Summe ÷ Summe), nicht der
    // Mittelwert der Perioden-Quoten — sonst zählte ein Tag mit einem Termin
    // so viel wie einer mit vierzig.
    const total = m.den ? ratio(numSum, denSum, m.format) : numSum;
    // Ø je Bucket gibt es nur für Mengen. Bei Quoten wäre er entweder
    // dasselbe wie „Gesamt" oder der ungewichtete Mittelwert von oben.
    const avg = m.den || buckets.length === 0 ? null : Math.round((numSum / buckets.length) * 10) / 10;

    const filterLabel = DIMENSION_KEYS.filter((d) => spec.filters[d])
      .map((d) => labelOf(d, spec.filters[d]!))
      .join(" · ");

    return {
      spec,
      metric: m,
      label: filterLabel ? `${m.label} · ${filterLabel}` : m.label,
      filterLabel,
      color: vizSlot(i),
      points,
      total,
      avg,
    };
  });
}

// ── Formatierung ─────────────────────────────────────────────

const INT_FMT = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** Ein Serienwert im Format seiner Kennzahl; `null` → „—". */
export function formatValue(v: number | null, format: MetricFormat): string {
  if (v === null) return "—";
  if (format === "pct") return fmtPct(v);
  if (format === "eur") return eur(v);
  return INT_FMT.format(v);
}

/**
 * Abstand zur Referenzserie — die Spalte, an der „was läuft besser" abgelesen
 * wird. Quoten in Prozentpunkten, Mengen/Beträge absolut plus relativ.
 * Unterschiedliche Formate ergeben keine Differenz: „+120 Termine" gegen
 * „30.000 €" ist keine Aussage, sondern eine Rechenpanne.
 */
export function formatDelta(
  value: number | null,
  base: number | null,
  format: MetricFormat,
  baseFormat: MetricFormat,
): string {
  if (format !== baseFormat) return "—";
  if (value === null || base === null) return "—";
  const d = value - base;
  const sign = d > 0 ? "+" : d < 0 ? "−" : "±";
  const abs = Math.abs(d);
  if (format === "pct") return `${sign}${INT_FMT.format(Math.round(abs * 10) / 10)} pp`;
  const absText = format === "eur" ? eur(abs) : INT_FMT.format(abs);
  if (base === 0) return `${sign}${absText}`;
  const relative = Math.round((Math.abs(d) / Math.abs(base)) * 1000) / 10;
  return `${sign}${absText} (${sign}${INT_FMT.format(relative)} %)`;
}
