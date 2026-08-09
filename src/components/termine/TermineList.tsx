"use client";

import { channelColor, channelLabel } from "@/lib/channels";
import { formatTerminParts } from "@/lib/apptTime";
import { ownerColor, ownerInitials } from "@/lib/ownerColor";
import type { TerminEvent } from "@/lib/termine";
import { EUR_FMT } from "@/lib/terminMeta";
import { ArrowDown, ArrowUp, CalendarClock, CalendarX2, Phone, Video } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { kindLabel } from "./EventChip";
import type { SortDir, TerminSort, TerminZeit } from "./viewState";

// Die Arbeitsliste — vorher eine zweite, größere Ausgabe des Kalenders.
//
// Sie war als Kartenstapel eine reine Dublette: dieselben Chips, nur breiter,
// chronologisch gruppiert. Alles, was sie zeigte, zeigt der Kalender besser.
// Der eine Grund, sie NICHT zu löschen: Termine ohne gesetzten Zeitpunkt haben
// im Raster keinen Platz und tauchen ausschließlich hier auf — ohne die Liste
// wären sie unerreichbar.
//
// Also wird sie das, was der Kalender nicht kann: eine dichte, sortierbare
// Tabelle über ALLE Termine, mit den vier Spalten, nach denen man wirklich
// sucht — Person, Quelle, Status, Ergebnis. Eine Zeile pro Termin statt einer
// Karte; auf einen Bildschirm passen damit rund fünfmal so viele.

/** Zeilen ohne Zeitpunkt sortieren immer nach oben — sie sind unerledigt. */
const NO_DATE_KEY = "0000-00-00";

type Column = {
  key: TerminSort;
  label: string;
  /** Spaltenbreite; leer = flexibel. */
  width?: number;
  align?: "left" | "right";
};

const COLUMNS: readonly Column[] = [
  { key: "zeit", label: "Termin", width: 148 },
  { key: "lead", label: "Lead / Firma" },
  { key: "person", label: "Person", width: 132 },
  { key: "quelle", label: "Quelle", width: 132 },
  { key: "status", label: "Status", width: 138 },
];

/** Sortierschlüssel je Spalte — immer ein String, damit localeCompare reicht. */
function sortKey(e: TerminEvent, sort: TerminSort): string {
  switch (sort) {
    case "lead":
      return `${e.title} ${e.company ?? ""}`.toLowerCase();
    case "person":
      // Ohne Zuweisung ans Ende, egal in welche Richtung sortiert wird —
      // „niemand zuständig" ist kein Name, sondern eine Lücke.
      return e.assignee?.username.toLowerCase() ?? "￿";
    case "quelle":
      return channelLabel(e.sourceType, e.kind === "closing" ? "—" : "Sonstige").toLowerCase();
    case "status":
      return e.statusPill.label.toLowerCase();
    default:
      return `${e.dayISO ?? NO_DATE_KEY}T${String(e.startMin).padStart(4, "0")}`;
  }
}

