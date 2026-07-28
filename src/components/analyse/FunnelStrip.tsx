import { ownerColor, ownerInitials } from "@/lib/ownerColor";
import { fmtPct, pct } from "@/lib/analyse";
import { vizRampStep } from "@/lib/viz";

// Funnel-Streifen: eine Zeile je Entitaet (Person/Gesamt) mit Stufen,
// Zwischen-Konversionschips und optionalem Abschlusswert.
//
// Die Stufenbalken tragen die SEQUENZIELLE Orange-Rampe (COMPONENTS.md §9) —
// ein Funnel ist eine Ordnung, keine Kategorie. Die kategoriale Viz-Palette
// waere hier schlicht falsch und wuerde Reihenfolge als Zufall lesen lassen.

export type FunnelStage = { label: string; value: number; sub?: string };

const INT_FMT = new Intl.NumberFormat("de-DE");

function ConversionChip({ current, previous }: { current: number; previous: number }) {
  const label = previous === 0 ? "—" : fmtPct(pct(current, previous));
  return (
    <span
      aria-hidden
      style={{
        alignSelf: "center",
        fontSize: "var(--fs-xs)",
        color: "var(--text-muted)",
        background: "var(--surface-1)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--r-full)",
        padding: "1px 8px",
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      → {label}
    </span>
  );
}

function Stage({
  stage,
  index,
  total,
  firstValue,
}: {
  stage: FunnelStage;
  index: number;
  total: number;
  firstValue: number;
}) {
  const color = vizRampStep(index, total);
  const fillPct = firstValue > 0 ? Math.max(4, (stage.value / firstValue) * 100) : 4;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", minWidth: 0 }}>
      <div className="eyebrow eyebrow-muted" style={{ whiteSpace: "nowrap" }}>
        {stage.label}
      </div>
      <div className="kpi-value" style={{ fontSize: "var(--fs-lg)" }}>
        {INT_FMT.format(stage.value)}
      </div>
      <div style={{ width: 90, height: 4, borderRadius: "var(--r-full)", background: "var(--surface-3)", overflow: "hidden" }}>
        <div style={{ width: `${fillPct}%`, height: "100%", background: color, borderRadius: "var(--r-full)" }} />
      </div>
      {stage.sub && (
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{stage.sub}</div>
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
  const chipColor = color ? { fg: color, bg: "var(--surface-3)" } : ownerColor(label);
  const firstValue = stages[0]?.value ?? 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: "var(--sp-7)",
        flexWrap: "wrap",
        // Hervorgehobene Zeile = eine Surface-Stufe hoeher plus Orange-Rail,
        // dieselbe Sprache wie „ausgewaehlt" in Tabellen.
        ...(highlight
          ? {
              background: "var(--surface-1)",
              borderLeft: "2px solid var(--orange-500)",
              borderRadius: "var(--r-md)",
              padding: "var(--sp-5) var(--sp-6)",
            }
          : {}),
      }}
    >
      {/* Label-Chip */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexShrink: 0, alignSelf: "center" }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: "var(--r-full)",
            background: chipColor.bg,
            color: chipColor.fg,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "var(--fs-xs)",
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {ownerInitials(label)}
        </span>
        <span
          style={{
            fontSize: "var(--fs-base)",
            fontWeight: 600,
            color: "var(--text-primary)",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      </div>

      {/* Stufen + Konversionschips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-5)", alignItems: "flex-end" }}>
        {stages.map((stage, i) => (
          <div key={stage.label} style={{ display: "flex", gap: "var(--sp-5)", alignItems: "flex-end" }}>
            {i > 0 && <ConversionChip current={stage.value} previous={stages[i - 1].value} />}
            <Stage stage={stage} index={i} total={stages.length} firstValue={firstValue} />
          </div>
        ))}
      </div>

      {/* Abschlusswert */}
      {trailing && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", minWidth: 0 }}>
          <div className="eyebrow eyebrow-muted" style={{ whiteSpace: "nowrap" }}>
            {trailing.label}
          </div>
          <div className="kpi-value" style={{ fontSize: "var(--fs-lg)", color: "var(--success-fg)" }}>
            {trailing.value}
          </div>
        </div>
      )}
    </div>
  );
}
