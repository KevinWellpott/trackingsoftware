"use client";

import { minToHHMM } from "@/lib/apptTime";
import { ownerColor, ownerInitials } from "@/lib/ownerColor";
import type { TerminEvent } from "@/lib/termine";
import { Phone, Video } from "lucide-react";

// Ein Termin im Kalender.
//
// ── FÜLLUNG = TYP, RAHMEN = STATUS ─────────────────────────────────────────
// Das kehrt die frühere Doktrin um. Sie war richtig, solange die Kopfleiste
// Typ-Chips („Setting" / „Closing") trug — die sind weg, also muss der Typ
// aus dem Chip kommen. Er ist die stabilere Eigenschaft: ein Termin wechselt
// im Laufe eines Tages seinen Status, nie seinen Typ.
//
//   Setting → gedämpftes Grau, heller Text
//   Closing → sehr helles Grau, dunkler Text
//
// „Weiß" (so die Vorgabe) ist bewusst nicht #fff geworden: Reinweiß auf dem
// Canvas #0a0a0b ergibt ~19:1 und blendet in einem Raster mit dutzenden Chips.
// #dedee2 hält den Typ-Kontrast, ohne die Woche zum Leuchtkasten zu machen.
//
// Der Rahmen ist GESTRICHELT, sobald ein Ergebnis feststeht — durchgezogen
// heißt „steht noch an". Farbe wie überall: Grün weiter, Rot geplatzt/verloren,
// Gold nachfassen. Die Zuordnung liegt vollständig in lib/terminMeta.ts.
//
// Der Inhalt richtet sich nach der verfuegbaren Hoehe: ein 30-Minuten-Setting
// hat keinen Platz fuer drei Zeilen. Statt abzuschneiden faellt die Karte auf
// weniger Zeilen zurueck (Ellipse statt Ueberlauf).

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

// ── Owner-Kennzeichnung ────────────────────────────────────────────────────
// Im Kalender soll direkt ablesbar sein, WER den Termin gelegt hat. Seit die
// Personen-Chips aus der Kopfleiste raus sind, ist der Avatar die EINZIGE
// Personen-Anzeige im Raster — er darf in keiner Grösse wegfallen.
//
// Der Platz gibt das nicht überall gleich her: Ein 30-Minuten-Setting ist im
// gestrafften Wochenraster knapp 28 px hoch (xs), ein Chip in der
// Monatsansicht rund 17 px. Statt den Chip zu sprengen, skaliert der Avatar
// mit und zeigt nur in der grössten Variante beide Initialen — darunter genau
// einen Buchstaben, der zusammen mit der Owner-Farbe reicht, um Personen
// auseinanderzuhalten. Der volle Name steht im title des Chips.
const AVATAR: Record<ChipSize, { px: number; font: string; letters: 1 | 2 }> = {
  xs: { px: 13, font: "0.5rem", letters: 1 },
  sm: { px: 15, font: "0.5625rem", letters: 1 },
  md: { px: 17, font: "0.625rem", letters: 2 },
};

function OwnerAvatar({
  username,
  size,
  style,
}: {
  username: string;
  size: ChipSize;
  style?: React.CSSProperties;
}) {
  const { px, font, letters } = AVATAR[size];
  const oc = ownerColor(username);
  const initials = ownerInitials(username);
  return (
    <span
      // Der Name steht bereits im title des Chips — der Avatar wiederholt ihn
      // nur farblich und wuerde als eigener Screenreader-Text stoeren.
      aria-hidden
      style={{
        width: px,
        height: px,
        flexShrink: 0,
        borderRadius: "var(--r-full)",
        background: oc.bg,
        color: oc.fg,
        // Der Flaechen-Tint hat nur 14 % Deckung und verschwindet auf dem
        // Chip-Hintergrund — auf dem hellen Closing-Chip erst recht. Der Ring
        // traegt die Owner-Farbe deshalb als Kontur; sie bleibt auch bei 13 px
        // und auf beiden Fuellungen erkennbar.
        boxShadow: `inset 0 0 0 1px ${oc.fg}`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: font,
        fontWeight: 600,
        lineHeight: 1,
        ...style,
      }}
    >
      {letters === 1 ? initials.slice(0, 1) : initials}
    </span>
  );
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
      data-kind={event.kind}
      data-tone={event.outline.tone}
      data-dashed={event.outline.dashed}
      data-dimmed={event.outline.dimmed}
      data-terminal={event.terminal}
      data-past={isPast}
      data-dragging={isDragging}
      title={`${zeit} · ${kindLabel(event.kind)} · ${event.title}${
        event.company ? ` · ${event.company}` : ""
      } · ${event.statusPill.label}${event.assignee ? ` · ${event.assignee.username}` : ""}`}
      style={style}
      {...handlers}
    >
      {effective === "xs" ? (
        <>
          {/* Der Typ steht hier NICHT mehr als Kuerzel: die Fuellung sagt ihn
              bereits, und die eine Zeile braucht jedes Pixel fuer den Namen. */}
          <span style={{ fontWeight: 600, flexShrink: 0 }}>{zeit}</span>
          <span style={{ fontWeight: 600, flex: 1, minWidth: 0 }}>{event.title}</span>
          {event.assignee && <OwnerAvatar username={event.assignee.username} size="xs" />}
        </>
      ) : (
        <>
          {/* Der Avatar sitzt in der Kopfzeile statt in einer eigenen Zeile —
              sm hat nur Platz fuer zwei Zeilen. Der Typ schrumpft vor ihm,
              damit er in schmalen Wochenspalten nicht abgeschnitten wird. */}
          <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <span style={{ fontWeight: 600, flexShrink: 0 }}>{zeit}</span>
            <span
              style={{
                opacity: 0.7,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              · {kindLabel(event.kind)}
            </span>
            {Icon && <Icon size={9} style={{ flexShrink: 0, opacity: 0.8 }} />}
            {event.assignee && (
              <OwnerAvatar
                username={event.assignee.username}
                size={effective}
                style={{ marginLeft: "auto" }}
              />
            )}
          </span>
          <span style={{ fontWeight: 600 }}>{event.title}</span>
          {effective === "md" && event.company && <span style={{ opacity: 0.8 }}>{event.company}</span>}
        </>
      )}
    </div>
  );
}
