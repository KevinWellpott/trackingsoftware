// Datenmodell des freien Serienvergleichs (/analyse/vergleich).
//
// Warum es diese Datei gibt: Der Auftrag lautet „hier soll wirklich jeder Rotz
// gegeneinander getestet werden können" — Telefon gegen LinkedIn, Kevin gegen
// Samuel, Liste A gegen Liste B, und morgen eine Kennzahl, die es heute noch
// nicht gibt. Ein Element je Frage zu bauen skaliert nicht; also wird EINMAL
// normalisiert und danach ist jede Kennzahl nur noch ein Paar aus Zähler und
// optionalem Nenner (src/lib/compare/metrics.ts).
//
// Der Kniff: Alle vier Quelltabellen (contacts, phone_leads, setting_calls,
// closing_calls) werden auf DIESELBE flache Faktenzeile abgebildet — ein Tag,
// fünf Dimensionen, ein Bündel vorberechneter Messgrößen. Dadurch landen
// Zähler und Nenner einer quellenübergreifenden Kennzahl („Umsatz pro DM")
// im selben Bucket unter derselben Person, ohne dass irgendwo gejoint werden
// muss.
//
// Reines Fundament: kein "use client"/"use server", keine Server-Importe —
// die Registry und die Serien-Parser hängen daran und laufen auch im Browser.

/**
 * Vorberechnete Messgrößen einer Faktenzeile.
 *
 * Die Definitionen spiegeln bewusst die maßgeblichen RPCs (docs §5), damit
 * eine Serie hier nicht anders zählt als das Dashboard daneben:
 *   dms/answers/li_appts   → rpc_owner_day_metrics
 *   calls/gatekeeper/…     → rpc_phone_day_metrics
 * Setting- und Closing-Größen folgen den Definitionen der jeweiligen
 * Analyse-Tabs (Quali = Show + qualifiziert/closing_gelegt).
 */
export type MeasureKey =
  // LinkedIn (contacts)
  | "dms"
  | "answers"
  | "li_appts"
  // Telefon (phone_leads)
  | "calls"
  | "gatekeeper"
  | "decider"
  | "phone_appts"
  // Setting (setting_calls)
  | "settings"
  | "setting_shows"
  /** Termine mit erfasstem `show_status` — der Nenner der Show-Quote. */
  | "setting_decided"
  | "setting_quali"
  | "setting_dead"
  // Closing (closing_calls)
  | "closings"
  | "closing_shows"
  | "won"
  | "lost"
  | "revenue";

/** Nur die Größen, die eine Zeile wirklich trägt — der Rest ist implizit 0. */
export type Measures = Partial<Record<MeasureKey, number>>;

/**
 * Die Filterachsen des Vergleichs.
 *
 * `kanal` ist zugleich die QUELLE eines Termins: im Datenmodell ist beides
 * dieselbe Spalte (`setting_calls.source_type`, Registry in
 * src/lib/channels.ts). Eine zweite „Quelle"-Achse wäre dieselbe Achse unter
 * anderem Namen; die fünfte Dimension trägt stattdessen den Skript-Testarm
 * (`phone_lists.script_label`, Migration 0029) — die einzige Achse, für die es
 * sonst gar keine Auswertung gibt.
 */
export type DimensionKey = "person" | "kanal" | "liste" | "zielgruppe" | "skript";

export const DIMENSION_KEYS: readonly DimensionKey[] = [
  "person",
  "kanal",
  "liste",
  "zielgruppe",
  "skript",
];

export const DIMENSION_LABEL: Record<DimensionKey, string> = {
  person: "Person",
  kanal: "Kanal",
  liste: "Liste",
  zielgruppe: "Zielgruppe",
  skript: "Skript",
};

/**
 * Eine Faktenzeile = eine Quellzeile, auf gemeinsame Achsen gebracht.
 *
 * `dims` trägt SCHLÜSSEL, keine Anzeigetexte: die Person ist eine `user_id`,
 * nicht ein Name. Sonst bedeutete eine Serie „Kevin" je nach Quelltabelle
 * zweierlei — bei LinkedIn/Telefon kommt die Person über den Listen-Owner,
 * bei Terminen über `personOf()`. Beide Wege enden hier in derselben user_id.
 *
 * `null` heißt „für diese Zeile nicht anwendbar oder nicht auflösbar". Eine
 * solche Zeile zählt in jeder ungefilterten Serie mit und fällt aus jeder
 * Serie heraus, die auf diese Dimension filtert — dieselbe Logik wie die
 * „Ohne Zuordnung"-Zeile in den Analyse-Tabs.
 */
export type CompareFact = {
  /** Berlin-Kalendertag (YYYY-MM-DD) — die Bucket-Achse. */
  day: string;
  dims: Record<DimensionKey, string | null>;
  m: Measures;
};

/** Eine wählbare Ausprägung einer Dimension (Dropdown-Eintrag). */
export type CompareOption = {
  value: string;
  label: string;
  /** Zweite Zeile im Dropdown — trennt gleichnamige Einträge. */
  hint?: string;
};

/** Faktentabelle + die real vorkommenden Ausprägungen je Dimension. */
export type CompareData = {
  facts: CompareFact[];
  options: Record<DimensionKey, CompareOption[]>;
};
