import { redirect } from "next/navigation";
import Link from "next/link";
import { Archive, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext, listDataViewUsers } from "@/lib/access";
import { getTargets } from "@/app/actions/targets";
import { personOf } from "@/lib/personResolution";
import { resolveTarget } from "@/lib/targets";
import { addDaysISO, getISOWeek, localDateISO, weekStart } from "@/lib/dates";
import { WochenduellSection } from "@/components/dashboard/WochenduellSection";
import { berlinWindowIso } from "@/components/dashboard/periodWindow";
import { TeamMemberCard, type TeamMemberMetrics } from "@/components/dashboard/TeamMemberCard";
import { PageHeader } from "@/components/ui/PageHeader";

// Admin-Team-Dashboard: Wochenduell + Team-Vergleich.
// Nur für Owner mit Workspace-Datensicht — alle anderen landen auf "/".
//
// EIN Fenster für den gesamten Vergleich: die laufende Woche (Mo–So). Vorher
// standen dort drei verschiedene Fenster nebeneinander (Woche / 30 Tage /
// all-time), sodass die Karten untereinander nicht vergleichbar waren.
//
// Die Funnel-Sektion ist bewusst entfernt: sie zeigte Bestandszahlen über den
// gesamten Datenbestand (Setting-/Closing-Status, Umsatz all-time) neben lauter
// Wochenzahlen. Diese Seite beantwortet „wie läuft die Woche" — Tiefenanalyse
// gehört nach /analyse.

type OwnerDayRow = {
  owner_name: string | null;
  day: string;
  dms: number | string | null;
  answers: number | string | null;
  appts: number | string | null;
};

/** rpc_phone_day_metrics — je Owner UND Tag, dadurch durchgehend zeitraumgefiltert. */
type PhoneDayRow = {
  owner_name: string | null;
  day: string;
  calls: number | string | null;
};

/** rpc_appointments_booked: je Person und Berlin-Tag die Zahl gebuchter Termine. */
type BookedRow = { user_id: string | null; day: string; cnt: number | string | null };

type WonDealRow = {
  deal_volume: number | string | null;
  assigned_user_id: string | null;
  created_by_user_id: string | null;
};

const NUM = (v: number | string | null | undefined): number => Number(v ?? 0);

