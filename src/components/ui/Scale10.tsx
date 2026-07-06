"use client";

// 1–10-Bewertungsreihe. Aktiver Wert = Brand-Füllung; erneuter Klick
// auf den aktiven Wert löscht die Auswahl (null).
// Touch-Bump (≥44px) via .ui-scale10 button in globals.css.

const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export function Scale10({
  value,
  onChange,
  disabled = false,
  ariaLabel = "Bewertung 1 bis 10",
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div
      className="ui-scale10"
      role="group"
      aria-label={ariaLabel}
      style={{ display: "flex", flexWrap: "wrap", gap: 4 }}
    >
      {VALUES.map((n) => {
        const active = value === n;
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(active ? null : n)}
            style={{
              minWidth: 28,
              minHeight: 28,
              padding: "0 0.25rem",
              fontSize: "0.8125rem",
              fontWeight: active ? 700 : 500,
              fontFamily: "inherit",
              fontVariantNumeric: "tabular-nums",
              color: active ? "#ffffff" : "var(--text-muted)",
              background: active ? "var(--brand-500)" : "var(--surface-150)",
              border: "1px solid",
              borderColor: active ? "var(--brand-500)" : "var(--border)",
              borderRadius: "var(--radius-sm)",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.55 : 1,
              transition:
                "background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast)",
            }}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}
