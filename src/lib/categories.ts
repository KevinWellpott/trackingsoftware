// Antwort-Kategorien.
// NEU wählbar sind nur noch Positiv / Neutral / Negativ.
// Die Legacy-Kategorien bleiben für BESTANDSDATEN darstellbar (alte Zeilen
// behalten ihren Wert und rendern weiterhin farbig), sind aber in den
// Auswahlfeldern nicht mehr anwählbar.

// Wählbare Kategorien (Neuerfassung)
export const SELECTABLE_CATEGORIES = ["Positiv", "Neutral", "Negativ"] as const;
export type SelectableCategory = (typeof SELECTABLE_CATEGORIES)[number];

// Legacy-Kategorien (nur Anzeige/Filter von Bestandsdaten)
export const LEGACY_CATEGORIES = [
  "Interessiert",
  "Kein Interesse",
  "Zu teuer",
  "Falsches Timing",
  "Bereits Lösung",
  "Kein Budget",
  "Falsche Zielgruppe",
] as const;

// Vollständige Liste (z. B. für Filter über Bestands- UND Neudaten)
export const ANSWER_CATEGORIES = [...SELECTABLE_CATEGORIES, ...LEGACY_CATEGORIES] as const;
export type AnswerCategory = (typeof ANSWER_CATEGORIES)[number];

type CategoryStyle = { color: string; bg: string; border: string };

// Farben komplett über Theme-Tokens (Hell + Dunkel).
export const CATEGORY_CONFIG: Record<AnswerCategory, CategoryStyle> = {
  // Neu
  "Positiv":              { color: "var(--color-success-text)", bg: "var(--color-success-bg)", border: "var(--color-success-border)" },
  "Neutral":              { color: "var(--text-muted)",         bg: "var(--surface-150)",      border: "var(--border)" },
  "Negativ":              { color: "var(--color-error-text)",   bg: "var(--color-error-bg)",   border: "var(--color-error-border)" },
  // Legacy (Bestandsdaten)
  "Interessiert":         { color: "var(--color-success-text)", bg: "var(--color-success-bg)", border: "var(--color-success-border)" },
  "Kein Interesse":       { color: "var(--text-subtle)",        bg: "var(--surface-150)",      border: "var(--border)" },
  "Zu teuer":             { color: "var(--color-warning-text)", bg: "var(--color-warning-bg)", border: "var(--color-warning-border)" },
  "Falsches Timing":      { color: "var(--owner-1)",            bg: "var(--owner-1-bg)",       border: "color-mix(in srgb, var(--owner-1) 35%, transparent)" },
  "Bereits Lösung":       { color: "var(--owner-2)",            bg: "var(--owner-2-bg)",       border: "color-mix(in srgb, var(--owner-2) 35%, transparent)" },
  "Kein Budget":          { color: "var(--color-error-text)",   bg: "var(--color-error-bg)",   border: "var(--color-error-border)" },
  "Falsche Zielgruppe":   { color: "var(--text-muted)",         bg: "var(--surface-200)",      border: "var(--border-bright)" },
};

// Sichere Style-Auflösung auch für unbekannte Alt-Werte.
export function categoryStyle(value: string | null | undefined): CategoryStyle | null {
  if (!value) return null;
  return (
    CATEGORY_CONFIG[value as AnswerCategory] ?? {
      color: "var(--text-muted)",
      bg: "var(--surface-150)",
      border: "var(--border)",
    }
  );
}
