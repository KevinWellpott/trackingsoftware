import type { ReactNode } from "react";
import {
  Activity,
  Calendar,
  CalendarCheck,
  CalendarDays,
  CalendarX,
  Filter,
  Phone,
  PhoneOff,
  PieChart,
  TrendingUp,
  UserCheck,
  XCircle,
} from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { NUM, buildBuckets, bucketOf, ownerKey, pct, type Granularity } from "@/lib/analyse";
import { AnalyseSection, MigrationHint } from "@/components/analyse/AnalyseSection";
import { ComparisonTable, type ComparisonRow } from "@/components/analyse/ComparisonTable";
import { FunnelStrip } from "@/components/analyse/FunnelStrip";
import { PhoneSeriesChart } from "@/components/analyse/AnalyseCharts";
import { DistBars, DonutChart, KpiHero, WeekdayBars } from "@/components/analyse/AnalyseViz";

// Telefon-Flow: Calls → Gatekeeper → Entscheider → Termine, aus
// rpc_phone_day_metrics (benötigt Migration 0013), plus Vorperioden-Deltas,
// Outcome-Verteilung und Ablehnungsgründe aus einem schlanken phone_leads-Fetch.

type Member = { user_id: string; username: string };

type PhoneDayRow = {
  owner_name: string | null;
  day: string;
  calls: number | string | null;
  gatekeeper_reached: number | string | null;
  decider_reached: number | string | null;
  appointments: number | string | null;
  callbacks: number | string | null;
  dead: number | string | null;
};

type PhoneLeadSlim = {
  status: string | null;
  first_call_at: string | null;
  created_at: string;
  created_by_user_id: string | null;
  no_transfer_reason: string | null;
  no_pitch_reason: string | null;
  no_appointment_reason: string | null;
};

type Totals = {
  calls: number;
  gatekeeper: number;
  decider: number;
  appts: number;
  callbacks: number;
  dead: number;
};

const ZERO = (): Totals => ({ calls: 0, gatekeeper: 0, decider: 0, appts: 0, callbacks: 0, dead: 0 });
const OHNE = "Ohne Zuordnung";
const INT_FMT = new Intl.NumberFormat("de-DE");
const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;

/** Status-Reihenfolge, Labels und Token-Farben der Outcome-Verteilung. */
const STATUS_META: { key: string; label: string; color: string }[] = [
  { key: "aktiv", label: "Aktiv", color: "var(--surface-300)" },
  { key: "rueckruf", label: "Rückruf", color: "var(--brand-500)" },
  { key: "nicht_erreicht", label: "Nicht erreicht", color: "var(--color-warning-text)" },
  { key: "termin", label: "Termin", color: "var(--color-success-text)" },
  { key: "dead", label: "Dead", color: "var(--color-error-text)" },
];

