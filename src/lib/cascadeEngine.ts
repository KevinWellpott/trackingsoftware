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

import { berlinInputToIso, isoToBerlinInput } from "@/lib/apptTime";
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

/**
 * Vor-Termin-Kaskade planen.
 *
 * Stufen, deren Fälligkeit schon vorbei wäre, entfallen — sie werden bewusst
 * NICHT gestaucht: drei Nachrichten innerhalb einer Stunde sind schlimmer als
 * eine ausgelassene Erinnerung. Passt keine einzige Stufe mehr, entsteht
 * stattdessen ein einzelner sofort fälliger Bestätigungs-Touch, damit ein
 * kurzfristig gebuchter Termin nicht ganz ohne Bestätigung bleibt.
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

  for (const step of relevant) {
    const due = shiftBerlinMinutes(appointmentAtIso, -step.offset_minutes);
    if (!due) continue;
    if (new Date(due).getTime() > nowMs) {
      plan.touches.push({
        touch_kind: "cascade",
        cascade_kind: kind,
        step_no: step.step_no,
        requires_no_response: step.requires_no_response,
        template_key: step.template_key,
        due_at: due,
        appointment_at: appointmentAtIso,
      });
    } else {
      plan.skipped.push({
        cascade_kind: kind,
        step_no: step.step_no,
        reason: `Entfällt — der Termin liegt in weniger als ${humanOffset(step.offset_minutes)}.`,
      });
    }
  }

  // Keine Stufe passt mehr, der Termin steht aber noch bevor: ein einzelner
  // sofortiger Bestätigungs-Touch. step_no = 0 liegt kollisionsfrei neben den
  // geplanten Stufen.
  if (plan.touches.length === 0 && apptMs > nowMs) {
    const last = relevant[relevant.length - 1];
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
