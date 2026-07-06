import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { addDaysISO, localDateISO } from "@/lib/dates";
import { getAccessContext } from "@/lib/access";
import { getTargets } from "@/app/actions/targets";
import { resolveTarget } from "@/lib/targets";
import type { ContactWithStage, PitchList } from "@/lib/types";
import Link from "next/link";
import { AlertCircle, Bell, CheckCircle, History, Trophy, Zap } from "lucide-react";
import {
  WeeklyDuelChart, type DuelSeries, type WeeklyDuelPoint,
} from "@/components/DashboardCharts";
import { generateInsights } from "@/lib/insights";
import { OverallSection } from "@/components/dashboard/OverallSection";
import { FunnelSection } from "@/components/dashboard/FunnelSection";
import { PersonSection } from "@/components/dashboard/PersonSection";
import { ListAnalysisSection } from "@/components/dashboard/ListAnalysisSection";

// ── Owner colors (dynamic roster) — server-side copy of the client helper ──
const OWNER_BASE_COLORS: Record<string, string> = {
  Kevin: "var(--brand-500)",
  Simon: "var(--accent-500)",
  Daniel: "var(--color-success-text)",
  "Samuel Kerber": "#0ea5e9",
};
const OWNER_FALLBACK_PALETTE = [
  "var(--brand-400)",
  "var(--color-warning-text)",
  "#0d9488",
  "var(--color-ember)",
  "var(--brand-600)",
  "#6d28d9",
];
function ownerColor(name: string, index: number): string {
  return OWNER_BASE_COLORS[name] ?? OWNER_FALLBACK_PALETTE[index % OWNER_FALLBACK_PALETTE.length];
}

/** Translucent variant of a (possibly var()-based) color. */
function tint(color: string, alphaPct: number): string {
  return `color-mix(in srgb, ${color} ${alphaPct}%, transparent)`;
}

const PERSONAL_COLOR = "var(--color-warning-text)";
type PersonalWeekPoint = { week: string; count: number };

function getISOWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const jan4 = new Date(dt.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  return Math.floor((dt.getTime() - startOfWeek1.getTime()) / (7 * 86400000)) + 1;
}

