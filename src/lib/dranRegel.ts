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
// Seit der Erinnerungs-Runde steht hier eine zweite Frage daneben: WANN vor
// einem Termin muss angekündigt werden? Zwei feste Zeitpunkte, aus dem Termin
// gerechnet (Abschnitt „Die zwei festen Erinnerungen"). Sie steht hier, weil sie
// dieselbe Antwort färbt — auch ein Termin mit offener Erinnerung leuchtet Gold,
// und Gold darf nur an einer Stelle definiert sein.
//
// Was NICHT geteilt werden kann, ist die Bedingung selbst: Ein LinkedIn-Kontakt
// steht über seine Fälligkeit in der Arbeitsmenge (der Erledigt-Klick schiebt
// sie weiter, die Zeile beruhigt sich also von selbst), ein Termin über seinen
// abgeleiteten Zustand plus den Nachfass-Stempel. Beide Bedingungen stehen
// deshalb hier nebeneinander statt in einer künstlichen Vereinigung: Ein
// gemeinsamer Union-Typ über zwei so verschiedene Quellen wäre genau die Sorte
// Überbau, gegen die sich dieser Rückbau richtet.

import { berlinDateISO, berlinInputToIso, isoToBerlinInput } from "@/lib/apptTime";

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
 *
 * ── DER SCHLÜSSEL `verlegt` BLEIBT, SEINE BESCHRIFTUNG NICHT ──────────────
 * Auf dem Bildschirm heißt dieser Zustand seit der Erinnerungs-Runde „Termin
 * steht". Grund war ein konkreter Fehlgriff: Der Auftraggeber suchte seine
 * Termine der nächsten Woche im gleichnamigen Ausschnitt und fand sie nicht,
 * weil „Verlegt" nach „wurde verschoben" klingt — tatsächlich steht dort JEDER
 * Termin mit einem Datum in der Zukunft, auch ein nie verschobener.
 *
 * Der SCHLÜSSEL wandert bewusst nicht mit: Er beschreibt die Datenlage korrekt
 * („ein Termin ist gelegt") und steht in jeder Invarianten-Prüfung. Ein
 * Schlüssel, den niemand sieht, gewinnt nichts durch eine schönere Schreibweise.
 *
 * ── ZUSTAND UND AUSSCHNITT SIND SEITHER ZWEIERLEI ────────────────────────
 * Eine Runde lang waren sie dasselbe: Der Ausschnitt der Arbeitsliste hieß
 * `verlegt` und trug das Wort dieses Zustands. Seit der Aufteilung in „Erinnerung
 * Setting" und „Erinnerung Closing" heißt der Ausschnitt nach seiner AUFGABE
 * (dort wird erinnert, zweimal), dieser Zustand weiter nach der DATENLAGE (ein
 * Termin steht) — zwei Fragen, zwei Wörter. Die Ausschnitt-Schlüssel liegen
 * ausschließlich in `components/termine/viewState.ts`; von diesem Typ hängen
 * sie nicht mehr ab.
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

/**
 * Beschriftung — wörtlich die Liste des Auftraggebers, acht beim Setting, sechs
 * beim Closing. Einzige Abweichung: `verlegt` heißt auf dem Bildschirm „Termin
 * steht" (Begründung am Typ oben).
 *
 * Diese Wörter beschreiben ZEILEN, nicht Ansichten. Die Ausschnitte der
 * Arbeitsliste heißen nach ihrer Aufgabe und stehen in `viewState.ts`; sie aus
 * dieser Tabelle zu speisen war eine Runde lang richtig und ist es seit der
 * Aufteilung der Erinnerungs-Ansichten nicht mehr.
 */
export const TERMIN_ZUSTAND_LABEL: Record<TerminZustand, string> = {
  verlegt: "Termin steht",
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
 * ── EINE ZWEITE TÜR IN DIE ARBEITSLISTE, UND ZWAR NUR EINE ───────────────
 * Seit den zwei festen Erinnerungen (unten) kommt ein `verlegt` auf die Liste
 * zurück, solange eine seiner beiden Erinnerungen offen ist. Das ist KEIN
 * weiterer Zustand und keine Aufweichung der Menge hier: Der Zustand bleibt
 * `verlegt` — ein Termin steht ja —, die Erinnerung liegt als eigene Frage
 * QUER darüber. Wer beides zusammen braucht, fragt `istZuTun()`.
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

/* ------------------------------------------------------------------ *
 * Die zwei festen Erinnerungen vor einem Termin
 * ------------------------------------------------------------------ */

/**
 * „Leute die einen Termin in Zukunft haben sollen mindestens 2 mal daran
 * erinnert werden! 1 Tag vorher und 1 Stunde vorher! Egal ob Closing oder
 * Setting!"
 *
 * ── DAS IST KEINE KASKADE, UND DAS IST DER PUNKT ─────────────────────────
 * Bis zum Rückbau gab es dafür neun benannte Kaskaden, eine Stufentabelle je
 * Organisation, einen Vorlagen-Katalog, eine Kanal-Auflösung, eine eigene Seite
 * und eine eigene Tabelle für die erzeugten Fälligkeiten. Der Geschäftspartner
 * hat das zurückgewiesen („ein Produkt für eine Firma mit zwanzig Settern, wir
 * sind zu dritt"). Was hier steht, ist bewusst etwas anderes: ZWEI ZEITPUNKTE,
 * aus dem Termin gerechnet, für Erstgespräch und Closing gleich.
 *
 * Keine Tabelle, keine Migration, keine Stufennummern, keine Texte, keine
 * Kanäle — und keine Einstellung. Die beiden Zahlen stehen als Konstanten im
 * Code, wie es `CONTACT_GAP_WARN_DAYS` vorgemacht hat: Was nichts blockiert und
 * für alle gleich gilt, hat nichts zu konfigurieren.
 */
export type TerminErinnerung = "vortag" | "stunde";

/**
 * „1 Tag vorher" heißt DIESELBE UHRZEIT AM VORTAG — nicht 24 Stunden.
 *
 * Der Auftraggeber sagt „1 Tag vorher", und das ist für einen Menschen eine
 * WANDZEIT-Aussage: Der Termin am Sonntag um 10:00 wird am Samstag um 10:00
 * angekündigt. An den beiden Umstellungswochenenden ist ein Tag 23 bzw. 25
 * Stunden lang; eine Millisekunden-Rechnung landete dort auf 09:00 bzw. 11:00 —
 * eine Uhrzeit, die niemand gemeint hat, ausgerechnet an dem Wochenende, an dem
 * ohnehin alle durcheinanderkommen. Gerechnet wird deshalb über die Ziffern der
 * Berliner Wandzeit und zurück durch `berlinInputToIso()` (docs §6: dieselbe
 * Überlegung trug schon die Kaskaden-Engine und trägt heute den Tagesvergleich
 * der Arbeitsliste).
 *
 * „1 Stunde vorher" ist dagegen eine DAUER und bleibt eine: Eine Stunde ist
 * sechzig Minuten, auch am Umstellungssonntag. Wollte man sie als Wandzeit
 * rechnen, müsste man im Frühjahr eine Uhrzeit bilden, die es nicht gibt
 * (02:30). Die beiden Zahlen sind also absichtlich verschieden gemeint — und
 * genau deshalb stehen ihre Einheiten in den Namen.
 */
export const ERINNERUNG_VORTAG_TAGE = 1;
export const ERINNERUNG_KURZ_MINUTEN = 60;

const MINUTE_MS = 60_000;

/** Die beiden Marken eines Termins, als Zeitpunkte (ms) neben dem Termin selbst. */
export type ErinnerungsZeitpunkte = { termin: number; vortag: number; stunde: number };

/**
 * Wann die beiden Erinnerungen dieses Termins erreicht sind.
 *
 * REIHENFOLGE IST ZUGESICHERT: `vortag` liegt 23 bis 25 Stunden vor dem Termin,
 * `stunde` genau eine — die Marken können sich also nie überholen. Darauf ruht
 * der ganze Mechanismus eine Ebene tiefer (`offeneErinnerung`): Weil sie
 * hintereinander liegen, schließt EIN Stempel genau die gerade fällige
 * Erinnerung und lässt die spätere unberührt.
 */
export function erinnerungsZeitpunkte(at: string | null | undefined): ErinnerungsZeitpunkte | null {
  if (!at) return null;
  const termin = Date.parse(at);
  if (Number.isNaN(termin)) return null;

  // ISO → Berliner Wandzeit → Kalenderarithmetik auf den Ziffern → zurück nach
  // UTC. Der Umweg über `Date.UTC` ist reine Ziffernrechnung auf dem
  // TAGESSTRING (Monats- und Jahreswechsel inklusive) und fasst keine Zeitzone
  // an; die einzige Zonen-Umrechnung macht `berlinInputToIso()`.
  const wandzeit = isoToBerlinInput(at);
  const [tag, uhrzeit] = wandzeit.split("T");
  if (!tag || !uhrzeit) return null;
  const [jahr, monat, tagZahl] = tag.split("-").map(Number);
  const vortagsTag = new Date(Date.UTC(jahr, monat - 1, tagZahl - ERINNERUNG_VORTAG_TAGE))
    .toISOString()
    .slice(0, 10);
  const vortagIso = berlinInputToIso(`${vortagsTag}T${uhrzeit}`);
  if (!vortagIso) return null;

  return {
    termin,
    vortag: Date.parse(vortagIso),
    stunde: termin - ERINNERUNG_KURZ_MINUTEN * MINUTE_MS,
  };
}

/**
 * Der Stand EINER der beiden Erinnerungen.
 *
 *  · `ausstehend` — die Marke ist noch nicht erreicht. Nichts zu tun.
 *  · `offen`      — die Marke ist erreicht und seither war niemand dran.
 *  · `erledigt`   — der Nachfass-Stempel liegt auf oder hinter der Marke.
 *
 * EIN VIERTER WERT „VERSÄUMT" FEHLT MIT ABSICHT, und das ist dieselbe
 * Entscheidung wie in `dueState.ts`: Es gibt keinen Zeitpunkt, an dem eine
 * Erinnerung zu spät wäre und trotzdem noch etwas zu tun bliebe. Ab dem Termin
 * verschwinden beide Stufen (s. u.); davor ist „offen" die richtige Aussage —
 * auch dann, wenn die Marke schon im Moment des Buchens vorbei war. Genau daran
 * ist das Vorgängersystem zurückgewiesen worden.
 */
export type ErinnerungsStand = "ausstehend" | "offen" | "erledigt";

/**
 * Eine der zwei Stufen mit Nummer, Marke und Stand.
 *
 * Die NUMMER ist die Zusicherung, die der Auftraggeber verlangt hat („wichtig
 * ist, dass ich jeden 2 mal erinnere") — sie macht aus einer inneren Regel eine
 * Zahl, die auf dem Bildschirm abzählbar ist. Sie ist bewusst nicht aus dem
 * Zustand abgeleitet, sondern fest: Stufe 1 ist immer der Vortag, Stufe 2 immer
 * die Stunde davor, auch wenn die erste bei einem kurzfristig gebuchten Termin
 * im selben Moment fällig wird wie die Zeile entsteht.
 */
export type ErinnerungsStufe = {
  /** 1 = am Vortag, 2 = eine Stunde vorher. */
  nr: 1 | 2;
  marke: TerminErinnerung;
  /** Zeitpunkt der Marke (ms) — für die Beschriftung, nicht für die Regel. */
  at: number;
  stand: ErinnerungsStand;
};

/**
 * Beide Erinnerungen dieses Termins mit ihrem Stand — `null` heißt „hier ist
 * nichts anzukündigen".
 *
 * DIE EINE DEFINITION. `offeneErinnerung()` weiter unten ist nur noch die Frage
 * „und welche davon ist gerade dran?" an dieses Ergebnis; die Bedingung steht
 * kein zweites Mal da. Vorher gab es sie nur in der zugespitzten Form, und die
 * Oberfläche konnte deshalb nicht zeigen, was der Auftraggeber sehen will:
 * nicht bloß „jetzt leuchtet es", sondern „die erste ist raus, die zweite
 * kommt noch".
 *
 * ── WAS KEINE ERINNERUNG BEKOMMT ─────────────────────────────────────────
 * Alles, was nicht `verlegt` ist — und das ist kein Kurzschluss, sondern
 * derselbe Riegel, den `terminZustand()` ohnehin zieht: Abgesagt (ohne
 * `revived_at`), abgesagt ohne Aussicht, tot, unqualifiziert, gewonnen,
 * verloren, ins Closing weitergeschoben, No-Show ohne Antwort und „es steht gar
 * kein Termin" führen alle NICHT auf `verlegt`. Eine zweite Prüfung derselben
 * Fälle wäre eine zweite Definition von „der Termin findet statt" — und die
 * liefe beim nächsten Lebenszyklus-Feld auseinander.
 *
 * Dazu der Termin selbst: Ab seinem Zeitpunkt gibt es nichts mehr anzukündigen.
 * `verlegt` reicht dafür nicht, weil es auf Kalendertage schaut — ein Termin von
 * heute 10:00 ist um 14:00 noch immer `verlegt` (docs §6), aber erinnern kann
 * man an ihn nicht mehr.
 *
 * `nowMs === null` heißt „die Uhr steht noch nicht" (die Oberfläche führt sie
 * per Effekt nach, Muster `RueckrufListe`) und liefert bewusst nichts: lieber
 * eine Sekunde ohne Gold als eine falsche.
 */
export function erinnerungsStand(
  zustand: TerminZustand,
  at: string | null,
  stempel: string | null | undefined,
  nowMs: number | null,
): ErinnerungsStufe[] | null {
  if (nowMs == null || zustand !== "verlegt") return null;
  const marken = erinnerungsZeitpunkte(at);
  if (!marken || nowMs >= marken.termin) return null;

  const gestempelt = stempel ? Date.parse(stempel) : Number.NaN;
  // `!(gestempelt >= marke)` statt `gestempelt < marke`: Ohne Stempel ist der
  // Wert NaN, und JEDER Vergleich mit NaN ist falsch — `<` läse „schon
  // erledigt", die Verneinung von `>=` liest „noch offen". Das ist der richtige
  // Rückfall: kein Stempel heißt, es war noch niemand dran.
  const stand = (marke: number): ErinnerungsStand =>
    nowMs < marke ? "ausstehend" : !(gestempelt >= marke) ? "offen" : "erledigt";

  return [
    { nr: 1, marke: "vortag", at: marken.vortag, stand: stand(marken.vortag) },
    { nr: 2, marke: "stunde", at: marken.stunde, stand: stand(marken.stunde) },
  ];
}

/**
 * Welche Stufe ist gerade dran? — DIE SPÄTERE ZUERST.
 *
 * Liegt der Termin in einer halben Stunde und hat noch niemand angekündigt, ist
 * „1 Stunde vorher" die Aussage, die zählt; die Vortags-Marke ist dann längst
 * Geschichte. Rückwärts durch die Liste zu gehen ist deshalb kein Stilmittel,
 * sondern die Fachlichkeit.
 */
export function offeneStufe(stufen: readonly ErinnerungsStufe[] | null): TerminErinnerung | null {
  if (!stufen) return null;
  for (let i = stufen.length - 1; i >= 0; i--) {
    if (stufen[i].stand === "offen") return stufen[i].marke;
  }
  return null;
}

/**
 * Welche der beiden Erinnerungen ist gerade offen? — `null` heißt „keine".
 *
 * ── DIE BEDINGUNG ────────────────────────────────────────────────────────
 * Eine Erinnerung ist offen, wenn ihr Zeitpunkt ERREICHT ist und der
 * Nachfass-Stempel älter ist als dieser Zeitpunkt (oder fehlt).
 *
 * ── EIN STEMPEL, ZWEI ERINNERUNGEN ───────────────────────────────────────
 * Das trägt, weil die Marken hintereinander liegen (s. o.) und der Stempel
 * gegen die MARKE geprüft wird, nicht gegen den Kalendertag. Wer am Vortag auf
 * „Genervt" klickt, stempelt auf jetzt — jetzt ist größer als die Vortags-Marke
 * (sie war ja erreicht) und kleiner als die Stunden-Marke (die liegt frühestens
 * 22 Stunden später). Genau die fällige Erinnerung ist damit geschlossen, die
 * nächste geht von allein wieder auf.
 *
 * DESHALB GILT HIER `istHeuteKontaktiert()` NICHT. Ein Stempel von heute früh
 * schließt die Erinnerung eine Stunde vor dem Termin von heute Abend NICHT —
 * sonst könnte man die zweite Erinnerung dadurch verlieren, dass man die erste
 * am selben Tag erledigt hat. Der Kalendertag ist die richtige Körnung für „wer
 * liegt in der Luft"; für einen Zeitpunkt ist er es nicht.
 *
 * Wer beide Stufen samt Stand braucht (die Ansicht „Termin-Erinnerung" tut das),
 * fragt `erinnerungsStand()` direkt und spart sich die zweite Rechnung.
 */
export function offeneErinnerung(
  zustand: TerminZustand,
  at: string | null,
  stempel: string | null | undefined,
  nowMs: number | null,
): TerminErinnerung | null {
  return offeneStufe(erinnerungsStand(zustand, at, stempel, nowMs));
}

/**
 * Was die Zeile sagt, wenn sie wegen einer Erinnerung leuchtet.
 *
 * ── JEDER SATZ IST ZUM ZEITPUNKT SEINER ANZEIGE WAHR ─────────────────────
 * Naheliegend wäre gewesen, die Marke zu benennen („1 Tag vorher"). Das wäre
 * bei kurzfristig gebuchten Terminen gelogen: Wer heute um 14:00 einen Termin
 * für heute 18:00 anlegt, hat die Vortags-Marke längst überschritten — „1 Tag
 * vorher" stünde dann über einem Termin in vier Stunden. Beschriftet wird
 * deshalb die LAGE, nicht die Stufe, und die Vortags-Marke liegt höchstens 25
 * Stunden vor dem Termin: Er ist damit zwingend heute oder morgen.
 *
 * ── UND KEIN SATZ IST EIN VORWURF ────────────────────────────────────────
 * Hier steht bewusst kein „überfällig" und kein „seit … offen" (siehe die
 * Anmerkung in src/lib/dueState.ts). Eine Erinnerung, deren Marke beim Buchen
 * schon vorbei war, ist kein Versäumnis — sie ist eine Bestätigung, die jetzt
 * rausgeht.
 */
export function erinnerungText(
  erinnerung: TerminErinnerung,
  /** Berliner Kalendertag des Termins (`TerminEvent.dayISO`). */
  terminTag: string | null,
  today: string,
): string {
  if (erinnerung === "stunde") return "Termin in weniger als einer Stunde";
  return terminTag === today ? "Termin heute" : "Termin morgen";
}

/* ------------------------------------------------------------------ *
 * Gold und Ausschnitt
 * ------------------------------------------------------------------ */

/**
 * Steht die Zeile im Ausschnitt „Zu tun"? — die Arbeitsmenge PLUS die Termine
 * mit offener Erinnerung.
 *
 * „Zu tun" überschneidet sich damit mit den beiden Erinnerungs-Ausschnitten,
 * und das ist gewollt: Ein Termin, der morgen ansteht und heute angekündigt
 * werden muss, ist beides — versorgt UND heute anzufassen. Ihn aus seiner
 * Erinnerungs-Ansicht zu nehmen hieße, ihn genau dort verschwinden zu lassen,
 * wo man ihn abarbeitet.
 */
export function istZuTun(zustand: TerminZustand, erinnerung: TerminErinnerung | null): boolean {
  return istInArbeitsmenge(zustand) || erinnerung !== null;
}

/**
 * Trägt die Zeile die drei Handgriffe (genervt · Termin · tot)?
 *
 * ── WARUM DAS NICHT DIESELBE FRAGE IST WIE „LEUCHTET SIE?" ───────────────
 * `istZuTun` beantwortet „ist HEUTE etwas zu tun" und wird deshalb im Laufe des
 * Tages falsch: Wer morgens auf „Genervt" klickt, hat mittags eine Zeile ohne
 * einen einzigen Knopf vor sich. Für die Arbeitsmenge war das hinnehmbar (sie
 * leuchtet morgen wieder); für einen STEHENDEN Termin war es der Fehler, den der
 * Auftraggeber gemeldet hat: In der Ansicht „Termin-Erinnerung" stand in der
 * Spalte Aktion durchgehend ein Strich, obwohl genau dort umterminiert und
 * abgeschrieben wird.
 *
 * Die Menge ist deshalb eine andere und hängt an NICHTS AUSSER DEM ZUSTAND:
 * Arbeitsmenge plus jeder stehende Termin — also alles, was noch laufen kann.
 * Draußen bleiben nur die sechs Ergebnis-Zustände; wer die wieder aufmachen
 * will, tut das auf der Detailseite, wo die Folgen erklärt sind.
 */
export function istBearbeitbar(zustand: TerminZustand): boolean {
  return istInArbeitsmenge(zustand) || zustand === "verlegt";
}

/**
 * Die Gold-Regel für einen Termin: in der Arbeitsmenge UND heute noch nicht
 * angefasst. „Die Zeile wird ruhig und leuchtet morgen wieder."
 *
 * Eine offene Erinnerung schlägt beides: Sie hat ihre eigene, schärfere
 * Stempel-Prüfung (gegen die Marke statt gegen den Kalendertag, siehe
 * `offeneErinnerung`) — der Tagesvergleich hier würde sie nur wieder
 * aufweichen.
 */
export function istTerminDran(
  zustand: TerminZustand,
  stempel: string | null | undefined,
  today: string,
  erinnerung: TerminErinnerung | null = null,
): boolean {
  if (erinnerung !== null) return true;
  return istInArbeitsmenge(zustand) && !istHeuteKontaktiert(stempel, today);
}
