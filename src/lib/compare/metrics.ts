// Kennzahl-Registry des Serienvergleichs.
//
// ══ EINE NEUE KENNZAHL ERGÄNZEN ══════════════════════════════════════════
// Eine Zeile in METRICS. Mehr nicht — kein Element, kein Chart, keine Query:
//
//   { key: "…", label: "…", group: "…", num: "…", den: "…", format: "…" }
//
//   key     stabiler URL-Schlüssel (steht in geteilten Links → nie umbenennen)
//   label   Anzeigetext im Dropdown, in Legende und Tabelle
//   group   Überschrift im Dropdown (LinkedIn · Telefon · Setting · Closing · Wert)
//   num     Zähler, ein MeasureKey aus model.ts
//   den     optionaler Nenner. Fehlt er → Menge. Steht er → Verhältnis.
//   format  int = Menge · pct = Quote (×100, rechte Achse) · eur = Euro
//
// Braucht die neue Kennzahl eine Messgröße, die es noch nicht gibt, kommt EIN
// Feld in MeasureKey (model.ts) und EINE Zeile im passenden Mapper (facts.ts)
// dazu. Alles andere — Aggregation, Chart, Tabelle, URL — bleibt unberührt.
// ═════════════════════════════════════════════════════════════════════════

import type { MeasureKey } from "@/lib/compare/model";

/** int = Menge · pct = Quote in Prozent · eur = Euro-Betrag. */
export type MetricFormat = "int" | "pct" | "eur";

export type MetricGroup = "LinkedIn" | "Telefon" | "Setting" | "Closing" | "Wert";

export type CompareMetric = {
  key: string;
  label: string;
  group: MetricGroup;
  num: MeasureKey;
  /** Gesetzt = Verhältnis (Zähler ÷ Nenner), sonst reine Menge. */
  den?: MeasureKey;
  format: MetricFormat;
  /** Kurze Methodik-Anmerkung, erscheint als Hinweis im Dropdown. */
  hint?: string;
};

