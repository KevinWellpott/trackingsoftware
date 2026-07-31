import type { ReactNode } from "react";
import {
  Activity, Calendar, CalendarCheck, CalendarDays, CalendarX, DoorOpen, Filter, Phone, PhoneOff,
  PieChart, Repeat, Smile, TrendingUp, UserCheck, Voicemail, XCircle,
} from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { loadPhoneLeads, phoneLeadDay, type AnalysePhoneLead } from "@/lib/analyseData";
import {
  NUM, SENTIMENT_META, WEEKDAY_LABELS, buildBuckets, bucketOf, ownerKey, pct, weekdayIndex,
  type Granularity,
} from "@/lib/analyse";
import { VIZ_NEUTRAL } from "@/lib/viz";
import { AnalyseSection, MigrationHint } from "@/components/analyse/AnalyseSection";
import { ComparisonTable, type ComparisonRow } from "@/components/analyse/ComparisonTable";
import { FunnelStrip } from "@/components/analyse/FunnelStrip";
import { Footnote, MetricTable, ShareBar, type MetricRow } from "@/components/analyse/AnalyseTables";
import { PhoneSeriesChart } from "@/components/analyse/AnalyseCharts";
import { DistBars, DonutChart, KpiHero, QuoteColumns, WeekdayBars, KpiRow } from "@/components/analyse/AnalyseViz";

// Telefon-Flow: Calls → Gatekeeper → Entscheider → Termine, aus
// rpc_phone_day_metrics (benötigt Migration 0013), plus Vorperioden-Deltas.
//
// Die Lead-Ebene (zweiter Teil) beantwortet die Fragen, die die Tages-RPC nicht
// kennt: Wie oft muss man anrufen? Wie kommt man am Gatekeeper vorbei? Wie
// klingen die Gespräche?

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

/**
 * Status-Reihenfolge, Labels und Token-Farben der Outcome-Verteilung.
 * Bewusst SEMANTIK-Töne statt der kategorialen Viz-Palette: die Segmente sind
 * Zustände, und Markenorange trägt niemals Status (DESIGN.md §3.5). Grün heißt
 * in der ganzen App „gewonnen/erreicht", Gold „dranbleiben", Rot „tot".
 */
const STATUS_META: { key: string; label: string; color: string }[] = [
  { key: "aktiv", label: "Aktiv", color: VIZ_NEUTRAL },
  { key: "rueckruf", label: "Rückruf", color: "var(--info)" },
  { key: "nicht_erreicht", label: "Nicht erreicht", color: "var(--warning)" },
  { key: "termin", label: "Termin", color: "var(--success)" },
  { key: "dead", label: "Dead", color: "var(--danger)" },
];

