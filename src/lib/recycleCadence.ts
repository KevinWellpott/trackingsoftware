// Lead-Recycling: reine Bibliothek (kein "use server"/"use client"), Muster
// reminderCascade.ts — Typen, Kadenz- und Vorlagen-Logik an EINER Stelle.
//
// Vier Ursprünge teilen sich dieselbe Idee: ein Lead, der terminal negativ
// endet (Closing verloren, Telefon-/Setting-Lead dead, LinkedIn-FU-Flow ohne
// Antwort zu Ende), bekommt statt eines stillen Endes ein Wiedervorlage-Datum
// — mit einer Wartezeit, die vom GRUND abhängt, nicht von einem globalen
// Timer (Recherche: "falscher Zeitpunkt" lohnt sich nach Wochen erneut,
// "Vertrauen verloren" erst nach Monaten, "falsche Zielgruppe" nie).

import { addDaysISO } from "@/lib/dates";

export type RecycleOrigin = "linkedin" | "telefon" | "setting" | "closing";

/** Bei Setting/Telefon/LinkedIn gibt es keinen Verlustgrund-Code, nur diesen einen Wert. */
export type RecycleReason = string; // lost_reason_code | "dead" | "fu_exhausted"

export type RecycleSettings = {
  days_timing: number;
  days_preis: number;
  days_kein_bedarf: number;
  days_entscheider: number;
  days_wettbewerb: number;
  days_vertrauen: number;
  days_ghosting_breakup: number;
  days_ghosting: number;
  days_sonstiges: number;
  days_phone_dead: number;
  days_setting_dead: number;
  days_linkedin_exhausted: number;
  max_attempts: number;
  template_recycle_linkedin: string;
  template_recycle_telefon: string;
  template_recycle_setting: string;
  template_recycle_closing: string;
};

export const DEFAULT_RECYCLE_SETTINGS: RecycleSettings = {
  days_timing: 75,
  days_preis: 105,
  days_kein_bedarf: 105,
  days_entscheider: 150,
  days_wettbewerb: 270,
  days_vertrauen: 270,
  days_ghosting_breakup: 14,
  days_ghosting: 180,
  days_sonstiges: 120,
  days_phone_dead: 100,
  days_setting_dead: 100,
  days_linkedin_exhausted: 100,
  max_attempts: 2,
  template_recycle_linkedin:
    "Hi {vorname}, ist schon eine Weile her — {anlass}. Hättest du gerade 15 Minuten für ein kurzes Update?",
  template_recycle_telefon:
    "Hi {vorname}, wir hatten vor einiger Zeit telefoniert — {anlass}. Passt es gerade nochmal für ein kurzes Gespräch?",
  template_recycle_setting:
    "Hi {vorname}, unser Termin hatte damals nicht geklappt — {anlass}. Sollen wir einen neuen Anlauf nehmen?",
  template_recycle_closing:
    "Hi {vorname}, wir hatten uns vor einiger Zeit ausgetauscht — {anlass}. Macht es Sinn, das Thema nochmal aufzugreifen?",
};

/** Anzeige-Label je Grund — für den Badge in der Karte. */
export const RECYCLE_REASON_LABELS: Record<string, string> = {
  timing: "Timing",
  preis: "Preis",
  kein_bedarf: "Kein Bedarf",
  entscheider: "Entscheider",
  wettbewerb: "Wettbewerb",
  vertrauen: "Vertrauen",
  ghosting: "Ghosting",
  falsche_zielgruppe: "Falsche Zielgruppe",
  kein_fit: "Kein Fit",
  sonstiges: "Sonstiges",
  dead: "Dead",
  fu_exhausted: "Ohne Antwort",
};

/**
 * Kurzer, GRUND-spezifischer Anlass für {anlass} in der Vorlage — macht aus
 * "melde mich nochmal" einen konkreten Aufhänger statt einer Floskel. Leer
 * für Gründe ohne plausiblen Anlass (Vertrauen, Ghosting, Sonstiges,
 * dead/fu_exhausted) — dort ersetzt renderRecycleTemplate durch einen
 * neutralen Platzhaltersatz.
 */
const RECYCLE_REASON_HINTS: Record<string, string> = {
  timing: "vielleicht passt der Zeitpunkt inzwischen besser",
  preis: "falls sich beim Budget etwas getan hat",
  kein_bedarf: "falls sich der Bedarf inzwischen geändert hat",
  entscheider: "vielleicht sitzt inzwischen jemand anders am Drücker",
  wettbewerb: "falls die aktuelle Lösung nicht mehr überzeugt",
};

