"use client";

import { useMemo } from "react";
import { Zap } from "lucide-react";
import { useSectionFilter } from "./useSectionFilter";
import { SectionFilterBar } from "./SectionFilterBar";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { MultiMetricBarChart, METRIC_COLORS, type MultiMetricDay } from "@/components/DashboardCharts";
import type { ContactWithStage, PitchList } from "@/lib/types";

const OWNER_STYLE = {
  Kevin: { color: "#818cf8", glow: "rgba(99,102,241,0.35)", gradient: "linear-gradient(90deg, #6366f1, #8b5cf6)" },
  Simon: { color: "#a78bfa", glow: "rgba(139,92,246,0.35)", gradient: "linear-gradient(90deg, #8b5cf6, #a78bfa)" },
};

type Props = {
  allContacts: ContactWithStage[];
  lists: PitchList[];
  today: string;
  todayCounts: { Kevin: number; Simon: number };
  dailyGoal: number;
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

function pct(n: number, t: number) { return t === 0 ? 0 : Math.round((n / t) * 100); }

export function OverallSection({ allContacts, lists, today, todayCounts = { Kevin: 0, Simon: 0 }, dailyGoal }: Props) {
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", paddingBottom: "0.75rem", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: "var(--surface-200)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Zap size={13} color="#818cf8" />
          </div>
          <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#fafafa" }}>Gesamt-Performance</span>
          <span style={{ fontSize: "0.75rem", color: "#52525b" }}>· {f.periodLabel}</span>
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
        />
      </div>

      {/* Tagesziel je Person */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        {(["Kevin", "Simon"] as const).map((owner) => {
          const count = todayCounts[owner];
          const done  = count >= dailyGoal;
          const s     = OWNER_STYLE[owner];
          const pct   = Math.min((count / dailyGoal) * 100, 100);
          return (
            <div key={owner} style={{ background: done ? "linear-gradient(135deg, rgba(74,222,128,0.07), rgba(74,222,128,0.02))" : `linear-gradient(135deg, ${s.color}0a, transparent)`, border: `1px solid ${done ? "rgba(74,222,128,0.2)" : s.color + "28"}`, borderRadius: "var(--radius-lg)", padding: "1rem 1.375rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.875rem" }}>
                {/* Ring */}
                <div style={{ position: "relative", width: 48, height: 48, flexShrink: 0 }}>
                  <svg width="48" height="48" viewBox="0 0 48 48" style={{ transform: "rotate(-90deg)" }}>
                    <circle cx="24" cy="24" r="18" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="5" />
                    <circle cx="24" cy="24" r="18" fill="none" stroke={done ? "#4ade80" : s.color} strokeWidth="5"
                      strokeDasharray={`${2 * Math.PI * 18}`}
                      strokeDashoffset={`${2 * Math.PI * 18 * (1 - pct / 100)}`}
                      strokeLinecap="round"
                      style={{ filter: `drop-shadow(0 0 4px ${done ? "#4ade80" : s.glow})` }}
                    />
                  </svg>
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.6875rem", fontWeight: 800, color: done ? "#4ade80" : s.color }}>
                    {Math.round(pct)}%
                  </div>
                </div>
                {/* Info */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.25rem" }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: `${s.color}18`, border: `1.5px solid ${s.color}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.6875rem", fontWeight: 800, color: s.color }}>{owner[0]}</div>
                    <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: s.color }}>{owner}</span>
                    {done && <span style={{ fontSize: "0.75rem" }}>🎉</span>}
                  </div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.03em", color: done ? "#4ade80" : "#fafafa", lineHeight: 1.1 }}>
                    {count}<span style={{ fontSize: "0.875rem", color: "#3f3f46", fontWeight: 500 }}>/{dailyGoal}</span>
                  </div>
                  {/* Bar */}
                  <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 99, height: 4, overflow: "hidden", marginTop: "0.375rem" }}>
                    <div style={{ height: "100%", borderRadius: 99, width: `${pct}%`, background: done ? "#4ade80" : s.gradient, transition: "width 0.4s ease", boxShadow: done ? "0 0 6px rgba(74,222,128,0.4)" : `0 0 6px ${s.glow}` }} />
                  </div>
                  <div style={{ fontSize: "0.6875rem", color: "#52525b", marginTop: "0.25rem" }}>
                    {done ? "Tagesziel erreicht!" : `Noch ${dailyGoal - count} DMs heute`}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 4 Stat Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.875rem" }}>
        {[
          { label: "Gesamt DMs", num: total, suffix: "", color: METRIC_COLORS.dms },
          { label: "Antwortrate", num: pct(answered, total), suffix: "%", color: METRIC_COLORS.answers, sub: `${answered} Antworten` },
          { label: "Terminrate", num: pct(appts, total), suffix: "%", color: METRIC_COLORS.appointments, sub: `${appts} Termine` },
          { label: "Offene FUs", num: openFUs, suffix: "", color: openFUs > 0 ? METRIC_COLORS.followups : METRIC_COLORS.answers },
        ].map((card) => (
          <div key={card.label} style={{ position: "relative", background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1.125rem 1.25rem", overflow: "hidden" }}>
            <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#52525b", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.625rem" }}>{card.label}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
              <NumberTicker value={card.num} style={{ fontSize: "2rem", fontWeight: 800, color: "#fafafa", letterSpacing: "-0.04em", lineHeight: 1 }} />
              {card.suffix && <span style={{ fontSize: "0.9375rem", fontWeight: 600, color: card.color }}>{card.suffix}</span>}
            </div>
            {"sub" in card && card.sub && <div style={{ fontSize: "0.6875rem", color: "#52525b", marginTop: "0.25rem" }}>{card.sub}</div>}
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: card.color, opacity: 0.4, borderRadius: "0 0 var(--radius-lg) var(--radius-lg)" }} />
          </div>
        ))}
      </div>

      {/* Verlauf Chart */}
      <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1.25rem 1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.875rem" }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "#fafafa" }}>Verlauf</div>
          <div style={{ display: "flex", gap: "0.5rem", marginLeft: "auto" }}>
            {[{ label: "DMs", color: METRIC_COLORS.dms }, { label: "Antworten", color: METRIC_COLORS.answers }, { label: "Termine", color: METRIC_COLORS.appointments }].map((m) => (
              <div key={m.label} style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: m.color }} />
                <span style={{ fontSize: "0.6875rem", color: "#71717a" }}>{m.label}</span>
              </div>
            ))}
          </div>
        </div>
        <MultiMetricBarChart data={chartData} />
      </div>
    </div>
  );
}
