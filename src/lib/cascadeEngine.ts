// Kaskaden-Engine: reine Bibliothek (kein "use server"/"use client").
// Rechnet aus den konfigurierten Stufen einer Organisation die Fälligkeiten
// für einen konkreten Termin aus — mehr nicht. Lesen, Schreiben und
// Zuständigkeit liegen in den Server-Actions.
//
// Ersetzt das frühere feste Offset-Tripel aus reminderCascade.ts (T-3 Tage/
// T-1 Tag/T-1 Stunde, inzwischen dort entfernt). Zwei Unterschiede:
//
//  1. Die Stufen sind Daten (cascade_steps), nicht drei feste Offsets. Damit
//     tragen Setting und Closing eigene Abstände, die Mail-Spur eigene Stufen,
//     und eine Stufe lässt sich abschalten.
//
//  2. Gerechnet wird in BERLINER WANDZEIT, nicht in Millisekunden. „3 Tage
//     vorher" heißt für einen Menschen dieselbe Uhrzeit drei Tage früher —
//     über eine Zeitumstellung hinweg liegt die alte Millisekunden-Rechnung
//     eine Stunde daneben.

import { berlinDateISO, berlinInputToIso, isoToBerlinInput } from "@/lib/apptTime";
import type { TemplateKey } from "@/lib/messageTemplates";

export type CascadeKind =
  | "setting_msg"
  | "setting_mail"
  | "closing_msg"
  | "closing_mail"
  | "followup_msg"
  | "closing_kickoff"
  | "no_show_setting"
  | "no_show_closing"
  | "kein_close";

export type TriggerEvent = "scheduled" | "created" | "no_show" | "no_close";
export type CascadeAnchor = "before_appointment" | "after_appointment";
export type TouchKind = "cascade" | "chain" | "sofort";

/** Eine Zeile aus cascade_steps. */
export type CascadeStep = {
  cascade_kind: CascadeKind;
  step_no: number;
  trigger_event: TriggerEvent;
  anchor: CascadeAnchor;
  offset_minutes: number;
  requires_no_response: boolean;
  enabled: boolean;
  template_key: TemplateKey;
};

export type PlannedTouch = {
  touch_kind: TouchKind;
  cascade_kind: CascadeKind;
  step_no: number;
  requires_no_response: boolean;
  template_key: TemplateKey;
  due_at: string;
  appointment_at: string;
};

/**
 * Eine Stufe, für die die Zeit nicht mehr reichte. Wird in der Oberfläche im
 * Klartext begründet — bisher verschwanden solche Stufen wortlos, und ein
 * leeres Kaskaden-Panel war nicht von einem Fehler zu unterscheiden.
 */
export type SkippedStep = {
  cascade_kind: CascadeKind;
  step_no: number;
  reason: string;
};

export type CascadePlan = {
  touches: PlannedTouch[];
  skipped: SkippedStep[];
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Verschiebt einen Zeitpunkt um `minutes` in BERLINER WANDZEIT und gibt
 * wieder echtes UTC zurück.
 *
 * Der Umweg über die Wandzeit ist der Punkt: rechnet man auf dem UTC-Zeitstempel,
 * landet „1 Tag vorher" am Umstellungswochenende eine Stunde daneben. Der Nutzer
 * erwartet aber dieselbe Uhrzeit, nicht dieselbe Anzahl Millisekunden.
 */
export function shiftBerlinMinutes(iso: string, minutes: number): string | null {
  const wall = isoToBerlinInput(iso);
  if (!wall) return null;
  const [datePart, timePart] = wall.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [hh, mi] = timePart.split(":").map(Number);

  // Als UTC gerechnet, weil hier nur Kalenderarithmetik auf Wandzeit-Ziffern
  // stattfindet — die echte Zonenumrechnung macht berlinInputToIso danach.
  const shifted = new Date(Date.UTC(y, mo - 1, d, hh, mi) + minutes * 60_000);
  const target =
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
  return berlinInputToIso(target);
}

function activeSteps(steps: CascadeStep[], kind: CascadeKind): CascadeStep[] {
  return steps
    .filter((s) => s.cascade_kind === kind && s.enabled)
    .sort((a, b) => a.step_no - b.step_no);
}

function humanOffset(minutes: number): string {
  if (minutes === 0) return "sofort";
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return d === 1 ? "1 Tag" : `${d} Tage`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? "1 Stunde" : `${h} Stunden`;
  }
  return `${minutes} Minuten`;
}

/* ------------------------------------------------------------------ *
 * Vorlauf: wie viele Stufen ein kurzfristig gebuchter Termin trägt
 * ------------------------------------------------------------------ */

