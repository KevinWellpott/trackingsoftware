"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

// Zuklappbare Unter-Sektion innerhalb einer Settings-Karte.
//
// Warum nicht <details> wie in AnalyseSection: Dort ist die Karte eine
// SERVER-Komponente, und <details> ist der einzige Weg, ohne JavaScript
// zuzuklappen. Hier sind beide Karten ohnehin Client-Komponenten (die
// Fehleranzeige braucht useActionState), und React-State erspart die
// zusätzlichen ::-webkit-details-marker-Regeln in globals.css, die für die
// Settings-Seite sonst neu entstehen müssten.
//
// Der Zustand ist bewusst NICHT persistent: Was zugeklappt startet, startet
// beim nächsten Aufruf wieder zugeklappt. Eine Einstellung, die je nach
// vorherigem Besuch woanders steht, findet niemand wieder.

export function Collapsible({
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** Kurze Angabe rechts im Kopf — z. B. „9 Werte" oder „2 angepasst". */
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-4)",
          width: "100%",
          padding: 0,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "var(--text-secondary)",
          fontFamily: "inherit",
        }}
      >
        <ChevronDown
          size={14}
          style={{
            flexShrink: 0,
            color: "var(--text-muted)",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform var(--transition-fast)",
          }}
        />
        <span
          className="eyebrow eyebrow-muted"
          style={{ color: open ? "var(--text-secondary)" : undefined }}
        >
          {title}
        </span>
        {meta && (
          <span style={{ marginLeft: "auto", fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
            {meta}
          </span>
        )}
      </button>
      {open && <div style={{ marginTop: "var(--sp-6)" }}>{children}</div>}
    </div>
  );
}