export function TermineList({
  events,
  ohneTermin,
  zeit,
  today,
  sort,
  dir,
  onSort,
}: {
  events: TerminEvent[];
  ohneTermin: TerminEvent[];
  zeit: TerminZeit;
  today: string;
  sort: TerminSort;
  dir: SortDir;
  onSort: (col: TerminSort) => void;
}) {
  const rows = useMemo(() => {
    // „Erledigt" heißt: das Ergebnis ist eingetragen. Nur ein noch OFFENER
    // Termin in der Vergangenheit ist wirklich liegen geblieben.
    const isPast = (e: TerminEvent) => e.dayISO != null && e.dayISO < today;

    // Termine ohne Zeitpunkt sind per Definition unerledigt und gehören in
    // jedes Fenster außer „Vergangen" — sonst hätten sie gar keinen Ort.
    const pool =
      zeit === "vergangen"
        ? events.filter((e) => isPast(e) && e.status !== "offen")
        : zeit === "anstehend"
          ? [...events.filter((e) => !isPast(e) || e.status === "offen"), ...ohneTermin]
          : [...events, ...ohneTermin];

    const factor = dir === "asc" ? 1 : -1;
    return [...pool].sort((a, b) => {
      const cmp = sortKey(a, sort).localeCompare(sortKey(b, sort), "de", { numeric: true });
      // Gleichstand immer chronologisch auflösen — sonst springen Zeilen bei
      // jedem Re-Render, weil Array.sort nicht garantiert stabil gefüllt wird.
      return cmp !== 0 ? cmp * factor : sortKey(a, "zeit").localeCompare(sortKey(b, "zeit"));
    });
  }, [events, ohneTermin, today, zeit, sort, dir]);

  if (rows.length === 0) return <EmptyState />;

  return (
    <div
      className="table-scroll"
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        background: "var(--surface-100)",
      }}
    >
      <table className="data-table">
        <thead>
          <tr>
            {COLUMNS.map((c) => {
              const active = sort === c.key;
              const Arrow = dir === "asc" ? ArrowUp : ArrowDown;
              return (
                <th key={c.key} style={{ width: c.width }} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
                  <button
                    type="button"
                    onClick={() => onSort(c.key)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "var(--sp-2)",
                      border: "none",
                      background: "transparent",
                      padding: 0,
                      font: "inherit",
                      letterSpacing: "inherit",
                      textTransform: "inherit",
                      color: active ? "var(--text-primary)" : "inherit",
                      cursor: "pointer",
                    }}
                  >
                    {c.label}
                    {active && <Arrow size={11} />}
                  </button>
                </th>
              );
            })}
            {/* Ergebnis ist eine Mischspalte (Umsatz, Wiedervorlage, Kontaktweg)
                und deshalb bewusst nicht sortierbar. */}
            <th style={{ width: 190 }}>Ergebnis</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <Row key={e.id} event={e} today={today} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ event, today }: { event: TerminEvent; today: string }) {
  const termin = formatTerminParts(event.at);
  const overdue = event.dayISO != null && event.dayISO < today && event.status === "offen";
  const source = event.kind === "setting" ? channelLabel(event.sourceType) : null;

  return (
    <tr>
      {/* ── Termin ── */}
      <td>
        {termin ? (
          <span
            className="tnum"
            style={{
              display: "inline-flex",
              alignItems: "baseline",
              gap: "var(--sp-3)",
              color: overdue ? "var(--warning-fg)" : "var(--text-secondary)",
            }}
            title={overdue ? "Liegt in der Vergangenheit und ist noch offen" : undefined}
          >
            {overdue && <CalendarClock size={12} style={{ alignSelf: "center", flexShrink: 0 }} />}
            {termin.date}
            <span style={{ color: overdue ? "inherit" : "var(--text-primary)", fontWeight: 500 }}>
              {termin.time}
            </span>
          </span>
        ) : (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--sp-3)",
              color: "var(--text-muted)",
            }}
          >
            <CalendarX2 size={12} style={{ flexShrink: 0 }} /> Kein Termin
          </span>
        )}
      </td>

      {/* ── Lead / Firma — mit dem Typ-Marker in der Chip-Fuellfarbe, damit
             Liste und Kalender dieselbe Sprache sprechen. ── */}
      <td>
        <Link
          href={event.href}
          className="listen-name"
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: "var(--sp-4)",
            color: "inherit",
            textDecoration: "none",
            maxWidth: "100%",
          }}
        >
          <span
            aria-hidden
            title={kindLabel(event.kind)}
            style={{
              alignSelf: "center",
              flexShrink: 0,
              width: 18,
              textAlign: "center",
              borderRadius: "var(--r-xs)",
              padding: "1px 0",
              fontSize: "var(--fs-2xs)",
              fontWeight: 600,
              background:
                event.kind === "setting" ? "var(--event-setting-bg)" : "var(--event-closing-bg)",
              color: event.kind === "setting" ? "var(--event-setting-fg)" : "var(--event-closing-fg)",
              border: "1px solid var(--border-default)",
            }}
          >
            {kindLabel(event.kind, true)}
          </span>
          <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {event.title}
          </span>
          {event.company && (
            <span
              style={{
                fontSize: "var(--fs-xs)",
                color: "var(--text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {event.company}
            </span>
          )}
        </Link>
      </td>

      {/* ── Person ── */}
      <td>
        {event.assignee ? (
          <OwnerCell username={event.assignee.username} />
        ) : (
          <span style={{ color: "var(--text-disabled)" }}>—</span>
        )}
      </td>

      {/* ── Quelle ── */}
      <td>
        {source ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--sp-3)",
              fontSize: "var(--fs-sm)",
              color: "var(--text-secondary)",
            }}
            title={event.sourceDetail ? `Quelle: ${event.sourceDetail}` : undefined}
          >
            <span
              aria-hidden
              className="stage-dot"
              style={{ background: channelColor(event.sourceType) }}
            />
            {source}
          </span>
        ) : (
          // Closings erben die Quelle nicht — sie haben keine eigene Spalte.
          <span style={{ color: "var(--text-disabled)" }}>—</span>
        )}
      </td>

      {/* ── Status ── */}
      <td>
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
      </td>

      {/* ── Ergebnis: Umsatz, sonst der Kontaktweg für den Termin ── */}
      <td>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap" }}>
          {event.dealVolume != null && event.status === "gewonnen" && (
            <span className="tnum" style={{ fontWeight: 500, color: "var(--success-fg)" }}>
              {EUR_FMT.format(event.dealVolume)}
            </span>
          )}
          {event.meetLink && (
            <a
              href={event.meetLink}
              target="_blank"
              rel="noopener noreferrer"
              className="badge"
              style={{
                textDecoration: "none",
                color: "var(--orange-300)",
                backgroundColor: "var(--accent-muted)",
                border: "1px solid var(--border-accent)",
              }}
            >
              <Video size={11} /> Meet
            </a>
          )}
          {/* Die Nummer ist der Grund, warum es das Feld gibt: Wer kurzfristig
              einspringt, muss sie ohne Umweg über die Detailseite sehen. */}
          {event.phone && (
            <a
              href={`tel:${event.phone.replace(/[^\d+]/g, "")}`}
              className="badge badge-gray tnum"
              style={{ textDecoration: "none" }}
              title="Anrufen"
            >
              <Phone size={11} /> {event.phone}
            </a>
          )}
          {!event.meetLink && !event.phone && event.meetingKind === "telefon" && (
            <span className="badge badge-gray" title="Telefon-Termin ohne hinterlegte Nummer">
              <Phone size={11} /> Nummer fehlt
            </span>
          )}
        </span>
      </td>
    </tr>
  );
}

/** Zuständige Person einer Zeile. Avatar für den Wiedererkennungswert, Name für die Suche. */
function OwnerCell({ username }: { username: string }) {
  const oc = ownerColor(username);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)", minWidth: 0 }}>
      <span
        aria-hidden
        style={{
          width: 20,
          height: 20,
          flexShrink: 0,
          borderRadius: "var(--r-full)",
          background: oc.bg,
          color: oc.fg,
          boxShadow: `inset 0 0 0 1px ${oc.fg}`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "var(--fs-2xs)",
          fontWeight: 600,
        }}
      >
        {ownerInitials(username)}
      </span>
      <span
        style={{
          fontSize: "var(--fs-sm)",
          color: "var(--text-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {username}
      </span>
    </span>
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
