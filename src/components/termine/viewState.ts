import { addDaysISO, buildWeekDays, monthLabelDe, weekStart } from "@/lib/dates";

// URL-State des Termine-Kalenders. Alles landet in der Query, damit Zurück-
// Button und geteilte Links funktionieren (Muster wie AnalyseFilterBar).

export type TerminView = "monat" | "woche" | "tag" | "liste";

/**
 * Zeitfenster der Listenansicht.
 *
 * Die Liste hatte bisher keine Grenze (`rangeForView` liefert für sie `null`) —
 * sie zeigte damit jeden Termin, den es je gab, als eine flache Folge. Für die
 * Kalenderansichten ist der Parameter bedeutungslos, dort setzt der Zeitraum
 * bereits die Grenze.
 */
export type TerminZeit = "anstehend" | "vergangen" | "alle";

const VIEWS: readonly TerminView[] = ["monat", "woche", "tag", "liste"];
const ZEITEN: readonly TerminZeit[] = ["anstehend", "vergangen", "alle"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type TermineParams = {
  view: TerminView;
  /** Anker-Datum der Ansicht (YYYY-MM-DD). */
  date: string;
  kinds: Set<"setting" | "closing">;
  persons: Set<string>;
  showHidden: boolean;
  search: string;
  /** Nur in der Listenansicht wirksam. */
  zeit: TerminZeit;
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

  const rawKinds = (get("typ") ?? "").split(",").filter(Boolean);
  const kinds = new Set<"setting" | "closing">(
    rawKinds.filter((k): k is "setting" | "closing" => k === "setting" || k === "closing"),
  );
  // Leer = beide Typen. Ein bewusst leerer Filter ist nicht sinnvoll.
  if (kinds.size === 0) {
    kinds.add("setting");
    kinds.add("closing");
  }

  const persons = new Set((get("person") ?? "").split(",").filter(Boolean));

  const rawZeit = get("zeit");
  const zeit = ZEITEN.includes(rawZeit as TerminZeit) ? (rawZeit as TerminZeit) : "anstehend";

  return {
    view,
    date,
    kinds,
    persons,
    showHidden: get("versteckt") === "1",
    search: get("q")?.trim() ?? "",
    zeit,
  };
}

/**
 * Termin-Gruppen der Listenansicht, nach Dringlichkeit sortiert.
 *
 * `ohne` fasst Termine ohne gesetzten Zeitpunkt zusammen — die gibt es nur in
 * der Liste, im Kalender haben sie keinen Platz.
 */
export type TerminGruppe = "ueberfaellig" | "heute" | "woche" | "spaeter" | "ohne" | "vergangen";

export const GRUPPEN_LABEL: Record<TerminGruppe, string> = {
  ueberfaellig: "Überfällig",
  heute: "Heute",
  woche: "Diese Woche",
  spaeter: "Später",
  ohne: "Ohne Termin",
  vergangen: "Vergangen",
};

/** Reihenfolge der Gruppen in der Liste — dringend zuerst. */
export const GRUPPEN_ORDER: readonly TerminGruppe[] = [
  "ueberfaellig",
  "heute",
  "woche",
  "spaeter",
  "ohne",
  "vergangen",
];

/**
 * Einordnung eines Termins.
 *
 * „Überfällig" meint: liegt in der Vergangenheit und ist noch NICHT abgehakt —
 * genau das, was liegen geblieben ist. Abgeschlossene Termine der Vergangenheit
 * landen in „Vergangen", sonst wäre die dringendste Gruppe voller Altlasten.
 */
export function gruppeFor(
  dayISO: string | null,
  erledigt: boolean,
  today: string,
  weekEnd: string,
): TerminGruppe {
  if (!dayISO) return "ohne";
  if (dayISO < today) return erledigt ? "vergangen" : "ueberfaellig";
  if (dayISO === today) return "heute";
  if (dayISO <= weekEnd) return "woche";
  return "spaeter";
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
  return "Alle Termine";
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
