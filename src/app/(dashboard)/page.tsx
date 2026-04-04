import { createClient } from "@/lib/supabase/server";
import { addDaysISO, localDateISO } from "@/lib/dates";
import { getMembership } from "@/lib/workspace";
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

const OWNERS = ["Kevin", "Simon"] as const;
const WEEKLY_GOAL = 100;

const OWNER_STYLE = {
  Kevin: { color: "#818cf8", glow: "rgba(99,102,241,0.4)", bg: "rgba(99,102,241,0.08)", border: "rgba(99,102,241,0.25)" },
  Simon: { color: "#a78bfa", glow: "rgba(139,92,246,0.4)", bg: "rgba(139,92,246,0.08)", border: "rgba(139,92,246,0.25)" },
};

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

function DuelPanel({ owner, count, leader, goal }: { owner: "Kevin" | "Simon"; count: number; leader: string | null; goal: number; }) {
  const s = OWNER_STYLE[owner];
  const isWinner = leader === owner;
  const isLoser = !!leader && leader !== owner;
  const progress = Math.min((count / goal) * 100, 100);
  const isLeft = owner === "Kevin";
  return (
    <div style={{ textAlign: isLeft ? "left" : "right" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginBottom: "0.875rem", justifyContent: isLeft ? "flex-start" : "flex-end" }}>
        {isLeft && <div style={{ width: 38, height: 38, borderRadius: "50%", background: `${s.color}22`, border: `2px solid ${isWinner ? s.color : s.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.9375rem", fontWeight: 800, color: s.color, boxShadow: isWinner ? `0 0 14px ${s.glow}` : "none", flexShrink: 0 }}>{owner[0]}</div>}
        <div>
          <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: isWinner ? s.color : "#e4e4e7" }}>{owner} {isWinner ? "👑" : ""}</div>
          <div style={{ fontSize: "0.75rem", color: "#71717a" }}>{isLoser ? "zahlt das Essen 🍽️" : isWinner ? "führt diese Woche" : "gleichauf"}</div>
        </div>
        {!isLeft && <div style={{ width: 38, height: 38, borderRadius: "50%", background: `${s.color}22`, border: `2px solid ${isWinner ? s.color : s.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.9375rem", fontWeight: 800, color: s.color, boxShadow: isWinner ? `0 0 14px ${s.glow}` : "none", flexShrink: 0 }}>{owner[0]}</div>}
      </div>
      <div style={{ fontSize: "3.25rem", fontWeight: 800, letterSpacing: "-0.04em", color: isWinner ? s.color : "#71717a", lineHeight: 1, marginBottom: "0.5rem", textShadow: isWinner ? `0 0 28px ${s.glow}` : "none" }}>
        {count}<span style={{ fontSize: "1.125rem", fontWeight: 500, color: "#3f3f46", marginLeft: 3 }}>/{goal}</span>
      </div>
      <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 99, height: 6, overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: 99, width: `${progress}%`, background: isWinner ? `linear-gradient(${isLeft ? 90 : 270}deg, ${s.color}, ${isLeft ? "#8b5cf6" : "#6366f1"})` : `${s.color}44`, boxShadow: isWinner ? `0 0 8px ${s.glow}` : "none" }} />
      </div>
      <div style={{ fontSize: "0.6875rem", color: "#52525b", marginTop: "0.375rem" }}>
        {Math.round(progress)}% · noch {Math.max(0, goal - count)} bis {goal}
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const m = await getMembership();
  if (!m) return null;

  const supabase = await createClient();
  const today = localDateISO();
  const monday = weekStart(today);
  const sunday = addDaysISO(monday, 6); // Woche läuft Mo–So komplett

  const { data: lists } = await supabase.from("lists").select("*").eq("workspace_id", m.workspace_id).is("archived_at", null).order("sort_order");
  const { data: rawContacts } = await supabase.from("contacts").select("*, pipeline_stages (*)").eq("workspace_id", m.workspace_id);

  const allContacts = (rawContacts ?? []) as unknown as ContactWithStage[];
  const pitchLists  = (lists ?? []) as PitchList[];

  // Liste → Owner lookup
  const listOwner: Record<string, string> = {};
  for (const l of pitchLists) { if (l.owner_name) listOwner[l.id] = l.owner_name; }

  // ── Wochenduell (Mo–So, damit Sa/So auch mitzählen)
  const kevinWeek = allContacts.filter((c) => { const d = c.pitched_at ?? c.created_at.slice(0, 10); return d >= monday && d <= sunday && listOwner[c.list_id] === "Kevin"; }).length;
  const simonWeek = allContacts.filter((c) => { const d = c.pitched_at ?? c.created_at.slice(0, 10); return d >= monday && d <= sunday && listOwner[c.list_id] === "Simon"; }).length;
  const leader = kevinWeek > simonWeek ? "Kevin" : simonWeek > kevinWeek ? "Simon" : null;
  const diff   = Math.abs(kevinWeek - simonWeek);

  // ── Historische Wochen (letzte 10, ebenfalls Mo–So)
  const historicalWeeks: WeeklyDuelPoint[] = [];
  for (let i = 9; i >= 0; i--) {
    const wStart = addDaysISO(monday, -i * 7);
    const wEnd   = addDaysISO(wStart, 6); // Mo–So
    const weekLabel = `KW ${getISOWeek(wStart)}`;
    const kCount = allContacts.filter((c) => { const d = c.pitched_at ?? c.created_at.slice(0, 10); return d >= wStart && d <= wEnd && listOwner[c.list_id] === "Kevin"; }).length;
    const sCount = allContacts.filter((c) => { const d = c.pitched_at ?? c.created_at.slice(0, 10); return d >= wStart && d <= wEnd && listOwner[c.list_id] === "Simon"; }).length;
    historicalWeeks.push({ week: weekLabel, Kevin: kCount, Simon: sCount });
  }

  // ── Tagesziel (pro Person)
  const dailyGoal = 20;
  const todayCounts = {
    Kevin: allContacts.filter((c) => (c.pitched_at ?? c.created_at.slice(0, 10)) === today && listOwner[c.list_id] === "Kevin").length,
    Simon: allContacts.filter((c) => (c.pitched_at ?? c.created_at.slice(0, 10)) === today && listOwner[c.list_id] === "Simon").length,
  };

  // ── Follow-up alerts (always current, no filter)
  const urgentThreshold = addDaysISO(today, -3);
  const dueFUs = allContacts.filter((c) => c.answered !== true && c.follow_up_number !== 3 && c.next_follow_up_at && c.next_follow_up_at <= today);
  const followUpAlerts  = dueFUs.filter((c) => c.next_follow_up_at! >= urgentThreshold).map((c) => ({ contact: c, nextFu: Math.min((c.follow_up_number ?? 0) + 1, 3) as 1 | 2 | 3 })).slice(0, 10);
  const overdueAlerts   = dueFUs.filter((c) => c.next_follow_up_at! < urgentThreshold).slice(0, 8);

  // ── Insights (overall, no filter)
  const insights = generateInsights(pitchLists, allContacts);

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", flexDirection: "column", gap: "1.75rem" }}>

      {/* ══ HEADER ══ */}
      <div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#fafafa", letterSpacing: "-0.03em", margin: 0 }}>Dashboard</h1>
        <p style={{ fontSize: "0.8125rem", color: "#52525b", marginTop: 2 }}>
          Performance-Übersicht · {m.workspaces.name}
        </p>
      </div>

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
            <div style={{ marginLeft: "auto", background: OWNER_STYLE[leader as keyof typeof OWNER_STYLE].bg, border: `1px solid ${OWNER_STYLE[leader as keyof typeof OWNER_STYLE].border}`, borderRadius: 99, padding: "0.2rem 0.75rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <span style={{ fontSize: "0.875rem" }}>👑</span>
              <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: OWNER_STYLE[leader as keyof typeof OWNER_STYLE].color }}>{leader} +{diff}</span>
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "1.5rem", alignItems: "center" }}>
          <DuelPanel owner="Kevin" count={kevinWeek} leader={leader} goal={WEEKLY_GOAL} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem", flexShrink: 0 }}>
            <div style={{ width: 1, height: 24, background: "linear-gradient(to bottom, transparent, rgba(99,102,241,0.35))" }} />
            <div style={{ fontSize: "0.6875rem", fontWeight: 800, color: "#3f3f46", letterSpacing: "0.1em", padding: "3px 8px", border: "1px solid rgba(99,102,241,0.15)", borderRadius: 99, background: "rgba(99,102,241,0.05)" }}>VS</div>
            <div style={{ width: 1, height: 24, background: "linear-gradient(to bottom, rgba(99,102,241,0.35), transparent)" }} />
          </div>
          <DuelPanel owner="Simon" count={simonWeek} leader={leader} goal={WEEKLY_GOAL} />
        </div>

        <div style={{ marginTop: "1rem", paddingTop: "0.875rem", borderTop: "1px solid rgba(255,255,255,0.05)", fontSize: "0.8125rem", color: "#52525b", textAlign: "center" }}>
          {leader && diff > 0 ? <><span style={{ color: "#a1a1aa" }}>{leader === "Kevin" ? "Simon" : "Kevin"} braucht noch </span><span style={{ color: "#fbbf24", fontWeight: 700 }}>{diff} DMs</span><span style={{ color: "#a1a1aa" }}> zum Gleichstand · </span></> : <span style={{ color: "#52525b" }}>Gleichstand · </span>}
          <span style={{ color: WEEKLY_GOAL - Math.max(kevinWeek, simonWeek) > 0 ? "#6366f1" : "#4ade80", fontWeight: 600 }}>
            {WEEKLY_GOAL - Math.max(kevinWeek, simonWeek) > 0 ? `${WEEKLY_GOAL - Math.max(kevinWeek, simonWeek)} bis zur 100er-Marke` : "🎉 100er-Marke erreicht!"}
          </span>
        </div>
      </div>

      {/* ══ DUELL-VERLAUF ══ */}
      <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1.125rem 1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.875rem" }}>
          <History size={14} color="#fbbf24" />
          <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#fafafa" }}>Duell-Verlauf letzte 10 Wochen</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.75rem" }}>
            {[{ label: "Kevin", color: METRIC_COLORS.dms }, { label: "Simon", color: METRIC_COLORS.appointments }, { label: `Ziel ${WEEKLY_GOAL}`, color: "#fbbf24" }].map((m) => (
              <div key={m.label} style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: m.color }} />
                <span style={{ fontSize: "0.6875rem", color: "#71717a" }}>{m.label}</span>
              </div>
            ))}
          </div>
        </div>
        <WeeklyDuelChart data={historicalWeeks} goal={WEEKLY_GOAL} />
        {(() => {
          const kevinWins = historicalWeeks.filter((w) => w.Kevin > w.Simon).length;
          const simonWins = historicalWeeks.filter((w) => w.Simon > w.Kevin).length;
          const draws = historicalWeeks.filter((w) => w.Kevin === w.Simon && w.Kevin > 0).length;
          return (
            <div style={{ display: "flex", gap: "1rem", marginTop: "0.875rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: "0.75rem", color: "#52525b" }}>Siege 10 Wochen:</div>
              <div style={{ display: "flex", gap: "0.875rem" }}>
                <span style={{ fontSize: "0.875rem", fontWeight: 700, color: METRIC_COLORS.dms }}>Kevin {kevinWins}W</span>
                <span style={{ fontSize: "0.875rem", fontWeight: 700, color: METRIC_COLORS.appointments }}>Simon {simonWins}W</span>
                {draws > 0 && <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#52525b" }}>{draws}×Unentschieden</span>}
              </div>
              <div style={{ marginLeft: "auto", fontSize: "0.75rem", color: "#52525b" }}>
                Gesamtduell: {kevinWins > simonWins ? `Kevin führt (+${kevinWins - simonWins})` : simonWins > kevinWins ? `Simon führt (+${simonWins - kevinWins})` : "Gleichstand"}
              </div>
            </div>
          );
        })()}
      </div>

      {/* ══ SEKTION 1: GESAMT (Client, eigener Filter) ══ */}
      <OverallSection
        allContacts={allContacts}
        lists={pitchLists}
        today={today}
        todayCounts={todayCounts}
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

      {/* ══ SEKTION 2: KEVIN VS SIMON (Client, eigener Filter) ══ */}
      <PersonSection
        allContacts={allContacts}
        lists={pitchLists}
        today={today}
        kevinWeek={kevinWeek}
        simonWeek={simonWeek}
        todayCounts={todayCounts}
        dailyGoal={dailyGoal}
      />

      {/* ══ SEKTION 3: LISTEN-ANALYSE (Client, eigener Filter) ══ */}
      <ListAnalysisSection
        allContacts={allContacts}
        lists={pitchLists}
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
