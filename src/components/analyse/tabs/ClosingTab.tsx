import {
  BarChart3, Clock, CreditCard, Euro, FileSignature, Filter, PieChart, Receipt, Timer, TrendingUp,
  Trophy, XCircle,
} from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { loadClosingCalls, loadSettingCalls } from "@/lib/analyseData";
import {
  NUM, bucketIndex, buildBuckets, bucketOf, closingEffDate, eur, fmtPct, pct, settingEffDate,
  type Granularity,
} from "@/lib/analyse";
import { AnalyseSection } from "@/components/analyse/AnalyseSection";
import { ComparisonTable, type ComparisonRow } from "@/components/analyse/ComparisonTable";
import { Footnote, MetricTable, StatRow, type MetricRow } from "@/components/analyse/AnalyseTables";
import { BucketBarChart } from "@/components/analyse/AnalyseCharts";
import { DistBars, DonutChart, KpiHero, QuoteColumns, KpiRow } from "@/components/analyse/AnalyseViz";

// Closing-Flow: Closings → Shows → Gewonnen/Verloren → Umsatz.
// Ein einziger Fetch deckt aktuelles UND Vorperioden-Fenster ab — der Split
// passiert in JS über closingEffDate.
//
// Die Setting-Calls kommen mit dazu, aber nicht als Kennzahl: sie liefern die
// Herkunft (source_type) und den Termin, gegen den die Abschluss-Geschwindigkeit
// gerechnet wird.

type Member = { user_id: string; username: string };

type Totals = {
  closings: number;
  shows: number;
  noShows: number;
  won: number;
  lost: number;
  revenue: number;
};

const ZERO = (): Totals => ({ closings: 0, shows: 0, noShows: 0, won: 0, lost: 0, revenue: 0 });

const INT = new Intl.NumberFormat("de-DE");

const SOURCE_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  telefon: "Telefon",
  manuell: "Manuell",
  inbound: "Inbound",
  website: "Website",
};

// Abschluss-Geschwindigkeit: Tage vom Setting-Termin bis zum Closing-Gespräch.
const SPEED_BOUNDS = [0, 2, 7, 14, 30] as const;
const SPEED_LABELS = ["Selber Tag", "1–2 Tage", "3–7 Tage", "8–14 Tage", "15–30 Tage", "> 30 Tage"];

// Deal-Größen in Euro.
const SIZE_BOUNDS = [2000, 5000, 10000, 25000] as const;
const SIZE_LABELS = ["≤ 2k", "2–5k", "5–10k", "10–25k", "> 25k"];

/** %-Änderung vs. Vorperiode für Zähl-/EUR-KPIs; Vorwert 0 → null. */
function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

/** Prozentpunkt-Differenz zweier Quoten; fehlende Basis (null) → null. */
function ppDelta(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null) return null;
  return Math.round((cur - prev) * 10) / 10;
}

type SourceCell = { closings: number; won: number; lost: number; revenue: number };
const ZERO_SOURCE = (): SourceCell => ({ closings: 0, won: 0, lost: 0, revenue: 0 });

