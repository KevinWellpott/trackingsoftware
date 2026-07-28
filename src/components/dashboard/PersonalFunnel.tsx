import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { vizRampStep } from "@/lib/viz";

// Funnel-Streifen: DM → Antwort → Termin → Setting → Closing → Gewonnen.
//
// Die Stufen tragen die SEQUENZIELLE Orange-Rampe (DESIGN.md §3.7) als 2px-Rail,
// nicht die kategoriale Palette — ein Funnel ist eine Ordnung, keine Kategorie.
// Die Rampe laeuft von tief nach hell, damit der Abschluss am staerksten glueht.

export type FunnelStage = {
  label: string;
  value: string;
  sub?: string;
  href?: string;
};

function StageContent({ stage, rail }: { stage: FunnelStage; rail: string }) {
  return (
    <div
      style={{
        borderLeft: `2px solid ${rail}`,
        paddingLeft: "var(--sp-5)",
        minWidth: 0,
      }}
    >
      <div
        className="eyebrow eyebrow-muted"
        style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
      >
        {stage.label}
      </div>
      <div
        className="kpi-value"
        style={{ fontSize: "var(--fs-xl)", whiteSpace: "nowrap", marginTop: "var(--sp-2)" }}
      >
        {stage.value}
      </div>
      {stage.sub && (
        <div
          style={{
            fontSize: "var(--fs-xs)",
            color: "var(--text-muted)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            marginTop: 2,
          }}
        >
          {stage.sub}
        </div>
      )}
    </div>
  );
}

export function PersonalFunnel({ stages }: { stages: FunnelStage[] }) {
  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: "var(--sp-5)", flexWrap: "wrap" }}>
      {stages.map((s, i) => {
        // Tief → hell: die letzte Stufe (Abschluss) glueht am staerksten.
        const rail = vizRampStep(i + 1, stages.length + 1);
        return (
          <div
            key={s.label}
            style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)", flex: "1 1 130px", minWidth: 0 }}
          >
            {s.href ? (
              <Link href={s.href} style={{ textDecoration: "none", minWidth: 0, flex: 1 }}>
                <StageContent stage={s} rail={rail} />
              </Link>
            ) : (
              <div style={{ minWidth: 0, flex: 1 }}>
                <StageContent stage={s} rail={rail} />
              </div>
            )}
            {i < stages.length - 1 && (
              <ChevronRight aria-hidden size={14} color="var(--text-disabled)" style={{ flexShrink: 0 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
