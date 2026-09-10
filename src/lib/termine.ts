// Gemeinsames Event-Modell für den Termine-Kalender: Setting- und Closing-Calls
// werden auf eine Struktur normalisiert, damit Monat/Woche/Tag/Liste nur noch
// einen Typ kennen.
//
// Wichtig: Das Layout rechnet ausschließlich mit `dayISO` (Berlin-Kalendertag)
// + Minuten ab Mitternacht. Innerhalb des Grids gibt es damit keine Date- oder
// Zeitzonen-Arithmetik mehr — Sommer-/Winterzeit kann nirgends durchschlagen.

import { toBerlinSlot } from "@/lib/apptTime";
import { personOf, type AssignableRow } from "@/lib/personResolution";
import {
  CANCELLED_PILL,
  CLOSING_STATUS_META,
  moveLockReason,
  outlineFor,
  SETTING_STATUS_META,
  TERMINAL_CLOSING_STATUS,
  TERMINAL_SETTING_STATUS,
  type EventOutline,
  type Pill,
  type ShowStatus,
} from "@/lib/terminMeta";
import type { ClosingCall, SettingCall } from "@/lib/types";

/**
 * Die Absage-Spalte aus Migration 0032 — als OPTIONALES Feld neben dem
 * geteilten Typ, nicht darin (Muster `AppointmentLifecycle`,
 * components/termine/lifecycleMeta.ts).
 *
 * Die Kalender-Abfrage lädt mit `select("*")`, der Wert ist zur Laufzeit also
 * längst da; `SettingCall`/`ClosingCall` tragen dagegen die Achsen sämtlicher
 * Auswertungen und sollen nicht bei jedem Lebenszyklus-Feld wachsen. Optional
 * deklariert, damit die Seite unverändert `SettingCall[]` übergeben kann —
 * fehlt das Feld, gilt der Termin als nicht abgesagt.
 */
export type WithCancellation<T> = T & { cancelled_at?: string | null };

/** Feste Termin-Dauern — die App plant Setting halbstündig, Closing stündig. */
export const DURATION_MIN = { setting: 30, closing: 60 } as const;

export type TerminKind = keyof typeof DURATION_MIN;

export type Assignee = { user_id: string; username: string };

export type { ShowStatus };

/**
 * `profiles.username` je `user_id`, auf die aktive Organisation beschränkt.
 * Kommt aus `listDataViewUsers()` — dieselbe Liste, die schon den
 * Personenfilter füllt. Ein zweiter Durchlauf über `call_assignees` entfällt
 * dadurch komplett.
 */
export type UsernameById = ReadonlyMap<string, string>;

/**
 * Fällt der Name nicht auf ein Mitglied der aktiven Organisation zurück, ist
 * die Person real nicht mehr im Team (Mitgliedschaft gelöscht, Org-Umzug). Der
 * Termin bleibt sichtbar, aber ohne erfundenen Namen — die rohe UUID als Label
 * hätte nur unlesbare Initialen und eine zufällige Owner-Farbe ergeben.
 */
const UNKNOWN_USERNAME = "Unbekannt";

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
  /** Rahmen des Kalender-Chips (Füllung = Typ, Rahmen = Status). */
  outline: EventOutline;
  href: string;
  meetLink: string | null;
  meetingKind: "link" | "telefon" | null;
  /**
   * Rufnummer bei Termin-Art „Telefon" (`setting_calls.phone`, Migration 0029).
   * Für Closings immer `null` — `closing_calls` hat keine eigene Spalte; das
   * Closing erbt beim Anlegen nur den Meet-Link.
   */
  phone: string | null;
  sourceType: string | null;
  sourceDetail: string | null;
  dealVolume: number | null;
  /** Ist der Lead erschienen? Fließt in `outline` ein, siehe terminMeta. */
  showStatus: ShowStatus;
  /**
   * Die zuständige Person — genau EINE, aufgelöst über `personOf()`
   * (Zuweisung, ersatzweise Ersteller). Ersetzt den früheren Avatar-Stack aus
   * `call_assignees`; die Tabelle wird nicht mehr gelesen.
   * `null` nur, wenn weder Zuweisung noch Ersteller existiert (gelöschter
   * Nutzer, `on delete set null`).
   */
  assignee: Assignee | null;
  /** Abgeschlossen → der Chip nimmt sich über `data-terminal` zurück. */
  terminal: boolean;
  /**
   * Abgesagt (Migration 0032). Steht in KEINEM Status — wer nur `status` liest,
   * hält einen abgesagten Termin für „offen" (docs §3).
   */
  cancelled: boolean;
  /**
   * Warum dieser Termin nicht verschoben werden darf; `null` = er darf.
   *
   * Der Grund reist mit dem Event, statt am Drop nachgeschlagen zu werden: Der
   * Kalender muss ihn schon beim ZIEHEN zeigen können, und ein Riegel, der
   * einen Zug wortlos schlucken lässt, ist schlimmer als einer, der eine
   * Meldung zeigt.
   */
  lockedReason: string | null;
};

