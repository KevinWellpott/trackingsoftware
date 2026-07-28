"use client";

// 1–10-Bewertungsreihe (Pain/Warmth in der Qualifizierung).
// Aktiver Wert = Orange-Fuellung mit dunklem Text (#0A0A0B = 7.1:1, die
// barrierefreie Variante). Erneuter Klick auf den aktiven Wert loescht
// die Auswahl. Touch-Bump (≥44px) via .ui-scale10 button in globals.css.

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
              minWidth: 30,
              minHeight: "var(--h-control)",
              padding: "0 4px",
              fontSize: "var(--fs-sm)",
              fontWeight: active ? 600 : 500,
              fontFamily: "inherit",
              fontVariantNumeric: "tabular-nums",
              color: disabled ? "var(--text-disabled)" : active ? "#0a0a0b" : "var(--text-muted)",
              background: active ? "var(--orange-500)" : "var(--surface-1)",
              border: "1px solid",
              borderColor: active ? "var(--orange-500)" : "var(--border-default)",
              borderRadius: "var(--r-full)",
              cursor: disabled ? "not-allowed" : "pointer",
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
