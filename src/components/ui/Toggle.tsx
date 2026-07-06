"use client";

// Barrierefreier An/Aus-Schalter (role="switch").
// An = Erfolgs-Tokens; Touch-Bump (≥44px) via .ui-toggle in globals.css.

export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
  title,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Zugängliche Beschriftung des Schalters. */
  label?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="ui-toggle"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "flex-start",
        minHeight: 32,
        padding: "5px 0",
        background: "transparent",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "relative",
          display: "inline-block",
          width: 38,
          height: 22,
          borderRadius: 99,
          background: checked ? "var(--success-500)" : "var(--surface-300)",
          border: "1px solid",
          borderColor: checked ? "var(--color-success-border)" : "var(--border-bright)",
          transition: "background var(--transition-fast), border-color var(--transition-fast)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#ffffff",
            boxShadow: "var(--shadow-xs)",
            transition: "left var(--transition-fast)",
          }}
        />
      </span>
    </button>
  );
}
