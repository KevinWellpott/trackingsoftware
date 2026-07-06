import { ownerColor, ownerInitials } from "@/lib/ownerColor";
import { fmtPct, pct } from "@/lib/analyse";

// Server-präsentativer Funnel-Streifen: eine Zeile pro Entität (Person/Gesamt)
// mit Stufen, Zwischen-Konversionschips und optionalem Abschlusswert.

export type FunnelStage = { label: string; value: number; sub?: string };

// Feste Token-Farben je Stufen-Index (zyklisch).
const STAGE_COLORS = [
  "var(--brand-500)",
  "var(--color-info-text)",
  "var(--accent-500)",
  "var(--color-warning-text)",
  "var(--color-success-text)",
];

const INT_FMT = new Intl.NumberFormat("de-DE");

function ConversionChip({ current, previous }: { current: number; previous: number }) {
  const label = previous === 0 ? "—" : fmtPct(pct(current, previous));
  return (
    <span
      aria-hidden
      style={{
        alignSelf: "center",
        fontSize: "0.6875rem",
        color: "var(--text-muted)",
        background: "var(--surface-150)",
        borderRadius: 99,
        padding: "0.125rem 0.5rem",
        whiteSpace: "nowrap",
      }}
    >
      → {label}
    </span>
  );
}

function Stage({ stage, index, firstValue }: { stage: FunnelStage; index: number; firstValue: number }) {
  const color = STAGE_COLORS[index % STAGE_COLORS.length];
  const fillPct = firstValue > 0 ? Math.max(4, (stage.value / firstValue) * 100) : 4;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: 0 }}>
      <div
        style={{
          fontSize: "0.625rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--text-subtle)",
          whiteSpace: "nowrap",
        }}
      >
        {stage.label}
      </div>
      <div style={{ fontSize: "1.25rem", fontWeight: 700, lineHeight: 1.1, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
        {INT_FMT.format(stage.value)}
      </div>
      <div style={{ width: 90, height: 6, borderRadius: 99, background: "var(--surface-150)", overflow: "hidden" }}>
        <div style={{ width: `${fillPct}%`, height: "100%", background: color, borderRadius: 99 }} />
      </div>
      {stage.sub && (
        <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{stage.sub}</div>
      )}
    </div>
  );
}

export function FunnelStrip({
  label,
  color,
  stages,
  trailing,
  highlight,
}: {
  label: string;
  color?: string;
  stages: FunnelStage[];
  trailing?: { label: string; value: string };
  highlight?: boolean;
}) {
  const chipColor = color ? { fg: color, bg: "var(--surface-150)" } : ownerColor(label);
  const firstValue = stages[0]?.value ?? 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: "1rem",
        flexWrap: "wrap",
        ...(highlight
          ? {
              background: "var(--surface-50)",
              border: "1px solid var(--border-bright)",
              borderRadius: "var(--radius-md)",
              padding: "0.75rem 0.875rem",
            }
          : {}),
      }}
    >
      {/* Label-Chip */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0, alignSelf: "center" }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: chipColor.bg,
            color: chipColor.fg,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.6875rem",
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {ownerInitials(label)}
        </span>
        <span
          style={{
            fontSize: "0.8125rem",
            fontWeight: highlight ? 800 : 600,
            color: "var(--text-primary)",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      </div>

      {/* Stufen + Konversionschips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
        {stages.map((stage, i) => (
          <div key={stage.label} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end" }}>
            {i > 0 && <ConversionChip current={stage.value} previous={stages[i - 1].value} />}
            <Stage stage={stage} index={i} firstValue={firstValue} />
          </div>
        ))}
      </div>

      {/* Abschlusswert */}
      {trailing && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: 0 }}>
          <div
            style={{
              fontSize: "0.625rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--text-subtle)",
              whiteSpace: "nowrap",
            }}
          >
            {trailing.label}
          </div>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, lineHeight: 1.1, color: "var(--color-success-text)", fontVariantNumeric: "tabular-nums" }}>
            {trailing.value}
          </div>
        </div>
      )}
    </div>
  );
}
