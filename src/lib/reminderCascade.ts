// Erinnerungs-Kaskade: reine Bibliothek (kein "use server"/"use client"),
// Muster src/lib/personResolution.ts bzw. src/lib/channels.ts — Typen,
// Kanal-/Kadenz-/Vorlagen-Logik an EINER Stelle, überall importierbar.
//
// Drei Termin-Arten teilen sich dieselbe Kaskade: der Setting-Termin selbst,
// der Closing-Termin, und — sobald ein Closing auf status='nachfassen' steht —
// der vereinbarte Nachfass-Zeitpunkt. Für alle drei gilt dieselbe Regel:
// Touches bei T-3/T-1 Tag/T-1 Stunde (Default, Owner-editierbar), wer keine
// Zeit mehr für einen Touch hat, bekommt ihn einfach nicht — "die Intervalle
// verkürzen sich automatisch", nicht proportional verschoben (docs/Konzept).

import { channelOf } from "@/lib/channels";
import { formatTerminParts } from "@/lib/apptTime";

export type ReminderEntityType = "setting" | "closing" | "closing_followup";
export type ReminderOffsetTouch = "offset_1" | "offset_2" | "offset_3";
export type ReminderTouchType = ReminderOffsetTouch | "no_show";
export type TouchChannel = "linkedin" | "telefon" | "whatsapp";

export const REMINDER_OFFSET_TOUCHES: readonly ReminderOffsetTouch[] = ["offset_1", "offset_2", "offset_3"];

/** Reihenfolge = Erzähl-Reihenfolge (frühester Touch zuerst). */
export const TOUCH_TYPE_LABELS: Record<ReminderTouchType, string> = {
  offset_1: "1. Erinnerung",
  offset_2: "2. Erinnerung",
  offset_3: "3. Erinnerung",
  no_show: "No-Show-Nachfassen",
};

export type ReminderSettings = {
  offset_1_hours: number;
  offset_2_hours: number;
  offset_3_hours: number;
  template_setting_reminder: string;
  template_closing_reminder: string;
  template_followup_reminder: string;
  template_no_show_setting: string;
  template_no_show_closing: string;
};

/** Fallback, solange eine Organisation noch keine eigenen Werte gespeichert hat. */
export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  offset_1_hours: 72,
  offset_2_hours: 24,
  offset_3_hours: 1,
  template_setting_reminder:
    "Hi {vorname}, wir freuen uns auf unser Gespräch am {datum} um {uhrzeit}. Passt der Termin noch?",
  template_closing_reminder: "Hi {vorname}, kurze Erinnerung an unser Gespräch am {datum} um {uhrzeit} — bis gleich!",
  template_followup_reminder: "Hi {vorname}, wie besprochen melde ich mich am {datum} um {uhrzeit} bei dir zurück.",
  template_no_show_setting:
    "Hi {vorname}, schade, dass es gerade eben nicht geklappt hat — sollen wir einen neuen Termin finden?",
  template_no_show_closing:
    "Hi {vorname}, schade, dass unser Termin eben nicht stattfinden konnte — wann passt es dir erneut?",
};

/**
 * Kanal der Setting-Kaskade: der Akquise-Kanal, über den der Lead gewonnen
 * wurde. Nur linkedin/telefon haben laut Registry (src/lib/channels.ts) eine
 * eigene Vorlauf-Kontaktform (`volume !== null`) — bei allen anderen Quellen
 * (ads, social_media, sonstige, Altwerte) gibt es keinen sinnvollen Kanal zu
 * empfehlen, die UI zeigt dann "Kanal frei wählen".
 */
export function resolveCascadeChannel(sourceType: string | null | undefined): TouchChannel | null {
  const ch = channelOf(sourceType ?? undefined);
  if (!ch) return null;
  return ch.key === "linkedin" || ch.key === "telefon" ? ch.key : null;
}

/**
 * Kanal der Closing-/Nachfass-Kaskade: WhatsApp, sobald die Nummer im Setting
 * eingesammelt UND die Einwilligung dokumentiert wurde — sonst Fallback auf
 * den Kanal, über den der Lead ursprünglich gewonnen wurde.
 */
export function resolveFollowUpChannel(setting: {
  wa_phone: string | null;
  wa_consent_at: string | null;
  source_type: string | null;
}): TouchChannel | null {
  if (setting.wa_phone?.trim() && setting.wa_consent_at) return "whatsapp";
  return resolveCascadeChannel(setting.source_type);
}

/**
 * Fälligkeitszeitpunkte der drei Offset-Touches gegen einen Termin — nur die,
 * die noch in der Zukunft liegen. Wird ein Termin kurzfristig gebucht (z. B.
 * morgen für übermorgen), entfallen die weiter zurückliegenden Touches
 * einfach, statt sie anteilig zu verschieben.
 */
export function computeCascadeDueAts(
  appointmentAtIso: string,
  settings: Pick<ReminderSettings, "offset_1_hours" | "offset_2_hours" | "offset_3_hours">,
  nowIso: string = new Date().toISOString(),
): Partial<Record<ReminderOffsetTouch, string>> {
  const appointmentMs = new Date(appointmentAtIso).getTime();
  const nowMs = new Date(nowIso).getTime();
  if (Number.isNaN(appointmentMs)) return {};

  const offsets: Record<ReminderOffsetTouch, number> = {
    offset_1: settings.offset_1_hours,
    offset_2: settings.offset_2_hours,
    offset_3: settings.offset_3_hours,
  };

  const out: Partial<Record<ReminderOffsetTouch, string>> = {};
  for (const touch of REMINDER_OFFSET_TOUCHES) {
    const dueMs = appointmentMs - offsets[touch] * 3600_000;
    if (dueMs > nowMs) out[touch] = new Date(dueMs).toISOString();
  }
  return out;
}

export type ReminderTemplateField =
  | "template_setting_reminder"
  | "template_closing_reminder"
  | "template_followup_reminder"
  | "template_no_show_setting"
  | "template_no_show_closing";

/** Welches der 5 Textfelder gilt für eine Entity/Touch-Kombination. */
export function templateFieldFor(
  entityType: ReminderEntityType,
  touchType: ReminderTouchType,
): ReminderTemplateField {
  if (touchType === "no_show") {
    return entityType === "closing" ? "template_no_show_closing" : "template_no_show_setting";
  }
  if (entityType === "closing") return "template_closing_reminder";
  if (entityType === "closing_followup") return "template_followup_reminder";
  return "template_setting_reminder";
}

/** Vorname aus einem vollen Namen — Muster firstName() in actions/nachfassen.ts. */
function firstName(name: string | null): string {
  return (name ?? "").trim().split(/\s+/)[0] || "";
}

/**
 * Platzhalter einer Erinnerungs-Vorlage füllen: {vorname}, {firma}, {datum},
 * {uhrzeit}. Wird bei JEDEM Rendern neu gegen die aktuelle Vorlage berechnet
 * (nicht beim Erzeugen eingefroren) — eine spätere Vorlagen-Änderung wirkt
 * sich damit auch auf bereits erzeugte, noch offene Touches aus.
 */
export function renderReminderTemplate(
  template: string,
  ctx: { leadName: string | null; company: string | null; appointmentAtIso: string | null },
): string {
  const parts = ctx.appointmentAtIso ? formatTerminParts(ctx.appointmentAtIso) : null;
  return template
    .replaceAll("{vorname}", firstName(ctx.leadName) || "dir")
    .replaceAll("{firma}", ctx.company?.trim() || "")
    .replaceAll("{datum}", parts?.date ?? "—")
    .replaceAll("{uhrzeit}", parts?.time ?? "—");
}
