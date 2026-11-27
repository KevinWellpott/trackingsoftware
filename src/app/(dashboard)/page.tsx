import { berlinDateISO } from "@/lib/apptTime";
import Link from "next/link";
import { ArrowRight, MessageSquare, Phone, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { rpcAll } from "@/lib/supabase/fetchAll";
import { getAccessContext } from "@/lib/access";
import { addDaysISO, getISOWeek, weekStart } from "@/lib/dates";
import { getTargets } from "@/app/actions/targets";
import { resolveTarget } from "@/lib/targets";
import { Card } from "@/components/ui/Card";
import { PersonalWeeklyChart, type PersonalWeekPoint } from "@/components/DashboardCharts";
import { PeriodSwitcher, type DashboardPeriod } from "@/components/dashboard/PeriodSwitcher";
import { GoalProgress } from "@/components/dashboard/GoalProgress";
import { berlinWindowIso } from "@/components/dashboard/periodWindow";
import { ViewingBanner } from "@/components/dashboard/ViewingBanner";
import { KennzahlModul } from "@/components/dashboard/KennzahlModul";
import { HeuteDranKarte, HeuteImKalenderKarte, type HeuteDranEintrag } from "@/components/dashboard/HeuteKarten";
import { TrichterBalken } from "@/components/analyse/TrichterBalken";
import { TerminBuchenAktion } from "@/components/termine/TerminBuchenAktion";
import { getNavCounts } from "@/lib/navCountsData";
import { ladeNachfassen } from "@/lib/nachfassenData";
import { gruppiere } from "@/lib/nachfassRegel";
import { loadDialRows } from "@/lib/phoneAttemptsData";
import { buildEvents, type WithCancellation } from "@/lib/termine";
import type { ClosingCall, SettingCall } from "@/lib/types";

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

  const today = berlinDateISO(new Date().toISOString());
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
  const { startIso: heuteVonIso, endIso: heuteBisIso } = berlinWindowIso(today, today);

  // Personen-Zuordnung eines Termins: „zugewiesen ODER (nicht zugewiesen UND
  // selbst angelegt)" — die PostgREST-Entsprechung von personOf()
  // (src/lib/personResolution.ts), gebaut wie buildOwnScope() in access.ts.
  // Der reine created_by_user_id-Filter von früher verlor jeden Termin, den
  // jemand anderes FÜR diese Person angelegt hat.
  const personFilter =
    `assigned_user_id.eq.${scopeUserId},and(assigned_user_id.is.null,created_by_user_id.eq.${scopeUserId})`;
  // Closings zählen bei der Person, die das Gespräch GEFÜHRT hat — die
  // PostgREST-Entsprechung von gespraechsPersonOf() (personResolution.ts):
  // „Durchgeführt von", sonst die Zuweisung, sonst der Ersteller. So rechnen
  // auch /team und der Closing-Tab; mit dem reinen personFilter landete jedes
  // Closing bei der festen Closing-Person (Live-Test 26.11., P1-5).
  const gespraechsFilter =
    `conducted_by_user_id.eq.${scopeUserId},` +
    `and(conducted_by_user_id.is.null,assigned_user_id.eq.${scopeUserId}),` +
    `and(conducted_by_user_id.is.null,assigned_user_id.is.null,created_by_user_id.eq.${scopeUserId})`;

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
    if (status === "qualifiziert") q = q.in("status", ["qualifiziert", "closing_gelegt"]);
    else if (status === "show") q = q.eq("show_status", "show");
    else if (status) q = q.eq("status", status);
    // „offen" heißt hier: Termin ohne Ergebnis. Eine wirksame Absage lässt
    // den Status unangetastet (docs §3) und ist trotzdem kein offener Termin
    // (Live-Test 26.11., P2-4). Neu terminiert (`revived_at`) zählt wieder.
    if (status === "offen") q = q.or("cancelled_at.is.null,revived_at.not.is.null");
    return q;
  };

  const phonePeriodPromise = rpcAll(supabase, "rpc_phone_day_metrics", {
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
    phoneBookedRes,
    closingRes,
    navCounts,
    dials,
    showRes,
    qualiRes,
    bookedTrendRes,
    nachfassen,
    heuteSettingRes,
    heuteClosingRes,
  ] = await Promise.all([
    getTargets(),
    rpcAll(supabase, "rpc_owner_day_metrics", {
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
      : rpcAll(supabase, "rpc_phone_day_metrics", {
          p_workspace_id: access.workspace_id,
          p_from: monday,
          p_to: today,
          p_effective_user_id: scopeUserId,
        }),
    settingCount("offen"),
    // Gelegte TELEFON-Termine (Entscheidung E1, Live-Test N12) — dieselbe
    // Zahl wie auf /telefon, nicht die Erstkontakt-Kohorte der RPC.
    supabase
      .from("setting_calls")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", access.workspace_id)
      .eq("source_type", "telefon")
      .or(personFilter)
      .gte("created_at", periodFromIso)
      .lt("created_at", periodToIso),
    // Closing + Umsatz aus EINER Zeilenmenge, damit „Gewonnen" und „€" nie
    // auseinanderlaufen. Stichtag = Closing-Termin mit Fallback auf die
    // Anlage — exakt closingEffDate() aus src/lib/analyse.ts, damit Dashboard
    // und Closing-Tab dieselbe Zahl zeigen.
    supabase
      .from("closing_calls")
      .select("status, deal_volume")
      .eq("workspace_id", access.workspace_id)
      .or(gespraechsFilter)
      .or(
        `and(call_at.gte.${periodFromIso},call_at.lt.${periodToIso}),` +
        `and(call_at.is.null,created_at.gte.${periodFromIso},created_at.lt.${periodToIso})`,
      ),
    // Die Zahlen für den Quicklink-Streifen. Dieselbe Hülle, die auch das
    // Layout für die Seitenleiste aufruft — sie ist pro Anfrage memoisiert
    // (src/lib/navCountsData.ts), die vier Abfragen laufen also EINMAL. Sie
    // hängt sich in dieses Bündel ein, statt davor oder danach zu laufen, und
    // bringt ihre eigene 1,5-Sekunden-Frist mit: kommt nichts, stehen die
    // Kacheln ohne Zahl da (nie mit einer 0).
    getNavCounts(),
    // Anwahlen aus dem Anruf-Log — JEDER Wählversuch, auch Rückrufe und
    // Folgeanrufe. Die RPC oben zählt nur Erstkontakte (jede Firma einmal) und
    // liefert hier nur noch Entscheider und Termine (docs §1, „Anwahl").
    loadDialRows(supabase, access.workspace_id, periodFrom < monday ? periodFrom : monday, today, {
      username: displayName,
      userId: scopeUserId,
    }),
    // ── Trichter „Von Termin zu Geld" — dieselbe Menge wie „Termine gelegt"
    // (Stichtag `created_at`, Person `personFilter`), davon erschienen und
    // qualifiziert. Dieselbe Kohorte, deshalb dürfen zwischen diesen drei
    // Stufen Durchlassquoten stehen.
    settingCount("show"),
    settingCount("qualifiziert"),
    // „Termine gelegt" je Woche über 10 Wochen — derselbe RPC wie die Kachel,
    // nur über das Trend-Fenster. Ergibt den Verlauf am Kennzahl-Modul.
    supabase.rpc("rpc_appointments_booked", {
      p_workspace_id: access.workspace_id,
      p_from: trendFrom,
      p_to: today,
      p_effective_user_id: scopeUserId,
    }),
    // „Heute dran": DERSELBE Loader wie /nachfassen und das Badge (pro
    // Anfrage memoisiert, src/lib/nachfassenData.ts) — keine eigene Abfrage.
    ladeNachfassen("mein").catch(() => null),
    // „Heute im Kalender": die Termine des Berliner Tages, Person wie
    // „Termine gelegt". `select("*")` wie der Kalender (lib/termine.ts).
    supabase
      .from("setting_calls")
      .select("*")
      .eq("workspace_id", access.workspace_id)
      .or(personFilter)
      .gte("appointment_at", heuteVonIso)
      .lt("appointment_at", heuteBisIso),
    supabase
      .from("closing_calls")
      .select("*")
      .eq("workspace_id", access.workspace_id)
      .or(personFilter)
      .gte("call_at", heuteVonIso)
      .lt("call_at", heuteBisIso),
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
  // Fehlt das Log (Abfrage gescheitert), bleibt die Erstkontakt-Zahl als
  // Untergrenze stehen — lieber zu wenig als eine erfundene 0.
  const periodDials = dials.available
    ? dials.rows.filter((r) => r.day >= periodFrom).length
    : phonePeriod.calls;
  const weekDials = dials.available ? dials.rows.filter((r) => r.day >= monday).length : phoneWeek.calls;
  // Entscheider = Anwahlen mit Entscheider am Apparat; Termin und „Kein
  // Termin" setzen ihn voraus (N5). Ohne Log bleibt die Kohortenzahl der RPC.
  const periodDecider = dials.available
    ? dials.rows.filter(
        (r) => r.day >= periodFrom && (r.decider_reached || r.outcome === "termin" || r.outcome === "kein_termin"),
      ).length
    : phonePeriod.decider;
  const phoneBooked = phoneBookedRes.count ?? 0;

  // ── Setting / Closing / Umsatz — alle drei jetzt zeitraumgefiltert
  const settingOpen = settingOpenRes.count ?? 0;
  let closingTotal = 0, closingWon = 0, revenue = 0;
  for (const row of (closingRes.data ?? []) as ClosingRow[]) {
    closingTotal += 1;
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
  const showPhoneGoal = phoneTargetSet || weekDials > 0;
  const showPhoneCard = phoneTargetSet || periodDials > 0 || phonePeriod.calls > 0;

  // ── Quoten (beide auf die Pitches DES ZEITRAUMS bezogen)
  const answerRate = periodDms > 0 ? (periodAnswers / periodDms) * 100 : null;
  const apptRate = periodDms > 0 ? (periodAppts / periodDms) * 100 : null;
  const apptBand = apptRate === null ? null : apptRate < 3 ? "unter Ziel" : apptRate > 7 ? "über Ziel" : "im Zielband";

  // ── Termine gelegt je Woche (10 Wochen) — Verlauf am Kennzahl-Modul.
  const bookedRows = bookedTrendRes.error ? [] : ((bookedTrendRes.data ?? []) as BookedRow[]);
  const bookedSpark: number[] = [];
  for (let i = 9; i >= 0; i--) {
    const wStart = addDaysISO(monday, -i * 7);
    const wEnd = addDaysISO(wStart, 6);
    bookedSpark.push(bookedRows.filter((r) => r.day >= wStart && r.day <= wEnd).reduce((n, r) => n + NUM(r.cnt), 0));
  }

  // ── Heute dran: die Gruppen des Eingangs, in seiner Reihenfolge, gekürzt.
  const nfGruppen = nachfassen ? gruppiere(nachfassen.eintraege, nachfassen.today, nachfassen.nowMs) : null;
  const heuteDran: HeuteDranEintrag[] = nfGruppen
    ? (["ergebnis_fehlt", "ueberfaellig", "heute"] as const).flatMap((g) =>
        (nfGruppen.get(g) ?? []).map((e) => ({ e, gruppe: g })),
      )
    : [];
  // Die Zahl ist die des Badges (getNavCounts) — EINE Quelle für „wie viele".
  const dranZahl = navCounts.nachfassen;

  // ── Heute im Kalender
  const { events: heuteTermine } = buildEvents(
    (heuteSettingRes.data ?? []) as WithCancellation<SettingCall>[],
    (heuteClosingRes.data ?? []) as WithCancellation<ClosingCall>[],
    new Map([[scopeUserId, displayName]]),
    today,
    nachfassen?.nowMs ?? null,
  );

  // ── Trichter „Von Termin zu Geld" — beginnt beim Termin; DMs und Anwahlen
  // stehen bei ihren Kanälen und werden nie addiert (docs §5.1).
  const shows = showRes.count ?? 0;
  const quali = qualiRes.count ?? 0;
  const trichter = [
    { label: "Termine gelegt", value: bookedPeriod },
    { label: "Erschienen", value: shows },
    { label: "Qualifiziert", value: quali },
    // Ab hier eine andere Menge: Closings zählen nach dem Closing-Termin und
    // bei der Person, die das Gespräch geführt hat. Eine Quote zwischen den
    // beiden Mengen wäre erfunden — der Trichter sagt das an der Stelle.
    { label: "Closings", value: closingTotal, bruch: "Closings nach Closing-Termin · eigene Menge" },
    { label: "Gewonnen", value: closingWon },
  ];

  // ── Ein Satz Lage
  const kalenderSatz = heuteTermine.length
    ? `${heuteTermine.length} ${heuteTermine.length === 1 ? "Termin" : "Termine"} im Kalender`
    : null;
  const lage =
    dranZahl === null
      ? "Dein Tag auf einen Blick."
      : dranZahl.total === 0
        ? `Niemand ist gerade fällig${kalenderSatz ? ` — heute stehen ${kalenderSatz}.` : "."}`
        : `${dranZahl.total} ${dranZahl.total === 1 ? "Mensch wartet" : "Menschen warten"} heute auf dich${
            dranZahl.overdue > 0 ? `, ${dranZahl.overdue} davon überfällig` : ""
          }${kalenderSatz ? ` — dazu ${kalenderSatz}.` : "."}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>

      {/* ══ VIEWING-BANNER (Impersonation) ══ */}
      {access.can_switch_view && access.effective_user_id && (
        <ViewingBanner name={access.effective_username ?? "Ausgewählter Nutzer"} />
      )}

      {/* ══ BEGRÜSSUNG ══ (Prototyp `.hello`) — Name, ein Satz Lage, rechts
          der Zeitraum. Der Satz rechnet nichts Eigenes: Die Zahl ist die des
          Badges, die Termine die der Karte „Heute im Kalender". */}
      <header className="dash-hello section-header-mobile">
        <div>
          <h1>
            Moin, <span className="accent-word">{displayName}</span>.
          </h1>
          <p>{lage}</p>
        </div>
        <div className="dash-hello-r">
          <PeriodSwitcher value={period} />
          <TerminBuchenAktion />
        </div>
      </header>

      {/* ══ KENNZAHL-MODULE ══
          Vier Module, jedes mit Wert und dem, wogegen er zu lesen ist. Die
          Definitionen sind die bisherigen: „Termine gelegt" = Buchung
          (rpc_appointments_booked), Umsatz nach Closing-Termin und
          Gesprächsperson, Anwahlen aus dem Anruf-Log. Der frühere
          Quicklink-Streifen ist in „Heute dran" und den Links der Module
          aufgegangen. */}
      <div className="grid-4-stat km-row">
        <KennzahlModul
          label="Heute dran"
          value={dranZahl === null ? "—" : dranZahl.total.toLocaleString("de-DE")}
          sub={
            dranZahl === null
              ? "nicht ermittelbar"
              : dranZahl.overdue > 0
                ? `${dranZahl.overdue.toLocaleString("de-DE")} überfällig`
                : "überfällig, heute, Ergebnis fehlt"
          }
          href="/nachfassen"
          dran={Boolean(dranZahl && dranZahl.total > 0)}
        />
        {showPhoneCard ? (
          <KennzahlModul
            label={`Anwahlen · ${periodLabel}`}
            value={periodDials.toLocaleString("de-DE")}
            unit={period === "w" && phoneWeeklyGoal > 0 ? `von ${phoneWeeklyGoal.toLocaleString("de-DE")}` : undefined}
            meter={period === "w" && phoneWeeklyGoal > 0 ? (weekDials / phoneWeeklyGoal) * 100 : null}
            sub={`${periodDecider.toLocaleString("de-DE")} Entscheider erreicht`}
            href="/telefon"
          />
        ) : (
          <KennzahlModul
            label={`DMs · ${periodLabel}`}
            value={periodDms.toLocaleString("de-DE")}
            unit={period === "w" && weeklyGoal > 0 ? `von ${weeklyGoal.toLocaleString("de-DE")}` : undefined}
            meter={period === "w" && weeklyGoal > 0 ? (weekDms / weeklyGoal) * 100 : null}
            sub={`${alltimeDms.toLocaleString("de-DE")} gesamt`}
            href="/listen"
          />
        )}
        <KennzahlModul
          label={`Termine gelegt · ${periodLabel}`}
          value={bookedPeriod.toLocaleString("de-DE")}
          sub={`${settingOpen.toLocaleString("de-DE")} ohne Ergebnis · Verlauf 10 Wochen`}
          spark={bookedSpark}
          href="/setting"
        />
        <KennzahlModul
          label={`Umsatz · ${periodLabel}`}
          value={EUR.format(revenue)}
          sub={`${closingWon.toLocaleString("de-DE")} gewonnen von ${closingTotal.toLocaleString("de-DE")} Closings`}
          href="/closing?status=gewonnen"
        />
      </div>

      {/* ══ HEUTE ══ */}
      <div className="dash-grid-2">
        <HeuteDranKarte
          eintraege={heuteDran.slice(0, 6)}
          gesamt={dranZahl?.total ?? null}
          vollstaendig={nachfassen?.vollstaendig ?? false}
        />
        <HeuteImKalenderKarte termine={heuteTermine} />
      </div>

      {/* ══ VON TERMIN ZU GELD ══ */}
      <section className="card dash-card">
        <header className="dash-card-head">
          <h2>Von Termin zu Geld</h2>
          <span className="dash-meta">{periodLabel} · alle Kanäle</span>
          <Link href="/analyse?tab=funnel" className="dash-more">
            Analyse <ArrowRight size={13} aria-hidden />
          </Link>
        </header>
        <div className="dash-card-body">
          <TrichterBalken stufen={trichter} abschluss={{ label: "Umsatz", value: EUR.format(revenue) }} />
        </div>
        <p className="dash-foot">
          Der Trichter beginnt beim Termin: Termine, die im Zeitraum <strong>gelegt</strong> wurden, davon
          erschienen und qualifiziert. Closings, Gewonnen und Umsatz richten sich nach dem Closing-Termin und zählen
          bei der Person, die das Gespräch geführt hat. DMs und Anwahlen stehen bei ihren Kanälen.
        </p>
      </section>

      {/* ══ KANÄLE ══ — DMs und Anwahlen getrennt, nie addiert. */}
      <div className="dash-grid-2">
        <SectionCard title="LinkedIn" icon={<MessageSquare size={16} />} href="/listen" meta={periodLabel}>
          <div className="dash-stats">
            {[
              { label: "DMs", value: periodDms.toLocaleString("de-DE"), sub: `${alltimeDms.toLocaleString("de-DE")} gesamt` },
              {
                label: "Antwortquote",
                value: answerRate === null ? "—" : formatRate(answerRate),
                sub: `${periodAnswers.toLocaleString("de-DE")} Antworten`,
              },
              {
                label: "Terminquote (aus Pitches)",
                value: apptRate === null ? "—" : formatRate(apptRate),
                sub: `${periodAppts.toLocaleString("de-DE")} von ${periodDms.toLocaleString("de-DE")}${
                  apptBand ? ` · ${apptBand}` : ""
                } · Ziel 3–7 %`,
              },
            ].map((s) => (
              <div key={s.label} className="dash-stat">
                <span className="dash-stat-l">{s.label}</span>
                <span className="kpi-value" style={{ fontSize: "var(--fs-xl)" }}>
                  {s.value}
                </span>
                <span className="dash-stat-s">{s.sub}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)", marginTop: "var(--sp-7)" }}>
            <GoalProgress label="Heute" current={todayDms} goal={dailyGoal} />
            <GoalProgress label="Diese Woche" current={weekDms} goal={weeklyGoal} />
          </div>
        </SectionCard>

        <SectionCard title="Telefon" icon={<Phone size={16} />} href="/telefon" meta={periodLabel}>
          {showPhoneCard ? (
            <>
              <div className="dash-stats">
                {[
                  { label: "Anwahlen", value: periodDials },
                  { label: "Entscheider erreicht", value: periodDecider },
                  { label: "Termine gelegt", value: phoneBooked },
                ].map((s) => (
                  <div key={s.label} className="dash-stat">
                    <span className="dash-stat-l">{s.label}</span>
                    <span className="kpi-value" style={{ fontSize: "var(--fs-xl)" }}>
                      {s.value.toLocaleString("de-DE")}
                    </span>
                  </div>
                ))}
              </div>
              {showPhoneGoal && (
                <div style={{ marginTop: "var(--sp-7)" }}>
                  <GoalProgress label="Telefon Woche" current={weekDials} goal={phoneWeeklyGoal} unit="Anwahlen" />
                </div>
              )}
            </>
          ) : (
            <p className="dash-leer" style={{ padding: 0 }}>
              Im Zeitraum noch keine Anwahl und kein Wochenziel. <Link href="/telefon">Zur Telefon-Übersicht</Link>
            </p>
          )}
        </SectionCard>
      </div>

      {/* ══ TREND ══ */}
      <SectionCard title="Trend" icon={<TrendingUp size={16} />} meta={`10 Wochen · KW ${getISOWeek(monday)}`}>
        <PersonalWeeklyChart data={trendWeeks} />
      </SectionCard>
    </div>
  );
}
