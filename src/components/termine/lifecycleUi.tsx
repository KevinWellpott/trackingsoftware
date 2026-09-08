"use client";

import type { CSSProperties, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import {
  DISQUALIFY_REASON_LABELS,
  DISQUALIFY_REASON_ORDER,
  DISQUALIFY_REASON_WARNINGS,
} from "@/components/termine/lifecycleMeta";
import type { DisqualifyReasonCode } from "@/app/actions/settingCalls";

// Gemeinsame Bausteine der Lebenszyklus-Dialoge (verschieben, absagen,
// disqualifizieren, No-Show-Ausgang).
//
// Optik wörtlich aus den bestehenden Modals der beiden Editoren übernommen —
// Pillen-Auswahl wie beim Verlustgrund im Closing, Label-Kappe wie überall in
// den Termin-Formularen. Sie stehen hier und nicht dreimal in den Dateien,
// weil dieselbe Auswahl in beiden Editoren erscheint und ein Grund, der links
// anders aussieht als rechts, wie zwei verschiedene Felder wirkt.

export const FIELD_LABEL: CSSProperties = {
  display: "block",
  fontSize: "0.6875rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-subtle)",
  marginBottom: "0.35rem",
};

export const FIELD_INPUT: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--surface-50)",
  border: "1px solid var(--border-bright)",
  borderRadius: "var(--radius-sm)",
  padding: "0.45rem 0.625rem",
  fontSize: "0.8125rem",
  color: "var(--text-primary)",
  outline: "none",
  fontFamily: "inherit",
};

export function modalButton(
  kind: "primary" | "ghost",
  accent?: { bg: string; fg: string; border: string },
): CSSProperties {
  if (kind === "primary") {
    return {
      flex: 1,
      minHeight: "var(--h-control-lg)",
      padding: "0 var(--sp-7)",
      borderRadius: "var(--r-full)",
      border: `1px solid ${accent?.border ?? "transparent"}`,
      background: accent?.bg ?? "var(--grad-cta)",
      color: accent?.fg ?? "var(--text-on-accent)",
      boxShadow: accent ? undefined : "var(--shadow-btn-primary)",
      fontSize: "var(--fs-base)",
      fontFamily: "inherit",
      fontWeight: 600,
      cursor: "pointer",
      transition: "all 0.1s",
    };
  }
  return {
    minHeight: "var(--h-control-lg)",
    padding: "0 var(--sp-7)",
    borderRadius: "var(--r-full)",
    border: "1px solid var(--border-default)",
    background: "var(--surface-2)",
    color: "var(--text-secondary)",
    fontSize: "var(--fs-base)",
    fontFamily: "inherit",
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.1s",
  };
}

/** Fehlerband im Dialog — Muster der bestehenden Modals in beiden Editoren. */
export function ModalError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      style={{
        background: "var(--color-error-bg)",
        border: "1px solid var(--color-error-border)",
        color: "var(--color-error-text)",
        borderRadius: "var(--radius-sm)",
        padding: "0.5rem 0.75rem",
        fontSize: "0.75rem",
        fontWeight: 600,
      }}
    >
      {message}
    </div>
  );
}

/**
 * Pillen-Auswahl mit genau EINER Antwort — bewusst ohne Vorbelegung.
 *
 * Ein vorbelegter Grund wäre der meistgeklickte Grund: Wer nichts anfasst,
 * schickt trotzdem eine Aussage ab. Bei „hat der Lead verschoben?" hängt daran
 * der Zähler, der später die Warnung auslöst — eine geratene Antwort verschöbe
 * sie auf die falschen Leads.
 */
export function ChoiceGroup<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  tone = "brand",
}: {
  value: T | null;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
  tone?: "brand" | "error" | "warning";
}) {
  const toneStyle =
    tone === "error"
      ? { color: "var(--color-error-text)", bg: "var(--color-error-bg)", border: "var(--color-error-border)" }
      : tone === "warning"
        ? { color: "var(--color-warning-text)", bg: "var(--color-warning-bg)", border: "var(--color-warning-border)" }
        : { color: "var(--brand-500)", bg: "var(--brand-50)", border: "var(--brand-200)" };

  return (
    <div className="ui-segmented" role="group" aria-label={ariaLabel} style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            style={{
              padding: "0.3rem 0.625rem",
              borderRadius: "var(--r-full)",
              border: `1px solid ${active ? toneStyle.border : "var(--border)"}`,
              background: active ? toneStyle.bg : "var(--surface-50)",
              color: active ? toneStyle.color : "var(--text-muted)",
              fontSize: "0.75rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.1s",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Erklärzeile unter einer Auswahl — sagt, was die gewählte Antwort auslöst. */
export function ChoiceHint({ children }: { children: ReactNode }) {
  return (
    <p style={{ margin: "0.35rem 0 0", fontSize: "0.75rem", lineHeight: 1.45, color: "var(--text-subtle)" }}>
      {children}
    </p>
  );
}

/** Deutlicher Hinweis mit Warnton — für Auswahlen, die nicht folgenlos sind. */
export function DangerHint({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "0.5rem",
        background: "var(--color-error-bg)",
        border: "1px solid var(--color-error-border)",
        borderRadius: "var(--radius-sm)",
        padding: "0.5rem 0.75rem",
        fontSize: "0.75rem",
        lineHeight: 1.45,
        color: "var(--color-error-text)",
        fontWeight: 500,
      }}
    >
      <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Disqualifizierungs-Grund
 * ------------------------------------------------------------------ */

/**
 * Grund + Freitext der Disqualifizierung. Eigener Baustein, weil er an zwei
 * Stellen erscheint: im Dialog „Unqualifiziert" (dort entsteht der Zustand) und
 * als Nachtrag, wenn ein Setting schon unqualifiziert oder dead ist, aber noch
 * keinen Code trägt — genau die Zeilen, die in der Ablage sonst ohne Grund
 * stehen.
 */
export function DisqualifyReasonFields({
  code,
  text,
  onCode,
  onText,
  disabled,
}: {
  code: DisqualifyReasonCode | null;
  text: string;
  onCode: (v: DisqualifyReasonCode) => void;
  onText: (v: string) => void;
  disabled?: boolean;
}) {
  const warning = code ? DISQUALIFY_REASON_WARNINGS[code] : undefined;

  return (
    <>
      <div>
        <span style={FIELD_LABEL}>Grund der Disqualifizierung *</span>
        {/* Auswahl statt Freitext, aus demselben Grund wie beim Verlustgrund im
            Closing: „kein Geld", „Budget fehlt", „zu teuer" wären in der
            Auswertung drei Zeilen mit je Häufigkeit 1. */}
        <ChoiceGroup
          value={code}
          options={DISQUALIFY_REASON_ORDER.map((c) => ({ value: c, label: DISQUALIFY_REASON_LABELS[c] }))}
          onChange={onCode}
          ariaLabel="Grund der Disqualifizierung"
          tone="warning"
        />
      </div>

      {warning && <DangerHint>{warning}</DangerHint>}

      <div>
        <span style={FIELD_LABEL}>Notiz (optional)</span>
        <textarea
          value={text}
          disabled={disabled}
          onChange={(e) => onText(e.target.value)}
          placeholder="Kontext, den die Kategorie nicht trägt"
          rows={2}
          style={{ ...FIELD_INPUT, resize: "vertical", lineHeight: 1.5 }}
        />
      </div>
    </>
  );
}
