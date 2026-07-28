"use client";

import { type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";

// Button-Familie des Ember-Glass-Systems (COMPONENTS.md §2).
//
//   primary   → „Signature Pill": Gradient, Pill-Radius, Licht-Lippe.
//               Genau EINER pro View — nie in Tabellenzeilen oder Listen.
//   secondary → der Arbeits-Button fuer alles Nicht-Primaere.
//   ghost     → Inline-Aktionen in Toolbars und Karten-Footern.
//   danger    → destruktiv; nie Orange.
//   success   → Bestaetigungen im Gespraechsfluss.
//
// Hover/Active/Disabled + Touch-Bump kommen aus den .ui-btn-Regeln
// in globals.css, damit die Zustaende an einer Stelle liegen.

export type ButtonVariant = "primary" | "secondary" | "danger" | "success" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

// Alle Varianten sind Pills mit Licht von oben (Radius/Lippe kommen aus
// .ui-btn in globals.css). Unterschieden wird ueber die FUELLUNG:
// Farbverlauf in Markenfarbe = der eine CTA, Surface-Verlauf = sekundaer,
// nichts = Ghost. Genau daran haengt die Hierarchie aus DESIGN.md §3.8.
const VARIANT_STYLES: Record<ButtonVariant, CSSProperties> = {
  primary: {
    background: "var(--grad-cta)",
    color: "var(--text-on-accent)",
    border: "none",
  },
  secondary: {
    background: "var(--grad-surface)",
    color: "var(--text-primary)",
    border: "1px solid var(--border-default)",
  },
  danger: {
    background: "transparent",
    color: "var(--danger-fg)",
    border: "1px solid rgb(214 90 82 / 0.40)",
  },
  success: {
    background: "transparent",
    color: "var(--success-fg)",
    border: "1px solid rgb(63 179 127 / 0.40)",
  },
  ghost: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "1px solid transparent",
  },
};

// Pills brauchen mehr Seitenluft als Rechtecke, sonst kleben die Labels
// an der Rundung.
const SIZE_STYLES: Record<ButtonSize, CSSProperties> = {
  sm: { minHeight: 28, padding: "0 14px", fontSize: "var(--fs-sm)" },
  md: { minHeight: "var(--h-control)", padding: "0 18px", fontSize: "var(--fs-base)" },
  lg: { minHeight: "var(--h-control-lg)", padding: "0 24px", fontSize: "var(--fs-base)" },
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
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={className ? `ui-btn ${className}` : "ui-btn"}
      style={{
        ...VARIANT_STYLES[variant],
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
 * 32x32-Icon-Button im Ghost-Stil (COMPONENTS.md §2.5).
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
  const color =
    tone === "accent" ? "var(--orange-300)" : tone === "danger" ? "var(--danger-fg)" : "var(--text-muted)";
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      data-variant="ghost"
      className={className ? `ui-btn ${className}` : "ui-btn"}
      style={{
        width: size,
        height: size,
        minHeight: size,
        padding: 0,
        flexShrink: 0,
        background: "transparent",
        border: "1px solid transparent",
        color,
        ...style,
      }}
    >
      {icon}
    </button>
  );
}
