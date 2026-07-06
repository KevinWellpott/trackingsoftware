import {
  BarChart3, Clock, CreditCard, Euro, Filter, PieChart, Receipt, Trophy, XCircle,
} from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { NUM, buildBuckets, bucketOf, closingEffDate, fmtPct, pct, type Granularity } from "@/lib/analyse";
import { AnalyseSection } from "@/components/analyse/AnalyseSection";
import { ComparisonTable, type ComparisonRow } from "@/components/analyse/ComparisonTable";
import { BucketBarChart } from "@/components/analyse/AnalyseCharts";
import { DistBars, DonutChart, KpiHero } from "@/components/analyse/AnalyseViz";

// Closing-Flow: Closings → Shows → Gewonnen/Verloren → Umsatz, aus
// closing_calls (JS-Filter nach Effektiv-Datum). Ein einziger Fetch deckt
// aktuelles UND Vorperioden-Fenster ab — der Split passiert in JS über
// closingEffDate.

type Member = { user_id: string; username: string };

type ClosingRow = {
  created_by_user_id: string | null;
  call_at: string | null;
  created_at: string;
  show_status: "show" | "no_show" | null;
  status: "offen" | "gewonnen" | "verloren" | "nachfassen";
  deal_volume: number | null;
  lost_reason: string | null;
  payment_type: string | null;
};

type Totals = {
  closings: number;
  shows: number;
  noShows: number;
  won: number;
  lost: number;
  revenue: number;
};

const ZERO = (): Totals => ({ closings: 0, shows: 0, noShows: 0, won: 0, lost: 0, revenue: 0 });

const INT = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

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

  let query = supabase
    .from("closing_calls")
    .select("created_by_user_id, call_at, created_at, show_status, status, deal_volume, lost_reason, payment_type")
    .eq("workspace_id", access.workspace_id);
  if (!canCompare) query = query.eq("created_by_user_id", access.user.id);

  const res = await query;
  const allRows = (res.data ?? []) as ClosingRow[];
  const buckets = buildBuckets(from, to, granularity);

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
  // Sparkline: Umsatz gesamt je Bucket
  const revenueByBucket: Record<string, number> = {};

  // Vorperioden-Summen (nur Gesamtwerte für die Delta-Badges)
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
    if (r.status === "gewonnen") {
      t.won += 1;
      const vol = NUM(r.deal_volume);
      t.revenue += vol;
      const bk = bucketOf(day, from, to, granularity);
      revPerUser[name][bk] = (revPerUser[name][bk] ?? 0) + vol;
      revenueByBucket[bk] = (revenueByBucket[bk] ?? 0) + vol;

      const rawPayment = (r.payment_type ?? "").trim();
      const label = rawPayment || "Ohne Angabe";
      const key = label.toLowerCase();
      const entry = paymentTypes.get(key);
      if (entry) entry.value += 1;
      else paymentTypes.set(key, { label, value: 1 });
    }
    if (r.status === "verloren") {
      t.lost += 1;
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
    { name: "Gewonnen", value: statusCounts.gewonnen, color: "var(--color-success-text)" },
    { name: "Verloren", value: statusCounts.verloren, color: "var(--color-error-text)" },
    { name: "Nachfassen", value: statusCounts.nachfassen, color: "var(--color-warning-text)" },
    { name: "Offen", value: statusCounts.offen, color: "var(--surface-300)" },
  ].filter((d) => d.value > 0);

  // ── Verteilungen ─────────────────────────────────────────────
  const reasonItems = [...lostReasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value, color: "var(--color-error-text)" }));
  const paymentItems = [...paymentTypes.values()]
    .sort((a, b) => b.value - a.value)
    .map((p) => ({ label: p.label, value: p.value, color: "var(--brand-500)" }));

  return (
    <>
      {/* ── KPI-Heroes ─────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
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
      </div>

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
        className="chart-grid-2 fade-up"
        style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.75rem", animationDelay: "300ms" }}
      >
        <AnalyseSection title="Umsatz im Verlauf" icon={BarChart3} meta="Umsatz (EUR) aus gewonnenen Deals">
          <BucketBarChart buckets={buckets} perUser={revPerUser} />
        </AnalyseSection>
        <AnalyseSection title="Win / Loss" icon={PieChart} meta={`${INT.format(sum.closings)} Closings`}>
          <DonutChart data={winLossData} centerLabel={fmtPct(winRate)} centerSub="Win-Rate" />
        </AnalyseSection>
      </div>

      {/* ── Verteilungs-Reihe ──────────────────────────────────── */}
      <div
        className="fade-up"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "0.75rem",
          animationDelay: "360ms",
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
