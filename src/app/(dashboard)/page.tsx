import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { addDaysISO, localDateISO } from "@/lib/dates";
import { getAccessContext } from "@/lib/access";
import type { ContactWithStage, PitchList } from "@/lib/types";
import Link from "next/link";
import { AlertCircle, Bell, CheckCircle, History, Target, Trophy, Zap } from "lucide-react";
import {
  METRIC_COLORS, WeeklyDuelChart, type WeeklyDuelPoint,
} from "@/components/DashboardCharts";
import { generateInsights } from "@/lib/insights";
import { OverallSection } from "@/components/dashboard/OverallSection";
import { PersonSection } from "@/components/dashboard/PersonSection";
import { ListAnalysisSection } from "@/components/dashboard/ListAnalysisSection";

const OWNERS = ["Kevin", "Simon", "Daniel"] as const;
type Owner = typeof OWNERS[number];
const WEEKLY_GOAL = 100;

const OWNER_STYLE: Record<Owner, { color: string; glow: string; bg: string; border: string }> = {
  Kevin:  { color: "#818cf8", glow: "rgba(99,102,241,0.4)",  bg: "rgba(99,102,241,0.08)",  border: "rgba(99,102,241,0.25)" },
  Simon:  { color: "#a78bfa", glow: "rgba(139,92,246,0.4)",  bg: "rgba(139,92,246,0.08)",  border: "rgba(139,92,246,0.25)" },
  Daniel: { color: "#34d399", glow: "rgba(52,211,153,0.4)",  bg: "rgba(52,211,153,0.08)",  border: "rgba(52,211,153,0.25)" },
};
const PERSONAL_COLOR = "#f59e0b";
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

