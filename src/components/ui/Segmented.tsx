"use client";

// Generisches Segmented-Control (z. B. Filter-/Modus-Umschalter).
// Aktives Segment = Ink-Inversion (--btn-primary-bg/-fg).
// Touch-Bump (≥44px) via .ui-segmented button in globals.css.

export type SegmentedOption<T extends string> = { value: T; label: string };

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "sm",
  ariaLabel,
  fullWidth = false,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  ariaLabel?: string;
  fullWidth?: boolean;
}) {
  const minHeight = size === "md" ? 38 : 32;
  return (
    <div
      className="ui-segmented"
      role="group"
      aria-label={ariaLabel}
      style={{
        display: fullWidth ? "flex" : "inline-flex",
        alignItems: "stretch",
        gap: 2,
        padding: 2,
        background: "var(--surface-150)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            style={{
              flex: fullWidth ? 1 : undefined,
              minHeight: minHeight - 4,
              padding: size === "md" ? "0.375rem 1rem" : "0.25rem 0.75rem",
              fontSize: size === "md" ? "0.875rem" : "0.8125rem",
              fontWeight: active ? 600 : 500,
              fontFamily: "inherit",
              color: active ? "var(--btn-primary-fg)" : "var(--text-muted)",
              background: active ? "var(--btn-primary-bg)" : "transparent",
              border: "none",
              borderRadius: "calc(var(--radius-md) - 3px)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition:
                "background var(--transition-fast), color var(--transition-fast)",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