export const METRICS: readonly CompareMetric[] = [
  // ── LinkedIn ───────────────────────────────────────────────
  { key: "dms", label: "DMs (Pitches)", group: "LinkedIn", num: "dms", format: "int" },
  { key: "antworten", label: "Antworten", group: "LinkedIn", num: "answers", format: "int" },
  { key: "antwortquote", label: "Antwortquote", group: "LinkedIn", num: "answers", den: "dms", format: "pct" },
  { key: "li_termine", label: "Termine aus DMs", group: "LinkedIn", num: "li_appts", format: "int" },
  { key: "li_terminquote", label: "Terminquote LinkedIn", group: "LinkedIn", num: "li_appts", den: "dms", format: "pct" },

  // ── Telefon ────────────────────────────────────────────────
  { key: "calls", label: "Anwahlen", group: "Telefon", num: "calls", format: "int", hint: "nur Leads mit Erstkontakt-Datum" },
  { key: "gatekeeper", label: "Gatekeeper erreicht", group: "Telefon", num: "gatekeeper", format: "int" },
  { key: "entscheider", label: "Entscheider erreicht", group: "Telefon", num: "decider", format: "int" },
  { key: "entscheiderquote", label: "Entscheider-Quote", group: "Telefon", num: "decider", den: "calls", format: "pct" },
  { key: "tel_termine", label: "Termine aus Anwahlen", group: "Telefon", num: "phone_appts", format: "int" },
  { key: "tel_terminquote", label: "Terminquote Telefon", group: "Telefon", num: "phone_appts", den: "calls", format: "pct" },

  // ── Setting ────────────────────────────────────────────────
  { key: "termine", label: "Termine (Setting)", group: "Setting", num: "settings", format: "int" },
  { key: "shows", label: "Shows (Setting)", group: "Setting", num: "setting_shows", format: "int" },
  // Nenner sind nur Termine MIT erfasstem Ergebnis — identisch zu Setting- und
  // Uebersichtstab. Gegen ALLE Termine gerechnet saehe dieselbe Kennzahl hier
  // anders aus als dort, und genau solche Widersprueche zerstoeren das
  // Vertrauen in die Zahlen.
  { key: "showquote", label: "Show-Quote", group: "Setting", num: "setting_shows", den: "setting_decided", format: "pct", hint: "nur Termine mit erfasstem Ergebnis im Nenner" },
  { key: "quali", label: "Qualifiziert", group: "Setting", num: "setting_quali", format: "int", hint: "erschienen + qualifiziert/Closing gelegt" },
  { key: "qualiquote", label: "Quali-Quote", group: "Setting", num: "setting_quali", den: "setting_shows", format: "pct" },
  { key: "setting_dead", label: "Dead (Setting)", group: "Setting", num: "setting_dead", format: "int" },

  // ── Closing ────────────────────────────────────────────────
  { key: "closings", label: "Closings", group: "Closing", num: "closings", format: "int" },
  { key: "closing_shows", label: "Shows (Closing)", group: "Closing", num: "closing_shows", format: "int" },
  { key: "closing_showquote", label: "Show-Quote Closing", group: "Closing", num: "closing_shows", den: "closings", format: "pct" },
  { key: "gewonnen", label: "Gewonnen", group: "Closing", num: "won", format: "int" },
  { key: "verloren", label: "Verloren", group: "Closing", num: "lost", format: "int" },
  // Gegen die Shows, nicht gegen alle Closings — deckungsgleich mit der
  // Abschlussrate im Closing-Tab. Ein Deal kann nur gewonnen werden, wenn das
  // Gespraech stattgefunden hat.
  { key: "winrate", label: "Abschlussrate", group: "Closing", num: "won", den: "closing_shows", format: "pct", hint: "gewonnen je erschienenem Closing" },

  // ── Wert ───────────────────────────────────────────────────
  // Die Verhältnisse hier sind PERIODEN-Kennzahlen: Der Deal aus dem August
  // stammt aus einer DM vom Juni. Zähler und Nenner liegen im selben Fenster,
  // aber nicht in derselben Kohorte — bei schwankendem Volumen springt der
  // Wert deshalb stark. Die Fußnote unter dem Chart sagt das auch dem Leser.
  { key: "umsatz", label: "Umsatz", group: "Wert", num: "revenue", format: "eur" },
  { key: "deal_groesse", label: "Ø Deal-Größe", group: "Wert", num: "revenue", den: "won", format: "eur" },
  { key: "umsatz_pro_dm", label: "Umsatz pro DM", group: "Wert", num: "revenue", den: "dms", format: "eur", hint: "Perioden-Kennzahl" },
  { key: "umsatz_pro_call", label: "Umsatz pro Anwahl", group: "Wert", num: "revenue", den: "calls", format: "eur", hint: "Perioden-Kennzahl" },
  { key: "umsatz_pro_termin", label: "Umsatz pro Termin", group: "Wert", num: "revenue", den: "settings", format: "eur", hint: "Perioden-Kennzahl" },
  { key: "umsatz_pro_closing", label: "Umsatz pro Closing", group: "Wert", num: "revenue", den: "closings", format: "eur", hint: "Perioden-Kennzahl" },
];

const BY_KEY = new Map(METRICS.map((m) => [m.key, m]));

/** Die erste Kennzahl der Registry — Default, wenn die URL nichts hergibt. */
export const DEFAULT_METRIC = METRICS[0];

/** Registry-Eintrag zu einem (möglicherweise unbekannten) URL-Schlüssel. */
export function metricOf(key: string | null | undefined): CompareMetric | null {
  if (!key) return null;
  return BY_KEY.get(key) ?? null;
}

/** Gruppen in Registry-Reihenfolge, für die Dropdown-Gliederung. */
export const METRIC_GROUPS: readonly MetricGroup[] = [...new Set(METRICS.map((m) => m.group))];
