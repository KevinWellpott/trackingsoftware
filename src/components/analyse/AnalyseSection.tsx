import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";

// Sektions-Karte des Analyse-Bereichs: Icon + Titel links, Meta rechts.
// Das Icon sitzt ohne Kasten direkt im Text — ein Icon-Chip pro Sektion waere
// im Ember-Glass-System zu viel Flaeche fuer zu wenig Information.

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
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", marginBottom: "var(--sp-7)" }}>
        {Icon && <Icon size={16} color="var(--text-muted)" style={{ flexShrink: 0 }} />}
        <span
          style={{
            fontSize: "var(--fs-md)",
            fontWeight: 600,
            letterSpacing: "var(--ls-tight)",
            color: "var(--text-primary)",
          }}
        >
          {title}
        </span>
        {meta && (
          <span className="eyebrow eyebrow-muted" style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>
            {meta}
          </span>
        )}
      </div>
      {children}
    </Card>
  );
}

// Hinweis-Karte, wenn eine benoetigte DB-Migration noch fehlt.
export function MigrationHint({ children }: { children: ReactNode }) {
  return (
    <Card
      style={{
        background: "var(--info-bg)",
        borderColor: "transparent",
        borderLeft: "2px solid var(--info)",
        color: "var(--info-fg)",
      }}
      padding="var(--sp-6) var(--sp-7)"
    >
      <span style={{ fontSize: "var(--fs-base)", fontWeight: 500 }}>{children}</span>
    </Card>
  );
}
