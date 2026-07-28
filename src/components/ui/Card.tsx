"use client";

import { type CSSProperties, type ReactNode } from "react";

// Karten des Ember-Glass-Systems (COMPONENTS.md §5).
//
//   solid (Standard) → surface-2, 1px-Border, r-lg, KEIN Schatten.
//   glass            → das Liquid-Glass-Rezept fuer das eine hervorgehobene
//                      Element einer View. Max. 3 Glasflaechen pro Viewport,
//                      nie in scrollenden Zeilen (DESIGN.md §4.3).

export function Card({
  children,
  padding = "var(--sp-8)",
  hover = false,
  variant = "solid",
  /** Fadenkreuz-Marken in den Ecken — nur fuer die Hero-/Glaskarte. */
  ticks = false,
  className,
  style,
}: {
  children: ReactNode;
  /** CSS-Padding (String oder Zahl in px). */
  padding?: string | number;
  /** Hover hebt die Karte eine Surface-Stufe an. */
  hover?: boolean;
  variant?: "solid" | "glass";
  ticks?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const classes = [
    variant === "glass" ? "glass-card" : "card",
    hover ? "card-hover" : null,
    ticks ? "corner-ticks" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} style={{ padding, ...style }}>
      {children}
    </div>
  );
}

/**
 * Karten-Kopf: Eyebrow + Titel + optionale Aktion rechts.
 * Der Eyebrow ist einer der wenigen erlaubten Orange-Text-Momente.
 */
export function CardHeader({
  eyebrow,
  title,
  meta,
  action,
  style,
}: {
  eyebrow?: string;
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--sp-6)",
        marginBottom: "var(--sp-6)",
        ...style,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {eyebrow && <div className="eyebrow" style={{ marginBottom: "var(--sp-3)" }}>{eyebrow}</div>}
        <div
          style={{
            fontSize: "var(--fs-md)",
            fontWeight: 600,
            letterSpacing: "var(--ls-tight)",
            color: "var(--text-primary)",
            lineHeight: "var(--lh-snug)",
          }}
        >
          {title}
        </div>
        {meta && (
          <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", marginTop: 2 }}>{meta}</div>
        )}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}
