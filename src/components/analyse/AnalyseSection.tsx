import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ChevronDown } from "lucide-react";
import { InfoPopover } from "@/components/ui/InfoPopover";

// Sektions-Karte des Analyse-Bereichs: Icon + Titel links, Meta rechts.
// Das Icon sitzt ohne Kasten direkt im Text — ein Icon-Chip pro Sektion waere
// im Ember-Glass-System zu viel Flaeche fuer zu wenig Information.
//
// Zwei Zusaetze, die aus der Praxis kamen:
// • `info` — der Erklaertext wandert hinter ein Icon am Titel. Er bleibt
//   erreichbar, verlaengert die Sektion aber nicht mehr um drei Zeilen.
// • `collapsible` — Sektionen lassen sich zuklappen. Bewusst ueber <details>
//   statt React-State: Die Karte bleibt damit eine Server-Komponente, das
//   Zuklappen funktioniert ohne JavaScript und der Browser merkt sich nichts,
//   was der Nutzer beim naechsten Aufruf nicht erwarten wuerde.

function SectionHead({
  title,
  meta,
  icon: Icon,
  info,
  chevron = false,
}: {
  title: string;
  meta?: string;
  icon?: LucideIcon;
  info?: ReactNode;
  chevron?: boolean;
}) {
  return (
    <>
      {Icon && <Icon size={16} color="var(--text-muted)" style={{ flexShrink: 0, alignSelf: "center" }} />}
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
      {info && (
        // Kein onClick-Wrapper hier: AnalyseSection ist eine SERVER-Komponente,
        // und ein Event-Handler an einem DOM-Element waere dort ungueltig
        // („Event handlers cannot be passed to Client Component props") — der
        // Fehler faellt erst beim Rendern auf, weil alle Analyse-Seiten
        // dynamisch sind und nie vorgerendert werden.
        // Dass der Klick auf das Icon die Sektion nicht auf- oder zuklappt,
        // regelt InfoPopover selbst; es ist ohnehin eine Client-Komponente.
        <span style={{ display: "inline-flex", alignSelf: "center" }}>
          <InfoPopover label={`${title}: Erklärung`}>{info}</InfoPopover>
        </span>
      )}
      {meta && (
        <span className="eyebrow eyebrow-muted" style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>
          {meta}
        </span>
      )}
      {chevron && (
        <ChevronDown
          size={14}
          className="section-chevron"
          style={{ flexShrink: 0, alignSelf: "center", color: "var(--text-muted)", marginLeft: meta ? 0 : "auto" }}
        />
      )}
    </>
  );
}

const HEAD_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "var(--sp-3) var(--sp-4)",
  flexWrap: "wrap",
};

export function AnalyseSection({
  title,
  meta,
  icon,
  info,
  collapsible = false,
  defaultOpen = true,
  children,
}: {
  title: string;
  meta?: string;
  icon?: LucideIcon;
  /** Erklaertext hinter dem Info-Icon am Titel. */
  info?: ReactNode;
  /** Sektion zuklappbar machen. */
  collapsible?: boolean;
  /** Nur bei `collapsible`: Startzustand. */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  if (collapsible) {
    return (
      <Card>
        <details open={defaultOpen} className="analyse-section">
          <summary
            style={{
              ...HEAD_ROW,
              cursor: "pointer",
              listStyle: "none",
              marginBottom: 0,
            }}
          >
            <SectionHead title={title} meta={meta} icon={icon} info={info} chevron />
          </summary>
          <div style={{ marginTop: "var(--sp-7)" }}>{children}</div>
        </details>
      </Card>
    );
  }

  return (
    <Card>
      {/* Auf schmalen Viewports rutscht die Meta-Angabe unter den Titel, statt
          beide auf je zwei Zeilen zu quetschen. */}
      <div style={{ ...HEAD_ROW, marginBottom: "var(--sp-7)" }}>
        <SectionHead title={title} meta={meta} icon={icon} info={info} />
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
