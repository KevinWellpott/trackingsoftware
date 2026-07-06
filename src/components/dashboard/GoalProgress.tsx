// Schlanke Fortschritts-Zeile für die Ziele-Card: "{label}: current/goal {unit}".
// Brand-Füllung, Erfolgs-Farbe sobald das Ziel erreicht ist. Token-basiert.

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
  const fill = reached ? "var(--color-success-text)" : "var(--brand-500)";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.375rem" }}>
        <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary)" }}>{label}</span>
        <span style={{ marginLeft: "auto", fontSize: "0.8125rem", fontWeight: 700, color: reached ? "var(--color-success-text)" : "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
          {current.toLocaleString("de-DE")}
          <span style={{ fontWeight: 500, color: "var(--text-subtle)" }}>/{goal.toLocaleString("de-DE")} {unit}</span>
        </span>
      </div>
      <div style={{ background: "var(--surface-200)", borderRadius: 99, height: 8, overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: 99, width: `${pct}%`, background: fill, transition: "width 0.4s ease" }} />
      </div>
      <div style={{ fontSize: "0.6875rem", color: "var(--text-subtle)", marginTop: "0.25rem" }}>
        {reached
          ? "Ziel erreicht"
          : `${Math.round(pct)}% · noch ${Math.max(0, goal - current).toLocaleString("de-DE")} ${unit}`}
      </div>
    </div>
  );
}