/**
 * Vorlauf in BERLINER KALENDERTAGEN. 0 = heute, 1 = morgen, 2 = übermorgen;
 * negativ, wenn der Termin schon vorbei ist. `null` bei unlesbaren Werten.
 *
 * Kalendertage, nicht Stunden — „morgen" ist für einen Menschen ein
 * Kalenderbegriff: Ein Termin morgen um 09:00 (20 Stunden hin) und einer morgen
 * um 20:00 (31 Stunden hin) sind beide morgen. Eine Stundenrechnung behandelte
 * die beiden verschieden, und niemand könnte nachvollziehen, warum der eine
 * zwei Erinnerungen bekommt und der andere eine.
 *
 * Gerechnet wird auf den beiden Kalendertagen als UTC-Mitternacht. Das ist der
 * Grund, warum die Zeitumstellung hier nicht in die Quere kommt: Eine
 * Millisekunden-Differenz zwischen den Zeitstempeln läge am
 * Umstellungswochenende eine Stunde daneben — und damit an einem Termin kurz
 * nach Mitternacht einen ganzen Tag.
 */
export function berlinLeadDays(appointmentAtIso: string, nowIso: string): number | null {
  const appointmentDay = berlinDateISO(appointmentAtIso);
  const today = berlinDateISO(nowIso);
  if (!appointmentDay || !today) return null;
  const asUtcMidnight = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((asUtcMidnight(appointmentDay) - asUtcMidnight(today)) / 86_400_000);
}

/**
 * Welche Stufen ein Vorlauf TRÄGT — als Menge ihrer `step_no`.
 *
 * Die Regel des Auftraggebers: Ein Termin morgen bekommt nur die Erinnerung
 * kurz vor dem Termin, einer in zwei Tagen zusätzlich die vom Vortag, und erst
 * ab drei Tagen läuft die ganze Abfolge. Dahinter steht ein einfacher Gedanke:
 * Wer heute bucht, will nicht heute schon eine Nachricht bekommen, die den
 * gerade vereinbarten Termin bestätigt.
 *
 * Formuliert ist das bewusst über die ANZAHL der Stufen und ihre Nähe zum
 * Termin, nicht über die Minutenwerte 4320/1440/60: Die Offsets stehen in
 * `cascade_steps` und sind je Organisation änderbar. Ein Kunde mit vier Stufen
 * oder mit ganz anderen Abständen bekommt damit dieselbe Staffelung — je Tag
 * Vorlauf eine Stufe mehr, gezählt von der TERMIN-NÄCHSTEN rückwärts —, statt
 * einer Regel, die nur für die Auslieferungswerte stimmt.
 *
 * Mindestens EINE Stufe bleibt immer stehen: Ein Termin heute Nachmittag soll
 * die Erinnerung kurz davor noch bekommen. Ob ihr Zeitpunkt überhaupt noch in
 * der Zukunft liegt, entscheidet danach `planScheduledCascade` — diese Funktion
 * beantwortet nur, welche Stufen der Vorlauf zulässt.
 */
export function carriedStepNos(steps: CascadeStep[], leadDays: number | null): Set<number> {
  const all = new Set(steps.map((s) => s.step_no));
  // Kein lesbarer Vorlauf oder ein Termin, der schon vorbei ist: Hier ist die
  // Staffelung keine Aussage mehr. Die Stufen fallen dann über ihre Fälligkeit
  // heraus, mit der Begründung, die dazu passt.
  if (leadDays == null || leadDays < 0) return all;
  const carried = Math.max(1, Math.min(steps.length, leadDays));
  return new Set(
    [...steps]
      // Nach NÄHE zum Termin, nicht nach `step_no`: Die Reihenfolge der
      // Stufennummern prüft nur die Oberfläche, ein direkt gesetzter Datensatz
      // könnte sie verdrehen — und dann fiele ausgerechnet die letzte Stufe raus.
      .sort((a, b) => a.offset_minutes - b.offset_minutes)
      .slice(0, carried)
      .map((s) => s.step_no),
  );
}

/** „heute" / „morgen" / „in 4 Tagen" — für die Begründung im Klartext. */
function leadLabel(leadDays: number): string {
  if (leadDays <= 0) return "heute";
  if (leadDays === 1) return "morgen";
  return `in ${leadDays} Tagen`;
}

/**
 * Warum eine Stufe am kurzen Vorlauf scheitert — eine Formulierung, die
 * `CascadePanel` mitbenutzt. Zwei Texte für denselben Sachverhalt lesen sich im
 * selben Bildschirm wie zwei verschiedene Sachverhalte.
 */
export function leadSkipReason(leadDays: number, carriedCount: number): string {
  const wieviel =
    carriedCount === 1
      ? "geht nur die Erinnerung kurz vor dem Termin raus"
      : `gehen nur die letzten ${carriedCount} Stufen raus`;
  return `Entfällt — der Termin ist ${leadLabel(leadDays)}; bei so kurzem Vorlauf ${wieviel}.`;
}

