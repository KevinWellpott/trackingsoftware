import Link from "next/link";
import { ArrowRight, CalendarCheck, CalendarPlus, MessageSquare, Phone, Target, TrendingUp } from "lucide-react";
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
import { berlinWindowIso } from "@/components/dashboard/periodWindow";
import { ViewingBanner } from "@/components/dashboard/ViewingBanner";

// Persönliches Home-Dashboard: zeigt genau EINE Person (scopeUserId).
// Alle Kennzahlen kommen aus gescopten RPCs/Head-Counts — kein Full-Table-Load.
//
// GRUNDREGEL DIESER SEITE: Der Zeitraum-Umschalter muss auf JEDE Zahl wirken.
// Wo eine Zahl bewusst ein Bestand ist (offene Follow-ups, All-time-Summe),
// steht das im Label bzw. in der Subline — sonst liest der Nutzer eine
// Bestandszahl als Zeitraumzahl und hält den Umschalter für kaputt.
//
// Die drei Definitionen von „Termin" werden hier bewusst getrennt gehalten:
//   1. GELEGT    = im Zeitraum gebucht (setting_calls.created_at)
//                  → rpc_appointments_booked, Kachel „Termine gelegt".
//   2. absolut   = findet im Zeitraum statt (appointment_at) — nur im Analyse-
//                  Bereich, hier nicht dargestellt.
//   3. Kohorte   = wie viele der IM ZEITRAUM GEPITCHTEN Kontakte irgendwann
//                  einen Termin bekamen → rpc_owner_day_metrics.appts,
//                  Kachel „Terminquote (aus Pitches)" und Funnel-Stufe
//                  „Termine". Beantwortet Konversion, nicht Aktivität.

type DayRow = {
  owner_name: string | null;
  day: string;
  dms: number | string | null;
  answers: number | string | null;
  appts: number | string | null;
};

type ApptRateRow = { total_dms: number | string | null; total_appts: number | string | null };

/** rpc_appointments_booked: je Person und Berlin-Tag die Zahl gebuchter Termine. */
type BookedRow = { user_id: string | null; day: string; cnt: number | string | null };

/** rpc_phone_day_metrics — je Owner UND Tag, deshalb durchgehend zeitraumgefiltert. */
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

