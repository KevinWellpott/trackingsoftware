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
    // Label ueber dem Feld, 12px/500 (COMPONENTS.md §3.8).
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
      {label && (
        <label
          htmlFor={htmlFor}
          style={{
            fontSize: "var(--fs-xs)",
            fontWeight: 500,
            color: "var(--text-secondary)",
          }}
        >
          {label}
        </label>
      )}
      {children}
      {/* Fehler tragen immer Text, nie nur Farbe. */}
      {error ? (
        <div id={hintId} role="alert" style={{ fontSize: "var(--fs-xs)", color: "var(--danger-fg)" }}>
          {error}
        </div>
      ) : hint ? (
        <div id={hintId} style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}
