"use client";

import { formatTermin } from "@/lib/apptTime";
import { ownerColor, ownerInitials } from "@/lib/ownerColor";
import type { TerminEvent } from "@/lib/termine";
import { EUR_FMT, SOURCE_META } from "@/lib/terminMeta";
import { Input } from "@/components/ui/Input";
import { CalendarClock, CalendarX2, Phone, Search, Video } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { eventVars, kindLabel } from "./EventChip";

// Die „versteckte" Listenansicht — ersetzt die früheren getrennten Queues für
// Setting und Closing. Kartenlayout und Verhalten bleiben wie gewohnt, ergänzt
// um eine Typ-Markierung in Event-Farbe und den Abschnitt „Ohne Termin".

// Hinweis zur Farblogik: Der linke Balken einer Zeile traegt den STATUS-Ton
// (gruen = gewonnen, rot = verloren/No-Show, gold = nachfassen, neutral =
// offen) — dieselbe Bedeutung wie im Kalender und auf den Ergebnis-Buttons.
// Typ und Quelle stehen als stiller Text, die Quelle mit ihrem Kanal-Dot.

export function TermineList({ events, ohneTermin }: { events: TerminEvent[]; ohneTermin: TerminEvent[] }) {
  const [search, setSearch] = useState("");

  const [visible, visibleOhne] = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [events, ohneTermin];
    const match = (e: TerminEvent) =>
      [e.title, e.company].filter(Boolean).join(" ").toLowerCase().includes(q);
    return [events.filter(match), ohneTermin.filter(match)];
  }, [events, ohneTermin, search]);

  const total = visible.length + visibleOhne.length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.875rem" }}>
        <div style={{ position: "relative", flex: "1 1 200px", maxWidth: 320 }}>
          <Search
            size={13}
            style={{
              position: "absolute",
              left: "0.625rem",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-subtle)",
              pointerEvents: "none",
            }}
          />
          <Input
            type="search"
            placeholder="Lead oder Firma…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minHeight: 32, padding: "0.35rem 0.75rem 0.35rem 2rem", fontSize: "0.8125rem" }}
          />
        </div>
        <span style={{ fontSize: "0.75rem", color: "var(--text-subtle)", whiteSpace: "nowrap" }}>
          {total.toLocaleString("de-DE")} Termine
        </span>
      </div>

      {total === 0 ? (
        <EmptyState />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
          {visible.map((e) => (
            <EventRow key={e.id} event={e} />
          ))}

          {visibleOhne.length > 0 && (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  marginTop: "0.75rem",
                  paddingTop: "0.75rem",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <CalendarX2 size={14} style={{ color: "var(--text-subtle)" }} />
                <span
                  style={{
                    fontSize: "0.6875rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--text-subtle)",
                  }}
                >
                  Ohne Termin · {visibleOhne.length}
                </span>
              </div>
              {visibleOhne.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function EventRow({ event }: { event: TerminEvent }) {
  const source = event.sourceType ? SOURCE_META[event.sourceType] : null;
  const termin = formatTermin(event.at);

  return (
    <Link href={event.href} style={{ textDecoration: "none" }} className="organic-list-card-link">
      <div
        className="organic-list-card"
        style={{
          ...eventVars(event.statusPill.tone),
          display: "flex",
          alignItems: "center",
          gap: "0.875rem",
          flexWrap: "wrap",
          background: "var(--surface-100)",
          border: "1px solid var(--border)",
          borderLeft: "3px solid var(--event-accent)",
          borderRadius: "var(--radius-md)",
          padding: "0.875rem 1.125rem",
          transition: "border-color 0.15s, box-shadow 0.15s",
          opacity: event.hidden ? 0.7 : 1,
        }}
      >
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.2rem" }}>
            <span
              style={{
                fontSize: "0.9375rem",
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: "var(--text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {event.title}
            </span>
            {/* Typ und Quelle sind Kategorien, keine Zustaende — sie laufen
                deshalb als stiller Text mit Kanal-Dot, nicht als Pill.
                Der einzige farbige Pill der Zeile ist der Status. */}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--sp-3)",
                fontSize: "var(--fs-xs)",
                color: "var(--text-muted)",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {kindLabel(event.kind)}
              {source && (
                <>
                  <span aria-hidden>·</span>
                  <span
                    aria-hidden
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "var(--r-full)",
                      background: source.dot,
                      flexShrink: 0,
                    }}
                  />
                  {source.label}
                </>
              )}
            </span>
          </div>
          {event.company && (
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {event.company}
            </div>
          )}
          {event.sourceDetail && (
            <div
              style={{
                fontSize: "0.6875rem",
                color: "var(--text-subtle)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={`Quelle: ${event.sourceDetail}`}
            >
              Quelle: {event.sourceDetail}
            </div>
          )}
        </div>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
            fontSize: "0.75rem",
            fontWeight: 600,
            color: termin ? "var(--text-secondary)" : "var(--text-subtle)",
            flexShrink: 0,
          }}
        >
          <CalendarClock size={13} style={{ color: "var(--text-subtle)" }} />
          {termin ?? "Kein Termin"}
        </div>

        <span
          className="badge"
          style={{
            color: event.statusPill.color,
            backgroundColor: event.statusPill.bg,
            border: `1px solid ${event.statusPill.border}`,
            flexShrink: 0,
          }}
        >
          {event.statusPill.label}
        </span>

        {/* Betrag als Zahl, nicht als Pill — er ist ein Wert, kein Zustand. */}
        {event.dealVolume != null && event.status === "gewonnen" && (
          <span
            className="tnum"
            style={{
              fontSize: "var(--fs-sm)",
              fontWeight: 500,
              color: "var(--success-fg)",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {EUR_FMT.format(event.dealVolume)}
          </span>
        )}

        <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          {event.assignees.slice(0, 4).map((a, i) => {
            const oc = ownerColor(a.username);
            return (
              <span
                key={a.user_id}
                title={a.username}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: oc.bg,
                  color: oc.fg,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.625rem",
                  fontWeight: 600,
                  border: "2px solid var(--surface-100)",
                  marginLeft: i === 0 ? 0 : -7,
                }}
              >
                {ownerInitials(a.username)}
              </span>
            );
          })}
          {event.assignees.length > 4 && (
            <span style={{ fontSize: "0.6875rem", color: "var(--text-subtle)", marginLeft: 4, fontWeight: 600 }}>
              +{event.assignees.length - 4}
            </span>
          )}
        </div>

        {event.meetLink && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(event.meetLink as string, "_blank", "noopener,noreferrer");
            }}
            title="Meet öffnen"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
              padding: "0.3rem 0.625rem",
              borderRadius: "var(--r-full)",
              border: "1px solid var(--border-accent)",
              background: "var(--accent-muted)",
              color: "var(--orange-300)",
              fontSize: "0.75rem",
              fontWeight: 600,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <Video size={12} /> Meet
          </button>
        )}

        {!event.meetLink && event.meetingKind === "telefon" && (
          <span
            title="Termin findet telefonisch statt"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
              padding: "0.3rem 0.625rem",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "var(--surface-50)",
              color: "var(--text-muted)",
              fontSize: "0.75rem",
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            <Phone size={12} /> Telefon
          </span>
        )}
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="card dot-grid">
      <div className="empty-state">
        <CalendarClock size={24} aria-hidden />
        <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: "var(--text-primary)" }}>Keine Termine</div>
        <p style={{ maxWidth: 420 }}>
          Termine entstehen automatisch, sobald ein LinkedIn-Kontakt oder Telefon-Lead einen Termin bekommt — oder über
          „Termin buchen“ in der Navigation.
        </p>
      </div>
    </div>
  );
}
