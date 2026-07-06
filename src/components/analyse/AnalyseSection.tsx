import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";

// Einheitliche Sektions-Karte des Analyse-Bereichs: Titel-Zeile (Icon + Titel +
// optionaler Meta-Text) über dem Inhalt. Rein serverseitig gerendert.

export function AnalyseSection({
  title,
  meta,
  icon: Icon,
  children,
}: {
  title: string;
  meta?: string;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.875rem" }}>
        {Icon && (
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              background: "var(--surface-200)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon size={13} color="var(--brand-500)" />
          </div>
        )}
        <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary)" }}>{title}</span>
        {meta && <span style={{ marginLeft: "auto", fontSize: "0.6875rem", color: "var(--text-subtle)" }}>{meta}</span>}
      </div>
      {children}
    </Card>
  );
}

// Info-Karte, wenn eine benötigte DB-Migration noch fehlt.
export function MigrationHint({ children }: { children: ReactNode }) {
  return (
    <Card
      style={{
        background: "var(--color-info-bg)",
        border: "1px solid var(--color-info-border)",
        color: "var(--color-info-text)",
      }}
    >
      <span style={{ fontSize: "0.8125rem", fontWeight: 600 }}>{children}</span>
    </Card>
  );
}