function weekStart(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  dt.setDate(dt.getDate() + (day === 0 ? -6 : 1 - day));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function DuelPanel({ owner, color, count, isLeader, isLoser, goal }: { owner: string; color: string; count: number; isLeader: boolean; isLoser: boolean; goal: number; }) {
  const progress = Math.min((count / goal) * 100, 100);
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem", marginBottom: "0.875rem" }}>
        <div style={{ width: 38, height: 38, borderRadius: "50%", background: tint(color, 13), border: `2px solid ${isLeader ? color : tint(color, 25)}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.9375rem", fontWeight: 800, color, flexShrink: 0 }}>{owner[0]}</div>
        <div>
          <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: isLeader ? color : "var(--text-secondary)" }}>{owner} {isLeader ? "👑" : ""}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>{isLoser ? "zahlt das Essen 🍽️" : isLeader ? "führt diese Woche" : "im Rennen"}</div>
        </div>
      </div>
      <div style={{ fontSize: "3.25rem", fontWeight: 800, letterSpacing: "-0.04em", color: isLeader ? color : "var(--text-subtle)", lineHeight: 1, marginBottom: "0.5rem" }}>
        {count}<span style={{ fontSize: "1.125rem", fontWeight: 500, color: "var(--text-subtle)", marginLeft: 3 }}>/{goal}</span>
      </div>
      <div style={{ background: "var(--surface-200)", borderRadius: 99, height: 6, overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: 99, width: `${progress}%`, background: isLeader ? color : tint(color, 40) }} />
      </div>
      <div style={{ fontSize: "0.6875rem", color: "var(--text-subtle)", marginTop: "0.375rem" }}>
        {Math.round(progress)}% · noch {Math.max(0, goal - count)} bis {goal}
      </div>
    </div>
  );
}

function VSSep() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem", flexShrink: 0 }}>
      <div style={{ width: 1, height: 24, background: "linear-gradient(to bottom, transparent, rgb(24 98 184 / 0.35))" }} />
      <div style={{ fontSize: "0.6875rem", fontWeight: 800, color: "var(--text-subtle)", letterSpacing: "0.1em", padding: "3px 8px", border: "1px solid rgb(24 98 184 / 0.15)", borderRadius: 99, background: "rgb(24 98 184 / 0.05)" }}>VS</div>
      <div style={{ width: 1, height: 24, background: "linear-gradient(to bottom, rgb(24 98 184 / 0.35), transparent)" }} />
    </div>
  );
}

function PersonalWeekPanel({
  name,
  count,
  goal,
  monday,
  sunday,
}: {
  name: string;
  count: number;
  goal: number;
  monday: string;
  sunday: string;
}) {
  const progress = Math.min((count / goal) * 100, 100);
  return (
    <div style={{ position: "relative", borderRadius: "var(--radius-xl)", overflow: "hidden", background: "var(--surface-100)", border: "1px solid rgb(180 83 9 / 0.22)", padding: "1.75rem 2rem 1.5rem", boxShadow: "var(--shadow-sm)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem", position: "relative" }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--color-warning-text)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--surface-0)", fontWeight: 900 }}>
          {name[0]?.toUpperCase() ?? "P"}
        </div>
        <div>
          <div style={{ fontSize: "0.9375rem", fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>Deine Woche</div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>{name} · {monday} → {sunday}</div>
        </div>
      </div>

      <div className="personal-week-grid" style={{ display: "grid", gridTemplateColumns: "minmax(160px, 240px) 1fr", gap: "1.5rem", alignItems: "center", position: "relative" }}>
        <div>
          <div style={{ fontSize: "3.25rem", fontWeight: 900, letterSpacing: "-0.05em", color: PERSONAL_COLOR, lineHeight: 1 }}>
            {count}<span style={{ fontSize: "1.125rem", fontWeight: 500, color: "var(--text-subtle)", marginLeft: 3 }}>/{goal}</span>
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-subtle)", marginTop: "0.5rem" }}>
            {Math.round(progress)}% erreicht · noch {Math.max(0, goal - count)} DMs bis zum Wochenziel
          </div>
        </div>
        <div>
          <div style={{ background: "var(--surface-200)", borderRadius: 99, height: 12, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 99, width: `${progress}%`, background: "var(--color-warning-text)", transition: "width 0.4s ease" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.5rem", fontSize: "0.6875rem", color: "var(--text-subtle)" }}>
            <span>0</span>
            <span style={{ color: PERSONAL_COLOR, fontWeight: 700 }}>Ziel {goal}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PersonalHistoryPanel({ weeks, goal }: { weeks: PersonalWeekPoint[]; goal: number }) {
  const max = Math.max(goal, ...weeks.map((w) => w.count), 1);
  return (
    <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1.125rem 1.5rem", boxShadow: "var(--shadow-sm)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
        <History size={14} color="var(--color-warning-text)" />
        <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary)" }}>Dein Verlauf letzte 10 Wochen</span>
        <span style={{ marginLeft: "auto", fontSize: "0.6875rem", color: "var(--text-subtle)" }}>Wochenziel {goal} DMs</span>
      </div>
      <div className="history-scroll">
        <div className="history-scroll-inner" style={{ display: "grid", gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`, gap: "0.5rem", alignItems: "end", minHeight: 170 }}>
          {weeks.map((week) => {
            const height = Math.max(8, (week.count / max) * 130);
            const reached = week.count >= goal;
            return (
              <div key={week.week} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.375rem" }}>
                <div style={{ fontSize: "0.6875rem", color: reached ? "var(--color-success-text)" : PERSONAL_COLOR, fontWeight: 800 }}>{week.count}</div>
                <div style={{ width: "100%", maxWidth: 28, height, borderRadius: "6px 6px 2px 2px", background: reached ? "var(--color-success-text)" : "var(--color-warning-text)" }} />
                <div style={{ fontSize: "0.625rem", color: "var(--text-subtle)", whiteSpace: "nowrap" }}>{week.week}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const access = await getAccessContext();
  if (!access) return null;

  const supabase = await createClient();
  const today = localDateISO();
  const monday = weekStart(today);
  const sunday = addDaysISO(monday, 6); // Woche läuft Mo–So komplett

  let listsQuery = supabase
    .from("lists")
    .select("*")
    .eq("workspace_id", access.workspace_id)
    .is("archived_at", null)
    .order("sort_order");
  if (access.effective_user_id) {
    listsQuery = listsQuery.eq("created_by_user_id", access.effective_user_id);
  }
  const { data: lists } = await listsQuery;

  const visibleListIds = (lists ?? []).map((l) => l.id);
  const rawContacts = await fetchAllRows((from, to) => {
    let contactsQuery = supabase
      .from("contacts")
      .select("*, pipeline_stages (*)")
      .eq("workspace_id", access.workspace_id);
    if (access.effective_user_id) {
      contactsQuery = visibleListIds.length > 0
        ? contactsQuery.in("list_id", visibleListIds)
        : contactsQuery.in("list_id", ["00000000-0000-0000-0000-000000000000"]);
    }
    return contactsQuery.order("id", { ascending: true }).range(from, to);
  });

  const allContacts = (rawContacts ?? []) as unknown as ContactWithStage[];
  const pitchLists  = (lists ?? []) as PitchList[];
  const isPersonalView = Boolean(access.effective_user_id);
  const personalName = access.effective_username ?? access.username;

  // ── Ziele aus performance_targets (Fallback: 100/Woche, 20/Tag)
  const targets = await getTargets();
  const goalUserId = access.effective_user_id ?? access.user.id;
  const weeklyGoal = resolveTarget(targets, goalUserId, "linkedin", "weekly", "pitches");
  const dailyGoal  = resolveTarget(targets, goalUserId, "linkedin", "daily", "pitches");

  // Liste → Owner lookup
  const listOwner: Record<string, string> = {};
  for (const l of pitchLists) { if (l.owner_name) listOwner[l.id] = l.owner_name; }

  // ── Dynamische Duell-Roster: alle Owner, die tatsächlich pitchen
  const rosterNames = [...new Set(pitchLists.map((l) => l.owner_name).filter((n): n is string => Boolean(n)))].sort();
  const roster: DuelSeries[] = rosterNames.map((name, i) => ({ name, color: ownerColor(name, i) }));

  // ── Wochenduell (Mo–So, damit Sa/So auch mitzählen)
  const weekCounts: Record<string, number> = {};
  for (const name of rosterNames) {
    weekCounts[name] = allContacts.filter((c) => { const d = c.pitched_at ?? c.created_at.slice(0, 10); return d >= monday && d <= sunday && listOwner[c.list_id] === name; }).length;
  }

  const weekValues = rosterNames.map((n) => weekCounts[n]);
  const maxCount   = weekValues.length > 0 ? Math.max(...weekValues) : 0;
  const minCount   = weekValues.length > 0 ? Math.min(...weekValues) : 0;
  const leadersArr = rosterNames.filter((n) => weekCounts[n] === maxCount);
  const losersArr  = rosterNames.filter((n) => weekCounts[n] === minCount);
  const leader: string | null = leadersArr.length === 1 ? leadersArr[0] : null;
  const loser:  string | null = losersArr.length === 1 && minCount < maxCount ? losersArr[0] : null;
  const secondCount = leader ? Math.max(0, ...rosterNames.filter((n) => n !== leader).map((n) => weekCounts[n])) : maxCount;
  const diff = leader ? maxCount - secondCount : 0;
  const leaderColor = leader ? roster.find((r) => r.name === leader)!.color : null;

  // ── Historische Wochen (letzte 10, ebenfalls Mo–So)
  const historicalWeeks: WeeklyDuelPoint[] = [];
  for (let i = 9; i >= 0; i--) {
    const wStart = addDaysISO(monday, -i * 7);
    const wEnd   = addDaysISO(wStart, 6); // Mo–So
    const weekLabel = `KW ${getISOWeek(wStart)}`;
    const values: Record<string, number> = {};
    for (const name of rosterNames) {
      values[name] = allContacts.filter((c) => { const d = c.pitched_at ?? c.created_at.slice(0, 10); return d >= wStart && d <= wEnd && listOwner[c.list_id] === name; }).length;
    }
    historicalWeeks.push({ week: weekLabel, values });
  }

  // ── Siege letzte 10 Wochen (Sieg = strikt mehr als alle anderen)
  const winCounts: Record<string, number> = Object.fromEntries(rosterNames.map((n) => [n, 0]));
  let draws = 0;
  for (const w of historicalWeeks) {
    const counts = rosterNames.map((n) => w.values[n] ?? 0);
    const weekMax = counts.length > 0 ? Math.max(...counts) : 0;
    if (weekMax === 0) continue;
    const winners = rosterNames.filter((n) => (w.values[n] ?? 0) === weekMax);
    if (winners.length === 1) winCounts[winners[0]]++;
    else if (winners.length === rosterNames.length) draws++;
  }
  const winValues = rosterNames.map((n) => winCounts[n]);
  const topWins = winValues.length > 0 ? Math.max(...winValues) : 0;
  const overallLeaders = rosterNames.filter((n) => winCounts[n] === topWins);
  const secondWins = overallLeaders.length === 1
    ? Math.max(0, ...rosterNames.filter((n) => n !== overallLeaders[0]).map((n) => winCounts[n]))
    : topWins;

  // ── Tagesziel (pro Person)
  const todayCounts: Record<string, number> = {};
  for (const name of rosterNames) {
    todayCounts[name] = allContacts.filter((c) => (c.pitched_at ?? c.created_at.slice(0, 10)) === today && listOwner[c.list_id] === name).length;
  }
  const personalTodayCount = allContacts.filter((c) => (c.pitched_at ?? c.created_at.slice(0, 10)) === today).length;
  const personalWeekCount = allContacts.filter((c) => { const d = c.pitched_at ?? c.created_at.slice(0, 10); return d >= monday && d <= sunday; }).length;
  const personalHistoricalWeeks: PersonalWeekPoint[] = [];
  for (let i = 9; i >= 0; i--) {
    const wStart = addDaysISO(monday, -i * 7);
    const wEnd = addDaysISO(wStart, 6);
    personalHistoricalWeeks.push({
      week: `KW ${getISOWeek(wStart)}`,
      count: allContacts.filter((c) => { const d = c.pitched_at ?? c.created_at.slice(0, 10); return d >= wStart && d <= wEnd; }).length,
    });
  }

  // ── Follow-up alerts (always current, no filter)
  const urgentThreshold = addDaysISO(today, -3);
  const dueFUs = allContacts.filter((c) => c.answered !== true && c.follow_up_number !== 3 && c.next_follow_up_at && c.next_follow_up_at <= today);
  const followUpAlerts  = dueFUs.filter((c) => c.next_follow_up_at! >= urgentThreshold).map((c) => ({ contact: c, nextFu: Math.min((c.follow_up_number ?? 0) + 1, 3) as 1 | 2 | 3 })).slice(0, 10);
  const overdueAlerts   = dueFUs.filter((c) => c.next_follow_up_at! < urgentThreshold).slice(0, 8);

  // ── Insights (overall, no filter)
  const insights = generateInsights(pitchLists, allContacts);

  // ── Terminquote Ziel (3–7%)
  const totalDMs   = allContacts.length;
  const totalAppts = allContacts.filter((c) => c.appointment_set === true).length;
  const apptRate   = totalDMs > 0 ? (totalAppts / totalDMs) * 100 : 0;
  const apptRateRounded = Math.round(apptRate * 10) / 10;
  const GOAL_MIN = 3, GOAL_MAX = 7;

  const apptStatus: "below" | "zone" | "above" =
    apptRate < GOAL_MIN ? "below" : apptRate > GOAL_MAX ? "above" : "zone";

  const MOTIVATION: Record<typeof apptStatus, { emoji: string; headline: string; sub: string; color: string; bg: string; border: string }> = {
    below: {
      emoji: "🚀",
      headline: "Jeder DM zählt — die Quote kommt mit Volumen.",
      sub: "Die besten Closer der Welt brauchen 30–50 Nein's für jedes Ja. Ihr seid im Aufbau — weiter machen!",
      color: "var(--brand-500)", bg: "rgb(24 98 184 / 0.06)", border: "rgb(24 98 184 / 0.18)",
    },
    zone: {
      emoji: "🎯",
      headline: "Ihr seid genau im Ziel — dieser Pitch funktioniert!",
      sub: "3–7% Terminquote ist das, was Top-Closer im Cold Outreach erzielen. Skaliert diesen Ansatz jetzt!",
      color: "var(--color-success-text)", bg: "rgb(4 184 0 / 0.06)", border: "rgb(4 184 0 / 0.2)",
    },
    above: {
      emoji: "🏆",
      headline: "Über Ziel! Ihr spielt in einer anderen Liga.",
      sub: "Über 7% Terminquote? Das ist Elite-Niveau. Dupliziert diesen Pitch sofort auf mehr Listen!",
      color: "var(--color-warning-text)", bg: "rgb(180 83 9 / 0.06)", border: "rgb(180 83 9 / 0.2)",
    },
  };
  const mot = MOTIVATION[apptStatus];

  // Progress bar: 0–10% als Skala, Zielzone 3–7% markiert
  const barPct = Math.min((apptRate / 10) * 100, 100);
  const goalMinPct = (GOAL_MIN / 10) * 100;
  const goalMaxPct = (GOAL_MAX / 10) * 100;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", flexDirection: "column", gap: "1.75rem" }}>

      {/* ══ HEADER ══ */}
      <div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.03em", margin: 0 }}>Dashboard</h1>
        <p style={{ fontSize: "0.8125rem", color: "var(--text-subtle)", marginTop: 2 }}>
          Performance-Übersicht · {access.effective_username ?? access.workspaces.name}
        </p>
      </div>

      {/* ══ ZIELSETZUNGS-CARD ══ */}
      <div style={{ position: "relative", background: mot.bg, border: `1px solid ${mot.border}`, borderRadius: "var(--radius-xl)", padding: "1.375rem 1.75rem", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "1.25rem", flexWrap: "wrap" }}>
          {/* Left: Big number */}
          <div style={{ textAlign: "center", flexShrink: 0 }}>
            <div style={{ fontSize: "3rem", lineHeight: 1 }}>{mot.emoji}</div>
            <div style={{ marginTop: "0.5rem" }}>
              <div style={{ fontSize: "2.25rem", fontWeight: 900, color: mot.color, letterSpacing: "-0.05em", lineHeight: 1 }}>
                {totalDMs === 0 ? "—" : `${apptRateRounded}%`}
              </div>
              <div style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: mot.color, opacity: 0.7, marginTop: "0.125rem" }}>
                Terminquote
              </div>
            </div>
          </div>

          {/* Right: Text + bar */}
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: "1rem", fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.02em", marginBottom: "0.375rem", lineHeight: 1.3 }}>
              {mot.headline}
            </div>
            <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", margin: "0 0 1rem", lineHeight: 1.55 }}>
              {mot.sub}
            </p>

            {/* Progress bar mit Zielzone */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.6875rem", color: "var(--text-subtle)", marginBottom: "0.375rem" }}>
                <span>0%</span>
                <span style={{ color: mot.color, fontWeight: 700 }}>Ziel {GOAL_MIN}–{GOAL_MAX}%</span>
                <span>10%+</span>
              </div>
              <div style={{ position: "relative", height: 10, borderRadius: 99, background: "var(--surface-200)", overflow: "visible" }}>
                {/* Zielzone Highlight */}
                <div style={{ position: "absolute", left: `${goalMinPct}%`, width: `${goalMaxPct - goalMinPct}%`, top: -2, bottom: -2, background: tint(mot.color, 9), border: `1px solid ${tint(mot.color, 27)}`, borderRadius: 4 }} />
                {/* Aktueller Wert */}
                {totalDMs > 0 && (
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${barPct}%`, borderRadius: 99, background: mot.color, transition: "width 0.6s ease" }} />
                )}
                {/* Nadel */}
                {totalDMs > 0 && (
                  <div style={{ position: "absolute", left: `calc(${barPct}% - 4px)`, top: "50%", transform: "translateY(-50%)", width: 8, height: 8, borderRadius: "50%", background: mot.color, border: "2px solid var(--surface-0)" }} />
                )}
              </div>
            </div>

            {/* Mini-Stats */}
            <div style={{ display: "flex", gap: "1.25rem", marginTop: "0.875rem", flexWrap: "wrap" }}>
              {[
                { label: "DMs gesamt", value: totalDMs.toLocaleString(), color: "var(--text-subtle)" },
                { label: "Termine", value: totalAppts.toLocaleString(), color: mot.color },
                { label: "Noch bis 7%", value: totalDMs > 0 ? `${Math.max(0, Math.ceil(totalDMs * 0.07) - totalAppts)} Termine` : "—", color: apptStatus === "above" ? "var(--color-success-text)" : "var(--text-subtle)" },
              ].map((s) => (
                <div key={s.label}>
                  <div style={{ fontSize: "0.6875rem", color: "var(--text-subtle)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</div>
                  <div style={{ fontSize: "0.9375rem", fontWeight: 800, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {isPersonalView ? (
        <>
          <PersonalWeekPanel
            name={personalName}
            count={personalWeekCount}
            goal={weeklyGoal}
            monday={monday}
            sunday={sunday}
          />
          <PersonalHistoryPanel weeks={personalHistoricalWeeks} goal={weeklyGoal} />
        </>
      ) : roster.length > 0 && (
        <>
          {/* ══ WOCHENDUELL ══ */}
          <div style={{ position: "relative", borderRadius: "var(--radius-xl)", overflow: "hidden", background: "var(--surface-100)", border: "1px solid var(--border)", padding: "1.75rem 2rem 1.5rem", boxShadow: "var(--shadow-sm)" }}>

        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginBottom: "1.5rem" }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: "var(--brand-500)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Trophy size={16} color="white" />
          </div>
          <div>
            <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>Wochenduell — Wer bezahlt das Essen?</div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>Ziel: {weeklyGoal} DMs · {monday} → {sunday} · Reset jeden Montag</div>
          </div>
          {leader && leaderColor && (
            <div style={{ marginLeft: "auto", background: tint(leaderColor, 8), border: `1px solid ${tint(leaderColor, 25)}`, borderRadius: 99, padding: "0.2rem 0.75rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <span style={{ fontSize: "0.875rem" }}>👑</span>
              <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: leaderColor }}>{leader} +{diff}</span>
            </div>
          )}
        </div>

        {roster.length === 2 ? (
          <div className="duel-grid" style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "1.5rem", alignItems: "center" }}>
            <DuelPanel owner={roster[0].name} color={roster[0].color} count={weekCounts[roster[0].name]} isLeader={leader === roster[0].name} isLoser={loser === roster[0].name} goal={weeklyGoal} />
            <VSSep />
            <DuelPanel owner={roster[1].name} color={roster[1].color} count={weekCounts[roster[1].name]} isLeader={leader === roster[1].name} isLoser={loser === roster[1].name} goal={weeklyGoal} />
          </div>
        ) : (
          <div className="duel-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1.5rem", alignItems: "start" }}>
            {roster.map((r) => (
              <DuelPanel key={r.name} owner={r.name} color={r.color} count={weekCounts[r.name]} isLeader={leader === r.name} isLoser={loser === r.name} goal={weeklyGoal} />
            ))}
          </div>
        )}

        <div style={{ marginTop: "1rem", paddingTop: "0.875rem", borderTop: "1px solid var(--border)", fontSize: "0.8125rem", color: "var(--text-subtle)", textAlign: "center" }}>
          {leader && diff > 0 ? <><span style={{ color: "var(--text-muted)" }}>2. Platz braucht noch </span><span style={{ color: "var(--color-warning-text)", fontWeight: 700 }}>{diff} DMs</span><span style={{ color: "var(--text-muted)" }}> zum Gleichstand · </span></> : <span style={{ color: "var(--text-subtle)" }}>Gleichstand · </span>}
          <span style={{ color: weeklyGoal - maxCount > 0 ? "var(--brand-500)" : "var(--color-success-text)", fontWeight: 600 }}>
            {weeklyGoal - maxCount > 0 ? `${weeklyGoal - maxCount} bis zur ${weeklyGoal}er-Marke` : `🎉 ${weeklyGoal}er-Marke erreicht!`}
          </span>
        </div>
          </div>

          {/* ══ DUELL-VERLAUF ══ */}
          <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1.125rem 1.5rem", boxShadow: "var(--shadow-sm)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.875rem", flexWrap: "wrap" }}>
          <History size={14} color="var(--color-warning-text)" />
          <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary)" }}>Duell-Verlauf letzte 10 Wochen</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            {[...roster.map((r) => ({ label: r.name, color: r.color })), { label: `Ziel ${weeklyGoal}`, color: "var(--color-warning-text)" }].map((m) => (
              <div key={m.label} style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: m.color }} />
                <span style={{ fontSize: "0.6875rem", color: "var(--text-subtle)" }}>{m.label}</span>
              </div>
            ))}
          </div>
        </div>
        <WeeklyDuelChart data={historicalWeeks} series={roster} goal={weeklyGoal} />
        <div style={{ display: "flex", gap: "1rem", marginTop: "0.875rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
          <div style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>Siege 10 Wochen:</div>
          <div style={{ display: "flex", gap: "0.875rem", flexWrap: "wrap" }}>
            {roster.map((r) => (
              <span key={r.name} style={{ fontSize: "0.875rem", fontWeight: 700, color: r.color }}>{r.name} {winCounts[r.name]}W</span>
            ))}
            {draws > 0 && <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-subtle)" }}>{draws}×Unentschieden</span>}
          </div>
          <div style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--text-subtle)" }}>
            {overallLeaders.length === 1 ? `${overallLeaders[0]} führt (+${topWins - secondWins})` : "Gleichstand"}
          </div>
        </div>
          </div>
        </>
      )}

      {/* ══ FUNNEL (Telefon → Setting → Closing → Umsatz) ══ */}
      <FunnelSection access={access} />

      {/* ══ SEKTION 1: GESAMT (Client, eigener Filter) ══ */}
      <OverallSection
        allContacts={allContacts}
        lists={pitchLists}
        today={today}
        roster={roster}
        todayCounts={todayCounts}
        personalMode={isPersonalView}
        personalOwnerName={personalName}
        personalTodayCount={personalTodayCount}
        dailyGoal={dailyGoal}
      />

      {/* ══ FOLLOW-UP ALERTS ══ */}
      {(followUpAlerts.length > 0 || overdueAlerts.length > 0) && (
        <div className="alert-grid" style={{ display: "grid", gridTemplateColumns: followUpAlerts.length > 0 && overdueAlerts.length > 0 ? "1fr 1fr" : "1fr", gap: "0.875rem" }}>
          {followUpAlerts.length > 0 && (
            <div style={{ background: "rgb(180 83 9 / 0.04)", border: "1px solid rgb(180 83 9 / 0.18)", borderRadius: "var(--radius-lg)", padding: "1.125rem 1.375rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.625rem" }}>
                <Bell size={14} color="var(--color-warning-text)" />
                <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--color-warning-text)" }}>FUs fällig ({followUpAlerts.length})</span>
              </div>
              {followUpAlerts.map(({ contact: c, nextFu }) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8125rem", marginBottom: "0.25rem" }}>
                  <span style={{ padding: "1px 5px", borderRadius: 3, background: "rgb(180 83 9 / 0.12)", color: "var(--color-warning-text)", fontSize: "0.6875rem", fontWeight: 700, flexShrink: 0 }}>FU{nextFu}</span>
                  <Link href={`/lists/${c.list_id}`} style={{ color: "var(--text-secondary)", textDecoration: "none", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</Link>
                  <span style={{ color: "var(--text-subtle)", fontSize: "0.6875rem", flexShrink: 0 }}>{c.next_follow_up_at}</span>
                </div>
              ))}
            </div>
          )}
          {overdueAlerts.length > 0 && (
            <div style={{ background: "rgb(184 19 0 / 0.04)", border: "1px solid rgb(184 19 0 / 0.18)", borderRadius: "var(--radius-lg)", padding: "1.125rem 1.375rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.625rem" }}>
                <AlertCircle size={14} color="var(--color-error-text)" />
                <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--color-error-text)" }}>Stark überfällig ({overdueAlerts.length})</span>
              </div>
              {overdueAlerts.map((c) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8125rem", marginBottom: "0.25rem" }}>
                  <span style={{ padding: "1px 5px", borderRadius: 3, background: "rgb(184 19 0 / 0.12)", color: "var(--color-error-text)", fontSize: "0.6875rem", fontWeight: 700, flexShrink: 0 }}>FU{Math.min((c.follow_up_number ?? 0) + 1, 3)}</span>
                  <Link href={`/lists/${c.list_id}`} style={{ color: "var(--text-secondary)", textDecoration: "none", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</Link>
                  <span style={{ color: "var(--color-error-text)", fontSize: "0.6875rem", flexShrink: 0 }}>{c.next_follow_up_at}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!isPersonalView && roster.length > 0 && (
        <>
          {/* ══ SEKTION 2: PERSONEN-VERGLEICH (Client, eigener Filter) ══ */}
          <PersonSection
            allContacts={allContacts}
            lists={pitchLists}
            today={today}
            roster={roster}
            weekCounts={weekCounts}
            todayCounts={todayCounts}
            dailyGoal={dailyGoal}
          />
        </>
      )}

      {/* ══ SEKTION 3: LISTEN-ANALYSE (Client, eigener Filter) ══ */}
      <ListAnalysisSection
        allContacts={allContacts}
        lists={pitchLists}
        personalMode={isPersonalView}
      />

      {/* ══ SEKTION 4: KI-INSIGHTS ══ */}
      {insights.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", paddingBottom: "0.125rem", borderBottom: "1px solid var(--border)" }}>
            <div style={{ width: 22, height: 22, borderRadius: 6, background: "var(--surface-200)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Zap size={13} color="var(--color-warning-text)" />
            </div>
            <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary)" }}>Automatische Analyse</span>
            <span style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>· Basierend auf deinen echten Daten</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "0.75rem" }}>
            {insights.map((ins, i) => {
              const cfg = {
                success: { border: "rgb(4 184 0 / 0.2)",   bg: "rgb(4 184 0 / 0.04)",   icon: <CheckCircle size={14} color="var(--color-success-text)" />, color: "var(--color-success-text)" },
                warning: { border: "rgb(180 83 9 / 0.2)",  bg: "rgb(180 83 9 / 0.04)",  icon: <Bell size={14} color="var(--color-warning-text)" />,        color: "var(--color-warning-text)" },
                danger:  { border: "rgb(184 19 0 / 0.2)",  bg: "rgb(184 19 0 / 0.04)",  icon: <AlertCircle size={14} color="var(--color-error-text)" />,   color: "var(--color-error-text)" },
                tip:     { border: "rgb(24 98 184 / 0.2)", bg: "rgb(24 98 184 / 0.04)", icon: <Zap size={14} color="var(--brand-500)" />,                   color: "var(--brand-500)" },
              }[ins.level];
              return (
                <div key={i} style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: "var(--radius-lg)", padding: "1rem 1.125rem" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", marginBottom: "0.375rem" }}>
                    <div style={{ flexShrink: 0, marginTop: 1 }}>{cfg.icon}</div>
                    <div style={{ fontSize: "0.875rem", fontWeight: 700, color: cfg.color, lineHeight: 1.3 }}>{ins.title}</div>
                  </div>
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.5, marginBottom: ins.listId ? "0.625rem" : 0 }}>{ins.body}</div>
                  {ins.listId && (
                    <Link href={`/lists/${ins.listId}`} style={{ fontSize: "0.75rem", color: cfg.color, textDecoration: "none", fontWeight: 600 }}>
                      Liste öffnen →
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

    </div>
  );
}
