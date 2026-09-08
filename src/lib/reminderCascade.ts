// Erinnerungs-Kaskade: reine Bibliothek (kein "use server"/"use client"),
// Muster src/lib/personResolution.ts bzw. src/lib/channels.ts.
//
// Was hier NICHT mehr steht: Die Fälligkeiten rechnet seit dem Kaskaden-Umbau
// `src/lib/cascadeEngine.ts` aus den konfigurierten Stufen (`cascade_steps`),
// die Texte kommen aus `message_templates` (`src/lib/messageTemplates.ts`).
// Das feste Offset-Tripel (T-3 Tage/T-1 Tag/T-1 Stunde) samt seiner
// Touch-Typen `offset_1..3`/`no_show` und der Vorlagen-Zuordnung dazu ist
// ersatzlos entfallen — es beschrieb ein Datenmodell, das es in der
// ausgelieferten Datenbank nicht mehr gibt (`reminder_touches` v2 trägt
// `touch_kind`/`cascade_kind`/`step_no`, docs §4).
//
// Geblieben ist die eine Frage, die sonst nirgends beantwortet wird: über
// WELCHEN Kanal wird erinnert.

import { channelOf } from "@/lib/channels";

export type ReminderEntityType = "setting" | "closing" | "closing_followup";
export type TouchChannel = "linkedin" | "telefon" | "whatsapp";

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