function resolveAssignee(row: AssignableRow, names: UsernameById): Assignee | null {
  const uid = personOf(row);
  if (!uid) return null;
  return { user_id: uid, username: names.get(uid) ?? UNKNOWN_USERNAME };
}

/**
 * Ton + Label des Status-Pills.
 *
 * Regelfall ist der Status. Ausnahme: ein Termin, zu dem der Lead nicht
 * erschienen ist, dessen Ergebnis aber noch „offen" steht. `closing_calls`
 * kennt gar keinen No-Show-Status (docs §4) — die Information steckt dort
 * ausschließlich in `show_status`. Ohne diesen Zweig läse sich ein geplatztes
 * Closing wie ein ganz normal anstehender Termin.
 *
 * Bewusst der komplette Pill und nicht nur die Farbe: Ein roter Chip mit der
 * Beschriftung „Offen" wäre in Liste und Popover ein Widerspruch — Farbe und
 * Label müssen dasselbe sagen.
 */
function pillFor(
  base: Pill,
  kind: TerminKind,
  status: string,
  showStatus: ShowStatus,
  cancelled: boolean,
): Pill {
  // Die Absage schlägt alles: Sie lässt `status` und `show_status` bewusst
  // unangetastet (docs §3), also sagt keiner der beiden sie an. Ohne diesen
  // Zweig stand in Liste und Popover „Offen" über einem Termin, den beide
  // Seiten abgeräumt haben.
  if (cancelled) return CANCELLED_PILL;
  if (showStatus !== "no_show" || status !== "offen") return base;
  // Setting: es gibt einen echten No-Show-Status, also dessen Pill.
  // Closing: kein solcher Status — dort ist „Nicht erschienen" das Ergebnis,
  // das der Gold-Rahmen ohnehin schon zeigt.
  return kind === "setting"
    ? SETTING_STATUS_META.no_show
    : { ...CLOSING_STATUS_META.nachfassen, label: "Nicht erschienen" };
}

function fromSetting(c: WithCancellation<SettingCall>, names: UsernameById): TerminEvent {
  const slot = c.appointment_at ? toBerlinSlot(c.appointment_at) : null;
  const cancelled = Boolean(c.cancelled_at);
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
    statusPill: pillFor(SETTING_STATUS_META[c.status], "setting", c.status, c.show_status, cancelled),
    outline: outlineFor("setting", c.status, c.show_status, cancelled),
    href: `/setting/${c.id}`,
    meetLink: c.meet_link,
    meetingKind: c.meeting_kind,
    phone: c.phone,
    sourceType: c.source_type,
    sourceDetail: c.source_detail,
    dealVolume: null,
    showStatus: c.show_status,
    assignee: resolveAssignee(c, names),
    terminal: TERMINAL_SETTING_STATUS.includes(c.status),
    cancelled,
    lockedReason: moveLockReason("setting", c.status, cancelled),
  };
}

function fromClosing(c: WithCancellation<ClosingCall>, names: UsernameById): TerminEvent {
  const slot = c.call_at ? toBerlinSlot(c.call_at) : null;
  const cancelled = Boolean(c.cancelled_at);
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
    statusPill: pillFor(CLOSING_STATUS_META[c.status], "closing", c.status, c.show_status, cancelled),
    outline: outlineFor("closing", c.status, c.show_status, cancelled),
    href: `/closing/${c.id}`,
    meetLink: c.meet_link,
    meetingKind: null,
    phone: null,
    sourceType: null,
    sourceDetail: null,
    dealVolume: c.deal_volume,
    showStatus: c.show_status,
    assignee: resolveAssignee(c, names),
    terminal: TERMINAL_CLOSING_STATUS.includes(c.status),
    cancelled,
    lockedReason: moveLockReason("closing", c.status, cancelled),
  };
}

/**
 * Beide Tabellen zu einer Event-Liste normalisieren und in „mit Termin" /
 * „ohne Termin" trennen. Calls ohne Zeitpunkt haben keinen Platz im Raster,
 * dürfen aber nicht verschwinden → eigener Abschnitt in der Listenansicht.
 */
export function buildEvents(
  settings: WithCancellation<SettingCall>[],
  closings: WithCancellation<ClosingCall>[],
  names: UsernameById,
): { events: TerminEvent[]; ohneTermin: TerminEvent[] } {
  const all = [
    ...settings.map((c) => fromSetting(c, names)),
    ...closings.map((c) => fromClosing(c, names)),
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
