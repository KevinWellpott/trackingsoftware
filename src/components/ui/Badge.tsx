"use client";

import { type CSSProperties, type ReactNode } from "react";

// Badges des Ember-Glass-Systems (COMPONENTS.md §4).
//
// Regel aus DESIGN.md §3.5: Markenorange traegt NIEMALS Status.
// „warning" ist Gold, nicht Orange. Der Ton `accent` existiert nur fuer
// Fokus-/Heute-Marker — nicht fuer Ergebnisse.
// Status wird zusaetzlich immer durch Icon oder Text getragen, nie durch
// Farbe allein (CVD).

export type BadgeTone = "success" | "error" | "warning" | "info" | "neutral" | "brand" | "accent";

const TONE_STYLES: Record<BadgeTone, CSSProperties> = {
  success: {
    backgroundColor: "var(--success-bg)",
    color: "var(--success-fg)",
    border: "1px solid rgb(63 179 127 / 0.28)",
  },
  error: {
    backgroundColor: "var(--danger-bg)",
    color: "var(--danger-fg)",
    border: "1px solid rgb(214 90 82 / 0.28)",
  },
  warning: {
    backgroundColor: "var(--warning-bg)",
    color: "var(--warning-fg)",
    border: "1px solid rgb(209 162 79 / 0.28)",
  },
  info: {
    backgroundColor: "var(--info-bg)",
    color: "var(--info-fg)",
    border: "1px solid rgb(78 128 214 / 0.28)",
  },
  neutral: {
    backgroundColor: "var(--surface-3)",
    color: "var(--text-secondary)",
    border: "1px solid var(--border-default)",
  },
  // brand/accent sind derselbe Fokus-Ton — „brand" bleibt als Alias fuer
  // bestehende Aufrufer erhalten.
  brand: {
    backgroundColor: "var(--accent-muted)",
    color: "var(--orange-300)",
    border: "1px solid var(--border-accent)",
  },
  accent: {
    backgroundColor: "var(--accent-muted)",
    color: "var(--orange-300)",
    border: "1px solid var(--border-accent)",
  },
};

export function Badge({
  tone = "neutral",
  children,
  style,
  title,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  style?: CSSProperties;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="badge"
      style={{ ...TONE_STYLES[tone], ...style }}
    >
      {children}
    </span>
  );
}

/** Kanal-/Pipeline-Farben (DESIGN.md §3.6). Erscheinen nur als Dot + Tint. */
export type StageKey = "telefon" | "linkedin" | "setting" | "closing" | "nachfassen" | "heute";

export const STAGE_COLOR: Record<StageKey, string> = {
  telefon: "var(--stage-telefon)",
  linkedin: "var(--stage-linkedin)",
  setting: "var(--stage-setting)",
  closing: "var(--stage-closing)",
  nachfassen: "var(--stage-nachfassen)",
  heute: "var(--stage-heute)",
};

const STAGE_TINT: Record<StageKey, string> = {
  telefon: "rgb(78 128 214 / 0.10)",
  linkedin: "rgb(13 148 136 / 0.10)",
  setting: "rgb(139 92 246 / 0.10)",
  closing: "rgb(63 163 111 / 0.10)",
  nachfassen: "rgb(209 162 79 / 0.10)",
  heute: "rgb(249 115 22 / 0.10)",
};

/** 8px-Kanal-Dot — die kleinste Kanal-Kennung (COMPONENTS.md §4.3). */
export function StageDot({ stage, size = 8, title }: { stage: StageKey; size?: number; title?: string }) {
  return (
    <span
      title={title}
      aria-hidden={title ? undefined : true}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "var(--r-full)",
        background: STAGE_COLOR[stage],
        display: "inline-block",
      }}
    />
  );
}

/** Stage-Badge: Dot + Label, nie Vollflaeche in Stagefarbe (COMPONENTS.md §4.1). */
export function StageBadge({
  stage,
  children,
  style,
  title,
}: {
  stage: StageKey;
  children: ReactNode;
  style?: CSSProperties;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="badge"
      style={{
        backgroundColor: STAGE_TINT[stage],
        color: "var(--text-secondary)",
        boxShadow: "var(--shadow-badge)",
        ...style,
      }}
    >
      <StageDot stage={stage} size={6} />
      {children}
    </span>
  );
}
