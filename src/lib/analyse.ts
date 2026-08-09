// Reines Analyse-Fundament: Param-Parsing, Zahlen-/Prozent-Helfer, Bucket-Logik
// und Datums-Auflösung für den Deep-Analytics-Bereich. Kein "use client"/
// "use server" — überall (Server-Page & Client-Charts) importierbar.

import { berlinDateISO } from "@/lib/apptTime";
import { FILTERABLE_CHANNEL_KEYS, type FilterableChannelKey } from "@/lib/channels";
import { addDaysISO, getISOWeek, weekStart } from "@/lib/dates";
import { VIZ_NEUTRAL } from "@/lib/viz";

/**
 * Flow-Tabs des Analyse-Bereichs.
 *
 * „followup" und „listen" sind entfallen: Follow-up-Kaskade und Listen-Ranking
 * stehen jetzt im LinkedIn-Tab, wo sie hingehören (beides sind LinkedIn-
 * Kennzahlen). Ein `?tab=followup`/`?tab=listen` aus einem alten Lesezeichen
 * fällt über `parseAnalyseParams` still auf „uebersicht" zurück — es bricht
 * also nichts, es landet nur woanders.
 */
export type AnalyseTab =
  | "uebersicht"
  | "linkedin"
  | "telefon"
  | "setting"
  | "closing"
  | "funnel";
export type RangeKey = "w" | "m" | "30" | "q" | "j" | "custom";
/**
 * Quellen-Filter des Analyse-Bereichs.
 *
 * Der Wertebereich kommt aus der Kanal-Registry (`filterable` in
 * src/lib/channels.ts) statt aus einer eigenen Literal-Liste — vorher stand
 * dieselbe Aufzählung fünfmal im Code. Typ UND Laufzeit-Liste hängen am selben
 * Flag; ein zusätzlicher Kanal ist dort ein `filterable: true`, hier nichts.
 */
export type QuelleKey = "alle" | FilterableChannelKey;
/** Nutzer-wählbare Bucket-Granularität; "auto" = bisherige Spannen-Heuristik. */
export type Granularity = "auto" | "tag" | "woche" | "monat";
/**
 * Kohorten-Reife im Follow-up-Bereich. Ein Kontakt, der vorgestern gepitcht
 * wurde, KANN noch keine FU3-Antwort haben — er drückt jede Stufen-Quote nach
 * unten. "reif" blendet solche Kontakte aus (Pitch ≥ FU_MATURITY_DAYS her).
 */
export type ReifeKey = "alle" | "reif";
/**
 * Zählweise des Funnel-Tabs.
 *
 * "kohorte" — Closings folgen ihrem Setting: gezeigt wird, was aus den TERMINEN
 *   dieses Zeitraums geworden ist, egal wann das Closing stattfand. Nur so
 *   hängen die Stufen zusammen und die Durchlassquoten sind echte Quoten.
 * "periode" — jede Stufe zählt auf ihrem eigenen Stichtag: was ist IN diesem
 *   Zeitraum passiert. Termine und Closings stammen dann aus verschiedenen
 *   Mengen; "Show → Closing" kann rechnerisch über 100 % gehen.
 *
 * Default ist "kohorte" — ein Funnel, dessen Stufen nicht zusammenhängen, ist
 * keiner.
 */
export type FunnelModus = "kohorte" | "periode";

const TABS: readonly AnalyseTab[] = [
  "uebersicht", "linkedin", "telefon", "setting", "closing", "funnel",
];
/**
 * Gültige Werte des `quelle`-Parameters — „alle" plus die filterbaren Kanäle
 * aus der Registry. Ist die Registry die Quelle, kann die Liste hier nicht mehr
 * gegen das Termin-Formular auseinanderlaufen.
 */
