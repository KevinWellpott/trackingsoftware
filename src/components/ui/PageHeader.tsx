import type { ReactNode } from "react";

// Einheitlicher Seitenkopf fuer alle Views.
//
// Anatomie: Eyebrow (12px uppercase, Orange) → Seiten-Titel (22px/600,
// --ls-display) → optionale Meta-Zeile · rechts der Aktionsbereich.
// Genau EIN Primaer-CTA pro View gehoert hierher; alles Weitere ist
// Sekundaer oder Ghost (DESIGN.md §3.8).

export function PageHeader({
  eyebrow,
  title,
  meta,
  actions,
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  meta?: ReactNode;
  /** Aktionsbereich rechts — hoechstens eine Signature-Pill. */
  actions?: ReactNode;
  /** Zusatzinhalt unter dem Kopf (z. B. Filterleiste). */
  children?: ReactNode;
}) {
  return (
    <header style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      <div
        className="section-header-mobile"
        style={{ display: "flex", alignItems: "flex-end", gap: "var(--sp-6)", flexWrap: "wrap" }}
      >
        <div style={{ minWidth: 0 }}>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1 className="page-title" style={{ margin: eyebrow ? "var(--sp-3) 0 0" : 0 }}>
            {title}
          </h1>
          {meta && (
            <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", marginTop: "var(--sp-3)" }}>
              {meta}
            </div>
          )}
        </div>
        {actions && (
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-4)",
              flexWrap: "wrap",
            }}
          >
            {actions}
          </div>
        )}
      </div>
      {children}
    </header>
  );
}

/** Leerzustand: ein Satz Zustand + eine Aktion (COMPONENTS.md §14.1). */
export function EmptyState({
  icon,
  message,
  action,
}: {
  icon?: ReactNode;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon}
      <p style={{ maxWidth: 42 * 8 }}>{message}</p>
      {action}
    </div>
  );
}
