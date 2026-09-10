// „Du bist dran" — EINE Regel, zwei Arbeitslisten.
//
// DAS PROBLEM, das diese Datei löst: Die LinkedIn-Liste (`ListBoardV2`) und die
// Termin-Liste (`TermineList`) beantworten dieselbe Frage — „muss ich diese
// Zeile heute anfassen?" — und beantworteten sie bis hierher jede für sich. Die
// eine in einer privaten Funktion im Board, die andere als Ausdruck mitten im
// Render. Zwei Formulierungen derselben Bedeutung laufen auseinander; genau
// diesen Fehler hat das Projekt an `nachfassen_tasks` vs. `isDueFollowUp` schon
// einmal bezahlt (docs §5.4: „Ein Badge, das eine Dringlichkeit behauptet, die
// die Seite darunter nicht kennt, ist schlimmer als gar kein Badge").
//
// Was hier GETEILT ist, ist die Definition und die Farbe:
//   Eine Zeile leuchtet GOLD, wenn sie in der Arbeitsmenge liegt und heute noch
//   niemand an ihr war. Gold heißt ausnahmslos „du bist dran" — nichts anderes.
//
// Was NICHT geteilt werden kann, ist die Bedingung selbst: Ein LinkedIn-Kontakt
// steht über seine Fälligkeit in der Arbeitsmenge (der Erledigt-Klick schiebt
// sie weiter, die Zeile beruhigt sich also von selbst), ein Termin über seinen
// abgeleiteten Zustand plus den Nachfass-Stempel. Beide Bedingungen stehen
// deshalb hier nebeneinander statt in einer künstlichen Vereinigung: Ein
// gemeinsamer Union-Typ über zwei so verschiedene Quellen wäre genau die Sorte
// Überbau, gegen die sich dieser Rückbau richtet.

import { berlinDateISO } from "@/lib/apptTime";

/**
 * Der Gold-Ton. EINE Definition für beide Listen — sonst „leuchtet" die eine
 * Liste in einem anderen Gold als die andere, und der Wiedererkennungswert,
 * der die LinkedIn-Liste zum erklärten Vorbild gemacht hat, ist weg.
 *
 * Bewusst die vorhandenen Warn-Tokens und keine neue Farbe.
 */
export const DRAN_TONE = {
  bg: "var(--warning-bg)",
  fg: "var(--warning-fg)",
  border: "var(--warning)",
} as const;

/* ------------------------------------------------------------------ *
 * LinkedIn — herausgelöst aus ListBoardV2
 * ------------------------------------------------------------------ */

/** Die Felder, an denen die LinkedIn-Fälligkeit hängt — mehr braucht die Regel nicht. */
export type FollowUpKontakt = {
  next_follow_up_at: string | null;
  answered: boolean | null;
  appointment_set: boolean | null;
  follow_up_number: number | null;
  blocked_at: string | null;
};

/**
 * Fälliges Follow-up — wortgleich die Bedingung der Kachel „Offene Follow-ups"
 * und des `nachfassen_tasks`-RPC, damit sich die Zahlen nie widersprechen.
 *
 * `is not true` statt `=== false`: `answered` und `appointment_set` sind
 * `boolean | null`, und NULL ist der NORMALFALL (frisch gepitcht = noch nichts
 * passiert, docs §7). Ein Vergleich auf `false` verlöre die Mehrheit der Zeilen.
 */
export function istKontaktDran(c: FollowUpKontakt, today: string): boolean {
  return (
    c.next_follow_up_at != null &&
    c.next_follow_up_at <= today &&
    c.answered !== true &&
    c.appointment_set !== true &&
    c.follow_up_number !== 3 &&
    c.blocked_at == null
  );
}

/* ------------------------------------------------------------------ *
 * Termine — der abgeleitete Zustand
 * ------------------------------------------------------------------ */

/**
 * Der EINE Zustand, den ein Termin in der Arbeitsliste trägt.
 *
 * ── DIE GRÖSSTE FALLE DES RÜCKBAUS ────────────────────────────────────────
 * `offen` heißt hier das GEGENTEIL des gespeicherten Werts
 * `setting_calls.status = 'offen'`. In der Datenbank heißt der „Termin steht,
 * Ergebnis fehlt" und ist der Anfangszustand jeder Zeile. Hier heißt er „es
 * steht KEIN Termin — der Mensch liegt in der Luft".
 *
 * Deshalb wird nichts umgedeutet und nichts geschrieben: Der Zustand wird bei
 * jedem Rendern aus `status`, `show_status`, `cancelled_at` und dem Zeitpunkt
 * ABGELEITET. Wer den gespeicherten Wert stattdessen übernähme, drehte die
 * Bedeutung des halben Bestands um, ohne dass irgendwo eine Zahl rot würde.
 *
 * Die Unterscheidung, auf die es dem Auftraggeber ankommt, ist die zwischen
 * `offen` und `verlegt`: „Bei Offen liegt jemand in der Luft. Bei Verlegt ist
 * er versorgt."
 */
