/**
 * Personen-Zuordnung für Setting- und Closing-Calls — EINE Quelle für alle
 * Auswertungen.
 *
 * Warum es das gibt: Vorher las jeder Analyse-Tab `created_by_user_id` direkt.
 * Das ist aber nicht "wer den Termin geholt hat", sondern "wer den Datensatz
 * angelegt hat" — und ein Closing kann nur über "Qualifiziert" im Setting
 * entstehen, wird also faktisch immer von derselben Person angelegt.
 * Verschärfend wurde dort bis Migration 0028 die eingestellte *Datensicht*
 * gespeichert statt der real angemeldeten Person.
 *
 * Ab jetzt gilt:
 *   `created_by_user_id` = Audit  (wer hat geklickt — die reale Person)
 *   `assigned_user_id`   = Fachlichkeit (wem gehört der Termin)
 *
 * Die eigentliche Auflösung (Zuweisung → Owner der Quellliste → Ersteller)
 * passiert beim SCHREIBEN in src/app/actions/appointments.ts und einmalig im
 * Backfill von Migration 0028 — nie beim Lesen. Deshalb kollabiert die
 * Leselogik hier auf eine Zeile: Es gibt keine Quellketten-Joins in den Tabs.
 *
 * Siehe docs/data-model.md §2.
 */

/** Minimalform, die für die Zuordnung reicht — passt auf SettingCall und ClosingCall. */
export type AssignableRow = {
  assigned_user_id: string | null;
  created_by_user_id: string | null;
  /**
   * „Durchgeführt von" (Migration 0042) — wer das Gespräch GEFÜHRT hat.
   * Optional, weil nicht jede Abfrage die Spalte lädt und `/termine` mit
   * `select("*")` liest: Vor 0042 fehlt das Feld dort einfach.
   */
  conducted_by_user_id?: string | null;
};

/**
 * Die zuständige Person einer Termin-Zeile.
 * @returns user_id oder `null`, wenn weder Zuweisung noch Ersteller gesetzt ist
 *          (kommt vor: `on delete set null` bei gelöschten Nutzern).
 */
export function personOf(row: AssignableRow): string | null {
  return row.assigned_user_id ?? row.created_by_user_id ?? null;
}

/**
 * Wie `personOf`, aber gegen die aktuelle Nutzerauswahl geprüft.
 *
 * Bewusst mit Rückgabewert statt Boolean: Die Tabs brauchen unmittelbar danach
 * die user_id für ihre Aggregations-Map, und ein zweiter `personOf`-Aufruf
 * wäre eine Fehlerquelle beim Umbau.
 *
 * @returns user_id, wenn die Zeile zur Auswahl gehört — sonst `null`.
 */
export function personIn(row: AssignableRow, selectedIds: Set<string>): string | null {
  const uid = personOf(row);
  if (!uid || !selectedIds.has(uid)) return null;
  return uid;
}

/**
 * Wer bekommt diese Termin-Zeile in seine ARBEITSLISTE? — wer den Termin
 * gelegt hat, mit genau einer Ausnahme.
 *
 * „Wenn ich einen Termin lege, muss ich ihn an den Termin erinnern. Wenn er
 * nicht erscheint, muss weiterhin ich ihn nerven." Die Zuweisung trägt deshalb
 * seit dem 15. September 2026 den, der gebucht hat (`assignedUserForBooking`,
 * actions/appointments.ts) — beim Closing die feste Closing-Person
 * (`CLOSING_ZUSTAENDIG_USERNAME` oben). Sie bleibt es durch No-Show und „Nicht
 * qualifiziert" hindurch.
 *
 * DIE AUSNAHME: Ist der Lead ERSCHIENEN und danach nichts passiert (`show`:
 * Erstgespräch ohne Ergebnis, Closing auf „Nachfassen"), geht die Zeile an
 * den, der das Gespräch geführt hat — er weiß, worüber gesprochen wurde.
 * Solange niemand „Durchgeführt von" eingetragen hat, bleibt sie beim
 * Erinnerer.
 *
 * `zustand` ist der abgeleitete Zustand aus `terminZustand()`
 * (src/lib/dranRegel.ts) und wird bewusst HEREINGEREICHT statt hier berechnet:
 * Die Ableitung braucht Termin, Absage und Tagesgrenze, und eine zweite
 * Rechnung an dieser Stelle liefe auseinander.
 */
export function erinnererOf(row: AssignableRow, zustand: string): string | null {
  if (zustand === "show" && row.conducted_by_user_id) return row.conducted_by_user_id;
  return personOf(row);
}

