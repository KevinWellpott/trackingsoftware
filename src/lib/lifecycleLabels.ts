// Deutsche Beschriftungen fuer die Vorschauen des Mandanten-Lebenszyklus
// (Organisation loeschen, Nutzer verschieben) — an EINER Stelle.
//
// Beide Vorschauen kommen als jsonb aus der Datenbank und tragen deshalb
// TECHNISCHE Schluessel (`reminder_touches`, `message_templates`, …). Die Map
// lag vorher modul-privat und doppelt in DeleteOrgButton.tsx und
// MoveUserButton.tsx — jede neue Migration musste sie an zwei Stellen
// nachziehen, und genau das ist zweimal ausgeblieben (0031/0032 brachten fuenf
// neue Zaehler, 0036 nennt sie in der Vorschau). Ein roher Tabellenname in
// einer LOESCHvorschau liest sich wie ein Fehler und beschaedigt das Vertrauen
// in die Zahl daneben, die dort unwiderruflich ist.
//
// Diese Datei traegt bewusst KEIN "use client" — beide Dialoge sind Client
// Components, eine spaetere Server-Ansicht koennte dieselben Labels brauchen
// (Vorbild: settingLabels.ts).

/**
 * Technischer Schluessel aus `counts` -> deutsche Beschriftung.
 *
 * Bewusst EINE Map fuer beide Vorschauen: Die Loeschvorschau zaehlt mehr
 * Tabellen als der Umzug (z. B. `call_assignees`, `pipeline_settings`), aber
 * ein Schluessel, den die jeweilige RPC gar nicht liefert, wird auch nie
 * gerendert. Zwei getrennte Maps waeren nur zwei Stellen, die auseinanderlaufen
 * koennen.
 */
export const COUNT_LABELS: Record<string, string> = {
  lists: "LinkedIn-Listen",
  contacts: "Kontakte",
  list_views: "Smart Views",
  phone_lists: "Telefonlisten",
  phone_leads: "Telefon-Leads",
  phone_call_attempts: "Anwahlen",
  csv_imports: "CSV-Importe",
  setting_calls: "Setting-Termine",
  closing_calls: "Closing-Termine",
  call_assignees: "Zuweisungen",
  organic_lists: "Organic-Listen",
  organic_posts: "Organic-Posts",
  performance_targets: "Ziele",
  followup_templates: "FU-Vorlagen",
  message_templates: "Nachrichtenvorlagen",
  pipeline_settings: "Pipeline-Einstellungen",
  cascade_steps: "Kaskaden-Stufen",
  reminder_touches: "Erinnerungen",
};

/**
 * Letzte Rettung fuer einen Schluessel, den diese Datei noch nicht kennt:
 * Unterstriche zu Leerzeichen, erster Buchstabe gross. Aus `reminder_touches`
 * wird so wenigstens „Reminder touches" statt eines Bezeichners mit
 * Unterstrichen.
 *
 * Das ersetzt keine echte Beschriftung — es haelt nur die naechste Migration
 * davon ab, dieselbe Luecke noch einmal aufzureissen. Ein unbekannter Zaehler
 * ist in einer Loeschvorschau immer noch besser sichtbar als gar nicht: Die
 * Zeile darf niemals verschwinden, nur weil ihr Name fehlt.
 */
function humanizeKey(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  if (!words) return key;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Beschriftung einer Zaehler-Zeile; faellt nie auf den Rohschluessel zurueck. */
export function countLabel(key: string): string {
  return COUNT_LABELS[key] ?? humanizeKey(key);
}

/**
 * Warnungen der Umzugsvorschau bringen ihren Text bereits aus der Datenbank mit
 * (`preview_move_user` baut ihn samt Anzahl zusammen) — die UI zeigt also
 * grundsaetzlich `warning.text`. Diese Map ist der Rueckfall fuer den Fall,
 * dass eine aeltere oder neuere Fassung der Funktion einen Code OHNE Text
 * liefert: Sonst stuende dort ein Warndreieck mit leerer Zeile, und der Admin
 * bestaetigte eine Warnung, die er nie gelesen hat.
 */
const MOVE_WARNING_LABELS: Record<string, string> = {
  orphan_setting_source: "Termine verlieren ihren LinkedIn-Kontakt (Liste bleibt zurück).",
  orphan_setting_phone_source: "Termine verlieren ihren Telefon-Lead (Liste bleibt zurück).",
  split_setting_closing: "Closings verlieren ihren Setting-Bezug (anderer Ersteller).",
  assignee_dropped: "Zuweisungen an Terminen der alten Organisation werden entfernt.",
  orphan_view_parent: "Ansichten werden zum Wurzelknoten (Ordner bleibt zurück).",
  // Nachtrag 0036: Der Touch haengt an genau einem Termin. Bleibt der Termin in
  // der alten Organisation, zieht die Erinnerung nicht mit — sie wird entwertet
  // (superseded_at), damit sie in keiner Inbox mehr auftaucht.
  reminder_touch_superseded:
    "Erinnerungen an Terminen der alten Organisation bleiben zurück und werden entwertet.",
};

/** Text einer Umzugs-Warnung: DB-Text zuerst, dann Beschriftung, dann Code. */
export function moveWarningText(warning: { code: string; count: number; text?: string | null }): string {
  const fromDb = warning.text?.trim();
  if (fromDb) return fromDb;
  const label = MOVE_WARNING_LABELS[warning.code];
  // Ohne DB-Text traegt die Zeile die Anzahl selbst — sie ist die eine
  // Information, wegen der man eine Warnung ueberhaupt liest.
  return label ? `${warning.count}: ${label}` : `${humanizeKey(warning.code)}: ${warning.count}`;
}
