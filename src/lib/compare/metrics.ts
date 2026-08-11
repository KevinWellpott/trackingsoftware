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
// Feld in MeasureKey (model.ts), EINE Zeile im passenden Mapper (facts.ts) und
// EINE Zeile in MEASURE_SOURCE (unten, sonst Compile-Fehler) dazu. Alles
// andere — Aggregation, Chart, Tabelle, URL — bleibt unberührt.
// ═════════════════════════════════════════════════════════════════════════

import { channelLabel, type ChannelKey } from "@/lib/channels";
import { DIMENSION_KEYS, type DimensionKey, type MeasureKey } from "@/lib/compare/model";

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
  // Label "Erstkontakte", nicht "Anwahlen": Die Messgroesse zaehlt FIRMEN mit
  // erstem Anruf, nicht Waehlversuche. Das Wort "Anwahlen" gehoert seit dem
  // Anruf-Log der Ereignis-Ebene (src/lib/channels.ts). Der URL-Schluessel
  // bleibt `calls` — geteilte Links duerfen nicht brechen.
  { key: "calls", label: "Erstkontakte", group: "Telefon", num: "calls", format: "int", hint: "Firmen mit erstem Anruf im Zeitraum" },
  { key: "gatekeeper", label: "Gatekeeper erreicht", group: "Telefon", num: "gatekeeper", format: "int" },
  { key: "entscheider", label: "Entscheider erreicht", group: "Telefon", num: "decider", format: "int" },
  { key: "entscheiderquote", label: "Entscheider-Quote", group: "Telefon", num: "decider", den: "calls", format: "pct" },
  { key: "tel_termine", label: "Termine aus Erstkontakten", group: "Telefon", num: "phone_appts", format: "int" },
  { key: "tel_terminquote", label: "Terminquote Telefon", group: "Telefon", num: "phone_appts", den: "calls", format: "pct", hint: "je Erstkontakt" },

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
  { key: "umsatz_pro_call", label: "Umsatz pro Erstkontakt", group: "Wert", num: "revenue", den: "calls", format: "eur", hint: "Perioden-Kennzahl" },
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

// ═══ STRUKTURELL LEERE KOMBINATIONEN ═════════════════════════════════════
//
// Wählbar war bisher auch, was es gar nicht geben kann: „DMs" × Kanal Telefon,
// „Umsatz pro Erstkontakt" × Kanal LinkedIn, „Erstkontakte" × eine LinkedIn-Liste. Das
// Ergebnis war ein leeres Diagramm mit dem Rat „Zeitraum vergrößern" — ein Rat,
// der hier nie hilft, weil die Kombination in KEINEM Zeitraum etwas liefert.
//
// Die Registry weiß genug, um das zu erkennen: Jede Messgröße stammt aus genau
// einer Quelltabelle, und jede Quelltabelle trägt nur einen Teil der fünf
// Dimensionen (facts.ts). Daraus fällt die Prüfung heraus, ohne dass irgendwo
// eine Verbotsliste gepflegt werden müsste.
// ═════════════════════════════════════════════════════════════════════════

/** Quelltabelle einer Messgröße — die vier Mapper-Blöcke aus facts.ts. */
export type MetricSource = "linkedin" | "telefon" | "setting" | "closing";

/**
 * Messgröße → Quelltabelle. Vollständig getippt: Eine neue `MeasureKey` ohne
 * Eintrag hier ist ein Compile-Fehler und keine stille Fehleinschätzung.
 */
const MEASURE_SOURCE: Record<MeasureKey, MetricSource> = {
  dms: "linkedin",
  answers: "linkedin",
  li_appts: "linkedin",
  calls: "telefon",
  gatekeeper: "telefon",
  decider: "telefon",
  phone_appts: "telefon",
  settings: "setting",
  setting_shows: "setting",
  setting_decided: "setting",
  setting_quali: "setting",
  setting_dead: "setting",
  closings: "closing",
  closing_shows: "closing",
  won: "closing",
  lost: "closing",
  revenue: "closing",
};

/**
 * Was eine Quelltabelle an Dimensionen überhaupt trägt (Spiegel von facts.ts).
 *
 * `person` und `zielgruppe` stehen nicht drin, weil alle vier Quellen sie
 * setzen — dort kann es strukturell keinen Widerspruch geben.
 */
const SOURCE_DIMS: Record<
  MetricSource,
  {
    /** Fester Kanal der Quelle; `null` = die Zeile trägt jeden Kanal. */
    kanal: ChannelKey | null;
    /** Welche Listenwelt die Zeile trägt; `null` = gar keine Liste. */
    liste: "linkedin" | "telefon" | null;
    /** Trägt die Zeile den Skript-Testarm? */
    skript: boolean;
  }
