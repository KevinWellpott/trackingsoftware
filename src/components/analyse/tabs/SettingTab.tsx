import type { CSSProperties, ReactNode } from "react";
import {
  BadgeCheck, BarChart3, Briefcase, CalendarCheck, CalendarClock, ChevronRight, Eye, Filter,
  Gauge as GaugeIcon, Handshake, ListChecks, PieChart, Timer, TrendingUp, Video, Wallet,
} from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { loadSettingCalls, type AnalyseSettingCall } from "@/lib/analyseData";
import {
  WEEKDAY_LABELS, buildBuckets, bucketIndex, bucketOf, daysBetween, pct, settingEffDate, weekdayIndex,
  type Granularity, type QuelleKey,
} from "@/lib/analyse";
import { toBerlinSlot } from "@/lib/apptTime";
import { CHANNELS, channelLabel, channelOf } from "@/lib/channels";
import { personIn } from "@/lib/personResolution";
import { AnalyseSection } from "@/components/analyse/AnalyseSection";
import { ComparisonTable, type ComparisonRow } from "@/components/analyse/ComparisonTable";
import { Footnote, MetricTable, type MetricRow } from "@/components/analyse/AnalyseTables";
import { BucketBarChart } from "@/components/analyse/AnalyseCharts";
import { CumulativeProgressChart } from "@/components/analyse/CumulativeProgressChart";
import { DistBars, DonutChart, GaugeBar, KpiHero, QuoteColumns, KpiRow } from "@/components/analyse/AnalyseViz";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type { SettingStatus } from "@/lib/types";

// Setting-Flow: Termine → Shows → Qualifikation → Zu Closing geschickt.
// Ein einziger Fetch deckt aktuelles UND Vorperioden-Fenster ab — der Split
// passiert in JS über settingEffDate.
//
// Der Tab beantwortet oben genau vier Fragen (Auftraggeber-Vorgabe):
// wie viele Termine, wie viele erschienen, wie viele hielten der
// Qualifizierung stand, und wie viele davon wurden wirklich ins Closing
// geschickt. Alles Weitere ist Ursachenforschung und liegt eingeklappt unter
// „Mehr Auswertungen" — sichtbar bleibt daneben nur die Quellen-Auswertung.
//
// Genau EINE Leitzahl je Tab (`lead` an KpiHero): hier „Termine". Sie ist die
// einzige absolute Menge der Reihe — die drei anderen Kacheln sind Quoten, die
// ohne sie gar nicht existieren — und die Zahl, die das Team täglich steuert.
// Zwei Leitzahlen wären keine, deshalb bleibt es bei dieser einen.
//
// Personenachse: `personIn` (Zuweisung vor Ersteller), nicht mehr
// `created_by_user_id` — siehe src/lib/personResolution.ts.

type Member = { user_id: string; username: string };

// Sammelzeile für Termine, deren Person nicht (mehr) zur Organisation gehört.
// Wortgleich mit dem Übersichts-Tab, damit beide dieselbe Gesamtsumme zeigen.
const OHNE = "Ohne Zuordnung";

const STATUS_META: { key: SettingStatus; label: string; tone: BadgeTone }[] = [
  { key: "offen", label: "Offen", tone: "info" },
  { key: "no_show", label: "No-Show", tone: "error" },
  { key: "qualifiziert", label: "Qualifiziert", tone: "success" },
  { key: "closing_gelegt", label: "Closing gelegt", tone: "brand" },
  { key: "unqualifiziert", label: "Unqualifiziert", tone: "warning" },
  { key: "dead", label: "Dead", tone: "error" },
];

// „dead" hängt bewusst nicht mehr hier: Die Vergleichstabelle zeigt nur noch
// die vier Kennzahlen der KPI-Reihe; die Status-Verteilung unten führt Dead
// ohnehin separat auf.
type Totals = {
  termine: number;
  shows: number;
  /**
   * Termine mit `show_status = 'no_show'` — DATENSÄTZE, nicht Ereignisse.
   *
   * Vorher stand hier die Summe von `no_show_count`. Das mischt zwei
   * Grundgesamtheiten: Der Zähler läuft über Neuterminierungen hinweg weiter
   * und trägt teils Vorfälle, die VOR dem gewählten Zeitraum lagen — in einer
   * Auswertung, die „absolut im Zeitraum" verspricht, hat das nichts verloren.
   * Zusätzlich blieb ein neuterminierter, später erschienener Termin mit
   * seinem alten No-Show im Nenner und drückte die Quote dauerhaft.
   * Identisch zur Definition im Übersichts-Tab.
   */
  noShows: number;
  quali: number;
  closing: number;
};

const ZERO = (): Totals => ({ termine: 0, shows: 0, noShows: 0, quali: 0, closing: 0 });

const INT = new Intl.NumberFormat("de-DE");
// Eine Nachkommastelle für die Ø-Werte in der Meta-Zeile der zugeklappten
// Qualitäts-Sektion. Rein für die Anzeige — gerechnet wird nichts Neues.
const DEC1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt1 = (v: number | null): string => (v === null ? "—" : DEC1.format(v));

// ── Info-Texte ───────────────────────────────────────────────
// Die Methodik-Erklärungen standen bis hierher als Fußnote unter jeder
// Sektion und verlängerten sie dauerhaft um drei bis sechs Zeilen. Sie liegen
// jetzt hinter dem Info-Icon am Sektionstitel — dieselbe Information, aber
// dort abrufbar, wo die Frage entsteht.
//
// `InfoText` setzt nur die Absätze; Schriftgröße und Farbe bringt das Popover
// mit (InfoPopover). Der Abstand kommt über `gap`, damit der letzte Absatz
// unten keinen überzähligen Rand gegen die Polsterung des Popovers setzt.
function InfoText({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>{children}</div>;
}

const INFO_P: CSSProperties = { margin: 0 };
const INFO_STRONG: CSSProperties = { fontWeight: 600 };

/** Ein Setting gilt als qualifiziert, wenn der Lead da war und weiterging. */
function isQualified(r: AnalyseSettingCall): boolean {
  return r.show_status === "show" && (r.status === "qualifiziert" || r.status === "closing_gelegt");
}

/** Ein Setting ist ins Closing gegangen, wenn dort ein Closing gelegt wurde. */
function isSentToClosing(r: AnalyseSettingCall): boolean {
  return r.show_status === "show" && r.status === "closing_gelegt";
}

/** %-Änderung vs. Vorperiode für Zähl-KPIs; Vorwert 0 → null. */
function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

/** Prozentpunkt-Differenz zweier Quoten; fehlende Basis (null) → null. */
function ppDelta(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null) return null;
  return Math.round((cur - prev) * 10) / 10;
}

