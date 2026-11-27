"use client";

import { type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";

// Knopf-Familie des Liquid-Glass-Systems.
//
//   primary   → Orange-Verlauf mit Tinte (E1), Lichtkante, Glanz am Zeiger.
//               Genau EINER pro View — nie in Tabellenzeilen oder Listen.
//   secondary → der Arbeitsknopf fuer alles Nicht-Primaere (Mulde; auf einer
//               Karte angehoben).
//   ghost     → Inline-Aktionen in Toolbars und Karten-Footern.
//   danger    → destruktiv; nie Orange.
//   success   → Bestaetigungen im Gespraechsfluss.
//
// Die OPTIK der Varianten steht ausschliesslich in globals.css
// (.ui-btn[data-variant=…]) — Hover, Aktiv, Deaktiviert und der Touch-Bump
// liegen damit an einer Stelle, fuer beide Modi. Hier stehen nur die Groessen.

export type ButtonVariant = "primary" | "secondary" | "danger" | "success" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

// Groessen 28 · 34 · 44 (Prototyp).
const SIZE_STYLES: Record<ButtonSize, CSSProperties> = {
  sm: { minHeight: 28, padding: "0 10px", fontSize: "var(--fs-sm)" },
  md: { minHeight: "var(--h-control)", padding: "0 14px", fontSize: "13px" },
  lg: { minHeight: "var(--h-control-lg)", padding: "0 18px", fontSize: "14.5px" },
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Zeigt einen Spinner und deaktiviert den Button. */
  loading?: boolean;
  fullWidth?: boolean;
  /** Icon vor dem Label (z. B. Lucide-Icon). */
  icon?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  icon,
  disabled,
  type = "button",
  className,
  style,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      data-variant={variant}
      data-size={size}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={className ? `ui-btn ${className}` : "ui-btn"}
      style={{
        ...SIZE_STYLES[size],
        ...(fullWidth ? { width: "100%" } : null),
        ...style,
      }}
    >
      {loading ? <span className="ui-btn-spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

/**
 * 32x32-Icon-Knopf im Ghost-Stil.
 * Braucht immer ein `label` — es wird zu aria-label und Tooltip.
 */
export function IconButton({
  label,
  icon,
  size = 32,
  tone = "neutral",
  className,
  style,
  type = "button",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  icon: ReactNode;
  size?: number;
  tone?: "neutral" | "accent" | "danger";
}) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      data-variant="ghost"
      data-tone={tone}
      className={className ? `ui-btn ui-icon-btn ${className}` : "ui-btn ui-icon-btn"}
      style={{
        width: size,
        height: size,
        minHeight: size,
        padding: 0,
        flexShrink: 0,
        borderRadius: 10,
        ...style,
      }}
    >
      {icon}
    </button>
  );
}