const RECYCLE_REASON_FALLBACK_HINT = "es gibt vielleicht Neues zu besprechen";

/**
 * Wartezeit bis zum NÄCHSTEN Recycling-Versuch, in Tagen. `attemptNumber` ist
 * der Versuch, der gerade GEPLANT wird (0 = erster Versuch nach dem
 * Terminal-Ereignis) — nur für Ghosting relevant, das zweistufig ist: ein
 * kurzer "Breakup"-Touch zuerst (Recherche: die Absage-Nachricht bekommt oft
 * die höchste Antwortquote der ganzen Sequenz), danach das lange Intervall.
 *
 * `falsche_zielgruppe` und `kein_fit` liefern bewusst `null` — der eine Lead
 * hätte nie in den Funnel gehört, beim anderen hat das Gespräch gezeigt, dass
 * es nicht passt. In beiden Fällen kein automatisches Recycling; die Regel
 * steht wortgleich in `schedule_recycle()` (Migration 0033) und als CHECK auf
 * `closing_calls`.
 */
export function recycleIntervalDays(
  origin: RecycleOrigin,
  reason: RecycleReason | null,
  attemptNumber: number,
  settings: RecycleSettings,
): number | null {
  if (origin === "telefon") return settings.days_phone_dead;
  if (origin === "setting") return settings.days_setting_dead;
  if (origin === "linkedin") return settings.days_linkedin_exhausted;

  // origin === "closing" — Grund entscheidet.
  switch (reason) {
    case "falsche_zielgruppe":
    case "kein_fit":
      return null;
    case "timing":
      return settings.days_timing;
    case "preis":
      return settings.days_preis;
    case "kein_bedarf":
      return settings.days_kein_bedarf;
    case "entscheider":
      return settings.days_entscheider;
    case "wettbewerb":
      return settings.days_wettbewerb;
    case "vertrauen":
      return settings.days_vertrauen;
    case "ghosting":
      return attemptNumber <= 0 ? settings.days_ghosting_breakup : settings.days_ghosting;
    default:
      // 'sonstiges' und Bestandszeilen ohne Code (Migration 0029 §4).
      return settings.days_sonstiges;
  }
}

/** Nächstes Fälligkeitsdatum oder `null`, wenn dieser Grund nie recycelt wird. */
export function computeNextRecycleAt(
  origin: RecycleOrigin,
  reason: RecycleReason | null,
  attemptNumber: number,
  settings: RecycleSettings,
  todayISO: string,
): string | null {
  const days = recycleIntervalDays(origin, reason, attemptNumber, settings);
  return days == null ? null : addDaysISO(todayISO, days);
}

type RecycleTemplateField =
  | "template_recycle_linkedin"
  | "template_recycle_telefon"
  | "template_recycle_setting"
  | "template_recycle_closing";

const TEMPLATE_FIELD_BY_ORIGIN: Record<RecycleOrigin, RecycleTemplateField> = {
  linkedin: "template_recycle_linkedin",
  telefon: "template_recycle_telefon",
  setting: "template_recycle_setting",
  closing: "template_recycle_closing",
};

/** Welches der 4 Textfelder gilt für einen Ursprung — eigener Rückgabetyp
    statt `keyof RecycleSettings`, sonst weitet TS den Wert auf `string | number`
    (die anderen Keys sind number-Felder) und `renderRecycleTemplate` nimmt nur `string`. */
export function recycleTemplateField(origin: RecycleOrigin): RecycleTemplateField {
  return TEMPLATE_FIELD_BY_ORIGIN[origin];
}

function firstName(name: string | null): string {
  return (name ?? "").trim().split(/\s+/)[0] || "";
}

/** Platzhalter füllen: {vorname}, {firma}, {anlass}. */
export function renderRecycleTemplate(
  template: string,
  ctx: { leadName: string | null; company: string | null; reason: string | null },
): string {
  const anlass = (ctx.reason && RECYCLE_REASON_HINTS[ctx.reason]) || RECYCLE_REASON_FALLBACK_HINT;
  return template
    .replaceAll("{vorname}", firstName(ctx.leadName) || "dir")
    .replaceAll("{firma}", ctx.company?.trim() || "")
    .replaceAll("{anlass}", anlass);
}