/**
 * Vor-Termin-Kaskade planen.
 *
 * ZWEI Riegel, in dieser Reihenfolge:
 *
 *  1. Stufen, deren Fälligkeit schon vorbei wäre, entfallen — sie werden
 *     bewusst NICHT gestaucht: drei Nachrichten innerhalb einer Stunde sind
 *     schlimmer als eine ausgelassene Erinnerung.
 *  2. Stufen, die der VORLAUF nicht trägt, entfallen ebenfalls (`carriedStepNos`)
 *     — auch dann, wenn ihre Fälligkeit rein rechnerisch noch bevorsteht. Genau
 *     das war die Beschwerde: Ein heute gebuchter Termin für morgen 18:00 legte
 *     die Stufe „1 Tag vorher" auf HEUTE 18:00, also vier Stunden nach der
 *     Buchung — eine Bestätigungsnachricht für einen Termin, den der Lead gerade
 *     selbst vereinbart hat.
 *
 * Die Reihenfolge trägt: Ist die Fälligkeit ohnehin vorbei, ist der zeitliche
 * Grund der genauere. Der Vorlauf-Grund steht nur da, wo die Stufe sonst
 * wirklich rausgegangen wäre.
 *
 * Passt danach keine einzige Stufe mehr, entsteht ein einzelner sofort fälliger
 * Bestätigungs-Touch, damit ein kurzfristig gebuchter Termin nicht ganz ohne
 * Bestätigung bleibt.
 */
export function planScheduledCascade(
  steps: CascadeStep[],
  kind: CascadeKind,
  appointmentAtIso: string,
  nowIso: string = new Date().toISOString(),
): CascadePlan {
  const plan: CascadePlan = { touches: [], skipped: [] };
  const relevant = activeSteps(steps, kind).filter((s) => s.anchor === "before_appointment");
  if (relevant.length === 0) return plan;

  const nowMs = new Date(nowIso).getTime();
  const apptMs = new Date(appointmentAtIso).getTime();
  if (Number.isNaN(apptMs)) return plan;

  const leadDays = berlinLeadDays(appointmentAtIso, nowIso);
  const carried = carriedStepNos(relevant, leadDays);

  for (const step of relevant) {
    const due = shiftBerlinMinutes(appointmentAtIso, -step.offset_minutes);
    if (!due) continue;
    if (new Date(due).getTime() <= nowMs) {
      plan.skipped.push({
        cascade_kind: kind,
        step_no: step.step_no,
        reason: `Entfällt — der Termin liegt in weniger als ${humanOffset(step.offset_minutes)}.`,
      });
      continue;
    }
    if (!carried.has(step.step_no)) {
      plan.skipped.push({
        cascade_kind: kind,
        step_no: step.step_no,
        reason: leadSkipReason(leadDays ?? 0, carried.size),
      });
      continue;
    }
    plan.touches.push({
      touch_kind: "cascade",
      cascade_kind: kind,
      step_no: step.step_no,
      requires_no_response: step.requires_no_response,
      template_key: step.template_key,
      due_at: due,
      appointment_at: appointmentAtIso,
    });
  }

  // Keine Stufe passt mehr, der Termin steht aber noch bevor: ein einzelner
  // sofortiger Bestätigungs-Touch. step_no = 0 liegt kollisionsfrei neben den
  // geplanten Stufen.
  //
  // Seine Fälligkeit ist der Zeitpunkt seiner ENTSTEHUNG — er ist ab jetzt zu
  // tun. Überfällig wird er davon nicht: Das entscheidet `reminderDueSpec`
  // (src/lib/dueState.ts) am Termin, nicht an dieser Zeile.
  if (plan.touches.length === 0 && apptMs > nowMs) {
    // Der Text der TERMIN-NÄCHSTEN Stufe — kurz vor dem Termin gehört der Link
    // hin, nicht die Frage „steht der Termin noch?". Gewählt über den Abstand
    // wie in `carriedStepNos`, nicht über die höchste Stufennummer: Beides ist
    // bei geordneter Konfiguration dieselbe Zeile, und wenn nicht, ist der
    // Abstand die tragende Eigenschaft.
    const last = [...relevant].sort((a, b) => a.offset_minutes - b.offset_minutes)[0];
    plan.touches.push({
      touch_kind: "sofort",
      cascade_kind: kind,
      step_no: 0,
      requires_no_response: false,
      template_key: last.template_key,
      due_at: new Date(nowMs).toISOString(),
      appointment_at: appointmentAtIso,
    });
  }

  return plan;
}

