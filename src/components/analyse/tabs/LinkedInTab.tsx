import type { ReactNode } from "react";
import {
  Activity,
  Calendar,
  CalendarCheck,
  CalendarDays,
  Filter,
  Layers,
  ListOrdered,
  MessageSquare,
  MessagesSquare,
  PieChart,
  TrendingUp,
} from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { NUM, buildBuckets, bucketOf, ownerKey, pct, type Granularity } from "@/lib/analyse";
import { categoryStyle } from "@/lib/categories";
import { ownerColor } from "@/lib/ownerColor";
import { AnalyseSection } from "@/components/analyse/AnalyseSection";
import { ComparisonTable, type ComparisonRow } from "@/components/analyse/ComparisonTable";
import { FunnelStrip } from "@/components/analyse/FunnelStrip";
import { LinkedInSeriesChart } from "@/components/analyse/AnalyseCharts";
import { CumulativeAreaChart, DistBars, DonutChart, KpiHero, WeekdayBars, type Tone } from "@/components/analyse/AnalyseViz";

// LinkedIn-Flow: DMs → Antworten → Termine je Mitglied, aus rpc_owner_day_metrics,
// plus Vorperioden-Deltas, Antwort-Kategorien und Listen-Ranking aus einem
// schlanken contacts-Fetch.

type Member = { user_id: string; username: string };

type OwnerDayRow = {
  owner_name: string | null;
  day: string;
  dms: number | string | null;
  answers: number | string | null;
  appts: number | string | null;
};

type ContactSlim = {
  answer_category: string | null;
  answered: boolean | null;
  pitched_at: string | null;
  list_id: string;
  lists: { name: string | null; owner_name: string | null; created_by_user_id: string | null } | null;
};

type Totals = { dms: number; answers: number; appts: number };

const OHNE = "Ohne Zuordnung";
const INT_FMT = new Intl.NumberFormat("de-DE");
const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;

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

/** Donut-/Balkenfarbe je Antwort-Kategorie (Neu-Werte fest, Legacy gedämpft). */
function categoryColor(name: string): string {
  if (name === "Positiv") return "var(--color-success-text)";
  if (name === "Neutral") return "var(--surface-300)";
  if (name === "Negativ") return "var(--color-error-text)";
  if (name === "Sonstige") return "var(--text-subtle)";
  return categoryStyle(name)?.color ?? "var(--text-muted)";
}

/** Stagger-Wrapper für Sektionen (KpiHero animiert sich selbst). */
function Fade({ i, children }: { i: number; children: ReactNode }) {
  return (
    <div className="fade-up" style={{ display: "grid", animationDelay: `${i * 60}ms` }}>
      {children}
    </div>
  );
}

