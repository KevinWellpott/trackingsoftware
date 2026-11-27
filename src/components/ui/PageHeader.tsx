import type { ReactNode } from "react";

// Einheitlicher Seitenkopf: die klebende Glasleiste (globals.css, .page-bar).
//
// Anatomie: Eyebrow (11px, Text 3) ueber dem Titel (17px/600) · Meta daneben
// in Text 2 · rechts die Aktionen. Genau EIN Primaerknopf pro View gehoert
// hierher; alles Weitere ist Sekundaer oder Ghost.
//
// Die Leiste ist KEIN Kind eines eigenen Wrappers, sondern steht direkt in der
// Seite: Ein klebendes Element klebt nur innerhalb seines Elternblocks — in
// einem Wrapper, der genau so hoch ist wie die Leiste, kaeme es nie zum
// Kleben. Zusatzinhalt (`children`, z. B. eine Reiterleiste) folgt deshalb
// als Geschwister und bekommt den Abstand der Seite.

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
  /** Aktionsbereich rechts — hoechstens ein Primaerknopf. */
  actions?: ReactNode;
  /** Zusatzinhalt unter dem Kopf (z. B. Filterleiste). */
  children?: ReactNode;
}) {
  return (
    <>
      <header className="page-bar glass">
        <div className="page-bar-title">
          {eyebrow && <div className="page-bar-eyebrow">{eyebrow}</div>}
          <div className="page-bar-tt">
            <h1 className="page-title">{title}</h1>
            {meta && <span className="page-bar-meta">{meta}</span>}
          </div>
        </div>
        {actions && <div className="page-bar-actions">{actions}</div>}
      </header>
      {children}
    </>
  );
}

/** Leerzustand: ein Satz Zustand + eine Aktion. */
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