type ClosingRow = { status: string | null; deal_volume: number | string | null };

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

  // Halboffenes Fenster [von, morgen) in echtem UTC — Grenzen für alle Filter
  // auf `timestamptz`-Spalten (docs §6).
  const { startIso: periodFromIso, endIso: periodToIso } = berlinWindowIso(periodFrom, today);

  // Personen-Zuordnung eines Termins: „zugewiesen ODER (nicht zugewiesen UND
  // selbst angelegt)" — die PostgREST-Entsprechung von personOf()
  // (src/lib/personResolution.ts), gebaut wie buildOwnScope() in access.ts.
  // Der reine created_by_user_id-Filter von früher verlor jeden Termin, den
  // jemand anderes FÜR diese Person angelegt hat.
  const personFilter =
    `assigned_user_id.eq.${scopeUserId},and(assigned_user_id.is.null,created_by_user_id.eq.${scopeUserId})`;

  // Setting-Kopfzahlen: Stichtag ist `created_at` = „gelegt", identisch zur
  // Definition von rpc_appointments_booked. Ein anderer Stichtag hier würde
  // Kachel und Funnel-Stufe auseinanderlaufen lassen.
  const settingCount = (status?: string) => {
    let q = supabase
      .from("setting_calls")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", access.workspace_id)
      .or(personFilter)
      .gte("created_at", periodFromIso)
      .lt("created_at", periodToIso);
    if (status) q = q.eq("status", status);
    return q;
  };

  const phonePeriodPromise = supabase.rpc("rpc_phone_day_metrics", {
    p_workspace_id: access.workspace_id,
    p_from: periodFrom,
    p_to: today,
    p_effective_user_id: scopeUserId,
  });

  const [
    targets,
    dayRes,
    apptRateRes,
    bookedRes,
    phonePeriodRes,
    phoneWeekRes,
    settingOpenRes,
    closingRes,
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
    // „Termine gelegt" — die Zahl, nach der der Auftraggeber steuert.
    supabase.rpc("rpc_appointments_booked", {
      p_workspace_id: access.workspace_id,
      p_from: periodFrom,
      p_to: today,
      p_effective_user_id: scopeUserId,
    }),
    phonePeriodPromise,
    period === "w"
      ? phonePeriodPromise
      : supabase.rpc("rpc_phone_day_metrics", {
          p_workspace_id: access.workspace_id,
          p_from: monday,
          p_to: today,
          p_effective_user_id: scopeUserId,
        }),
    settingCount("offen"),
    // Closing + Umsatz aus EINER Zeilenmenge, damit „Gewonnen" und „€" nie
    // auseinanderlaufen. Stichtag = Closing-Termin mit Fallback auf die
    // Anlage — exakt closingEffDate() aus src/lib/analyse.ts, damit Dashboard
    // und Closing-Tab dieselbe Zahl zeigen.
    supabase
      .from("closing_calls")
      .select("status, deal_volume")
      .eq("workspace_id", access.workspace_id)
      .or(personFilter)
      .or(
        `and(call_at.gte.${periodFromIso},call_at.lt.${periodToIso}),` +
        `and(call_at.is.null,created_at.gte.${periodFromIso},created_at.lt.${periodToIso})`,
      ),
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

  // ── Termine gelegt (RPC ab Migration 0028 → bei Fehler 0)
  const bookedPeriod = (bookedRes.error ? [] : ((bookedRes.data ?? []) as BookedRow[]))
    .reduce((sum, r) => sum + NUM(r.cnt), 0);

  // ── Telefon: rpc_phone_day_metrics statt rpc_phone_owner_metrics. Bei der
  //    Owner-RPC ist NUR `calls` zeitraumgefiltert (docs §5), Entscheider und
  //    Termine zählten dort all-time — die Tages-RPC filtert alle Spalten über
  //    denselben Tag, das Aufsummieren ergibt echte Zeitraumwerte.
  const sumPhone = (res: typeof phonePeriodRes) => {
    const rows = res.error ? [] : ((res.data ?? []) as PhoneDayRow[]);
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

  // ── Setting / Closing / Umsatz — alle drei jetzt zeitraumgefiltert
  const settingOpen = settingOpenRes.count ?? 0;
  let closingTotal = 0, closingOpen = 0, closingWon = 0, revenue = 0;
  for (const row of (closingRes.data ?? []) as ClosingRow[]) {
    closingTotal += 1;
    if (row.status === "offen") closingOpen += 1;
    if (row.status === "gewonnen") {
      closingWon += 1;
      revenue += NUM(row.deal_volume);
    }
  }

  // ── Ziele
  const dailyGoal = resolveTarget(targets, scopeUserId, "linkedin", "daily", "pitches");
  const weeklyGoal = resolveTarget(targets, scopeUserId, "linkedin", "weekly", "pitches");
  const phoneWeeklyGoal = resolveTarget(targets, scopeUserId, "telefon", "weekly", "calls");
  const phoneTargetSet = targets.some(
    (t) => t.user_id === scopeUserId && t.channel === "telefon" && t.metric === "calls" && t.target_value > 0,
  );
  const showPhoneGoal = phoneTargetSet || phoneWeek.calls > 0;
  const showPhoneCard = phoneTargetSet || phonePeriod.calls > 0;

  // ── Quoten (beide auf die Pitches DES ZEITRAUMS bezogen)
  const answerRate = periodDms > 0 ? (periodAnswers / periodDms) * 100 : null;
  const apptRate = periodDms > 0 ? (periodAppts / periodDms) * 100 : null;
  const apptTone = apptRate === null ? "neutral" : apptRate < 3 ? "error" : apptRate > 7 ? "brand" : "success";

  const funnelStages: FunnelStage[] = [
    { label: "DMs", value: periodDms.toLocaleString("de-DE"), sub: periodLabel },
    { label: "Antworten", value: periodAnswers.toLocaleString("de-DE"), sub: periodLabel },
    { label: "Termine", value: periodAppts.toLocaleString("de-DE"), sub: `aus Pitches · ${periodLabel}` },
    { label: "Setting", value: bookedPeriod.toLocaleString("de-DE"), sub: `gelegt · ${settingOpen.toLocaleString("de-DE")} offen`, href: "/termine" },
    { label: "Closing", value: closingTotal.toLocaleString("de-DE"), sub: `${closingOpen.toLocaleString("de-DE")} offen`, href: "/termine" },
    { label: "Gewonnen", value: closingWon.toLocaleString("de-DE"), sub: EUR.format(revenue), href: "/termine" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>

      {/* ══ VIEWING-BANNER (Impersonation) ══ */}
      {access.can_switch_view && access.effective_user_id && (
        <ViewingBanner name={access.effective_username ?? "Ausgewählter Nutzer"} />
      )}

      {/* ══ HEADER ══
          Ohne `ember-glow`: Der Verlauf lief 220px nach unten und endete dort
          mit einer sichtbaren Kante — auf dem Near-Black-Canvas las sich das
          nicht als Glueh-Effekt, sondern als dunkler Balken quer ueber den
          Seitenkopf. Der Hero-Moment bleibt das Gradient-Wort im Namen
          (DESIGN.md §5); das traegt allein. */}
      <header
        className="section-header-mobile"
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

      {/* ══ KPI-REIHE ══
          Vier Kacheln folgen dem Umschalter, die fünfte ist explizit als
          Bestand beschriftet — auto-fit statt fester Spaltenzahl, damit die
          fünfte Kachel auf schmalen Desktops sauber umbricht. */}
      <div className="grid-4-stat" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--sp-6)" }}>
        <StatTile
          label={`DMs · ${periodLabel}`}
          value={periodDms.toLocaleString("de-DE")}
          sub={`${alltimeDms.toLocaleString("de-DE")} gesamt`}
          icon={<MessageSquare size={14} />}
        />
        <StatTile
          label={`Antwortquote · ${periodLabel}`}
          value={answerRate === null ? "—" : formatRate(answerRate)}
          sub={`${periodAnswers.toLocaleString("de-DE")} Antworten`}
          icon={<TrendingUp size={14} />}
        />
        {/* Definition 1: im Zeitraum GEBUCHT — über alle Kanäle (LinkedIn,
            Telefon, manuell), unabhängig davon, wann der Termin stattfindet. */}
        <StatTile
          label={`Termine gelegt · ${periodLabel}`}
          value={bookedPeriod.toLocaleString("de-DE")}
          sub="im Zeitraum gebucht"
          href="/termine"
          icon={<CalendarPlus size={14} />}
        />
        {/* Definition 3: Konversion der im Zeitraum gepitchten Kontakte —
            eine andere Frage als „gelegt", deshalb der Zusatz im Label. */}
        <StatTile
          label="Terminquote (aus Pitches)"
          value={apptRate === null ? "—" : formatRate(apptRate)}
          sub={`${periodAppts.toLocaleString("de-DE")} von ${periodDms.toLocaleString("de-DE")} · Ziel 3–7 %`}
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
      </div>

      {/* ══ ZIELE ══ */}
      <SectionCard title="Ziele" icon={<Target size={16} />} meta={`KW ${getISOWeek(monday)} · fest auf Tag/Woche`}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-7)" }}>
          <GoalProgress label="Heute" current={todayDms} goal={dailyGoal} />
          <GoalProgress label="Diese Woche" current={weekDms} goal={weeklyGoal} />
          {showPhoneGoal && (
            <GoalProgress label="Telefon Woche" current={phoneWeek.calls} goal={phoneWeeklyGoal} unit="Anrufe" />
          )}
        </div>
      </SectionCard>

      {/* ══ TREND ══ */}
      <SectionCard title="Trend" icon={<TrendingUp size={16} />} meta="10 Wochen · fest">
        <PersonalWeeklyChart data={trendWeeks} />
      </SectionCard>

      {/* ══ FUNNEL ══ */}
      <SectionCard title="Funnel" icon={<CalendarCheck size={16} />} meta={periodLabel}>
        <PersonalFunnel stages={funnelStages} />
        <p style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", marginTop: "var(--sp-6)" }}>
          „Termine“ zählt Kontakte, die im Zeitraum <strong style={{ fontWeight: 600 }}>gepitcht</strong> wurden und
          irgendwann einen Termin bekamen (Konversion). „Setting“ zählt Termine, die im Zeitraum{" "}
          <strong style={{ fontWeight: 600 }}>gelegt</strong> wurden — inklusive Telefon und manuell.
          „Closing“ und „Gewonnen“ richten sich nach dem Closing-Termin.
        </p>
      </SectionCard>

      {/* ══ TELEFON ══ */}
      {showPhoneCard && (
        <SectionCard title="Telefon" icon={<Phone size={16} />} href="/telefon" meta={periodLabel}>
          <div className="grid-4-stat" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--sp-6)" }}>
            {[
              { label: "Anrufe", value: phonePeriod.calls },
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
        </SectionCard>
      )}

    </div>
  );
}
