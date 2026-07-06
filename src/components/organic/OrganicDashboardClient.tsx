"use client";

import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend,
  PieChart, Pie, Cell,
} from "recharts";
import type { OrganicPost, OrganicList } from "@/app/actions/organic";
import { ownerColor } from "@/lib/ownerColor";
import Link from "next/link";

// Wiederkehrende Chart-/Akzentfarben (alles Theme-Tokens):
const INSTA_COLOR  = "var(--organic-accent)";
const TIKTOK_COLOR = "var(--owner-4)";
const AXIS_TICK_FILL = "var(--text-subtle)";
const TOOLTIP_STYLE = {
  background: "var(--surface-100)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: "0.75rem",
  color: "var(--text-primary)",
};
const GRID_STROKE = "var(--border)";

type Props = {
  posts: OrganicPost[];
  lists: OrganicList[];
  listOwner: Record<string, string>;
  today: string;
  monday: string;
  sunday: string;
  avgInsta: number;
  avgTikTok: number;
  ctaRate: number;
  todayPosts: { Kevin: number; Simon: number };
  todayStories: { Kevin: number; Simon: number };
  weeklyHistory: { week: string; Kevin: number; Simon: number }[];
  personalMode?: boolean;
  personalOwnerName?: string;
  personalWeeklyHistory?: { week: string; count: number }[];
};

const CONTENT_TYPE_LABELS: Record<string, string> = {
  educational:  "Educational",
  motivational: "Motivational",
  entertaining: "Entertaining",
  bts:          "Behind-the-Scenes",
  other:        "Sonstiges",
};

const CONTENT_TYPE_COLORS: Record<string, string> = {
  educational:  "var(--owner-1)",
  motivational: "var(--owner-5)",
  entertaining: "var(--organic-accent)",
  bts:          "var(--owner-3)",
  other:        "var(--text-subtle)",
};

function avg(nums: number[]) {
  if (!nums.length) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

type Period = "week" | "month" | "year" | "all" | "custom";

function usePeriodFilter(posts: OrganicPost[], today: string) {
  const [period, setPeriod] = useState<Period>("all");
  const [from, setFrom] = useState("");
  const [to, setTo]     = useState("");

  function getStart(): string | null {
    if (period === "week") {
      const d = new Date(today);
      const day = d.getDay();
      d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    if (period === "month") return today.slice(0, 7) + "-01";
    if (period === "year")  return today.slice(0, 4) + "-01-01";
    if (period === "custom") return from || null;
    return null;
  }

  const start = getStart();
  const end   = period === "custom" ? (to || today) : today;

  const filtered = posts.filter((p) => {
    if (start && p.posted_at < start) return false;
    if (p.posted_at > end) return false;
    return true;
  });

  return { filtered, period, setPeriod, from, setFrom, to, setTo };
}

function FilterBar({
  period, setPeriod, from, setFrom, to, setTo,
}: {
  period: Period;
  setPeriod: (p: Period) => void;
  from: string; setFrom: (s: string) => void;
  to: string;   setTo:   (s: string) => void;
}) {
  const btns: { label: string; value: Period }[] = [
    { label: "Diese Woche", value: "week"   },
    { label: "Monat",       value: "month"  },
    { label: "Jahr",        value: "year"   },
    { label: "Gesamt",      value: "all"    },
    { label: "Custom",      value: "custom" },
  ];
  return (
    <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap", alignItems: "center" }}>
      {btns.map((b) => (
        <button key={b.value} type="button" onClick={() => setPeriod(b.value)}
          style={{
            padding: "0.2rem 0.625rem",
            borderRadius: 99,
            border: `1px solid ${period === b.value ? "var(--organic-accent)" : "var(--border)"}`,
            background: period === b.value ? "var(--organic-accent-bg)" : "transparent",
            color: period === b.value ? "var(--organic-accent)" : "var(--text-subtle)",
            fontSize: "0.75rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {b.label}
        </button>
      ))}
      {period === "custom" && (
        <>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: 6, padding: "0.2rem 0.375rem", fontSize: "0.75rem", color: "var(--text-primary)", outline: "none" }} />
          <span style={{ color: "var(--text-subtle)", fontSize: "0.75rem" }}>–</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: 6, padding: "0.2rem 0.375rem", fontSize: "0.75rem", color: "var(--text-primary)", outline: "none" }} />
        </>
      )}
    </div>
  );
}

