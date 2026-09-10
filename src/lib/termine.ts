// Gemeinsames Event-Modell für den Termine-Kalender: Setting- und Closing-Calls
// werden auf eine Struktur normalisiert, damit Monat/Woche/Tag/Liste nur noch
// einen Typ kennen.
//
// Wichtig: Das Layout rechnet ausschließlich mit `dayISO` (Berlin-Kalendertag)
// + Minuten ab Mitternacht. Innerhalb des Grids gibt es damit keine Date- oder
// Zeitzonen-Arithmetik mehr — Sommer-/Winterzeit kann nirgends durchschlagen.

import { toBerlinSlot } from "@/lib/apptTime";
import { istTerminDran, terminZustand, type TerminZustand } from "@/lib/dranRegel";
import { personOf, type AssignableRow } from "@/lib/personResolution";
import {
  moveLockReason,
  outlineFor,
  TERMINAL_CLOSING_STATUS,
  TERMINAL_SETTING_STATUS,
  zustandPill,
  type EventOutline,
  type Pill,
  type ShowStatus,
} from "@/lib/terminMeta";
import type { ClosingCall, SettingCall } from "@/lib/types";

/**
 * Die Spalten aus dem Termin-Lebenszyklus, die der geteilte Typ nicht trägt —
 * als OPTIONALE Felder daneben (Muster `AppointmentLifecycle`,
 * components/termine/lifecycleMeta.ts).
 *
 * Die Kalender-Abfrage lädt mit `select("*")`, die Werte sind zur Laufzeit also
 * längst da; `SettingCall`/`ClosingCall` tragen dagegen die Achsen sämtlicher
 * Auswertungen und sollen nicht bei jedem Lebenszyklus-Feld wachsen. Optional
 * deklariert, damit die Seite unverändert `SettingCall[]` übergeben kann.
 *
 * DAS `select("*")` IST HIER KEIN DETAIL, SONDERN DER RÜCKFALL: Die beiden
 * Nachfass-Spalten kommen aus Migration 0041, und die ist geschrieben, aber
 * noch nicht eingespielt. Bei einer NAMENTLICH selektierten Spalte wiese
 * PostgREST die gesamte Abfrage ab — die Seite wäre leer statt unvollständig
 * (dieselbe Falle wie bei 0029/0032, docs §7). Ein `select("*")` liefert
 * stattdessen einfach zwei Felder weniger, `undefined` heißt dann „noch nie
 * nachgefasst", und die Zeile leuchtet weiter. Deshalb darf die Termine-Seite
 * NIE auf eine Spaltenliste umgestellt werden, solange 0041 nicht überall läuft.
 */
export type WithCancellation<T> = T & {
  cancelled_at?: string | null;
  /**
   * Migration 0032 — „die Absage ist überholt, es steht wieder ein Termin".
   * Wird seit dem Rückbau von `setNeuerTermin` geschrieben; davor las die App
   * die Spalte nur (Ablage-Badge, Recycling-Riegel).
   */
  revived_at?: string | null;
  /** Migration 0041 — wann zuletzt genervt wurde. `undefined` = Spalte fehlt noch. */
  follow_up_last_contacted_at?: string | null;
  /** Migration 0041 — wer gestempelt hat. AUDIT-Feld, KEINE Zuständigkeit (docs §2). */
  follow_up_last_contacted_by_user_id?: string | null;
};

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
  /**
   * Der ABGELEITETE Zustand — die eine Aussage je Zeile (src/lib/dranRegel.ts).
   * Steht in keiner Spalte und wird nirgends geschrieben.
   */
  zustand: TerminZustand;
  statusPill: Pill;
  /**
   * „Du bist dran" — die Zeile liegt in der Arbeitsmenge und heute war noch
   * niemand an ihr. Die eine Eigenschaft, die in der Liste GOLD leuchtet.
   */
  dran: boolean;
  /** Migration 0041: wann zuletzt genervt wurde; `null` = noch nie (oder Spalte fehlt). */
  lastContactedAt: string | null;
  /**
   * WER zuletzt genervt hat. Beantwortet die Frage, die zu dritt täglich
   * anfällt: „Hast du den angerufen oder ich?" — ein AUDIT-Name, keine
   * Zuständigkeit; die steht in `assignee` (docs §2).
   */
  lastContactedBy: string | null;
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

/** Ein reiner Anzeigename ohne Zuständigkeits-Anspruch — für den Stempler. */
function resolveUsername(userId: string | null | undefined, names: UsernameById): string | null {
  if (!userId) return null;
  return names.get(userId) ?? UNKNOWN_USERNAME;
}

