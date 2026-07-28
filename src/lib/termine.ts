// Gemeinsames Event-Modell für den Termine-Kalender: Setting- und Closing-Calls
// werden auf eine Struktur normalisiert, damit Monat/Woche/Tag/Liste nur noch
// einen Typ kennen.
//
// Wichtig: Das Layout rechnet ausschließlich mit `dayISO` (Berlin-Kalendertag)
// + Minuten ab Mitternacht. Innerhalb des Grids gibt es damit keine Date- oder
// Zeitzonen-Arithmetik mehr — Sommer-/Winterzeit kann nirgends durchschlagen.

import { toBerlinSlot } from "@/lib/apptTime";
import {
  CLOSING_STATUS_META,
  HIDDEN_SETTING_STATUS,
  SETTING_STATUS_META,
  TERMINAL_CLOSING_STATUS,
  TERMINAL_SETTING_STATUS,
  type Pill,
} from "@/lib/terminMeta";
import type { ClosingCall, SettingCall } from "@/lib/types";

/** Feste Termin-Dauern — die App plant Setting halbstündig, Closing stündig. */
export const DURATION_MIN = { setting: 30, closing: 60 } as const;

export type TerminKind = keyof typeof DURATION_MIN;

export type Assignee = { user_id: string; username: string };

export type TerminEvent = {
  /** Eindeutig über beide Tabellen hinweg: "s:<uuid>" / "c:<uuid>". */
  id: string;
  kind: TerminKind;
  refId: string;
  /** null, wenn kein Termin gesetzt ist — dann nur in der Liste sichtbar. */
  dayISO: string | null;
  startMin: number;
  endMin: number;
  /** Roher Termin-Zeitpunkt (ISO-UTC) für Anzeige/Server-Calls. */
  at: string | null;
  title: string;
  company: string | null;
  status: string;
  statusPill: Pill;
  href: string;
  meetLink: string | null;
  meetingKind: "link" | "telefon" | null;
  sourceType: string | null;
  sourceDetail: string | null;
  dealVolume: number | null;
  ownerId: string | null;
  assignees: Assignee[];
  /** Dead / Unqualifiziert → nur mit „Versteckte"-Schalter sichtbar. */
  hidden: boolean;
  /** Abgeschlossen → nicht per Drag verschiebbar. */
  terminal: boolean;
};

type AssigneeMap = Record<string, Assignee[]>;

function fromSetting(c: SettingCall, assignees: AssigneeMap): TerminEvent {
  const slot = c.appointment_at ? toBerlinSlot(c.appointment_at) : null;
  return {
    id: `s:${c.id}`,
    kind: "setting",
    refId: c.id,
    dayISO: slot?.dayISO ?? null,
    startMin: slot?.startMin ?? 0,
    endMin: (slot?.startMin ?? 0) + DURATION_MIN.setting,
    at: c.appointment_at,
    title: c.lead_name ?? "Unbenannter Lead",
    company: c.company,
    status: c.status,
    statusPill: SETTING_STATUS_META[c.status],
    href: `/setting/${c.id}`,
    meetLink: c.meet_link,
    meetingKind: c.meeting_kind,
    sourceType: c.source_type,
    sourceDetail: c.source_detail,
    dealVolume: null,
    ownerId: c.created_by_user_id,
    assignees: assignees[c.id] ?? [],
    hidden: HIDDEN_SETTING_STATUS.includes(c.status),
    terminal: TERMINAL_SETTING_STATUS.includes(c.status),
  };
}

function fromClosing(c: ClosingCall, assignees: AssigneeMap): TerminEvent {
  const slot = c.call_at ? toBerlinSlot(c.call_at) : null;
  return {
    id: `c:${c.id}`,
    kind: "closing",
    refId: c.id,
    dayISO: slot?.dayISO ?? null,
    startMin: slot?.startMin ?? 0,
    endMin: (slot?.startMin ?? 0) + DURATION_MIN.closing,
    at: c.call_at,
    title: c.lead_name ?? "Unbenannter Lead",
    company: c.company,
    status: c.status,
    statusPill: CLOSING_STATUS_META[c.status],
    href: `/closing/${c.id}`,
    meetLink: c.meet_link,
    meetingKind: null,
    sourceType: null,
    sourceDetail: null,
    dealVolume: c.deal_volume,
    ownerId: c.created_by_user_id,
    assignees: assignees[c.id] ?? [],
    // Closing-Status haben keine „versteckte" Entsprechung — nur Setting-Calls
    // werden als Dead/Unqualifiziert aus der Planung genommen.
    hidden: false,
    terminal: TERMINAL_CLOSING_STATUS.includes(c.status),
  };
}

/**
 * Beide Tabellen zu einer Event-Liste normalisieren und in „mit Termin" /
 * „ohne Termin" trennen. Calls ohne Zeitpunkt haben keinen Platz im Raster,
 * dürfen aber nicht verschwinden → eigener Abschnitt in der Listenansicht.
 */
export function buildEvents(
  settings: SettingCall[],
  closings: ClosingCall[],
  settingAssignees: AssigneeMap,
  closingAssignees: AssigneeMap,
): { events: TerminEvent[]; ohneTermin: TerminEvent[] } {
  const all = [
    ...settings.map((c) => fromSetting(c, settingAssignees)),
    ...closings.map((c) => fromClosing(c, closingAssignees)),
  ];
  const events: TerminEvent[] = [];
  const ohneTermin: TerminEvent[] = [];
  for (const e of all) (e.dayISO ? events : ohneTermin).push(e);

  events.sort((a, b) => (a.dayISO === b.dayISO ? a.startMin - b.startMin : a.dayISO!.localeCompare(b.dayISO!)));
  ohneTermin.sort((a, b) => a.title.localeCompare(b.title, "de"));
  return { events, ohneTermin };
}

/** Events nach Berlin-Kalendertag gruppieren (Basis für alle Ansichten). */
export function groupByDay(events: TerminEvent[]): Map<string, TerminEvent[]> {
  const map = new Map<string, TerminEvent[]>();
  for (const e of events) {
    if (!e.dayISO) continue;
    const list = map.get(e.dayISO);
    if (list) list.push(e);
    else map.set(e.dayISO, [e]);
  }
  return map;
}
