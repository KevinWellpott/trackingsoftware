// „Setting No-Show"-Listen für Telefon und LinkedIn — die Regel.
//
// Wer aus Telefon oder LinkedIn terminiert wurde und zum Erstgespräch nicht
// erschienen ist, soll in eine eigene Liste, damit man ihn dort erneut anruft
// bzw. anschreibt. Wörtlich: „Da sollen nur Leute stehen, die terminiert worden
// sind und wo Setting auf No-Show steht."
//
// ABGELEITET, NICHT GESPEICHERT. Es gibt keine Routing-Liste und keinen
// Umzug des Leads. Die Zugehörigkeit wird bei jedem Aufruf aus dem Setting
// neu berechnet — genau wie die Ablage (docs §1). Eine gespeicherte Liste wäre
// eine zweite Wahrheit neben `setting_calls.status` und liefe beim ersten
// Ersatztermin auseinander: Der Lead stünde dann mit neuem Termin weiter in der
// No-Show-Liste. So fällt er von selbst heraus, sobald das Setting einen neuen
// Termin bekommt (Status → offen) oder beendet wird (Status → dead).
//
// Reine Funktionen ohne Datenbank, damit die Regel testbar ist. Die Abfragen
// stehen in settingNoShowData.ts.

export type NoShowSettingRow = {
  id: string;
  /** `source_phone_lead_id` bzw. `source_contact_id` — je nach Kanal. */
  source_id: string;
  status: string | null;
  no_show_resolution: string | null;
  appointment_at: string | null;
  created_at: string;
};

/**
 * Steht dieses Setting auf No-Show?
 *
 * `status='no_show'` ist der Wert, den „Nicht erschienen" schreibt
 * (`setSettingOutcome`). Er fällt beim Ersatztermin (`rescheduleSetting` → offen)
 * und bei „Tot" (→ dead) von selbst weg.
 *
 * Ausgenommen: `no_show_resolution='ohne_antwort'`. Den Fall führt die
 * Arbeitsliste bereits als „Tot" und die Ablage unter „Ausgeschieden"
 * (docs §1, Schritt 4). Ihn hier zusätzlich als „nochmal anrufen" zu führen,
 * wäre derselbe Widerspruch, der dort einmal gestanden hat: eine Seite sagt
 * „aus dem Funnel gefallen", die andere „ruf ihn an".
 */
export function istSettingNoShow(row: Pick<NoShowSettingRow, "status" | "no_show_resolution">): boolean {
  return row.status === "no_show" && row.no_show_resolution !== "ohne_antwort";
}

/**
 * Je Lead das JÜNGSTE Setting — und davon nur die, die auf No-Show stehen.
 *
 * Der jüngste, weil derselbe Lead nach einer Rückholung aus der Ablage zwei
 * Settings tragen kann (docs §3, `revived_at`). Maßgeblich ist der laufende
 * Anlauf: Ein alter No-Show, auf den längst ein neuer Termin folgte, gehört
 * nicht in die Liste.
 */
export function noShowJeLead(rows: NoShowSettingRow[]): Map<string, NoShowSettingRow> {
  const juengstes = new Map<string, NoShowSettingRow>();
  for (const r of rows) {
    const bisher = juengstes.get(r.source_id);
    if (!bisher || r.created_at > bisher.created_at) juengstes.set(r.source_id, r);
  }
  const ergebnis = new Map<string, NoShowSettingRow>();
  for (const [lead, r] of juengstes) if (istSettingNoShow(r)) ergebnis.set(lead, r);
  return ergebnis;
}