function SectionHeader({ title, icon, filter }: { title: string; icon?: React.ReactNode; filter?: React.ReactNode }) {
  return (
    <div className="section-header-mobile" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem", gap: "0.75rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        {icon}
        <span style={{ fontWeight: 700, fontSize: "0.9375rem" }}>{title}</span>
      </div>
      {filter}
    </div>
  );
}

// ── Overall section ────────────────────────────────────────────────────────
function OverallSection({ posts, today }: { posts: OrganicPost[]; today: string }) {
  const { filtered, period, setPeriod, from, setFrom, to, setTo } = usePeriodFilter(posts, today);

  const instaData  = filtered.filter((p) => p.insta_impressions  != null).map((p) => p.insta_impressions!);
  const tiktokData = filtered.filter((p) => p.tiktok_impressions != null).map((p) => p.tiktok_impressions!);
  const avgI  = avg(instaData);
  const avgT  = avg(tiktokData);
  const ctaR  = filtered.length ? Math.round((filtered.filter((p) => p.generated_cta).length / filtered.length) * 100) : 0;
  const strR  = filtered.length ? Math.round((filtered.filter((p) => p.stories_done).length  / filtered.length) * 100) : 0;
  const totalImp = filtered.reduce((s, p) => s + (p.insta_impressions ?? 0) + (p.tiktok_impressions ?? 0), 0);

  // Content type breakdown for pie
  const typeGroups: Record<string, number> = {};
  for (const p of filtered) {
    if (p.content_type) typeGroups[p.content_type] = (typeGroups[p.content_type] ?? 0) + 1;
  }
  const pieData = Object.entries(typeGroups).map(([type, count]) => ({
    name: CONTENT_TYPE_LABELS[type] ?? type,
    value: count,
    color: CONTENT_TYPE_COLORS[type] ?? "var(--text-subtle)",
  }));

  // Daily chart (last 14 days)
  const last14: { date: string; insta: number; tiktok: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dayPosts = filtered.filter((p) => p.posted_at === ds);
    last14.push({
      date: ds.slice(5),
      insta: dayPosts.reduce((s, p) => s + (p.insta_impressions ?? 0), 0),
      tiktok: dayPosts.reduce((s, p) => s + (p.tiktok_impressions ?? 0), 0),
    });
  }

  return (
    <div style={{ background: "var(--surface-50)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.25rem", marginBottom: "1.5rem" }}>
      <SectionHeader
        title="Gesamt-Performance"
        icon={<span style={{ color: "var(--organic-accent)" }}>📊</span>}
        filter={<FilterBar period={period} setPeriod={setPeriod} from={from} setFrom={setFrom} to={to} setTo={setTo} />}
      />
      <div className="grid-4-stat" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.875rem", marginBottom: "1.25rem" }}>
        <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.875rem 1rem" }}>
          <div style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-subtle)", marginBottom: "0.375rem" }}>Posts</div>
          <div style={{ fontSize: "1.75rem", fontWeight: 800, color: "var(--organic-accent)", letterSpacing: "-0.04em" }}>{filtered.length}</div>
        </div>
        <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.875rem 1rem" }}>
          <div style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-subtle)", marginBottom: "0.375rem" }}>Ø Insta</div>
          <div style={{ fontSize: "1.75rem", fontWeight: 800, color: INSTA_COLOR, letterSpacing: "-0.04em" }}>{avgI.toLocaleString()}</div>
        </div>
        <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.875rem 1rem" }}>
          <div style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-subtle)", marginBottom: "0.375rem" }}>Ø TikTok</div>
          <div style={{ fontSize: "1.75rem", fontWeight: 800, color: TIKTOK_COLOR, letterSpacing: "-0.04em" }}>{avgT.toLocaleString()}</div>
        </div>
        <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.875rem 1rem" }}>
          <div style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-subtle)", marginBottom: "0.375rem" }}>CTA-Rate</div>
          <div style={{ fontSize: "1.75rem", fontWeight: 800, color: "var(--color-success-text)", letterSpacing: "-0.04em" }}>{ctaR}%</div>
        </div>
      </div>

      <div className="chart-grid-2" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1rem" }}>
        {/* Line chart */}
        <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: 10, padding: "1rem" }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-subtle)", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Impressionen letzte 14 Tage</div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={last14}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="date" tick={{ fill: AXIS_TICK_FILL, fontSize: 10 }} />
              <YAxis tick={{ fill: AXIS_TICK_FILL, fontSize: 10 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="insta"  stroke={INSTA_COLOR} strokeWidth={2} dot={false} name="Instagram" />
              <Line type="monotone" dataKey="tiktok" stroke={TIKTOK_COLOR} strokeWidth={2} dot={false} name="TikTok" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {/* Pie chart */}
        <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: 10, padding: "1rem" }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-subtle)", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Content-Typen</div>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={120}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={30} outerRadius={55} dataKey="value">
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v} Posts`]} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-subtle)", fontSize: "0.8125rem" }}>Keine Daten</div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", marginTop: "0.5rem" }}>
            {pieData.map((d) => (
              <span key={d.name} style={{ fontSize: "0.6875rem", padding: "0.1rem 0.4rem", borderRadius: 99, background: `color-mix(in srgb, ${d.color} 13%, transparent)`, color: d.color, fontWeight: 600 }}>
                {d.name} {d.value}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "var(--text-subtle)", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <span>Stories-Quote: <strong style={{ color: "var(--color-warning-text)" }}>{strR}%</strong></span>
        <span>Impressionen gesamt: <strong style={{ color: "var(--text-secondary)" }}>{totalImp.toLocaleString()}</strong></span>
      </div>
    </div>
  );
}

// ── Kevin vs Simon section ─────────────────────────────────────────────────
function PersonSection({ posts, lists, today }: { posts: OrganicPost[]; lists: OrganicList[]; listOwner: Record<string, string>; today: string }) {
  const { filtered, period, setPeriod, from, setFrom, to, setTo } = usePeriodFilter(posts, today);

  type Owner = "Kevin" | "Simon";
  const owners: Owner[] = ["Kevin", "Simon"];

  function personStats(owner: Owner) {
    const ownerListIds = new Set(lists.filter((l) => l.owner_name === owner).map((l) => l.id));
    const cc = filtered.filter((p) => ownerListIds.has(p.list_id));
    const instaData  = cc.filter((p) => p.insta_impressions  != null).map((p) => p.insta_impressions!);
    const tiktokData = cc.filter((p) => p.tiktok_impressions != null).map((p) => p.tiktok_impressions!);
    return {
      total: cc.length,
      avgInsta:  avg(instaData),
      avgTikTok: avg(tiktokData),
      ctaRate: cc.length ? Math.round((cc.filter((p) => p.generated_cta).length / cc.length) * 100) : 0,
      storiesRate: cc.length ? Math.round((cc.filter((p) => p.stories_done).length / cc.length) * 100) : 0,
    };
  }

  const COLORS: Record<Owner, string> = { Kevin: ownerColor("Kevin").fg, Simon: ownerColor("Simon").fg };

  const chartData = owners.map((o) => {
    const s = personStats(o);
    return { name: o, insta: s.avgInsta, tiktok: s.avgTikTok };
  });

  return (
    <div style={{ background: "var(--surface-50)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.25rem", marginBottom: "1.5rem" }}>
      <SectionHeader
        title="Kevin vs Simon"
        icon={<span>⚔️</span>}
        filter={<FilterBar period={period} setPeriod={setPeriod} from={from} setFrom={setFrom} to={to} setTo={setTo} />}
      />
      <div className="grid-2-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
        {owners.map((owner) => {
          const s = personStats(owner);
          const c = COLORS[owner];
          return (
            <div key={owner} style={{ background: "var(--surface-100)", border: `1px solid color-mix(in srgb, ${c} 20%, transparent)`, borderRadius: 10, padding: "1rem" }}>
              <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: c, marginBottom: "0.75rem" }}>{owner}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                {[
                  { label: "Posts", value: s.total, color: c },
                  { label: "Ø Insta", value: s.avgInsta.toLocaleString(), color: INSTA_COLOR },
                  { label: "Ø TikTok", value: s.avgTikTok.toLocaleString(), color: TIKTOK_COLOR },
                  { label: "CTA-Rate", value: `${s.ctaRate}%`, color: "var(--color-success-text)" },
                  { label: "Stories", value: `${s.storiesRate}%`, color: "var(--color-warning-text)" },
                ].map((stat) => (
                  <div key={stat.label} style={{ background: "var(--surface-0)", borderRadius: 8, padding: "0.5rem 0.625rem" }}>
                    <div style={{ fontSize: "0.6875rem", color: "var(--text-subtle)", marginBottom: "0.125rem" }}>{stat.label}</div>
                    <div style={{ fontSize: "1.125rem", fontWeight: 800, color: stat.color }}>{stat.value}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: 10, padding: "1rem" }}>
        <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-subtle)", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Ø Impressionen Vergleich</div>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={chartData} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
            <XAxis dataKey="name" tick={{ fill: AXIS_TICK_FILL, fontSize: 11 }} />
            <YAxis tick={{ fill: AXIS_TICK_FILL, fontSize: 11 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Bar dataKey="insta"  fill={INSTA_COLOR} radius={[3,3,0,0]} name="Ø Instagram" />
            <Bar dataKey="tiktok" fill={TIKTOK_COLOR} radius={[3,3,0,0]} name="Ø TikTok" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── List Analysis section ──────────────────────────────────────────────────
function ListAnalysisSection({
  posts,
  lists,
  today,
  personalMode = false,
}: {
  posts: OrganicPost[];
  lists: OrganicList[];
  listOwner: Record<string, string>;
  today: string;
  personalMode?: boolean;
}) {
  const { filtered, period, setPeriod, from, setFrom, to, setTo } = usePeriodFilter(posts, today);

  const listStats = lists.map((list) => {
    const lp = filtered.filter((p) => p.list_id === list.id);
    const instaData  = lp.filter((p) => p.insta_impressions  != null).map((p) => p.insta_impressions!);
    const tiktokData = lp.filter((p) => p.tiktok_impressions != null).map((p) => p.tiktok_impressions!);
    return {
      list,
      count: lp.length,
      avgInsta:  avg(instaData),
      avgTikTok: avg(tiktokData),
      ctaRate: lp.length ? Math.round((lp.filter((p) => p.generated_cta).length / lp.length) * 100) : 0,
      totalImp: lp.reduce((s, p) => s + (p.insta_impressions ?? 0) + (p.tiktok_impressions ?? 0), 0),
    };
  }).sort((a, b) => b.totalImp - a.totalImp);

  const barData = listStats.map((s) => ({
    name: `${!personalMode && s.list.owner_name ? s.list.owner_name[0] + "·" : ""}${s.list.name.slice(0, 16)}`,
    insta:  s.avgInsta,
    tiktok: s.avgTikTok,
  }));

  return (
    <div style={{ background: "var(--surface-50)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.25rem", marginBottom: "1.5rem" }}>
      <SectionHeader
        title="Listen-Analyse"
        icon={<span>📋</span>}
        filter={<FilterBar period={period} setPeriod={setPeriod} from={from} setFrom={setFrom} to={to} setTo={setTo} />}
      />
      {listStats.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "var(--text-subtle)", textAlign: "center", padding: "1.5rem" }}>Noch keine Posts in diesem Zeitraum.</p>
      ) : (
        <>
          <div style={{ marginBottom: "1rem" }}>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis dataKey="name" tick={{ fill: AXIS_TICK_FILL, fontSize: 10 }} />
                <YAxis tick={{ fill: AXIS_TICK_FILL, fontSize: 10 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="insta"  fill={INSTA_COLOR} radius={[3,3,0,0]} name="Ø Insta" />
                <Bar dataKey="tiktok" fill={TIKTOK_COLOR} radius={[3,3,0,0]} name="Ø TikTok" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {listStats.map((s, i) => {
              const oc = s.list.owner_name
                ? ownerColor(s.list.owner_name)
                : { fg: "var(--organic-accent)", bg: "var(--organic-accent-bg)" };
              return (
                <Link key={s.list.id} href={`/organic/${s.list.id}`} style={{ textDecoration: "none" }}>
                  <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.625rem 0.875rem", display: "flex", alignItems: "center", gap: "0.75rem", transition: "border-color 0.15s" }}>
                    <span style={{ fontSize: "0.75rem", fontWeight: 800, color: i === 0 ? "var(--color-warning-text)" : "var(--text-subtle)", width: 20 }}>#{i + 1}</span>
                    {!personalMode && (
                      <span style={{ fontSize: "0.6875rem", fontWeight: 700, color: oc.fg, background: oc.bg, borderRadius: 99, padding: "0.1rem 0.4rem", flexShrink: 0 }}>{s.list.owner_name ?? "?"}</span>
                    )}
                    <span style={{ flex: 1, fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.list.name}</span>
                    <div style={{ display: "flex", gap: "0.625rem", fontSize: "0.75rem", color: "var(--text-subtle)", flexShrink: 0 }}>
                      <span>{s.count} Posts</span>
                      <span style={{ color: INSTA_COLOR }}>📸 Ø {s.avgInsta.toLocaleString()}</span>
                      <span style={{ color: TIKTOK_COLOR }}>🎵 Ø {s.avgTikTok.toLocaleString()}</span>
                      {s.ctaRate > 0 && <span style={{ color: "var(--color-success-text)" }}>CTA {s.ctaRate}%</span>}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Historical weekly chart ────────────────────────────────────────────────
function WeeklyHistorySection({ weeklyHistory }: { weeklyHistory: Props["weeklyHistory"] }) {
  return (
    <div style={{ background: "var(--surface-50)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.25rem", marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
        <span>📈</span>
        <span style={{ fontWeight: 700, fontSize: "0.9375rem" }}>Historisches Wochenduell</span>
        <span style={{ marginLeft: "auto", fontSize: "0.6875rem", color: "var(--text-subtle)" }}>letzte 10 Wochen · Videos</span>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={weeklyHistory}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="week" tick={{ fill: AXIS_TICK_FILL, fontSize: 10 }} />
          <YAxis tick={{ fill: AXIS_TICK_FILL, fontSize: 10 }} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: "0.75rem" }} />
          <Bar dataKey="Kevin" fill={ownerColor("Kevin").fg} radius={[3,3,0,0]} />
          <Bar dataKey="Simon" fill={ownerColor("Simon").fg} radius={[3,3,0,0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PersonalWeeklyHistorySection({
  weeklyHistory,
  ownerName,
}: {
  weeklyHistory: { week: string; count: number }[];
  ownerName: string;
}) {
  const max = Math.max(7, ...weeklyHistory.map((w) => w.count), 1);
  return (
    <div style={{ background: "var(--surface-50)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.25rem", marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
        <span>📈</span>
        <span style={{ fontWeight: 700, fontSize: "0.9375rem" }}>Dein Wochenverlauf</span>
        <span style={{ marginLeft: "auto", fontSize: "0.6875rem", color: "var(--text-subtle)" }}>{ownerName} · letzte 10 Wochen</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${weeklyHistory.length}, minmax(0, 1fr))`, gap: "0.5rem", alignItems: "end", minHeight: 170 }}>
        {weeklyHistory.map((week) => {
          const height = Math.max(8, (week.count / max) * 130);
          const reached = week.count >= 7;
          return (
            <div key={week.week} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.375rem" }}>
              <div style={{ fontSize: "0.6875rem", color: reached ? "var(--color-success-text)" : "var(--color-warning-text)", fontWeight: 800 }}>{week.count}</div>
              <div style={{ width: "100%", maxWidth: 28, height, borderRadius: "6px 6px 2px 2px", background: reached ? "var(--color-success-text)" : "var(--color-warning-text)", boxShadow: reached ? "0 0 10px color-mix(in srgb, var(--color-success-text) 25%, transparent)" : "0 0 10px color-mix(in srgb, var(--color-warning-text) 25%, transparent)" }} />
              <div style={{ fontSize: "0.625rem", color: "var(--text-subtle)", whiteSpace: "nowrap" }}>{week.week}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────
export function OrganicDashboardClient({
  posts,
  lists,
  listOwner,
  today,
  weeklyHistory,
  personalMode = false,
  personalOwnerName = "Du",
  personalWeeklyHistory = [],
}: Props) {
  return (
    <>
      <OverallSection posts={posts} today={today} />
      {!personalMode && <PersonSection posts={posts} lists={lists} listOwner={listOwner} today={today} />}
      {personalMode ? (
        <PersonalWeeklyHistorySection weeklyHistory={personalWeeklyHistory} ownerName={personalOwnerName} />
      ) : (
        <WeeklyHistorySection weeklyHistory={weeklyHistory} />
      )}
      <ListAnalysisSection posts={posts} lists={lists} listOwner={listOwner} today={today} personalMode={personalMode} />
    </>
  );
}
