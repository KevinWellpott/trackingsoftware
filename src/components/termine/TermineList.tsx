"use client";

import { formatTermin } from "@/lib/apptTime";
import { ownerColor, ownerInitials } from "@/lib/ownerColor";
import type { TerminEvent } from "@/lib/termine";
import { EUR_FMT, SOURCE_META } from "@/lib/terminMeta";
import { addDaysISO, weekStart } from "@/lib/dates";
import { CalendarClock, CalendarX2, ChevronRight, Phone, Video } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { eventVars, kindLabel } from "./EventChip";
import {
  GRUPPEN_LABEL,
  GRUPPEN_ORDER,
  gruppeFor,
  type TerminGruppe,
  type TerminZeit,
} from "./viewState";

// Die „versteckte" Listenansicht — ersetzt die früheren getrennten Queues für
// Setting und Closing. Kartenlayout und Verhalten bleiben wie gewohnt, ergänzt
// um eine Typ-Markierung in Event-Farbe und den Abschnitt „Ohne Termin".

// Hinweis zur Farblogik: Der linke Balken einer Zeile traegt den STATUS-Ton
// (gruen = gewonnen, rot = verloren/No-Show, gold = nachfassen, neutral =
// offen) — dieselbe Bedeutung wie im Kalender und auf den Ergebnis-Buttons.
// Typ und Quelle stehen als stiller Text, die Quelle mit ihrem Kanal-Dot.

/** Chronologisch; innerhalb eines Tages nach Uhrzeit. */
function byTime(a: TerminEvent, b: TerminEvent): number {
  const d = (a.dayISO ?? "").localeCompare(b.dayISO ?? "");
  return d !== 0 ? d : a.startMin - b.startMin;
}

export function TermineList({
  events,
  ohneTermin,
  zeit,
  today,
}: {
  events: TerminEvent[];
  ohneTermin: TerminEvent[];
  zeit: TerminZeit;
  today: string;
}) {
  const weekEnd = useMemo(() => addDaysISO(weekStart(today), 6), [today]);

  const sections = useMemo(() => {
    const buckets = new Map<TerminGruppe, TerminEvent[]>();
    const push = (g: TerminGruppe, e: TerminEvent) => {
      const arr = buckets.get(g);
      if (arr) arr.push(e);
      else buckets.set(g, [e]);
    };

    // „Erledigt" heisst hier: das Ergebnis ist eingetragen. Nur ein noch
    // OFFENER Termin in der Vergangenheit ist wirklich liegen geblieben —
    // sonst waere die dringendste Gruppe voller abgehakter Altlasten.
    for (const e of events) push(gruppeFor(e.dayISO, e.status !== "offen", today, weekEnd), e);
    for (const e of ohneTermin) push("ohne", e);

    // Zeitfenster. „Ohne Termin" bleibt in jedem Fenster ausser „vergangen"
    // sichtbar: der Eintrag ist per Definition unerledigt und haette sonst
    // keinen Ort.
    const allowed: readonly TerminGruppe[] =
      zeit === "anstehend"
        ? ["ueberfaellig", "heute", "woche", "spaeter", "ohne"]
        : zeit === "vergangen"
          ? ["vergangen"]
          : GRUPPEN_ORDER;

    return GRUPPEN_ORDER.filter((g) => allowed.includes(g))
      .map((g) => {
        const items = [...(buckets.get(g) ?? [])].sort(byTime);
        // Vergangenes von neu nach alt — das Letzte interessiert zuerst.
        if (g === "vergangen") items.reverse();
        return { key: g, label: GRUPPEN_LABEL[g], items };
      })
      .filter((s) => s.items.length > 0);
  }, [events, ohneTermin, today, weekEnd, zeit]);

  if (sections.length === 0) return <EmptyState />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-7)" }}>
      {sections.map((s) => (
        // Vergangenes startet zugeklappt — es ist Nachschlagewerk, kein Arbeitsvorrat.
        <details key={s.key} open={s.key !== "vergangen"}>
          <summary
            className="group-summary"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "0.625rem",
            }}
          >
            <ChevronRight size={13} className="group-chevron" style={{ color: "var(--text-subtle)" }} />
            {s.key === "ohne" && <CalendarX2 size={13} style={{ color: "var(--text-subtle)" }} />}
            <span
              className="eyebrow"
              style={{
                // Nur „Überfällig" traegt Warnfarbe — die eine Gruppe, die eine
                // Handlung verlangt. Alles andere bleibt still.
                color: s.key === "ueberfaellig" ? "var(--warning-fg)" : "var(--text-subtle)",
              }}
            >
              {s.label}
            </span>
            <span className="count-pill" data-tone={s.key === "ueberfaellig" ? "overdue" : undefined}>
              {s.items.length}
            </span>
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
            {s.items.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </div>
        </details>
      ))}
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
