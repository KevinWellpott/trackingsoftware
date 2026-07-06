import Link from "next/link";
import { ChevronRight } from "lucide-react";

// Horizontaler Funnel-Streifen fürs persönliche Dashboard:
// DMs → Antworten → Termine → Setting → Closing → Gewonnen.
// Stages mit href sind verlinkt; flexWrap für Mobile.

export type FunnelStage = {
  label: string;
  value: string;
  sub?: string;
  href?: string;
};

function StageContent({ stage }: { stage: FunnelStage }) {
  return (
    <>
      <div style={{ fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-subtle)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {stage.label}
      </div>
      <div style={{ fontSize: "1.375rem", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.2, color: "var(--text-primary)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
        {stage.value}
      </div>
      {stage.sub && (
        <div style={{ fontSize: "0.6875rem", color: "var(--text-subtle)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {stage.sub}
        </div>
      )}
    </>
  );
}

export function PersonalFunnel({ stages }: { stages: FunnelStage[] }) {
  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: "0.75rem", flexWrap: "wrap" }}>
      {stages.map((s, i) => (
        <div key={s.label} style={{ display: "flex", alignItems: "center", gap: "0.75rem", flex: "1 1 130px", minWidth: 0 }}>
          {s.href ? (
            <Link href={s.href} style={{ textDecoration: "none", minWidth: 0, flex: 1 }}>
              <StageContent stage={s} />
            </Link>
          ) : (
            <div style={{ minWidth: 0, flex: 1 }}>
              <StageContent stage={s} />
            </div>
          )}
          {i < stages.length - 1 && (
            <ChevronRight aria-hidden size={14} color="var(--text-subtle)" style={{ flexShrink: 0 }} />
          )}
        </div>
      ))}
    </div>
  );
}
