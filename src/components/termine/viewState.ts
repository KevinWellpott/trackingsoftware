import { addDaysISO, buildWeekDays, monthLabelDe, weekStart } from "@/lib/dates";

// URL-State des Termine-Bereichs. Alles landet in der Query, damit Zurück-
// Button und geteilte Links funktionieren (Muster wie AnalyseFilterBar).
//
// ── Was hier ABSICHTLICH nicht mehr steht ──────────────────────────────────
// `typ` (Setting/Closing) und `versteckt` sind ersatzlos entfallen.
//  · Der Typ steht im Chip selbst (Füllung) — ein Filter dafür war eine
//    Kopfleiste voller Chips für eine Information, die man ohnehin sieht.
//  · `versteckt` war kein Filter, sondern eine Falle: Unqualifizierte und tote
//    Termine verschwanden lautlos aus Kalender UND Liste. Sie tragen jetzt
//    eine eigene Farbe (siehe terminMeta.outlineFor) und bleiben sichtbar.
// Alte Links mit diesen Parametern funktionieren weiter, sie werden nur nicht
// mehr gelesen.
//
// ── Und was NEU dazugekommen ist ───────────────────────────────────────────
// `wer` — die Personenachse. „Eine Liste pro Person" ist die Vorgabe des
// Auftraggebers, also ist die persönliche Sicht die Vorgabe und „Alle" die
// bewusste Ausnahme (siehe `TermineWer`).

export type TerminView = "liste" | "monat" | "woche" | "tag" | "rueckruf";

/**
 * Wessen Zeilen? Zwei Werte, keine Personen-Auswahlliste.
 *
 * „Eine Liste pro Person. Darauf stehen die Namen, die genervt werden müssen."
 * Die Vorgabe ist deshalb `mein` und steht als Abwesenheit des Parameters in
 * der URL. `alle` ist der eine Schalter daneben — er erscheint nur, wenn der
 * Server ihn erlaubt (Owner mit Team-Sicht); bei aktiver Datensicht hat der
 * Server die Menge längst zugeschnitten, dort wäre er eine Lüge.
 *
 * Eine Auswahlliste „Zeige mir die Liste von Kevin" gibt es bewusst nicht: Dafür
 * ist die Datensicht da, und zwei Wege, die Person zu wechseln, wären zwei
 * Wahrheiten darüber, wessen Liste man gerade sieht.
 */
export type TermineWer = "mein" | "alle";

/**
 * Ausschnitt der Arbeitsliste — nach ZUSTAND, nicht mehr nach Zeit.
 *
 * Die Liste hat keinen Zeitraum (`rangeForView` liefert für sie `null`); ohne
 * einen Ausschnitt zeigte sie jeden Termin, den es je gab. Bis zum Rückbau
 * schnitt sie nach „anstehend / vergangen / alle" — eine Kalenderfrage in einer
 * Arbeitsliste, und sie beantwortete die falsche: Ein Termin von letzter Woche,
 * bei dem niemand nachgefasst hat, ist keine Vergangenheit, sondern Arbeit.
 *
 * Jetzt schneidet sie entlang der einzigen Unterscheidung, auf die es dem
 * Auftraggeber ankommt:
 *  · `zu_tun`             — die Arbeitsmenge, plus die Termine mit offener
 *                           Erinnerung (`istZuTun`, src/lib/dranRegel.ts).
 *                           „Darauf stehen die Namen, die genervt werden müssen.
 *                           Fertig." Das ist die Vorgabe.
 *  · `erinnerung_setting` — die stehenden ERSTGESPRÄCHE mit ihren zwei
 *  · `erinnerung_closing`   Erinnerungen, bzw. dieselbe Ansicht für die
 *                           Closings (s. u.).
 *  · `alle`               — zusätzlich die abgeschlossenen Vorgänge (tot, kein
 *                           Close …).
 *
 * ── AUS EINEM AUSSCHNITT WURDEN ZWEI, UND DAS WORT IST EIN DRITTES ───────
 * Bis hierher stand hier EIN Ausschnitt `verlegt`, beschriftet „Termin steht".
 * Der Auftraggeber hat beides beanstandet, und zwar in derselben Bewegung:
 *
 *  1. Das Wort benennt den ZUSTAND, die Ansicht hat aber eine AUFGABE — sie ist
 *     die Stelle, an der die zwei Erinnerungen vor dem Termin abgearbeitet
 *     werden. Sie heißt deshalb „Termin-Erinnerung".
 *  2. Erstgespräch und Closing gehören getrennt. Es sind zwei verschiedene
 *     Arbeitsvorgänge mit verschiedenen Gesprächspartnern; in einer gemischten
 *     Liste sucht man sich seine fünf Closings zwischen vierzig Settings heraus.
 *
 * Der ZUSTAND heißt unverändert `verlegt` und auf dem Bildschirm weiterhin
 * „Termin steht" — er beschreibt ja die Datenlage. Nur der Ausschnitt hat eigene
 * Schlüssel bekommen, weil er jetzt etwas anderes ist als vorher.
 *
 * ── ÜBERSCHNEIDUNG MIT `zu_tun` IST GEWOLLT ──────────────────────────────
 * Ein Termin, der morgen ansteht und heute angekündigt werden muss, steht in
 * `zu_tun` UND in seiner Erinnerungs-Ansicht: Er ist versorgt und trotzdem heute
 * anzufassen. Die Zahlen an den Ausschnitten addieren sich deshalb nicht.
 *
 * Alte Links mit `?zeit=verlegt` (und `?zeit=anstehend`) fallen auf `zu_tun`
 * zurück, statt auf eine der beiden neuen Hälften zu zeigen: Ein Schlüssel, der
 * vorher BEIDE Termin-Arten meinte, lässt sich nicht ohne Verlust auf eine davon
 * abbilden. Die Werte sind bewusst neu benannt statt umgedeutet, damit ein
 * geteilter Link nicht unbemerkt etwas anderes zeigt als beim Teilen.
 */