export type TerminZustand =
  | "verlegt"
  | "offen"
  | "show"
  | "no_show"
  | "qualifiziert"
  | "closing_gelegt"
  | "nicht_qualifiziert"
  | "tot"
  | "close"
  | "kein_close";

/** Beschriftung — wörtlich die Liste des Auftraggebers, acht beim Setting, sechs beim Closing. */
export const TERMIN_ZUSTAND_LABEL: Record<TerminZustand, string> = {
  verlegt: "Verlegt",
  offen: "Offen",
  show: "Show",
  no_show: "No-Show",
  qualifiziert: "Qualifiziert",
  closing_gelegt: "Closing gelegt",
  nicht_qualifiziert: "Nicht qualifiziert",
  tot: "Tot",
  close: "Close",
  kein_close: "Kein Close",
};

/**
 * Die Arbeitsmenge: „Wer offen ist, wird JEDEN TAG kontaktiert. Er verschwindet
 * von der Liste, wenn er entweder neu terminiert ist oder als tot markiert
 * wird. Nichts anderes nimmt ihn da runter."
 *
 * Drei Zustände, und alle drei bedeuten dasselbe — es steht kein Termin:
 *  · `offen`   — nie einer gewesen, abgesagt, oder vorbei ohne Eintrag.
 *  · `no_show` — er kam nicht, und niemand hat neu terminiert.
 *  · `show`    — er kam, und danach ist nichts passiert. Auch das ist „in der
 *                Luft": Ein Erstgespräch ohne Ergebnis und ohne Folgetermin
 *                führt von allein nirgendwohin.
 *
 * `verlegt` ist bewusst NICHT dabei (er ist versorgt), und die sechs
 * Ergebnis-Zustände sind es ebenso wenig — die beenden den Vorgang oder
 * schieben ihn eine Stufe weiter, wo er seine eigene Zeile hat.
 *
 * DIE GRENZE ZUR ABLAGE LIEGT NICHT IM STATUS. Zwei Endzustände des
 * Termin-Lebenszyklus (Migration 0032) lassen `status` unangetastet und wären
 * ohne eigene Prüfung als `offen`/`no_show` in dieser Menge gelandet — siehe
 * `AUS_DEM_FUNNEL` unten.
 */
const ARBEITSMENGE: ReadonlySet<TerminZustand> = new Set<TerminZustand>(["offen", "no_show", "show"]);

export function istInArbeitsmenge(zustand: TerminZustand): boolean {
  return ARBEITSMENGE.has(zustand);
}

/** Die Rohwerte, aus denen sich der Zustand ergibt — beide Termin-Tabellen passen darauf. */
export type TerminZustandInput = {
  kind: "setting" | "closing";
  /** `setting_calls.status` bzw. `closing_calls.status`. */
  status: string;
  showStatus: "show" | "no_show" | null;
  /** `appointment_at` bzw. `call_at` (ISO-UTC), `null` = kein Termin gesetzt. */
  at: string | null;
  /** `cancelled_at` (Migration 0032) — steht in KEINEM Status (docs §3). */
  cancelledAt: string | null;
  /**
   * `cancel_outlook` (Migration 0032) — `ohne_aussicht` | `neuer_termin`.
   * Die beiden Werte trennen zwei Fälle, die nicht zusammenfallen dürfen:
   * totes Ende gegen offenen Ersatztermin (docs §4).
   */
  cancelOutlook: string | null;
  /**
   * `no_show_resolution` (Migration 0032) — `antwort` | `ohne_antwort` |
   * `ersatztermin`. `ohne_antwort` ist der einzige saubere Auslöser für die
   * Ablage-Ansicht „No-Show ohne Antwort" (docs §4).
   */
  noShowResolution: string | null;
  /**
   * `revived_at` (Migration 0032) — „die Absage ist überholt, es steht wieder
   * ein Termin". Bis zum Rückbau setzte diese Spalte KEIN Schreibpfad; sie war
   * ausdrücklich als Feld vorbereitet und als Bedienschritt offen (docs §3).
   * Der Knopf „Neuen Termin ansetzen" in der Arbeitsliste ist dieser Schritt.
   */
  revivedAt: string | null;
};

