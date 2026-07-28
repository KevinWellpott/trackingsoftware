import Link from "next/link";
import { ArrowRight, Bell, CalendarCheck, MessageSquare, Phone, Target, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { addDaysISO, getISOWeek, localDateISO, weekStart } from "@/lib/dates";
import { getTargets } from "@/app/actions/targets";
import { resolveTarget } from "@/lib/targets";
import { Card } from "@/components/ui/Card";
import { PersonalWeeklyChart, type PersonalWeekPoint } from "@/components/DashboardCharts";
import { PeriodSwitcher, type DashboardPeriod } from "@/components/dashboard/PeriodSwitcher";
import { StatTile, StatChip } from "@/components/dashboard/StatTile";
import { GoalProgress } from "@/components/dashboard/GoalProgress";
import { PersonalFunnel, type FunnelStage } from "@/components/dashboard/PersonalFunnel";
import { ViewingBanner } from "@/components/dashboard/ViewingBanner";

// Persönliches Home-Dashboard: zeigt genau EINE Person (scopeUserId).
// Alle Kennzahlen kommen aus gescopten RPCs/Head-Counts — kein Full-Table-Load.

type DayRow = {
  owner_name: string | null;
  day: string;
  dms: number | string | null;
  answers: number | string | null;
  appts: number | string | null;
};

type ApptRateRow = { total_dms: number | string | null; total_appts: number | string | null };
type FollowupRow = { due_soon: number | string | null; overdue: number | string | null };

type PhoneRow = {
  owner_name: string | null;
  calls: number | string | null;
  gatekeeper_reached: number | string | null;
  decider_reached: number | string | null;
  appointments: number | string | null;
  callbacks: number | string | null;
  dead: number | string | null;
};

const EUR = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const NUM = (v: number | string | null | undefined): number => Number(v ?? 0);

function formatRate(rate: number): string {
  return `${rate.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

// Sektionskarte: ruhiger Kopf (Icon + Titel + Meta rechts), Inhalt darunter.
// Der Eyebrow bleibt hier bewusst gedaempft — das Orange-Budget der Seite
// liegt komplett in der KPI-Reihe und dem Hero-Wort.
function SectionCard({
  title,
  icon,
  meta,
  href,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  meta?: string;
  href?: string;
  children: React.ReactNode;
}) {
  const heading = (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-4)",
        fontSize: "var(--fs-md)",
        fontWeight: 600,
        letterSpacing: "var(--ls-tight)",
        color: "var(--text-primary)",
      }}
    >
      <span aria-hidden style={{ display: "inline-flex", color: "var(--text-muted)" }}>
        {icon}
      </span>
      {title}
      {href && (
        <ArrowRight size={13} aria-hidden style={{ color: "var(--text-muted)" }} />
      )}
    </span>
  );
  return (
    <Card>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "var(--sp-4)",
          marginBottom: "var(--sp-7)",
          flexWrap: "wrap",
        }}
      >
        {href ? (
          <Link href={href} style={{ textDecoration: "none" }}>
            {heading}
          </Link>
        ) : (
          heading
        )}
        {meta && (
          <span
            className="eyebrow eyebrow-muted"
            style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}
          >
            {meta}
          </span>
        )}
      </div>
      {children}
    </Card>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period: rawPeriod } = await searchParams;
  const period: DashboardPeriod = rawPeriod === "m" ? "m" : rawPeriod === "j" ? "j" : "w";

  const access = await getAccessContext();
  if (!access) return null;

  const supabase = await createClient();
  const scopeUserId = access.effective_user_id ?? access.user.id;
  const displayName = access.effective_username ?? access.username;

  const today = localDateISO();
  const monday = weekStart(today);
  const periodFrom =
    period === "w" ? monday :
    period === "m" ? `${today.slice(0, 7)}-01` :
    `${today.slice(0, 4)}-01-01`;
  const periodLabel = period === "w" ? "Woche" : period === "m" ? "Monat" : "Jahr";

  // Ein Fenster für Zeitraum + 10-Wochen-Trend (Trend startet 9 Wochen vor Montag).
  const trendFrom = addDaysISO(monday, -63);
  const windowFrom = periodFrom < trendFrom ? periodFrom : trendFrom;

  const headCount = (
    table: "setting_calls" | "closing_calls",
    status?: string,
  ) => {
    let q = supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", access.workspace_id)
      .eq("created_by_user_id", scopeUserId);
    if (status) q = q.eq("status", status);
    return q;
  };

  const phonePeriodPromise = supabase.rpc("rpc_phone_owner_metrics", {
    p_workspace_id: access.workspace_id,
    p_from: periodFrom,
    p_to: today,
    p_effective_user_id: scopeUserId,
  });

  const [
    targets,
    dayRes,
    apptRateRes,
    fuRes,
    phonePeriodRes,
    phoneWeekRes,
    settingOpenRes,
    settingTotalRes,
    closingOpenRes,
    closingWonRes,
    wonDealsRes,
  ] = await Promise.all([
    getTargets(),
    supabase.rpc("rpc_owner_day_metrics", {
      p_workspace_id: access.workspace_id,
      p_from: windowFrom,
      p_to: today,
      p_effective_user_id: scopeUserId,
    }),
    supabase.rpc("rpc_appt_rate", {
      p_workspace_id: access.workspace_id,
      p_effective_user_id: scopeUserId,
    }),
    supabase.rpc("rpc_followup_alerts", {
      p_workspace_id: access.workspace_id,
      p_today: today,
      p_effective_user_id: scopeUserId,
    }),
    phonePeriodPromise,
    period === "w"
      ? phonePeriodPromise
      : supabase.rpc("rpc_phone_owner_metrics", {
          p_workspace_id: access.workspace_id,
          p_from: monday,
          p_to: today,
          p_effective_user_id: scopeUserId,
        }),
    headCount("setting_calls", "offen"),
    headCount("setting_calls"),
    headCount("closing_calls", "offen"),
    headCount("closing_calls", "gewonnen"),
    supabase
      .from("closing_calls")
      .select("deal_volume")
      .eq("workspace_id", access.workspace_id)
      .eq("created_by_user_id", scopeUserId)
      .eq("status", "gewonnen"),
  ]);

  // ── Tages-Metriken (RPC existiert erst ab Migration 0011 → bei Fehler leer)
  const dayRows: { day: string; dms: number; answers: number; appts: number }[] = dayRes.error
    ? []
    : ((dayRes.data ?? []) as DayRow[]).map((r) => ({
        day: r.day,
        dms: NUM(r.dms),
        answers: NUM(r.answers),
        appts: NUM(r.appts),
      }));

  let periodDms = 0, periodAnswers = 0, periodAppts = 0, todayDms = 0, weekDms = 0;
  for (const r of dayRows) {
    if (r.day >= periodFrom) { periodDms += r.dms; periodAnswers += r.answers; periodAppts += r.appts; }
    if (r.day >= monday) weekDms += r.dms;
    if (r.day === today) todayDms += r.dms;
  }

  // 10 ISO-Wochen-Buckets für den Trend
  const trendWeeks: PersonalWeekPoint[] = [];
  for (let i = 9; i >= 0; i--) {
    const wStart = addDaysISO(monday, -i * 7);
    const wEnd = addDaysISO(wStart, 6);
    let dms = 0, appts = 0;
    for (const r of dayRows) {
      if (r.day >= wStart && r.day <= wEnd) { dms += r.dms; appts += r.appts; }
    }
    trendWeeks.push({ week: `KW ${getISOWeek(wStart)}`, dms, appts });
  }

  // ── All-time (Subline "gesamt")
  const apptRateRow = (apptRateRes.error ? null : ((apptRateRes.data ?? []) as ApptRateRow[])[0]) ?? null;
  const alltimeDms = NUM(apptRateRow?.total_dms);

  // ── Follow-ups
  const fuRow = (fuRes.error ? null : ((fuRes.data ?? []) as FollowupRow[])[0]) ?? null;
  const fuDue = NUM(fuRow?.due_soon) + NUM(fuRow?.overdue);

  // ── Telefon (nur `calls` ist datumsgefiltert, Rest zählt gesamt)
  const sumPhone = (res: typeof phonePeriodRes) => {
    const rows = res.error ? [] : ((res.data ?? []) as PhoneRow[]);
    return rows.reduce(
      (acc, r) => ({
        calls: acc.calls + NUM(r.calls),
        decider: acc.decider + NUM(r.decider_reached),
        appointments: acc.appointments + NUM(r.appointments),
      }),
      { calls: 0, decider: 0, appointments: 0 },
    );
  };
  const phonePeriod = sumPhone(phonePeriodRes);
  const phoneWeek = sumPhone(phoneWeekRes);

  // ── Head-Counts + Umsatz
  const settingOpen = settingOpenRes.count ?? 0;
  const settingTotal = settingTotalRes.count ?? 0;
  const closingOpen = closingOpenRes.count ?? 0;
  const closingWon = closingWonRes.count ?? 0;
  const revenue = (wonDealsRes.data ?? []).reduce(
    (sum, row) => sum + NUM((row as { deal_volume: number | string | null }).deal_volume),
    0,
  );

  // ── Ziele
  const dailyGoal = resolveTarget(targets, scopeUserId, "linkedin", "daily", "pitches");
  const weeklyGoal = resolveTarget(targets, scopeUserId, "linkedin", "weekly", "pitches");
  const phoneWeeklyGoal = resolveTarget(targets, scopeUserId, "telefon", "weekly", "calls");
  const phoneTargetSet = targets.some(
    (t) => t.user_id === scopeUserId && t.channel === "telefon" && t.metric === "calls" && t.target_value > 0,
  );
  const showPhoneGoal = phoneTargetSet || phoneWeek.calls > 0;
  const showPhoneCard = phoneTargetSet || phonePeriod.calls > 0;

  // ── Quoten
  const answerRate = periodDms > 0 ? (periodAnswers / periodDms) * 100 : null;
  const apptRate = periodDms > 0 ? (periodAppts / periodDms) * 100 : null;
  const apptTone = apptRate === null ? "neutral" : apptRate < 3 ? "error" : apptRate > 7 ? "brand" : "success";

  const funnelStages: FunnelStage[] = [
    { label: "DMs", value: periodDms.toLocaleString("de-DE"), sub: periodLabel },
    { label: "Antworten", value: periodAnswers.toLocaleString("de-DE"), sub: periodLabel },
    { label: "Termine", value: periodAppts.toLocaleString("de-DE"), sub: periodLabel },
    { label: "Setting", value: settingOpen.toLocaleString("de-DE"), sub: `offen · ${settingTotal.toLocaleString("de-DE")} gesamt`, href: "/termine" },
    { label: "Closing", value: closingOpen.toLocaleString("de-DE"), sub: "offen", href: "/termine" },
    { label: "Gewonnen", value: closingWon.toLocaleString("de-DE"), sub: EUR.format(revenue), href: "/termine" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>

      {/* ══ VIEWING-BANNER (Impersonation) ══ */}
      {access.can_switch_view && access.effective_user_id && (
        <ViewingBanner name={access.effective_username ?? "Ausgewählter Nutzer"} />
      )}

      {/* ══ HEADER ══
          Der Glueh-Header ist der Hero-Moment der Seite; der Name traegt
          als einziges Element das Gradient-Wort-Treatment (DESIGN.md §5). */}
      <header
        className="ember-glow section-header-mobile"
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: "var(--sp-6)",
          flexWrap: "wrap",
          paddingTop: "var(--sp-2)",
        }}
      >
        <div>
          <div className="eyebrow">Persönliche Übersicht</div>
          <h1
            style={{
              fontSize: "var(--fs-2xl)",
              fontWeight: 600,
              color: "var(--text-primary)",
              letterSpacing: "var(--ls-headline)",
              lineHeight: "var(--lh-tight)",
              margin: "var(--sp-3) 0 0",
            }}
          >
            Moin, <span className="accent-word">{displayName}</span>
          </h1>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <PeriodSwitcher value={period} />
        </div>
      </header>

      {/* ══ KPI-REIHE ══ */}
      <div className="grid-4-stat" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sp-6)" }}>
        <StatTile
          label={`DMs · ${periodLabel}`}
          value={periodDms.toLocaleString("de-DE")}
          sub={`${alltimeDms.toLocaleString("de-DE")} gesamt`}
          icon={<MessageSquare size={14} />}
        />
        <StatTile
          label="Antwortquote"
          value={answerRate === null ? "—" : formatRate(answerRate)}
          sub={`${periodAnswers.toLocaleString("de-DE")} Antworten`}
          icon={<TrendingUp size={14} />}
        />
        <StatTile
          label="Terminquote"
          value={apptRate === null ? "—" : formatRate(apptRate)}
          sub={`${periodAppts.toLocaleString("de-DE")} Termine · Zielband 3–7 %`}
          tone={apptTone}
          chip={
            apptRate === null ? undefined : (
              <StatChip tone={apptTone}>
                {apptRate < 3 ? "unter Ziel" : apptRate > 7 ? "über Ziel" : "im Zielband"}
              </StatChip>
            )
          }
          icon={<CalendarCheck size={14} />}
        />
        <StatTile
          label="Follow-ups fällig"
          value={fuDue.toLocaleString("de-DE")}
          sub={fuDue > 0 ? "Nachfassen öffnen" : "nichts offen"}
          tone={NUM(fuRow?.overdue) > 0 ? "warning" : "neutral"}
          chip={
            NUM(fuRow?.overdue) > 0 ? (
              <StatChip tone="warning">{NUM(fuRow?.overdue).toLocaleString("de-DE")} überfällig</StatChip>
            ) : undefined
          }
          href="/nachfassen"
          icon={<Bell size={14} />}
        />
      </div>

      {/* ══ ZIELE ══ */}
      <SectionCard title="Ziele" icon={<Target size={16} />} meta={`KW ${getISOWeek(monday)}`}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-7)" }}>
          <GoalProgress label="Heute" current={todayDms} goal={dailyGoal} />
          <GoalProgress label="Diese Woche" current={weekDms} goal={weeklyGoal} />
          {showPhoneGoal && (
            <GoalProgress label="Telefon Woche" current={phoneWeek.calls} goal={phoneWeeklyGoal} unit="Anrufe" />
          )}
        </div>
      </SectionCard>

      {/* ══ TREND ══ */}
      <SectionCard title="Trend" icon={<TrendingUp size={16} />} meta="10 Wochen">
        <PersonalWeeklyChart data={trendWeeks} />
      </SectionCard>

      {/* ══ FUNNEL ══ */}
      <SectionCard title="Funnel" icon={<CalendarCheck size={16} />} meta="DM → Termin → Abschluss">
        <PersonalFunnel stages={funnelStages} />
      </SectionCard>

      {/* ══ TELEFON ══ */}
      {showPhoneCard && (
        <SectionCard title="Telefon" icon={<Phone size={16} />} href="/telefon" meta={periodLabel}>
          <div className="grid-4-stat" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--sp-6)" }}>
            {[
              { label: `Anrufe · ${periodLabel}`, value: phonePeriod.calls },
              { label: "Entscheider erreicht", value: phonePeriod.decider },
              { label: "Termine gesetzt", value: phonePeriod.appointments },
            ].map((s) => (
              <div key={s.label} style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
                <div
                  className="eyebrow eyebrow-muted"
                  style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  {s.label}
                </div>
                <div className="kpi-value" style={{ fontSize: "var(--fs-xl)" }}>
                  {s.value.toLocaleString("de-DE")}
                </div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", marginTop: "var(--sp-6)" }}>
            Anrufe sind auf den Zeitraum gefiltert, Entscheider und Termine zählen gesamt.
          </p>
        </SectionCard>
      )}

    </div>
  );
}
