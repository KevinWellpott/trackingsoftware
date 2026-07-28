// Fortschritts-Zeile der Ziele-Card: Label · current/goal · Balken · Rest.
//
// Der Balken laeuft in Markenorange (Fokus) und wechselt bei erreichtem Ziel
// auf Gruen. Das ist zulaessig, weil das Ziel-Erreichen zusaetzlich im Text
// steht — Farbe traegt hier keine Bedeutung allein (DESIGN.md §3.5).

export function GoalProgress({
  label,
  current,
  goal,
  unit = "DMs",
}: {
  label: string;
  current: number;
  goal: number;
  unit?: string;
}) {
  const pct = goal > 0 ? Math.min((current / goal) * 100, 100) : 0;
  const reached = goal > 0 && current >= goal;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-4)", marginBottom: "var(--sp-4)" }}>
        <span style={{ fontSize: "var(--fs-base)", fontWeight: 500, color: "var(--text-secondary)" }}>{label}</span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: "var(--fs-base)",
            fontWeight: 600,
            color: "var(--text-primary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {current.toLocaleString("de-DE")}
          <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>
            {" / "}
            {goal.toLocaleString("de-DE")} {unit}
          </span>
        </span>
      </div>
      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: `${pct}%`, background: reached ? "var(--success)" : "var(--orange-500)" }}
        />
      </div>
      <div
        style={{
          fontSize: "var(--fs-xs)",
          color: reached ? "var(--success-fg)" : "var(--text-muted)",
          marginTop: "var(--sp-3)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {reached
          ? "Ziel erreicht"
          : `${Math.round(pct)} % · noch ${Math.max(0, goal - current).toLocaleString("de-DE")} ${unit}`}
      </div>
    </div>
  );
}