/**
 * Der Zustand, den ein aus dem Funnel gefallener Vorgang trägt — je Termin-Art
 * das vorhandene negative Ende.
 *
 * ── WARUM DAS ÜBERHAUPT NÖTIG IST ────────────────────────────────────────
 * Der Termin-Lebenszyklus aus Migration 0032 hat bewusst KEINEN neuen
 * `status`-Wert bekommen (docs §3): Eine Absage steht in `cancelled_at` +
 * `cancel_outlook`, ein No-Show ohne Antwort in `no_show_resolution` — der
 * Status bleibt in beiden Fällen `offen` bzw. der Show-Status stehen. Wer nur
 * `status` liest, hält beide für laufende Vorgänge.
 *
 * Genau das ist hier passiert: Ein „abgesagt ohne Aussicht" stand täglich gold
 * in „Zu tun" UND in der Ablage. Die eine Seite sagte „aus dem Funnel
 * gefallen", die andere „nerve ihn heute" — und es gab keinen Handgriff, der
 * das aufgelöst hätte, außer die Zeile ein zweites Mal auf Tot zu setzen.
 *
 * ── WARUM KEIN EIGENER ZUSTAND „AUSGESCHIEDEN" ───────────────────────────
 * Er wäre der elfte, und die zehn sind wörtlich die Liste des Auftraggebers.
 * Beide Fälle haben in seinen Worten längst einen Namen: Beim Erstgespräch ist
 * der Lead „Tot", beim Closing ist es „Kein Close". Beide sind ohnehin genau
 * das, was in der Ablage unter „Ausgeschieden" steht und was das Recycling
 * später wieder hervorholt.
 */
const AUS_DEM_FUNNEL: Record<TerminZustandInput["kind"], TerminZustand> = {
  setting: "tot",
  closing: "kein_close",
};

/**
 * Der abgeleitete Zustand. Reihenfolge ist hier die ganze Fachlichkeit:
 *
 *  1. ERGEBNIS SCHLÄGT ALLES. Ein toter, disqualifizierter, gewonnener oder
 *     verlorener Vorgang ist vorbei — egal welches Datum in der Zeile steht.
 *     `qualifiziert`/`closing_gelegt` beenden ihn nicht, schieben ihn aber ins
 *     Closing weiter; die Arbeit hängt ab dort an der Closing-Zeile, sonst
 *     stünde derselbe Mensch zweimal auf derselben Liste.
 *  2. ABGESAGT OHNE AUSSICHT? Dann ist er aus dem Funnel — ohne dass ein
 *     Status das sagt (`AUS_DEM_FUNNEL`). Steht vor der Termin-Frage, weil die
 *     Zeile ihr altes Datum behält; ohne `revived_at` gibt es keinen Ersatz.
 *  3. STEHT EIN TERMIN? Dann ist er versorgt. Der Zeitpunkt wird auf
 *     BERLINER KALENDERTAGE verglichen und nicht auf die Minute: Diese Liste
 *     hat Tages-Körnung wie alles außer dem Telefon-Rückruf (docs §6), und ein
 *     Termin, der heute um 10:00 war, soll nicht ab 10:01 golden mahnen —
 *     dafür gibt es den No-Show-Eintrag.
 *  4. WAS IST BEIM TERMIN PASSIERT? `show_status` ist die einzige Quelle dafür;
 *     `closing_calls` kennt gar keinen No-Show-Status (docs §4). Ein No-Show,
 *     auf den nie eine Antwort kam, ist ebenfalls aus dem Funnel — geprüft
 *     NACH der Termin-Frage, damit ein inzwischen angesetzter Ersatztermin
 *     gewinnt.
 *  5. Sonst: offen.
 */
