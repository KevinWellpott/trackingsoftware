import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { getAccessContext } from "@/lib/access";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle,
  Film,
  Trophy,
  Zap,
} from "lucide-react";
import { generateOrganicInsights } from "@/lib/organic-insights";
import { ownerColor } from "@/lib/ownerColor";
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
const PERSONAL_COLOR = "var(--color-warning-text)";
type PersonalWeekPoint = { week: string; count: number };

function ownerStyle(owner: Owner): { color: string; bg: string; border: string } {
  const oc = ownerColor(owner);
  return { color: oc.fg, bg: oc.bg, border: `color-mix(in srgb, ${oc.fg} 25%, transparent)` };
}

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
    success: { icon: <CheckCircle size={14} />, color: "var(--color-success-text)", bg: "var(--color-success-bg)", border: "var(--color-success-border)" },
    warning: { icon: <AlertCircle size={14} />,  color: "var(--color-warning-text)", bg: "var(--color-warning-bg)", border: "var(--color-warning-border)" },
    danger:  { icon: <AlertCircle size={14} />,  color: "var(--color-error-text)", bg: "var(--color-error-bg)", border: "var(--color-error-border)" },
    tip:     { icon: <Zap size={14} />,           color: "var(--brand-500)", bg: "var(--color-info-bg)", border: "var(--color-info-border)" },
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

