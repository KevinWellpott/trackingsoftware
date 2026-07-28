"use client";

import { formatTermin } from "@/lib/apptTime";
import { ownerColor, ownerInitials } from "@/lib/ownerColor";
import { DURATION_MIN, type TerminEvent } from "@/lib/termine";
import { EUR_FMT, SOURCE_META } from "@/lib/terminMeta";
import { ArrowRight, Phone, Video, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// Kurzinfo zu einem Termin. Positionierung + Dismiss folgen exakt dem
// CalendarPopover aus ui/DatePicker.tsx (Portal + position:fixed), damit das
// Popover auch in den scrollbaren Kalender-Containern richtig sitzt.

const WIDTH = 280;
const EST_HEIGHT = 230;

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

  const source = event.sourceType ? SOURCE_META[event.sourceType] : null;
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
        {source && (
          <span
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
              style={{ width: 6, height: 6, borderRadius: "var(--r-full)", background: source.dot }}
            />
            {source.label}
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

      {event.assignees.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", marginBottom: "0.625rem" }}>
          {event.assignees.slice(0, 5).map((a, i) => {
            const oc = ownerColor(a.username);
            return (
              <span
                key={a.user_id}
                title={a.username}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: oc.bg,
                  color: oc.fg,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.5625rem",
                  fontWeight: 600,
                  border: "2px solid var(--surface-100)",
                  marginLeft: i === 0 ? 0 : -7,
                }}
              >
                {ownerInitials(a.username)}
              </span>
            );
          })}
        </div>
      )}

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
        {!event.meetLink && event.meetingKind === "telefon" && (
          <span
            title="Termin findet telefonisch statt"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
              padding: "0.4rem 0.75rem",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "var(--surface-50)",
              color: "var(--text-muted)",
              fontSize: "0.8125rem",
              fontWeight: 600,
            }}
          >
            <Phone size={13} /> Telefon
          </span>
        )}
      </div>
    </div>,
    document.body,
  );
}
