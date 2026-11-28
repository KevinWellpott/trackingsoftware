// Deutsche Beschriftungen der Setting-Felder — an EINER Stelle.
//
// Vorher lagen dieselben Maps modul-privat in "use client"-Dateien (die
// Status-Labels im SettingCallEditor). Damit waren sie weder teilbar noch serverseitig
// nutzbar. Diese Datei traegt bewusst KEIN "use client" — Server Components
// und Client Components koennen sie gleichermassen importieren.

import type { SettingStatus } from "@/lib/types";

export const SETTING_STATUS_LABEL: Record<SettingStatus, string> = {
  offen: "Offen",
  no_show: "Nicht erschienen",
  qualifiziert: "Qualifiziert",
  closing_gelegt: "Closing gelegt",
  unqualifiziert: "Unqualifiziert",
  dead: "Tot",
};

export const SHOW_STATUS_LABEL: Record<"show" | "no_show", string> = {
  show: "Erschienen",
  no_show: "Nicht erschienen",
};
