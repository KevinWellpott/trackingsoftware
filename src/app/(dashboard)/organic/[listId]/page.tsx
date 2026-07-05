import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { getAccessContext } from "@/lib/access";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  Film,
  Trash2,
  Zap,
} from "lucide-react";
import { OrganicBoard } from "@/components/organic/OrganicBoard";
import { generateOrganicInsights } from "@/lib/organic-insights";
import type { OrganicPost, OrganicList } from "@/app/actions/organic";
import { deleteOrganicList } from "@/app/actions/organic";
import { DeleteOrganicListButton } from "@/components/organic/DeleteOrganicListButton";

function avg(nums: number[]) {
  if (!nums.length) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

const CONTENT_TYPE_LABELS: Record<string, string> = {
  educational:  "Educational",
  motivational: "Motivational",
  entertaining: "Entertaining",
  bts:          "Behind-the-Scenes",
  other:        "Sonstiges",
};

function InsightCard({ level, title, body }: { level: string; title: string; body: string }) {
  const cfg: Record<string, { icon: React.ReactNode; color: string; bg: string; border: string }> = {
    success: { icon: <CheckCircle size={14} />, color: "var(--color-success-text)", bg: "rgb(4 184 0 / 0.08)", border: "rgb(4 184 0 / 0.2)" },
    warning: { icon: <AlertCircle size={14} />, color: "var(--color-warning-text)", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.2)" },
    danger:  { icon: <AlertCircle size={14} />, color: "var(--color-error-text)", bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.2)" },
    tip:     { icon: <Zap size={14} />,          color: "var(--brand-500)", bg: "rgb(24 98 184 / 0.08)", border: "rgb(24 98 184 / 0.2)" },
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

export default async function OrganicListDetailPage({
  params,
}: {
  params: Promise<{ listId: string }>;
}) {
  const { listId } = await params;
  const access = await getAccessContext();
  if (!access) return null;

  const supabase = await createClient();

  let listQuery = supabase
    .from("organic_lists")
    .select("*")
    .eq("id", listId)
    .eq("workspace_id", access.workspace_id);
  if (access.effective_user_id) {
    listQuery = listQuery.eq("created_by_user_id", access.effective_user_id);
  }
  const { data: rawList } = await listQuery.maybeSingle();

  if (!rawList) notFound();

  const L = rawList as OrganicList;

  const rawPosts = await fetchAllRows((from, to) =>
    supabase
      .from("organic_posts")
      .select("*")
      .eq("list_id", listId)
      .order("posted_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to)
  );

  const posts = (rawPosts ?? []) as OrganicPost[];

  // ── Analytics
  const instaData  = posts.filter((p) => p.insta_impressions  != null).map((p) => p.insta_impressions!);
  const tiktokData = posts.filter((p) => p.tiktok_impressions != null).map((p) => p.tiktok_impressions!);
  const avgInsta  = avg(instaData);
  const avgTikTok = avg(tiktokData);
  const ctaRate   = posts.length ? Math.round((posts.filter((p) => p.generated_cta).length / posts.length) * 100) : 0;
  const storiesRate = posts.length ? Math.round((posts.filter((p) => p.stories_done).length / posts.length) * 100) : 0;
  const totalImp    = posts.reduce((s, p) => s + (p.insta_impressions ?? 0) + (p.tiktok_impressions ?? 0), 0);

  // Best hook
  const bestPost = [...posts]
    .filter((p) => p.hook_text && (p.insta_impressions ?? 0) + (p.tiktok_impressions ?? 0) > 0)
    .sort((a, b) =>
      ((b.insta_impressions ?? 0) + (b.tiktok_impressions ?? 0)) -
      ((a.insta_impressions ?? 0) + (a.tiktok_impressions ?? 0))
    )[0] ?? null;

  // Best content type
  const typeMap: Record<string, number[]> = {};
  for (const p of posts) {
    if (p.content_type) {
      const imp = (p.insta_impressions ?? 0) + (p.tiktok_impressions ?? 0);
      if (!typeMap[p.content_type]) typeMap[p.content_type] = [];
      typeMap[p.content_type].push(imp);
    }
  }
  const bestType = Object.entries(typeMap)
    .map(([t, nums]) => ({ type: t, avg: avg(nums) }))
    .sort((a, b) => b.avg - a.avg)[0] ?? null;

  const insights = generateOrganicInsights(posts);
  const ownerColor = L.owner_name === "Kevin" ? "#818cf8" : L.owner_name === "Simon" ? "#a78bfa" : "#f59e0b";

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      {/* ── Header */}
      <div style={{ marginBottom: "1.5rem", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <Link href="/organic" style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", fontSize: "0.8125rem", color: "var(--text-subtle)", textDecoration: "none", marginBottom: "0.5rem" }}>
            <ArrowLeft size={13} /> Zurück zum Organic Dashboard
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
            <Film size={18} color="#e879f9" />
            <h1 style={{ fontSize: "1.375rem", fontWeight: 800, margin: 0, letterSpacing: "-0.03em" }}>{L.name}</h1>
            {L.owner_name && (
              <span style={{ fontSize: "0.75rem", fontWeight: 700, color: ownerColor, background: ownerColor + "22", borderRadius: 99, padding: "0.15rem 0.5rem" }}>{L.owner_name}</span>
            )}
          </div>
          {L.description && (
            <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", margin: "0.375rem 0 0" }}>{L.description}</p>
          )}
        </div>
        <DeleteOrganicListButton listId={listId} listName={L.name} postCount={posts.length} />
      </div>

      {/* ── Analytics Strip */}
      <div className="grid-6-stat" style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", borderBottom: "1px solid var(--border)", marginBottom: "1.5rem" }}>
        {[
          { label: "Posts",        value: posts.length,              color: "#e879f9" },
          { label: "Ø Insta",      value: avgInsta.toLocaleString(), color: "#ec4899" },
          { label: "Ø TikTok",     value: avgTikTok.toLocaleString(),color: "#38bdf8" },
          { label: "Imp. gesamt",  value: totalImp.toLocaleString(), color: "var(--brand-400)" },
          { label: "CTA-Rate",     value: `${ctaRate}%`,             color: "var(--color-success-text)" },
          { label: "Stories",      value: `${storiesRate}%`,         color: "var(--color-warning-text)" },
        ].map((stat) => (
          <div key={stat.label} style={{ padding: "0.875rem 1rem", borderRight: "1px solid var(--border)" }}>
            <div style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-subtle)", marginBottom: "0.375rem" }}>{stat.label}</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 800, color: stat.color, letterSpacing: "-0.04em" }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* ── Best Hook / Type */}
      {(bestPost || bestType) && (
        <div style={{ display: "grid", gridTemplateColumns: bestPost && bestType ? "1fr 1fr" : "1fr", gap: "0.875rem", marginBottom: "1.5rem" }}>
          {bestPost && (
            <div style={{ background: "rgba(232,121,249,0.06)", border: "1px solid rgba(232,121,249,0.15)", borderRadius: 10, padding: "0.875rem 1rem" }}>
              <div style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#e879f9", marginBottom: "0.375rem" }}>🏆 Bester Hook</div>
              <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.25rem" }}>&quot;{bestPost.hook_text}&quot;</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>
                {((bestPost.insta_impressions ?? 0) + (bestPost.tiktok_impressions ?? 0)).toLocaleString()} Impressionen · {bestPost.posted_at}
              </div>
            </div>
          )}
          {bestType && (
            <div style={{ background: "rgb(24 98 184 / 0.06)", border: "1px solid rgb(24 98 184 / 0.15)", borderRadius: 10, padding: "0.875rem 1rem" }}>
              <div style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--brand-500)", marginBottom: "0.375rem" }}>📊 Bester Content-Typ</div>
              <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.25rem" }}>{CONTENT_TYPE_LABELS[bestType.type] ?? bestType.type}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>Ø {bestType.avg.toLocaleString()} Impressionen</div>
            </div>
          )}
        </div>
      )}

      {/* ── Table */}
      <div style={{ marginBottom: "1.5rem" }}>
        <div style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-subtle)", marginBottom: "0.625rem" }}>
          Posts — direkt bearbeiten
        </div>
        <OrganicBoard listId={listId} ownerName={L.owner_name} posts={posts} />
      </div>

      {/* ── Insights */}
      {insights.length > 0 && (
        <div style={{ background: "var(--surface-50)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
            <Zap size={15} color="var(--brand-500)" />
            <span style={{ fontWeight: 700, fontSize: "0.9375rem" }}>Insights für diese Serie</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
            {insights.map((ins, i) => (
              <InsightCard key={i} level={ins.level} title={ins.title} body={ins.body} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
