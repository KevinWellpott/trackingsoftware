"use client";

// Segmented-Control (COMPONENTS.md §3.6).
// Container = Pill auf surface-1. Aktives Segment = Orange-Pill mit dunklem
// Text (#0A0A0B auf Orange = 7.1:1 — die barrierefreie Variante; weisser
// Text auf Orange waere nur 2.8:1). Pfeiltasten wechseln Segmente.
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
  const height = size === "md" ? 32 : 28;

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = (index + dir + options.length) % options.length;
    onChange(options[next].value);
  }

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
        background: "var(--surface-1)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--r-full)",
      }}
    >
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            style={{
              flex: fullWidth ? 1 : undefined,
              minHeight: height,
              padding: size === "md" ? "0 16px" : "0 12px",
              fontSize: size === "md" ? "var(--fs-base)" : "var(--fs-sm)",
              fontWeight: active ? 600 : 500,
              fontFamily: "inherit",
              color: active ? "#0a0a0b" : "var(--text-muted)",
              // Aktive Pille traegt denselben CTA-Verlauf wie die Buttons —
              // dunkler Text darauf, weisser waere auf Orange nur 2.8:1.
              background: active ? "var(--grad-cta)" : "transparent",
              boxShadow: active ? "var(--lip-control)" : undefined,
              border: "none",
              borderRadius: "var(--r-full)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "background var(--transition-fast), color var(--transition-fast)",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
