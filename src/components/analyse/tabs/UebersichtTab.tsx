import { Activity, BarChart3, CalendarCheck, Euro, Eye, Handshake, Percent, PieChart, Target, Users } from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { loadClosingCalls, loadSettingCalls } from "@/lib/analyseData";
import { getTargets } from "@/app/actions/targets";
import { resolveTarget } from "@/lib/targets";
import { ownerColor } from "@/lib/ownerColor";
import { GoalProgress } from "@/components/dashboard/GoalProgress";
import {
  NUM, buildBuckets, bucketOf, closingEffDate, eur, fmtPct, ownerKey, pct, settingEffDate,
  workdaysBetween, type Granularity,
} from "@/lib/analyse";
import { AnalyseSection, MigrationHint } from "@/components/analyse/AnalyseSection";
import { ComparisonTable, type ComparisonRow } from "@/components/analyse/ComparisonTable";
import { Footnote, MetricTable, type MetricRow } from "@/components/analyse/AnalyseTables";
import { BucketBarChart } from "@/components/analyse/AnalyseCharts";
import { BarFunnel, DonutChart, KpiHero, KpiRow } from "@/components/analyse/AnalyseViz";

// Übersicht: der gesamte Vertrieb auf einer Seite — beide Akquise-Kanäle, der
// gemeinsame Termin-Funnel und das Geld am Ende. Die Detailfragen beantworten
// die Fach-Tabs; hier geht es um Größenordnung und Engstelle.

type Member = { user_id: string; username: string };

const INT = new Intl.NumberFormat("de-DE");
const OHNE = "Ohne Zuordnung";

/** "2026-07-31" → "31.07.2026" (ohne Date-Parsing, kein UTC-Tagessprung). */
function deDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

type OwnerDayRow = {
  owner_name: string | null;
  day: string;
  dms: number | string | null;
  answers: number | string | null;
  appts: number | string | null;
};

type PhoneDayRow = {
  owner_name: string | null;
  day: string;
  calls: number | string | null;
  decider_reached: number | string | null;
  appointments: number | string | null;
};

type Person = {
  dms: number;
  answers: number;
  calls: number;
  decider: number;
  termine: number;
  shows: number;
  closings: number;
  won: number;
  revenue: number;
};

const ZERO = (): Person => ({
  dms: 0, answers: 0, calls: 0, decider: 0, termine: 0, shows: 0, closings: 0, won: 0, revenue: 0,
});

function deltaPct(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

function ppDelta(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null) return null;
  return Math.round((cur - prev) * 10) / 10;
}

const SOURCE_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  telefon: "Telefon",
  manuell: "Manuell",
  inbound: "Inbound",
  website: "Website",
};