const GATEKEEPER_LABELS: Record<string, string> = {
  direkt: "Direkt zum Entscheider",
  ja: "Gatekeeper durchgestellt",
  nein: "Gatekeeper blockte",
  ohne: "Ohne Angabe",
};

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
function reasonItems(rows: AnalysePhoneLead[], field: keyof AnalysePhoneLead): { label: string; value: number }[] {
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

type LeadCell = { n: number; decider: number; appts: number; dead: number };
const ZERO_LEAD = (): LeadCell => ({ n: 0, decider: 0, appts: 0, dead: 0 });

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
    loadPhoneLeads(supabase, access, canCompare),
  ]);

  if (res.error) {
    return <MigrationHint>Telefon-Analyse benötigt die neueste Datenbank-Migration (0013).</MigrationHint>;
  }

  const rows = (res.data ?? []) as PhoneDayRow[];
  const prevRows: PhoneDayRow[] = prevRes.error ? [] : ((prevRes.data ?? []) as PhoneDayRow[]);
  const buckets = buildBuckets(from, to, granularity);

  const nameByKey = new Map<string, string>();
  for (const m of selectedMembers) nameByKey.set(ownerKey(m.username), m.username);
  const nameById = new Map(selectedMembers.map((m) => [m.user_id, m.username]));

  // Lead-Zuordnung wie in rpc_phone_day_metrics: Gruppierung über
  // phone_lists.owner_name, Ersteller nur als Fallback ohne Namen.
  const ownerOf = (l: AnalysePhoneLead): string | null => {
    const owner = l.phone_lists?.owner_name;
    if (owner && owner.trim()) return nameByKey.get(ownerKey(owner)) ?? (allSelected ? OHNE : null);
    const byId = nameById.get(l.created_by_user_id ?? "");
    if (byId) return byId;
    return allSelected ? OHNE : null;
  };

  const leads = leadsRaw.filter((r) => {
    const day = phoneLeadDay(r);
    if (day < from || day > to) return false;
    return ownerOf(r) !== null;
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

  // ── Lead-Ebene: Versuche, Gatekeeper, Stimmung ───────────────
  const attemptCells = [ZERO_LEAD(), ZERO_LEAD(), ZERO_LEAD()];
  let attemptUnknown = 0;
  const gatekeeperCells = new Map<string, LeadCell>();
  const sentiment = { positiv: 0, neutral: 0, negativ: 0, offen: 0 };
  let mailbox = 0;
  let mailboxKnown = 0;
  const statusCounts = new Map<string, number>();

  for (const l of leads) {
    const attempt = Number(l.call_attempt);
    if (attempt >= 1 && attempt <= 3) {
      const cell = attemptCells[attempt - 1];
      cell.n += 1;
      if (l.decider_reached === true) cell.decider += 1;
      if (l.appointment_set === true) cell.appts += 1;
      if (l.status === "dead") cell.dead += 1;
    } else {
      attemptUnknown += 1;
    }

    const gk = (l.gatekeeper_reached ?? "").trim() || "ohne";
    let gkCell = gatekeeperCells.get(gk);
    if (!gkCell) {
      gkCell = ZERO_LEAD();
      gatekeeperCells.set(gk, gkCell);
    }
    gkCell.n += 1;
    if (l.decider_reached === true) gkCell.decider += 1;
    if (l.appointment_set === true) gkCell.appts += 1;
    if (l.status === "dead") gkCell.dead += 1;

    if (l.answer_sentiment) sentiment[l.answer_sentiment] += 1;
    else if (l.decider_reached === true) sentiment.offen += 1;

    if (l.mailbox !== null) {
      mailboxKnown += 1;
      if (l.mailbox) mailbox += 1;
    }

    const s = l.status ?? "";
    statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1);
  }

  const outcomeData = STATUS_META.map((m) => ({
    name: m.label,
    value: statusCounts.get(m.key) ?? 0,
    color: m.color,
  })).filter((d) => d.value > 0);
  const outcomeTotal = outcomeData.reduce((s, d) => s + d.value, 0);

  const gatekeeperRows: MetricRow[] = ["direkt", "ja", "nein", "ohne"]
    .map((key) => ({ key, cell: gatekeeperCells.get(key) }))
    .filter((e): e is { key: string; cell: LeadCell } => Boolean(e.cell && e.cell.n > 0))
    .map(({ key, cell }) => ({
      key,
      label: GATEKEEPER_LABELS[key],
      share: leads.length === 0 ? null : cell.n / leads.length,
      values: {
        n: cell.n,
        deciderRate: pct(cell.decider, cell.n),
        appts: cell.appts,
        apptRate: pct(cell.appts, cell.n),
        deadRate: pct(cell.dead, cell.n),
      },
    }));

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
      <KpiRow>
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
        <KpiHero label="Ø Calls/Tag" value={avgCallsPerDay} icon={<Activity size={15} />} index={4} />
        <KpiHero
          label="Mailbox-Quote"
          value={mailboxKnown === 0 ? null : pct(mailbox, mailboxKnown)}
          format="pct"
          icon={<Voicemail size={15} />}
          index={5}
        />
      </KpiRow>

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
          <Footnote>
            Nur &bdquo;Calls&ldquo; ist zeitraumgefiltert (<code>first_call_at</code> im Fenster) — Gatekeeper, Entscheider,
            Termine und Dead sind der aktuelle Stand derselben Leads. Die Quoten sind damit Kohorten-Quoten, keine
            Tageswerte.
          </Footnote>
        </AnalyseSection>
      </Fade>

      {/* ══ 3 · Verlauf + Outcome-Verteilung ══ */}
      <div className="analyse-row">
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

      {/* ══ 4 · Anruf-Versuche ══ */}
      <Fade i={8}>
        <AnalyseSection
          title="Wie oft musst du anrufen?"
          icon={Repeat}
          meta={attemptUnknown > 0 ? `${INT_FMT.format(attemptUnknown)} ohne Versuchszähler` : "Leads nach erreichtem Versuch"}
        >
          <QuoteColumns
            perDay={[1, 2, 3].map((n, i) => ({
              label: `${n}. Versuch`,
              n: attemptCells[i].n,
              quote: pct(attemptCells[i].appts, attemptCells[i].n),
            }))}
            quoteLabel="Terminquote"
          />
          <Footnote>
            <code>call_attempt</code> ist der zuletzt gezählte Versuch eines Leads, nicht ein Ereignis-Log. Die
            Spalte &bdquo;3. Versuch&ldquo; enthält also Leads, bei denen dreimal angerufen wurde — bricht die Terminquote dort
            ein, lohnt der dritte Anruf nicht mehr.
          </Footnote>
        </AnalyseSection>
      </Fade>

      {/* ══ 5 · Gatekeeper + Stimmung ══ */}
      <div className="analyse-row" data-split="wide-left">
        <Fade i={9}>
          <AnalyseSection title="Der Weg zum Entscheider" icon={DoorOpen} meta={`${INT_FMT.format(leads.length)} Leads`}>
            <MetricTable
              label="Gatekeeper"
              columns={[
                { key: "n", label: "Leads", format: "int" },
                { key: "deciderRate", label: "Entscheider", format: "pct", emphasis: true },
                { key: "appts", label: "Termine", format: "int" },
                { key: "apptRate", label: "Terminquote", format: "pct" },
                { key: "deadRate", label: "Dead", format: "pct" },
              ]}
              rows={gatekeeperRows}
              minWidth={520}
              emptyHint="Keine Gatekeeper-Angaben im Zeitraum."
            />
          </AnalyseSection>
        </Fade>
        <Fade i={10}>
          <AnalyseSection title="Stimmung im Gespräch" icon={Smile} meta="answer_sentiment">
            <ShareBar
              segments={[
                ...SENTIMENT_META.map((m) => ({ label: m.label, value: sentiment[m.key], color: m.color })),
                { label: "Ohne Angabe", value: sentiment.offen, color: VIZ_NEUTRAL },
              ]}
              height={14}
            />
            <Footnote>
              Gezählt werden Leads mit erreichtem Entscheider — nur dort gibt es überhaupt ein Gespräch zu bewerten.
            </Footnote>
          </AnalyseSection>
        </Fade>
      </div>

      {/* ══ 6 · Gründe ══ */}
      <div className="analyse-row" data-split="auto">
        <Fade i={11}>
          <AnalyseSection title="Warum nicht durchgestellt?" icon={PhoneOff}>
            <DistBars items={noTransfer} max={8} />
          </AnalyseSection>
        </Fade>
        <Fade i={12}>
          <AnalyseSection title="Warum kein Pitch?" icon={XCircle}>
            <DistBars items={noPitch} max={8} />
          </AnalyseSection>
        </Fade>
        <Fade i={13}>
          <AnalyseSection title="Warum kein Termin?" icon={CalendarX}>
            <DistBars items={noAppointment} max={8} />
          </AnalyseSection>
        </Fade>
      </div>

      {/* ══ 7 · Wochentag-Analyse ══ */}
      <Fade i={14}>
        <AnalyseSection title="Wochentag-Analyse" icon={CalendarDays} meta="Calls je Wochentag">
          <WeekdayBars
            perDay={weekday.map((d) => ({ label: d.label, n: d.calls, quote: pct(d.appts, d.calls) }))}
            quoteLabel="Terminquote"
          />
        </AnalyseSection>
      </Fade>

      {/* ══ 8 · Funnel ══ */}
      <Fade i={15}>
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
