// Geteilte Darstellungs-Metadaten für den Termin-Funnel (Setting + Closing).
// Kalender, Listenansicht und Popover nutzen dieselbe Quelle.

import type { ClosingCall, SettingCall } from "@/lib/types";

/**
 * Semantik-Ton eines Termins. Er treibt den Status-Pill in Liste und Popover
 * UND den RAHMEN des Kalender-Chips.
 *
 * ── Umkehrung der bisherigen Doktrin ──────────────────────────────────────
 * Bis Runde 1 kodierte die FLÄCHE des Chips den Status und ein Text im Chip
 * den Typ. Weil die Typ-Chips aus der Kopfleiste verschwunden sind (der
 * Auftraggeber: „Setting/Closing auch nicht nötig"), muss der Typ jetzt aus
 * dem Chip selbst ablesbar sein. Deshalb gilt ab hier:
 *
 *   FÜLLUNG  = Typ    (Setting grau, Closing sehr hell)
 *   RAHMEN   = Status (gestrichelt, sobald ein Ergebnis feststeht)
 *
 * Die Semantik der Farben bleibt unverändert: Grün = weitergekommen/gewonnen,
 * Rot = verloren/geplatzt, Gold = Nachfassen nötig, Neutral = noch offen.
 */
export type Tone = "neutral" | "success" | "danger" | "warning" | "info";

export type Pill = { label: string; tone: Tone; color: string; bg: string; border: string };

const NEUTRAL: Omit<Pill, "label"> = {
  tone: "neutral",
  color: "var(--text-secondary)",
  bg: "var(--surface-3)",
  border: "var(--border-default)",
};
const SUCCESS: Omit<Pill, "label"> = {
  tone: "success",
  color: "var(--success-fg)",
  bg: "var(--success-bg)",
  border: "rgb(63 179 127 / 0.28)",
};
const ERROR: Omit<Pill, "label"> = {
  tone: "danger",
  color: "var(--danger-fg)",
  bg: "var(--danger-bg)",
  border: "rgb(214 90 82 / 0.28)",
};
const WARNING: Omit<Pill, "label"> = {
  tone: "warning",
  color: "var(--warning-fg)",
  bg: "var(--warning-bg)",
  border: "rgb(209 162 79 / 0.28)",
};

export const SETTING_STATUS_META: Record<SettingCall["status"], Pill> = {
  offen: { label: "Offen", ...NEUTRAL },
  no_show: { label: "No-Show", ...ERROR },
  // Grün, nicht Blau: „Qualifiziert" und „Closing gelegt" heißen auf der
  // Setting-Stufe dasselbe wie Grün überall sonst — eine Stufe weiter. Der
  // Auftraggeber hat für „Closing gelegt" ausdrücklich Grün verlangt; ein
  // blauer Pill neben einem grünen Rahmen wäre genau der Widerspruch, den die
  // gemeinsame Meta-Datei abschaffen soll.
  qualifiziert: { label: "Qualifiziert", ...SUCCESS },
  closing_gelegt: { label: "Closing gelegt", ...SUCCESS },
  unqualifiziert: { label: "Unqualifiziert", ...WARNING },
  dead: { label: "Dead", ...ERROR },
};

export const CLOSING_STATUS_META: Record<ClosingCall["status"], Pill> = {
  offen: { label: "Offen", ...NEUTRAL },
  gewonnen: { label: "Gewonnen", ...SUCCESS },
  verloren: { label: "Verloren", ...ERROR },
  nachfassen: { label: "Nachfassen", ...WARNING },
};

/**
 * Rahmen-Beschreibung eines Kalender-Chips.
 *
 * `dashed` = es steht ein Ergebnis fest. Ein durchgezogener Rahmen heißt
 * ausschließlich „steht noch an" — damit ist die wichtigste Frage der
 * Wochenplanung („was kommt noch?") ohne Farbverständnis beantwortbar.
 *
 * `dimmed` = abgeschlossen und aus der Planung raus. Das ersetzt den früheren
 * „Versteckte"-Schalter: Statt Termine lautlos verschwinden zu lassen, werden
 * sie zurückgenommen, bleiben aber sichtbar und anklickbar.
 */
export type EventOutline = { tone: Tone; dashed: boolean; dimmed: boolean };

/** Anwesenheit — `null` heisst „noch nicht eingetragen", nicht „nicht da". */
export type ShowStatus = "show" | "no_show" | null;

