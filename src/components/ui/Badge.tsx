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

/** Kanal-/Pipeline-Farben (DESIGN.md §3.6). Erscheinen nur als Dot, nie als Flaeche. */
export type StageKey = "telefon" | "linkedin" | "setting" | "closing" | "nachfassen" | "heute";

export const STAGE_COLOR: Record<StageKey, string> = {
  telefon: "var(--stage-telefon)",
  linkedin: "var(--stage-linkedin)",
  setting: "var(--stage-setting)",
  closing: "var(--stage-closing)",
  nachfassen: "var(--stage-nachfassen)",
  heute: "var(--stage-heute)",
};

/**
 * 8px-Kanal-Dot — die kleinste Kanal-Kennung (COMPONENTS.md §4.3).
 *
 * Bleibt als Baustein fuer die Flaechen, auf denen die Kanalfarbe die EINZIGE
 * Unterscheidung ist (Legenden, Diagramme). Auf den Arbeitsboards traegt sie
 * nichts bei — siehe `StageBadge`.
 */
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

/**
 * Stage-Badge: benennt die Stufe — NEUTRAL, nicht in der Kanalfarbe.
 *
 * WARUM OHNE FARBE: Das Badge traegt die Stufe als WORT („Setting", „Closing",
 * „Telefon-Lead"). Die Kanalfarbe wiederholt daneben nur, was schon dasteht —
 * und auf dreissig Arbeitskarten untereinander (/nachfassen, /erinnerungen,
 * /ablage, Lead-Dossier) stehen dann Violett, Gruen, Blau und Teal
 * gleichzeitig auf dem Schirm. Das ist genau der Fall, den das Badge-Budget
 * aus DESIGN.md §3.6 ausschliesst: „Hoechstens EIN farbiges Element pro
 * Zeile" — und das eine gehoert der Dringlichkeit (ueberfaellig), nicht der
 * Kategorie.
 *
 * Die Palette bleibt unangetastet, wo die Farbe die einzige Unterscheidung
 * ist: Kalender-Chips (`lib/terminMeta.ts`) und die Diagramme des
 * Analyse-Bereichs (Viz-/Owner-Palette). `stage` bleibt in der Signatur —
 * die Aufrufer aendern sich dadurch nicht, und die Stufe steht als
 * `data-stage` weiterhin im Markup.
 */
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
      data-stage={stage}
      style={{ ...TONE_STYLES.neutral, ...style }}
    >
      {children}
    </span>
  );
}
