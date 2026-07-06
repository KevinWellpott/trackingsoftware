"use client";

import { type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";

// Token-gestylter Standard-Button für alle Bereiche.
// Varianten-Farben inline (Tokens), Hover/Active/Disabled + Touch-Bump
// über die .ui-btn-Regeln in globals.css.

export type ButtonVariant = "primary" | "secondary" | "danger" | "success" | "ghost";
export type ButtonSize = "sm" | "md";

const VARIANT_STYLES: Record<ButtonVariant, CSSProperties> = {
  primary: {
    background: "var(--btn-primary-bg)",
    color: "var(--btn-primary-fg)",
    border: "1px solid transparent",
  },
  secondary: {
    background: "var(--surface-100)",
    color: "var(--text-primary)",
    border: "1px solid var(--border)",
  },
  danger: {
    background: "transparent",
    color: "var(--color-error-text)",
    border: "1px solid var(--color-error-border)",
  },
  success: {
    background: "transparent",
    color: "var(--color-success-text)",
    border: "1px solid var(--color-success-border)",
  },
  ghost: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "1px solid transparent",
  },
};

const SIZE_STYLES: Record<ButtonSize, CSSProperties> = {
  sm: { minHeight: 32, padding: "0.3125rem 0.75rem", fontSize: "0.8125rem" },
  md: { minHeight: 38, padding: "0.5rem 1.125rem", fontSize: "0.875rem" },
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
