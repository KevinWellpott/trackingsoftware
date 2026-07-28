"use client";

import { minToHHMM } from "@/lib/apptTime";
import type { Tone } from "@/lib/terminMeta";
import type { TerminEvent } from "@/lib/termine";
import { Phone, Video } from "lucide-react";

// Ein Termin im Kalender.
//
// FARBE KODIERT DEN STATUS, nicht den Typ: Gruen heisst „gewonnen", Rot
// „verloren/No-Show", Gold „nachfassen", Neutral „offen" — dieselbe Bedeutung
// wie auf den Ergebnis-Buttons (DESIGN.md §5.2). Vorher stand die Farbe fuer
// Setting vs. Closing, wodurch ein VERLORENES Closing gruen war und daneben
// ein roter Status-Pill stand. Diese Widerspruechlichkeit ist damit weg.
//
// Setting vs. Closing steht jetzt als Text im Chip — bei sehr kurzen Slots
// als Kuerzel, weil dort schlicht kein Platz ist.
//
// Der Inhalt richtet sich nach der verfuegbaren Hoehe: ein 30-Minuten-Setting
// hat keinen Platz fuer drei Zeilen. Statt abzuschneiden faellt die Karte auf
// weniger Zeilen zurueck (Ellipse statt Ueberlauf).

export function eventVars(tone: Tone): React.CSSProperties {
  return {
    ["--event-bg" as string]: `var(--event-${tone}-bg)`,
    ["--event-border" as string]: `var(--event-${tone}-border)`,
    ["--event-text" as string]: `var(--event-${tone}-text)`,
    ["--event-accent" as string]: `var(--event-${tone}-accent)`,
  };
}

/** Typ-Beschriftung: ausgeschrieben, wo Platz ist — sonst als Kuerzel. */
export function kindLabel(kind: TerminEvent["kind"], short = false): string {
  if (kind === "setting") return short ? "S" : "Setting";
  return short ? "C" : "Closing";
}

/** xs = eine Zeile (Zeit + Name), sm = Zeit / Name, md = zusätzlich Firma. */
export type ChipSize = "xs" | "sm" | "md";

/** Passende Variante zur verfügbaren Höhe in px. */
export function chipSizeFor(heightPx: number): ChipSize {
  if (heightPx < 30) return "xs";
  if (heightPx < 56) return "sm";
  return "md";
}

type Props = {
  event: TerminEvent;
  /** Überschreibt die Startzeit während des Ziehens. */
  previewStartMin?: number;
  size?: ChipSize;
  /** Monatsansicht: immer einzeilig. */
  compact?: boolean;
  isPast?: boolean;
  isDragging?: boolean;
  style?: React.CSSProperties;
  className?: string;
  onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove?: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp?: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel?: () => void;
};

export function EventChip({
  event,
  previewStartMin,
  size = "md",
  compact = false,
  isPast = false,
  isDragging = false,
  style,
  className,
  ...handlers
}: Props) {
  const startMin = previewStartMin ?? event.startMin;
  const zeit = minToHHMM(startMin);
  const Icon = event.meetingKind === "telefon" ? Phone : event.meetLink ? Video : null;
  const effective: ChipSize = compact ? "xs" : size;

  return (
    <div
      role="button"
      tabIndex={0}
      className={`cal-event${className ? ` ${className}` : ""}`}
      data-size={effective}
      data-terminal={event.terminal}
      data-past={isPast}
      data-hidden={event.hidden}
      data-dragging={isDragging}
      title={`${zeit} · ${kindLabel(event.kind)} · ${event.title}${
        event.company ? ` · ${event.company}` : ""
      } · ${event.statusPill.label}`}
      style={{ ...eventVars(event.statusPill.tone), ...style }}
      {...handlers}
    >
      {effective === "xs" ? (
        <>
          <span style={{ fontWeight: 600, flexShrink: 0 }}>{zeit}</span>
          <span style={{ flexShrink: 0, opacity: 0.65 }}>{kindLabel(event.kind, true)}</span>
          <span style={{ fontWeight: 600, flex: 1 }}>{event.title}</span>
        </>
      ) : (
        <>
          <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <span style={{ fontWeight: 600 }}>{zeit}</span>
            <span style={{ opacity: 0.65 }}>· {kindLabel(event.kind)}</span>
            {Icon && <Icon size={9} style={{ flexShrink: 0, opacity: 0.8 }} />}
          </span>
          <span style={{ fontWeight: 600 }}>{event.title}</span>
          {effective === "md" && event.company && <span style={{ opacity: 0.75 }}>{event.company}</span>}
        </>
      )}
    </div>
  );
}
