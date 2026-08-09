"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Inbox } from "lucide-react";
import { eur, fmtPct } from "@/lib/analyse";
import { ownerColor } from "@/lib/ownerColor";

// Listen-Performance als sortierbare Tabelle. Client-Komponente, weil die
// Sortierung der eigentliche Analyse-Vorgang ist: „welche Liste ist bei DIESER
// Kennzahl vorn" beantwortet man durch Umsortieren, nicht durch Nachladen.
// Die Zeilen kommen fertig gerechnet vom Server — hier wird nur sortiert.
//
// Steht seit dem Wegfall des Listen-Tabs im LinkedIn-Tab. Die Auftraggeber-
// Vorgabe dort lautet „simpel und übersichtlich": von zehn Wertspalten sind
// fünf geblieben (Antwortquote, Terminquote, Umsatz + ihre Absolutwerte).
// Positiv-Anteil, FU-Quote, Ø Stufe und Blockiert-Quote sind entfallen — sie
// beantworten Fragen, die der Tab daneben schon je Person beantwortet, und
// zwangen die Tabelle in horizontales Scrollen.

export type ListPerfRow = {
  id: string;
  name: string;
  owner: string;
  archived: boolean;
  /** Welche Textbausteine die Liste hinterlegt hat. */
  texts: { pitch: boolean; fu1: boolean; fu2: boolean; fu3: boolean };
  dms: number;
  answers: number;
  answerRate: number | null;
  appts: number;
  apptRate: number | null;
  revenue: number;
};

type SortKey = "name" | "dms" | "answers" | "answerRate" | "appts" | "apptRate" | "revenue";

type Column = {
  key: SortKey;
  label: string;
  format: "text" | "int" | "pct" | "num1" | "eur";
  title?: string;
};

const COLUMNS: Column[] = [
  { key: "dms", label: "DMs", format: "int" },
  { key: "answers", label: "Antw.", format: "int" },
  { key: "answerRate", label: "Antwortquote", format: "pct" },
  {
    key: "appts",
    label: "Termine",
    format: "int",
    title: "Kontakte dieser Liste mit Termin — Kohorte des gewählten Pitch-Zeitraums",
  },
  { key: "apptRate", label: "Terminquote", format: "pct" },
  { key: "revenue", label: "Umsatz", format: "eur", title: "Gewonnene Deals, die auf einen Kontakt dieser Liste zurückgehen" },
];

const INT_FMT = new Intl.NumberFormat("de-DE");
const DEC1_FMT = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function format(v: number | null, f: Column["format"]): string {
  if (v === null) return "—";
  if (f === "pct") return fmtPct(v);
  if (f === "eur") return eur(v);
  if (f === "num1") return DEC1_FMT.format(v);
  return INT_FMT.format(v);
}

// Kopfzeile identisch zu MetricTable/ComparisonTable — nur der Knopf kommt dazu.
const HEAD_CELL = {
  height: "var(--h-row)",
  padding: "0 var(--sp-5)",
  background: "var(--surface-1)",
  whiteSpace: "nowrap" as const,
};

// Auf schmalen Viewports scrollt die Tabelle weiterhin horizontal. Die
// Namensspalte bleibt dabei stehen — sonst weiss man in der Umsatz-Spalte nicht
// mehr, welche Liste man liest. Eigene Fläche, damit nichts durchscheint.
const STICKY_HEAD = {
  ...HEAD_CELL,
  position: "sticky" as const,
  left: 0,
  zIndex: 2,
};

const STICKY_CELL = {
  padding: "var(--sp-3) var(--sp-5)",
  minWidth: 200,
  position: "sticky" as const,
  left: 0,
  zIndex: 1,
  background: "var(--surface-2)",
};

const HEAD_BTN = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  border: "none",
  background: "none",
  padding: 0,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-xs)",
  fontWeight: 500,
  letterSpacing: "var(--ls-eyebrow)",
  textTransform: "uppercase" as const,
  whiteSpace: "nowrap" as const,
};

/**
 * Kürzel der hinterlegten Textbausteine — „welcher Satz steckt hinter der
 * Liste". Vier 16px-Kästchen statt vier Badges: es ist eine Eigenschaft der
 * Zeile, kein Status, und darf das Badge-Budget nicht verbrauchen.
 */