export type TerminZeit = "zu_tun" | "erinnerung_setting" | "erinnerung_closing" | "alle";

/**
 * Welche Termin-Art zeigt dieser Ausschnitt? — `null` heißt „beide" und damit
 * zugleich „das hier ist keine Erinnerungs-Ansicht".
 *
 * Die eine Stelle, an der die Zuordnung Ausschnitt → Termin-Art steht. Sie
 * entscheidet in `TermineList` DREIERLEI zugleich (welche Zeilen, welche
 * Spalte, welcher Leerzustand); dreimal `zeit === "erinnerung_setting"` daneben
 * wäre dreimal dieselbe Bedingung mit drei Chancen, sie beim nächsten Mal
 * unterschiedlich zu schreiben.
 */
export function erinnerungsArt(zeit: TerminZeit): "setting" | "closing" | null {
  if (zeit === "erinnerung_setting") return "setting";
  if (zeit === "erinnerung_closing") return "closing";
  return null;
}

/**
 * Sortierbare Spalten der Arbeitsliste.
 *
 * `quelle` ist mit der Spalte entfallen: Woher ein Lead kam, ändert nichts
 * daran, ob und wie er genervt werden muss — die Herkunft steht auf der
 * Detailseite und im Analyse-Bereich, wo sie etwas erklärt. Alte Links mit
 * `?sort=quelle` fallen auf `zeit` zurück.
 */
export type TerminSort = "zeit" | "lead" | "person" | "status";

export type SortDir = "asc" | "desc";

