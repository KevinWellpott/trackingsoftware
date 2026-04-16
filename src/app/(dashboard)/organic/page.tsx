import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/workspace";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle,
  Film,
  Trophy,
  Zap,
} from "lucide-react";
import { generateOrganicInsights } from "@/lib/organic-insights";
import type { OrganicPost, OrganicList } from "@/app/actions/organic";
import { OrganicDashboardClient } from "@/components/organic/OrganicDashboardClient";

function localDateISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function weekStart(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  dt.setDate(dt.getDate() + (day === 0 ? -6 : 1 - day));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

const OWNERS = ["Kevin", "Simon"] as const;
type Owner = (typeof OWNERS)[number];
const DAILY_VIDEO_GOAL = 1;
const WEEKLY_VIDEO_GOAL = 7;

const OWNER_STYLE: Record<Owner, { color: string; bg: string; border: string; glow: string }> = {
  Kevin: { color: "#818cf8", bg: "rgba(99,102,241,0.08)",  border: "rgba(99,102,241,0.25)", glow: "rgba(99,102,241,0.4)" },
  Simon: { color: "#a78bfa", bg: "rgba(139,92,246,0.08)",  border: "rgba(139,92,246,0.25)", glow: "rgba(139,92,246,0.4)" },
};

function avg(nums: number[]) {
  if (!nums.length) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.875rem 1rem" }}>
      <div style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-subtle)", marginBottom: "0.375rem" }}>{label}</div>
      <div style={{ fontSize: "1.75rem", fontWeight: 800, color: color ?? "var(--text-primary)", letterSpacing: "-0.04em", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>{sub}</div>}
    </div>
  );
}

function InsightCard({ level, title, body }: { level: string; title: string; body: string }) {
  const cfg: Record<string, { icon: React.ReactNode; color: string; bg: string; border: string }> = {
    success: { icon: <CheckCircle size={14} />, color: "#34d399", bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.2)" },
    warning: { icon: <AlertCircle size={14} />,  color: "#f59e0b", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.2)" },
    danger:  { icon: <AlertCircle size={14} />,  color: "#f87171", bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.2)" },
    tip:     { icon: <Zap size={14} />,           color: "#818cf8", bg: "rgba(99,102,241,0.08)", border: "rgba(99,102,241,0.2)" },
  };
  const c = cfg[level] ?? cfg.tip;
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: "0.75rem 1rem", display: "flex", gap: "0.625rem", alignItems: "flex-start" }}>
      <span style={{ color: c.color, marginTop: 2, flexShrink: 0 }}>{c.icon}</span>
      <div>
        <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: c.color, marginBottom: "0.25rem" }}>{title}</div>
        <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>{body}</div>
      </div>
    </div>
  );
}