const QUELLEN: readonly string[] = ["alle", ...FILTERABLE_CHANNEL_KEYS];
const GRANULARITIES: readonly Granularity[] = ["auto", "tag", "woche", "monat"];
const REIFEN: readonly ReifeKey[] = ["alle", "reif"];
const MODI: readonly FunnelModus[] = ["kohorte", "periode"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Listen-IDs sind uuids (`lists.id`) — alles andere ist Müll aus der URL. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SPAN_DAYS = 730;

/** Pitch +3 → FU1 +5 → FU2 +7 → FU3: nach 15 Tagen ist die Sequenz durch. */
export const FU_MATURITY_DAYS = 15;

export type AnalyseParams = {
  tab: AnalyseTab;
  /**
   * Der GEWÄHLTE Zeitraum-Modus — bleibt "custom", auch wenn noch keine Daten
   * eingetragen sind. Daran hängt allein, ob die Datumsfelder erscheinen.
   */
  rangeKey: RangeKey;
  /**
   * Ob "custom" auch mit gültigen von/bis-Daten kam. Daran hängen der aktive
   * Filter-Chip und die "aktive Filter"-Erkennung — nicht am `rangeKey`.
   * Ohne diese Trennung wäre "Eigener" ein toter Klick: `rangeKey` fiele
   * serverseitig auf "m" zurück, die Datumsfelder erschienen nie, und ohne
   * Felder kann niemand Daten eintragen (Henne-Ei).
   */
  hasCustomDates: boolean;
  from: string;
  to: string;
  userIds: string[];
  /**
   * Listen-Filter (URL-Parameter `listen`, kommasepariert). Leer = alle Listen.
   * Nur syntaktisch geprüft — der Abgleich gegen die real sichtbaren Listen
   * gehört auf die Seite, die sie ohnehin lädt.
   */
  listIds: string[];
  quelle: QuelleKey;
  g: Granularity;
  reife: ReifeKey;
  /** Zählweise des Funnel-Tabs (Kohorte vs. Periode). */
  modus: FunnelModus;
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
  const tab: AnalyseTab = TABS.includes(sp.tab as AnalyseTab) ? (sp.tab as AnalyseTab) : "uebersicht";

  const rawRange = sp.range as RangeKey | undefined;
  const validRange =
    rawRange === "w" || rawRange === "m" || rawRange === "30" ||
    rawRange === "q" || rawRange === "j" || rawRange === "custom";
  const rangeKey: RangeKey = validRange ? (rawRange as RangeKey) : "m";

  let from: string;
  let to: string;
  let hasCustomDates = false;

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
      hasCustomDates = true;
    } else {
      // Custom OHNE gültige Daten: nur das Zeitfenster fällt auf den laufenden
      // Monat zurück — `rangeKey` bleibt "custom", damit die Datumsfelder
      // erscheinen und überhaupt etwas eingetragen werden kann.
      ({ from, to } = presetRange("m", today));
    }
  } else {
    ({ from, to } = presetRange(rangeKey, today));
  }

  const userIds = (sp.users ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const quelle: QuelleKey = QUELLEN.includes(sp.quelle ?? "") ? (sp.quelle as QuelleKey) : "alle";

  // Listen-Filter (LinkedIn-Tab). Wie `users` nur SYNTAKTISCH geprüft — ob die
  // ID zu einer existierenden, sichtbaren Liste gehört, entscheidet die Seite;
  // hier fehlt dafür der Datenbankzugriff. Die UUID-Prüfung ist trotzdem kein
  // Luxus: ein Freitext-Rest aus einer manipulierten URL ginge sonst roh in
  // einen `in.(…)`-Filter und ließe PostgREST die ganze Abfrage abweisen.
  // Duplikate fliegen raus, damit ein Chip nicht doppelt erscheint.
  const listIds = [
    ...new Set(
      (sp.listen ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => UUID.test(s)),
    ),
  ];

  const g: Granularity = GRANULARITIES.includes(sp.g as Granularity) ? (sp.g as Granularity) : "auto";

  const reife: ReifeKey = REIFEN.includes(sp.reife as ReifeKey) ? (sp.reife as ReifeKey) : "alle";

  const modus: FunnelModus = MODI.includes(sp.modus as FunnelModus) ? (sp.modus as FunnelModus) : "kohorte";

  return { tab, rangeKey, hasCustomDates, from, to, userIds, listIds, quelle, g, reife, modus };
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

// ── Follow-up-Stufen ─────────────────────────────────────────
// `contacts.follow_up_number` ist die zuletzt GESENDETE Stufe: NULL/0 = nur
// gepitcht, 1–3 = FU1–FU3. Weil der Flow das Nachfassen bei einer Antwort
// stoppt, ist die Stufe eines beantworteten Kontakts zugleich die Stufe, auf
// der die Antwort kam — die einzige Zuordnung, die das Datenmodell hergibt
// (es gibt kein Ereignis-Log je Follow-up und kein `answered_at`).

export const FU_STAGE_LABELS = ["Pitch", "FU1", "FU2", "FU3"] as const;
export type FuStage = 0 | 1 | 2 | 3;

/** Stufe eines Kontakts; NULL und 0 sind beide „noch kein Follow-up". */
export function fuStage(n: number | null | undefined): FuStage {
  const v = Number(n);
  if (v === 1 || v === 2 || v === 3) return v;
  return 0;
}

export type FuCascadeRow = {
  stage: FuStage;
  label: string;
  /** Kontakte, die diese Stufe erreicht haben (Stufe ≥ k). */
  reached: number;
  /** Antworten, die genau auf dieser Stufe kamen. */
  answers: number;
  /** Termine, die genau auf dieser Stufe entstanden sind. */
  appts: number;
  /** answers / reached — was diese Stufe zusätzlich bringt. */
  rate: number | null;
  /** Termine / reached. */
  apptRate: number | null;
  /** Alle Antworten bis einschließlich dieser Stufe / alle Pitches. */
  cumRate: number | null;
  /** reached / Pitches — wie konsequent überhaupt nachgefasst wird. */
  coverage: number | null;
};

/**
 * Baut die Follow-up-Kaskade aus einer Kontaktmenge: je Stufe, wie viele
 * Kontakte sie erreicht haben und wie viele davon dort geantwortet haben.
 */
export function buildFuCascade(
  contacts: { follow_up_number: number | null; answered: boolean | null; appointment_set: boolean | null }[],
): FuCascadeRow[] {
  const reached = [0, 0, 0, 0];
  const answers = [0, 0, 0, 0];
  const appts = [0, 0, 0, 0];

  for (const c of contacts) {
    const s = fuStage(c.follow_up_number);
    // Stufe k erreicht heißt: alle Stufen bis k wurden durchlaufen.
    for (let k = 0; k <= s; k++) reached[k] += 1;
    if (c.answered === true) answers[s] += 1;
    if (c.appointment_set === true) appts[s] += 1;
  }

  const base = reached[0];
  let running = 0;
  return FU_STAGE_LABELS.map((label, k) => {
    running += answers[k];
    return {
      stage: k as FuStage,
      label,
      reached: reached[k],
      answers: answers[k],
      appts: appts[k],
      rate: pct(answers[k], reached[k]),
      apptRate: pct(appts[k], reached[k]),
      cumRate: pct(running, base),
      coverage: pct(reached[k], base),
    };
  });
}

// ── Antwort-Stimmung ─────────────────────────────────────────
// `contacts.answer_category` ist Freitext ohne Constraint. Neu wählbar sind
// nur Positiv/Neutral/Negativ; die Legacy-Werte werden hier auf dieselben drei
// Töpfe gemappt, damit Zeiträume über den Kategorie-Wechsel hinweg vergleichbar
// bleiben (Definitionsliste: src/lib/categories.ts).

export type Sentiment = "positiv" | "neutral" | "negativ";

const SENTIMENT_BY_CATEGORY: Record<string, Sentiment> = {
  positiv: "positiv",
  interessiert: "positiv",
  neutral: "neutral",
  "falsches timing": "neutral",
  negativ: "negativ",
  "kein interesse": "negativ",
  "zu teuer": "negativ",
  "bereits lösung": "negativ",
  "kein budget": "negativ",
  "falsche zielgruppe": "negativ",
};

/** Kategorie → Stimmung; unbekannte/leere Werte → null (nicht kategorisiert). */
export function sentimentOf(category: string | null | undefined): Sentiment | null {
  const key = (category ?? "").trim().toLowerCase();
  if (!key) return null;
  return SENTIMENT_BY_CATEGORY[key] ?? null;
}

// Neutral bewusst über VIZ_NEUTRAL statt über einen Surface-Ton: Surface-Töne
// verschwinden auf der Karte im Hintergrund (siehe Kommentar in src/lib/viz.ts).
export const SENTIMENT_META: { key: Sentiment; label: string; color: string }[] = [
  { key: "positiv", label: "Positiv", color: "var(--success)" },
  { key: "neutral", label: "Neutral", color: VIZ_NEUTRAL },
  { key: "negativ", label: "Negativ", color: "var(--danger)" },
];

export type SentimentCounts = { positiv: number; neutral: number; negativ: number; offen: number };

export const ZERO_SENTIMENT = (): SentimentCounts => ({ positiv: 0, neutral: 0, negativ: 0, offen: 0 });

/** Zählt eine Antwort-Kategorie in den passenden Topf; ohne Zuordnung → offen. */
export function addSentiment(acc: SentimentCounts, category: string | null | undefined): void {
  const s = sentimentOf(category);
  if (s) acc[s] += 1;
  else acc.offen += 1;
}

// ── Zeit-Helfer für Vorlauf-/Velocity-Analysen ───────────────

/** Ganze Tage zwischen zwei ISO-Zeitpunkten (b − a), null bei fehlendem Wert. */
export function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.floor((tb - ta) / 86400000);
}

/** Wochentag eines ISO-Tags als Index Mo=0 … So=6. */
export function weekdayIndex(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

/**
 * Arbeitstage (Mo–Fr) im Fenster, inklusive beider Grenzen. Basis für den
 * Ziel-Abgleich: `performance_targets` sind Tagesziele, und Akquise findet
 * werktags statt — ein Monatsziel wäre sonst am Wochenende „verfehlt".
 */
export function workdaysBetween(from: string, to: string): number {
  if (from > to) return 0;
  let count = 0;
  let cursor = from;
  for (let i = 0; i <= MAX_SPAN_DAYS && cursor <= to; i++) {
    if (weekdayIndex(cursor) < 5) count += 1;
    cursor = addDaysISO(cursor, 1);
  }
  return count;
}

export const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;

/**
 * Ordnet einen Wert dem ersten Bucket zu, dessen Obergrenze er nicht
 * überschreitet. `bounds` aufsteigend; alles darüber landet im letzten Bucket.
 */
export function bucketIndex(value: number, bounds: readonly number[]): number {
  for (let i = 0; i < bounds.length; i++) {
    if (value <= bounds[i]) return i;
  }
  return bounds.length;
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
