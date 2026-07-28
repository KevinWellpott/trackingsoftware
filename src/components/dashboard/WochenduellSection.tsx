import { Crown, History, Trophy, Utensils } from "lucide-react";
import {
  WeeklyDuelChart, type DuelSeries, type WeeklyDuelPoint,
} from "@/components/DashboardCharts";
import { ownerColor } from "@/lib/ownerColor";

// Wochenduell + Duell-Verlauf: 1:1 aus dem alten Home-Dashboard extrahiert
// (Emojis → Lucide-Icons). Wird aktuell nicht auf "/" gerendert — vorbereitet
// für die kommende /team-Seite. Nimmt vorberechnete Props entgegen.

export type WochenduellProps = {
  roster: string[];
  weekCounts: Record<string, number>;
  weeklyGoal: number;
  historicalWeeks: { week: string; counts: Record<string, number> }[];
  winCounts: Record<string, number>;
  draws: number;
};

/** Translucent variant of a (possibly var()-based) color. */
function tint(color: string, alphaPct: number): string {
  return `color-mix(in srgb, ${color} ${alphaPct}%, transparent)`;
}

function DuelPanel({ owner, color, count, isLeader, isLoser, goal }: { owner: string; color: string; count: number; isLeader: boolean; isLoser: boolean; goal: number; }) {
  const progress = Math.min((count / goal) * 100, 100);
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem", marginBottom: "0.875rem" }}>
        <div style={{ width: 38, height: 38, borderRadius: "50%", background: tint(color, 13), border: `2px solid ${isLeader ? color : tint(color, 25)}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.9375rem", fontWeight: 600, color, flexShrink: 0 }}>{owner[0]}</div>
        <div>
          <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: isLeader ? color : "var(--text-secondary)", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.25rem" }}>
            {owner} {isLeader && <Crown size={13} aria-hidden />}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-subtle)", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.25rem" }}>
            {isLoser ? <>zahlt das Essen <Utensils size={11} aria-hidden /></> : isLeader ? "führt diese Woche" : "im Rennen"}
          </div>
        </div>
      </div>
      <div style={{ fontSize: "3.25rem", fontWeight: 600, letterSpacing: "-0.04em", color: isLeader ? color : "var(--text-subtle)", lineHeight: 1, marginBottom: "0.5rem" }}>
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
      <div style={{ width: 1, height: 24, background: "linear-gradient(to bottom, transparent, var(--color-info-border))" }} />
      <div style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--text-subtle)", letterSpacing: "0.1em", padding: "3px 8px", border: "1px solid var(--color-info-border)", borderRadius: 99, background: "var(--color-info-bg)" }}>VS</div>
      <div style={{ width: 1, height: 24, background: "linear-gradient(to bottom, var(--color-info-border), transparent)" }} />
    </div>
  );
}

export function WochenduellSection({
  roster: rosterNames,
  weekCounts,
  weeklyGoal,
  historicalWeeks: historicalWeeksProp,
  winCounts,
  draws,
}: WochenduellProps) {
  const roster: DuelSeries[] = rosterNames.map((name) => ({ name, color: ownerColor(name).fg }));
  const historicalWeeks: WeeklyDuelPoint[] = historicalWeeksProp.map((w) => ({ week: w.week, values: w.counts }));

  const weekValues = rosterNames.map((n) => weekCounts[n] ?? 0);
  const maxCount   = weekValues.length > 0 ? Math.max(...weekValues) : 0;
  const minCount   = weekValues.length > 0 ? Math.min(...weekValues) : 0;
  const leadersArr = rosterNames.filter((n) => (weekCounts[n] ?? 0) === maxCount);
  const losersArr  = rosterNames.filter((n) => (weekCounts[n] ?? 0) === minCount);
  const leader: string | null = leadersArr.length === 1 ? leadersArr[0] : null;
  const loser:  string | null = losersArr.length === 1 && minCount < maxCount ? losersArr[0] : null;
  const secondCount = leader ? Math.max(0, ...rosterNames.filter((n) => n !== leader).map((n) => weekCounts[n] ?? 0)) : maxCount;
  const diff = leader ? maxCount - secondCount : 0;
  const leaderColor = leader ? roster.find((r) => r.name === leader)!.color : null;

  const winValues = rosterNames.map((n) => winCounts[n] ?? 0);
  const topWins = winValues.length > 0 ? Math.max(...winValues) : 0;
  const overallLeaders = rosterNames.filter((n) => (winCounts[n] ?? 0) === topWins);
  const secondWins = overallLeaders.length === 1
    ? Math.max(0, ...rosterNames.filter((n) => n !== overallLeaders[0]).map((n) => winCounts[n] ?? 0))
    : topWins;

  if (roster.length === 0) return null;

  return (
    <>
      {/* ══ WOCHENDUELL ══ */}
      <div className="card ember-glow" style={{ position: "relative", overflow: "hidden", padding: "var(--sp-9) var(--sp-10) var(--sp-8)" }}>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)", marginBottom: "var(--sp-8)" }}>
          <div style={{ width: 32, height: 32, borderRadius: "var(--r-md)", background: "var(--orange-500)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Trophy size={16} color="#0a0a0b" />
          </div>
          <div>
            <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: "var(--text-primary)", letterSpacing: "var(--ls-tight)" }}>Wochenduell — Wer bezahlt das Essen?</div>
            <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>Ziel: {weeklyGoal} DMs · Reset jeden Montag</div>
          </div>
          {leader && leaderColor && (
            <div style={{ marginLeft: "auto", background: tint(leaderColor, 8), border: `1px solid ${tint(leaderColor, 25)}`, borderRadius: 99, padding: "0.2rem 0.75rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <Crown size={14} color={leaderColor} aria-hidden />
              <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: leaderColor }}>{leader} +{diff}</span>
            </div>
          )}
        </div>

        {roster.length === 2 ? (
          <div className="duel-grid" style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "1.5rem", alignItems: "center" }}>
            <DuelPanel owner={roster[0].name} color={roster[0].color} count={weekCounts[roster[0].name] ?? 0} isLeader={leader === roster[0].name} isLoser={loser === roster[0].name} goal={weeklyGoal} />
            <VSSep />
            <DuelPanel owner={roster[1].name} color={roster[1].color} count={weekCounts[roster[1].name] ?? 0} isLeader={leader === roster[1].name} isLoser={loser === roster[1].name} goal={weeklyGoal} />
          </div>
        ) : (
          <div className="duel-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1.5rem", alignItems: "start" }}>
            {roster.map((r) => (
              <DuelPanel key={r.name} owner={r.name} color={r.color} count={weekCounts[r.name] ?? 0} isLeader={leader === r.name} isLoser={loser === r.name} goal={weeklyGoal} />
            ))}
          </div>
        )}

        <div style={{ marginTop: "1rem", paddingTop: "0.875rem", borderTop: "1px solid var(--border)", fontSize: "0.8125rem", color: "var(--text-subtle)", textAlign: "center" }}>
          {leader && diff > 0 ? <><span style={{ color: "var(--text-muted)" }}>2. Platz braucht noch </span><span style={{ color: "var(--color-warning-text)", fontWeight: 600 }}>{diff} DMs</span><span style={{ color: "var(--text-muted)" }}> zum Gleichstand · </span></> : <span style={{ color: "var(--text-subtle)" }}>Gleichstand · </span>}
          <span style={{ color: weeklyGoal - maxCount > 0 ? "var(--brand-500)" : "var(--color-success-text)", fontWeight: 600 }}>
            {weeklyGoal - maxCount > 0 ? `${weeklyGoal - maxCount} bis zur ${weeklyGoal}er-Marke` : `${weeklyGoal}er-Marke erreicht!`}
          </span>
        </div>
      </div>

      {/* ══ DUELL-VERLAUF ══ */}
      <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1.125rem 1.5rem", boxShadow: "var(--shadow-sm)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.875rem", flexWrap: "wrap" }}>
          <History size={14} color="var(--color-warning-text)" />
          <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-primary)" }}>Duell-Verlauf letzte 10 Wochen</span>
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
              <span key={r.name} style={{ fontSize: "0.875rem", fontWeight: 600, color: r.color }}>{r.name} {winCounts[r.name] ?? 0}W</span>
            ))}
            {draws > 0 && <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-subtle)" }}>{draws}×Unentschieden</span>}
          </div>
          <div style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--text-subtle)" }}>
            {overallLeaders.length === 1 ? `${overallLeaders[0]} führt (+${topWins - secondWins})` : "Gleichstand"}
          </div>
        </div>
      </div>
    </>
  );
}
