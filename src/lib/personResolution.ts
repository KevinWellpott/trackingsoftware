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
