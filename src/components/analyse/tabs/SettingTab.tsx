import type { CSSProperties } from "react";
import {
  BadgeCheck, BarChart3, Briefcase, CalendarCheck, CalendarClock, Eye, Filter,
  Gauge as GaugeIcon, Handshake, ListChecks, PieChart, Timer, Video, Wallet,
} from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { loadSettingCalls, type AnalyseSettingCall } from "@/lib/analyseData";
import {
  WEEKDAY_LABELS, buildBuckets, bucketIndex, bucketOf, daysBetween, pct, settingEffDate, weekdayIndex,
  type Granularity, type QuelleKey,
} from "@/lib/analyse";
import { toBerlinSlot } from "@/lib/apptTime";
import { AnalyseSection } from "@/components/analyse/AnalyseSection";
import { ComparisonTable, type ComparisonRow } from "@/components/analyse/ComparisonTable";
import { Footnote, MetricTable, type MetricRow } from "@/components/analyse/AnalyseTables";
import { BucketBarChart } from "@/components/analyse/AnalyseCharts";
import { DistBars, DonutChart, GaugeBar, KpiHero, QuoteColumns, KpiRow } from "@/components/analyse/AnalyseViz";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type { SettingStatus } from "@/lib/types";

// Setting-Flow: Termine → Shows → Qualifikation → Closing gelegt.
// Ein einziger Fetch deckt aktuelles UND Vorperioden-Fenster ab — der Split
// passiert in JS über settingEffDate.
//
// Der zweite Teil des Tabs fragt nicht mehr „wie viele", sondern „woran liegt
// es": Vorlaufzeit, Termin-Zeitfenster, Termin-Art, Branche und die vier
// Qualifikations-Kriterien, jeweils gegen Show- bzw. Closing-Quote.

type Member = { user_id: string; username: string };

const STATUS_META: { key: SettingStatus; label: string; tone: BadgeTone }[] = [
  { key: "offen", label: "Offen", tone: "info" },
  { key: "no_show", label: "No-Show", tone: "error" },
  { key: "qualifiziert", label: "Qualifiziert", tone: "success" },
  { key: "closing_gelegt", label: "Closing gelegt", tone: "brand" },
  { key: "unqualifiziert", label: "Unqualifiziert", tone: "warning" },
  { key: "dead", label: "Dead", tone: "error" },
];

type Totals = {
  termine: number;
  shows: number;
  noShows: number;
  quali: number;
  closing: number;
  dead: number;
};

const ZERO = (): Totals => ({ termine: 0, shows: 0, noShows: 0, quali: 0, closing: 0, dead: 0 });

const INT = new Intl.NumberFormat("de-DE");

/** Ein Setting gilt als qualifiziert, wenn der Lead da war und weiterging. */
function isQualified(r: AnalyseSettingCall): boolean {
  return r.show_status === "show" && (r.status === "qualifiziert" || r.status === "closing_gelegt");
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

// Vorlaufzeit: wie viele Tage liegen zwischen Buchung und Termin. Kurzfristige
// Termine zeigen erfahrungsgemäß bessere Show-Quoten — die Frage ist, wie stark.
const LEAD_BOUNDS = [0, 1, 3, 7, 14] as const;
const LEAD_LABELS = ["Selber Tag", "1 Tag", "2–3 Tage", "4–7 Tage", "8–14 Tage", "> 14 Tage"];

// Uhrzeit-Blöcke in Berliner Wandzeit (Minuten ab Mitternacht).
const HOUR_BOUNDS = [10 * 60 - 1, 12 * 60 - 1, 14 * 60 - 1, 16 * 60 - 1, 18 * 60 - 1] as const;
const HOUR_LABELS = ["vor 10", "10–12", "12–14", "14–16", "16–18", "ab 18"];

const SOURCE_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  telefon: "Telefon",
  manuell: "Manuell",
  inbound: "Inbound",
  website: "Website",
};

const BRANCHE_LABELS: Record<string, string> = {
  agentur: "Agentur",
  coach: "Coach",
  consultant: "Consultant",
  sonstiges: "Sonstiges",
};

/** Zähl-Eimer für „Menge + drei Quoten" — die Form fast aller Schnitte hier. */
type Cell = { n: number; shows: number; noShows: number; quali: number; closing: number };
const ZERO_CELL = (): Cell => ({ n: 0, shows: 0, noShows: 0, quali: 0, closing: 0 });