/** JS-Wochentag eines ISO-Tags als Index Mo=0 … So=6. */
function weekdayIndex(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

/** Prozentuale Veränderung vs. Vorperiode; Vorwert 0 → null (kein Delta). */
function deltaPct(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

/** Differenz zweier Quoten in Prozentpunkten; eine Seite null → null. */
function deltaPP(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null) return null;
  return cur - prev;
}

/**
 * Freitext-Gründe zu DistBars-Items: trimmen, leere überspringen,
 * case-insensitiv deduplizieren (erste Schreibweise gewinnt), absteigend sortiert.
 */
function reasonItems(rows: PhoneLeadSlim[], field: keyof PhoneLeadSlim): { label: string; value: number }[] {
  const counts = new Map<string, { label: string; value: number }>();
  for (const r of rows) {
    const trimmed = ((r[field] as string | null) ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.value += 1;
    else counts.set(key, { label: trimmed, value: 1 });
  }
  return [...counts.values()].sort((a, b) => b.value - a.value);
}

/** Stagger-Wrapper für Sektionen (KpiHero animiert sich selbst). */
function Fade({ i, children }: { i: number; children: ReactNode }) {
  return (
    <div className="fade-up" style={{ display: "grid", animationDelay: `${i * 60}ms` }}>
      {children}
    </div>
  );
}

export async function TelefonTab({
  access,
  from,
  to,
  prevFrom,
  prevTo,
  granularity,
  selectedMembers,
  canCompare,
  allSelected,
}: {
  access: AccessContext;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  granularity: Granularity;
  selectedMembers: Member[];
  canCompare: boolean;
  allSelected: boolean;
}) {
  const supabase = await createClient();
  const eff = canCompare ? null : access.user.id;

  const [res, prevRes, leadsRaw] = await Promise.all([
    supabase.rpc("rpc_phone_day_metrics", {
      p_workspace_id: access.workspace_id,
      p_from: from,
      p_to: to,
      p_effective_user_id: eff,
    }),
    supabase.rpc("rpc_phone_day_metrics", {
      p_workspace_id: access.workspace_id,
      p_from: prevFrom,
      p_to: prevTo,
      p_effective_user_id: eff,
    }),
    fetchAllRows((f, t) => {
      let q = supabase
        .from("phone_leads")
        .select("status, first_call_at, created_at, created_by_user_id, no_transfer_reason, no_pitch_reason, no_appointment_reason")
        .eq("workspace_id", access.workspace_id);
      if (!canCompare) q = q.eq("created_by_user_id", access.user.id);
      return q.order("id").range(f, t);
    }).catch(() => []),
  ]);

  if (res.error) {
    return <MigrationHint>Telefon-Analyse benötigt die neueste Datenbank-Migration (0013).</MigrationHint>;
  }

  const rows = (res.data ?? []) as PhoneDayRow[];
  const prevRows: PhoneDayRow[] = prevRes.error ? [] : ((prevRes.data ?? []) as PhoneDayRow[]);
  const buckets = buildBuckets(from, to, granularity);

  const nameByKey = new Map<string, string>();
  for (const m of selectedMembers) nameByKey.set(ownerKey(m.username), m.username);

  // Leads auf Zeitraum (Erstkontakt- bzw. Anlage-Tag) und Mitglieder eingrenzen.
  const memberIds = new Set(selectedMembers.map((m) => m.user_id));
  const leads = (leadsRaw as unknown as PhoneLeadSlim[]).filter((r) => {
    const day = (r.first_call_at ?? r.created_at).slice(0, 10);
    if (day < from || day > to) return false;
    return allSelected || memberIds.has(r.created_by_user_id ?? "");
  });

  // ── Aggregation je Anzeigename (Summen + Buckets) ────────────
  const totals = new Map<string, Totals>();
  const perUser: Record<string, Record<string, { calls: number; decider: number; appts: number }>> = {};
  const ensure = (name: string) => {
    if (!totals.has(name)) totals.set(name, ZERO());
    if (!perUser[name]) perUser[name] = {};
  };
  for (const m of selectedMembers) ensure(m.username);

  const weekday = WEEKDAY_LABELS.map((label) => ({ label, calls: 0, appts: 0 }));
  const activeDays = new Set<string>();

  for (const r of rows) {
    const key = ownerKey(r.owner_name);
    let name = nameByKey.get(key);
    if (!name) {
      if (!allSelected) continue;
      name = OHNE;
    }
    ensure(name);
    const t = totals.get(name)!;
    const calls = NUM(r.calls);
    const gatekeeper = NUM(r.gatekeeper_reached);
    const decider = NUM(r.decider_reached);
    const appts = NUM(r.appointments);
    t.calls += calls;
    t.gatekeeper += gatekeeper;
    t.decider += decider;
    t.appts += appts;
    t.callbacks += NUM(r.callbacks);
    t.dead += NUM(r.dead);
    const bk = bucketOf(r.day, from, to, granularity);
    const b = perUser[name][bk] ?? { calls: 0, decider: 0, appts: 0 };
    b.calls += calls;
    b.decider += decider;
    b.appts += appts;
    perUser[name][bk] = b;

    const wd = weekday[weekdayIndex(r.day)];
    wd.calls += calls;
    wd.appts += appts;
    if (calls > 0) activeDays.add(r.day);
  }

  const names = selectedMembers.map((m) => m.username);
  const ohne = totals.get(OHNE);
  if (ohne && ohne.calls > 0) names.push(OHNE);

  const sum = ZERO();
  for (const name of names) {
    const t = totals.get(name)!;
    sum.calls += t.calls;
    sum.gatekeeper += t.gatekeeper;
    sum.decider += t.decider;
    sum.appts += t.appts;
    sum.callbacks += t.callbacks;
    sum.dead += t.dead;
  }

  // ── Vorperiode (gleiche Mitglieder-Eingrenzung) ──────────────
  const prevSum = { calls: 0, decider: 0, appts: 0 };
  for (const r of prevRows) {
    if (!nameByKey.has(ownerKey(r.owner_name)) && !allSelected) continue;
    prevSum.calls += NUM(r.calls);
    prevSum.decider += NUM(r.decider_reached);
    prevSum.appts += NUM(r.appointments);
  }

  // ── KPI-Heroes ───────────────────────────────────────────────
  const deciderRate = pct(sum.decider, sum.calls);
  const prevDeciderRate = pct(prevSum.decider, prevSum.calls);
  const apptRate = pct(sum.appts, sum.calls);
  const prevApptRate = pct(prevSum.appts, prevSum.calls);
  const avgCallsPerDay = activeDays.size === 0 ? null : Math.round(sum.calls / activeDays.size);

  const callsSpark = buckets.map((b) => names.reduce((s, name) => s + (perUser[name]?.[b.key]?.calls ?? 0), 0));

  // ── Outcome-Verteilung (phone_leads-Status) ──────────────────
  const statusCounts = new Map<string, number>();
  for (const l of leads) {
    const s = l.status ?? "";
    statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1);
  }
  const outcomeData = STATUS_META.map((m) => ({
    name: m.label,
    value: statusCounts.get(m.key) ?? 0,
    color: m.color,
  })).filter((d) => d.value > 0);
  const outcomeTotal = outcomeData.reduce((s, d) => s + d.value, 0);

  // ── Gründe ───────────────────────────────────────────────────
  const noTransfer = reasonItems(leads, "no_transfer_reason");
  const noPitch = reasonItems(leads, "no_pitch_reason");
  const noAppointment = reasonItems(leads, "no_appointment_reason");

  // ── Vergleichstabelle ────────────────────────────────────────
  const tableRows: ComparisonRow[] = names.map((name) => {
    const t = totals.get(name)!;
    return {
      name,
      values: {
        calls: t.calls,
        gatekeeper: t.gatekeeper,
        gkRate: pct(t.gatekeeper, t.calls),
        decider: t.decider,
        deciderRate: pct(t.decider, t.calls),
        appts: t.appts,
        apptRate: pct(t.appts, t.calls),
        callbacks: t.callbacks,
        dead: t.dead,
      },
    };
  });

  const average = {
    calls: sum.calls,
    gatekeeper: sum.gatekeeper,
    gkRate: pct(sum.gatekeeper, sum.calls),
    decider: sum.decider,
    deciderRate,
    appts: sum.appts,
    apptRate,
    callbacks: sum.callbacks,
    dead: sum.dead,
  };

  return (
    <>
      {/* ══ 1 · KPI-Hero-Reihe ══ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
        <KpiHero
          label="Calls"
          value={sum.calls}
          delta={deltaPct(sum.calls, prevSum.calls)}
          spark={callsSpark}
          icon={<Phone size={15} />}
          index={0}
        />
        <KpiHero
          label="Entscheider-Quote"
          value={deciderRate}
          format="pct"
          delta={deltaPP(deciderRate, prevDeciderRate)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<UserCheck size={15} />}
          index={1}
        />
        <KpiHero
          label="Terminquote"
          value={apptRate}
          format="pct"
          delta={deltaPP(apptRate, prevApptRate)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<CalendarCheck size={15} />}
          index={2}
        />
        <KpiHero
          label="Termine"
          value={sum.appts}
          delta={deltaPct(sum.appts, prevSum.appts)}
          icon={<Calendar size={15} />}
          index={3}
        />
        <KpiHero
          label="Ø Calls/Tag"
          value={avgCallsPerDay}
          icon={<Activity size={15} />}
          index={4}
        />
      </div>

      {/* ══ 2 · Vergleich ══ */}
      <Fade i={5}>
        <AnalyseSection title="Vergleich" icon={Filter} meta="Calls · Gatekeeper · Entscheider · Termine">
          <ComparisonTable
            columns={[
              { key: "calls", label: "Calls", format: "int" },
              { key: "gatekeeper", label: "Gatekeeper", format: "int" },
              { key: "gkRate", label: "GK-Quote", format: "pct", deltaVsAvg: true },
              { key: "decider", label: "Entscheider", format: "int" },
              { key: "deciderRate", label: "Entscheider-Quote", format: "pct", deltaVsAvg: true },
              { key: "appts", label: "Termine", format: "int" },
              { key: "apptRate", label: "Terminquote", format: "pct", deltaVsAvg: true },
              { key: "callbacks", label: "Rückrufe", format: "int" },
              { key: "dead", label: "Dead", format: "int" },
            ]}
            rows={tableRows}
            average={average}
            averageLabel="Gesamt"
          />
        </AnalyseSection>
      </Fade>

      {/* ══ 3 · Verlauf + Outcome-Verteilung ══ */}
      <div className="chart-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <Fade i={6}>
          <AnalyseSection title="Verlauf" icon={TrendingUp} meta={`${from} – ${to}`}>
            <PhoneSeriesChart buckets={buckets} perUser={perUser} />
          </AnalyseSection>
        </Fade>
        <Fade i={7}>
          <AnalyseSection title="Outcome-Verteilung" icon={PieChart} meta={`${INT_FMT.format(outcomeTotal)} Leads`}>
            <DonutChart data={outcomeData} centerLabel={INT_FMT.format(outcomeTotal)} centerSub="Leads" />
          </AnalyseSection>
        </Fade>
      </div>

      {/* ══ 4 · Gründe ══ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "0.75rem" }}>
        <Fade i={8}>
          <AnalyseSection title="Warum nicht durchgestellt?" icon={PhoneOff}>
            <DistBars items={noTransfer} max={8} />
          </AnalyseSection>
        </Fade>
        <Fade i={9}>
          <AnalyseSection title="Warum kein Pitch?" icon={XCircle}>
            <DistBars items={noPitch} max={8} />
          </AnalyseSection>
        </Fade>
        <Fade i={10}>
          <AnalyseSection title="Warum kein Termin?" icon={CalendarX}>
            <DistBars items={noAppointment} max={8} />
          </AnalyseSection>
        </Fade>
      </div>

      {/* ══ 5 · Wochentag-Analyse ══ */}
      <Fade i={11}>
        <AnalyseSection title="Wochentag-Analyse" icon={CalendarDays} meta="Calls je Wochentag">
          <WeekdayBars
            perDay={weekday.map((d) => ({ label: d.label, n: d.calls, quote: pct(d.appts, d.calls) }))}
            quoteLabel="Terminquote"
          />
        </AnalyseSection>
      </Fade>

      {/* ══ 6 · Funnel ══ */}
      <Fade i={12}>
        <AnalyseSection title="Funnel" icon={Phone}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <FunnelStrip
              label="Gesamt"
              highlight
              stages={[
                { label: "Calls", value: sum.calls },
                { label: "Gatekeeper", value: sum.gatekeeper },
                { label: "Entscheider", value: sum.decider },
                { label: "Termine", value: sum.appts },
              ]}
            />
            {names.map((name) => {
              const t = totals.get(name)!;
              return (
                <FunnelStrip
                  key={name}
                  label={name}
                  stages={[
                    { label: "Calls", value: t.calls },
                    { label: "Gatekeeper", value: t.gatekeeper },
                    { label: "Entscheider", value: t.decider },
                    { label: "Termine", value: t.appts },
                  ]}
                />
              );
            })}
          </div>
        </AnalyseSection>
      </Fade>
    </>
  );
}