export async function UebersichtTab({
  access,
  from,
  to,
  prevFrom,
  prevTo,
  today,
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
  today: string;
  granularity: Granularity;
  selectedMembers: Member[];
  canCompare: boolean;
  allSelected: boolean;
}) {
  const supabase = await createClient();
  const eff = canCompare ? null : access.user.id;
  const rpcArgs = { p_workspace_id: access.workspace_id, p_effective_user_id: eff };

  const [liRes, liPrevRes, phRes, phPrevRes, settings, closings, targets] = await Promise.all([
    supabase.rpc("rpc_owner_day_metrics", { ...rpcArgs, p_from: from, p_to: to }),
    supabase.rpc("rpc_owner_day_metrics", { ...rpcArgs, p_from: prevFrom, p_to: prevTo }),
    supabase.rpc("rpc_phone_day_metrics", { ...rpcArgs, p_from: from, p_to: to }),
    supabase.rpc("rpc_phone_day_metrics", { ...rpcArgs, p_from: prevFrom, p_to: prevTo }),
    loadSettingCalls(supabase, access, canCompare),
    loadClosingCalls(supabase, access, canCompare),
    getTargets(),
  ]);

  if (liRes.error) {
    return <MigrationHint>Die Übersicht benötigt die Kennzahl-RPCs aus den Migrationen 0013/0015.</MigrationHint>;
  }

  const buckets = buildBuckets(from, to, granularity);

  const nameByKey = new Map<string, string>();
  for (const m of selectedMembers) nameByKey.set(ownerKey(m.username), m.username);
  const nameById = new Map(selectedMembers.map((m) => [m.user_id, m.username]));

  const people = new Map<string, Person>();
  const ensure = (name: string) => {
    let p = people.get(name);
    if (!p) {
      p = ZERO();
      people.set(name, p);
    }
    return p;
  };
  for (const m of selectedMembers) ensure(m.username);

  // ── Kanal-Serien je Bucket ───────────────────────────────────
  const kontaktSeries: Record<string, Record<string, number>> = { LinkedIn: {}, Telefon: {} };
  const funnelSeries: Record<string, Record<string, number>> = { Termine: {}, Closings: {}, Gewonnen: {} };

  // ── LinkedIn ─────────────────────────────────────────────────
  const resolveOwner = (owner: string | null): string | null => {
    const hit = nameByKey.get(ownerKey(owner));
    if (hit) return hit;
    return allSelected ? OHNE : null;
  };

  for (const r of (liRes.data ?? []) as OwnerDayRow[]) {
    const name = resolveOwner(r.owner_name);
    if (!name) continue;
    const p = ensure(name);
    p.dms += NUM(r.dms);
    p.answers += NUM(r.answers);
    const bk = bucketOf(r.day, from, to, granularity);
    kontaktSeries.LinkedIn[bk] = (kontaktSeries.LinkedIn[bk] ?? 0) + NUM(r.dms);
  }

  const phoneRows = phRes.error ? [] : ((phRes.data ?? []) as PhoneDayRow[]);
  for (const r of phoneRows) {
    const name = resolveOwner(r.owner_name);
    if (!name) continue;
    const p = ensure(name);
    p.calls += NUM(r.calls);
    p.decider += NUM(r.decider_reached);
    const bk = bucketOf(r.day, from, to, granularity);
    kontaktSeries.Telefon[bk] = (kontaktSeries.Telefon[bk] ?? 0) + NUM(r.calls);
  }

  // Vorperiode (nur Summen für die Delta-Badges)
  const prev = { dms: 0, answers: 0, calls: 0, decider: 0, termine: 0, shows: 0, noShows: 0, closings: 0, won: 0, revenue: 0 };
  for (const r of (liPrevRes.error ? [] : ((liPrevRes.data ?? []) as OwnerDayRow[]))) {
    if (!resolveOwner(r.owner_name)) continue;
    prev.dms += NUM(r.dms);
    prev.answers += NUM(r.answers);
  }
  for (const r of (phPrevRes.error ? [] : ((phPrevRes.data ?? []) as PhoneDayRow[]))) {
    if (!resolveOwner(r.owner_name)) continue;
    prev.calls += NUM(r.calls);
    prev.decider += NUM(r.decider_reached);
  }

  // ── Setting-Calls ────────────────────────────────────────────
  const settingSource = new Map<string, string>(); // id → source_type
  const sourceTermine = new Map<string, number>();
  const sourceShows = new Map<string, number>();
  let termine = 0;
  let shows = 0;
  let noShows = 0;

  for (const r of settings) {
    settingSource.set(r.id, (r.source_type ?? "sonstige").trim() || "sonstige");
    const day = settingEffDate(r);
    const name = nameById.get(r.created_by_user_id ?? "");
    const inPrev = day >= prevFrom && day <= prevTo;
    const inCur = day >= from && day <= to;
    if (!name && !allSelected) continue;
    if (inPrev) {
      prev.termine += 1;
      if (r.show_status === "show") prev.shows += 1;
      prev.noShows += r.no_show_count ?? 0;
      continue;
    }
    if (!inCur) continue;

    const p = ensure(name ?? OHNE);
    p.termine += 1;
    termine += 1;
    if (r.show_status === "show") {
      p.shows += 1;
      shows += 1;
    }
    noShows += r.no_show_count ?? 0;

    const src = settingSource.get(r.id)!;
    sourceTermine.set(src, (sourceTermine.get(src) ?? 0) + 1);
    if (r.show_status === "show") sourceShows.set(src, (sourceShows.get(src) ?? 0) + 1);

    const bk = bucketOf(day, from, to, granularity);
    funnelSeries.Termine[bk] = (funnelSeries.Termine[bk] ?? 0) + 1;
  }

  // ── Closing-Calls ────────────────────────────────────────────
  const sourceClosings = new Map<string, number>();
  const sourceWon = new Map<string, number>();
  const sourceRevenue = new Map<string, number>();
  let closingCount = 0;
  let wonCount = 0;
  let revenue = 0;

  for (const r of closings) {
    const day = closingEffDate(r);
    const name = nameById.get(r.created_by_user_id ?? "");
    if (!name && !allSelected) continue;
    if (day >= prevFrom && day <= prevTo) {
      prev.closings += 1;
      if (r.status === "gewonnen") {
        prev.won += 1;
        prev.revenue += NUM(r.deal_volume);
      }
      continue;
    }
    if (day < from || day > to) continue;

    const p = ensure(name ?? OHNE);
    p.closings += 1;
    closingCount += 1;
    const src = (r.setting_call_id ? settingSource.get(r.setting_call_id) : null) ?? "ohne Setting";
    sourceClosings.set(src, (sourceClosings.get(src) ?? 0) + 1);

    const bk = bucketOf(day, from, to, granularity);
    funnelSeries.Closings[bk] = (funnelSeries.Closings[bk] ?? 0) + 1;

    if (r.status === "gewonnen") {
      const vol = NUM(r.deal_volume);
      p.won += 1;
      p.revenue += vol;
      wonCount += 1;
      revenue += vol;
      sourceWon.set(src, (sourceWon.get(src) ?? 0) + 1);
      sourceRevenue.set(src, (sourceRevenue.get(src) ?? 0) + vol);
      funnelSeries.Gewonnen[bk] = (funnelSeries.Gewonnen[bk] ?? 0) + 1;
    }
  }

  // ── Summen ───────────────────────────────────────────────────
  const names = selectedMembers.map((m) => m.username);
  const ohne = people.get(OHNE);
  if (ohne && (ohne.dms > 0 || ohne.calls > 0 || ohne.termine > 0 || ohne.closings > 0)) names.push(OHNE);

  const sum = ZERO();
  for (const name of names) {
    const p = people.get(name) ?? ZERO();
    sum.dms += p.dms;
    sum.answers += p.answers;
    sum.calls += p.calls;
    sum.decider += p.decider;
    sum.termine += p.termine;
    sum.shows += p.shows;
    sum.closings += p.closings;
    sum.won += p.won;
    sum.revenue += p.revenue;
  }

  const kontaktpunkte = sum.dms + sum.calls;
  const prevKontaktpunkte = prev.dms + prev.calls;
  const reaktionen = sum.answers + sum.decider;
  const showRate = pct(shows, shows + noShows);
  const prevShowRate = pct(prev.shows, prev.shows + prev.noShows);
  const konversion = pct(wonCount, kontaktpunkte);
  const prevKonversion = pct(prev.won, prevKontaktpunkte);
  const apptRate = pct(termine, kontaktpunkte);
  const revenuePerKontakt = kontaktpunkte === 0 ? null : Math.round(revenue / kontaktpunkte);

  // ── Kanal-Vergleich ──────────────────────────────────────────
  const channelRows: MetricRow[] = [
    {
      key: "linkedin",
      label: "LinkedIn",
      sub: "DMs → Antworten → Termine",
      share: kontaktpunkte === 0 ? null : sum.dms / kontaktpunkte,
      color: "var(--viz-1)",
      values: {
        kontakte: sum.dms,
        reaktionen: sum.answers,
        reaktionsRate: pct(sum.answers, sum.dms),
        termine: sourceTermine.get("linkedin") ?? 0,
        terminRate: pct(sourceTermine.get("linkedin") ?? 0, sum.dms),
        umsatz: sourceRevenue.get("linkedin") ?? 0,
      },
    },
    {
      key: "telefon",
      label: "Telefon",
      sub: "Calls → Entscheider → Termine",
      share: kontaktpunkte === 0 ? null : sum.calls / kontaktpunkte,
      color: "var(--viz-2)",
      values: {
        kontakte: sum.calls,
        reaktionen: sum.decider,
        reaktionsRate: pct(sum.decider, sum.calls),
        termine: sourceTermine.get("telefon") ?? 0,
        terminRate: pct(sourceTermine.get("telefon") ?? 0, sum.calls),
        umsatz: sourceRevenue.get("telefon") ?? 0,
      },
    },
  ];

  // ── Quellen der Termine ──────────────────────────────────────
  const sourceKeys = [...new Set([...sourceTermine.keys(), ...sourceClosings.keys()])];
  const sourceRows: MetricRow[] = sourceKeys
    .map((key) => {
      const t = sourceTermine.get(key) ?? 0;
      const s = sourceShows.get(key) ?? 0;
      const c = sourceClosings.get(key) ?? 0;
      const w = sourceWon.get(key) ?? 0;
      return {
        key,
        label: SOURCE_LABELS[key] ?? (key === "ohne Setting" ? "Ohne Setting-Bezug" : "Sonstige"),
        share: termine === 0 ? null : t / termine,
        values: {
          termine: t,
          showRate: pct(s, t),
          closings: c,
          won: w,
          winRate: pct(w, c),
          umsatz: sourceRevenue.get(key) ?? 0,
        },
      };
    })
    .sort((a, b) => (b.values.umsatz as number) - (a.values.umsatz as number) || (b.values.termine as number) - (a.values.termine as number));

  const quellenDonut = [
    { name: "LinkedIn", value: sourceTermine.get("linkedin") ?? 0, color: "var(--viz-1)" },
    { name: "Telefon", value: sourceTermine.get("telefon") ?? 0, color: "var(--viz-2)" },
    { name: "Manuell", value: sourceTermine.get("manuell") ?? 0, color: "var(--viz-3)" },
    { name: "Inbound", value: sourceTermine.get("inbound") ?? 0, color: "var(--viz-4)" },
    { name: "Website", value: sourceTermine.get("website") ?? 0, color: "var(--viz-5)" },
    { name: "Sonstige", value: sourceTermine.get("sonstige") ?? 0, color: "var(--viz-6)" },
  ].filter((d) => d.value > 0);

  // ── Ziel-Abgleich ────────────────────────────────────────────
  // `performance_targets` sind TAGES-Ziele. Für einen frei gewählten Zeitraum
  // wird daraus ein Soll: Tagesziel × Arbeitstage — und zwar nur bis heute,
  // sonst rechnete ein laufender Monat seine Zukunft schon als Rückstand.
  const targetTo = to < today ? to : today;
  const workdays = workdaysBetween(from, targetTo);
  const zielRows: MetricRow[] = selectedMembers.map((m) => {
    const p = people.get(m.username) ?? ZERO();
    const dmSoll = resolveTarget(targets, m.user_id, "linkedin", "daily", "pitches") * workdays;
    const callSoll = resolveTarget(targets, m.user_id, "telefon", "daily", "calls") * workdays;
    return {
      key: m.user_id,
      label: m.username,
      share: dmSoll === 0 ? null : Math.min(p.dms / dmSoll, 1),
      color: ownerColor(m.username).fg,
      values: {
        dms: p.dms,
        dmSoll,
        dmQuote: pct(p.dms, dmSoll),
        calls: p.calls,
        callSoll,
        callQuote: pct(p.calls, callSoll),
      },
    };
  });
  const dmSollGesamt = zielRows.reduce((s, r) => s + (r.values.dmSoll as number), 0);
  const callSollGesamt = zielRows.reduce((s, r) => s + (r.values.callSoll as number), 0);
  const zeigePhone = sum.calls > 0 || callSollGesamt > 0;

  // ── Personen-Leaderboard ─────────────────────────────────────
  const personRows: ComparisonRow[] = names.map((name) => {
    const p = people.get(name) ?? ZERO();
    return {
      name,
      values: {
        dms: p.dms,
        calls: p.calls,
        termine: p.termine,
        shows: p.shows,
        closings: p.closings,
        won: p.won,
        revenue: p.revenue,
      },
    };
  });

  const personAverage = {
    dms: sum.dms,
    calls: sum.calls,
    termine: sum.termine,
    shows: sum.shows,
    closings: sum.closings,
    won: sum.won,
    revenue: sum.revenue,
  };

  return (
    <>
      {/* ══ 1 · KPI-Reihe ══ */}
      <KpiRow>
        <KpiHero
          label="Kontaktpunkte"
          value={kontaktpunkte}
          delta={deltaPct(kontaktpunkte, prevKontaktpunkte)}
          icon={<Activity size={15} />}
          index={0}
        />
        <KpiHero
          label="Termine"
          value={termine}
          delta={deltaPct(termine, prev.termine)}
          icon={<CalendarCheck size={15} />}
          index={1}
        />
        <KpiHero
          label="Show-Quote"
          value={showRate}
          format="pct"
          delta={ppDelta(showRate, prevShowRate)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<Eye size={15} />}
          index={2}
        />
        <KpiHero
          label="Gewonnen"
          value={wonCount}
          delta={deltaPct(wonCount, prev.won)}
          icon={<Handshake size={15} />}
          index={3}
        />
        <KpiHero
          label="Umsatz"
          value={revenue}
          format="eur"
          delta={deltaPct(revenue, prev.revenue)}
          tone="success"
          icon={<Euro size={15} />}
          index={4}
        />
        <KpiHero
          label="Kontakt → Abschluss"
          value={konversion}
          format="pct"
          delta={ppDelta(konversion, prevKonversion)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<Percent size={15} />}
          index={5}
        />
      </KpiRow>

      {/* ══ 2 · Gesamt-Funnel + Quellen ══ */}
      <div className="analyse-row" data-split="wide-left">
        <div className="fade-up" style={{ display: "grid", animationDelay: "240ms" }}>
          <AnalyseSection title="Gesamt-Funnel" icon={BarChart3} meta="beide Kanäle zusammen">
            <BarFunnel
              stages={[
                { label: "Kontaktpunkte", value: kontaktpunkte },
                { label: "Reaktionen", value: reaktionen },
                { label: "Termine", value: termine },
                { label: "Shows", value: shows },
                { label: "Closings", value: closingCount },
                { label: "Gewonnen", value: wonCount },
              ]}
              trailing={{ label: "Umsatz", value: eur(revenue) }}
            />
            <Footnote>
              &bdquo;Reaktionen&ldquo; fasst LinkedIn-Antworten und am Telefon erreichte Entscheider zusammen — die jeweils
              erste echte Reaktion des Kanals. Terminquote über alle Kontaktpunkte: {fmtPct(apptRate)}.
            </Footnote>
          </AnalyseSection>
        </div>
        <div className="fade-up" style={{ display: "grid", animationDelay: "300ms" }}>
          <AnalyseSection title="Woher kommen die Termine?" icon={PieChart} meta={`${INT.format(termine)} Termine`}>
            <DonutChart data={quellenDonut} centerLabel={INT.format(termine)} centerSub="Termine" />
          </AnalyseSection>
        </div>
      </div>

      {/* ══ 3 · Kanal-Vergleich ══ */}
      <div className="fade-up" style={{ animationDelay: "360ms" }}>
        <AnalyseSection title="Kanäle im Vergleich" icon={Activity} meta="Aufwand vs. Ertrag je Akquise-Weg">
          <MetricTable
            label="Kanal"
            columns={[
              { key: "kontakte", label: "Kontakte", format: "int" },
              { key: "reaktionen", label: "Reaktionen", format: "int" },
              { key: "reaktionsRate", label: "Reaktionsquote", format: "pct" },
              { key: "termine", label: "Termine", format: "int" },
              { key: "terminRate", label: "Terminquote", format: "pct", emphasis: true },
              { key: "umsatz", label: "Umsatz", format: "eur" },
            ]}
            rows={channelRows}
            total={{
              kontakte: kontaktpunkte,
              reaktionen,
              reaktionsRate: pct(reaktionen, kontaktpunkte),
              termine,
              terminRate: apptRate,
              umsatz: revenue,
            }}
            minWidth={620}
          />
          <Footnote>
            Kanal-Termine kommen aus <code>setting_calls.source_type</code>, die Kontaktzahlen aus den
            Tages-RPCs — manuell gebuchte Termine tauchen deshalb in der Gesamtzeile auf, aber in keiner
            Kanalzeile. Umsatz pro Kontaktpunkt: {revenuePerKontakt === null ? "—" : eur(revenuePerKontakt)}.
          </Footnote>
        </AnalyseSection>
      </div>

      {/* ══ 4 · Verlauf ══ */}
      <div className="analyse-row">
        <div className="fade-up" style={{ display: "grid", animationDelay: "420ms" }}>
          <AnalyseSection title="Kontaktpunkte im Verlauf" icon={Activity}>
            <BucketBarChart buckets={buckets} perUser={kontaktSeries} />
          </AnalyseSection>
        </div>
        <div className="fade-up" style={{ display: "grid", animationDelay: "480ms" }}>
          <AnalyseSection title="Termine & Abschlüsse im Verlauf" icon={CalendarCheck}>
            <BucketBarChart buckets={buckets} perUser={funnelSeries} />
          </AnalyseSection>
        </div>
      </div>

      {/* ══ 4b · Ziele ══ */}
      <div className="fade-up" style={{ animationDelay: "510ms" }}>
        <AnalyseSection
          title="Ziele"
          icon={Target}
          meta={`${INT.format(workdays)} Arbeitstage bis ${deDate(targetTo)}`}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-7)" }}>
            <GoalProgress label="LinkedIn-DMs im Team" current={sum.dms} goal={dmSollGesamt} unit="DMs" />
            {zeigePhone && (
              <GoalProgress label="Anrufe im Team" current={sum.calls} goal={callSollGesamt} unit="Anrufe" />
            )}
          </div>
          {canCompare && zielRows.length > 1 && (
            <div style={{ marginTop: "var(--sp-8)" }}>
              <MetricTable
                label="Person"
                columns={[
                  { key: "dms", label: "DMs", format: "int" },
                  { key: "dmSoll", label: "Soll", format: "int" },
                  { key: "dmQuote", label: "Erreicht", format: "pct", emphasis: true },
                  ...(zeigePhone
                    ? ([
                        { key: "calls", label: "Anrufe", format: "int" as const },
                        { key: "callSoll", label: "Soll", format: "int" as const },
                        { key: "callQuote", label: "Erreicht", format: "pct" as const },
                      ])
                    : []),
                ]}
                rows={zielRows}
                minWidth={560}
              />
            </div>
          )}
          <Footnote>
            Soll = Tagesziel × Arbeitstage (Mo–Fr) im Zeitraum, gerechnet nur bis heute — ein laufender Monat
            zählt seine Zukunft nicht als Rückstand. Die Tagesziele stehen unter Einstellungen; ohne eigenen
            Eintrag gelten 20 DMs und 40 Anrufe pro Tag.
          </Footnote>
        </AnalyseSection>
      </div>

      {/* ══ 5 · Quellen-Wertigkeit ══ */}
      <div className="fade-up" style={{ animationDelay: "540ms" }}>
        <AnalyseSection title="Was ist eine Quelle wert?" icon={Euro} meta="Termin → Show → Closing → Umsatz">
          <MetricTable
            label="Quelle"
            columns={[
              { key: "termine", label: "Termine", format: "int" },
              { key: "showRate", label: "Show-Quote", format: "pct" },
              { key: "closings", label: "Closings", format: "int" },
              { key: "won", label: "Gewonnen", format: "int" },
              { key: "winRate", label: "Win-Rate", format: "pct" },
              { key: "umsatz", label: "Umsatz", format: "eur", emphasis: true },
            ]}
            rows={sourceRows}
            minWidth={640}
            emptyHint="Im Zeitraum keine Termine erfasst."
          />
          <Footnote>
            Closings hängen über <code>setting_call_id</code> an ihrem Setting. Ein Closing ohne diese Verknüpfung
            (z. B. nach einem Organisations-Umzug gekappt) steht in der Zeile &bdquo;Ohne Setting-Bezug&ldquo;.
          </Footnote>
        </AnalyseSection>
      </div>

      {/* ══ 6 · Personen ══ */}
      {canCompare && (
        <div className="fade-up" style={{ animationDelay: "600ms" }}>
          <AnalyseSection title="Personen" icon={Users} meta="ganzer Funnel je Mitglied">
            <ComparisonTable
              columns={[
                { key: "dms", label: "DMs", format: "int" },
                { key: "calls", label: "Calls", format: "int" },
                { key: "termine", label: "Termine", format: "int" },
                { key: "shows", label: "Shows", format: "int" },
                { key: "closings", label: "Closings", format: "int" },
                { key: "won", label: "Gewonnen", format: "int" },
                { key: "revenue", label: "Umsatz", format: "eur" },
              ]}
              rows={personRows}
              average={personAverage}
              averageLabel="Gesamt"
            />
            <Footnote>
              DMs und Calls hängen an <code>owner_name</code> der Liste, Termine und Abschlüsse am Ersteller des
              Datensatzes — bei geteilten Terminen zählt der Anleger, nicht die Mitzuweisung.
            </Footnote>
          </AnalyseSection>
        </div>
      )}
    </>
  );
}