function PersonalVideoWeekPanel({
  name,
  count,
  todayCount,
  storiesDone,
  goal,
  monday,
  sunday,
}: {
  name: string;
  count: number;
  todayCount: number;
  storiesDone: number;
  goal: number;
  monday: string;
  sunday: string;
}) {
  const progress = Math.min((count / goal) * 100, 100);
  return (
    <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)", padding: "1.5rem", marginBottom: "1.5rem", position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem", position: "relative" }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--color-warning-text)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--surface-0)", fontWeight: 900, boxShadow: "var(--shadow-sm)" }}>
          {name[0]?.toUpperCase() ?? "D"}
        </div>
        <div>
          <div style={{ fontWeight: 800, fontSize: "0.9375rem", color: "var(--text-primary)" }}>Deine Organic-Woche</div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>{name} · {monday} → {sunday}</div>
        </div>
        <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--text-subtle)" }}>Ziel: {goal}/Woche</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(160px, 240px) 1fr", gap: "1.5rem", alignItems: "center", position: "relative" }}>
        <div>
          <div style={{ fontSize: "3.25rem", fontWeight: 900, letterSpacing: "-0.05em", color: PERSONAL_COLOR, lineHeight: 1 }}>
            {count}<span style={{ fontSize: "1.125rem", fontWeight: 500, color: "var(--text-subtle)", marginLeft: 3 }}>/{goal}</span>
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-subtle)", marginTop: "0.5rem" }}>
            {Math.round(progress)}% erreicht · noch {Math.max(0, goal - count)} Posts bis zum Wochenziel
          </div>
        </div>
        <div>
          <div style={{ background: "var(--surface-200)", borderRadius: 99, height: 12, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 99, width: `${progress}%`, background: "var(--color-warning-text)", transition: "width 0.4s ease" }} />
          </div>
          <div style={{ display: "flex", gap: "1rem", marginTop: "0.75rem", fontSize: "0.75rem", color: "var(--text-subtle)" }}>
            <span>Heute: <strong style={{ color: todayCount >= DAILY_VIDEO_GOAL ? "var(--color-success-text)" : PERSONAL_COLOR }}>{todayCount}/{DAILY_VIDEO_GOAL}</strong></span>
            <span>Stories: <strong style={{ color: storiesDone > 0 ? "var(--color-success-text)" : "var(--text-subtle)" }}>{storiesDone > 0 ? "erledigt" : "offen"}</strong></span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function OrganicPage() {
  const access = await getAccessContext();
  if (!access) return null;

  const supabase = await createClient();
  const today    = localDateISO();
  const monday   = weekStart(today);
  const sunday   = addDays(monday, 6);

  let listsQuery = supabase
    .from("organic_lists")
    .select("*")
    .eq("workspace_id", access.workspace_id)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (access.effective_user_id) {
    listsQuery = listsQuery.eq("created_by_user_id", access.effective_user_id);
  }
  const { data: rawLists } = await listsQuery;

  const visibleListIds = (rawLists ?? []).map((l) => l.id);
  const rawPosts = await fetchAllRows((from, to) => {
    let postsQuery = supabase
      .from("organic_posts")
      .select("*")
      .eq("workspace_id", access.workspace_id)
      .order("posted_at", { ascending: false });
    if (access.effective_user_id) {
      postsQuery = visibleListIds.length > 0
        ? postsQuery.in("list_id", visibleListIds)
        : postsQuery.in("list_id", ["00000000-0000-0000-0000-000000000000"]);
    }
    return postsQuery.order("id", { ascending: true }).range(from, to);
  });

  const lists = (rawLists ?? []) as OrganicList[];
  const posts = (rawPosts ?? []) as OrganicPost[];
  const isPersonalView = Boolean(access.effective_user_id);
  const personalName = access.effective_username ?? access.username;

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
  const personalWeekCount = posts.filter((p) => p.posted_at >= monday && p.posted_at <= sunday).length;
  const personalTodayPosts = posts.filter((p) => p.posted_at === today).length;
  const personalTodayStories = posts.filter((p) => p.posted_at === today && p.stories_done).length;

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

  // ── Zielsetzung 01.05
  const DEADLINE = "2026-05-01";
  const VIEWS_GOAL = 10000;
  const FOLLOWER_GOAL = 100;

  const deadlineDate = new Date(DEADLINE + "T00:00:00");
  const todayDate    = new Date(today + "T00:00:00");
  const daysLeft     = Math.max(0, Math.ceil((deadlineDate.getTime() - todayDate.getTime()) / 86400000));
  const isPast       = daysLeft === 0;

  // Bestes Video nach Gesamt-Impressionen
  const bestVideoImpressions = posts.reduce((max, p) => {
    const total = (p.insta_impressions ?? 0) + (p.tiktok_impressions ?? 0);
    return total > max ? total : max;
  }, 0);
  const bestVideoPost = posts.find((p) =>
    (p.insta_impressions ?? 0) + (p.tiktok_impressions ?? 0) === bestVideoImpressions && bestVideoImpressions > 0
  ) ?? null;

  const viewsPct     = Math.min((bestVideoImpressions / VIEWS_GOAL) * 100, 100);
  const viewsReached = bestVideoImpressions >= VIEWS_GOAL;

  // Urgency colour
  const urgencyColor  = isPast ? "var(--color-success-text)" : daysLeft <= 7 ? "var(--color-error-text)" : daysLeft <= 14 ? "var(--color-warning-text)" : "var(--organic-accent)";
  const urgencyBg     = isPast ? "var(--color-success-bg)" : daysLeft <= 7 ? "var(--color-error-bg)" : daysLeft <= 14 ? "var(--color-warning-bg)" : "var(--organic-accent-bg)";
  const urgencyBorder = isPast ? "var(--color-success-border)"  : daysLeft <= 7 ? "var(--color-error-border)"  : daysLeft <= 14 ? "var(--color-warning-border)"  : "color-mix(in srgb, var(--organic-accent) 20%, transparent)";

  const motivText = isPast
    ? { emoji: "🎉", line1: "Deadline war gestern — wie war die Mission?", line2: "Checkt euren besten Hook und skaliert ihn weiter. Der Algorithmus belohnt Konsistenz." }
    : daysLeft <= 7
    ? { emoji: "🔥", line1: `Noch ${daysLeft} Tag${daysLeft === 1 ? "" : "e"}. Alles rauslassen jetzt!`, line2: "In der letzten Woche entscheidet sich alles. Jeder Post kann der Durchbruch sein." }
    : daysLeft <= 14
    ? { emoji: "⚡", line1: `${daysLeft} Tage — es wird ernst.`, line2: "Zwei Wochen. Jetzt den Hook-Stil testen der bisher am besten lief und verdoppeln." }
    : { emoji: "🚀", line1: `${daysLeft} Tage bis zum 01.05 — ihr schafft das.`, line2: "Konsistenz schlägt Perfektion. Jeden Tag posten, testen, lernen." };

  // ── Historical weekly data (last 10 weeks)
  const weeklyHistory: { week: string; Kevin: number; Simon: number }[] = [];
  const personalWeeklyHistory: PersonalWeekPoint[] = [];
  for (let i = 9; i >= 0; i--) {
    const wMon = weekStart(addDays(today, -i * 7));
    const wSun = addDays(wMon, 6);
    const label = `KW ${wMon.slice(5, 10)}`;
    weeklyHistory.push({
      week: label,
      Kevin: posts.filter((p) => p.posted_at >= wMon && p.posted_at <= wSun && listOwner[p.list_id] === "Kevin").length,
      Simon: posts.filter((p) => p.posted_at >= wMon && p.posted_at <= wSun && listOwner[p.list_id] === "Simon").length,
    });
    personalWeeklyHistory.push({
      week: label,
      count: posts.filter((p) => p.posted_at >= wMon && p.posted_at <= wSun).length,
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
    personalMode: isPersonalView,
    personalOwnerName: personalName,
    personalWeeklyHistory,
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      {/* ── Page Header */}
      <div style={{ marginBottom: "1.75rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
            <Film size={18} color="var(--organic-accent)" />
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
          ZIELSETZUNG 01.05
      ══════════════════════════════════════════════════════════ */}
      <div style={{ position: "relative", background: urgencyBg, border: `1px solid ${urgencyBorder}`, borderRadius: "var(--radius-lg)", padding: "1.375rem 1.75rem", marginBottom: "1.5rem", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "1.5rem", flexWrap: "wrap" }}>
          {/* Countdown */}
          <div style={{ textAlign: "center", flexShrink: 0, minWidth: 80 }}>
            <div style={{ fontSize: "2.5rem", lineHeight: 1 }}>{motivText.emoji}</div>
            <div style={{ marginTop: "0.5rem" }}>
              <div style={{ fontSize: "2.5rem", fontWeight: 900, color: urgencyColor, letterSpacing: "-0.05em", lineHeight: 1 }}>
                {isPast ? "✓" : daysLeft}
              </div>
              <div style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: urgencyColor, opacity: 0.75, marginTop: "0.125rem" }}>
                {isPast ? "Erreicht" : daysLeft === 1 ? "Tag noch" : "Tage noch"}
              </div>
              <div style={{ fontSize: "0.625rem", color: "var(--text-subtle)", marginTop: "0.125rem" }}>bis 01.05.2026</div>
            </div>
          </div>

          {/* Text + Goals */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: "1rem", fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.02em", marginBottom: "0.25rem", lineHeight: 1.3 }}>
              {motivText.line1}
            </div>
            <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", margin: "0 0 1rem", lineHeight: 1.55 }}>
              {motivText.line2}
            </p>

            {/* Goal 1: 10k Views */}
            <div style={{ marginBottom: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", marginBottom: "0.375rem" }}>
                <span style={{ fontWeight: 700, color: viewsReached ? "var(--color-success-text)" : "var(--text-primary)" }}>
                  {viewsReached ? "✅" : "🎬"} Ein Video mit 10.000+ Views
                </span>
                <span style={{ color: viewsReached ? "var(--color-success-text)" : urgencyColor, fontWeight: 700 }}>
                  {bestVideoImpressions.toLocaleString()} / {VIEWS_GOAL.toLocaleString()}
                </span>
              </div>
              <div style={{ position: "relative", height: 8, borderRadius: 99, background: "var(--surface-200)", overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 99,
                  width: `${viewsPct}%`,
                  background: viewsReached
                    ? "var(--color-success-text)"
                    : urgencyColor,
                  transition: "width 0.6s ease",
                }} />
              </div>
              {bestVideoPost && !viewsReached && (
                <div style={{ fontSize: "0.6875rem", color: "var(--text-subtle)", marginTop: "0.25rem" }}>
                  Bestes Video: {bestVideoPost.hook_text ? `"${bestVideoPost.hook_text.slice(0, 50)}${bestVideoPost.hook_text.length > 50 ? "…" : ""}"` : bestVideoPost.posted_at}
                  {" · "}noch {(VIEWS_GOAL - bestVideoImpressions).toLocaleString()} Views bis Ziel
                </div>
              )}
            </div>

            {/* Goal 2: 100 Follower */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "var(--surface-150)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.5rem 0.75rem" }}>
              <span style={{ fontSize: "0.875rem" }}>👥</span>
              <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-primary)" }}>100 neue Follower</span>
              <span style={{ fontSize: "0.75rem", color: "var(--text-subtle)", marginLeft: "auto" }}>manuell tracken — Einstellungen → Notizen</span>
            </div>
          </div>
        </div>
      </div>

      {isPersonalView ? (
        <PersonalVideoWeekPanel
          name={personalName}
          count={personalWeekCount}
          todayCount={personalTodayPosts}
          storiesDone={personalTodayStories}
          goal={WEEKLY_VIDEO_GOAL}
          monday={monday}
          sunday={sunday}
        />
      ) : (
        <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)", borderRadius: "var(--radius-lg)", padding: "1.5rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1.25rem" }}>
            <Trophy size={16} color="var(--organic-accent)" />
            <span style={{ fontWeight: 800, fontSize: "0.9375rem", color: "var(--organic-accent)" }}>Wochenduell — Videos</span>
            <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--text-subtle)" }}>Ziel: {WEEKLY_VIDEO_GOAL}/Woche · {monday} → {sunday} · Reset jeden Montag</span>
          </div>

          <div className="duel-grid" style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "1.5rem", alignItems: "center" }}>
            <DuelPanel owner="Kevin" count={kevinWeek} leader={leader} loser={loser} goal={WEEKLY_VIDEO_GOAL} todayCount={todayPosts.Kevin} storiesDone={todayStories.Kevin} />
            <div className="duel-vs" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem" }}>
              <div style={{ width: 1, height: 24, background: "linear-gradient(to bottom, transparent, color-mix(in srgb, var(--organic-accent) 35%, transparent))" }} />
              <div style={{ fontSize: "0.6875rem", fontWeight: 800, color: "var(--text-subtle)", letterSpacing: "0.1em", padding: "3px 8px", border: "1px solid color-mix(in srgb, var(--organic-accent) 15%, transparent)", borderRadius: 99, background: "var(--organic-accent-bg)" }}>VS</div>
              <div style={{ width: 1, height: 24, background: "linear-gradient(to bottom, color-mix(in srgb, var(--organic-accent) 35%, transparent), transparent)" }} />
            </div>
            <DuelPanel owner="Simon" count={simonWeek} leader={leader} loser={loser} goal={WEEKLY_VIDEO_GOAL} todayCount={todayPosts.Simon} storiesDone={todayStories.Simon} />
          </div>
        </div>
      )}

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
          <Zap size={15} color="var(--brand-500)" />
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
              const oc = list.owner_name
                ? ownerColor(list.owner_name)
                : { fg: "var(--organic-accent)", bg: "var(--organic-accent-bg)" };
              return (
                <Link key={list.id} href={`/organic/${list.id}`} style={{ textDecoration: "none" }} className="organic-list-card-link">
                  <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.875rem", transition: "border-color 0.15s, background 0.15s" }}
                    className="organic-list-card"
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                      <span style={{ fontSize: "0.6875rem", fontWeight: 700, color: oc.fg, background: oc.bg, borderRadius: 99, padding: "0.1rem 0.4rem" }}>{list.owner_name ?? "?"}</span>
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
  const s = ownerStyle(owner);
  const isWinner = leader === owner;
  const isLoser  = loser  === owner;
  const progress = Math.min((count / goal) * 100, 100);
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem", marginBottom: "0.875rem" }}>
        <div style={{ width: 38, height: 38, borderRadius: "50%", background: s.bg, border: `2px solid ${isWinner ? s.color : s.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.9375rem", fontWeight: 800, color: s.color }}>
          {owner[0]}
        </div>
        <div>
          <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: isWinner ? s.color : "var(--text-secondary)" }}>{owner} {isWinner ? "👑" : ""}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>{isLoser ? "zahlt das Essen 🍽️" : isWinner ? "führt diese Woche" : "im Rennen"}</div>
        </div>
      </div>
      <div style={{ fontSize: "3.25rem", fontWeight: 800, letterSpacing: "-0.04em", color: isWinner ? s.color : "var(--text-subtle)", lineHeight: 1, marginBottom: "0.5rem" }}>
        {count}<span style={{ fontSize: "1.125rem", fontWeight: 500, color: "var(--text-subtle)", marginLeft: 3 }}>/{goal}</span>
      </div>
      <div style={{ background: "var(--surface-200)", borderRadius: 99, height: 6, overflow: "hidden", marginBottom: "0.625rem" }}>
        <div style={{ height: "100%", borderRadius: 99, width: `${progress}%`, background: isWinner ? s.color : `color-mix(in srgb, ${s.color} 27%, transparent)` }} />
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: "0.875rem", fontSize: "0.75rem", color: "var(--text-subtle)" }}>
        <span>🎬 Heute: <strong style={{ color: todayCount >= DAILY_VIDEO_GOAL ? "var(--color-success-text)" : "var(--text-secondary)" }}>{todayCount}/{DAILY_VIDEO_GOAL}</strong></span>
        <span>📱 Stories: <strong style={{ color: storiesDone > 0 ? "var(--color-success-text)" : "var(--text-subtle)" }}>{storiesDone > 0 ? "✓" : "—"}</strong></span>
      </div>
    </div>
  );
}
