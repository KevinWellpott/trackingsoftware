"use client";

import { useMemo } from "react";
import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { useSectionFilter } from "./useSectionFilter";
import { SectionFilterBar } from "./SectionFilterBar";
import { ListComparisonChart, METRIC_COLORS } from "@/components/DashboardCharts";
import type { ContactWithStage, PitchList } from "@/lib/types";

type Props = {
  allContacts: ContactWithStage[];
  lists: PitchList[];
};

const OWNER_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  Kevin: { bg: "rgba(99,102,241,0.12)", border: "rgba(99,102,241,0.25)", text: "#818cf8" },
  Simon: { bg: "rgba(139,92,246,0.12)", border: "rgba(139,92,246,0.25)", text: "#a78bfa" },
};

function pct(n: number, t: number) { return t === 0 ? 0 : Math.round((n / t) * 1000) / 10; }

function RankBadge({ rank }: { rank: number }) {
  const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
  return (
    <div style={{ width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: rank === 1 ? "rgba(74,222,128,0.1)" : "rgba(255,255,255,0.04)", border: rank === 1 ? "1px solid rgba(74,222,128,0.2)" : "1px solid var(--border)", flexShrink: 0 }}>
      {medal ? (
        <span style={{ fontSize: "0.875rem" }}>{medal}</span>
      ) : (
        <span style={{ fontSize: "0.6875rem", fontWeight: 800, color: "#3f3f46" }}>#{rank}</span>
      )}
    </div>
  );
}

export function ListAnalysisSection({ allContacts, lists }: Props) {
  const f = useSectionFilter(allContacts, lists, "all");

  const listStats = useMemo(() => {
    return lists
      .map((l) => {
        const lc  = f.filtered.filter((c) => c.list_id === l.id);
        const la  = lc.filter((c) => c.answered === true).length;
        const lap = lc.filter((c) => c.appointment_set === true).length;
        return {
          list: l,
          total: lc.length,
          answered: la,
          appts: lap,
          answerRate: pct(la, lc.length),
          apptRate: pct(lap, lc.length),
        };
      })
      .filter((s) => s.total > 0)
      .sort((a, b) => b.apptRate - a.apptRate || b.answerRate - a.answerRate);
  }, [f.filtered, lists]);

  const listBarData = listStats.map((s) => ({
    name: `${s.list.owner_name ? s.list.owner_name[0] + "·" : ""}${s.list.name.slice(0, 20)}`,
    answerRate: s.answerRate,
    apptRate: s.apptRate,
  }));

  if (listStats.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
      {/* Section Header */}
        <div className="section-header-mobile" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", paddingBottom: "0.75rem", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: "var(--surface-200)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <TrendingUp size={13} color="#4ade80" />
          </div>
          <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#fafafa" }}>Listen-Analyse</span>
          <span style={{ fontSize: "0.75rem", color: "#52525b" }}>· {f.periodLabel} · {listStats.length} aktive Listen</span>
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

      <div className="grid-2-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        {/* Chart */}
        <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1.25rem 1.5rem" }}>
          <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#fafafa", marginBottom: "0.25rem" }}>Antwort- & Terminrate je Liste</div>
          <div style={{ fontSize: "0.6875rem", color: "#52525b", marginBottom: "0.875rem" }}>Präfix = Besitzer (K = Kevin, S = Simon)</div>
          <ListComparisonChart data={listBarData} />
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.875rem", paddingTop: "0.625rem", borderTop: "1px solid var(--border)" }}>
            {[{ label: "Antwortrate", color: METRIC_COLORS.answers }, { label: "Terminrate", color: METRIC_COLORS.appointments }].map((m) => (
              <div key={m.label} style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: m.color }} />
                <span style={{ fontSize: "0.6875rem", color: "#71717a" }}>{m.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Ranking table */}
        <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1.25rem 1.5rem" }}>
          <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#fafafa", marginBottom: "0.875rem" }}>Ranking</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            {listStats.slice(0, 8).map((s, i) => {
              const ownerStyle = s.list.owner_name ? OWNER_COLORS[s.list.owner_name] : null;
              return (
                <Link key={s.list.id} href={`/lists/${s.list.id}`} style={{ display: "flex", alignItems: "center", gap: "0.625rem", textDecoration: "none", padding: "0.625rem 0.75rem", borderRadius: 10, background: i === 0 ? "rgba(74,222,128,0.05)" : "rgba(255,255,255,0.02)", border: i === 0 ? "1px solid rgba(74,222,128,0.15)" : "1px solid transparent", transition: "background 0.1s, border-color 0.1s" }}>
                  <RankBadge rank={i + 1} />

                  {/* Name + owner */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "0.8125rem", color: "#e4e4e7", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>
                      {s.list.name}
                    </div>
                    {s.list.owner_name && ownerStyle && (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "0.2rem", marginTop: 2, padding: "0px 5px", borderRadius: 4, background: ownerStyle.bg, border: `1px solid ${ownerStyle.border}` }}>
                        <div style={{ width: 5, height: 5, borderRadius: "50%", background: ownerStyle.text }} />
                        <span style={{ fontSize: "0.5625rem", fontWeight: 700, color: ownerStyle.text, letterSpacing: "0.04em" }}>{s.list.owner_name.toUpperCase()}</span>
                      </div>
                    )}
                  </div>

                  {/* DMs count */}
                  <div style={{ flexShrink: 0, textAlign: "right" }}>
                    <div style={{ fontSize: "0.6875rem", color: "#52525b" }}>{s.total} DMs</div>
                  </div>

                  {/* Rates */}
                  <div style={{ display: "flex", gap: "0.25rem", flexShrink: 0 }}>
                    <div style={{ textAlign: "center", minWidth: 36, padding: "2px 6px", borderRadius: 5, background: `${METRIC_COLORS.answers}12`, border: `1px solid ${METRIC_COLORS.answers}22` }}>
                      <div style={{ fontSize: "0.625rem", color: "#52525b" }}>Antw</div>
                      <div style={{ fontSize: "0.75rem", fontWeight: 800, color: METRIC_COLORS.answers }}>{s.answerRate}%</div>
                    </div>
                    <div style={{ textAlign: "center", minWidth: 36, padding: "2px 6px", borderRadius: 5, background: `${METRIC_COLORS.appointments}12`, border: `1px solid ${METRIC_COLORS.appointments}22` }}>
                      <div style={{ fontSize: "0.625rem", color: "#52525b" }}>Term</div>
                      <div style={{ fontSize: "0.75rem", fontWeight: 800, color: METRIC_COLORS.appointments }}>{s.apptRate}%</div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
