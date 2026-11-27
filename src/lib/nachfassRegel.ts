// Der Nachfass-Eingang — die Regeln, ohne Datenbank (Plan
// docs/nachfassen-umbau/PLAN-nachfass-eingang.md, Modul M1).
//
// `/nachfassen` ist der EINE Ort, an dem jeder jeden Tag sieht, wen er heute
// nerven muss: Termine ohne nächsten Schritt, Telefon-Rückrufe und fällige
// Recycling-Leads. Jeder Vorgang trägt ein Datum „Nächster Kontakt am"; wer es
// nicht hat, ist sofort fällig und trägt den Hinweis „kein nächster Schritt".
//
// Diese Datei rechnet nur. Sie kennt `terminZustand()` und `isOverdue()` und
// baut sie nicht nach — eine zweite Definition von „dran" wäre genau der
// Fehler, den dieses Projekt schon einmal bezahlt hat (docs §1).

import { addDaysISO } from "@/lib/dates";
import { berlinDateISO } from "@/lib/apptTime";

/** Woher ein Eintrag kommt. Bestimmt Fälligkeitsspalte und Körnung. */
export type NachfassQuelle = "termin" | "rueckruf" | "recycling";

/** Welche Ursprungstabelle — entscheidet Sprung-Link, Dossier und Aktion. */
export type NachfassArt = "setting" | "closing" | "phone_lead" | "contact";

/**
 * Tag = ein Kalendertag ohne Uhrzeit (`follow_up_due`, `next_recycle_at`).
 * Minute = eine mit dem Lead verabredete Uhrzeit (`callback_at`). Dieselbe
 * Unterscheidung wie `DueGranularity` in src/lib/dueState.ts.
 */
export type NachfassKoernung = "tag" | "minute";

/** Die Gruppen der Seite — in dieser Reihenfolge. */
export type NachfassGruppe = "ergebnis_fehlt" | "ueberfaellig" | "heute" | "demnaechst" | "wartet" | "aufraeumen";

export const GRUPPEN_REIHENFOLGE: readonly NachfassGruppe[] = [
  "ergebnis_fehlt",
  "ueberfaellig",
  "heute",
  "demnaechst",
  "wartet",
  "aufraeumen",
];

export const GRUPPEN_LABEL: Record<NachfassGruppe, string> = {
  ergebnis_fehlt: "Ergebnis fehlt",
  ueberfaellig: "Überfällig",
  heute: "Heute",
  demnaechst: "Demnächst",
  wartet: "Wartet",
  aufraeumen: "Aufräumen",
};

/** Die vier Reiter. „Fällig" ist die Vorgabe. */
export type NachfassReiter = "faellig" | "demnaechst" | "wartet" | "aufraeumen";

export const REITER_GRUPPEN: Record<NachfassReiter, readonly NachfassGruppe[]> = {
  faellig: ["ergebnis_fehlt", "ueberfaellig", "heute"],
  demnaechst: ["demnaechst"],
  wartet: ["wartet"],
  aufraeumen: ["aufraeumen"],
};

export function parseReiter(raw: string | null | undefined): NachfassReiter {
  return raw === "demnaechst" || raw === "wartet" || raw === "aufraeumen" ? raw : "faellig";
}

/** Quellen-Filter der Seite. */
export type NachfassFilter = "alle" | NachfassQuelle;

export function parseFilter(raw: string | null | undefined): NachfassFilter {
  return raw === "termin" || raw === "rueckruf" || raw === "recycling" ? raw : "alle";
}

/**
 * Ab wie vielen Versuchen in Folge ohne Erreichen die Zeile „aufgeben?"
 * vorschlägt. Ein Vorschlag, keine Automatik — nichts verschwindet ohne Klick
 * (Plan §4.4, Detailfrage O5). Gegenstück zu `NICHT_ERREICHT_LIMIT` im
 * Call-Modus.
 */
export const AUFGEBEN_AB_VERSUCHEN = 5;

/**
 * Stichtag des Livegangs. Der Altbestand davor wird einmal gesichtet
 * (Reiter „Aufräumen", Entscheidung N4), statt den ersten Tag mit einer
 * 160er-Liste zu beginnen. Beim Deploy auf den Tag des Livegangs setzen.
 */
export const NACHFASSEN_START = "2026-12-01";

/** Ein Vorgang gilt als Altfall, wenn sein letztes Lebenszeichen so viele Tage vor dem Stichtag liegt. */
export const ALTFALL_TAGE = 14;

/** Wie weit „Demnächst" reicht. */
export const DEMNAECHST_TAGE = 7;

/** Ein Eintrag im Protokoll (`nachfass_kontakte`, Migration 0049) — nur, was die Regeln brauchen. */
export type NachfassKontaktKurz = {
  ergebnis: "nicht_erreicht" | "erreicht";
  created_at: string;
};