/** "01.07. – 31.07." — Fußnote des Fortschritts-Charts. */
function rangeLabelOf(from: string, to: string): string {
  const d = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
  return `${d(from)} – ${d(to)}`;
}

// Vorlaufzeit: wie viele Tage liegen zwischen Buchung und Termin. Kurzfristige
// Termine zeigen erfahrungsgemäß bessere Show-Quoten — die Frage ist, wie stark.
const LEAD_BOUNDS = [0, 1, 3, 7, 14] as const;
const LEAD_LABELS = ["Selber Tag", "1 Tag", "2–3 Tage", "4–7 Tage", "8–14 Tage", "> 14 Tage"];

// Uhrzeit-Blöcke in Berliner Wandzeit (Minuten ab Mitternacht).
const HOUR_BOUNDS = [10 * 60 - 1, 12 * 60 - 1, 14 * 60 - 1, 16 * 60 - 1, 18 * 60 - 1] as const;
const HOUR_LABELS = ["vor 10", "10–12", "12–14", "14–16", "16–18", "ab 18"];

const BRANCHE_LABELS: Record<string, string> = {
  agentur: "Agentur",
  coach: "Coach",
  consultant: "Consultant",
  sonstiges: "Sonstiges",
};

/**
 * Quelle eines Termins als Auswertungs-Schlüssel.
 *
 * `source_detail` hat Vorrang vor `source_type`: Der Freitext trägt den ECHTEN
 * Ursprung („Social Selling", „Empfehlung Meier"), während `source_type` alles,
 * was nicht aus einer LinkedIn-Liste oder einem Telefon-Lead entstand, in einem
 * Sammeltopf ablegt. Bis hierher wurde das Feld geladen und nirgends gelesen —
 * die umsatzstärkste Zeile der Auswertung hieß deshalb „Manuell" und sagte
 * nichts.
 *
 * Der Schlüssel wird case-insensitiv normalisiert (sonst werden aus „Social
 * Selling", „social selling" und „Social selling" drei Zeilen); angezeigt wird
 * die zuerst gesehene Schreibweise. Die Präfixe `d:`/`t:` halten Detail- und
 * Typ-Schlüssel auseinander, damit ein Freitext „telefon" nicht mit dem Kanal
 * kollidiert.
 */
function sourceKeyOf(r: AnalyseSettingCall): { key: string; label: string; channel: string | null } {
  const detail = (r.source_detail ?? "").trim();
  if (detail) return { key: `d:${detail.toLowerCase()}`, label: detail, channel: channelLabel(r.source_type) };
  return { key: `t:${r.source_type ?? "sonstige"}`, label: channelLabel(r.source_type), channel: null };
}

/** Zähl-Eimer für „Menge + drei Quoten" — die Form fast aller Schnitte hier. */
type Cell = { n: number; shows: number; noShows: number; quali: number; closing: number };
const ZERO_CELL = (): Cell => ({ n: 0, shows: 0, noShows: 0, quali: 0, closing: 0 });

function addCell(cell: Cell, r: AnalyseSettingCall): void {
  cell.n += 1;
  if (r.show_status === "show") cell.shows += 1;
  // Datensatz-Ebene, nicht `no_show_count` — siehe Kommentar bei `Totals`.
  if (r.show_status === "no_show") cell.noShows += 1;
  if (isQualified(r)) cell.quali += 1;
  if (isSentToClosing(r)) cell.closing += 1;
}

function cellValues(cell: Cell) {
  return {
    n: cell.n,
    showRate: pct(cell.shows, cell.shows + cell.noShows),
    qualiRate: pct(cell.quali, cell.shows),
    // Nenner sind die QUALIFIZIERTEN, nicht die Erschienenen — siehe
    // Kommentar bei der KPI-Kachel „Zu Closing geschickt".
    zuClosing: pct(cell.closing, cell.quali),
  };
}

/**
 * Aufklappbarer Bereich für die Detail-Auswertungen.
 *
 * Der Auftraggeber wollte den zweiten Teil des Tabs „erstmal" weghaben — nicht
 * für immer. Ein `<details>` kostet nichts (kein State, kein Client-JS) und
 * hält die Rechenwege am Leben; sie zu löschen hieße, sie beim nächsten „doch
 * wieder" komplett neu zu bauen.
 *
 * Alle Sektionen DARIN starten zugeklappt (`defaultOpen={false}`). Vorher riss
 * ein Klick sieben Sektionen gleichzeitig auf und verdreifachte die Seitenlänge
 * — genau das ließ den Tab überladen wirken. Damit ein zugeklappter Balken
 * trotzdem eine Entscheidung erlaubt, trägt jede Sektion ihre Menge bzw. ihren
 * Kernwert in der Meta-Zeile: ohne Zahl weiß niemand, ob dahinter 40 Zeilen
 * oder nichts steht.
 */
function MoreAnalyses({ meta, children }: { meta: string; children: ReactNode }) {
  return (
    <details className="fade-up" style={{ animationDelay: "560ms" }}>
      <summary
        className="collapse-summary"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-4)",
          padding: "var(--sp-5) var(--sp-7)",
          cursor: "pointer",
          userSelect: "none",
          background: "var(--surface-1)",
        }}
      >
        <ChevronRight size={14} className="collapse-chevron" style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span className="eyebrow">Mehr Auswertungen</span>
        <span className="eyebrow eyebrow-muted" style={{ marginLeft: "auto" }}>
          {meta}
        </span>
      </summary>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>{children}</div>
    </details>
  );
}