function TextSet({ texts }: { texts: ListPerfRow["texts"] }) {
  const parts: { label: string; on: boolean; title: string }[] = [
    { label: "P", on: texts.pitch, title: "Pitch-Text" },
    { label: "1", on: texts.fu1, title: "Follow-up 1" },
    { label: "2", on: texts.fu2, title: "Follow-up 2" },
    { label: "3", on: texts.fu3, title: "Follow-up 3" },
  ];
  const gesetzt = parts.filter((p) => p.on).map((p) => p.title);
  return (
    <span
      style={{ display: "inline-flex", gap: 2, flexShrink: 0 }}
      title={gesetzt.length === 0 ? "Keine eigenen Texte hinterlegt" : `Hinterlegt: ${gesetzt.join(" · ")}`}
    >
      {parts.map((p) => (
        <span
          key={p.label}
          aria-hidden
          style={{
            width: 16,
            height: 16,
            borderRadius: "var(--r-xs)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            fontWeight: 600,
            color: p.on ? "var(--orange-300)" : "var(--text-disabled)",
            background: p.on ? "var(--accent-muted)" : "var(--surface-1)",
            border: `1px solid ${p.on ? "var(--border-accent)" : "var(--border-subtle)"}`,
          }}
        >
          {p.label}
        </span>
      ))}
    </span>
  );
}

export function ListPerformanceTable({
  rows,
  showOwner,
}: {
  rows: ListPerfRow[];
  showOwner: boolean;
}) {
  const [sort, setSort] = useState<SortKey>("dms");
  const [asc, setAsc] = useState(false);

  const sorted = useMemo(() => {
    const dir = asc ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, "de") * dir;
      const av = a[sort];
      const bv = b[sort];
      // Zeilen ohne Wert (zu wenig Datenbasis) immer ans Ende, nie ans Podest.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
  }, [rows, sort, asc]);

  function toggle(key: SortKey) {
    if (key === sort) setAsc((v) => !v);
    else {
      setSort(key);
      setAsc(key === "name");
    }
  }

  function Head({ col }: { col: Column }) {
    const active = sort === col.key;
    const Icon = asc ? ArrowUp : ArrowDown;
    return (
      <th
        // aria-sort gehört auf die Spaltenzelle, nicht auf den Knopf darin.
        aria-sort={active ? (asc ? "ascending" : "descending") : "none"}
        style={{ ...HEAD_CELL, textAlign: "right" }}
      >
        <button
          type="button"
          onClick={() => toggle(col.key)}
          title={col.title}
          style={{ ...HEAD_BTN, color: active ? "var(--orange-300)" : "var(--text-muted)" }}
        >
          {col.label}
          {/* Sortierpfeil 12px in --orange-500 (COMPONENTS.md §6). */}
          {active && <Icon size={12} color="var(--orange-500)" aria-hidden />}
        </button>
      </th>
    );
  }

  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: "var(--sp-9) 0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--sp-3)",
          textAlign: "center",
        }}
      >
        <Inbox size={20} color="var(--text-muted)" aria-hidden />
        <span style={{ fontSize: "var(--fs-base)", color: "var(--text-secondary)" }}>
          Keine Liste erreicht die Mindestmenge im gewählten Zeitraum.
        </span>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
          Wähle einen größeren Zeitraum oder hebe den Listen-Filter auf.
        </span>
      </div>
    );
  }

  return (
    <div className="table-scroll" style={{ overflowX: "auto" }}>
      <table style={{ minWidth: 700, width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th
              aria-sort={sort === "name" ? (asc ? "ascending" : "descending") : "none"}
              style={{ ...STICKY_HEAD, textAlign: "left" }}
            >
              <button
                type="button"
                onClick={() => toggle("name")}
                style={{ ...HEAD_BTN, color: sort === "name" ? "var(--orange-300)" : "var(--text-muted)" }}
              >
                Liste
                {sort === "name" &&
                  (asc ? (
                    <ArrowUp size={12} color="var(--orange-500)" aria-hidden />
                  ) : (
                    <ArrowDown size={12} color="var(--orange-500)" aria-hidden />
                  ))}
              </button>
            </th>
            {COLUMNS.map((c) => (
              <Head key={c.key} col={c} />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const oc = ownerColor(r.owner);
            return (
              <tr key={r.id} className="funnel-matrix-row" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                <td style={STICKY_CELL}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
                    <span
                      style={{
                        fontSize: "var(--fs-base)",
                        fontWeight: 500,
                        color: "var(--text-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 240,
                      }}
                    >
                      {r.name}
                    </span>
                    <TextSet texts={r.texts} />
                    {r.archived && (
                      <span style={{ fontSize: "var(--fs-2xs)", color: "var(--text-subtle)" }}>archiviert</span>
                    )}
                  </div>
                  {showOwner && r.owner && (
                    <div style={{ fontSize: "var(--fs-xs)", color: oc.fg, marginTop: 1 }}>{r.owner}</div>
                  )}
                </td>
                {COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    style={{
                      padding: "var(--sp-3) var(--sp-5)",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      fontSize: "var(--fs-base)",
                      fontWeight: sort === c.key ? 600 : 500,
                      color: sort === c.key ? "var(--text-primary)" : "var(--text-secondary)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {format(r[c.key] as number | null, c.format)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