const OPEN: EventOutline = { tone: "neutral", dashed: false, dimmed: false };

/**
 * Rahmen eines SETTING-Chips.
 *
 * Zwei Felder, die auseinanderlaufen können (docs §4): `status` trägt das
 * Ergebnis, `show_status` die Anwesenheit. Der „Erschienen"-Schalter im
 * Setting-Editor setzt bewusst NUR `show_status` — ein geplatzter Termin, an
 * dem noch niemand das Ergebnis gepflegt hat, steht deshalb auf
 * `status='offen'` + `show_status='no_show'` und sähe ohne die Sonderprüfung
 * unten aus wie ein ganz normal anstehender Termin.
 *
 * Umgekehrt gilt: sobald ein Ergebnis eingetragen ist, GEWINNT DER STATUS.
 * `dead` etwa lässt `show_status` bewusst stehen (der Lead kann erschienen
 * gewesen sein) — das Ergebnis ist trotzdem „tot".
 *
 * Die beiden im Auftraggeber-Feedback nicht genannten Status:
 *  · `qualifiziert` — Altbestand. Das UI vergibt ihn nicht mehr (der Klick
 *    legt direkt das Closing an, siehe types.ts). Er sagt dasselbe wie
 *    `closing_gelegt` und bekommt deshalb dieselbe Farbe; eine eigene wäre
 *    eine Unterscheidung, die niemand mehr herstellen kann.
 *  · `dead` — abgebrochen, nicht bloß geplatzt. Gleiche Warnfarbe wie
 *    No-Show (beides „hier kommt nichts mehr"), aber `dimmed`: Ein toter Lead
 *    darf die Woche optisch nicht dominieren. Bewusst NICHT ausgeblendet —
 *    genau das war die Falle des alten „Versteckt"-Schalters.
 */
function settingOutline(status: SettingCall["status"], show: ShowStatus): EventOutline {
  switch (status) {
    case "no_show":
      return { tone: "danger", dashed: true, dimmed: false };
    case "unqualifiziert":
      return { tone: "warning", dashed: true, dimmed: false };
    case "qualifiziert":
    case "closing_gelegt":
      return { tone: "success", dashed: true, dimmed: false };
    case "dead":
      return { tone: "danger", dashed: true, dimmed: true };
    default:
      // Ergebnis offen: nur die Anwesenheit kann noch etwas sagen.
      return show === "no_show" ? { tone: "danger", dashed: true, dimmed: false } : OPEN;
  }
}

/**
 * Rahmen eines CLOSING-Chips.
 *
 * `closing_calls` kennt KEINEN No-Show-Status (docs §4) — die Information
 * steckt allein in `show_status`. Ein geplatztes Closing fällt deshalb in
 * denselben Topf wie „nachfassen": Gold heißt hier „hat nicht stattgefunden
 * bzw. ist noch nicht entschieden — da muss jemand ran". Genau die Farbe hat
 * der Auftraggeber für den Closing-No-Show verlangt; `nachfassen` (im Feedback
 * nicht genannt) teilt sie, weil beides dieselbe Handlung auslöst.
 */
function closingOutline(status: ClosingCall["status"], show: ShowStatus): EventOutline {
  switch (status) {
    // Nicht `dimmed`: gewonnen/verloren stehen bereits in
    // TERMINAL_CLOSING_STATUS und werden vom Chip über `data-terminal`
    // zurückgenommen. Beides zusammen wäre doppelte Abblendung.
    case "gewonnen":
      return { tone: "success", dashed: true, dimmed: false };
    case "verloren":
      return { tone: "danger", dashed: true, dimmed: false };
    case "nachfassen":
      return { tone: "warning", dashed: true, dimmed: false };
    default:
      return show === "no_show" ? { tone: "warning", dashed: true, dimmed: false } : OPEN;
  }
}

export function outlineFor(
  kind: "setting" | "closing",
  status: string,
  show: ShowStatus,
): EventOutline {
  return kind === "setting"
    ? settingOutline(status as SettingCall["status"], show)
    : closingOutline(status as ClosingCall["status"], show);
}

/** Abgeschlossene Termine: nicht mehr verschiebbar. */
export const TERMINAL_SETTING_STATUS: readonly SettingCall["status"][] = ["dead"];
export const TERMINAL_CLOSING_STATUS: readonly ClosingCall["status"][] = ["gewonnen", "verloren"];

export const EUR_FMT = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
