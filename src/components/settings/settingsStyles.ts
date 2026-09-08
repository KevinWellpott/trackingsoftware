import type { CSSProperties } from "react";

// Gemeinsame Stile des Settings-Layouts (COMPONENTS.md §15).
//
// Bisher standen sie als Konstanten in settings/page.tsx. Sie ziehen hierher
// um, weil die Karten dieser Seite inzwischen zum Teil Client-Komponenten sind
// (Fehleranzeige über useActionState) — und zwei Abschriften derselben
// Kartenoptik wären genau der Punkt, an dem die Seite auseinanderläuft.
// Reines Datenmodul: weder "use client" noch "use server", damit Server- und
// Client-Teil dieselbe Quelle benutzen.

export const SECTION_HEAD: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-4)",
  padding: "var(--sp-6) var(--sp-8)",
  borderBottom: "1px solid var(--border-default)",
};

export const SECTION_TITLE: CSSProperties = {
  fontSize: "var(--fs-md)",
  fontWeight: 600,
  letterSpacing: "var(--ls-tight)",
  color: "var(--text-primary)",
};

/** Die kleine Beschriftung rechts im Sektionskopf. */
export const SECTION_META: CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--text-muted)",
};

/** Label links in der zweispaltigen Workspace-Zeile. */
export const ROW_LABEL: CSSProperties = {
  fontSize: "var(--fs-sm)",
  color: "var(--text-muted)",
};

/** Label über einem Feld (COMPONENTS.md §3.8). */
export const FIELD_LABEL: CSSProperties = {
  display: "block",
  fontSize: "var(--fs-xs)",
  fontWeight: 500,
  color: "var(--text-secondary)",
  marginBottom: "var(--sp-3)",
};

export const SECTION_BODY: CSSProperties = {
  padding: "var(--sp-7) var(--sp-8)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--sp-8)",
};

const FEEDBACK_BASE: CSSProperties = {
  borderRadius: "var(--r-sm)",
  fontSize: "var(--fs-base)",
  padding: "var(--sp-5) var(--sp-6)",
};

export const FEEDBACK_OK: CSSProperties = {
  ...FEEDBACK_BASE,
  background: "var(--success-bg)",
  borderLeft: "2px solid var(--success)",
  color: "var(--success-fg)",
};

export const FEEDBACK_ERR: CSSProperties = {
  ...FEEDBACK_BASE,
  background: "var(--danger-bg)",
  borderLeft: "2px solid var(--danger)",
  color: "var(--danger-fg)",
};

/* ---------------------------------------------------------------- *
 * Rückmeldung DIREKT AM FELD
 * ---------------------------------------------------------------- *
 * COMPONENTS.md §3.1: „Error: Border --danger + Fehlertext 12px
 * --danger-fg darunter (nie nur Farbe — immer Text)". Die Bänder oben
 * (FEEDBACK_OK/ERR) gehören zur ganzen Seite; ein Feld, das seinen Wert
 * nicht speichern konnte, muss die Meldung neben sich tragen.
 */

const FIELD_NOTE: CSSProperties = {
  margin: "var(--sp-3) 0 0",
  fontSize: "var(--fs-xs)",
  lineHeight: "var(--lh-snug)",
};

export const FIELD_ERROR: CSSProperties = { ...FIELD_NOTE, color: "var(--danger-fg)" };
export const FIELD_OK: CSSProperties = { ...FIELD_NOTE, color: "var(--success-fg)" };
export const FIELD_WARN: CSSProperties = { ...FIELD_NOTE, color: "var(--warning-fg)" };
export const FIELD_HINT: CSSProperties = { ...FIELD_NOTE, color: "var(--text-subtle)" };

/** Zahlenfeld: rechtsbündig mit Tabellenziffern, damit Spalten fluchten. */
export const NUMBER_INPUT: CSSProperties = {
  minWidth: 0,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

/** Der ✓-Knopf neben einem einzeiligen Feld. */
export const SAVE_BUTTON: CSSProperties = {
  padding: "0 var(--sp-5)",
  flexShrink: 0,
};
