"use client";

import { useMemo } from "react";
import { Zap } from "lucide-react";
import { useSectionFilter } from "./useSectionFilter";
import { SectionFilterBar } from "./SectionFilterBar";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { MultiMetricBarChart, METRIC_COLORS, tint, type MultiMetricDay } from "@/components/DashboardCharts";
import type { ContactWithStage, PitchList } from "@/lib/types";

const PERSONAL_COLOR = "var(--color-warning-text)";

type RosterMember = { name: string; color: string };

type Props = {
  allContacts: ContactWithStage[];
  lists: PitchList[];
  today: string;
  roster?: RosterMember[];
  todayCounts: Record<string, number>;
  personalMode?: boolean;
  personalOwnerName?: string;
  personalTodayCount?: number;
  dailyGoal: number;
};

function addDays(base: string, n: number): string {
  const [y, m, d] = base.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function buildChartData(contacts: ContactWithStage[], from: string, to: string): MultiMetricDay[] {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  const startDate = new Date(y1, m1 - 1, d1);
  const endDate   = new Date(y2, m2 - 1, d2);
  const diffDays  = Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
  const useWeekly = diffDays > 60;

  if (useWeekly) {
    const weeks: Record<string, MultiMetricDay> = {};
    for (let i = 0; i < diffDays; i += 7) {
      const k = addDays(from, i);
      weeks[k] = { date: k.slice(5), dms: 0, answers: 0, appointments: 0 };
    }
    const weekKeys = Object.keys(weeks).sort();
    for (const c of contacts) {
      const d = c.pitched_at ?? c.created_at.slice(0, 10);
      for (let i = weekKeys.length - 1; i >= 0; i--) {
        if (d >= weekKeys[i]) {
          weeks[weekKeys[i]].dms++;
          if (c.answered) weeks[weekKeys[i]].answers++;
          if (c.appointment_set) weeks[weekKeys[i]].appointments++;
          break;
        }
      }
    }
    return weekKeys.map((k) => weeks[k]).slice(-20);
  }

  const days: Record<string, MultiMetricDay> = {};
  for (let i = 0; i < Math.min(diffDays, 90); i++) {
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
  return Object.values(days).slice(-60);
}

function pct(n: number, t: number) { return t === 0 ? 0 : Math.round((n / t) * 1000) / 10; }

export function OverallSection({
  allContacts,
  lists,
  today,
  roster = [],
  todayCounts = {},
  personalMode = false,
  personalOwnerName = "Du",
  personalTodayCount = 0,
  dailyGoal,
}: Props) {
  const f = useSectionFilter(allContacts, lists, "all");

  const total    = f.filtered.length;
  const answered = f.filtered.filter((c) => c.answered === true).length;
  const appts    = f.filtered.filter((c) => c.appointment_set === true).length;
  const openFUs  = useMemo(() =>
    allContacts.filter((c) => c.answered !== true && c.next_follow_up_at && c.next_follow_up_at <= today && c.follow_up_number !== 3).length,
    [allContacts, today],
  );

  const chartData = useMemo(
    () => buildChartData(f.filtered, f.effectiveFrom, f.effectiveTo),
    [f.filtered, f.effectiveFrom, f.effectiveTo],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
      {/* Section Header */}
        <div className="section-header-mobile" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", paddingBottom: "0.75rem", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: "var(--surface-200)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Zap size={13} color="var(--brand-500)" />
          </div>
          <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary)" }}>Gesamt-Performance</span>
          <span style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>· {f.periodLabel}</span>
        </div>
        <SectionFilterBar
          lists={lists}
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
          hideOwner={personalMode}
        />
      </div>

      {/* Tagesziel je Person */}
      {personalMode ? (
        <div style={{ background: tint(PERSONAL_COLOR, 5), border: `1px solid ${tint(PERSONAL_COLOR, 19)}`, borderRadius: "var(--radius-lg)", padding: "1rem 1.375rem" }}>
          {(() => {
            const count = personalTodayCount;
            const done = count >= dailyGoal;
            const pct = Math.min((count / dailyGoal) * 100, 100);
            return (
              <div style={{ display: "flex", alignItems: "center", gap: "0.875rem" }}>
                <div style={{ position: "relative", width: 48, height: 48, flexShrink: 0 }}>
                  <svg width="48" height="48" viewBox="0 0 48 48" style={{ transform: "rotate(-90deg)" }}>
                    <circle cx="24" cy="24" r="18" fill="none" stroke="var(--surface-200)" strokeWidth="5" />
                    <circle cx="24" cy="24" r="18" fill="none" stroke={done ? "var(--color-success-text)" : PERSONAL_COLOR} strokeWidth="5"
                      strokeDasharray={`${2 * Math.PI * 18}`}
                      strokeDashoffset={`${2 * Math.PI * 18 * (1 - pct / 100)}`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.6875rem", fontWeight: 800, color: done ? "var(--color-success-text)" : PERSONAL_COLOR }}>
                    {Math.round(pct)}%
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.25rem" }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: tint(PERSONAL_COLOR, 9), border: `1.5px solid ${tint(PERSONAL_COLOR, 27)}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.6875rem", fontWeight: 800, color: PERSONAL_COLOR }}>{personalOwnerName[0]?.toUpperCase() ?? "D"}</div>
                    <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: PERSONAL_COLOR }}>{personalOwnerName}</span>
                    {done && <span style={{ fontSize: "0.75rem" }}>🎉</span>}
                  </div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.03em", color: done ? "var(--color-success-text)" : "var(--text-primary)", lineHeight: 1.1 }}>
                    {count}<span style={{ fontSize: "0.875rem", color: "var(--text-subtle)", fontWeight: 500 }}>/{dailyGoal}</span>
                  </div>
                  <div style={{ background: "var(--surface-200)", borderRadius: 99, height: 4, overflow: "hidden", marginTop: "0.375rem" }}>
                    <div style={{ height: "100%", borderRadius: 99, width: `${pct}%`, background: done ? "var(--color-success-text)" : PERSONAL_COLOR, transition: "width 0.4s ease" }} />
                  </div>
                  <div style={{ fontSize: "0.6875rem", color: "var(--text-subtle)", marginTop: "0.25rem" }}>
                    {done ? "Tagesziel erreicht!" : `Noch ${dailyGoal - count} DMs heute`}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
        <div className="daily-goal-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0.75rem" }}>
          {roster.map((member) => {
          const owner = member.name;
          const count = todayCounts[owner] ?? 0;
          const done  = count >= dailyGoal;
          const color = member.color;
          const pct   = Math.min((count / dailyGoal) * 100, 100);
          return (
            <div key={owner} style={{ background: done ? "rgb(4 184 0 / 0.05)" : tint(color, 4), border: `1px solid ${done ? "rgb(4 184 0 / 0.2)" : tint(color, 16)}`, borderRadius: "var(--radius-lg)", padding: "1rem 1.375rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.875rem" }}>
                {/* Ring */}
                <div style={{ position: "relative", width: 48, height: 48, flexShrink: 0 }}>
                  <svg width="48" height="48" viewBox="0 0 48 48" style={{ transform: "rotate(-90deg)" }}>
                    <circle cx="24" cy="24" r="18" fill="none" stroke="var(--surface-200)" strokeWidth="5" />
                    <circle cx="24" cy="24" r="18" fill="none" stroke={done ? "var(--color-success-text)" : color} strokeWidth="5"
                      strokeDasharray={`${2 * Math.PI * 18}`}
                      strokeDashoffset={`${2 * Math.PI * 18 * (1 - pct / 100)}`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.6875rem", fontWeight: 800, color: done ? "var(--color-success-text)" : color }}>
                    {Math.round(pct)}%
                  </div>
                </div>
                {/* Info */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.25rem" }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: tint(color, 9), border: `1.5px solid ${tint(color, 27)}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.6875rem", fontWeight: 800, color }}>{owner[0]}</div>
                    <span style={{ fontSize: "0.8125rem", fontWeight: 700, color }}>{owner}</span>
                    {done && <span style={{ fontSize: "0.75rem" }}>🎉</span>}
                  </div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.03em", color: done ? "var(--color-success-text)" : "var(--text-primary)", lineHeight: 1.1 }}>
                    {count}<span style={{ fontSize: "0.875rem", color: "var(--text-subtle)", fontWeight: 500 }}>/{dailyGoal}</span>
                  </div>
                  {/* Bar */}
                  <div style={{ background: "var(--surface-200)", borderRadius: 99, height: 4, overflow: "hidden", marginTop: "0.375rem" }}>
                    <div style={{ height: "100%", borderRadius: 99, width: `${pct}%`, background: done ? "var(--color-success-text)" : color, transition: "width 0.4s ease" }} />
                  </div>
                  <div style={{ fontSize: "0.6875rem", color: "var(--text-subtle)", marginTop: "0.25rem" }}>
                    {done ? "Tagesziel erreicht!" : `Noch ${dailyGoal - count} DMs heute`}
                  </div>
                </div>
              </div>
            </div>
          );
          })}
        </div>
      )}

      {/* 4 Stat Cards */}
      <div className="grid-4-stat" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.875rem" }}>
        {[
          { label: "Gesamt DMs", num: total, suffix: "", color: METRIC_COLORS.dms },
          { label: "Antwortrate", num: pct(answered, total), suffix: "%", color: METRIC_COLORS.answers, sub: `${answered} Antworten` },
          { label: "Terminrate", num: pct(appts, total), suffix: "%", color: METRIC_COLORS.appointments, sub: `${appts} Termine` },
          { label: "Offene FUs", num: openFUs, suffix: "", color: openFUs > 0 ? METRIC_COLORS.followups : METRIC_COLORS.answers },
        ].map((card) => (
          <div key={card.label} style={{ position: "relative", background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1.125rem 1.25rem", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
            <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "var(--text-subtle)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.625rem" }}>{card.label}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
              {card.suffix === "%" ? (
                <span style={{ fontSize: "2rem", fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.04em", lineHeight: 1 }}>{card.num}</span>
              ) : (
                <NumberTicker value={card.num} style={{ fontSize: "2rem", fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.04em", lineHeight: 1 }} />
              )}
              {card.suffix && <span style={{ fontSize: "0.9375rem", fontWeight: 600, color: card.color }}>{card.suffix}</span>}
            </div>
            {"sub" in card && card.sub && <div style={{ fontSize: "0.6875rem", color: "var(--text-subtle)", marginTop: "0.25rem" }}>{card.sub}</div>}
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: card.color, opacity: 0.4, borderRadius: "0 0 var(--radius-lg) var(--radius-lg)" }} />
          </div>
        ))}
      </div>

      {/* Verlauf Chart */}
      <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1.25rem 1.5rem", boxShadow: "var(--shadow-sm)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.875rem" }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary)" }}>Verlauf</div>
          <div style={{ display: "flex", gap: "0.5rem", marginLeft: "auto" }}>
            {[{ label: "DMs", color: METRIC_COLORS.dms }, { label: "Antworten", color: METRIC_COLORS.answers }, { label: "Termine", color: METRIC_COLORS.appointments }].map((m) => (
              <div key={m.label} style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: m.color }} />
                <span style={{ fontSize: "0.6875rem", color: "var(--text-subtle)" }}>{m.label}</span>
              </div>
            ))}
          </div>
        </div>
        <MultiMetricBarChart data={chartData} />
      </div>
    </div>
  );
}