export async function ClosingTab({
  access,
  from,
  to,
  prevFrom,
  prevTo,
  granularity,
  selectedMembers,
  canCompare,
}: {
  access: AccessContext;
  from: string;
  to: string;
  selectedMembers: Member[];
  canCompare: boolean;
  prevFrom?: string;
  prevTo?: string;
  granularity?: Granularity;
}) {
  const supabase = await createClient();
  const hasPrev = Boolean(prevFrom && prevTo);

  const [allRows, settings] = await Promise.all([
    loadClosingCalls(supabase, access, canCompare),
    loadSettingCalls(supabase, access, canCompare),
  ]);
  const buckets = buildBuckets(from, to, granularity);

  // Setting-Index: Herkunft + Termin für Velocity und Quellen-Zuordnung.
  const settingById = new Map(settings.map((s) => [s.id, s]));

  const selectedIds = new Set(selectedMembers.map((m) => m.user_id));
  const nameById = new Map(selectedMembers.map((m) => [m.user_id, m.username]));

  const totals = new Map<string, Totals>();
  const revPerUser: Record<string, Record<string, number>> = {};
  for (const m of selectedMembers) {
    totals.set(m.username, ZERO());
    revPerUser[m.username] = {};
  }

  const lostReasons = new Map<string, number>();
  // Zahlungsarten gewonnener Deals: case-insensitiv dedupliziert,
  // erste Schreibweise gewinnt als Anzeige-Label.
  const paymentTypes = new Map<string, { label: string; value: number }>();
  const statusCounts = { offen: 0, gewonnen: 0, verloren: 0, nachfassen: 0 };
  const revenueByBucket: Record<string, number> = {};

  // Neue Schnitte
  const speedCells = SPEED_LABELS.map(() => ({ n: 0, won: 0, lost: 0 }));
  let speedUnknown = 0;
  const sizeBins = SIZE_LABELS.map(() => ({ n: 0, revenue: 0 }));
  const sourceCells = new Map<string, SourceCell>();
  let signatureYes = 0;
  let signatureKnown = 0;
  const startLead: number[] = [];

  const prev = { revenue: 0, won: 0, lost: 0, open: 0 };

  for (const r of allRows) {
    const day = closingEffDate(r);
    const uid = r.created_by_user_id ?? "";
    if (!selectedIds.has(uid)) continue;

    // ── Vorperioden-Fenster ────────────────────────────────────
    if (hasPrev && day >= prevFrom! && day <= prevTo!) {
      if (r.status === "gewonnen") {
        prev.won += 1;
        prev.revenue += NUM(r.deal_volume);
      }
      if (r.status === "verloren") prev.lost += 1;
      if (r.status === "offen" || r.status === "nachfassen") prev.open += 1;
      continue;
    }

    // ── Aktuelles Fenster ──────────────────────────────────────
    if (day < from || day > to) continue;
    const name = nameById.get(uid)!;

    const t = totals.get(name)!;
    t.closings += 1;
    if (r.show_status === "show") t.shows += 1;
    if (r.show_status === "no_show") t.noShows += 1;
    statusCounts[r.status] += 1;

    // Herkunft über das zugehörige Setting.
    const setting = r.setting_call_id ? settingById.get(r.setting_call_id) : undefined;
    const srcKey = setting ? (setting.source_type ?? "sonstige").trim() || "sonstige" : "ohne";
    let src = sourceCells.get(srcKey);
    if (!src) {
      src = ZERO_SOURCE();
      sourceCells.set(srcKey, src);
    }
    src.closings += 1;

    // Abschluss-Geschwindigkeit: Setting-Termin → Closing-Gespräch.
    const settingDay = setting ? settingEffDate(setting) : null;
    if (settingDay && r.call_at) {
      const diff = Math.max(
        Math.round((new Date(`${day}T12:00:00Z`).getTime() - new Date(`${settingDay}T12:00:00Z`).getTime()) / 86400000),
        0,
      );
      const cell = speedCells[bucketIndex(diff, SPEED_BOUNDS)];
      cell.n += 1;
      if (r.status === "gewonnen") cell.won += 1;
      if (r.status === "verloren") cell.lost += 1;
    } else {
      speedUnknown += 1;
    }

    if (r.status === "gewonnen") {
      t.won += 1;
      const vol = NUM(r.deal_volume);
      t.revenue += vol;
      src.won += 1;
      src.revenue += vol;
      const bk = bucketOf(day, from, to, granularity);
      revPerUser[name][bk] = (revPerUser[name][bk] ?? 0) + vol;
      revenueByBucket[bk] = (revenueByBucket[bk] ?? 0) + vol;

      const bin = sizeBins[bucketIndex(vol, SIZE_BOUNDS)];
      bin.n += 1;
      bin.revenue += vol;

      if (r.signature_received !== null) {
        signatureKnown += 1;
        if (r.signature_received) signatureYes += 1;
      }
      const lead = r.contract_start
        ? Math.round((new Date(`${r.contract_start}T12:00:00Z`).getTime() - new Date(`${day}T12:00:00Z`).getTime()) / 86400000)
        : null;
      if (lead !== null) startLead.push(lead);

      const rawPayment = (r.payment_type ?? "").trim();
      const label = rawPayment || "Ohne Angabe";
      const key = label.toLowerCase();
      const entry = paymentTypes.get(key);
      if (entry) entry.value += 1;
      else paymentTypes.set(key, { label, value: 1 });
    }
    if (r.status === "verloren") {
      t.lost += 1;
      src.lost += 1;
      const reason = (r.lost_reason ?? "").trim() || "Ohne Angabe";
      lostReasons.set(reason, (lostReasons.get(reason) ?? 0) + 1);
    }
  }

  const names = selectedMembers.map((m) => m.username);
  const sum = ZERO();
  for (const name of names) {
    const t = totals.get(name)!;
    sum.closings += t.closings;
    sum.shows += t.shows;
    sum.noShows += t.noShows;
    sum.won += t.won;
    sum.lost += t.lost;
    sum.revenue += t.revenue;
  }

  // ── KPI-Werte + Deltas ───────────────────────────────────────
  const winRate = pct(sum.won, sum.won + sum.lost);
  const prevWinRate = pct(prev.won, prev.won + prev.lost);
  const avgDeal = sum.won === 0 ? null : Math.round(sum.revenue / sum.won);
  const prevAvgDeal = prev.won === 0 ? null : Math.round(prev.revenue / prev.won);
  const openPipeline = statusCounts.offen + statusCounts.nachfassen;
  const revenueSpark = buckets.map((b) => revenueByBucket[b.key] ?? 0);
  const medianStartLead =
    startLead.length === 0 ? null : [...startLead].sort((a, b) => a - b)[Math.floor(startLead.length / 2)];

  const tableRows: ComparisonRow[] = names.map((name) => {
    const t = totals.get(name)!;
    return {
      name,
      values: {
        closings: t.closings,
        shows: t.shows,
        showRate: pct(t.shows, t.shows + t.noShows),
        won: t.won,
        lost: t.lost,
        winRate: pct(t.won, t.won + t.lost),
        revenue: t.revenue,
        avgDeal: t.won === 0 ? null : Math.round(t.revenue / t.won),
      },
    };
  });

  const average = {
    closings: sum.closings,
    shows: sum.shows,
    showRate: pct(sum.shows, sum.shows + sum.noShows),
    won: sum.won,
    lost: sum.lost,
    winRate,
    revenue: sum.revenue,
    avgDeal,
  };

  // ── Win / Loss (Donut) ───────────────────────────────────────
  const winLossData = [
    { name: "Gewonnen", value: statusCounts.gewonnen, color: "var(--success)" },
    { name: "Verloren", value: statusCounts.verloren, color: "var(--danger)" },
    { name: "Nachfassen", value: statusCounts.nachfassen, color: "var(--warning)" },
    { name: "Offen", value: statusCounts.offen, color: "var(--viz-2)" },
  ].filter((d) => d.value > 0);

  // ── Verteilungen ─────────────────────────────────────────────
  const reasonItems = [...lostReasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value, color: "var(--danger)" }));
  const paymentItems = [...paymentTypes.values()]
    .sort((a, b) => b.value - a.value)
    .map((p) => ({ label: p.label, value: p.value, color: "var(--viz-1)" }));

  const sourceRows: MetricRow[] = [...sourceCells.entries()]
    .filter(([, c]) => c.closings > 0)
    .sort((a, b) => b[1].revenue - a[1].revenue || b[1].closings - a[1].closings)
    .map(([key, c]) => ({
      key,
      label: SOURCE_LABELS[key] ?? (key === "ohne" ? "Ohne Setting-Bezug" : "Sonstige"),
      share: sum.closings === 0 ? null : c.closings / sum.closings,
      values: {
        closings: c.closings,
        won: c.won,
        lost: c.lost,
        winRate: pct(c.won, c.won + c.lost),
        revenue: c.revenue,
        avgDeal: c.won === 0 ? null : Math.round(c.revenue / c.won),
      },
    }));

  const sizeRows: MetricRow[] = SIZE_LABELS.map((label, i) => ({
    key: label,
    label,
    share: sum.won === 0 ? null : sizeBins[i].n / sum.won,
    values: {
      n: sizeBins[i].n,
      anteil: pct(sizeBins[i].n, sum.won),
      revenue: sizeBins[i].revenue,
      revenueShare: pct(sizeBins[i].revenue, sum.revenue),
    },
  })).filter((r) => (r.values.n as number) > 0);

  return (
    <>
      {/* ── KPI-Heroes ─────────────────────────────────────────── */}
      <KpiRow>
        <KpiHero
          label="Umsatz"
          value={sum.revenue}
          format="eur"
          delta={pctChange(sum.revenue, prev.revenue)}
          spark={revenueSpark}
          tone="success"
          icon={<Euro size={15} />}
          index={0}
        />
        <KpiHero
          label="Win-Rate"
          value={winRate}
          format="pct"
          delta={ppDelta(winRate, prevWinRate)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<Trophy size={15} />}
          index={1}
        />
        <KpiHero
          label="Ø-Deal"
          value={avgDeal}
          format="eur"
          delta={avgDeal === null || prevAvgDeal === null ? null : pctChange(avgDeal, prevAvgDeal)}
          icon={<Receipt size={15} />}
          index={2}
        />
        <KpiHero
          label="Offene Pipeline"
          value={openPipeline}
          format="int"
          delta={pctChange(openPipeline, prev.open)}
          icon={<Clock size={15} />}
          index={3}
        />
      </KpiRow>

      {/* ── Vergleich ──────────────────────────────────────────── */}
      <div className="fade-up" style={{ animationDelay: "240ms" }}>
        <AnalyseSection title="Vergleich" icon={Filter} meta="Closings · Win-Rate · Umsatz">
          <ComparisonTable
            columns={[
              { key: "closings", label: "Closings", format: "int" },
              { key: "shows", label: "Shows", format: "int" },
              { key: "showRate", label: "Show-Quote", format: "pct" },
              { key: "won", label: "Gewonnen", format: "int" },
              { key: "lost", label: "Verloren", format: "int" },
              { key: "winRate", label: "Win-Rate", format: "pct", deltaVsAvg: true },
              { key: "revenue", label: "Umsatz", format: "eur" },
              { key: "avgDeal", label: "Ø-Deal", format: "eur" },
            ]}
            rows={tableRows}
            average={average}
            averageLabel="Gesamt"
          />
        </AnalyseSection>
      </div>

      {/* ── Charts-Reihe ───────────────────────────────────────── */}
      <div
        className="analyse-row fade-up"
        data-split="chart"
        style={{ animationDelay: "300ms" }}
      >
        <AnalyseSection title="Umsatz im Verlauf" icon={BarChart3} meta="Umsatz (EUR) aus gewonnenen Deals">
          <BucketBarChart buckets={buckets} perUser={revPerUser} />
        </AnalyseSection>
        <AnalyseSection title="Win / Loss" icon={PieChart} meta={`${INT.format(sum.closings)} Closings`}>
          <DonutChart data={winLossData} centerLabel={fmtPct(winRate)} centerSub="Win-Rate" />
        </AnalyseSection>
      </div>

      {/* ── Herkunft ───────────────────────────────────────────── */}
      <div className="fade-up" style={{ animationDelay: "340ms" }}>
        <AnalyseSection title="Welche Quelle schließt am besten ab?" icon={TrendingUp} meta="Closings nach Herkunft des Termins">
          <MetricTable
            label="Quelle"
            columns={[
              { key: "closings", label: "Closings", format: "int" },
              { key: "won", label: "Gewonnen", format: "int" },
              { key: "lost", label: "Verloren", format: "int" },
              { key: "winRate", label: "Win-Rate", format: "pct", emphasis: true },
              { key: "revenue", label: "Umsatz", format: "eur" },
              { key: "avgDeal", label: "Ø-Deal", format: "eur" },
            ]}
            rows={sourceRows}
            total={{
              closings: sum.closings,
              won: sum.won,
              lost: sum.lost,
              winRate,
              revenue: sum.revenue,
              avgDeal,
            }}
            minWidth={640}
            emptyHint="Im Zeitraum keine Closings erfasst."
          />
          <Footnote>
            Die Herkunft kommt vom verknüpften Setting (<code>setting_call_id</code> → <code>source_type</code>).
            Ein Closing ohne diese Verknüpfung steht in &bdquo;Ohne Setting-Bezug&ldquo; — das ist kein Fehler, sondern ein
            direkt angelegtes oder beim Organisations-Umzug gekapptes Closing.
          </Footnote>
        </AnalyseSection>
      </div>

      {/* ── Geschwindigkeit + Deal-Größen ──────────────────────── */}
      <div className="analyse-row">
        <div className="fade-up" style={{ display: "grid", animationDelay: "380ms" }}>
          <AnalyseSection
            title="Wie lange dauert der Abschluss?"
            icon={Timer}
            meta={speedUnknown > 0 ? `${INT.format(speedUnknown)} ohne Setting-Bezug` : "Balken = Closings, Zeile = Win-Rate"}
          >
            <QuoteColumns
              perDay={SPEED_LABELS.map((label, i) => ({
                label,
                n: speedCells[i].n,
                quote: pct(speedCells[i].won, speedCells[i].won + speedCells[i].lost),
              }))}
              quoteLabel="Win-Rate"
            />
            <Footnote>
              Tage zwischen Setting-Termin und Abschlussgespräch. Ein Deal, der lange liegt, wird selten besser —
              die Win-Rate in den hinteren Blöcken zeigt, ab wann Nachfassen sich nicht mehr lohnt.
            </Footnote>
          </AnalyseSection>
        </div>
        <div className="fade-up" style={{ display: "grid", animationDelay: "420ms" }}>
          <AnalyseSection title="Deal-Größen" icon={Receipt} meta={`${INT.format(sum.won)} gewonnene Deals`}>
            <MetricTable
              label="Größe"
              columns={[
                { key: "n", label: "Deals", format: "int" },
                { key: "anteil", label: "Anteil", format: "pct" },
                { key: "revenue", label: "Umsatz", format: "eur", emphasis: true },
                { key: "revenueShare", label: "Umsatzanteil", format: "pct" },
              ]}
              rows={sizeRows}
              minWidth={420}
              emptyHint="Noch keine gewonnenen Deals im Zeitraum."
            />
          </AnalyseSection>
        </div>
      </div>

      {/* ── Vertrag ────────────────────────────────────────────── */}
      <div className="fade-up" style={{ animationDelay: "460ms" }}>
        <AnalyseSection title="Vertrag & Abwicklung" icon={FileSignature} meta="nach gewonnenem Abschluss">
          <StatRow
            items={[
              {
                label: "Unterschrift erhalten",
                value: signatureKnown === 0 ? "—" : fmtPct(pct(signatureYes, signatureKnown)),
                tone: signatureKnown > 0 && signatureYes === signatureKnown ? "success" : "default",
              },
              { label: "davon erfasst", value: `${INT.format(signatureKnown)} von ${INT.format(sum.won)}` },
              {
                label: "Vertragsstart (Median)",
                value: medianStartLead === null ? "—" : `${medianStartLead} Tage nach Abschluss`,
              },
              { label: "Ø-Deal", value: avgDeal === null ? "—" : eur(avgDeal) },
            ]}
          />
        </AnalyseSection>
      </div>

      {/* ── Verteilungs-Reihe ──────────────────────────────────── */}
      <div
        className="analyse-row fade-up"
        data-split="auto"
        style={{
          animationDelay: "500ms",
        }}
      >
        <AnalyseSection title="Verlustgründe" icon={XCircle} meta={`${INT.format(sum.lost)} verloren`}>
          <DistBars items={reasonItems} max={8} />
        </AnalyseSection>
        <AnalyseSection title="Zahlungsarten" icon={CreditCard} meta={`${INT.format(sum.won)} gewonnen`}>
          <DistBars items={paymentItems} />
        </AnalyseSection>
      </div>
    </>
  );
}
