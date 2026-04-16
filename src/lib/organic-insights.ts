import type { OrganicPost } from "@/app/actions/organic";

export type InsightLevel = "success" | "warning" | "danger" | "tip";

export interface OrganicInsight {
  level: InsightLevel;
  title: string;
  body: string;
  listId?: string;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

export function generateOrganicInsights(
  posts: OrganicPost[],
): OrganicInsight[] {
  const insights: OrganicInsight[] = [];
  if (posts.length < 3) {
    insights.push({
      level: "tip",
      title: "Noch zu wenig Daten",
      body: `Trage mindestens 3 Posts ein um automatische Analysen zu erhalten. Aktuell: ${posts.length} Post${posts.length === 1 ? "" : "s"}.`,
    });
    return insights;
  }

  // ── Impressionen: Insta vs TikTok ──────────────────────────────────────
  const instaData  = posts.filter((p) => p.insta_impressions  != null).map((p) => p.insta_impressions!);
  const tiktokData = posts.filter((p) => p.tiktok_impressions != null).map((p) => p.tiktok_impressions!);
  const avgInsta  = avg(instaData);
  const avgTikTok = avg(tiktokData);

  if (avgInsta > 0 && avgTikTok > 0) {
    const ratio = avgTikTok / avgInsta;
    if (ratio > 1.5) {
      insights.push({
        level: "tip",
        title: `TikTok läuft ${Math.round(ratio)}x besser als Instagram`,
        body: `Avg TikTok: ${avgTikTok.toLocaleString()} · Avg Insta: ${avgInsta.toLocaleString()} Impressionen. Mehr Fokus auf TikTok könnte sinnvoll sein.`,
      });
    } else if (ratio < 0.67) {
      insights.push({
        level: "tip",
        title: `Instagram läuft ${Math.round(1 / ratio)}x besser als TikTok`,
        body: `Avg Insta: ${avgInsta.toLocaleString()} · Avg TikTok: ${avgTikTok.toLocaleString()} Impressionen. Mehr Fokus auf Instagram könnte sinnvoll sein.`,
      });
    }
  }

  // ── Content-Typ Analyse ────────────────────────────────────────────────
  const typeLabels: Record<string, string> = {
    educational:  "Educational",
    motivational: "Motivational",
    entertaining: "Entertaining",
    bts:          "Behind-the-Scenes",
    other:        "Sonstiges",
  };

  const typeGroups: Record<string, number[]> = {};
  for (const p of posts) {
    if (!p.content_type) continue;
    const impressions = (p.insta_impressions ?? 0) + (p.tiktok_impressions ?? 0);
    if (!typeGroups[p.content_type]) typeGroups[p.content_type] = [];
    typeGroups[p.content_type].push(impressions);
  }

  const typeAvgs = Object.entries(typeGroups)
    .filter(([, nums]) => nums.length >= 2)
    .map(([type, nums]) => ({ type, avg: avg(nums), count: nums.length }))
    .sort((a, b) => b.avg - a.avg);

  if (typeAvgs.length >= 2) {
    const best  = typeAvgs[0];
    const worst = typeAvgs[typeAvgs.length - 1];
    if (best.avg > worst.avg * 1.3) {
      insights.push({
        level: "success",
        title: `${typeLabels[best.type]} performt am besten`,
        body: `Avg ${best.avg.toLocaleString()} Impressionen (${best.count} Posts) — ${Math.round((best.avg / worst.avg - 1) * 100)}% besser als ${typeLabels[worst.type]} (${worst.avg.toLocaleString()}).`,
      });
    }
  }

  // ── Hooks mit Frage-Formulierung ───────────────────────────────────────
  const hookPosts = posts.filter((p) => p.hook_text && ((p.insta_impressions ?? 0) + (p.tiktok_impressions ?? 0)) > 0);
  if (hookPosts.length >= 4) {
    const questionHooks = hookPosts.filter((p) => p.hook_text!.includes("?"));
    const statementHooks = hookPosts.filter((p) => !p.hook_text!.includes("?"));

    if (questionHooks.length >= 2 && statementHooks.length >= 2) {
      const qAvg = avg(questionHooks.map((p) => (p.insta_impressions ?? 0) + (p.tiktok_impressions ?? 0)));
      const sAvg = avg(statementHooks.map((p) => (p.insta_impressions ?? 0) + (p.tiktok_impressions ?? 0)));
      if (qAvg > sAvg * 1.2) {
        insights.push({
          level: "tip",
          title: "Fragen als Hook performen besser",
          body: `Hooks mit Fragezeichen: Ø ${qAvg.toLocaleString()} vs. Aussagen: Ø ${sAvg.toLocaleString()} Impressionen. Mehr Hooks als Fragen formulieren.`,
        });
      } else if (sAvg > qAvg * 1.2) {
        insights.push({
          level: "tip",
          title: "Statement-Hooks performen besser als Fragen",
          body: `Direkte Aussagen: Ø ${sAvg.toLocaleString()} vs. Fragen: Ø ${qAvg.toLocaleString()} Impressionen.`,
        });
      }
    }
  }

  // ── CTA-Rate ───────────────────────────────────────────────────────────
  const postsWithCta = posts.filter((p) => p.generated_cta === true).length;
  const ctaRate = posts.length > 0 ? Math.round((postsWithCta / posts.length) * 100) : 0;
  if (ctaRate >= 30) {
    insights.push({
      level: "success",
      title: `Starke CTA-Rate: ${ctaRate}% der Videos bringen Anfragen`,
      body: `${postsWithCta} von ${posts.length} Videos haben direkte DMs/Anfragen generiert. Skaliere diese Content-Typen.`,
    });
  } else if (posts.length >= 10 && ctaRate < 10) {
    insights.push({
      level: "warning",
      title: `CTA-Rate zu niedrig: ${ctaRate}%`,
      body: "Weniger als 10% der Videos generieren Anfragen. Stärkere Call-to-Actions im Video einbauen.",
    });
  }

  // ── Consistency check ──────────────────────────────────────────────────
  const last7Days = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const recentPosts = posts.filter((p) => p.posted_at >= last7Days);

  if (recentPosts.length === 0 && posts.length > 0) {
    insights.push({
      level: "danger",
      title: "Keine Posts in den letzten 7 Tagen",
      body: "Konsistenz ist der wichtigste Faktor für organisches Wachstum. Täglich posten!",
    });
  } else if (recentPosts.length < 3 && posts.length >= 5) {
    insights.push({
      level: "warning",
      title: `Nur ${recentPosts.length} Post${recentPosts.length === 1 ? "" : "s"} diese Woche`,
      body: "Ziel sind 7 Posts/Woche (1 pro Tag). Mehr Konsistenz = mehr Reichweite.",
    });
  }

  // ── Bestes Video ───────────────────────────────────────────────────────
  const sortedByTotal = [...posts]
    .filter((p) => (p.insta_impressions ?? 0) + (p.tiktok_impressions ?? 0) > 0)
    .sort((a, b) =>
      ((b.insta_impressions ?? 0) + (b.tiktok_impressions ?? 0)) -
      ((a.insta_impressions ?? 0) + (a.tiktok_impressions ?? 0))
    );

  if (sortedByTotal.length > 0) {
    const best = sortedByTotal[0];
    const totalImpBest = (best.insta_impressions ?? 0) + (best.tiktok_impressions ?? 0);
    if (best.hook_text) {
      insights.push({
        level: "success",
        title: `Bester Hook: "${best.hook_text.slice(0, 60)}${best.hook_text.length > 60 ? "…" : ""}"`,
        body: `${totalImpBest.toLocaleString()} Impressionen gesamt · ${best.posted_at} · Typ: ${best.content_type ? typeLabels[best.content_type] : "—"}. Replicate this formula.`,
      });
    }
  }

  // ── Stories reminder ───────────────────────────────────────────────────
  const storiesRate = posts.length > 0
    ? Math.round((posts.filter((p) => p.stories_done).length / posts.length) * 100)
    : 0;
  if (storiesRate < 50 && posts.length >= 5) {
    insights.push({
      level: "warning",
      title: `Stories werden vergessen (${storiesRate}% der Tage)`,
      body: "3 Stories täglich sind für den Algorithmus genauso wichtig wie Reels. Ziel: jeder Post-Tag = auch 3 Stories.",
    });
  }

  return insights;
}
