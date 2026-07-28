import type { CSSProperties } from "react";
import {
  BadgeCheck, BarChart3, CalendarCheck, Eye, Filter, Gauge as GaugeIcon,
  Handshake, ListChecks, PieChart, Wallet,
} from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { buildBuckets, bucketOf, settingEffDate, pct, type Granularity, type QuelleKey } from "@/lib/analyse";
import { AnalyseSection } from "@/components/analyse/AnalyseSection";
import { ComparisonTable, type ComparisonRow } from "@/components/analyse/ComparisonTable";
import { BucketBarChart } from "@/components/analyse/AnalyseCharts";
import { DistBars, DonutChart, GaugeBar, KpiHero } from "@/components/analyse/AnalyseViz";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type { SettingStatus } from "@/lib/types";

// Setting-Flow: Termine → Shows → Qualifikation → Closing gelegt, aus
// setting_calls (JS-Filter nach Effektiv-Datum und optionaler Quelle).
// Ein einziger Fetch deckt aktuelles UND Vorperioden-Fenster ab — der Split
// passiert in JS über settingEffDate.

type Member = { user_id: string; username: string };

type SettingRow = {
  id: string;
  created_by_user_id: string | null;
  source_type: string | null;
  appointment_at: string | null;
  call_at: string | null;
  created_at: string;
  show_status: "show" | "no_show" | null;
  status: SettingStatus;
  /** Zählt No-Shows über Neuterminierungen hinweg — show_status kennt nur den letzten Stand. */
  no_show_count: number | null;
  has_budget_8k: "ja" | "nein" | "unklar" | null;
  ist_pain: number | null;
  warmth: number | null;
};

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

const INT = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

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

  let query = supabase
    .from("setting_calls")
    .select("id, created_by_user_id, source_type, appointment_at, call_at, created_at, show_status, no_show_count, status, has_budget_8k, ist_pain, warmth")
    .eq("workspace_id", access.workspace_id);
  if (!canCompare) query = query.eq("created_by_user_id", access.user.id);

  const res = await query;
  const allRows = (res.data ?? []) as SettingRow[];
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

  // Vorperioden-Summen (nur Gesamtwerte für die Delta-Badges)
  const prev = ZERO();
  // Sparkline: Termine gesamt je Bucket
  const termineByBucket: Record<string, number> = {};
  // Quellen-Split (aktuelles Fenster)
  const sourceCounts = { linkedin: 0, telefon: 0, manuell: 0, sonstige: 0 };
  // Qualität (aktuelles Fenster)
  const budget = { ja: 0, nein: 0, unklar: 0 };
  let painSum = 0, painN = 0, warmthSum = 0, warmthN = 0;

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
      if (r.show_status === "show" && (r.status === "qualifiziert" || r.status === "closing_gelegt")) prev.quali += 1;
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
    if (r.show_status === "show" && (r.status === "qualifiziert" || r.status === "closing_gelegt")) t.quali += 1;
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

    if (r.ist_pain != null) { painSum += Number(r.ist_pain); painN += 1; }
    if (r.warmth != null) { warmthSum += Number(r.warmth); warmthN += 1; }
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
    { name: "LinkedIn", value: sourceCounts.linkedin, color: "var(--brand-500)" },
    { name: "Telefon", value: sourceCounts.telefon, color: "var(--color-warning-text)" },
    { name: "Manuell", value: sourceCounts.manuell, color: "var(--color-success-text)" },
    { name: "Sonstige", value: sourceCounts.sonstige, color: "var(--surface-300)" },
  ].filter((d) => d.value > 0);

  // ── Qualität ─────────────────────────────────────────────────
  const budgetTotal = budget.ja + budget.nein + budget.unklar;
  const budgetItems = [
    { label: "Ja", value: budget.ja, color: "var(--color-success-text)" },
    { label: "Nein", value: budget.nein, color: "var(--color-error-text)" },
    { label: "Unklar", value: budget.unklar, color: "var(--surface-300)" },
  ];
  const avgPain = painN > 0 ? painSum / painN : null;
  const avgWarmth = warmthN > 0 ? warmthSum / warmthN : null;

  const mutedNote: CSSProperties = {
    fontSize: "0.6875rem",
    color: "var(--text-muted)",
    margin: "0.375rem 0 0",
  };

  return (
    <>
      {/* ── KPI-Heroes ─────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
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
      </div>

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
        </AnalyseSection>
      </div>

      {/* ── Charts-Reihe ───────────────────────────────────────── */}
      <div
        className="chart-grid-2 fade-up"
        style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.75rem", animationDelay: "300ms" }}
      >
        <AnalyseSection title="Termine im Verlauf" icon={BarChart3}>
          <BucketBarChart buckets={buckets} perUser={perUser} />
        </AnalyseSection>
        <AnalyseSection title="Quellen-Split" icon={PieChart} meta={`${INT.format(sum.termine)} Termine`}>
          <DonutChart data={quellenData} centerLabel={INT.format(sum.termine)} centerSub="Termine" />
        </AnalyseSection>
      </div>

      {/* ── Qualitäts-Reihe ────────────────────────────────────── */}
      <div
        className="fade-up"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "0.75rem",
          animationDelay: "360ms",
        }}
      >
        <AnalyseSection title="Budget (8k+)" icon={Wallet} meta={`${INT.format(budgetTotal)} Angaben`}>
          <DistBars items={budgetItems} total={budgetTotal} />
        </AnalyseSection>
        <AnalyseSection title="Lead-Qualität" icon={GaugeIcon} meta="Skala 1–10">
          <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
            <div>
              <GaugeBar label="Ø Pain" value={avgPain} />
              <p style={mutedNote}>aus {INT.format(painN)} Bewertungen</p>
            </div>
            <div>
              <GaugeBar label="Ø Wärme" value={avgWarmth} />
              <p style={mutedNote}>aus {INT.format(warmthN)} Bewertungen</p>
            </div>
          </div>
        </AnalyseSection>
      </div>

      {/* ── Status-Verteilung ──────────────────────────────────── */}
      <div className="fade-up" style={{ animationDelay: "420ms" }}>
        <AnalyseSection title="Status-Verteilung" icon={ListChecks} meta={`${statusTotal} gesamt`}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {STATUS_META.map((s) => (
              <div key={s.key} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Badge tone={s.tone}>{s.label}</Badge>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: "0.875rem",
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
        </AnalyseSection>
      </div>
    </>
  );
}