const VIEWS: readonly TerminView[] = ["liste", "monat", "woche", "tag", "rueckruf"];
const ZEITEN: readonly TerminZeit[] = ["zu_tun", "erinnerung_setting", "erinnerung_closing", "alle"];
const SORTS: readonly TerminSort[] = ["zeit", "lead", "person", "status"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Die Vorgabe-Ansicht: die ARBEITSLISTE, nicht der Kalender.
 *
 * Der Kalender beantwortet „wann habe ich was", die Liste „wen muss ich heute
 * nerven" — und die zweite Frage stellt sich jeden Morgen, die erste nicht. Bis
 * zum Rückbau lag die Liste hinter einem unbeschrifteten Umschalt-Knopf ganz
 * rechts; sie war da, aber niemand fand sie.
 *
 * ── Warum es dazu KEINE gespeicherte Vorliebe gibt ────────────────────────
 * Dieselbe Frage stand bei den Blöcken der Seitenleiste, und dort gewinnt der
 * gespeicherte Zustand über die Vorbelegung — mit einer Begründung, die hier
 * NICHT trägt: Ein Eintrag im localStorage ist dort immer die bewusste
 * Entscheidung eines Menschen über EINEN Block, und ihn zu verwerfen hieße,
 * genau diese Entscheidung wegzuwerfen.
 *
 * Hier wäre die Wirkung die umgekehrte. Wer einmal in den Kalender wechselt —
 * und das tut jeder, der einen Termin sucht —, bekäme dauerhaft den Kalender
 * als Startseite und sähe seine Arbeitsliste nie wieder von selbst. Eine
 * gemerkte Vorliebe verbärge also ausgerechnet das, was der Bereich zeigen
 * soll. Die Ansicht steht deshalb wie bisher ausschließlich in der URL: ein
 * geteilter Link auf `?view=woche` funktioniert unverändert, aber jeder
 * frische Aufruf von `/termine` beginnt bei der Arbeit.
 */
const DEFAULT_VIEW: TerminView = "liste";

export type TermineParams = {
  view: TerminView;
  /** Anker-Datum der Ansicht (YYYY-MM-DD). */
  date: string;
  search: string;
  /** Nur in der Listenansicht wirksam. */
  zeit: TerminZeit;
  /** Nur in der Listenansicht wirksam. */
  sort: TerminSort;
  dir: SortDir;
  /** Personenachse — Vorgabe `mein` (siehe `TermineWer`). */
  wer: TermineWer;
};

export function parseTermineParams(
  sp: { get(key: string): string | null } | Record<string, string | undefined>,
  today: string,
): TermineParams {
  const get = (k: string): string | null =>
    typeof (sp as { get?: unknown }).get === "function"
      ? (sp as { get(key: string): string | null }).get(k)
      : ((sp as Record<string, string | undefined>)[k] ?? null);

  const rawView = get("view");
  const view = VIEWS.includes(rawView as TerminView) ? (rawView as TerminView) : DEFAULT_VIEW;

  const rawDate = get("date");
  const date = rawDate && ISO_DATE.test(rawDate) ? rawDate : today;

  const rawZeit = get("zeit");
  const zeit = ZEITEN.includes(rawZeit as TerminZeit) ? (rawZeit as TerminZeit) : "zu_tun";

  const rawSort = get("sort");
  const sort = SORTS.includes(rawSort as TerminSort) ? (rawSort as TerminSort) : "zeit";
  const dir: SortDir = get("dir") === "desc" ? "desc" : "asc";

  return {
    view,
    date,
    search: get("q")?.trim() ?? "",
    zeit,
    sort,
    dir,
    // Alles außer dem ausdrücklichen „alle" ist die persönliche Sicht — ein
    // Tippfehler in der URL darf nicht versehentlich das ganze Team zeigen.
    wer: get("wer") === "alle" ? "alle" : "mein",
  };
}

/** Die in der aktuellen Ansicht sichtbaren Tage (leer bei Monat/Liste/Rückruf). */
export function daysForView(view: TerminView, date: string): string[] {
  if (view === "woche") return buildWeekDays(date);
  if (view === "tag") return [date];
  return [];
}

/**
 * Der Hauptreiter zu einer Ansicht — drei Reiter, fünf `view`-Werte.
 *
 * Der Kalender behält seine drei Unterstufen (Monat/Woche/Tag), sie sind aber
 * eine Frage INNERHALB des Kalenders und keine Geschwister der Arbeitsliste.
 * Zwei Ebenen in einer Leiste voller gleichrangiger Knöpfe zu mischen war
 * genau der Grund, warum die Liste bisher niemand fand.
 */
export type TerminTab = "liste" | "kalender" | "rueckruf";

export function tabForView(view: TerminView): TerminTab {
  if (view === "liste") return "liste";
  if (view === "rueckruf") return "rueckruf";
  return "kalender";
}

/** Anker um eine Periode verschieben. */
export function stepDate(view: TerminView, date: string, dir: -1 | 1): string {
  if (view === "tag") return addDaysISO(date, dir);
  if (view === "woche") return addDaysISO(date, dir * 7);
  const [y, m] = date.split("-").map(Number);
  const dt = new Date(y, m - 1 + dir, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-01`;
}

const DAY_FMT = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
});

/**
 * Beschriftung neben der Steuerung — im Kalender der Zeitraum, in der Liste der
 * NAME DER ANSICHT.
 *
 * In der Liste gibt es keinen Zeitraum zu benennen (`rangeForView` liefert dort
 * `null`), also steht dort, was man gerade vor sich hat. Die beiden
 * Erinnerungs-Ausschnitte heißen zusammen „Termin-Erinnerung" — welche der
 * beiden es ist, sagt das Segment einen Zentimeter weiter links; es hier zu
 * wiederholen hieße, dieselbe Auskunft zweimal und womöglich mit zwei
 * verschiedenen Wörtern zu geben.
 */
export function periodLabel(view: TerminView, date: string, zeit?: TerminZeit): string {
  const [y, m, d] = date.split("-").map(Number);
  if (view === "liste" && zeit && erinnerungsArt(zeit)) return "Termin-Erinnerung";
  if (view === "rueckruf") return "Rückrufe";
  if (view === "tag") return DAY_FMT.format(new Date(y, m - 1, d));
  if (view === "monat") return monthLabelDe(y, m);
  if (view === "woche") {
    const days = buildWeekDays(date);
    const from = days[0];
    const to = days[6];
    const [fy, fm, fd] = from.split("-").map(Number);
    const [ty, tm, td] = to.split("-").map(Number);
    const short = (dd: number, mm: number) => `${String(dd).padStart(2, "0")}.${String(mm).padStart(2, "0")}.`;
    return fy === ty
      ? `${short(fd, fm)} – ${short(td, tm)}${tm === fm ? ` ${ty}` : ` ${ty}`}`
      : `${short(fd, fm)}${fy} – ${short(td, tm)}${ty}`;
  }
  return "Arbeitsliste";
}

/** Sichtbarer Datumsbereich einer Ansicht — für Liste und Rückrufe ohne Grenze. */
export function rangeForView(view: TerminView, date: string): { from: string; to: string } | null {
  if (view === "liste" || view === "rueckruf") return null;
  if (view === "tag") return { from: date, to: date };
  if (view === "woche") {
    const start = weekStart(date);
    return { from: start, to: addDaysISO(start, 6) };
  }
  const [y, m] = date.split("-").map(Number);
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(y, m, 0);
  return {
    from: first,
    to: `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`,
  };
}