> = {
  linkedin: { kanal: "linkedin", liste: "linkedin", skript: false },
  telefon: { kanal: "telefon", liste: "telefon", skript: true },
  // Termine und Abschlüsse hängen an keiner Liste und an keinem Testarm: Ein
  // Setting kennt seinen Quellkontakt, aber der Mapper hebt dessen Liste nicht
  // an den Termin hoch — ein Filter darauf träfe null Zeilen.
  setting: { kanal: null, liste: null, skript: false },
  closing: { kanal: null, liste: null, skript: false },
};

/** Präfix der Telefonlisten auf der Listen-Achse (vergeben in facts.ts). */
const PHONE_LIST_PREFIX = "tel:";

/** Die Quelltabellen, aus denen Zähler UND Nenner einer Kennzahl kommen. */
export function metricSources(m: CompareMetric): MetricSource[] {
  const out = [MEASURE_SOURCE[m.num]];
  if (m.den && !out.includes(MEASURE_SOURCE[m.den])) out.push(MEASURE_SOURCE[m.den]);
  return out;
}

const q = (s: string) => `„${s}“`;

/**
 * Ist dieser Filterwert mit dieser Kennzahl strukturell unvereinbar?
 *
 * Rückgabe: der Grund als ganzer Satz ohne Schlusspunkt (er landet mal als
 * Hinweis unter einer Option, mal in einer Warnzeile), oder `null`, wenn die
 * Kombination Zahlen liefern kann.
 *
 * Geprüft wird gegen ALLE Quellen der Kennzahl, nicht nur gegen den Zähler:
 * Bei „Umsatz pro Erstkontakt" × Kanal LinkedIn hätte der Zähler (Umsatz) Zeilen,
 * der Nenner (Erstkontakte) nie — und ein Bruch ohne Nenner ist genauso leer wie
 * einer ohne Zähler.
 */
export function filterConflict(m: CompareMetric, dim: DimensionKey, value: string): string | null {
  const sources = metricSources(m);

  if (dim === "kanal") {
    const needed = [...new Set(sources.map((s) => SOURCE_DIMS[s].kanal).filter((k): k is ChannelKey => k !== null))];
    if (needed.length === 0) return null; // reine Termin-/Abschluss-Kennzahl: jeder Kanal denkbar
    if (needed.length > 1) {
      // Heute unerreichbar (keine Kennzahl mischt contacts und phone_leads),
      // aber die Regel gilt trotzdem: zwei feste Kanäle schließen jeden
      // einzelnen Kanalfilter aus.
      return `${q(m.label)} verrechnet ${needed.map((k) => channelLabel(k)).join(" und ")} und lässt sich auf keinen einzelnen Kanal einschränken`;
    }
    if (needed[0] !== value) return `${q(m.label)} entsteht nur im Kanal ${channelLabel(needed[0])}`;
    return null;
  }

  if (dim === "liste") {
    const worlds = sources.map((s) => SOURCE_DIMS[s].liste);
    if (worlds.some((w) => w === null)) {
      return `${q(m.label)} hängt an keiner Liste — Termine und Abschlüsse tragen Person, Kanal und Zielgruppe, nicht die Herkunftsliste`;
    }
    const world = value.startsWith(PHONE_LIST_PREFIX) ? "telefon" : "linkedin";
    if (!worlds.includes(world)) {
      const isPhone = world === "telefon";
      return `${q(m.label)} zählt ${isPhone ? "LinkedIn-Kontakte, diese Liste ist eine Telefonliste" : "Telefon-Leads, diese Liste ist eine LinkedIn-Liste"}`;
    }
    return null;
  }

  if (dim === "skript") {
    if (!sources.every((s) => SOURCE_DIMS[s].skript)) {
      return `${q(m.label)} kennt keinen Testarm — den trägt nur der Telefon-Lead`;
    }
    return null;
  }

  return null; // person, zielgruppe: von allen vier Quellen getragen
}

/**
 * Alle Widersprüche einer fertigen Serie (Kennzahl + gesetzte Filter).
 *
 * Nimmt die Filter als lose Map entgegen, damit die Registry nichts vom
 * URL-Format der Serien wissen muss.
 */
export function seriesConflicts(
  m: CompareMetric,
  filters: Partial<Record<DimensionKey, string>>,
): { dim: DimensionKey; reason: string }[] {
  const out: { dim: DimensionKey; reason: string }[] = [];
  // Reihenfolge aus DIMENSION_KEYS, nicht aus Object.keys: Die Warnzeile soll
  // bei gleicher Serie immer gleich lauten, egal in welcher Reihenfolge die
  // Filter gesetzt wurden.
  for (const dim of DIMENSION_KEYS) {
    const value = filters[dim];
    if (!value) continue;
    const reason = filterConflict(m, dim, value);
    if (reason) out.push({ dim, reason });
  }
  return out;
}
