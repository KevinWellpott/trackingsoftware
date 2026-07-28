// Reines Analyse-Fundament: Param-Parsing, Zahlen-/Prozent-Helfer, Bucket-Logik
// und Datums-Auflösung für den Deep-Analytics-Bereich. Kein "use client"/
// "use server" — überall (Server-Page & Client-Charts) importierbar.

import { berlinDateISO } from "@/lib/apptTime";
import { addDaysISO, getISOWeek, weekStart } from "@/lib/dates";

export type AnalyseTab = "linkedin" | "telefon" | "setting" | "closing" | "funnel";
export type RangeKey = "w" | "m" | "30" | "q" | "j" | "custom";
export type QuelleKey = "alle" | "linkedin" | "telefon" | "manuell";
/** Nutzer-wählbare Bucket-Granularität; "auto" = bisherige Spannen-Heuristik. */
export type Granularity = "auto" | "tag" | "woche" | "monat";

const TABS: readonly AnalyseTab[] = ["linkedin", "telefon", "setting", "closing", "funnel"];
const QUELLEN: readonly QuelleKey[] = ["alle", "linkedin", "telefon", "manuell"];
const GRANULARITIES: readonly Granularity[] = ["auto", "tag", "woche", "monat"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 730;

export type AnalyseParams = {
  tab: AnalyseTab;
  rangeKey: RangeKey;
  from: string;
  to: string;
  userIds: string[];
  quelle: QuelleKey;
  g: Granularity;
};

/** Erster Tag des Monats, in dem `today` (YYYY-MM-DD) liegt. */
function monthStart(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

/** Erster Tag des Quartals, in dem `today` liegt. */
function quarterStart(today: string): string {
  const [y, m] = today.split("-").map(Number);
  const qMonth = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(qMonth).padStart(2, "0")}-01`;
}

/** Erster Tag des Jahres, in dem `today` liegt. */
function yearStart(today: string): string {
  return `${today.slice(0, 4)}-01-01`;
}

/** Löst einen Preset-RangeKey (nicht "custom") zu einem [from, to]-Fenster auf. */
function presetRange(rangeKey: Exclude<RangeKey, "custom">, today: string): { from: string; to: string } {
  switch (rangeKey) {
    case "w":
      return { from: weekStart(today), to: today };
    case "30":
      return { from: addDaysISO(today, -29), to: today };
    case "q":
      return { from: quarterStart(today), to: today };
    case "j":
      return { from: yearStart(today), to: today };
    case "m":
    default:
      return { from: monthStart(today), to: today };
  }
}

/** Inklusive Anzahl Tage zwischen zwei ISO-Daten (from ≤ to). */
function spanDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const a = new Date(fy, fm - 1, fd);
  const b = new Date(ty, tm - 1, td);
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

/**
 * Parst die URL-Suchparameter des Analyse-Bereichs robust. Wirft NIE — jeder
 * ungültige Wert fällt auf einen sinnvollen Default zurück.
 */
export function parseAnalyseParams(
  sp: Record<string, string | undefined>,
  today: string,
): AnalyseParams {
  const tab: AnalyseTab = TABS.includes(sp.tab as AnalyseTab) ? (sp.tab as AnalyseTab) : "linkedin";

  const rawRange = sp.range as RangeKey | undefined;
  const validRange =
    rawRange === "w" || rawRange === "m" || rawRange === "30" ||
    rawRange === "q" || rawRange === "j" || rawRange === "custom";
  let rangeKey: RangeKey = validRange ? (rawRange as RangeKey) : "m";

  let from: string;
  let to: string;

  if (rangeKey === "custom") {
    let von = sp.von;
    let bis = sp.bis;
    if (von && bis && ISO_DATE.test(von) && ISO_DATE.test(bis)) {
      // Vertauschte Grenzen tolerieren.
      if (von > bis) [von, bis] = [bis, von];
      // Spanne auf MAX_SPAN_DAYS begrenzen — `from` nach oben ziehen.
      if (spanDays(von, bis) > MAX_SPAN_DAYS) {
        von = addDaysISO(bis, -(MAX_SPAN_DAYS - 1));
      }
      from = von;
      to = bis;
    } else {
      // Ungültige Custom-Eingabe → auf Preset "m" zurückfallen.
      rangeKey = "m";
      ({ from, to } = presetRange("m", today));
    }
  } else {
    ({ from, to } = presetRange(rangeKey, today));
  }

  const userIds = (sp.users ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const quelle: QuelleKey = QUELLEN.includes(sp.quelle as QuelleKey) ? (sp.quelle as QuelleKey) : "alle";

  const g: Granularity = GRANULARITIES.includes(sp.g as Granularity) ? (sp.g as Granularity) : "auto";

  return { tab, rangeKey, from, to, userIds, quelle, g };
}

/**
 * Vorperioden-Fenster gleicher Länge, das am Tag vor `from` endet — Basis für
 * Delta-Badges ("vs. Vorperiode") in den KPI-Kacheln.
 */
export function prevRange(from: string, to: string): { from: string; to: string } {
  const span = spanDays(from, to);
  const prevTo = addDaysISO(from, -1);
  return { from: addDaysISO(prevTo, -(span - 1)), to: prevTo };
}

/** Number(v) mit 0 als NaN-/Falsy-Fallback. */
export function NUM(v: unknown): number {
  return Number(v) || 0;
}

/** Prozentwert n/d*100 auf 1 Nachkommastelle; d===0 → null (kein Teilen durch 0). */
export function pct(n: number, d: number): number | null {
  if (d === 0) return null;
  return Math.round((n / d) * 1000) / 10;
}

const PCT_FMT = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Formatiert einen Prozentwert de-DE mit 1 Nachkommastelle + " %"; null → "—". */
export function fmtPct(v: number | null): string {
  if (v === null) return "—";
  return `${PCT_FMT.format(v)} %`;
}

/** Normalisiert einen Owner-Namen für case-insensitiven Abgleich. */
export function ownerKey(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

type BucketUnit = "day" | "week" | "month";

function heuristicUnit(from: string, to: string): BucketUnit {
  const span = spanDays(from, to);
  if (span <= 35) return "day";
  if (span <= 200) return "week";
  return "month";
}

/** Löst eine (optionale) Nutzer-Granularität zur konkreten Bucket-Einheit auf. */
function unitOf(from: string, to: string, g?: Granularity): BucketUnit {
  if (g === "tag") return "day";
  if (g === "woche") return "week";
  if (g === "monat") return "month";
  return heuristicUnit(from, to);
}

const MONTH_LABEL = new Intl.DateTimeFormat("de-DE", { month: "short", year: "2-digit" });

/** ISO-Woche → Wochen-Jahr (Jahr des Montags dieser Woche). */
function weekKey(day: string): { key: string; label: string } {
  const anchor = weekStart(day);
  const year = anchor.slice(0, 4);
  const week = getISOWeek(day);
  return { key: `${year}-KW${week}`, label: `KW ${week}` };
}

function monthKey(day: string): { key: string; label: string } {
  const key = day.slice(0, 7); // YYYY-MM
  const [y, m] = key.split("-").map(Number);
  return { key, label: MONTH_LABEL.format(new Date(y, m - 1, 1)) };
}

function dayKey(day: string): { key: string; label: string } {
  const [, m, d] = day.split("-").map(Number);
  return { key: day, label: `${d}.${m}.` };
}

function bucketFor(day: string, unit: BucketUnit): { key: string; label: string } {
  if (unit === "day") return dayKey(day);
  if (unit === "week") return weekKey(day);
  return monthKey(day);
}

/**
 * Vollständige, lückenlose Bucket-Liste für [from, to] — damit Charts fehlende
 * Perioden mit 0 vorbefüllen. Ohne `g` (bzw. mit "auto") greift die Heuristik:
 * ≤35 Tage täglich, ≤200 Tage ISO-Wochen, sonst Monate; "tag"/"woche"/"monat"
 * erzwingen die jeweilige Einheit.
 */
export function buildBuckets(from: string, to: string, g?: Granularity): { key: string; label: string }[] {
  if (from > to) return [];
  const unit = unitOf(from, to, g);
  const out: { key: string; label: string }[] = [];
  const seen = new Set<string>();
  let cursor = from;
  // Sicherheits-Obergrenze gegen Endlosschleifen bei kaputten Eingaben.
  for (let i = 0; i <= MAX_SPAN_DAYS && cursor <= to; i++) {
    const b = bucketFor(cursor, unit);
    if (!seen.has(b.key)) {
      seen.add(b.key);
      out.push(b);
    }
    cursor = addDaysISO(cursor, 1);
  }
  return out;
}

/** Bildet einen Tag im Bereich [from, to] auf seinen Bucket-Key ab (g wie buildBuckets). */
export function bucketOf(day: string, from: string, to: string, g?: Granularity): string {
  return bucketFor(day, unitOf(from, to, g)).key;
}

// Timestamps werden über ihren Berlin-Kalendertag gebucketet, nicht über den
// rohen UTC-Datumsanteil — sonst rutschen Termine am Tagesrand (z. B. 00:30
// Berlin = 22:30 UTC am Vortag) in den Nachbar-Bucket.
// `setting_calls.call_at` ist dagegen eine echte `date`-Spalte ohne Uhrzeit
// und wird direkt übernommen.
export function settingEffDate(
  r: { appointment_at?: string | null; call_at?: string | null; created_at: string },
): string {
  return (
    berlinDateISO(r.appointment_at) ||
    r.call_at?.slice(0, 10) ||
    berlinDateISO(r.created_at)
  );
}

/** Analog zu settingEffDate — `closing_calls.call_at` ist ein timestamptz. */
export function closingEffDate(
  r: { call_at?: string | null; created_at: string },
): string {
  return berlinDateISO(r.call_at) || berlinDateISO(r.created_at);
}

const EUR_FMT = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

/** Euro-Betrag de-DE, ohne Nachkommastellen. */
export function eur(n: number): string {
  return EUR_FMT.format(n);
}