export async function LinkedInTab({
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

  const [res, prevRes, contactsRaw] = await Promise.all([
    supabase.rpc("rpc_owner_day_metrics", {
      p_workspace_id: access.workspace_id,
      p_from: from,
      p_to: to,
      p_effective_user_id: eff,
    }),
    supabase.rpc("rpc_owner_day_metrics", {
      p_workspace_id: access.workspace_id,
      p_from: prevFrom,
      p_to: prevTo,
      p_effective_user_id: eff,
    }),
    fetchAllRows((f, t) => {
      let q = supabase
        .from("contacts")
        .select("answer_category, answered, pitched_at, list_id, lists!inner(name, owner_name, created_by_user_id)")
        .eq("workspace_id", access.workspace_id)
        .gte("pitched_at", from)
        .lte("pitched_at", to);
      if (!canCompare) q = q.eq("lists.created_by_user_id", access.user.id);
      return q.order("id").range(f, t);
    }).catch(() => []),
  ]);

  const rows: OwnerDayRow[] = res.error ? [] : ((res.data ?? []) as OwnerDayRow[]);
  const prevRows: OwnerDayRow[] = prevRes.error ? [] : ((prevRes.data ?? []) as OwnerDayRow[]);
  const buckets = buildBuckets(from, to, granularity);

  // Namens-Index: ownerKey(username) → Anzeigename
  const nameByKey = new Map<string, string>();
  for (const m of selectedMembers) nameByKey.set(ownerKey(m.username), m.username);

  // Kontakte auf gewählte Mitglieder eingrenzen (Owner-Name der Liste).
  const contacts = (contactsRaw as unknown as ContactSlim[]).filter(
    (c) => allSelected || nameByKey.has(ownerKey(c.lists?.owner_name)),
  );

  // ── Aggregation je Anzeigename (Summen + Buckets) ────────────
  const totals = new Map<string, Totals>();
  const perUser: Record<string, Record<string, Totals>> = {};
  const ensure = (name: string) => {
    if (!totals.has(name)) totals.set(name, { dms: 0, answers: 0, appts: 0 });
    if (!perUser[name]) perUser[name] = {};
  };
  for (const m of selectedMembers) ensure(m.username);

  const weekday = WEEKDAY_LABELS.map((label) => ({ label, dms: 0, answers: 0 }));
  const activeDays = new Set<string>();

  for (const r of rows) {
    const key = ownerKey(r.owner_name);
    let name = nameByKey.get(key);
    if (!name) {
      if (!allSelected) continue; // Fremd-Owner nur im "Alle"-Modus zeigen
      name = OHNE;
    }
    ensure(name);
    const t = totals.get(name)!;
    const dms = NUM(r.dms);
    const answers = NUM(r.answers);
    const appts = NUM(r.appts);
    t.dms += dms;
    t.answers += answers;
    t.appts += appts;
    const bk = bucketOf(r.day, from, to, granularity);
    const b = perUser[name][bk] ?? { dms: 0, answers: 0, appts: 0 };
    b.dms += dms;
    b.answers += answers;
    b.appts += appts;
    perUser[name][bk] = b;

    const wd = weekday[weekdayIndex(r.day)];
    wd.dms += dms;
    wd.answers += answers;
    if (dms > 0) activeDays.add(r.day);
  }

  // Anzeigereihenfolge: Mitglieder, dann "Ohne Zuordnung" (nur mit Daten)
  const names = selectedMembers.map((m) => m.username);
  const ohne = totals.get(OHNE);
  if (ohne && (ohne.dms > 0 || ohne.answers > 0 || ohne.appts > 0)) names.push(OHNE);

  const sum: Totals = { dms: 0, answers: 0, appts: 0 };
  for (const name of names) {
    const t = totals.get(name)!;
    sum.dms += t.dms;
    sum.answers += t.answers;
    sum.appts += t.appts;
  }

  // ── Vorperiode (gleiche Mitglieder-Eingrenzung) ──────────────
  const prevSum: Totals = { dms: 0, answers: 0, appts: 0 };
  for (const r of prevRows) {
    if (!nameByKey.has(ownerKey(r.owner_name)) && !allSelected) continue;
    prevSum.dms += NUM(r.dms);
    prevSum.answers += NUM(r.answers);
    prevSum.appts += NUM(r.appts);
  }

  // ── KPI-Heroes ───────────────────────────────────────────────
  const answerRate = pct(sum.answers, sum.dms);
  const prevAnswerRate = pct(prevSum.answers, prevSum.dms);
  const apptRate = pct(sum.appts, sum.dms);
  const prevApptRate = pct(prevSum.appts, prevSum.dms);
  const apptTone: Tone = apptRate === null ? "default" : apptRate < 3 ? "error" : apptRate <= 7 ? "success" : "default";
  const avgDmsPerDay = activeDays.size === 0 ? null : Math.round(sum.dms / activeDays.size);

  // Kumulierte Fläche: rohe DMs je Bucket, Komponente bildet laufende Summen.
  const dmsPerUser: Record<string, Record<string, number>> = {};
  for (const name of names) {
    dmsPerUser[name] = {};
    for (const [bk, t] of Object.entries(perUser[name] ?? {})) dmsPerUser[name][bk] = t.dms;
  }

  // ── Antwort-Kategorien (contacts) ────────────────────────────
  const catCounts = new Map<string, number>();
  for (const c of contacts) {
    const cat = (c.answer_category ?? "").trim();
    if (!cat) continue;
    catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
  }
  const catSorted = [...catCounts.entries()].sort((a, b) => b[1] - a[1]);
  const catTop = catSorted.slice(0, 6);
  const catRest = catSorted.slice(6).reduce((s, [, n]) => s + n, 0);
  const catData = catTop.map(([name, value]) => ({ name, value, color: categoryColor(name) }));
  if (catRest > 0) catData.push({ name: "Sonstige", value: catRest, color: categoryColor("Sonstige") });
  const catTotal = catSorted.reduce((s, [, n]) => s + n, 0);

  // ── Listen-Ranking nach Antwortquote (≥ 10 DMs) ──────────────
  const byList = new Map<string, { name: string; owner: string; dms: number; answered: number }>();
  for (const c of contacts) {
    const agg = byList.get(c.list_id) ?? {
      name: c.lists?.name?.trim() || "Unbenannte Liste",
      owner: (c.lists?.owner_name ?? "").trim(),
      dms: 0,
      answered: 0,
    };
    agg.dms += 1;
    if (c.answered === true) agg.answered += 1;
    byList.set(c.list_id, agg);
  }
  const rankedLists = [...byList.values()]
    .filter((l) => l.dms >= 10)
    .map((l) => ({ ...l, rate: (l.answered / l.dms) * 100 }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 8)
    .map((l) => ({
      label: `${canCompare && l.owner ? `${l.name} · ${l.owner}` : l.name} (${l.answered}/${l.dms})`,
      value: Math.round(l.rate),
      color: ownerColor(l.owner).fg,
    }));

  // ── Vergleichstabelle ────────────────────────────────────────
  const tableRows: ComparisonRow[] = names.map((name) => {
    const t = totals.get(name)!;
    return {
      name,
      values: {
        dms: t.dms,
        answers: t.answers,
        answerRate: pct(t.answers, t.dms),
        appts: t.appts,
        apptRate: pct(t.appts, t.dms),
      },
    };
  });

  const average = {
    dms: sum.dms,
    answers: sum.answers,
    answerRate,
    appts: sum.appts,
    apptRate,
  };

  const rangeMeta = `${from} – ${to}`;

  return (
    <>
      {/* ══ 1 · KPI-Hero-Reihe ══ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
        <KpiHero
          label="DMs"
          value={sum.dms}
          delta={deltaPct(sum.dms, prevSum.dms)}
          icon={<MessageSquare size={15} />}
          index={0}
        />
        <KpiHero
          label="Antwortquote"
          value={answerRate}
          format="pct"
          delta={deltaPP(answerRate, prevAnswerRate)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<TrendingUp size={15} />}
          index={1}
        />
        <KpiHero
          label="Terminquote"
          value={apptRate}
          format="pct"
          delta={deltaPP(apptRate, prevApptRate)}
          deltaLabel="vs. Vorperiode (pp)"
          tone={apptTone}
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
          label="Ø DMs/Tag"
          value={avgDmsPerDay}
          icon={<Activity size={15} />}
          index={4}
        />
      </div>

      {/* ══ 2 · Vergleich ══ */}
      <Fade i={5}>
        <AnalyseSection title="Vergleich" icon={Filter} meta="DMs · Antworten · Termine">
          <ComparisonTable
            columns={[
              { key: "dms", label: "DMs", format: "int" },
              { key: "answers", label: "Antworten", format: "int" },
              { key: "answerRate", label: "Antwortquote", format: "pct", deltaVsAvg: true },
              { key: "appts", label: "Termine", format: "int" },
              { key: "apptRate", label: "Terminquote", format: "pct", deltaVsAvg: true },
            ]}
            rows={tableRows}
            average={average}
            averageLabel="Gesamt"
          />
        </AnalyseSection>
      </Fade>

      {/* ══ 3 · Verlauf + Kumuliert ══ */}
      <div className="chart-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <Fade i={6}>
          <AnalyseSection title="Verlauf" icon={TrendingUp} meta={rangeMeta}>
            <LinkedInSeriesChart buckets={buckets} perUser={perUser} />
          </AnalyseSection>
        </Fade>
        <Fade i={7}>
          <AnalyseSection title="Kumuliert" icon={Layers} meta="DMs kumuliert">
            <CumulativeAreaChart buckets={buckets} perUser={dmsPerUser} />
          </AnalyseSection>
        </Fade>
      </div>

      {/* ══ 4 · Antwort-Kategorien + Wochentag ══ */}
      <div className="chart-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <Fade i={8}>
          <AnalyseSection
            title="Antwort-Kategorien"
            icon={PieChart}
            meta={`${INT_FMT.format(catTotal)} kategorisiert`}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <DonutChart data={catData} centerLabel={INT_FMT.format(catTotal)} centerSub="Kategorisiert" />
              <DistBars items={catData.map((d) => ({ label: d.name, value: d.value, color: d.color }))} />
            </div>
          </AnalyseSection>
        </Fade>
        <Fade i={9}>
          <AnalyseSection title="Wochentag-Analyse" icon={CalendarDays} meta="DMs je Wochentag">
            <WeekdayBars
              perDay={weekday.map((d) => ({ label: d.label, n: d.dms, quote: pct(d.answers, d.dms) }))}
              quoteLabel="Antwortquote"
            />
          </AnalyseSection>
        </Fade>
      </div>

      {/* ══ 5 · Listen-Ranking ══ */}
      <Fade i={10}>
        <AnalyseSection title="Top-Listen nach Antwortquote" icon={ListOrdered} meta="≥ 10 DMs · Wert = Antwortquote in %">
          <DistBars items={rankedLists} />
        </AnalyseSection>
      </Fade>

      {/* ══ 6 · Funnel ══ */}
      <Fade i={11}>
        <AnalyseSection title="Funnel" icon={MessagesSquare}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <FunnelStrip
              label="Gesamt"
              highlight
              stages={[
                { label: "DMs", value: sum.dms },
                { label: "Antworten", value: sum.answers },
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
                    { label: "DMs", value: t.dms },
                    { label: "Antworten", value: t.answers },
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
