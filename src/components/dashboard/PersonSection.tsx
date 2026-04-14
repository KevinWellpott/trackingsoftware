"use client";

import { useMemo } from "react";
import { Users } from "lucide-react";
import { useSectionFilter } from "./useSectionFilter";
import { SectionFilterBar } from "./SectionFilterBar";
import { MultiMetricBarChart, METRIC_COLORS, type MultiMetricDay } from "@/components/DashboardCharts";
import type { ContactWithStage, PitchList } from "@/lib/types";

type Props = {
  allContacts: ContactWithStage[];
  lists: PitchList[];
  today: string;
  kevinWeek: number;
  simonWeek: number;
  danielWeek: number;
  todayCounts: { Kevin: number; Simon: number; Daniel: number };
  dailyGoal: number;
};

const OWNER_STYLE = {
  Kevin:  { color: "#818cf8", glow: "rgba(99,102,241,0.4)",  bg: "rgba(99,102,241,0.08)",  border: "rgba(99,102,241,0.25)" },
  Simon:  { color: "#a78bfa", glow: "rgba(139,92,246,0.4)",  bg: "rgba(139,92,246,0.08)",  border: "rgba(139,92,246,0.25)" },
  Daniel: { color: "#34d399", glow: "rgba(52,211,153,0.4)",  bg: "rgba(52,211,153,0.08)",  border: "rgba(52,211,153,0.25)" },
};

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(base: string, n: number): string {
  const [y, m, d] = base.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function buildChartData(contacts: ContactWithStage[], from: string, to: string): MultiMetricDay[] {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  const diffDays = Math.round((new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime()) / 86400000) + 1;
  const days: Record<string, MultiMetricDay> = {};
  for (let i = 0; i < Math.min(diffDays, 60); i++) {
    const k = addDays(from, i);
    if (k > to) break;
    days[k] = { date: k.slice(5), dms: 0, answers: 0, appointments: 0 };
  }
  for (const c of contacts) {
    const d = c.pitched_at ?? c.created_at.slice(0, 10);
    if (days[d]) {
      days[d].dms++;
      if (c.answered) days[d].answers++;
      if (c.appointment_set) days[d].appointments++;
    }
  }
  return Object.values(days);
}

function pct(n: number, t: number) { return t === 0 ? 0 : Math.round((n / t) * 100); }

export function PersonSection({ allContacts, lists, today, kevinWeek, simonWeek, danielWeek, todayCounts = { Kevin: 0, Simon: 0, Daniel: 0 }, dailyGoal }: Props) {
  const f = useSectionFilter(allContacts, lists, "all");

  // Per-person: date-filtered contacts
  const personFiltered = useMemo(() => {
    return allContacts.filter((c) => {
      const d = c.pitched_at ?? c.created_at.slice(0, 10);
      return d >= f.effectiveFrom && d <= f.effectiveTo;
    });
  }, [allContacts, f.effectiveFrom, f.effectiveTo]);

  function personStats(owner: "Kevin" | "Simon" | "Daniel") {
    const ownerListIds = new Set(lists.filter((l) => l.owner_name === owner).map((l) => l.id));
    // If specific lists are selected, intersect with that person's lists
    const effectiveIds = f.selectedListIds.size > 0
      ? new Set([...f.selectedListIds].filter((id) => ownerListIds.has(id)))
      : ownerListIds;
    const cc = personFiltered.filter((c) => effectiveIds.has(c.list_id));
    const t  = cc.length;
    const a  = cc.filter((c) => c.answered === true).length;
    const ap = cc.filter((c) => c.appointment_set === true).length;
    const ofu = allContacts.filter((c) =>
      effectiveIds.has(c.list_id) && c.answered !== true &&
      c.next_follow_up_at && c.next_follow_up_at <= today && c.follow_up_number !== 3
    ).length;
    const chartData = buildChartData(cc, f.effectiveFrom, f.effectiveTo);
    return { total: t, answered: a, appts: ap, openFU: ofu, answerRate: pct(a, t), apptRate: pct(ap, t), chartData };
  }

  const weekCounts  = { Kevin: kevinWeek, Simon: simonWeek, Daniel: danielWeek };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
      {/* Section Header */}
        <div className="section-header-mobile" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", paddingBottom: "0.75rem", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: "var(--surface-200)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Users size={13} color="#a78bfa" />
          </div>
          <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#fafafa" }}>Kevin · Simon · Daniel</span>
          <span style={{ fontSize: "0.75rem", color: "#52525b" }}>
            · {f.periodLabel}
            {f.selectedListIds.size > 0 ? ` · ${f.selectedListIds.size} ${f.selectedListIds.size === 1 ? "Liste" : "Listen"} gefiltert` : " · alle Listen je Person"}
          </span>
        </div>
        <SectionFilterBar
          lists={[]}
          period={f.period}
          from={f.from}
          to={f.to}
          selectedListIds={f.selectedListIds}
          owner={f.owner}
          periodLabel={f.periodLabel}
          onPeriod={f.selectPeriod}
          onCustom={f.applyCustom}
          onToggleList={f.toggleList}
          onOwner={f.setOwner}
          onFromChange={f.setFrom}
          onToChange={f.setTo}
        />
      </div>

      <div className="grid-3-col" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
        {(["Kevin", "Simon", "Daniel"] as const).map((owner) => {
          if (f.owner && f.owner !== owner) return null;
          const ps = personStats(owner);
          const s  = OWNER_STYLE[owner];
          return (
            <div key={owner} style={{ background: "var(--surface-100)", border: `1px solid ${s.border}`, borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
              {/* Header */}
              {(() => {
                const todayN = todayCounts[owner];
                const todayDone = todayN >= dailyGoal;
                const todayPct  = Math.min((todayN / dailyGoal) * 100, 100);
                return (
                  <div style={{ padding: "1rem 1.375rem", background: `linear-gradient(135deg, ${s.color}0d, transparent)`, borderBottom: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                      <div style={{ width: 34, height: 34, borderRadius: "50%", background: `${s.color}18`, border: `1.5px solid ${s.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: s.color, flexShrink: 0, boxShadow: `0 0 10px ${s.glow}` }}>{owner[0]}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, color: s.color, fontSize: "0.9375rem" }}>{owner}</div>
                        <div style={{ fontSize: "0.6875rem", color: "#52525b" }}>{lists.filter((l) => l.owner_name === owner).length} Listen · Diese Woche: {weekCounts[owner]} DMs</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "1.625rem", fontWeight: 800, color: "#fafafa", lineHeight: 1, letterSpacing: "-0.03em" }}>{ps.total}</div>
                        <div style={{ fontSize: "0.6875rem", color: "#52525b" }}>DMs gesamt</div>
                      </div>
                    </div>
                    {/* Tagesziel mini-bar */}
                    <div style={{ marginTop: "0.75rem", padding: "0.5rem 0.75rem", borderRadius: 8, background: todayDone ? "rgba(74,222,128,0.06)" : `${s.color}08`, border: `1px solid ${todayDone ? "rgba(74,222,128,0.2)" : s.color + "22"}` }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.3rem" }}>
                        <span style={{ fontSize: "0.6875rem", fontWeight: 700, color: todayDone ? "#4ade80" : s.color, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          Tagesziel {todayDone ? "✓" : ""}
                        </span>
                        <span style={{ fontSize: "0.75rem", fontWeight: 800, color: todayDone ? "#4ade80" : "#fafafa" }}>
                          {todayN}<span style={{ fontSize: "0.6875rem", color: "#52525b", fontWeight: 500 }}>/{dailyGoal}</span>
                          <span style={{ fontSize: "0.6875rem", color: "#52525b", fontWeight: 400, marginLeft: 4 }}>DMs heute</span>
                        </span>
                      </div>
                      <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 99, height: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: 99, width: `${todayPct}%`, background: todayDone ? "#4ade80" : s.color, transition: "width 0.4s ease", boxShadow: `0 0 5px ${todayDone ? "rgba(74,222,128,0.4)" : s.glow}` }} />
                      </div>
                      {!todayDone && (
                        <div style={{ fontSize: "0.5625rem", color: "#3f3f46", marginTop: "0.2rem" }}>
                          Noch {dailyGoal - todayN} DMs bis zum Tagesziel
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
              {/* Metrics grid */}
              <div className="grid-4-stat" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", borderBottom: "1px solid var(--border)" }}>
                {[
                  { label: "Antwortrate", value: `${ps.answerRate}%`, color: METRIC_COLORS.answers },
                  { label: "Terminrate",  value: `${ps.apptRate}%`,   color: METRIC_COLORS.appointments },
                  { label: "Offene FUs",  value: String(ps.openFU),   color: ps.openFU > 0 ? METRIC_COLORS.followups : METRIC_COLORS.answers },
                ].map((kv, i) => (
                  <div key={kv.label} style={{ padding: "0.75rem 1rem", borderRight: i < 2 ? "1px solid var(--border)" : "none" }}>
                    <div style={{ fontSize: "0.6875rem", color: "#52525b", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600, marginBottom: 2 }}>{kv.label}</div>
                    <div style={{ fontSize: "1.25rem", fontWeight: 800, color: kv.color, lineHeight: 1.2 }}>{kv.value}</div>
                  </div>
                ))}
              </div>
              {/* Mini chart */}
              <div style={{ padding: "0.875rem 1.25rem" }}>
                <div style={{ fontSize: "0.6875rem", color: "#52525b", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Verlauf</div>
                <MultiMetricBarChart data={ps.chartData} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
