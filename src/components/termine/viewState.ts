import { addDaysISO, buildWeekDays, monthLabelDe, weekStart } from "@/lib/dates";

// URL-State des Termine-Kalenders. Alles landet in der Query, damit Zurück-
// Button und geteilte Links funktionieren (Muster wie AnalyseFilterBar).
//
// ── Was hier ABSICHTLICH nicht mehr steht ──────────────────────────────────
// `typ` (Setting/Closing), `person` und `versteckt` sind ersatzlos entfallen.
//  · Typ und Person stehen jetzt im Chip selbst (Füllung bzw. Owner-Avatar) —
//    ein Filter dafür war eine Kopfleiste voller Chips für eine Information,
//    die man ohnehin sieht.
//  · `versteckt` war kein Filter, sondern eine Falle: Unqualifizierte und tote
//    Termine verschwanden lautlos aus Kalender UND Liste. Sie tragen jetzt
//    eine eigene Farbe (siehe terminMeta.outlineFor) und bleiben sichtbar.
// Alte Links mit diesen Parametern funktionieren weiter, sie werden nur nicht
// mehr gelesen.

export type TerminView = "monat" | "woche" | "tag" | "liste";

/**
 * Zeitfenster der Listenansicht.
 *
 * Die Liste hat keinen Zeitraum (`rangeForView` liefert für sie `null`) — ohne
 * dieses Fenster zeigte sie jeden Termin, den es je gab. Für die
 * Kalenderansichten ist der Parameter bedeutungslos, dort setzt der Zeitraum
 * bereits die Grenze.
 */
export type TerminZeit = "anstehend" | "vergangen" | "alle";

/** Sortierbare Spalten der Arbeitsliste. */
export type TerminSort = "zeit" | "lead" | "person" | "quelle" | "status";

export type SortDir = "asc" | "desc";

const VIEWS: readonly TerminView[] = ["monat", "woche", "tag", "liste"];
const ZEITEN: readonly TerminZeit[] = ["anstehend", "vergangen", "alle"];
const SORTS: readonly TerminSort[] = ["zeit", "lead", "person", "quelle", "status"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
  const view = VIEWS.includes(rawView as TerminView) ? (rawView as TerminView) : "woche";

  const rawDate = get("date");
  const date = rawDate && ISO_DATE.test(rawDate) ? rawDate : today;

  const rawZeit = get("zeit");
  const zeit = ZEITEN.includes(rawZeit as TerminZeit) ? (rawZeit as TerminZeit) : "anstehend";

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
  };
}

/** Die in der aktuellen Ansicht sichtbaren Tage (leer bei Monat/Liste). */
export function daysForView(view: TerminView, date: string): string[] {
  if (view === "woche") return buildWeekDays(date);
  if (view === "tag") return [date];
  return [];
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

/** Beschriftung des Zeitraums über dem Kalender. */
export function periodLabel(view: TerminView, date: string): string {
  const [y, m, d] = date.split("-").map(Number);
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

/** Sichtbarer Datumsbereich einer Ansicht — für die Liste ohne Grenze. */
export function rangeForView(view: TerminView, date: string): { from: string; to: string } | null {
  if (view === "liste") return null;
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