export default async function TeamPage() {
  const access = await getAccessContext();
  if (!access) return null;
  if (!(access.role === "owner" && access.data_scope === "workspace")) redirect("/");

  const supabase = await createClient();
  const today = localDateISO();
  const monday = weekStart(today);
  const sunday = addDaysISO(monday, 6);
  const from = addDaysISO(monday, -63); // 10-Wochen-Fenster (9 Wochen vor Montag)

  // UTC-Grenzen der laufenden Woche für die `timestamptz`-Spalten der
  // Closing-Calls (docs §6). Obergrenze ist Mitternacht des Folgetags von
  // heute, nicht von Sonntag: Umsatz aus der Zukunft gibt es nicht.
  const { startIso: weekStartIso, endIso: weekEndIso } = berlinWindowIso(monday, today);

  const [dayRes, phoneRes, bookedRes, wonDealsRes, members, targets] = await Promise.all([
    supabase.rpc("rpc_owner_day_metrics", {
      p_workspace_id: access.workspace_id,
      p_from: from,
      p_to: today,
      p_effective_user_id: null,
    }),
    // rpc_phone_day_metrics statt rpc_phone_owner_metrics: bei der Owner-RPC
    // ist nur `calls` zeitraumgefiltert (docs §5) — und sie lief hier zudem
    // über 30 Tage, während alle anderen Zeilen der Karte die Woche zeigten.
    supabase.rpc("rpc_phone_day_metrics", {
      p_workspace_id: access.workspace_id,
      p_from: monday,
      p_to: today,
      p_effective_user_id: null,
    }),
    // „Termine gelegt" — deckt LinkedIn, Telefon UND manuell in einem Schritt
    // ab. Die Terminquote daneben zählt nur LinkedIn-Pitches.
    supabase.rpc("rpc_appointments_booked", {
      p_workspace_id: access.workspace_id,
      p_from: monday,
      p_to: today,
      p_effective_user_id: null,
    }),
    // Stichtag = Closing-Termin (Fallback Anlage), identisch zu closingEffDate
    // im Analyse-Bereich. Vorher all-time — die Summe war deshalb eine
    // Lebenszeit-Zahl neben lauter Wochenzahlen.
    supabase
      .from("closing_calls")
      .select("deal_volume, assigned_user_id, created_by_user_id")
      .eq("workspace_id", access.workspace_id)
      .eq("status", "gewonnen")
      .or(
        `and(call_at.gte.${weekStartIso},call_at.lt.${weekEndIso}),` +
        `and(call_at.is.null,created_at.gte.${weekStartIso},created_at.lt.${weekEndIso})`,
      ),
    listDataViewUsers(access.workspace_id),
    getTargets(),
  ]);

  // ── Tages-Metriken aller Owner (RPC-Fehler → leer, Seite bleibt nutzbar)
  const dayRows = dayRes.error
    ? []
    : ((dayRes.data ?? []) as OwnerDayRow[]).map((r) => ({
        owner: (r.owner_name ?? "").trim(),
        day: r.day,
        dms: NUM(r.dms),
        answers: NUM(r.answers),
        appts: NUM(r.appts),
      }));

  // ── Roster: Owner mit Aktivität, ABER nur solche, die noch Mitglied sind.
  //    Ohne diesen Abgleich entsteht das Teilnehmerfeld allein aus
  //    `lists.owner_name` — ein längst gelöschter Nutzer bliebe mit 0 DMs als
  //    Dauerverlierer im Duell stehen und verdeckte den echten Letzten.
  const memberKeys = new Set(members.map((m) => m.username.trim().toLowerCase()));
  const roster = [
    ...new Set(
      dayRows
        .map((r) => r.owner)
        .filter((n) => n && n !== "—" && memberKeys.has(n.toLowerCase())),
    ),
  ].sort((a, b) => a.localeCompare(b, "de"));

  // ── Aktuelle Woche (Mo–So) pro Owner
  const weekCounts: Record<string, number> = {};
  for (const name of roster) weekCounts[name] = 0;
  for (const r of dayRows) {
    if (r.day >= monday && r.day <= sunday && weekCounts[r.owner] !== undefined) {
      weekCounts[r.owner] += r.dms;
    }
  }

  // ── Historische Wochen (letzte 10, Mo–So)
  const historicalWeeks: { week: string; counts: Record<string, number> }[] = [];
  for (let i = 9; i >= 0; i--) {
    const wStart = addDaysISO(monday, -i * 7);
    const wEnd = addDaysISO(wStart, 6);
    const counts: Record<string, number> = {};
    for (const name of roster) counts[name] = 0;
    for (const r of dayRows) {
      if (r.day >= wStart && r.day <= wEnd && counts[r.owner] !== undefined) {
        counts[r.owner] += r.dms;
      }
    }
    historicalWeeks.push({ week: `KW ${getISOWeek(wStart)}`, counts });
  }

  // ── Siege letzte 10 Wochen (Sieg = strikt mehr als alle anderen,
  //    geteiltes Maximum = Unentschieden, Null-Wochen zählen nicht)
  const winCounts: Record<string, number> = Object.fromEntries(roster.map((n) => [n, 0]));
  let draws = 0;
  for (const w of historicalWeeks) {
    const counts = roster.map((n) => w.counts[n] ?? 0);
    const weekMax = counts.length > 0 ? Math.max(...counts) : 0;
    if (weekMax === 0) continue;
    const winners = roster.filter((n) => (w.counts[n] ?? 0) === weekMax);
    if (winners.length === 1) winCounts[winners[0]]++;
    else draws++;
  }

  // ── Wochenziel (LinkedIn-Pitches, Default 100)
  const weeklyGoal = resolveTarget(targets, access.user.id, "linkedin", "weekly", "pitches") || 100;

  // ── Team-Vergleich: Kennzahlen pro Mitglied (Owner-Match case-insensitiv)
  const weekByOwner = new Map<string, { dms: number; answers: number; appts: number }>();
  for (const r of dayRows) {
    if (r.day < monday || r.day > sunday || !r.owner) continue;
    const key = r.owner.toLowerCase();
    const agg = weekByOwner.get(key) ?? { dms: 0, answers: 0, appts: 0 };
    agg.dms += r.dms;
    agg.answers += r.answers;
    agg.appts += r.appts;
    weekByOwner.set(key, agg);
  }

  const callsByOwner = new Map<string, number>();
  const phoneRows = phoneRes.error ? [] : ((phoneRes.data ?? []) as PhoneDayRow[]);
  for (const r of phoneRows) {
    const key = (r.owner_name ?? "").trim().toLowerCase();
    if (!key) continue;
    callsByOwner.set(key, (callsByOwner.get(key) ?? 0) + NUM(r.calls));
  }

  // Termine gelegt je Nutzer (RPC ab Migration 0028 → bei Fehler leer).
  const bookedByUser = new Map<string, number>();
  for (const r of bookedRes.error ? [] : ((bookedRes.data ?? []) as BookedRow[])) {
    if (!r.user_id) continue;
    bookedByUser.set(r.user_id, (bookedByUser.get(r.user_id) ?? 0) + NUM(r.cnt));
  }

  // Umsatz-Zuordnung über personOf(): zugewiesen vor Ersteller. Mit dem alten
  // created_by_user_id-Filter landete jeder Abschluss beim Geschäftsführer,
  // der alle Closings führt — sämtliche Setter standen dadurch bei 0 €.
  const revenueByUser = new Map<string, number>();
  for (const row of (wonDealsRes.data ?? []) as WonDealRow[]) {
    const uid = personOf(row);
    if (!uid) continue;
    revenueByUser.set(uid, (revenueByUser.get(uid) ?? 0) + NUM(row.deal_volume));
  }

  const memberCards = members.map((m) => {
    const key = m.username.trim().toLowerCase();
    const week = weekByOwner.get(key);
    const calls = callsByOwner.get(key);
    const booked = bookedByUser.get(m.user_id);
    const revenue = revenueByUser.get(m.user_id) ?? 0;
    const matched = week !== undefined || calls !== undefined || booked !== undefined || revenue > 0;

    const metrics: TeamMemberMetrics | null = matched
      ? {
          dms: week?.dms ?? 0,
          apptsBooked: booked ?? 0,
          answerRate: week && week.dms > 0 ? (week.answers / week.dms) * 100 : null,
          apptRate: week && week.dms > 0 ? (week.appts / week.dms) * 100 : null,
          calls: calls ?? 0,
          revenue,
        }
      : null;

    return { ...m, metrics, isSelf: m.user_id === access.user.id };
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>

      {/* ══ HEADER ══ */}
      <PageHeader
        eyebrow="Workspace"
        title="Team"
        meta="Wochenduell · Vergleich"
        actions={
          <Link href="/team/archiv" className="btn-secondary" style={{ textDecoration: "none" }}>
            <Archive size={14} /> Archiv
          </Link>
        }
      />

      {/* ══ WOCHENDUELL + DUELL-VERLAUF ══ */}
      <WochenduellSection
        roster={roster}
        weekCounts={weekCounts}
        weeklyGoal={weeklyGoal}
        historicalWeeks={historicalWeeks}
        winCounts={winCounts}
        draws={draws}
      />

      {/* ══ SEKTION: TEAM-VERGLEICH ══
          Sektionskopf ohne getönte Icon-Kachel: Der orange Eyebrow im
          Seitenkopf ist der Akzent dieser View, ein zweiter Orange-Punkt
          weiter unten konkurriert nur mit ihm (DESIGN.md §3.8). */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", paddingBottom: "var(--sp-3)", borderBottom: "1px solid var(--border-default)", flexWrap: "wrap" }}>
        <Users size={14} color="var(--text-muted)" aria-hidden />
        <span style={{ fontSize: "var(--fs-base)", fontWeight: 600, color: "var(--text-primary)", letterSpacing: "var(--ls-tight)" }}>Team-Vergleich</span>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>· alle Zahlen {monday} → {sunday}</span>
      </div>

      {memberCards.length === 0 ? (
        <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", margin: 0 }}>
          Keine Teammitglieder gefunden.
        </p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "var(--sp-6)" }}>
          {memberCards.map((m) => (
            <TeamMemberCard
              key={m.user_id}
              username={m.username}
              userId={m.user_id}
              metrics={m.metrics}
              isSelf={m.isSelf}
            />
          ))}
        </div>
      )}

      <p style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", margin: 0, lineHeight: "var(--lh-base)" }}>
        „Termine gelegt“ zählt Termine, die in dieser Woche gebucht wurden — über LinkedIn, Telefon und
        manuell. Die „Terminquote (aus Pitches)“ daneben beantwortet eine andere Frage: welcher Anteil der
        LinkedIn-Pitches dieser Woche irgendwann zu einem Termin führte.
      </p>

    </div>
  );
}
