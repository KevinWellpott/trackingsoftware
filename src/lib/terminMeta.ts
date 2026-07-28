// Geteilte Darstellungs-Metadaten für den Termin-Funnel (Setting + Closing).
// Vorher lagen diese Tabellen doppelt in SettingQueue.tsx und ClosingQueue.tsx —
// jetzt nutzen Kalender, Listenansicht und Popover dieselbe Quelle.

import type { ClosingCall, SettingCall } from "@/lib/types";

/**
 * Farb-Rolle eines Termins. Sie treibt sowohl den Status-Pill als auch die
 * Einfaerbung des Kalender-Chips — im Kalender kodiert Farbe den STATUS,
 * nicht den Typ. Damit heisst Gruen in der ganzen App „gewonnen": derselbe
 * Ton wie auf den Ergebnis-Buttons (DESIGN.md §5.2). Setting vs. Closing
 * steht als Text im Chip.
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
const INFO: Omit<Pill, "label"> = {
  tone: "info",
  color: "var(--info-fg)",
  bg: "var(--info-bg)",
  border: "rgb(78 128 214 / 0.28)",
};

export const SETTING_STATUS_META: Record<SettingCall["status"], Pill> = {
  offen: { label: "Offen", ...NEUTRAL },
  no_show: { label: "No-Show", ...ERROR },
  qualifiziert: { label: "Qualifiziert", ...SUCCESS },
  closing_gelegt: { label: "Closing gelegt", ...INFO },
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
 * Herkunft eines Termins — als 8px-Kanal-Dot, nicht als Pill.
 *
 * Die Quelle ist eine KATEGORIE, kein Status: sie bekommt deshalb die
 * Pipeline-Farben (DESIGN.md §3.6) und keinen Semantik-Ton. Vorher war
 * Telefon Markenorange (Orange traegt nie Status) und Manuell gruen
 * (Gruen heisst gewonnen) — beides gestrichen.
 */
export const SOURCE_META: Record<string, { label: string; dot: string }> = {
  linkedin: { label: "LinkedIn", dot: "var(--stage-linkedin)" },
  telefon: { label: "Telefon", dot: "var(--stage-telefon)" },
  inbound: { label: "Inbound", dot: "var(--text-muted)" },
  website: { label: "Website", dot: "var(--text-muted)" },
  manuell: { label: "Manuell", dot: "var(--text-muted)" },
};

/**
 * Status, die im Kalender und in der Liste standardmäßig ausgeblendet sind.
 * Sie erscheinen erst über den „Versteckte"-Schalter — abgehakte Leads sollen
 * die Wochenplanung nicht zumüllen.
 */
export const HIDDEN_SETTING_STATUS: readonly SettingCall["status"][] = ["dead", "unqualifiziert"];

/** Abgeschlossene Termine: nicht mehr verschiebbar. */
export const TERMINAL_SETTING_STATUS: readonly SettingCall["status"][] = ["dead"];
export const TERMINAL_CLOSING_STATUS: readonly ClosingCall["status"][] = ["gewonnen", "verloren"];

export const EUR_FMT = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
