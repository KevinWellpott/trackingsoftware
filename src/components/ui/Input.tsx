"use client";

import { type InputHTMLAttributes, type ReactNode, useId } from "react";

// Token-gestyltes Text-Input (.ui-input in globals.css: surface-0,
// Border, radius-md, Focus-Ring via --border-focus + --glow-sm).

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...rest }: InputProps) {
  return <input {...rest} className={className ? `ui-input ${className}` : "ui-input"} />;
}

// Label+Hinweis+Fehler-Wrapper für Input/Textarea/Select.
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string;
  /** id des Eingabefelds für label-Verknüpfung. */
  htmlFor?: string;
  children: ReactNode;
}) {
  const hintId = useId();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      {label && (
        <label
          htmlFor={htmlFor}
          style={{
            fontSize: "0.8125rem",
            fontWeight: 600,
            color: "var(--text-secondary)",
            letterSpacing: "-0.006em",
          }}
        >
          {label}
        </label>
      )}
      {children}
      {error ? (
        <div id={hintId} role="alert" style={{ fontSize: "0.75rem", color: "var(--color-error-text)" }}>
          {error}
        </div>
      ) : hint ? (
        <div id={hintId} style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}
