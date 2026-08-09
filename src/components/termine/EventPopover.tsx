"use client";

import { formatTermin } from "@/lib/apptTime";
import { channelColor, channelLabel } from "@/lib/channels";
import { ownerColor, ownerInitials } from "@/lib/ownerColor";
import { DURATION_MIN, type TerminEvent } from "@/lib/termine";
import { EUR_FMT } from "@/lib/terminMeta";
import { ArrowRight, Phone, Video, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// Kurzinfo zu einem Termin. Positionierung + Dismiss folgen exakt dem
// CalendarPopover aus ui/DatePicker.tsx (Portal + position:fixed), damit das
// Popover auch in den scrollbaren Kalender-Containern richtig sitzt.

const WIDTH = 280;
const EST_HEIGHT = 230;

function Owner({ username }: { username: string }) {
  const oc = ownerColor(username);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-4)",
        marginBottom: "0.625rem",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 22,
          height: 22,
          flexShrink: 0,
          borderRadius: "var(--r-full)",
          background: oc.bg,
          color: oc.fg,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "0.5625rem",
          fontWeight: 600,
        }}
      >
        {ownerInitials(username)}
      </span>
      <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{username}</span>
    </div>
  );
}

export function EventPopover({
  event,
  anchor,
  onClose,
}: {
  event: TerminEvent;
  anchor: DOMRect;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onScroll(e: Event) {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const below = anchor.bottom + 6 + EST_HEIGHT <= window.innerHeight || anchor.top - 6 - EST_HEIGHT < 0;
  const top = below ? anchor.bottom + 6 : anchor.top - 6 - EST_HEIGHT;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - WIDTH - 8));

  // Quelle über die Kanal-Registry statt über eine eigene Tabelle: SOURCE_META
  // kannte die seit Migration 0029 wählbaren Kanäle (Social Media, Ads,
  // Sonstige) nicht — ein Social-Media-Termin rendert dort ohne Label und
  // ohne Farbpunkt. Ein neuer Kanal ist jetzt ein Registry-Eintrag, sonst nichts.
  const sourceLabel = event.kind === "setting" ? channelLabel(event.sourceType) : null;
  const typLabel = event.kind === "setting" ? "Setting" : "Closing";

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`Termin ${event.title}`}
      // Glass-Popover-Rezept (DESIGN.md §4.2) — Popover sind Glas, Dialoge solid.
      className="glass-popover"
      style={{
        position: "fixed",
        top,
        left,
        zIndex: 140,
        width: WIDTH,
        boxSizing: "border-box",
        padding: "var(--sp-6)",
        animation: "fade-up var(--dur-2) var(--ease-out) both",
      }}
    >
      {/* Typ + Schließen */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <span className="eyebrow eyebrow-muted">
          {typLabel} · {DURATION_MIN[event.kind]} min
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Schließen"
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            border: "none",
            background: "transparent",
            color: "var(--text-subtle)",
            cursor: "pointer",
            padding: 2,
          }}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ fontSize: "0.9375rem", fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text-primary)" }}>
        {event.title}
      </div>
      {event.company && (
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 1 }}>{event.company}</div>
      )}

      <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: 600, margin: "0.5rem 0" }}>
        {formatTermin(event.at)}
      </div>

      {/* Status + Quelle */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.625rem" }}>
        <span
          className="badge"
          style={{
            color: event.statusPill.color,
            backgroundColor: event.statusPill.bg,
            border: `1px solid ${event.statusPill.border}`,
          }}
        >
          {event.statusPill.label}
        </span>
        {sourceLabel && (
          <span
            title={event.sourceDetail ? `Quelle: ${event.sourceDetail}` : undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--sp-3)",
              fontSize: "var(--fs-xs)",
              color: "var(--text-muted)",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: "var(--r-full)",
                background: channelColor(event.sourceType),
              }}
            />
            {sourceLabel}
          </span>
        )}
        {event.dealVolume != null && event.status === "gewonnen" && (
          <span
            className="tnum"
            style={{ fontSize: "var(--fs-sm)", fontWeight: 500, color: "var(--success-fg)" }}
          >
            {EUR_FMT.format(event.dealVolume)}
          </span>
        )}
      </div>

      {/* Zuständige Person: genau eine. Im Popover ist Platz für den
          ausgeschriebenen Namen — im Chip muss die Farbe allein tragen. */}
      {event.assignee && <Owner username={event.assignee.username} />}

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <Link
          href={event.href}
          style={{
            flex: 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.35rem",
            padding: "0.4rem 0.75rem",
            borderRadius: "var(--r-full)",
            background: "var(--grad-cta)",
            color: "var(--text-on-accent)",
            boxShadow: "var(--shadow-btn-primary)",
            fontSize: "0.8125rem",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Öffnen <ArrowRight size={13} />
        </Link>
        {event.meetLink && (
          <button
            type="button"
            onClick={() => window.open(event.meetLink as string, "_blank", "noopener,noreferrer")}
            title="Meet öffnen"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
              padding: "0.4rem 0.75rem",
              borderRadius: "var(--r-full)",
              border: "1px solid var(--border-accent)",
              background: "var(--accent-muted)",
              color: "var(--orange-300)",
              fontSize: "0.8125rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <Video size={13} /> Meet
          </button>
        )}
        {/* Telefon-Termin: die NUMMER ist der Knopf. Genau dafür gibt es
            `setting_calls.phone` (Migration 0029) — wer kurzfristig für einen
            Kollegen einspringt, hatte hier bisher nur das Wort „Telefon".
            Ohne Nummer bleibt der stille Hinweis, damit die Lücke auffällt. */}
        {!event.meetLink && event.meetingKind === "telefon" && (
          <a
            href={event.phone ? `tel:${event.phone.replace(/[^\d+]/g, "")}` : undefined}
            title={event.phone ? "Anrufen" : "Telefon-Termin ohne hinterlegte Nummer"}
            className={event.phone ? "tnum" : undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
              padding: "0.4rem 0.75rem",
              borderRadius: "var(--radius-sm)",
              border: `1px solid ${event.phone ? "var(--border-strong)" : "var(--border)"}`,
              background: "var(--surface-50)",
              color: event.phone ? "var(--text-primary)" : "var(--text-muted)",
              fontSize: "0.8125rem",
              fontWeight: 600,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            <Phone size={13} /> {event.phone ?? "Nummer fehlt"}
          </a>
        )}
      </div>
    </div>,
    document.body,
  );
}