function DuelPanel({ owner, count, leader, loser, goal }: { owner: Owner; count: number; leader: Owner | null; loser: Owner | null; goal: number; }) {
  const s = OWNER_STYLE[owner];
  const isWinner = leader === owner;
  const isLoser = loser === owner;
  const progress = Math.min((count / goal) * 100, 100);
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem", marginBottom: "0.875rem" }}>
        <div style={{ width: 38, height: 38, borderRadius: "50%", background: `${s.color}22`, border: `2px solid ${isWinner ? s.color : s.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.9375rem", fontWeight: 800, color: s.color, boxShadow: isWinner ? `0 0 14px ${s.glow}` : "none", flexShrink: 0 }}>{owner[0]}</div>
        <div>
          <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: isWinner ? s.color : "#e4e4e7" }}>{owner} {isWinner ? "👑" : ""}</div>
          <div style={{ fontSize: "0.75rem", color: "#71717a" }}>{isLoser ? "zahlt das Essen 🍽️" : isWinner ? "führt diese Woche" : "im Rennen"}</div>
        </div>
      </div>
      <div style={{ fontSize: "3.25rem", fontWeight: 800, letterSpacing: "-0.04em", color: isWinner ? s.color : "#71717a", lineHeight: 1, marginBottom: "0.5rem", textShadow: isWinner ? `0 0 28px ${s.glow}` : "none" }}>
        {count}<span style={{ fontSize: "1.125rem", fontWeight: 500, color: "#3f3f46", marginLeft: 3 }}>/{goal}</span>
      </div>
      <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 99, height: 6, overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: 99, width: `${progress}%`, background: isWinner ? `linear-gradient(90deg, ${s.color}, ${s.color}bb)` : `${s.color}44`, boxShadow: isWinner ? `0 0 8px ${s.glow}` : "none" }} />
      </div>
      <div style={{ fontSize: "0.6875rem", color: "#52525b", marginTop: "0.375rem" }}>
        {Math.round(progress)}% · noch {Math.max(0, goal - count)} bis {goal}
      </div>
    </div>
  );
}

function VSSep() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem", flexShrink: 0 }}>
      <div style={{ width: 1, height: 24, background: "linear-gradient(to bottom, transparent, rgba(99,102,241,0.35))" }} />
      <div style={{ fontSize: "0.6875rem", fontWeight: 800, color: "#3f3f46", letterSpacing: "0.1em", padding: "3px 8px", border: "1px solid rgba(99,102,241,0.15)", borderRadius: 99, background: "rgba(99,102,241,0.05)" }}>VS</div>
      <div style={{ width: 1, height: 24, background: "linear-gradient(to bottom, rgba(99,102,241,0.35), transparent)" }} />
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
    <div style={{ position: "relative", borderRadius: "var(--radius-xl)", overflow: "hidden", background: "linear-gradient(135deg, #11100d 0%, #17120a 50%, #0d1117 100%)", border: "1px solid rgba(245,158,11,0.22)", padding: "1.75rem 2rem 1.5rem", boxShadow: "0 0 50px rgba(245,158,11,0.07), 0 16px 32px rgba(0,0,0,0.5)" }}>
      <div style={{ position: "absolute", top: -50, right: -20, width: 220, height: 220, background: "radial-gradient(circle, rgba(245,158,11,0.14) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem", position: "relative" }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: "linear-gradient(135deg,#f59e0b,#fbbf24)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 14px rgba(245,158,11,0.4)", color: "#09090b", fontWeight: 900 }}>
          {name[0]?.toUpperCase() ?? "P"}
        </div>
        <div>
          <div style={{ fontSize: "0.9375rem", fontWeight: 800, color: "#fafafa", letterSpacing: "-0.01em" }}>Deine Woche</div>
          <div style={{ fontSize: "0.75rem", color: "#71717a" }}>{name} · {monday} → {sunday}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(160px, 240px) 1fr", gap: "1.5rem", alignItems: "center", position: "relative" }}>
        <div>
          <div style={{ fontSize: "3.25rem", fontWeight: 900, letterSpacing: "-0.05em", color: PERSONAL_COLOR, lineHeight: 1, textShadow: "0 0 28px rgba(245,158,11,0.35)" }}>
            {count}<span style={{ fontSize: "1.125rem", fontWeight: 500, color: "#52525b", marginLeft: 3 }}>/{goal}</span>
          </div>
          <div style={{ fontSize: "0.75rem", color: "#71717a", marginTop: "0.5rem" }}>
            {Math.round(progress)}% erreicht · noch {Math.max(0, goal - count)} DMs bis zum Wochenziel
          </div>
        </div>
        <div>
          <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 99, height: 12, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 99, width: `${progress}%`, background: "linear-gradient(90deg,#f59e0b,#fbbf24)", boxShadow: "0 0 12px rgba(245,158,11,0.35)", transition: "width 0.4s ease" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.5rem", fontSize: "0.6875rem", color: "#52525b" }}>
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
    <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1.125rem 1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
        <History size={14} color={PERSONAL_COLOR} />
        <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#fafafa" }}>Dein Verlauf letzte 10 Wochen</span>
        <span style={{ marginLeft: "auto", fontSize: "0.6875rem", color: "#71717a" }}>Wochenziel {goal} DMs</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`, gap: "0.5rem", alignItems: "end", minHeight: 170 }}>
        {weeks.map((week) => {
          const height = Math.max(8, (week.count / max) * 130);
          const reached = week.count >= goal;
          return (
            <div key={week.week} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.375rem" }}>
              <div style={{ fontSize: "0.6875rem", color: reached ? "#4ade80" : PERSONAL_COLOR, fontWeight: 800 }}>{week.count}</div>
              <div style={{ width: "100%", maxWidth: 28, height, borderRadius: "6px 6px 2px 2px", background: reached ? "linear-gradient(180deg,#4ade80,#16a34a)" : "linear-gradient(180deg,#fbbf24,#f59e0b)", boxShadow: reached ? "0 0 10px rgba(74,222,128,0.25)" : "0 0 10px rgba(245,158,11,0.25)" }} />
              <div style={{ fontSize: "0.625rem", color: "#52525b", whiteSpace: "nowrap" }}>{week.week}</div>
            </div>
          );
        })}
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

  // Liste → Owner lookup
  const listOwner: Record<string, string> = {};
  for (const l of pitchLists) { if (l.owner_name) listOwner[l.id] = l.owner_name; }

  // ── Wochenduell (Mo–So, damit Sa/So auch mitzählen)
  const kevinWeek  = allContacts.filter((c) => { const d = c.pitched_at ?? c.created_at.slice(0, 10); return d >= monday && d <= sunday && listOwner[c.list_id] === "Kevin"; }).length;
  const simonWeek  = allContacts.filter((c) => { const d = c.pitched_at ?? c.created_at.slice(0, 10); return d >= monday && d <= sunday && listOwner[c.list_id] === "Simon"; }).length;
  const danielWeek = allContacts.filter((c) => { const d = c.pitched_at ?? c.created_at.slice(0, 10); return d >= monday && d <= sunday && listOwner[c.list_id] === "Daniel"; }).length;

  const weekCounts: Record<Owner, number> = { Kevin: kevinWeek, Simon: simonWeek, Daniel: danielWeek };
  const maxCount   = Math.max(kevinWeek, simonWeek, danielWeek);
  const minCount   = Math.min(kevinWeek, simonWeek, danielWeek);
  const leadersArr = OWNERS.filter((o) => weekCounts[o] === maxCount);
  const losersArr  = OWNERS.filter((o) => weekCounts[o] === minCount);
  const leader: Owner | null = leadersArr.length === 1 ? leadersArr[0] : null;
  const loser:  Owner | null = losersArr.length === 1 && minCount < maxCount ? losersArr[0] : null;
  const secondCount = leader ? Math.max(...OWNERS.filter((o) => o !== leader).map((o) => weekCounts[o])) : maxCount;
  const diff = leader ? maxCount - secondCount : 0;

  // ── Historische Wochen (letzte 10, ebenfalls Mo–So)
  const historicalWeeks: WeeklyDuelPoint[] = [];
  for (let i = 9; i >= 0; i--) {
    const wStart = addDaysISO(monday, -i * 7);
    const wEnd   = addDaysISO(wStart, 6); // Mo–So
    const weekLabel = `KW ${getISOWeek(wStart)}`;
    const kCount = allContacts.filter((c) => { const d = c.pitched_at ?? c.created_at.slice(0, 10); return d >= wStart && d <= wEnd && listOwner[c.list_id] === "Kevin"; }).length;
    const sCount = allContacts.filter((c) => { const d = c.pitched_at ?? c.created_at.slice(0, 10); return d >= wStart && d <= wEnd && listOwner[c.list_id] === "Simon"; }).length;
    const dCount = allContacts.filter((c) => { const d = c.pitched_at ?? c.created_at.slice(0, 10); return d >= wStart && d <= wEnd && listOwner[c.list_id] === "Daniel"; }).length;
    historicalWeeks.push({ week: weekLabel, Kevin: kCount, Simon: sCount, Daniel: dCount });
  }

  // ── Tagesziel (pro Person)
  const dailyGoal = 20;
  const todayCounts = {
    Kevin:  allContacts.filter((c) => (c.pitched_at ?? c.created_at.slice(0, 10)) === today && listOwner[c.list_id] === "Kevin").length,
    Simon:  allContacts.filter((c) => (c.pitched_at ?? c.created_at.slice(0, 10)) === today && listOwner[c.list_id] === "Simon").length,
    Daniel: allContacts.filter((c) => (c.pitched_at ?? c.created_at.slice(0, 10)) === today && listOwner[c.list_id] === "Daniel").length,
  };
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

  const MOTIVATION: Record<typeof apptStatus, { emoji: string; headline: string; sub: string; color: string; glow: string; bg: string; border: string }> = {
    below: {
      emoji: "🚀",
      headline: "Jeder DM zählt — die Quote kommt mit Volumen.",
      sub: "Die besten Closer der Welt brauchen 30–50 Nein's für jedes Ja. Ihr seid im Aufbau — weiter machen!",
      color: "#818cf8", glow: "rgba(99,102,241,0.35)", bg: "rgba(99,102,241,0.06)", border: "rgba(99,102,241,0.18)",
    },
    zone: {
      emoji: "🎯",
      headline: "Ihr seid genau im Ziel — dieser Pitch funktioniert!",
      sub: "3–7% Terminquote ist das, was Top-Closer im Cold Outreach erzielen. Skaliert diesen Ansatz jetzt!",
      color: "#34d399", glow: "rgba(52,211,153,0.35)", bg: "rgba(52,211,153,0.06)", border: "rgba(52,211,153,0.2)",
    },
    above: {
      emoji: "🏆",
      headline: "Über Ziel! Ihr spielt in einer anderen Liga.",
      sub: "Über 7% Terminquote? Das ist Elite-Niveau. Dupliziert diesen Pitch sofort auf mehr Listen!",
      color: "#fbbf24", glow: "rgba(251,191,36,0.35)", bg: "rgba(251,191,36,0.06)", border: "rgba(251,191,36,0.2)",
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
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#fafafa", letterSpacing: "-0.03em", margin: 0 }}>Dashboard</h1>
        <p style={{ fontSize: "0.8125rem", color: "#52525b", marginTop: 2 }}>
          Performance-Übersicht · {access.effective_username ?? access.workspaces.name}
        </p>
      </div>

      {/* ══ ZIELSETZUNGS-CARD ══ */}
      <div style={{ position: "relative", background: mot.bg, border: `1px solid ${mot.border}`, borderRadius: "var(--radius-xl)", padding: "1.375rem 1.75rem", overflow: "hidden" }}>
        {/* Glow blob */}
        <div style={{ position: "absolute", top: -60, right: -40, width: 220, height: 220, background: `radial-gradient(circle, ${mot.glow} 0%, transparent 70%)`, pointerEvents: "none" }} />

        <div style={{ display: "flex", alignItems: "flex-start", gap: "1.25rem", flexWrap: "wrap" }}>
          {/* Left: Big number */}
          <div style={{ textAlign: "center", flexShrink: 0 }}>
            <div style={{ fontSize: "3rem", lineHeight: 1 }}>{mot.emoji}</div>
            <div style={{ marginTop: "0.5rem" }}>
              <div style={{ fontSize: "2.25rem", fontWeight: 900, color: mot.color, letterSpacing: "-0.05em", lineHeight: 1, textShadow: `0 0 24px ${mot.glow}` }}>
                {totalDMs === 0 ? "—" : `${apptRateRounded}%`}
              </div>
              <div style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: mot.color, opacity: 0.7, marginTop: "0.125rem" }}>
                Terminquote
              </div>
            </div>
          </div>

          {/* Right: Text + bar */}
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: "1rem", fontWeight: 800, color: "#fafafa", letterSpacing: "-0.02em", marginBottom: "0.375rem", lineHeight: 1.3 }}>
              {mot.headline}
            </div>
            <p style={{ fontSize: "0.8125rem", color: "#a1a1aa", margin: "0 0 1rem", lineHeight: 1.55 }}>
              {mot.sub}
            </p>

            {/* Progress bar mit Zielzone */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.6875rem", color: "#52525b", marginBottom: "0.375rem" }}>
                <span>0%</span>
                <span style={{ color: mot.color, fontWeight: 700 }}>Ziel {GOAL_MIN}–{GOAL_MAX}%</span>
                <span>10%+</span>
              </div>
              <div style={{ position: "relative", height: 10, borderRadius: 99, background: "rgba(255,255,255,0.05)", overflow: "visible" }}>
                {/* Zielzone Highlight */}
                <div style={{ position: "absolute", left: `${goalMinPct}%`, width: `${goalMaxPct - goalMinPct}%`, top: -2, bottom: -2, background: `${mot.color}18`, border: `1px solid ${mot.color}44`, borderRadius: 4 }} />
                {/* Aktueller Wert */}
                {totalDMs > 0 && (
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${barPct}%`, borderRadius: 99, background: `linear-gradient(90deg, ${mot.color}88, ${mot.color})`, boxShadow: `0 0 8px ${mot.glow}`, transition: "width 0.6s ease" }} />
                )}
                {/* Nadel */}
                {totalDMs > 0 && (
                  <div style={{ position: "absolute", left: `calc(${barPct}% - 4px)`, top: "50%", transform: "translateY(-50%)", width: 8, height: 8, borderRadius: "50%", background: mot.color, boxShadow: `0 0 10px ${mot.glow}`, border: "2px solid #09090b" }} />
                )}
              </div>
            </div>

            {/* Mini-Stats */}
            <div style={{ display: "flex", gap: "1.25rem", marginTop: "0.875rem", flexWrap: "wrap" }}>
              {[
                { label: "DMs gesamt", value: totalDMs.toLocaleString(), color: "#71717a" },
                { label: "Termine", value: totalAppts.toLocaleString(), color: mot.color },
                { label: "Noch bis 7%", value: totalDMs > 0 ? `${Math.max(0, Math.ceil(totalDMs * 0.07) - totalAppts)} Termine` : "—", color: apptStatus === "above" ? "#34d399" : "#52525b" },
              ].map((s) => (
                <div key={s.label}>
                  <div style={{ fontSize: "0.6875rem", color: "#3f3f46", textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</div>
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
            goal={WEEKLY_GOAL}
            monday={monday}
            sunday={sunday}
          />
          <PersonalHistoryPanel weeks={personalHistoricalWeeks} goal={WEEKLY_GOAL} />
        </>
      ) : (
        <>
          {/* ══ WOCHENDUELL ══ */}
          <div style={{ position: "relative", borderRadius: "var(--radius-xl)", overflow: "hidden", background: "linear-gradient(135deg, #0d0d14 0%, #12101f 50%, #0d1117 100%)", border: "1px solid rgba(99,102,241,0.18)", padding: "1.75rem 2rem 1.5rem", boxShadow: "0 0 50px rgba(99,102,241,0.07), 0 16px 32px rgba(0,0,0,0.5)" }}>
          <div style={{ position: "absolute", top: -40, left: "15%", width: 180, height: 180, background: "radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)", pointerEvents: "none" }} />
          <div style={{ position: "absolute", top: -40, right: "15%", width: 180, height: 180, background: "radial-gradient(circle, rgba(139,92,246,0.1) 0%, transparent 70%)", pointerEvents: "none" }} />

        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginBottom: "1.5rem" }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 12px rgba(99,102,241,0.45)", flexShrink: 0 }}>
            <Trophy size={16} color="white" />
          </div>
          <div>
            <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "#fafafa", letterSpacing: "-0.01em" }}>Wochenduell — Wer bezahlt das Essen?</div>
            <div style={{ fontSize: "0.75rem", color: "#52525b" }}>Ziel: {WEEKLY_GOAL} DMs · {monday} → {sunday} · Reset jeden Montag</div>
          </div>
          {leader && (
            <div style={{ marginLeft: "auto", background: OWNER_STYLE[leader].bg, border: `1px solid ${OWNER_STYLE[leader].border}`, borderRadius: 99, padding: "0.2rem 0.75rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <span style={{ fontSize: "0.875rem" }}>👑</span>
              <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: OWNER_STYLE[leader].color }}>{leader} +{diff}</span>
            </div>
          )}
        </div>

        <div className="duel-grid" style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto 1fr", gap: "1.5rem", alignItems: "center" }}>
          <DuelPanel owner="Kevin"  count={kevinWeek}  leader={leader} loser={loser} goal={WEEKLY_GOAL} />
          <VSSep />
          <DuelPanel owner="Simon"  count={simonWeek}  leader={leader} loser={loser} goal={WEEKLY_GOAL} />
          <VSSep />
          <DuelPanel owner="Daniel" count={danielWeek} leader={leader} loser={loser} goal={WEEKLY_GOAL} />
        </div>

        <div style={{ marginTop: "1rem", paddingTop: "0.875rem", borderTop: "1px solid rgba(255,255,255,0.05)", fontSize: "0.8125rem", color: "#52525b", textAlign: "center" }}>
          {leader && diff > 0 ? <><span style={{ color: "#a1a1aa" }}>2. Platz braucht noch </span><span style={{ color: "#fbbf24", fontWeight: 700 }}>{diff} DMs</span><span style={{ color: "#a1a1aa" }}> zum Gleichstand · </span></> : <span style={{ color: "#52525b" }}>Gleichstand · </span>}
          <span style={{ color: WEEKLY_GOAL - maxCount > 0 ? "#6366f1" : "#4ade80", fontWeight: 600 }}>
            {WEEKLY_GOAL - maxCount > 0 ? `${WEEKLY_GOAL - maxCount} bis zur 100er-Marke` : "🎉 100er-Marke erreicht!"}
          </span>
        </div>
          </div>

          {/* ══ DUELL-VERLAUF ══ */}
          <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1.125rem 1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.875rem" }}>
          <History size={14} color="#fbbf24" />
          <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#fafafa" }}>Duell-Verlauf letzte 10 Wochen</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.75rem" }}>
            {[{ label: "Kevin", color: METRIC_COLORS.dms }, { label: "Simon", color: METRIC_COLORS.appointments }, { label: "Daniel", color: "#34d399" }, { label: `Ziel ${WEEKLY_GOAL}`, color: "#fbbf24" }].map((m) => (
              <div key={m.label} style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: m.color }} />
                <span style={{ fontSize: "0.6875rem", color: "#71717a" }}>{m.label}</span>
              </div>
            ))}
          </div>
        </div>
        <WeeklyDuelChart data={historicalWeeks} goal={WEEKLY_GOAL} />
        {(() => {
          const kevinWins  = historicalWeeks.filter((w) => w.Kevin > w.Simon && w.Kevin > w.Daniel).length;
          const simonWins  = historicalWeeks.filter((w) => w.Simon > w.Kevin && w.Simon > w.Daniel).length;
          const danielWins = historicalWeeks.filter((w) => w.Daniel > w.Kevin && w.Daniel > w.Simon).length;
          const draws      = historicalWeeks.filter((w) => w.Kevin === w.Simon && w.Kevin === w.Daniel && w.Kevin > 0).length;
          const topWins    = Math.max(kevinWins, simonWins, danielWins);
          const overallLeader = [{ n: "Kevin", w: kevinWins }, { n: "Simon", w: simonWins }, { n: "Daniel", w: danielWins }]
            .filter((x) => x.w === topWins);
          return (
            <div style={{ display: "flex", gap: "1rem", marginTop: "0.875rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: "0.75rem", color: "#52525b" }}>Siege 10 Wochen:</div>
              <div style={{ display: "flex", gap: "0.875rem" }}>
                <span style={{ fontSize: "0.875rem", fontWeight: 700, color: METRIC_COLORS.dms }}>Kevin {kevinWins}W</span>
                <span style={{ fontSize: "0.875rem", fontWeight: 700, color: METRIC_COLORS.appointments }}>Simon {simonWins}W</span>
                <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#34d399" }}>Daniel {danielWins}W</span>
                {draws > 0 && <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#52525b" }}>{draws}×Unentschieden</span>}
              </div>
              <div style={{ marginLeft: "auto", fontSize: "0.75rem", color: "#52525b" }}>
                {overallLeader.length === 1 ? `${overallLeader[0].n} führt (+${topWins - Math.max(...[kevinWins, simonWins, danielWins].filter((w) => w !== topWins || [kevinWins, simonWins, danielWins].indexOf(w) > [kevinWins, simonWins, danielWins].indexOf(topWins)))})` : "Gleichstand"}
              </div>
            </div>
          );
        })()}
          </div>
        </>
      )}

      {/* ══ SEKTION 1: GESAMT (Client, eigener Filter) ══ */}
      <OverallSection
        allContacts={allContacts}
        lists={pitchLists}
        today={today}
        todayCounts={todayCounts}
        personalMode={isPersonalView}
        personalOwnerName={personalName}
        personalTodayCount={personalTodayCount}
        dailyGoal={dailyGoal}
      />

      {/* ══ FOLLOW-UP ALERTS ══ */}
      {(followUpAlerts.length > 0 || overdueAlerts.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: followUpAlerts.length > 0 && overdueAlerts.length > 0 ? "1fr 1fr" : "1fr", gap: "0.875rem" }}>
          {followUpAlerts.length > 0 && (
            <div style={{ background: "rgba(251,191,36,0.04)", border: "1px solid rgba(251,191,36,0.18)", borderRadius: "var(--radius-lg)", padding: "1.125rem 1.375rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.625rem" }}>
                <Bell size={14} color="#fbbf24" />
                <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#fbbf24" }}>FUs fällig ({followUpAlerts.length})</span>
              </div>
              {followUpAlerts.map(({ contact: c, nextFu }) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8125rem", marginBottom: "0.25rem" }}>
                  <span style={{ padding: "1px 5px", borderRadius: 3, background: "rgba(251,191,36,0.12)", color: "#fbbf24", fontSize: "0.6875rem", fontWeight: 700, flexShrink: 0 }}>FU{nextFu}</span>
                  <Link href={`/lists/${c.list_id}`} style={{ color: "#e4e4e7", textDecoration: "none", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</Link>
                  <span style={{ color: "#52525b", fontSize: "0.6875rem", flexShrink: 0 }}>{c.next_follow_up_at}</span>
                </div>
              ))}
            </div>
          )}
          {overdueAlerts.length > 0 && (
            <div style={{ background: "rgba(248,113,113,0.04)", border: "1px solid rgba(248,113,113,0.18)", borderRadius: "var(--radius-lg)", padding: "1.125rem 1.375rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.625rem" }}>
                <AlertCircle size={14} color="#f87171" />
                <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#f87171" }}>Stark überfällig ({overdueAlerts.length})</span>
              </div>
              {overdueAlerts.map((c) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8125rem", marginBottom: "0.25rem" }}>
                  <span style={{ padding: "1px 5px", borderRadius: 3, background: "rgba(248,113,113,0.12)", color: "#f87171", fontSize: "0.6875rem", fontWeight: 700, flexShrink: 0 }}>FU{Math.min((c.follow_up_number ?? 0) + 1, 3)}</span>
                  <Link href={`/lists/${c.list_id}`} style={{ color: "#e4e4e7", textDecoration: "none", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</Link>
                  <span style={{ color: "#f87171", fontSize: "0.6875rem", flexShrink: 0 }}>{c.next_follow_up_at}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!isPersonalView && (
        <>
          {/* ══ SEKTION 2: KEVIN vs SIMON vs DANIEL (Client, eigener Filter) ══ */}
          <PersonSection
            allContacts={allContacts}
            lists={pitchLists}
            today={today}
            kevinWeek={kevinWeek}
            simonWeek={simonWeek}
            danielWeek={danielWeek}
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
              <Zap size={13} color="#fbbf24" />
            </div>
            <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#fafafa" }}>Automatische Analyse</span>
            <span style={{ fontSize: "0.75rem", color: "#52525b" }}>· Basierend auf deinen echten Daten</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "0.75rem" }}>
            {insights.map((ins, i) => {
              const cfg = {
                success: { border: "rgba(74,222,128,0.2)",  bg: "rgba(74,222,128,0.04)",  icon: <CheckCircle size={14} color="#4ade80" />, color: "#4ade80" },
                warning: { border: "rgba(251,191,36,0.2)",  bg: "rgba(251,191,36,0.04)",  icon: <Bell size={14} color="#fbbf24" />,         color: "#fbbf24" },
                danger:  { border: "rgba(248,113,113,0.2)", bg: "rgba(248,113,113,0.04)", icon: <AlertCircle size={14} color="#f87171" />,  color: "#f87171" },
                tip:     { border: "rgba(129,140,248,0.2)", bg: "rgba(129,140,248,0.04)", icon: <Zap size={14} color="#818cf8" />,           color: "#818cf8" },
              }[ins.level];
              return (
                <div key={i} style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: "var(--radius-lg)", padding: "1rem 1.125rem" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", marginBottom: "0.375rem" }}>
                    <div style={{ flexShrink: 0, marginTop: 1 }}>{cfg.icon}</div>
                    <div style={{ fontSize: "0.875rem", fontWeight: 700, color: cfg.color, lineHeight: 1.3 }}>{ins.title}</div>
                  </div>
                  <div style={{ fontSize: "0.8125rem", color: "#a1a1aa", lineHeight: 1.5, marginBottom: ins.listId ? "0.625rem" : 0 }}>{ins.body}</div>
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
