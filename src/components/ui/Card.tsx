"use client";

import { type CSSProperties, type ReactNode } from "react";

// Dünner Karten-Wrapper: nutzt die bestehenden .card/.card-hover-Regeln
// aus globals.css (surface-100, border, radius-lg, shadow-sm).

export function Card({
  children,
  padding = "1.25rem 1.375rem",
  hover = false,
  className,
  style,
}: {
  children: ReactNode;
  /** CSS-Padding (String oder Zahl in px). */
  padding?: string | number;
  /** Hover-Effekt (border-bright + shadow-md). */
  hover?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const classes = ["card", hover ? "card-hover" : null, className].filter(Boolean).join(" ");
  return (
    <div className={classes} style={{ padding, ...style }}>
      {children}
    </div>
  );
}