function addCell(cell: Cell, r: AnalyseSettingCall): void {
  cell.n += 1;
  if (r.show_status === "show") cell.shows += 1;
  cell.noShows += r.no_show_count ?? 0;
  if (isQualified(r)) cell.quali += 1;
  if (r.show_status === "show" && r.status === "closing_gelegt") cell.closing += 1;
}

function cellValues(cell: Cell) {
  return {
    n: cell.n,
    showRate: pct(cell.shows, cell.shows + cell.noShows),
    qualiRate: pct(cell.quali, cell.shows),
    closingRate: pct(cell.closing, cell.shows),
  };
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
}) {
  const supabase = await createClient();
  const hasPrev = Boolean(prevFrom && prevTo);
  const allRows = await loadSettingCalls(supabase, access, canCompare);
  const buckets = buildBuckets(from, to, granularity);

  const selectedIds = new Set(selectedMembers.map((m) => m.user_id));
  const nameById = new Map(selectedMembers.map((m) => [m.user_id, m.username]));

  const totals = new Map<string, Totals>();
  const perUser: Record<string, Record<string, number>> = {};
  for (const m of selectedMembers) {
    totals.set(m.username, ZERO());
    perUser[m.username] = {};
  }
  const statusCounts: Record<SettingStatus, number> = {
    offen: 0, no_show: 0, qualifiziert: 0, closing_gelegt: 0, unqualifiziert: 0, dead: 0,
  };

  const prev = ZERO();
  const termineByBucket: Record<string, number> = {};
  const sourceCounts = { linkedin: 0, telefon: 0, manuell: 0, sonstige: 0 };
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
  const sourceCells = new Map<string, Cell>();
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
    const uid = r.created_by_user_id ?? "";
    if (!selectedIds.has(uid)) continue;

    // ── Vorperioden-Fenster ────────────────────────────────────
    if (hasPrev && day >= prevFrom! && day <= prevTo!) {
      prev.termine += 1;
      if (r.show_status === "show") prev.shows += 1;
      prev.noShows += r.no_show_count ?? 0;
      if (isQualified(r)) prev.quali += 1;
      if (r.show_status === "show" && r.status === "closing_gelegt") prev.closing += 1;
      continue;
    }

    // ── Aktuelles Fenster ──────────────────────────────────────
    if (day < from || day > to) continue;
    const name = nameById.get(uid)!;

    const t = totals.get(name)!;
    t.termine += 1;
    if (r.show_status === "show") t.shows += 1;
    // Über no_show_count statt show_status: ein neuterminierter No-Show steht auf
    // "offen"/"show", sein Nichterscheinen zählt trotzdem gegen die Show-Quote.
    t.noShows += r.no_show_count ?? 0;
    if (isQualified(r)) t.quali += 1;
    if (r.show_status === "show" && r.status === "closing_gelegt") t.closing += 1;
    if (r.status === "dead") t.dead += 1;
    statusCounts[r.status] += 1;

    const bk = bucketOf(day, from, to, granularity);
    perUser[name][bk] = (perUser[name][bk] ?? 0) + 1;
    termineByBucket[bk] = (termineByBucket[bk] ?? 0) + 1;

    if (r.source_type === "linkedin") sourceCounts.linkedin += 1;
    else if (r.source_type === "telefon") sourceCounts.telefon += 1;
    else if (r.source_type === "manuell") sourceCounts.manuell += 1;
    else sourceCounts.sonstige += 1;

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
    addCell(bucketOfMap(sourceCells, (r.source_type ?? "").trim() || "sonstige"), r);

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
  const sum = ZERO();
  for (const name of names) {
    const t = totals.get(name)!;
    sum.termine += t.termine;
    sum.shows += t.shows;
    sum.noShows += t.noShows;
    sum.quali += t.quali;
    sum.closing += t.closing;
    sum.dead += t.dead;
  }

  // ── KPI-Werte + Deltas ───────────────────────────────────────
  const showRate = pct(sum.shows, sum.shows + sum.noShows);
  const qualiRate = pct(sum.quali, sum.shows);
  const closingRate = pct(sum.closing, sum.shows);
  const prevShowRate = pct(prev.shows, prev.shows + prev.noShows);
  const prevQualiRate = pct(prev.quali, prev.shows);
  const prevClosingRate = pct(prev.closing, prev.shows);
  const termineSpark = buckets.map((b) => termineByBucket[b.key] ?? 0);

  const tableRows: ComparisonRow[] = names.map((name) => {
    const t = totals.get(name)!;
    const withStatus = t.shows + t.noShows;
    return {
      name,
      values: {
        termine: t.termine,
        shows: t.shows,
        noShows: t.noShows,
        showRate: pct(t.shows, withStatus),
        qualiRate: pct(t.quali, t.shows),
        closingRate: pct(t.closing, t.shows),
        dead: t.dead,
      },
    };
  });

  const average = {
    termine: sum.termine,
    shows: sum.shows,
    noShows: sum.noShows,
    showRate,
    qualiRate,
    closingRate,
    dead: sum.dead,
  };

  const statusTotal = STATUS_META.reduce((acc, s) => acc + statusCounts[s.key], 0);

  // ── Quellen-Split (Donut) ────────────────────────────────────
  const quellenData = [
    { name: "LinkedIn", value: sourceCounts.linkedin, color: "var(--viz-1)" },
    { name: "Telefon", value: sourceCounts.telefon, color: "var(--viz-2)" },
    { name: "Manuell", value: sourceCounts.manuell, color: "var(--viz-3)" },
    { name: "Sonstige", value: sourceCounts.sonstige, color: "var(--viz-6)" },
  ].filter((d) => d.value > 0);

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
  const sourceRows = cellRows([...sourceCells.entries()], (k) => SOURCE_LABELS[k] ?? "Sonstige", sum.termine);

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
      {/* ── KPI-Heroes ─────────────────────────────────────────── */}
      <KpiRow>
        <KpiHero
          label="Termine"
          value={sum.termine}
          format="int"
          delta={pctChange(sum.termine, prev.termine)}
          spark={termineSpark}
          icon={<CalendarCheck size={15} />}
          index={0}
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
        <KpiHero
          label="Qualifiziert-Quote"
          value={qualiRate}
          format="pct"
          delta={ppDelta(qualiRate, prevQualiRate)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<BadgeCheck size={15} />}
          index={2}
        />
        <KpiHero
          label="Closing-Quote"
          value={closingRate}
          format="pct"
          delta={ppDelta(closingRate, prevClosingRate)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<Handshake size={15} />}
          index={3}
        />
      </KpiRow>

      {/* ── Vergleich ──────────────────────────────────────────── */}
      <div className="fade-up" style={{ animationDelay: "240ms" }}>
        <AnalyseSection title="Vergleich" icon={Filter} meta="Termine · Shows · Qualifikation · Closing">
          <ComparisonTable
            columns={[
              { key: "termine", label: "Termine", format: "int" },
              { key: "shows", label: "Shows", format: "int" },
              { key: "noShows", label: "No-Shows", format: "int" },
              { key: "showRate", label: "Show-Quote", format: "pct", deltaVsAvg: true },
              { key: "qualiRate", label: "Qualifiziert-Quote", format: "pct", deltaVsAvg: true },
              { key: "closingRate", label: "Closing-Quote", format: "pct", deltaVsAvg: true },
              { key: "dead", label: "Dead", format: "int" },
            ]}
            rows={tableRows}
            average={average}
            averageLabel="Gesamt"
          />
          <Footnote>
            Die Show-Quote rechnet gegen <code>no_show_count</code> statt gegen den aktuellen Status: ein
            neuterminierter No-Show steht später auf &bdquo;offen&ldquo;/&bdquo;show&ldquo;, sein Nichterscheinen zählt trotzdem.
          </Footnote>
        </AnalyseSection>
      </div>

      {/* ── Charts-Reihe ───────────────────────────────────────── */}
      <div
        className="analyse-row fade-up"
        data-split="chart"
        style={{ animationDelay: "300ms" }}
      >
        <AnalyseSection title="Termine im Verlauf" icon={BarChart3}>
          <BucketBarChart buckets={buckets} perUser={perUser} />
        </AnalyseSection>
        <AnalyseSection title="Quellen-Split" icon={PieChart} meta={`${INT.format(sum.termine)} Termine`}>
          <DonutChart data={quellenData} centerLabel={INT.format(sum.termine)} centerSub="Termine" />
        </AnalyseSection>
      </div>

      {/* ── Wann erscheinen Leads? ─────────────────────────────────
             Vorlaufzeit, Wochentag und Uhrzeit sind drei Antworten auf EINE
             Frage — als drei Karten nebeneinander liest man sie als drei
             Themen. Deshalb ein Block mit drei Achsen. */}
      <div className="fade-up" style={{ animationDelay: "340ms" }}>
        <AnalyseSection
          title="Wann erscheinen Leads?"
          icon={Timer}
          meta="Balken = Termine · Zeile darunter = Show-Quote"
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
          <Footnote>
            Je weiter ein Termin in der Zukunft liegt, desto mehr kann dazwischenkommen. Sackt die Show-Quote im
            Vorlauf nach hinten ab, ist kürzer terminieren der billigste Hebel — nicht mehr Termine. Der grün
            hervorgehobene Balken ist jeweils die beste Show-Quote.
          </Footnote>
        </AnalyseSection>
      </div>

      {/* ── Termin-Art + Quelle ────────────────────────────────── */}
      <div className="analyse-row">
        <div className="fade-up" style={{ display: "grid", animationDelay: "460ms" }}>
          <AnalyseSection title="Termin-Art" icon={Video} meta="Video-Link vs. Telefon">
            <MetricTable
              label="Art"
              columns={[
                { key: "n", label: "Termine", format: "int" },
                { key: "showRate", label: "Show-Quote", format: "pct", emphasis: true },
                { key: "qualiRate", label: "Quali-Quote", format: "pct" },
                { key: "closingRate", label: "Closing-Quote", format: "pct" },
              ]}
              rows={kindRows}
              minWidth={420}
            />
          </AnalyseSection>
        </div>
        <div className="fade-up" style={{ display: "grid", animationDelay: "500ms" }}>
          <AnalyseSection title="Quelle → Qualität" icon={CalendarClock} meta="woher kommt der bessere Termin?">
            <MetricTable
              label="Quelle"
              columns={[
                { key: "n", label: "Termine", format: "int" },
                { key: "showRate", label: "Show-Quote", format: "pct" },
                { key: "qualiRate", label: "Quali-Quote", format: "pct", emphasis: true },
                { key: "closingRate", label: "Closing-Quote", format: "pct" },
              ]}
              rows={sourceRows}
              minWidth={420}
            />
          </AnalyseSection>
        </div>
      </div>

      {/* ── Branche ────────────────────────────────────────────── */}
      <div className="fade-up" style={{ animationDelay: "540ms" }}>
        <AnalyseSection title="Branche" icon={Briefcase} meta="Wo läuft die Qualifikation durch?">
          <MetricTable
            label="Branche"
            columns={[
              { key: "n", label: "Termine", format: "int" },
              { key: "showRate", label: "Show-Quote", format: "pct" },
              { key: "qualiRate", label: "Quali-Quote", format: "pct", emphasis: true },
              { key: "closingRate", label: "Closing-Quote", format: "pct" },
            ]}
            rows={brancheRows}
            minWidth={480}
            emptyHint="Keine Branche erfasst."
          />
        </AnalyseSection>
      </div>

      {/* ── Qualifikations-Kriterien ───────────────────────────── */}
      <div className="fade-up" style={{ animationDelay: "580ms" }}>
        <AnalyseSection title="Welches Kriterium sagt den Abschluss voraus?" icon={ListChecks} meta="Closing-Quote bei Ja vs. Nein">
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
          <Footnote>
            Δ ist der Abstand der beiden Closing-Quoten in Prozentpunkten — je größer, desto trennschärfer ist die
            Frage. &bdquo;Unklar&ldquo; beim Budget bleibt außen vor, weil es keine Aussage ist.
          </Footnote>
        </AnalyseSection>
      </div>

      {/* ── Qualitäts-Reihe ────────────────────────────────────── */}
      <div
        className="analyse-row fade-up"
        data-split="auto"
        style={{
          animationDelay: "620ms",
        }}
      >
        <AnalyseSection title="Budget (8k+)" icon={Wallet} meta={`${INT.format(budgetTotal)} Angaben`}>
          <DistBars items={budgetItems} total={budgetTotal} />
        </AnalyseSection>
        {/* Durchschnitt und Verteilung gehören zusammen: ein Ø 5,5 kann
            „alle mittelmäßig" oder „halb heiß, halb kalt" heißen. */}
        <AnalyseSection title="Lead-Qualität" icon={GaugeIcon} meta="Skala 1–10">
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

      {/* ── Status-Verteilung ──────────────────────────────────── */}
      <div className="fade-up" style={{ animationDelay: "660ms" }}>
        <AnalyseSection title="Status-Verteilung" icon={ListChecks} meta={`${statusTotal} gesamt`}>
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
      </div>
    </>
  );
}