export type NachfassEintrag = {
  /** Eindeutig über alle Quellen: `${art}:${id}`. */
  key: string;
  quelle: NachfassQuelle;
  art: NachfassArt;
  id: string;
  name: string;
  firma: string | null;
  /**
   * „Nächster Kontakt am": Tagesdatum (YYYY-MM-DD) bei `tag`, ISO-UTC bei
   * `minute`. `null` heißt „kein nächster Schritt" → sofort fällig.
   */
  faelligAm: string | null;
  koernung: NachfassKoernung;
  /**
   * Termin vorbei, kein Ergebnis — eine andere Handlung (eintragen statt
   * nerven), deshalb eine eigene Gruppe (Plan §4.1).
   */
  ergebnisFehlt: boolean;
  /**
   * Das jüngste Lebenszeichen vor dem Eingang (Termin, Stempel, Rückruf-
   * Zeitpunkt, Recycling-Datum) als Tagesdatum — Grundlage der Altfall-Regel.
   */
  lebenszeichen: string | null;
  /** Protokoll des Vorgangs, neuestes zuerst. */
  kontakte: NachfassKontaktKurz[];
};

/** Berliner Kalendertag der Fälligkeit. Ohne Datum: heute (sofort fällig). */
export function faelligkeitsTag(e: Pick<NachfassEintrag, "faelligAm" | "koernung">, today: string): string {
  if (!e.faelligAm) return today;
  return e.koernung === "minute" ? berlinDateISO(e.faelligAm) : e.faelligAm.slice(0, 10);
}

/**
 * Altfall (Plan §4.5): fällig, das letzte Lebenszeichen liegt mehr als
 * `ALTFALL_TAGE` vor dem Stichtag, und niemand hat ihn im Eingang angefasst
 * (kein Protokolleintrag). Abgeleitet, keine Spalte: Sobald jemand handelt —
 * Kontakt eintragen oder ein neues Datum setzen —, ist er kein Altfall mehr.
 *
 * Ein neues Fälligkeitsdatum ab dem Stichtag zählt selbst als Lebenszeichen:
 * „Nochmal versuchen" setzt es und holt den Vorgang damit nach „Fällig".
 */
export function istAltfall(e: NachfassEintrag, today: string, start: string = NACHFASSEN_START): boolean {
  // Auch ein alter Termin ohne Ergebnis ist Altbestand: Sonst stünden am
  // ersten Tag Dutzende Monate alte Termine unter „Ergebnis fehlt" (Prüfung
  // 27.11.: bis zu 23 je Person). Aufgeräumt wird er wie jeder Altfall.
  if (e.kontakte.length > 0) return false;
  const grenze = addDaysISO(start, -ALTFALL_TAGE);
  const tag = faelligkeitsTag(e, today);
  if (tag > today) return false;
  // Ein ausdrücklich gesetztes Datum ist das jüngste Lebenszeichen, sofern es
  // jünger ist als das, was der Loader mitbringt.
  const kandidaten = [e.lebenszeichen, e.faelligAm ? tag : null].filter((v): v is string => Boolean(v));
  if (kandidaten.length === 0) return true;
  const juengstes = kandidaten.reduce((a, b) => (a > b ? a : b));
  return juengstes < grenze;
}

/**
 * Die Gruppe eines Eintrags. Rückrufe sind ab der verabredeten MINUTE fällig
 * (`isOverdue(…, "moment")`-Logik), alles andere ab dem Tag.
 */
export function gruppeVon(e: NachfassEintrag, today: string, nowMs: number, start: string = NACHFASSEN_START): NachfassGruppe {
  if (istAltfall(e, today, start)) return "aufraeumen";
  if (e.ergebnisFehlt) return "ergebnis_fehlt";
  const tag = faelligkeitsTag(e, today);
  if (tag < today) return "ueberfaellig";
  if (tag === today) {
    // Ein Rückruf für heute 16:00 steht ab 16:00 oben — vorher in „Heute".
    return "heute";
  }
  if (tag <= addDaysISO(today, DEMNAECHST_TAGE)) return "demnaechst";
  void nowMs;
  return "wartet";
}

/** Ist ein Rückruf für heute schon dran (Minute erreicht)? Für den Goldton. */
export function istJetztDran(e: NachfassEintrag, today: string, nowMs: number): boolean {
  if (e.koernung !== "minute" || !e.faelligAm) return faelligkeitsTag(e, today) <= today;
  return Date.parse(e.faelligAm) <= nowMs;
}

/**
 * Versuche in Folge ohne Erreichen — gezählt vom neuesten Eintrag rückwärts
 * bis zum ersten „erreicht". Gerechnet, nicht gespeichert (Plan §4.4).
 */
export function versucheInFolge(kontakte: readonly NachfassKontaktKurz[]): number {
  let n = 0;
  for (const k of kontakte) {
    if (k.ergebnis === "erreicht") break;
    n += 1;
  }
  return n;
}

export function schlaegtAufgebenVor(kontakte: readonly NachfassKontaktKurz[]): boolean {
  return versucheInFolge(kontakte) >= AUFGEBEN_AB_VERSUCHEN;
}

