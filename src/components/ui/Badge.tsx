"use client";

import { type CSSProperties, type ReactNode } from "react";

// Kleines Status-Badge (Pille) auf Basis der semantischen Tokens.

export type BadgeTone = "success" | "error" | "warning" | "info" | "neutral" | "brand";

const TONE_STYLES: Record<BadgeTone, CSSProperties> = {
  success: {
    background: "var(--color-success-bg)",
    color: "var(--color-success-text)",
    border: "1px solid var(--color-success-border)",
  },
  error: {
    background: "var(--color-error-bg)",
    color: "var(--color-error-text)",
    border: "1px solid var(--color-error-border)",
  },
  warning: {
    background: "var(--color-warning-bg)",
    color: "var(--color-warning-text)",
    border: "1px solid var(--color-warning-border)",
  },
  info: {
    background: "var(--color-info-bg)",
    color: "var(--color-info-text)",
    border: "1px solid var(--color-info-border)",
  },
  neutral: {
    background: "var(--surface-150)",
    color: "var(--text-muted)",
    border: "1px solid var(--border)",
  },
  brand: {
    background: "var(--brand-50)",
    color: "var(--brand-600)",
    border: "1px solid var(--brand-200)",
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
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        borderRadius: 99,
        fontSize: "0.75rem",
        fontWeight: 500,
        lineHeight: 1.4,
        padding: "0.125rem 0.625rem",
        whiteSpace: "nowrap",
        ...TONE_STYLES[tone],
        ...style,
      }}
    >
      {children}
    </span>
  );
}
