// Deutsche Beschriftungen der Setting-Felder — an EINER Stelle.
//
// Vorher lagen dieselben Maps modul-privat in zwei "use client"-Dateien
// (BRANCHE_LABEL/BUDGET_LABEL im ClosingCallEditor, die Status-Labels im
// SettingCallEditor). Damit waren sie weder teilbar noch serverseitig
// nutzbar. Diese Datei traegt bewusst KEIN "use client" — Server Components
// und Client Components koennen sie gleichermassen importieren.

import type { SettingStatus } from "@/lib/types";

export const BRANCHE_LABEL: Record<string, string> = {
  agentur: "Agentur",
  coach: "Coach",
  consultant: "Consultant",
  sonstiges: "Sonstiges",
};

export const BUDGET_LABEL: Record<string, string> = {
  ja: "Ja",
  nein: "Nein",
  unklar: "Unklar",
};

export const SETTING_STATUS_LABEL: Record<SettingStatus, string> = {
  offen: "Offen",
  no_show: "Nicht erschienen",
  qualifiziert: "Qualifiziert",
  closing_gelegt: "Closing gelegt",
  unqualifiziert: "Unqualifiziert",
  dead: "Dead",
};

export const SHOW_STATUS_LABEL: Record<"show" | "no_show", string> = {
  show: "Erschienen",
  no_show: "Nicht erschienen",
};

/** Fuer die Ja/Nein-Qualifizierungsfelder (sole_decider, can_decide_now, clear_need). */
export function jaNein(value: boolean | null | undefined): string | null {
  if (value == null) return null;
  return value ? "Ja" : "Nein";
}
