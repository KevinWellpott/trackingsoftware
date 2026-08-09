// Kanal-Registry — EINE Quelle für alles, was ein Akquise-Kanal an Metadaten
// hat: Schlüssel, Label, Farbe, ob er wählbar ist, und ob er ein eigenes
// Akquise-Volumen besitzt.
//
// Warum es das gibt: Die Zuordnung „source_type → Label" lag zuletzt fünfmal
// im Code (SOURCE_LABELS in UebersichtTab, SettingTab, ClosingTab, FunnelTab
// und SOURCE_META in terminMeta.ts) — jede mit einem leicht anderen Fallback.
// Ein neuer Kanal hätte fünf Stellen gebraucht, und die Auftraggeber-Vorgabe
// lautet ausdrücklich: „Bau es direkt scalable, weil da auch Ads, Inbounds,
// Social Media etc. früher oder später mit einspielen sollen."
// Ab jetzt: ein Eintrag in CHANNELS, sonst nichts.
//
// Reines Fundament — kein "use client"/"use server", überall importierbar.
// terminMeta.ts bleibt vorerst unberührt (eigenes Paket).

import { VIZ_NEUTRAL, vizSlot } from "@/lib/viz";

/**
 * Erlaubte Werte von `setting_calls.source_type` (CHECK aus Migration 0029).
 *
 * Die Reihenfolge dieser Union ist zugleich die Erzähl-Reihenfolge in Donuts,
 * Tabellen und Dropdowns: erst die fünf gepflegten Kanäle, dann die Altwerte.
 */
export type ChannelKey =
  // wählbar
  | "linkedin"
  | "telefon"
  | "social_media"
  | "ads"
  | "sonstige"
  // Altwerte (Bestandsdaten, nicht mehr anbietbar)
  | "inbound"
  | "website"
  | "manuell";

/**
 * Wo das Akquise-Volumen eines Kanals steht — die Stufe VOR dem Termin.
 *
 * Nur LinkedIn (`contacts`) und Telefon (`phone_leads`) haben so eine Tabelle.
 * Für Ads, Social Media und Sonstige beginnt der Funnel erst beim Termin: dort
 * existiert kein „wie viele haben wir angesprochen".
 */
export type ChannelVolume = {
  table: "contacts" | "phone_leads";
  /** Beschriftung der Volumen-Stufe im Funnel ("DMs" / "Calls"). */
  stageLabel: string;
};

export type Channel = {
  key: ChannelKey;
  /** Anzeigelabel. Für 'manuell' bewusst mit Zusatz — siehe CHANNELS. */
  label: string;
  /**
   * Farb-Slot aus src/lib/viz.ts. Als Hex, nicht als CSS-Variable: Recharts
   * kann `var()` nicht in allen Props auflösen (Gradient-Stops, Berechnungen)
   * — siehe Kopfkommentar in viz.ts.
   */
  color: string;
  /** Im Quellen-Dropdown eines neuen Termins wählbar. Altwerte: false. */
  selectable: boolean;
  /** Erscheint im Quellen-Filter der Analyse (`?quelle=`). Siehe QUELLEN. */
  filterable: boolean;
  /** `null` = Kanal existiert erst ab der Termin-Stufe (siehe ChannelVolume). */
  volume: ChannelVolume | null;
};

/**
 * Die Registry. Reihenfolge = Anzeige-Reihenfolge, nicht alphabetisch.
 *
 * Farbvergabe: Die fünf wählbaren Kanäle bekommen die Slots 0–4 der
 * kategorialen Palette, damit ein sechster Kanal später nie die Farbe eines
 * bestehenden verschiebt (die Slot-Reihenfolge in viz.ts ist validiert und
 * darf nicht umsortiert werden). Die Altwerte teilen sich den Rest; 'manuell'
 * und 'website' tragen VIZ_NEUTRAL, weil sie keine gepflegte Kategorie mehr
 * sind — genau der Fall, für den der Neutral-Ton gedacht ist.
 *
 * `as const satisfies` ist hier kein Zierrat: `satisfies` prüft jeden Eintrag
 * gegen `Channel`, `as const` behält gleichzeitig die Literale — nur so lassen
 * sich `SelectableChannelKey` und `FilterableChannelKey` unten AUS den Flags
 * ableiten. Ein umgelegtes Flag ändert damit den Typ mit; sonst liefen
 * Laufzeit-Liste und Typ genau an der Stelle auseinander, die diese Datei
 * abschaffen soll.
 */
export const CHANNELS = [
  {
    key: "linkedin",
    label: "LinkedIn",
    color: vizSlot(0),
    selectable: true,
    filterable: true,
    volume: { table: "contacts", stageLabel: "DMs" },
  },
  {
    key: "telefon",
    label: "Telefon",
    color: vizSlot(1),
    selectable: true,
    filterable: true,
    volume: { table: "phone_leads", stageLabel: "Calls" },
  },
  {
    key: "social_media",
    label: "Social Media",
    color: vizSlot(2),
    selectable: true,
    filterable: true,
    volume: null,
  },
  {
    key: "ads",
    label: "Ads",
    color: vizSlot(3),
    selectable: true,
    filterable: true,
    volume: null,
  },
  {
    key: "sonstige",
    label: "Sonstige",
    color: vizSlot(4),
    selectable: true,
    filterable: true,
    volume: null,
  },
  {
    key: "inbound",
    label: "Inbound",
    color: vizSlot(5),
    selectable: false,
    filterable: false,
    volume: null,
  },
  {
    key: "website",
    label: "Website",
    color: VIZ_NEUTRAL,
    selectable: false,
    filterable: false,
    volume: null,
  },
  {
    key: "manuell",
    // „(ohne Angabe)" ist Absicht: Nach dem Backfill in Migration 0029 steht
    // hier nur noch, was sich aus `source_detail` NICHT eindeutig zuordnen
    // ließ. Ein blankes „Manuell" läse sich wie eine gepflegte Kategorie und
    // wäre im Funnel weiterhin die aussagelose Top-Zeile.
    label: "Manuell (ohne Angabe)",
    color: VIZ_NEUTRAL,
    selectable: false,
    filterable: true,
    volume: null,
  },
] as const satisfies readonly Channel[];