/**
 * Ketten nach einem Ereignis planen — No-Show, kein Abschluss, Kickoff nach
 * der Qualifizierung. Der Anker ist der Zeitpunkt des Ereignisses, nicht der
 * Termin; die Stufen liegen danach.
 *
 * `requires_no_response` bleibt als Merkmal an der Stufe stehen: Die zweite
 * Stufe wird zwar mit angelegt, ist aber erst dann wirklich zu verschicken,
 * wenn auf die erste keine Antwort kam. Das ist wörtlich der Pfeil „keine
 * Antwort" aus der Ausarbeitung, und die Oberfläche wertet ihn aus.
 */
export function planEventChain(
  steps: CascadeStep[],
  kind: CascadeKind,
  eventAtIso: string,
  appointmentAtIso: string,
  nowIso: string = new Date().toISOString(),
): CascadePlan {
  const plan: CascadePlan = { touches: [], skipped: [] };
  const relevant = activeSteps(steps, kind).filter((s) => s.anchor === "after_appointment");
  if (relevant.length === 0) return plan;
  if (Number.isNaN(new Date(eventAtIso).getTime())) return plan;

  for (const step of relevant) {
    const due = step.offset_minutes === 0 ? eventAtIso : shiftBerlinMinutes(eventAtIso, step.offset_minutes);
    if (!due) continue;
    plan.touches.push({
      touch_kind: "chain",
      cascade_kind: kind,
      step_no: step.step_no,
      requires_no_response: step.requires_no_response,
      template_key: step.template_key,
      due_at: due,
      appointment_at: appointmentAtIso,
    });
  }

  void nowIso; // Ketten entfallen nie: sie beginnen mit dem Ereignis.
  return plan;
}

/** Welche Kaskade gehört zu welchem Termin-Typ. */
export function cascadeKindFor(
  entityType: "setting" | "closing" | "closing_followup",
  track: "msg" | "mail" = "msg",
): CascadeKind {
  if (entityType === "closing_followup") return "followup_msg";
  if (entityType === "closing") return track === "mail" ? "closing_mail" : "closing_msg";
  return track === "mail" ? "setting_mail" : "setting_msg";
}

/**
 * Anzeigenamen der neun Kaskaden.
 *
 * „Setting", nicht „Erstgespräch": Diese Labels stehen im Erinnerungs-Board und
 * im Kaskaden-Panel unmittelbar NEBEN dem Termin-Badge und dem Knopf „Zum
 * Setting" (`ENTITY_META` in ErinnerungenBoard.tsx). Zwei Wörter für dieselbe
 * Stufe auf einer Karte zwingen den Leser zu raten, ob sie dasselbe meinen.
 * „Setting" gewinnt, weil Kalender, Route und Nachfassen-Board es schon so
 * nennen und weil es neben „Closing" ein Paar ergibt.
 */
export const CASCADE_KIND_LABELS: Record<CascadeKind, string> = {
  setting_msg: "Setting — Nachrichten",
  setting_mail: "Setting — Mails",
  closing_msg: "Closing — Nachrichten",
  closing_mail: "Closing — Mails",
  followup_msg: "Nachfass-Kontakt",
  closing_kickoff: "Nach der Qualifizierung",
  no_show_setting: "No-Show Setting",
  no_show_closing: "No-Show Closing",
  kein_close: "Kein Abschluss",
};

/** Anzeige-Reihenfolge = Reihenfolge der Registry oben (Erzähl-Reihenfolge). */
const CASCADE_ORDER = Object.keys(CASCADE_KIND_LABELS) as CascadeKind[];

/** Sortierschlüssel für Tabellen; Unbekanntes ans Ende statt raus. */
export function cascadeRank(kind: CascadeKind): number {
  const i = CASCADE_ORDER.indexOf(kind);
  return i < 0 ? CASCADE_ORDER.length : i;
}

/**
 * Beschriftung EINER Stufe aus ihren strukturellen Feldern — Kaskade plus
 * Stufennummer. Bewusst nicht über `template_key`: Der ist ein Snapshot und
 * kann auf zwei Stufen derselbe sein, taugt also nicht als Gruppenname. Die
 * Erinnerungs-Liste beschriftet umgekehrt über die Vorlage, weil dort die
 * konkrete Nachricht gemeint ist, nicht die Stufe.
 */
export function cascadeStepLabel(touch: {
  touch_kind: TouchKind;
  cascade_kind: CascadeKind;
  step_no: number;
}): string {
  const kind = CASCADE_KIND_LABELS[touch.cascade_kind] ?? touch.cascade_kind;
  return `${kind} · ${touch.touch_kind === "sofort" ? "Sofort-Bestätigung" : `Stufe ${touch.step_no}`}`;
}
