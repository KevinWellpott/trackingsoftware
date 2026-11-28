// Plattform-Übersicht „Organisationen im Blick“ — die Regeln, ohne Datenbank.
//
// Titan (Plattform-Admins) sieht je Organisation, was heute, diese Woche und
// diesen Monat passiert ist, und hält es gegen einen Richtwert pro Arbeitstag.
// Die Definitionen sind die der übrigen App (docs/data-model.md §1, §5):
//
//   Anwahlen        jede Zeile in phone_call_attempts (Ereignis-Ebene)
//   LinkedIn-Pitches contacts, Tag = coalesce(pitched_at, created_at)
//   Termine gelegt  setting_calls nach Anlage (`created_at`) — „gelegt“
//   Settings        Erstgespräche mit Termin im Zeitraum, schon begonnen,
//                   ohne wirkende Absage — „stattgefunden bzw. fällig gewesen“
//   Closings        Closing-Termine im Zeitraum, schon begonnen, ohne Absage
//
// Alle Tage sind Berliner Kalendertage (YYYY-MM-DD).

import { addDaysISO, weekStart } from "@/lib/dates";

export type Kennzahl = "anwahlen" | "pitches" | "termine" | "settings" | "closings";

export const KENNZAHLEN: readonly { key: Kennzahl; label: string; hinweis: string }[] = [
  { key: "anwahlen", label: "Anwahlen", hinweis: "Jeder Wählversuch aus dem Anruf-Log — derselbe Lead zählt mehrfach." },
  { key: "pitches", label: "LinkedIn-Pitches", hinweis: "Gepitchte Kontakte nach Pitch-Datum." },
  { key: "termine", label: "Termine gelegt", hinweis: "Neu gebuchte Erstgespräche, nach dem Tag der Buchung — alle Quellen." },
  { key: "settings", label: "Settings", hinweis: "Erstgespräche mit Termin im Zeitraum, die schon begonnen haben — ohne Absagen." },
  { key: "closings", label: "Closings", hinweis: "Closing-Termine im Zeitraum, die schon begonnen haben — ohne Absagen." },
];

export type Zeitraum = "tag" | "woche" | "monat";

export const ZEITRAEUME: readonly { key: Zeitraum; label: string }[] = [
  { key: "tag", label: "Heute" },
  { key: "woche", label: "Woche" },
  { key: "monat", label: "Monat" },
];

/** Beginn jedes Zeitraums; das Ende ist immer `today`. Woche ab Montag, Monat ab dem 1. */
export function zeitraumBeginn(today: string): Record<Zeitraum, string> {
  return { tag: today, woche: weekStart(today), monat: `${today.slice(0, 7)}-01` };
}

/** Frühester Tag, den der Loader braucht — eine Woche kann im Vormonat beginnen. */
export function fruehesterTag(today: string): string {
  const b = zeitraumBeginn(today);
  return b.woche < b.monat ? b.woche : b.monat;
}

/** 0 = Montag … 6 = Sonntag, auf dem Datums-String. */
function wochentag(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** Arbeitstage (Mo–Fr) von `von` bis `bis`, beide eingeschlossen. Feiertage zählen mit. */
export function arbeitstage(von: string, bis: string): number {
  let n = 0;
  for (let d = von; d <= bis; d = addDaysISO(d, 1)) if (wochentag(d) < 5) n += 1;
  return n;
}

/** Letzter Tag des Monats von `iso`. */
export function monatsEnde(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const naechster = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return addDaysISO(naechster, -1);
}

/**
 * Soll BIS HEUTE: Richtwert × Arbeitstage vom Beginn des Zeitraums bis heute.
 * So beantwortet die Zahl „liegen wir im Plan?“ — am Mittwoch zählt die Woche
 * drei Arbeitstage, nicht fünf. Am Wochenende ist das Tages-Soll 0.
 */
export function sollBisHeute(richtwert: number | null, z: Zeitraum, today: string): number | null {
  if (richtwert == null) return null;
  return richtwert * arbeitstage(zeitraumBeginn(today)[z], today);
}

/** Soll für den GANZEN Zeitraum (Woche Mo–Fr, ganzer Monat) — für den Hinweis. */
export function sollGesamt(richtwert: number | null, z: Zeitraum, today: string): number | null {
  if (richtwert == null) return null;
  const b = zeitraumBeginn(today)[z];
  const ende = z === "tag" ? today : z === "woche" ? addDaysISO(b, 6) : monatsEnde(today);
  return richtwert * arbeitstage(b, ende);
}

export type Zaehler = Record<Kennzahl, Record<Zeitraum, number>>;

export function leererZaehler(): Zaehler {
  const z = {} as Zaehler;
  for (const k of KENNZAHLEN) z[k.key] = { tag: 0, woche: 0, monat: 0 };
  return z;
}

/** Ein Ereignis an einem Tag in die drei Zeiträume einsortieren. Zukunft zählt nicht. */
export function zaehle(z: Zaehler, k: Kennzahl, tag: string | null, today: string): void {
  if (!tag || tag > today) return;
  const b = zeitraumBeginn(today);
  if (tag === today) z[k].tag += 1;
  if (tag >= b.woche) z[k].woche += 1;
  if (tag >= b.monat) z[k].monat += 1;
}

export function summiere(liste: readonly Zaehler[]): Zaehler {
  const s = leererZaehler();
  for (const z of liste) for (const k of KENNZAHLEN) for (const t of ZEITRAEUME) s[k.key][t.key] += z[k.key][t.key];
  return s;
}

export type Richtwerte = Record<Kennzahl, number | null>;

export const KEINE_RICHTWERTE: Richtwerte = { anwahlen: null, pitches: null, termine: null, settings: null, closings: null };

/** Summe der Richtwerte; `null`, wenn keine einzige Organisation einen hat. */
export function summiereRichtwerte(liste: readonly Richtwerte[]): Richtwerte {
  const s: Richtwerte = { ...KEINE_RICHTWERTE };
  for (const r of liste) {
    for (const k of KENNZAHLEN) {
      const v = r[k.key];
      if (v != null) s[k.key] = (s[k.key] ?? 0) + v;
    }
  }
  return s;
}

/** Hat die Organisation im Monat irgendetwas getan? Sonst steht sie unten gesammelt. */
export function aktivImMonat(z: Zaehler): boolean {
  return KENNZAHLEN.some((k) => z[k.key].monat > 0);
}

/** Erfüllungsgrad 0…∞ oder `null` ohne Soll; ein Soll von 0 gilt als erfüllt. */
export function erfuellung(ist: number, soll: number | null): number | null {
  if (soll == null) return null;
  if (soll === 0) return 1;
  return ist / soll;
}

/** Eingabe aus dem Formular: leer = kein Richtwert, sonst ganze Zahl 0…100000. */
export function parseRichtwert(raw: unknown): number | null | undefined {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  return n <= 100000 ? n : undefined;
}