type ChannelEntry = (typeof CHANNELS)[number];

// Vollständigkeits-Wächter: Fehlt ein `ChannelKey` in CHANNELS, fällt er
// stillschweigend auf „Sonstige" zurück — hier wird daraus ein Compile-Fehler.
type AssertNever<T extends never> = T;
export type _AllChannelsRegistered = AssertNever<Exclude<ChannelKey, ChannelEntry["key"]>>;

const BY_KEY = new Map<string, Channel>(CHANNELS.map((c) => [c.key, c]));

/** Alle Schlüssel in Registry-Reihenfolge. */
export const CHANNEL_KEYS: readonly ChannelKey[] = CHANNELS.map((c) => c.key);

/** Die Kanäle, die im Termin-Formular angeboten werden (genau fünf). */
export const SELECTABLE_CHANNELS: readonly Channel[] = CHANNELS.filter((c) => c.selectable);

/** Aus dem `selectable`-Flag abgeleitet — nie von Hand nachpflegen. */
export type SelectableChannelKey = Extract<ChannelEntry, { selectable: true }>["key"];

/**
 * Kanäle, die im Quellen-Filter des Analyse-Bereichs auftauchen.
 *
 * Bewusst eine eigene Achse neben `selectable`: Ein Filter muss auch auf
 * Bestandsdaten zeigen können ('manuell' hält den Großteil des historischen
 * Volumens), während ein Altwert im Anlegen-Dropdown nichts verloren hat.
 *
 * Social Media, Ads und Sonstige standen anfangs auf false („ein Filter lohnt
 * erst, wenn es Zeilen gibt"). Das war die falsche Reihenfolge: Man KONNTE
 * Termine mit diesen Quellen buchen, aber nicht danach filtern — die Zeilen
 * entstanden also, und der Filter, mit dem man sie gefunden hätte, fehlte.
 * Eine Quelle ohne Treffer zeigt eine leere Auswertung; das ist ein
 * beantworteter Blick, kein Fehler.
 *
 * ERWEITERN: `filterable` in der Registry umlegen, sonst nichts. `QuelleKey`
 * und die Wertprüfung in `parseAnalyseParams` (src/lib/analyse.ts) hängen am
 * Flag, ebenso `QUELLE_OPTIONS` in AnalyseFilterBar.tsx.
 */
export const FILTERABLE_CHANNELS: readonly Channel[] = CHANNELS.filter((c) => c.filterable);

/** Aus dem `filterable`-Flag abgeleitet — Typ und Laufzeit-Liste bleiben gekoppelt. */
export type FilterableChannelKey = Extract<ChannelEntry, { filterable: true }>["key"];

/** Schlüssel der filterbaren Kanäle (Reihenfolge = Registry). */
export const FILTERABLE_CHANNEL_KEYS: readonly FilterableChannelKey[] = CHANNELS.filter(
  (c): c is Extract<ChannelEntry, { filterable: true }> => c.filterable,
).map((c) => c.key);

/** Registry-Eintrag zu einem (möglicherweise unbekannten) DB-Wert. */
export function channelOf(key: string | null | undefined): Channel | null {
  if (!key) return null;
  return BY_KEY.get(key) ?? null;
}

/**
 * Anzeigelabel eines Quellen-Werts.
 *
 * Fällt NICHT auf den Rohwert zurück: ein unbekannter Wert kommt nur aus
 * Bestandsdaten oder einem neueren Client und gehört in denselben Topf, den
 * das UI ohnehin schon kennt.
 *
 * @param fallback Label für `null`/unbekannt. Default „Sonstige".
 */
export function channelLabel(key: string | null | undefined, fallback = "Sonstige"): string {
  return channelOf(key)?.label ?? fallback;
}

/** Serienfarbe eines Quellen-Werts; unbekannt → Neutral-Ton. */
export function channelColor(key: string | null | undefined): string {
  return channelOf(key)?.color ?? VIZ_NEUTRAL;
}

/**
 * Hat dieser Kanal ein eigenes Akquise-Volumen (Stufe vor dem Termin)?
 *
 * DAS ist das Feld, an dem die Funnel-Darstellung hängt: Für Ads, Social Media
 * und Sonstige gibt es keine Tabelle mit „so viele haben wir angesprochen".
 * Diese Stufe muss deshalb `CHANNEL_NO_VOLUME` („—") zeigen und NICHT 0 —
 * eine 0 liest sich wie ein toter Kanal, obwohl schlicht nichts erfasst wird,
 * und zieht jede daraus gerechnete Quote ins Absurde.
 */
export function hasVolume(key: string | null | undefined): boolean {
  return channelOf(key)?.volume != null;
}

/** Beschriftung der Volumen-Stufe ("DMs"/"Calls"); `null` ohne eigenes Volumen. */
export function channelVolumeLabel(key: string | null | undefined): string | null {
  return channelOf(key)?.volume?.stageLabel ?? null;
}

/** Platzhalter für eine Kennzahl, die es für diesen Kanal strukturell nicht gibt. */
export const CHANNEL_NO_VOLUME = "—";