export default async function OrganicPage() {
  const m = await getMembership();
  if (!m) return null;

  const supabase = await createClient();
  const today    = localDateISO();
  const monday   = weekStart(today);
  const sunday   = addDays(monday, 6);

  const { data: rawLists } = await supabase
    .from("organic_lists")
    .select("*")
    .eq("workspace_id", m.workspace_id)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  const { data: rawPosts } = await supabase
    .from("organic_posts")
    .select("*")
    .eq("workspace_id", m.workspace_id)
    .order("posted_at", { ascending: false });

  const lists = (rawLists ?? []) as OrganicList[];
  const posts = (rawPosts ?? []) as OrganicPost[];

  // List ID → owner lookup
  const listOwner: Record<string, string> = {};
  for (const l of lists) { if (l.owner_name) listOwner[l.id] = l.owner_name; }

  // ── Weekly duel (Mo–So)
  const kevinWeek = posts.filter((p) => p.posted_at >= monday && p.posted_at <= sunday && listOwner[p.list_id] === "Kevin").length;
  const simonWeek = posts.filter((p) => p.posted_at >= monday && p.posted_at <= sunday && listOwner[p.list_id] === "Simon").length;

  const todayPosts = {
    Kevin: posts.filter((p) => p.posted_at === today && listOwner[p.list_id] === "Kevin").length,
    Simon: posts.filter((p) => p.posted_at === today && listOwner[p.list_id] === "Simon").length,
  };

  const todayStories = {
    Kevin: posts.filter((p) => p.posted_at === today && p.stories_done && listOwner[p.list_id] === "Kevin").length,
    Simon: posts.filter((p) => p.posted_at === today && p.stories_done && listOwner[p.list_id] === "Simon").length,
  };

  const leader: Owner | null =
    kevinWeek > simonWeek ? "Kevin" : simonWeek > kevinWeek ? "Simon" : null;
  const loser: Owner | null =
    kevinWeek < simonWeek ? "Kevin" : simonWeek < kevinWeek ? "Simon" : null;

  // ── Overall stats
  const instaAll  = posts.filter((p) => p.insta_impressions  != null).map((p) => p.insta_impressions!);
  const tiktokAll = posts.filter((p) => p.tiktok_impressions != null).map((p) => p.tiktok_impressions!);
  const avgInsta  = avg(instaAll);
  const avgTikTok = avg(tiktokAll);
  const ctaRate   = posts.length ? Math.round((posts.filter((p) => p.generated_cta).length / posts.length) * 100) : 0;

  // ── Insights
  const insights = generateOrganicInsights(posts);

  // ── Historical weekly data (last 10 weeks)
  const weeklyHistory: { week: string; Kevin: number; Simon: number }[] = [];
  for (let i = 9; i >= 0; i--) {
    const wMon = weekStart(addDays(today, -i * 7));
    const wSun = addDays(wMon, 6);
    const label = `KW ${wMon.slice(5, 10)}`;
    weeklyHistory.push({
      week: label,
      Kevin: posts.filter((p) => p.posted_at >= wMon && p.posted_at <= wSun && listOwner[p.list_id] === "Kevin").length,
      Simon: posts.filter((p) => p.posted_at >= wMon && p.posted_at <= wSun && listOwner[p.list_id] === "Simon").length,
    });
  }

  const sectionData = {
    posts,
    lists,
    listOwner,
    today,
    monday,
    sunday,
    avgInsta,
    avgTikTok,
    ctaRate,
    todayPosts,
    todayStories,
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      {/* ── Page Header */}
      <div style={{ marginBottom: "1.75rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
            <Film size={18} color="#e879f9" />
            <h1 style={{ fontSize: "1.375rem", fontWeight: 800, margin: 0, letterSpacing: "-0.03em" }}>
              Organic Social Media
            </h1>
          </div>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", margin: 0 }}>
            Instagram · TikTok · Hook-Tracking · Content-Analysen
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--text-subtle)", background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: 6, padding: "0.25rem 0.625rem" }}>
            {lists.length} Content-Serien · {posts.length} Posts total
          </span>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          WEEKLY DUEL
      ══════════════════════════════════════════════════════════ */}
      <div style={{ background: "linear-gradient(135deg, rgba(232,121,249,0.06) 0%, rgba(99,102,241,0.06) 100%)", border: "1px solid rgba(232,121,249,0.15)", borderRadius: 16, padding: "1.5rem", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1.25rem" }}>
          <Trophy size={16} color="#e879f9" />
          <span style={{ fontWeight: 800, fontSize: "0.9375rem", color: "#e879f9" }}>Wochenduell — Videos</span>
          <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--text-subtle)" }}>Ziel: {WEEKLY_VIDEO_GOAL}/Woche · {monday} → {sunday} · Reset jeden Montag</span>
        </div>

        <div className="duel-grid" style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "1.5rem", alignItems: "center" }}>
          {/* Kevin */}
          <DuelPanel owner="Kevin" count={kevinWeek} leader={leader} loser={loser} goal={WEEKLY_VIDEO_GOAL} todayCount={todayPosts.Kevin} storiesDone={todayStories.Kevin} />
          {/* VS */}
          <div className="duel-vs" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem" }}>
            <div style={{ width: 1, height: 24, background: "linear-gradient(to bottom, transparent, rgba(232,121,249,0.35))" }} />
            <div style={{ fontSize: "0.6875rem", fontWeight: 800, color: "#3f3f46", letterSpacing: "0.1em", padding: "3px 8px", border: "1px solid rgba(232,121,249,0.15)", borderRadius: 99, background: "rgba(232,121,249,0.05)" }}>VS</div>
            <div style={{ width: 1, height: 24, background: "linear-gradient(to bottom, rgba(232,121,249,0.35), transparent)" }} />
          </div>
          {/* Simon */}
          <DuelPanel owner="Simon" count={simonWeek} leader={leader} loser={loser} goal={WEEKLY_VIDEO_GOAL} todayCount={todayPosts.Simon} storiesDone={todayStories.Simon} />
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          CLIENT-SIDE SECTIONS (filters + charts)
      ══════════════════════════════════════════════════════════ */}
      <OrganicDashboardClient
        {...sectionData}
        weeklyHistory={weeklyHistory}
      />

      {/* ══════════════════════════════════════════════════════════
          AI INSIGHTS
      ══════════════════════════════════════════════════════════ */}
      <div style={{ background: "var(--surface-50)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.25rem", marginTop: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
          <Zap size={15} color="#818cf8" />
          <span style={{ fontWeight: 700, fontSize: "0.9375rem" }}>Automatische Insights</span>
          <span style={{ marginLeft: "auto", fontSize: "0.6875rem", color: "var(--text-subtle)", background: "var(--surface-150)", border: "1px solid var(--border)", borderRadius: 99, padding: "0.1rem 0.5rem" }}>regelbasiert</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
          {insights.map((ins, i) => (
            <InsightCard key={i} level={ins.level} title={ins.title} body={ins.body} />
          ))}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          CONTENT SERIES OVERVIEW
      ══════════════════════════════════════════════════════════ */}
      <div style={{ background: "var(--surface-50)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.25rem", marginTop: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
          <Film size={15} color="var(--text-secondary)" />
          <span style={{ fontWeight: 700, fontSize: "0.9375rem" }}>Content-Serien</span>
        </div>
        {lists.length === 0 ? (
          <p style={{ fontSize: "0.875rem", color: "var(--text-subtle)", textAlign: "center", padding: "1rem" }}>
            Noch keine Content-Serien. Erstelle eine in der Seitenleiste.
          </p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.75rem" }}>
            {lists.map((list) => {
              const lPosts = posts.filter((p) => p.list_id === list.id);
              const lInsta  = avg(lPosts.filter((p) => p.insta_impressions  != null).map((p) => p.insta_impressions!));
              const lTikTok = avg(lPosts.filter((p) => p.tiktok_impressions != null).map((p) => p.tiktok_impressions!));
              const ownerColor = list.owner_name === "Kevin" ? "#818cf8" : "#a78bfa";
              return (
                <Link key={list.id} href={`/organic/${list.id}`} style={{ textDecoration: "none" }}>
                  <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.875rem", transition: "border-color 0.15s, background 0.15s" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = ownerColor; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                      <span style={{ fontSize: "0.6875rem", fontWeight: 700, color: ownerColor, background: ownerColor + "22", borderRadius: 99, padding: "0.1rem 0.4rem" }}>{list.owner_name ?? "?"}</span>
                      <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{list.name}</span>
                    </div>
                    {list.description && (
                      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 0.5rem", lineHeight: 1.4 }}>{list.description}</p>
                    )}
                    <div style={{ display: "flex", gap: "0.625rem", fontSize: "0.75rem", color: "var(--text-subtle)" }}>
                      <span>{lPosts.length} Posts</span>
                      {lInsta  > 0 && <span>📸 Ø {lInsta.toLocaleString()}</span>}
                      {lTikTok > 0 && <span>🎵 Ø {lTikTok.toLocaleString()}</span>}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Duel panel (server-side rendered) ─────────────────────────────────────
function DuelPanel({
  owner,
  count,
  leader,
  loser,
  goal,
  todayCount,
  storiesDone,
}: {
  owner: Owner;
  count: number;
  leader: Owner | null;
  loser: Owner | null;
  goal: number;
  todayCount: number;
  storiesDone: number;
}) {
  const s = OWNER_STYLE[owner];
  const isWinner = leader === owner;
  const isLoser  = loser  === owner;
  const progress = Math.min((count / goal) * 100, 100);
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem", marginBottom: "0.875rem" }}>
        <div style={{ width: 38, height: 38, borderRadius: "50%", background: `${s.color}22`, border: `2px solid ${isWinner ? s.color : s.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.9375rem", fontWeight: 800, color: s.color, boxShadow: isWinner ? `0 0 14px ${s.glow}` : "none" }}>
          {owner[0]}
        </div>
        <div>
          <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: isWinner ? s.color : "#e4e4e7" }}>{owner} {isWinner ? "👑" : ""}</div>
          <div style={{ fontSize: "0.75rem", color: "#71717a" }}>{isLoser ? "zahlt das Essen 🍽️" : isWinner ? "führt diese Woche" : "im Rennen"}</div>
        </div>
      </div>
      <div style={{ fontSize: "3.25rem", fontWeight: 800, letterSpacing: "-0.04em", color: isWinner ? s.color : "#71717a", lineHeight: 1, marginBottom: "0.5rem", textShadow: isWinner ? `0 0 28px ${s.glow}` : "none" }}>
        {count}<span style={{ fontSize: "1.125rem", fontWeight: 500, color: "#3f3f46", marginLeft: 3 }}>/{goal}</span>
      </div>
      <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 99, height: 6, overflow: "hidden", marginBottom: "0.625rem" }}>
        <div style={{ height: "100%", borderRadius: 99, width: `${progress}%`, background: isWinner ? `linear-gradient(90deg, ${s.color}, ${s.color}bb)` : `${s.color}44`, boxShadow: isWinner ? `0 0 8px ${s.glow}` : "none" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: "0.875rem", fontSize: "0.75rem", color: "var(--text-subtle)" }}>
        <span>🎬 Heute: <strong style={{ color: todayCount >= DAILY_VIDEO_GOAL ? "#34d399" : "var(--text-secondary)" }}>{todayCount}/{DAILY_VIDEO_GOAL}</strong></span>
        <span>📱 Stories: <strong style={{ color: storiesDone > 0 ? "#34d399" : "var(--text-subtle)" }}>{storiesDone > 0 ? "✓" : "—"}</strong></span>
      </div>
    </div>
  );
}
