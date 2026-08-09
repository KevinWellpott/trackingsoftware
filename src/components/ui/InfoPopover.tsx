"use client";

import { AnchoredPopover, useAnchor } from "@/components/ui/AnchoredPopover";
import { Info } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Erklaertext hinter einem Info-Icon statt dauerhaft unter der Sektion.
 *
 * Warum: Die Analyse-Sektionen tragen jede eine Fussnote, die erklaert, gegen
 * welchen Nenner gerechnet wird und welche Faelle draussen bleiben. Fachlich
 * ist das unverzichtbar — beim taeglichen Lesen der Zahlen steht es aber im
 * Weg. Ein Icon direkt am Titel haelt die Erklaerung dort, wo die Frage
 * entsteht, ohne dass sie jede Sektion um drei Zeilen verlaengert.
 *
 * Das Popover liegt UEBER der Seite (AnchoredPopover), es schiebt also nichts
 * weg — ein inline aufklappender Text haette dasselbe Platzproblem nur
 * verschoben.
 */
export function InfoPopover({
  children,
  label = "Erklärung",
  width = 320,
}: {
  children: ReactNode;
  /** Vorgelesener Name des Knopfes; sichtbar wird er nur als Tooltip. */
  label?: string;
  width?: number;
}) {
  const { anchor, ref, toggle, close } = useAnchor();
  const isOpen = anchor !== null;

  return (
    <>
      <button
        type="button"
        ref={ref as React.Ref<HTMLButtonElement>}
        onClick={(e) => {
          // Das Icon sitzt in einer zuklappbaren Sektion im <summary>. Ohne
          // preventDefault wuerde jeder Klick auf die Erklaerung die Sektion
          // auf- oder zuklappen — man kaeme an den Text nie heran, ohne den
          // Inhalt darunter verschwinden zu lassen. stopPropagation haelt den
          // Klick zusaetzlich von umgebenden Zeilen-Handlern fern.
          e.preventDefault();
          e.stopPropagation();
          toggle();
        }}
        aria-label={label}
        aria-expanded={isOpen}
        title={label}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 20,
          height: 20,
          flexShrink: 0,
          padding: 0,
          border: "none",
          borderRadius: "var(--r-full)",
          background: isOpen ? "var(--surface-3)" : "transparent",
          color: isOpen ? "var(--text-secondary)" : "var(--text-disabled)",
          cursor: "pointer",
          transition: "color var(--dur-2) var(--ease-out), background var(--dur-2) var(--ease-out)",
        }}
      >
        <Info size={13} />
      </button>

      {anchor && (
        <AnchoredPopover
          anchor={anchor}
          onClose={close}
          label={label}
          width={width}
          align="end"
          style={{ padding: "var(--sp-5) var(--sp-6)" }}
        >
          <div
            style={{
              fontSize: "var(--fs-xs)",
              lineHeight: 1.6,
              color: "var(--text-secondary)",
            }}
          >
            {children}
          </div>
        </AnchoredPopover>
      )}
    </>
  );
}