export function terminZustand(row: TerminZustandInput, today: string): TerminZustand {
  if (row.kind === "setting") {
    if (row.status === "dead") return "tot";
    if (row.status === "unqualifiziert") return "nicht_qualifiziert";
    if (row.status === "qualifiziert") return "qualifiziert";
    if (row.status === "closing_gelegt") return "closing_gelegt";
  } else {
    if (row.status === "gewonnen") return "close";
    if (row.status === "verloren") return "kein_close";
  }

  // Abgesagt UND ohne Aussicht auf einen neuen Termin: Das ist die
  // Ablage-Ansicht „Ausgeschieden" und der Recycling-Zweig `ohne_aussicht`
  // (docs §5). `revived_at` hebt es auf — dann steht wieder ein Termin, und
  // Schritt 3 entscheidet.
  if (row.cancelledAt && row.cancelOutlook === "ohne_aussicht" && !row.revivedAt) {
    return AUS_DEM_FUNNEL[row.kind];
  }

  if (stehtNochAn(row, today)) return "verlegt";
  if (row.showStatus === "no_show") {
    // „ohne_antwort" ist die ausdrückliche Feststellung, dass nach dem No-Show
    // nichts mehr kam — dieselbe Zeile liegt in der Ablage und im Recycling.
    // „antwort" und „ersatztermin" sind dagegen laufende Vorgänge.
    return row.noShowResolution === "ohne_antwort" ? AUS_DEM_FUNNEL[row.kind] : "no_show";
  }
  if (row.showStatus === "show") return "show";
  return "offen";
}

/**
 * Steht für diesen Vorgang ein Termin? — die Frage hinter „Verlegt".
 *
 * DIE ABSAGE SCHLÄGT DAS DATUM, und das ist kein Detail, sondern der Grund,
 * warum diese Funktion existiert. `cancelAppointment` setzt `cancelled_at` und
 * lässt `appointment_at` unangetastet (0032 gibt der Absage eigene Spalten,
 * damit sie aus dem Show-Quoten-Nenner fällt, docs §3). Unmittelbar nach einer
 * Absage trägt die Zeile deshalb eine Absage UND ein Datum in der Zukunft —
 * man sagt ja ab, BEVOR der Termin ist. Wer nur auf das Datum sieht, hält einen
 * abgeräumten Termin für „versorgt" und nervt den Menschen nie wieder.
 *
 * WARUM DER NAHELIEGENDE VERGLEICH NICHT TRÄGT: „Ist das Datum jünger als die
 * Absage?" klingt nach der Auflösung, ist aber immer wahr — verglichen würden
 * ein Ereigniszeitpunkt und ein Entscheidungszeitpunkt, und der Termin liegt
 * definitionsgemäß hinter seiner Absage. Aus den beiden Spalten allein ist
 * „abgesagt, altes Datum steht noch drin" von „abgesagt, danach neu terminiert"
 * NICHT zu unterscheiden.
 *
 * Deshalb entscheidet ein drittes Feld, und zwar eines, das es dafür schon gibt:
 * `revived_at`. Es sagt ausdrücklich „die Absage ist überholt". Gesetzt wird es
 * beim Ansetzen eines neuen Termins (`setNeuerTermin`, app/actions/
 * followUpStamp.ts) — bis zum Rückbau schrieb es niemand, gelesen wurde es
 * schon (Ablage-Badge, Recycling-Riegel).
 */
function stehtNochAn(row: TerminZustandInput, today: string): boolean {
  if (!row.at) return false;
  if (row.cancelledAt && !row.revivedAt) return false;
  const tag = berlinDateISO(row.at);
  return Boolean(tag) && tag >= today;
}

/* ------------------------------------------------------------------ *
 * Der Nachfass-Stempel
 * ------------------------------------------------------------------ */

/**
 * Heute schon genervt? — `follow_up_last_contacted_at` (Migration 0041).
 *
 * Gebucketet über den Berliner Kalendertag wie alles andere (docs §6): Die
 * Frage lautet „habe ich den heute schon angefasst", nicht „liegt das weniger
 * als 24 Stunden zurück". `undefined` kommt vor, solange 0041 nicht eingespielt
 * ist — dann gibt es die Spalte nicht, und „noch nie" ist die richtige Antwort.
 */
export function istHeuteKontaktiert(stempel: string | null | undefined, today: string): boolean {
  if (!stempel) return false;
  return berlinDateISO(stempel) === today;
}

/**
 * Die Gold-Regel für einen Termin: in der Arbeitsmenge UND heute noch nicht
 * angefasst. „Die Zeile wird ruhig und leuchtet morgen wieder."
 */
export function istTerminDran(
  zustand: TerminZustand,
  stempel: string | null | undefined,
  today: string,
): boolean {
  return istInArbeitsmenge(zustand) && !istHeuteKontaktiert(stempel, today);
}