function fromSetting(c: WithCancellation<SettingCall>, names: UsernameById, today: string): TerminEvent {
  const slot = c.appointment_at ? toBerlinSlot(c.appointment_at) : null;
  const cancelled = Boolean(c.cancelled_at);
  const zustand = terminZustand(
    {
      kind: "setting",
      status: c.status,
      showStatus: c.show_status,
      at: c.appointment_at,
      cancelledAt: c.cancelled_at ?? null,
      revivedAt: c.revived_at ?? null,
    },
    today,
  );
  const lastContactedAt = c.follow_up_last_contacted_at ?? null;
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
    zustand,
    statusPill: zustandPill(zustand),
    dran: istTerminDran(zustand, lastContactedAt, today),
    lastContactedAt,
    lastContactedBy: resolveUsername(c.follow_up_last_contacted_by_user_id, names),
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

function fromClosing(c: WithCancellation<ClosingCall>, names: UsernameById, today: string): TerminEvent {
  const slot = c.call_at ? toBerlinSlot(c.call_at) : null;
  const cancelled = Boolean(c.cancelled_at);
  const zustand = terminZustand(
    {
      kind: "closing",
      status: c.status,
      showStatus: c.show_status,
      at: c.call_at,
      cancelledAt: c.cancelled_at ?? null,
      revivedAt: c.revived_at ?? null,
    },
    today,
  );
  const lastContactedAt = c.follow_up_last_contacted_at ?? null;
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
    zustand,
    statusPill: zustandPill(zustand),
    dran: istTerminDran(zustand, lastContactedAt, today),
    lastContactedAt,
    lastContactedBy: resolveUsername(c.follow_up_last_contacted_by_user_id, names),
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
 * dürfen aber nicht verschwinden → eigener Abschnitt in der Arbeitsliste.
 *
 * `today` (Berliner Kalendertag) ist Pflicht und kein Vorgabewert: Zustand und
 * Gold-Regel hängen daran, und eine Funktion, die sich ihr „heute" selbst holt,
 * liefert je nach Aufrufzeitpunkt ein anderes Ergebnis — im Test wie im
 * Server-Render.
 */
export function buildEvents(
  settings: WithCancellation<SettingCall>[],
  closings: WithCancellation<ClosingCall>[],
  names: UsernameById,
  today: string,
): { events: TerminEvent[]; ohneTermin: TerminEvent[] } {
  const all = [
    ...settings.map((c) => fromSetting(c, names, today)),
    ...closings.map((c) => fromClosing(c, names, today)),
  ];
  const events: TerminEvent[] = [];
  const ohneTermin: TerminEvent[] = [];
  for (const e of all) (e.dayISO ? events : ohneTermin).push(e);

  events.sort((a, b) => (a.dayISO === b.dayISO ? a.startMin - b.startMin : a.dayISO!.localeCompare(b.dayISO!)));
  ohneTermin.sort((a, b) => a.title.localeCompare(b.title, "de"));
  return { events, ohneTermin };
}

/**
 * Ein fälliger Telefon-Rückruf — die dritte Ansicht dieser Seite.
 *
 * Er steht hier und nicht bei den Terminen, weil er eine andere ZEITKÖRNUNG
 * hat: Der Rückruf ist die einzige Aufgabe der ganzen Software mit einer MIT
 * DEM LEAD VERABREDETEN Uhrzeit (`DueGranularity: "moment"`, docs §1/§6) —
 * alles andere in dieser Liste ist tagesgenau. Ihn mit den Terminen in EINE
 * Tabelle zu mischen hieße, entweder seine Uhrzeit oder die Tages-Körnung der
 * anderen zu verlieren; deshalb ein eigener Reiter statt einer sechsten Spalte.
 *
 * Er trägt bewusst KEINEN Nachfass-Stempel: Migration 0041 legt die beiden
 * Spalten nur auf den Termin-Tabellen an. Ein Rückruf verschwindet ohnehin
 * nicht durchs Abhaken, sondern durch das Gespräch — der Weg dorthin ist der
 * Call-Modus in seiner Liste.
 */
export type RueckrufAufgabe = {
  /** `phone_leads.id`. */
  id: string;
  company: string | null;
  decider: string | null;
  phone: string | null;
  /** `callback_at` (ISO-UTC) — eine echte Uhrzeit, keine Tagesfrist. */
  callbackAt: string;
  listId: string | null;
  listName: string | null;
  /**
   * Zuständig ist der LISTEN-Owner (`list_owned_by_user()`, docs §2) — die
   * zweite Personenachse neben `personOf()`. `owner_name` hat Vorrang vor dem
   * Ersteller; zeigt er auf niemanden in dieser Organisation, bleibt hier
   * `null` und die Zeile fällt aus jeder persönlichen Liste heraus, statt dem
   * Admin zugeschrieben zu werden, der die Liste angelegt hat.
   */
  ownerUserId: string | null;
  ownerName: string | null;
};

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