/** 0 = Montag … 6 = Sonntag, auf dem Datums-String gerechnet. */
function wochentag(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** Der n-te Werktag (Mo–Fr) nach `iso`. */
export function plusWerktage(iso: string, n: number): string {
  let d = iso;
  let rest = n;
  while (rest > 0) {
    d = addDaysISO(d, 1);
    if (wochentag(d) < 5) rest -= 1;
  }
  return d;
}

/**
 * Vorbelegter nächster Kontakt — eine Konstante, keine Einstellung (Plan §4.3):
 * nicht erreicht → nächster Werktag, erreicht ohne Termin → in 3 Werktagen.
 */
export function vorschlagNaechsterKontakt(ergebnis: NachfassKontaktKurz["ergebnis"], today: string): string {
  return plusWerktage(today, ergebnis === "nicht_erreicht" ? 1 : 3);
}

/** Schnellwahl im Popover: Morgen · 2 Tage · 1 Woche (Werktage). */
export function schnellwahl(today: string): { label: string; tag: string }[] {
  return [
    { label: "Morgen", tag: plusWerktage(today, 1) },
    { label: "2 Tage", tag: plusWerktage(today, 2) },
    { label: "1 Woche", tag: plusWerktage(today, 5) },
  ];
}

/**
 * Sortierung innerhalb einer Gruppe: nach Fälligkeit, ein Rückruf mit Uhrzeit
 * vor den Tagesaufgaben desselben Tages erst, wenn seine Minute erreicht ist —
 * davor nach Uhrzeit. Ohne Datum („kein nächster Schritt") ganz vorn.
 */
export function vergleiche(a: NachfassEintrag, b: NachfassEintrag, today: string): number {
  const ta = faelligkeitsTag(a, today);
  const tb = faelligkeitsTag(b, today);
  if (ta !== tb) return ta.localeCompare(tb);
  const ka = a.faelligAm === null ? 0 : a.koernung === "minute" ? 1 : 2;
  const kb = b.faelligAm === null ? 0 : b.koernung === "minute" ? 1 : 2;
  if (ka !== kb) return ka - kb;
  if (a.koernung === "minute" && b.koernung === "minute") return (a.faelligAm ?? "").localeCompare(b.faelligAm ?? "");
  return a.name.localeCompare(b.name, "de") || a.key.localeCompare(b.key);
}

/** Die Einträge, nach Gruppen sortiert. */
export function gruppiere<T extends NachfassEintrag>(
  eintraege: readonly T[],
  today: string,
  nowMs: number,
  start: string = NACHFASSEN_START,
): Map<NachfassGruppe, T[]> {
  const out = new Map<NachfassGruppe, T[]>();
  for (const g of GRUPPEN_REIHENFOLGE) out.set(g, []);
  for (const e of eintraege) out.get(gruppeVon(e, today, nowMs, start))!.push(e);
  for (const list of out.values()) list.sort((a, b) => vergleiche(a, b, today));
  return out;
}

/** Die Kopfzahlen der Seite (Plan §4.1). „Heute erledigt" kommt aus dem Protokoll. */
export type Kopfzahlen = { ueberfaellig: number; heute: number; dieseWoche: number; heuteErledigt: number };

export function kopfzahlen<T extends NachfassEintrag>(
  gruppen: Map<NachfassGruppe, T[]>,
  heuteErledigt: number,
): Kopfzahlen {
  return {
    ueberfaellig: (gruppen.get("ueberfaellig")?.length ?? 0) + (gruppen.get("ergebnis_fehlt")?.length ?? 0),
    heute: gruppen.get("heute")?.length ?? 0,
    dieseWoche: gruppen.get("demnaechst")?.length ?? 0,
    heuteErledigt,
  };
}

/** Badge der Seitenleiste: überfällig + heute + Ergebnis fehlt, ohne Aufräumen (Plan M8). */
export function badgeZahl<T extends NachfassEintrag>(gruppen: Map<NachfassGruppe, T[]>): { total: number; overdue: number } {
  const ueber = (gruppen.get("ueberfaellig")?.length ?? 0) + (gruppen.get("ergebnis_fehlt")?.length ?? 0);
  return { total: ueber + (gruppen.get("heute")?.length ?? 0), overdue: ueber };
}

/**
 * Wann ein Vorgang nach einem erfassten Show-Status von selbst im Eingang
 * fällig wird (Plan §4.6): nicht erschienen → heute, erschienen ohne Ergebnis
 * → nächster Werktag. Nur, wenn der Aufrufer kein eigenes Datum mitschickt.
 */
export function faelligNachShowStatus(show: "show" | "no_show" | null | undefined, today: string): string | null {
  if (show === "no_show") return today;
  if (show === "show") return plusWerktage(today, 1);
  return null;
}

/** Braucht diese Zeile die Schnellknöpfe? Termin hat begonnen, kein Ergebnis. */
export function brauchtErgebnis(input: {
  kind: "setting" | "closing";
  status: string;
  showStatus: string | null;
  at: string | null;
  abgesagt: boolean;
  nowMs: number | null;
}): boolean {
  if (!input.at || input.abgesagt || input.nowMs === null) return false;
  if (Date.parse(input.at) > input.nowMs) return false;
  if (input.kind === "setting") return input.status === "offen" && !input.showStatus;
  return input.status === "offen" && input.showStatus !== "no_show";
}