export async function SettingTab({
  access,
  from,
  to,
  prevFrom,
  prevTo,
  granularity,
  selectedMembers,
  canCompare,
  quelle,
  allSelected = false,
}: {
  access: AccessContext;
  from: string;
  to: string;
  selectedMembers: Member[];
  canCompare: boolean;
  quelle: QuelleKey;
  prevFrom?: string;
  prevTo?: string;
  granularity?: Granularity;
  /**
   * `true`, wenn kein Personenfilter aktiv ist (alle Mitglieder ausgewählt).
   * Nur dann bekommen Termine ohne auflösbare Person eine „Ohne
   * Zuordnung"-Zeile; mit aktivem Filter wäre das ein Wiedereinschleusen
   * abgewählter Zeilen.
   */
  allSelected?: boolean;
}) {
  const supabase = await createClient();
  const hasPrev = Boolean(prevFrom && prevTo);
  const allRows = await loadSettingCalls(supabase, access, canCompare);
  const buckets = buildBuckets(from, to, granularity);

  const selectedIds = new Set(selectedMembers.map((m) => m.user_id));
  const nameById = new Map(selectedMembers.map((m) => [m.user_id, m.username]));

  const totals = new Map<string, Totals>();
  const perUser: Record<string, Record<string, number>> = {};
  // Lazy, weil "Ohne Zuordnung" erst entsteht, wenn eine solche Zeile auftaucht.
  const ensure = (name: string): Totals => {
    let t = totals.get(name);
    if (!t) {
      t = ZERO();
      totals.set(name, t);
      perUser[name] = {};
    }
    return t;
  };
  for (const m of selectedMembers) ensure(m.username);
  const statusCounts: Record<SettingStatus, number> = {
    offen: 0, no_show: 0, qualifiziert: 0, closing_gelegt: 0, unqualifiziert: 0, dead: 0,
  };

  const prev = ZERO();
  // Zuwächse je Bucket für den Fortschritts-Chart (die Komponente kumuliert
  // selbst — hier stehen bewusst Tages-/Wochenwerte, keine Summen).
  const termineByBucket: Record<string, number> = {};
  const showsByBucket: Record<string, number> = {};
  const qualiByBucket: Record<string, number> = {};
  const closingByBucket: Record<string, number> = {};
  const budget = { ja: 0, nein: 0, unklar: 0 };
  let painSum = 0, painN = 0, warmthSum = 0, warmthN = 0;

  // Schnitte (jeweils Menge + Quoten)
  const leadCells = LEAD_LABELS.map(ZERO_CELL);
  let leadUnknown = 0;
  const weekdayCells = WEEKDAY_LABELS.map(ZERO_CELL);
  const hourCells = HOUR_LABELS.map(ZERO_CELL);
  let timeUnknown = 0;
  const kindCells = new Map<string, Cell>();
  const brancheCells = new Map<string, Cell>();
  // Quellen-Auswertung auf zwei Ebenen: `channelCounts` grob je Kanal (Donut),
  // `sourceCells` fein je `source_detail` (Tabelle). `sourceMeta` hält Label
  // und Kanal-Zugehörigkeit des zuerst gesehenen Datensatzes.
  const sourceCells = new Map<string, Cell>();
  const sourceMeta = new Map<string, { label: string; channel: string | null }>();
  const channelCounts = new Map<string, number>();
  const criteria: Record<string, { ja: Cell; nein: Cell }> = {
    budget: { ja: ZERO_CELL(), nein: ZERO_CELL() },
    sole_decider: { ja: ZERO_CELL(), nein: ZERO_CELL() },
    can_decide_now: { ja: ZERO_CELL(), nein: ZERO_CELL() },
    clear_need: { ja: ZERO_CELL(), nein: ZERO_CELL() },
  };
  const painBins = [0, 0, 0, 0, 0];
  const warmthBins = [0, 0, 0, 0, 0];
  const noShowRepeat = { einmal: 0, mehrfach: 0 };

  const bucketOfMap = (map: Map<string, Cell>, key: string): Cell => {
    let c = map.get(key);
    if (!c) {
      c = ZERO_CELL();
      map.set(key, c);
    }
    return c;
  };

  for (const r of allRows) {
    const day = settingEffDate(r);
    if (quelle !== "alle" && r.source_type !== quelle) continue;

    // Zuweisung schlägt Ersteller. Kein Treffer heißt entweder "bewusst
    // abgewählt" (Personenfilter aktiv → raus) oder "Person gehört nicht mehr
    // zur Organisation" (kein Filter → sichtbar unter OHNE, statt die
    // Gesamtsumme still zu kürzen).
    const uid = personIn(r, selectedIds);
    if (!uid && !allSelected) continue;
    const name = uid ? nameById.get(uid)! : OHNE;

    // ── Vorperioden-Fenster ────────────────────────────────────
    if (hasPrev && day >= prevFrom! && day <= prevTo!) {
      prev.termine += 1;
      if (r.show_status === "show") prev.shows += 1;
      if (r.show_status === "no_show") prev.noShows += 1;
      if (isQualified(r)) prev.quali += 1;
      if (isSentToClosing(r)) prev.closing += 1;
      continue;
    }

    // ── Aktuelles Fenster ──────────────────────────────────────
    if (day < from || day > to) continue;

    const t = ensure(name);
    t.termine += 1;
    if (r.show_status === "show") t.shows += 1;
    // Datensatz-Ebene (siehe `Totals`): Termine ohne erfasstes Ergebnis bleiben
    // aus Zähler UND Nenner — sonst läse sich jeder laufende Zeitraum wie ein
    // Einbruch, nur weil die Termine noch bevorstehen.
    if (r.show_status === "no_show") t.noShows += 1;
    if (isQualified(r)) t.quali += 1;
    if (isSentToClosing(r)) t.closing += 1;
    statusCounts[r.status] += 1;

    const bk = bucketOf(day, from, to, granularity);
    perUser[name][bk] = (perUser[name][bk] ?? 0) + 1;
    termineByBucket[bk] = (termineByBucket[bk] ?? 0) + 1;
    if (r.show_status === "show") showsByBucket[bk] = (showsByBucket[bk] ?? 0) + 1;
    if (isQualified(r)) qualiByBucket[bk] = (qualiByBucket[bk] ?? 0) + 1;
    if (isSentToClosing(r)) closingByBucket[bk] = (closingByBucket[bk] ?? 0) + 1;

    // Kanal-Ebene: unbekannte und leere Werte landen im Registry-Eintrag
    // „Sonstige", damit nicht zwei Segmente mit demselben Namen entstehen.
    const chKey = channelOf(r.source_type)?.key ?? "sonstige";
    channelCounts.set(chKey, (channelCounts.get(chKey) ?? 0) + 1);

    if (r.has_budget_8k === "ja") budget.ja += 1;
    else if (r.has_budget_8k === "nein") budget.nein += 1;
    else if (r.has_budget_8k === "unklar") budget.unklar += 1;

    if (r.ist_pain != null) {
      painSum += Number(r.ist_pain);
      painN += 1;
      painBins[Math.min(Math.floor((Number(r.ist_pain) - 1) / 2), 4)] += 1;
    }
    if (r.warmth != null) {
      warmthSum += Number(r.warmth);
      warmthN += 1;
      warmthBins[Math.min(Math.floor((Number(r.warmth) - 1) / 2), 4)] += 1;
    }

    if ((r.no_show_count ?? 0) === 1) noShowRepeat.einmal += 1;
    else if ((r.no_show_count ?? 0) > 1) noShowRepeat.mehrfach += 1;

    // Vorlaufzeit Buchung → Termin
    const lead = daysBetween(r.created_at, r.appointment_at);
    if (lead === null) leadUnknown += 1;
    else addCell(leadCells[bucketIndex(Math.max(lead, 0), LEAD_BOUNDS)], r);

    // Wochentag + Uhrzeit des Termins (Berliner Wandzeit)
    const slot = r.appointment_at ? toBerlinSlot(r.appointment_at) : null;
    if (slot) {
      addCell(weekdayCells[weekdayIndex(slot.dayISO)], r);
      addCell(hourCells[bucketIndex(slot.startMin, HOUR_BOUNDS)], r);
    } else {
      timeUnknown += 1;
    }

    addCell(bucketOfMap(kindCells, r.meeting_kind ?? "offen"), r);
    addCell(bucketOfMap(brancheCells, (r.branche ?? "").trim() || "ohne"), r);

    const src = sourceKeyOf(r);
    addCell(bucketOfMap(sourceCells, src.key), r);
    if (!sourceMeta.has(src.key)) sourceMeta.set(src.key, { label: src.label, channel: src.channel });

    if (r.has_budget_8k === "ja") addCell(criteria.budget.ja, r);
    else if (r.has_budget_8k === "nein") addCell(criteria.budget.nein, r);
    if (r.sole_decider === true) addCell(criteria.sole_decider.ja, r);
    else if (r.sole_decider === false) addCell(criteria.sole_decider.nein, r);
    if (r.can_decide_now === true) addCell(criteria.can_decide_now.ja, r);
    else if (r.can_decide_now === false) addCell(criteria.can_decide_now.nein, r);
    if (r.clear_need === true) addCell(criteria.clear_need.ja, r);
    else if (r.clear_need === false) addCell(criteria.clear_need.nein, r);
  }

  const names = selectedMembers.map((m) => m.username);
  // Die OHNE-Zeile erscheint nur, wenn sie im Zeitraum wirklich etwas zählt.
  if ((totals.get(OHNE)?.termine ?? 0) > 0) names.push(OHNE);

  const sum = ZERO();
  for (const name of names) {
    const t = totals.get(name)!;
    sum.termine += t.termine;
    sum.shows += t.shows;
    sum.noShows += t.noShows;
    sum.quali += t.quali;
    sum.closing += t.closing;
  }

  // ── KPI-Werte + Deltas ───────────────────────────────────────
  const showRate = pct(sum.shows, sum.shows + sum.noShows);
  const qualiRate = pct(sum.quali, sum.shows);
  // NEUER NENNER: „Zu Closing geschickt" rechnet gegen die QUALIFIZIERTEN,
  // nicht mehr gegen alle Erschienenen. Gemeint ist die Konsequenz des Setters:
  // Von den Terminen, die überhaupt eine Chance hatten (erschienen UND durch
  // die Qualifizierung), wie viele landen wirklich in einem Closing? No-Shows
  // und Unqualifizierte kommen dadurch konstruktionsbedingt gar nicht erst in
  // den Nenner. Die alte Rechnung (gegen alle Shows) beantwortete eine andere
  // Frage — Lead-Qualität statt Setter-Konsequenz — und wird ersetzt, nicht
  // danebengestellt.
  const zuClosingRate = pct(sum.closing, sum.quali);
  const prevShowRate = pct(prev.shows, prev.shows + prev.noShows);
  const prevQualiRate = pct(prev.quali, prev.shows);
  const prevZuClosing = pct(prev.closing, prev.quali);
  const termineSpark = buckets.map((b) => termineByBucket[b.key] ?? 0);

  const tableRows: ComparisonRow[] = names.map((name) => {
    const t = totals.get(name)!;
    return {
      name,
      values: {
        termine: t.termine,
        showRate: pct(t.shows, t.shows + t.noShows),
        qualiRate: pct(t.quali, t.shows),
        zuClosing: pct(t.closing, t.quali),
      },
    };
  });

  const average = {
    termine: sum.termine,
    showRate,
    qualiRate,
    zuClosing: zuClosingRate,
  };

  const statusTotal = STATUS_META.reduce((acc, s) => acc + statusCounts[s.key], 0);

  // ── Quellen-Split (Donut, Kanal-Ebene) ───────────────────────
  // Reihenfolge und Farbe kommen aus der Registry — damit LinkedIn im Donut,
  // im Funnel und im Termin-Formular dieselbe Farbe trägt.
  const quellenData = CHANNELS.map((c) => ({
    name: c.label,
    value: channelCounts.get(c.key) ?? 0,
    color: c.color,
  })).filter((d) => d.value > 0);

  // ── Qualität ─────────────────────────────────────────────────
  const budgetTotal = budget.ja + budget.nein + budget.unklar;
  const budgetItems = [
    { label: "Ja", value: budget.ja, color: "var(--success)" },
    { label: "Nein", value: budget.nein, color: "var(--danger)" },
    { label: "Unklar", value: budget.unklar, color: "var(--warning)" },
  ];
  const avgPain = painN > 0 ? painSum / painN : null;
  const avgWarmth = warmthN > 0 ? warmthSum / warmthN : null;

  // ── Schnitt-Tabellen ─────────────────────────────────────────
  const cellRows = (
    entries: [string, Cell][],
    labelOf: (key: string) => string,
    base: number,
  ): MetricRow[] =>
    entries
      .filter(([, c]) => c.n > 0)
      .sort((a, b) => b[1].n - a[1].n)
      .map(([key, c]) => ({
        key,
        label: labelOf(key),
        share: base === 0 ? null : c.n / base,
        values: cellValues(c),
      }));

  const kindRows = cellRows(
    [...kindCells.entries()],
    (k) => (k === "link" ? "Video-Link" : k === "telefon" ? "Telefon" : "Ohne Angabe"),
    sum.termine,
  );
  const brancheRows = cellRows([...brancheCells.entries()], (k) => BRANCHE_LABELS[k] ?? "Ohne Angabe", sum.termine);
  // Für die Meta-Zeile der zugeklappten Sektion: „ohne" ist keine Branche,
  // sondern eine Erfassungslücke. Sie darf die Anzahl nicht aufblähen, gehört
  // aber genannt — sie begrenzt die Aussagekraft der Tabelle dahinter.
  const brancheKnown = brancheRows.filter((r) => r.key !== "ohne").length;
  const brancheOhne = brancheCells.get("ohne")?.n ?? 0;

  const sourceRows: MetricRow[] = [...sourceCells.entries()]
    .filter(([, c]) => c.n > 0)
    .sort((a, b) => b[1].n - a[1].n)
    .map(([key, c]) => {
      const meta = sourceMeta.get(key)!;
      return {
        key,
        label: meta.label,
        // Nur bei Freitext-Quellen: der Kanal, unter dem die Zeile im Donut
        // steckt. Bei reinen Kanal-Zeilen wäre es eine Wiederholung des Labels.
        sub: meta.channel,
        share: sum.termine === 0 ? null : c.n / sum.termine,
        values: cellValues(c),
      };
    });

  const CRITERIA_LABELS: Record<string, string> = {
    budget: "Budget 8k+",
    sole_decider: "Alleinentscheider",
    can_decide_now: "Kann sofort entscheiden",
    clear_need: "Klarer Bedarf",
  };
  const criteriaRows: MetricRow[] = Object.entries(criteria)
    .filter(([, v]) => v.ja.n + v.nein.n > 0)
    .map(([key, v]) => ({
      key,
      label: CRITERIA_LABELS[key],
      sub: `${INT.format(v.ja.n + v.nein.n)} von ${INT.format(sum.termine)} Terminen beantwortet`,
      values: {
        jaN: v.ja.n,
        jaClosing: pct(v.ja.closing, v.ja.shows),
        neinN: v.nein.n,
        neinClosing: pct(v.nein.closing, v.nein.shows),
        spread:
          pct(v.ja.closing, v.ja.shows) === null || pct(v.nein.closing, v.nein.shows) === null
            ? null
            : Math.round(((pct(v.ja.closing, v.ja.shows) ?? 0) - (pct(v.nein.closing, v.nein.shows) ?? 0)) * 10) / 10,
      },
    }));

  const mutedNote: CSSProperties = {
    fontSize: "var(--fs-xs)",
    color: "var(--text-muted)",
    margin: "var(--sp-3) 0 0",
  };

  const scaleLabels = ["1–2", "3–4", "5–6", "7–8", "9–10"];

  return (
    <>
      {/* ── KPI-Heroes: die vier Fragen des Setting-Flows ──────── */}
      <KpiRow>
        {/* Leitzahl des Tabs (Glasfläche + --fs-3xl). Die drei Kacheln
            daneben sind Quoten AUS dieser Menge — ohne Termine gibt es keine
            einzige davon. Also steht sie oben links, wo der Blick zuerst
            landet. */}
        <KpiHero
          label="Termine"
          value={sum.termine}
          format="int"
          delta={pctChange(sum.termine, prev.termine)}
          spark={termineSpark}
          icon={<CalendarCheck size={15} />}
          index={0}
          lead
        />
        <KpiHero
          label="Show-Quote"
          value={showRate}
          format="pct"
          delta={ppDelta(showRate, prevShowRate)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<Eye size={15} />}
          index={1}
        />
        {/* „Quali-Quote" setzte zweimal Vorwissen voraus: die Abkürzung selbst
            und den Nenner — dass gegen die ERSCHIENENEN gerechnet wird und
            nicht gegen alle Termine, stand bis hierher nur im Info-Popover.
            Das Label nennt jetzt die Sache („Qualifiziert"), die Unterzeile
            den Bruch in absoluten Zahlen. Keine zusätzliche Fläche: die Zeile
            trug vorher „vs. Vorperiode (pp)" — dieselbe Aussage transportiert
            der Delta-Chip daneben über Pfeil und Vorzeichen, identisch zu den
            Nachbarkacheln. */}
        <KpiHero
          label="Qualifiziert"
          value={qualiRate}
          format="pct"
          delta={ppDelta(qualiRate, prevQualiRate)}
          deltaLabel={`${INT.format(sum.quali)} von ${INT.format(sum.shows)} Erschienenen`}
          icon={<BadgeCheck size={15} />}
          index={2}
        />
        <KpiHero
          label="Zu Closing geschickt"
          value={zuClosingRate}
          format="pct"
          delta={ppDelta(zuClosingRate, prevZuClosing)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<Handshake size={15} />}
          index={3}
        />
      </KpiRow>

      {/* ── Vergleich ──────────────────────────────────────────────
             NICHT zuklappbar: Zusammen mit der KPI-Reihe darüber ist das die
             Kernaussage des Tabs. Wer sie wegklappen könnte, hätte eine leere
             Seite — und das ist keine Übersichtlichkeit. */}
      <div className="fade-up" style={{ animationDelay: "240ms" }}>
        <AnalyseSection
          title="Vergleich"
          icon={Filter}
          meta="Termine · Show · Qualifiziert · Zu Closing"
          info={
            <InfoText>
              <p style={INFO_P}>
                <strong style={INFO_STRONG}>Show-Quote</strong> = erschienen ÷ (erschienen + nicht erschienen),
                also nur Termine mit erfasstem Ergebnis. Was noch bevorsteht, bleibt aus Zähler und Nenner —
                sonst sähe jeder laufende Zeitraum wie ein Einbruch aus. Bewusst nicht über{" "}
                <code>no_show_count</code>: Dieser Zähler läuft über Neuterminierungen hinweg weiter und trägt
                teils Vorfälle von vor dem Zeitraum, mischt also Ereignisse mit Datensätzen.
              </p>
              <p style={INFO_P}>
                <strong style={INFO_STRONG}>Qualifiziert</strong> = qualifizierte Termine ÷ Erschienene —
                bewusst NICHT ÷ alle Termine, sonst zöge jeder No-Show die Quote mit nach unten und die Zahl
                mischte zwei Ursachen. Das ist die Antwort auf &bdquo;wer addet die falschen Leads&ldquo;.
              </p>
              <p style={INFO_P}>
                <strong style={INFO_STRONG}>Zu Closing</strong> = Closings ÷ qualifizierte Termine. No-Shows und
                Unqualifizierte stehen gar nicht erst im Nenner: Gemessen wird die Konsequenz des Setters, nicht
                die Lead-Qualität.
              </p>
            </InfoText>
          }
        >
          <ComparisonTable
            columns={[
              { key: "termine", label: "Termine", format: "int" },
              { key: "showRate", label: "Show-Quote", format: "pct", deltaVsAvg: true },
              { key: "qualiRate", label: "Qualifiziert", format: "pct", deltaVsAvg: true },
              { key: "zuClosing", label: "Zu Closing", format: "pct", deltaVsAvg: true },
            ]}
            rows={tableRows}
            average={average}
            averageLabel="Gesamt"
          />
        </AnalyseSection>
      </div>

      {/* ── Fortschritt ────────────────────────────────────────────
             Startet zugeklappt: ein Verlaufs-Chart beantwortet keine Frage,
             die man beim Öffnen der Seite stellt — er beantwortet die zweite. */}
      <div className="fade-up" style={{ animationDelay: "280ms" }}>
        <AnalyseSection
          title="Fortschritt im Zeitraum"
          icon={TrendingUp}
          // Menge zuerst: Ein zugeklappter Balken „kumuliert" verrät nicht, ob
          // dahinter eine Kurve oder eine leere Achse steckt.
          meta={`${INT.format(sum.termine)} Termine · kumuliert`}
          collapsible
          defaultOpen={false}
          info={
            <InfoText>
              <p style={INFO_P}>
                Die Kurven kumulieren über den Zeitraum: Sie steigen, solange etwas dazukommt, und laufen flach,
                wenn nichts passiert.
              </p>
              <p style={INFO_P}>
                &bdquo;Zu Closing geschickt&ldquo; ist als einzige Reihe eine Quote und liegt auf der rechten
                Achse — Closings je qualifiziertem Termin.
              </p>
            </InfoText>
          }
        >
          <CumulativeProgressChart
            buckets={buckets}
            series={[
              { key: "termine", label: "Termine", kind: "count", values: termineByBucket, defaultOn: true },
              { key: "shows", label: "Shows", kind: "count", values: showsByBucket, defaultOn: true },
              { key: "quali", label: "Qualifiziert", kind: "count", values: qualiByBucket, defaultOn: true },
              {
                key: "zuClosing",
                label: "Zu Closing geschickt",
                kind: "rate",
                values: closingByBucket,
                denominator: qualiByBucket,
              },
            ]}
            rangeLabel={rangeLabelOf(from, to)}
          />
        </AnalyseSection>
      </div>

      {/* ── Charts-Reihe ───────────────────────────────────────────
             Beide zugeklappt, und zwar GEMEINSAM: Die zwei Karten stehen in
             einem Raster nebeneinander und werden auf gleiche Höhe gezogen —
             eine offene neben einer geschlossenen ergäbe eine leere Karte. */}
      <div
        className="analyse-row fade-up"
        data-split="chart"
        style={{ animationDelay: "320ms" }}
      >
        <AnalyseSection
          title="Termine im Verlauf"
          icon={BarChart3}
          meta={`${INT.format(sum.termine)} Termine · je Person`}
          collapsible
          defaultOpen={false}
        >
          <BucketBarChart buckets={buckets} perUser={perUser} />
        </AnalyseSection>
        <AnalyseSection
          title="Quellen-Split"
          icon={PieChart}
          // Anzahl der Segmente statt der Termin-Summe: Die Termin-Zahl steht
          // schon in der Kachel oben und in der Karte daneben — hier ist die
          // offene Frage, wie viele Kanäle überhaupt beitragen.
          meta={`${quellenData.length} Quellen`}
          collapsible
          defaultOpen={false}
        >
          <DonutChart data={quellenData} centerLabel={INT.format(sum.termine)} centerSub="Termine" />
        </AnalyseSection>
      </div>

      {/* ── Quelle des Termins ─────────────────────────────────────
             Startet offen: die eine Detailauswertung, die der Auftraggeber
             ausdrücklich sichtbar behalten wollte. */}
      <div className="fade-up" style={{ animationDelay: "400ms" }}>
        <AnalyseSection
          title="Quelle des Termins"
          icon={CalendarClock}
          meta="woher kommt der bessere Termin?"
          collapsible
          info={
            <InfoText>
              <p style={INFO_P}>
                Aufgeschlüsselt nach <code>source_detail</code>, wo der Termin einen Freitext-Ursprung trägt
                (&bdquo;Social Selling&ldquo;, &bdquo;Empfehlung …&ldquo;) — sonst nach dem Kanal. Ohne diese
                Auflösung landeten alle manuell gebuchten Termine im Sammeltopf &bdquo;Manuell&ldquo;.
              </p>
              <p style={INFO_P}>
                Groß-/Kleinschreibung wird zusammengefasst; die zweite Zeile nennt den Kanal, unter dem eine
                Freitext-Quelle im Donut steckt.
              </p>
            </InfoText>
          }
        >
          <MetricTable
            label="Quelle"
            columns={[
              { key: "n", label: "Termine", format: "int" },
              { key: "showRate", label: "Show-Quote", format: "pct" },
              { key: "qualiRate", label: "Qualifiziert", format: "pct", emphasis: true },
              { key: "zuClosing", label: "Zu Closing", format: "pct" },
            ]}
            rows={sourceRows}
            minWidth={480}
            emptyHint="Im Zeitraum keine Termine erfasst."
          />
        </AnalyseSection>
      </div>

      {/* ── Alles Weitere: eingeklappt ──────────────────────────
             Auftraggeber: „rest kann raus erstmal, unnötig". Das „erstmal"
             ist der Grund, warum es hier steht statt gelöscht zu sein. */}
      <MoreAnalyses meta="Zeitfenster · Termin-Art · Branche · Kriterien · Qualität · Status">
        {/* ── Wann erscheinen Leads? ─────────────────────────────
               Vorlaufzeit, Wochentag und Uhrzeit sind drei Antworten auf EINE
               Frage — als drei Karten nebeneinander liest man sie als drei
               Themen. Deshalb ein Block mit drei Achsen. */}
        <AnalyseSection
          title="Wann erscheinen Leads?"
          icon={Timer}
          // Die Legende („Balken = Termine …") stand hier und steht ohnehin im
          // Info-Popover — zugeklappt hilft sie niemandem. An ihre Stelle
          // treten Menge und Umfang: drei Achsen über so viele Termine.
          meta={`3 Zeitachsen · ${INT.format(sum.termine)} Termine`}
          collapsible
          defaultOpen={false}
          info={
            <InfoText>
              <p style={INFO_P}>
                Je weiter ein Termin in der Zukunft liegt, desto mehr kann dazwischenkommen. Sackt die
                Show-Quote im Vorlauf nach hinten ab, ist kürzer terminieren der billigste Hebel — nicht mehr
                Termine.
              </p>
              <p style={INFO_P}>
                Balken = Anzahl Termine, die Zeile darunter = Show-Quote. Der grün hervorgehobene Balken ist
                jeweils die beste Show-Quote der Reihe.
              </p>
            </InfoText>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
            <div>
              <div className="eyebrow eyebrow-muted" style={{ marginBottom: "var(--sp-5)" }}>
                Vorlauf: Buchung → Termin
                {leadUnknown > 0 && ` · ${INT.format(leadUnknown)} ohne Termindatum`}
              </div>
              <QuoteColumns
                perDay={LEAD_LABELS.map((label, i) => ({
                  label,
                  n: leadCells[i].n,
                  quote: pct(leadCells[i].shows, leadCells[i].shows + leadCells[i].noShows),
                }))}
              />
            </div>
            <div>
              <div className="eyebrow eyebrow-muted" style={{ marginBottom: "var(--sp-5)" }}>
                Wochentag des Termins
              </div>
              <QuoteColumns
                perDay={WEEKDAY_LABELS.map((label, i) => ({
                  label,
                  n: weekdayCells[i].n,
                  quote: pct(weekdayCells[i].shows, weekdayCells[i].shows + weekdayCells[i].noShows),
                }))}
              />
            </div>
            <div>
              <div className="eyebrow eyebrow-muted" style={{ marginBottom: "var(--sp-5)" }}>
                Uhrzeit des Termins · Berliner Zeit
                {timeUnknown > 0 && ` · ${INT.format(timeUnknown)} ohne Uhrzeit`}
              </div>
              <QuoteColumns
                perDay={HOUR_LABELS.map((label, i) => ({
                  label,
                  n: hourCells[i].n,
                  quote: pct(hourCells[i].shows, hourCells[i].shows + hourCells[i].noShows),
                }))}
              />
            </div>
          </div>
        </AnalyseSection>

        {/* ── Termin-Art + Branche ──────────────────────────────
               Zugeklappt, und zwar BEIDE: Die Karten stehen nebeneinander in
               einem Raster und werden auf gleiche Höhe gezogen — eine offene
               neben einer geschlossenen ergäbe eine halb leere Karte. */}
        <div className="analyse-row">
          <div style={{ display: "grid" }}>
            <AnalyseSection
              title="Termin-Art"
              icon={Video}
              meta={`${kindRows.length} Arten · ${INT.format(sum.termine)} Termine`}
              collapsible
              defaultOpen={false}
            >
              <MetricTable
                label="Art"
                columns={[
                  { key: "n", label: "Termine", format: "int" },
                  { key: "showRate", label: "Show-Quote", format: "pct", emphasis: true },
                  { key: "qualiRate", label: "Qualifiziert", format: "pct" },
                  { key: "zuClosing", label: "Zu Closing", format: "pct" },
                ]}
                rows={kindRows}
                minWidth={420}
              />
            </AnalyseSection>
          </div>
          <div style={{ display: "grid" }}>
            <AnalyseSection
              title="Branche"
              icon={Briefcase}
              meta={`${brancheKnown} Branchen · ${INT.format(brancheOhne)} ohne Angabe`}
              collapsible
              defaultOpen={false}
            >
              <MetricTable
                label="Branche"
                columns={[
                  { key: "n", label: "Termine", format: "int" },
                  { key: "showRate", label: "Show-Quote", format: "pct" },
                  { key: "qualiRate", label: "Qualifiziert", format: "pct", emphasis: true },
                  { key: "zuClosing", label: "Zu Closing", format: "pct" },
                ]}
                rows={brancheRows}
                minWidth={420}
                emptyHint="Keine Branche erfasst."
              />
            </AnalyseSection>
          </div>
        </div>

        {/* ── Qualifikations-Kriterien ───────────────────────── */}
        <AnalyseSection
          title="Welches Kriterium sagt den Abschluss voraus?"
          icon={ListChecks}
          meta={`${criteriaRows.length} Kriterien · Ja vs. Nein`}
          collapsible
          defaultOpen={false}
          info={
            <InfoText>
              <p style={INFO_P}>
                Δ ist der Abstand der beiden Closing-Quoten in Prozentpunkten — je größer, desto trennschärfer
                ist die Frage. &bdquo;Unklar&ldquo; beim Budget bleibt außen vor, weil es keine Aussage ist.
              </p>
              <p style={INFO_P}>
                Bewusst anderer Nenner als bei der KPI-Kachel: Hier wird gegen die{" "}
                <strong style={INFO_STRONG}>Erschienenen</strong> gerechnet, weil genau die Frage ist, ob das
                Kriterium den Weg durch die Qualifizierung ins Closing vorhersagt — die Qualifizierung gehört
                hier also in den Nenner.
              </p>
            </InfoText>
          }
        >
          <MetricTable
            label="Kriterium"
            columns={[
              { key: "jaN", label: "Ja", format: "int" },
              { key: "jaClosing", label: "Closing bei Ja", format: "pct", emphasis: true },
              { key: "neinN", label: "Nein", format: "int" },
              { key: "neinClosing", label: "Closing bei Nein", format: "pct" },
              { key: "spread", label: "Δ pp", format: "num1" },
            ]}
            rows={criteriaRows}
            minWidth={560}
            emptyHint="Noch keine Qualifikations-Antworten erfasst."
          />
        </AnalyseSection>

        {/* ── Qualitäts-Reihe ──────────────────────────────────
               Ebenfalls beide zugeklappt — gleiches Raster, gleiche Begründung
               wie eine Reihe darüber. */}
        <div className="analyse-row" data-split="auto">
          <AnalyseSection
            title="Budget (8k+)"
            icon={Wallet}
            meta={`${INT.format(budgetTotal)} Angaben`}
            collapsible
            defaultOpen={false}
          >
            <DistBars items={budgetItems} total={budgetTotal} />
          </AnalyseSection>
          {/* Durchschnitt und Verteilung gehören zusammen: ein Ø 5,5 kann
              „alle mittelmäßig" oder „halb heiß, halb kalt" heißen. */}
          <AnalyseSection
            title="Lead-Qualität"
            icon={GaugeIcon}
            // Kernwert statt Skalenhinweis: „Skala 1–10" sagt zugeklappt nur,
            // WIE gemessen wird, nicht WAS herauskam. Die beiden Ø-Werte sind
            // genau die Zahl, wegen der man aufklappt (oder eben nicht).
            meta={
              avgPain === null && avgWarmth === null
                ? "noch keine Bewertungen"
                : `Ø Pain ${fmt1(avgPain)} · Ø Wärme ${fmt1(avgWarmth)}`
            }
            collapsible
            defaultOpen={false}
            info={
              <InfoText>
                <p style={INFO_P}>
                  Ø-Wert und Verteilung stehen bewusst zusammen: Ein Ø 5,5 kann &bdquo;alle
                  mittelmäßig&ldquo; oder &bdquo;halb heiß, halb kalt&ldquo; heißen — erst die Balken darunter
                  entscheiden das.
                </p>
                <p style={INFO_P}>
                  Gerechnet wird nur über die Termine, bei denen der Wert erfasst wurde; die Zeile unter jedem
                  Balken nennt die Anzahl.
                </p>
              </InfoText>
            }
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
              <div>
                <GaugeBar label="Ø Pain" value={avgPain} />
                <p style={mutedNote}>aus {INT.format(painN)} Bewertungen</p>
                <div style={{ marginTop: "var(--sp-5)" }}>
                  <DistBars items={scaleLabels.map((l, i) => ({ label: l, value: painBins[i], color: "var(--viz-1)" }))} />
                </div>
              </div>
              <div>
                <GaugeBar label="Ø Wärme" value={avgWarmth} />
                <p style={mutedNote}>aus {INT.format(warmthN)} Bewertungen</p>
                <div style={{ marginTop: "var(--sp-5)" }}>
                  <DistBars items={scaleLabels.map((l, i) => ({ label: l, value: warmthBins[i], color: "var(--viz-2)" }))} />
                </div>
              </div>
            </div>
          </AnalyseSection>
        </div>

        {/* ── Status-Verteilung ──────────────────────────────── */}
        <AnalyseSection
          title="Status-Verteilung"
          icon={ListChecks}
          meta={`${INT.format(statusTotal)} Termine · ${STATUS_META.length} Status`}
          collapsible
          defaultOpen={false}
          info={
            <InfoText>
              <p style={INFO_P}>
                Der Status ist der zuletzt erfasste Stand des Termins, nicht seine Geschichte:
                &bdquo;Closing gelegt&ldquo; setzt voraus, dass zuvor qualifiziert wurde, und taucht deshalb
                nicht zusätzlich unter &bdquo;Qualifiziert&ldquo; auf.
              </p>
              <p style={INFO_P}>
                &bdquo;Offen&ldquo; sind Termine ohne erfasstes Ergebnis — im laufenden Zeitraum meist die, die
                noch bevorstehen.
              </p>
            </InfoText>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {STATUS_META.map((s) => (
              <div key={s.key} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Badge tone={s.tone}>{s.label}</Badge>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: "var(--fs-base)",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {statusCounts[s.key].toLocaleString("de-DE")}
                </span>
              </div>
            ))}
          </div>
          <Footnote>
            {noShowRepeat.mehrfach > 0
              ? `${INT.format(noShowRepeat.einmal)} Termine hatten genau einen No-Show, ${INT.format(noShowRepeat.mehrfach)} mehr als einen — Letztere sind Kandidaten zum Abhaken statt zum dritten Neu-Terminieren.`
              : `${INT.format(noShowRepeat.einmal)} Termine hatten einen No-Show im Verlauf.`}
          </Footnote>
        </AnalyseSection>
      </MoreAnalyses>
    </>
  );
}
