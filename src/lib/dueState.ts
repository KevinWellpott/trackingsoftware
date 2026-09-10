// Fälligkeit einer Aufgabe: nur „fällig" oder schon „überfällig".
//
// DAS PROBLEM, das diese Datei löst: `nachfassen_tasks` presst fünf Quellen in
// EINE Spalte `due_at timestamptz` — und vier davon sind in Wahrheit
// Tages-Werte (`date`), die die RPC nur castet. Ein `date` wird dabei zu
// Mitternacht UTC, in Berlin also 02:00. Wer die Spalte allein nach ihrem
// Datentyp liest, hält jedes Follow-up ab 02:00 morgens für überfällig — und
// weil die RPC ohnehin nur Fälliges liefert, wäre schlicht ALLES überfällig.
// Eine Dringlichkeit, die immer gilt, ist keine.
//
// Maßgeblich ist deshalb die KÖRNUNG DER QUELLE, nicht die Schreibweise des
// Werts (docs §1: /nachfassen rechnet auf Tagen, nur der Telefon-Rückruf trägt
// eine verabredete Uhrzeit). Die Regel steht hier EINMAL: Der Zähler in der
// Seitenleiste und die Karte im Board darunter müssen sie gleich lesen, sonst
// behauptet die Navigation eine Dringlichkeit, die die Seite daneben nicht
// kennt.
//
// DIESELBE FALLE, ZWEITER FALL: Der Sofort-Touch der Erinnerungs-Kaskade trägt
// als Fälligkeit den Zeitpunkt seiner ENTSTEHUNG. Nach jeder wertbasierten
// Regel ist er eine Minute später überfällig — versäumt hat dabei niemand
// etwas, der Termin steht ja noch bevor. Für ihn ist deshalb nicht der Wert die
// Frist, sondern der Termin (`DueSpec`).

import { berlinDateISO } from "@/lib/apptTime";

/**
 * `day` — der Eintrag hat den ganzen Tag Zeit (LinkedIn-Follow-up,
 * Setting-/Closing-Wiedervorlage, Recycling-Versuch).
 * `moment` — es gibt eine verabredete Uhrzeit, die vorbeigehen kann
 * (Telefon-Rückruf).
 */
export type DueGranularity = "day" | "moment";

/**
 * Woran sich entscheidet, ob eine Fälligkeit schon VERSÄUMT ist.
 *
 * Die beiden Körnungen oben beantworten das aus dem Wert selbst. Für den
 * Sofort-Touch der Erinnerungs-Kaskade (`touch_kind='sofort'`, docs §4) geht
 * das nicht: Seine Fälligkeit IST der Zeitpunkt seiner Entstehung
 * (`planScheduledCascade`) — eine Minute später hielte ihn jede wertbasierte
 * Regel für überfällig, obwohl niemand etwas versäumt hat. Er entsteht ja
 * gerade deshalb, weil der Termin so kurzfristig gebucht wurde, dass keine
 * geplante Stufe mehr davor lag.
 *
 * Maßgeblich ist deshalb der TERMIN: Bis dahin ist eine Bestätigung sinnvoll
 * und nichts versäumt, danach ist sie sinnlos. Der Touch trägt sein
 * `appointment_at` ohnehin mit — die Regel braucht dafür keine zweite Quelle.
 */
export type DueSpec = DueGranularity | { granularity: "sofort"; appointmentAt: string | null | undefined };

/**
 * Die Frist EINER Erinnerung (`reminder_touches`). Steht hier und nicht im
 * Board, weil die Seitenleiste dieselbe Antwort geben muss: Ein Badge, das eine
 * Dringlichkeit behauptet, die die Seite darunter nicht kennt, ist schlimmer
 * als gar kein Badge (docs §5.4).
 *
 * Alles außer `sofort` trägt eine echte Uhrzeit — die Kaskade rechnet genau
 * darauf („eine Stunde vorher").
 */
export function reminderDueSpec(touch: {
  touch_kind?: string | null;
  appointment_at?: string | null;
}): DueSpec {
  if (touch.touch_kind !== "sofort") return "moment";
  return { granularity: "sofort", appointmentAt: touch.appointment_at ?? null };
}

/**
 * Bezugspunkt für einen Stapel Vergleiche. Ohne ihn ermittelt jede Prüfung
 * „jetzt" selbst — bei 500 Zeilen sind das 500 Intl-Formatierungen für dieselbe
 * Antwort. Der Zähler reicht ihn deshalb einmal durch; die Karte im Board
 * braucht ihn nicht.
 */
export type DueRef = { nowMs: number; todayIso: string };

export function dueRefNow(): DueRef {
  return dueRefAt(Date.now());
}

/**
 * Derselbe Bezugspunkt aus einem bereits gemessenen „jetzt".
 *
 * Die Oberfläche darf `Date.now()` nicht im Render-Körper aufrufen (unreine
 * Funktion, react-hooks/purity) und führt die Uhrzeit deshalb minütlich per
 * Effekt nach. Damit Karte und Zähler trotzdem dieselbe Regel benutzen können,
 * nimmt der Bezugspunkt diesen Messwert entgegen, statt selbst zu messen.
 */
export function dueRefAt(nowMs: number): DueRef {
  return { nowMs, todayIso: berlinDateISO(new Date(nowMs).toISOString()) };
}

/** Der Berliner Kalendertag eines Fälligkeitswerts — beide Schreibweisen. */
export function dueDayOf(value: string): string {
  return value.includes("T") ? berlinDateISO(value) : value.slice(0, 10);
}

/**
 * Überfällig heißt: der Zeitpunkt ist vorbei. Bei Tages-Körnung erst am
 * Folgetag, bei Uhrzeit-Körnung in der Minute danach — und beim Sofort-Touch
 * erst, wenn sein TERMIN vorbei ist (siehe `DueSpec`).
 */
export function isOverdue(
  value: string | null | undefined,
  spec: DueSpec,
  ref?: DueRef,
): boolean {
  if (!value) return false;
  if (typeof spec !== "string") {
    // Der Sofort-Touch misst gegen den Termin statt gegen sich selbst. Ohne
    // Termin bleibt er ruhig: eine Dringlichkeit, für die es keinen Endpunkt
    // gibt, wird hier nicht behauptet.
    return isOverdue(spec.appointmentAt, "moment", ref);
  }
  if (spec === "day") {
    const today = ref?.todayIso ?? berlinDateISO(new Date().toISOString());
    const day = dueDayOf(value);
    return Boolean(day) && Boolean(today) && day < today;
  }
  const t = new Date(value).getTime();
  return !Number.isNaN(t) && t < (ref?.nowMs ?? Date.now());
}