/**
 * Wem rechnet die ANALYSE diesen Termin zu? — wer das Gespräch geführt hat,
 * sonst die Zuweisung (`personOf`).
 *
 * „Wenn Kevin das Closing gemacht hat, bekommt er die Zuweisung" — gemeint
 * sind Termine, Quoten und Umsatz, nicht das Erinnern. Deshalb eine eigene
 * Funktion NEBEN `personOf`, statt sie umzudeuten: `personOf` ist wörtlich
 * `coalesce(assigned_user_id, created_by_user_id)` und steht so in RLS,
 * `rpc_appointments_booked` und `recycle_tasks` — eine Abweichung dort wäre
 * eine zweite Wahrheit zwischen SQL und App.
 *
 * NICHT hierüber läuft „Termine gelegt" (Kachel auf `/` und `/team`,
 * LinkedIn-Tab): Das ist Buchungs-Aktivität, und gebucht hat, wer gelegt hat.
 */
export function gespraechsPersonOf(row: AssignableRow): string | null {
  return row.conducted_by_user_id ?? personOf(row);
}

/** Wie `gespraechsPersonOf`, gegen die Nutzerauswahl geprüft — das Gegenstück zu `personIn`. */
export function gespraechsPersonIn(row: AssignableRow, selectedIds: Set<string>): string | null {
  const uid = gespraechsPersonOf(row);
  if (!uid || !selectedIds.has(uid)) return null;
  return uid;
}

/**
 * Wem gehört jedes CLOSING? — einer festen Person, nicht dem Setter.
 *
 * „Alle Closing-Termine sollen automatisch mir zugeordnet werden." Im Team führt
 * genau einer die Abschlussgespräche; die Erstgespräche legen die anderen. Bis
 * hierher erbte ein Closing die Zuweisung seines Settings und stand damit in der
 * persönlichen Liste des Setters, der es gar nicht führt.
 *
 * Ein Name statt einer Einstellung — dieselbe Linie wie `ERINNERUNG_VORTAG_TAGE`
 * (src/lib/dranRegel.ts): Was für alle gleich gilt und nichts blockiert, hat
 * nichts zu konfigurieren. Aufgelöst wird er gegen die Mitglieder der AKTIVEN
 * Organisation. Ist dort niemand dieses Namens — eine Kunden-Organisation, in
 * der der Plattform-Admin bewusst kein Mitglied ist (docs §2) —, gilt die alte
 * Regel weiter. Eine Zuweisung auf ein Nicht-Mitglied nullte der Guard aus
 * Migration 0040 ohnehin.
 */
export const CLOSING_ZUSTAENDIG_USERNAME = "Simon";

/**
 * Die user_id der Closing-Person unter diesen Mitgliedern — `null`, wenn sie
 * nicht dabei ist. Groß-/Kleinschreibung zählt nicht: `profiles.username` ist
 * freier Text, und „simon" statt „Simon" soll nicht lautlos die alte Regel
 * auslösen.
 */
export function closingZustaendigIn(
  members: readonly { user_id: string; username: string }[],
  username: string = CLOSING_ZUSTAENDIG_USERNAME,
): string | null {
  const wanted = username.trim().toLowerCase();
  return members.find((m) => m.username.trim().toLowerCase() === wanted)?.user_id ?? null;
}

/**
 * Auflösung eines Listen-Owners auf eine user_id — die Regel, nach der die
 * Zuweisung beim Anlegen gesetzt wird.
 *
 * `owner_name` hat Vorrang vor `created_by_user_id`: Ein Admin kann eine Liste
 * FÜR ein Mitglied anlegen; die Zahlen zählen dann beim Mitglied. Spiegelt
 * `list_owned_by_user()` (SQL) und `buildOwnScope()` (src/lib/access.ts).
 *
 * @param usernameToUserId Abbildung `profiles.username` → `user_id`, auf die
 *                         aktive Organisation beschränkt. Der Workspace-Filter
 *                         ist Pflicht: Benutzernamen sind global eindeutig,
 *                         aber ein `owner_name` kann nach einem Org-Umzug auf
 *                         einen Nutzer außerhalb dieser Organisation zeigen.
 */
export function ownerUserIdOfList(
  list: { owner_name: string | null; created_by_user_id: string | null } | null | undefined,
  usernameToUserId: Map<string, string>,
): string | null {
  if (!list) return null;
  const byName = list.owner_name ? usernameToUserId.get(list.owner_name) : undefined;
  return byName ?? list.created_by_user_id ?? null;
}
