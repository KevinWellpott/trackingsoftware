import { redirect } from "next/navigation";
import Link from "next/link";
import { Archive, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext, listDataViewUsers } from "@/lib/access";
import { getTargets } from "@/app/actions/targets";
import { resolveTarget } from "@/lib/targets";
import { addDaysISO, getISOWeek, localDateISO, weekStart } from "@/lib/dates";
import { WochenduellSection } from "@/components/dashboard/WochenduellSection";
import { FunnelSection } from "@/components/dashboard/FunnelSection";
import { TeamMemberCard, type TeamMemberMetrics } from "@/components/dashboard/TeamMemberCard";

// Admin-Team-Dashboard: Wochenduell + Team-Vergleich + Workspace-Funnel.
// Nur für Owner mit Workspace-Datensicht — alle anderen landen auf "/".

type OwnerDayRow = {
  owner_name: string | null;
  day: string;
  dms: number | string | null;
  answers: number | string | null;
  appts: number | string | null;
};

type PhoneOwnerRow = {
  owner_name: string | null;
  calls: number | string | null;
};

type WonDealRow = {
  deal_volume: number | string | null;
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
  const from = addDaysISO(monday, -63); // 10-Wochen-Fenster (9 Wochen vor Montag)
  const phoneFrom = addDaysISO(today, -30);

  const [dayRes, phoneRes, wonDealsRes, members, targets] = await Promise.all([
    supabase.rpc("rpc_owner_day_metrics", {
      p_workspace_id: access.workspace_id,
      p_from: from,
      p_to: today,
      p_effective_user_id: null,
    }),
    supabase.rpc("rpc_phone_owner_metrics", {
      p_workspace_id: access.workspace_id,
      p_from: phoneFrom,
      p_to: today,
      p_effective_user_id: null,
    }),
    supabase
      .from("closing_calls")
      .select("deal_volume, created_by_user_id")
      .eq("workspace_id", access.workspace_id)
      .eq("status", "gewonnen"),
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

  // ── Roster: alle Owner mit Aktivität (ohne Platzhalter "—")
  const roster = [...new Set(dayRows.map((r) => r.owner).filter((n) => n && n !== "—"))].sort((a, b) =>
    a.localeCompare(b, "de"),
  );

  // ── Aktuelle Woche (Mo–So) pro Owner
  const sunday = addDaysISO(monday, 6);
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
  const phoneRows = phoneRes.error ? [] : ((phoneRes.data ?? []) as PhoneOwnerRow[]);
  for (const r of phoneRows) {
    const key = (r.owner_name ?? "").trim().toLowerCase();
    if (!key) continue;
    callsByOwner.set(key, (callsByOwner.get(key) ?? 0) + NUM(r.calls));
  }

  const revenueByUser = new Map<string, number>();
  for (const row of (wonDealsRes.data ?? []) as WonDealRow[]) {
    if (!row.created_by_user_id) continue;
    revenueByUser.set(
      row.created_by_user_id,
      (revenueByUser.get(row.created_by_user_id) ?? 0) + NUM(row.deal_volume),
    );
  }

  const memberCards = members.map((m) => {
    const key = m.username.trim().toLowerCase();
    const week = weekByOwner.get(key);
    const calls = callsByOwner.get(key);
    const revenue = revenueByUser.get(m.user_id) ?? 0;
    const matched = week !== undefined || calls !== undefined || revenue > 0;

    const metrics: TeamMemberMetrics | null = matched
      ? {
          dms: week?.dms ?? 0,
          answerRate: week && week.dms > 0 ? (week.answers / week.dms) * 100 : null,
          apptRate: week && week.dms > 0 ? (week.appts / week.dms) * 100 : null,
          calls: calls ?? 0,
          revenue,
        }
      : null;

    return { ...m, metrics, isSelf: m.user_id === access.user.id };
  });

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", flexDirection: "column", gap: "1.25rem" }}>

      {/* ══ HEADER ══ */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.03em", margin: 0 }}>
            Team
          </h1>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-subtle)", margin: "2px 0 0" }}>
            Wochenduell · Vergleich · Funnel
          </p>
        </div>
        <Link
          href="/team/archiv"
          style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-subtle)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 8, padding: "0.4rem 0.75rem", background: "var(--surface-100)" }}
        >
          <Archive size={13} /> Archiv
        </Link>
      </div>

      {/* ══ WOCHENDUELL + DUELL-VERLAUF ══ */}
      <WochenduellSection
        roster={roster}
        weekCounts={weekCounts}
        weeklyGoal={weeklyGoal}
        historicalWeeks={historicalWeeks}
        winCounts={winCounts}
        draws={draws}
      />

      {/* ══ SEKTION: TEAM-VERGLEICH ══ */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", paddingBottom: "0.125rem", borderBottom: "1px solid var(--border)" }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: "var(--surface-200)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Users size={13} color="var(--brand-500)" />
        </div>
        <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary)" }}>Team-Vergleich</span>
        <span style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>· {monday} → {sunday}</span>
      </div>

      {memberCards.length === 0 ? (
        <p style={{ fontSize: "0.8125rem", color: "var(--text-subtle)", margin: 0 }}>
          Keine Teammitglieder gefunden.
        </p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "0.875rem" }}>
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

      {/* ══ FUNNEL (Workspace-weit — auch bei aktiver Impersonation) ══ */}
      <FunnelSection access={{ ...access, effective_user_id: null, effective_username: null }} />

    </div>
  );
}
