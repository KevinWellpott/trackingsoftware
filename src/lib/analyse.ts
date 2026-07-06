// Reines Analyse-Fundament: Param-Parsing, Zahlen-/Prozent-Helfer, Bucket-Logik
// und Datums-Auflösung für den Deep-Analytics-Bereich. Kein "use client"/
// "use server" — überall (Server-Page & Client-Charts) importierbar.

import { addDaysISO, getISOWeek, weekStart } from "@/lib/dates";

export type AnalyseTab = "linkedin" | "telefon" | "setting" | "closing" | "funnel";
export type RangeKey = "w" | "m" | "30" | "q" | "j" | "custom";
export type QuelleKey = "alle" | "linkedin" | "telefon";

const TABS: readonly AnalyseTab[] = ["linkedin", "telefon", "setting", "closing", "funnel"];
const QUELLEN: readonly QuelleKey[] = ["alle", "linkedin", "telefon"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 730;

export type AnalyseParams = {
  tab: AnalyseTab;
  rangeKey: RangeKey;
  from: string;
  to: string;
  userIds: string[];
  quelle: QuelleKey;
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

  return { tab, rangeKey, from, to, userIds, quelle };
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

type Granularity = "day" | "week" | "month";

function granularityOf(from: string, to: string): Granularity {
  const span = spanDays(from, to);
  if (span <= 35) return "day";
  if (span <= 200) return "week";
  return "month";
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

function bucketFor(day: string, g: Granularity): { key: string; label: string } {
  if (g === "day") return dayKey(day);
  if (g === "week") return weekKey(day);
  return monthKey(day);
}

/**
 * Vollständige, lückenlose Bucket-Liste für [from, to] — damit Charts fehlende
 * Perioden mit 0 vorbefüllen. Granularität: ≤35 Tage täglich, ≤200 Tage
 * ISO-Wochen, sonst Monate.
 */
export function buildBuckets(from: string, to: string): { key: string; label: string }[] {
  if (from > to) return [];
  const g = granularityOf(from, to);
  const out: { key: string; label: string }[] = [];
  const seen = new Set<string>();
  let cursor = from;
  // Sicherheits-Obergrenze gegen Endlosschleifen bei kaputten Eingaben.
  for (let i = 0; i <= MAX_SPAN_DAYS && cursor <= to; i++) {
    const b = bucketFor(cursor, g);
    if (!seen.has(b.key)) {
      seen.add(b.key);
      out.push(b);
    }
    cursor = addDaysISO(cursor, 1);
  }
  return out;
}

/** Bildet einen Tag im Bereich [from, to] auf seinen Bucket-Key ab. */
export function bucketOf(day: string, from: string, to: string): string {
  return bucketFor(day, granularityOf(from, to)).key;
}

// Bewusste UTC-Kante: `slice(0,10)` schneidet den Datumsanteil eines ISO-
// Timestamps roh ab (UTC), ohne lokale Zeitzonen-Verschiebung. Konsistent mit
// den Postgres-`date`-Spalten, die ebenfalls in UTC gespeichert werden.
export function settingEffDate(
  r: { appointment_at?: string | null; call_at?: string | null; created_at: string },
): string {
  return (
    r.appointment_at?.slice(0, 10) ||
    r.call_at?.slice(0, 10) ||
    r.created_at.slice(0, 10)
  );
}

/** Analog zu settingEffDate: call_at, sonst created_at (UTC-slice, siehe oben). */
export function closingEffDate(
  r: { call_at?: string | null; created_at: string },
): string {
  return r.call_at?.slice(0, 10) || r.created_at.slice(0, 10);
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
