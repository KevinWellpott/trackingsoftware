"use client";

// Switch (COMPONENTS.md §3.5): 36x20, Track surface-3 → an: orange-500,
// Thumb 16px in #FAFAFA. Bewegung in --dur-1 / --ease-in-out.
// Touch-Bump (≥44px) via .ui-toggle in globals.css.

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
        minHeight: "var(--h-control)",
        padding: "6px 0",
        background: "transparent",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "relative",
          display: "inline-block",
          width: 36,
          height: 20,
          borderRadius: "var(--r-full)",
          background: disabled
            ? "var(--surface-2)"
            : checked
              ? "var(--orange-500)"
              : "var(--surface-3)",
          border: "1px solid",
          borderColor: disabled
            ? "var(--border-subtle)"
            : checked
              ? "var(--orange-600)"
              : "var(--border-strong)",
          transition: "background var(--dur-1) var(--ease-in-out), border-color var(--dur-1) var(--ease-in-out)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 1,
            left: checked ? 17 : 1,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: disabled ? "var(--text-disabled)" : "#fafafa",
            transition: "left var(--dur-1) var(--ease-in-out)",
          }}
        />
      </span>
    </button>
  );
}
