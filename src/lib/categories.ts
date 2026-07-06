export const ANSWER_CATEGORIES = [
  "Interessiert",
  "Kein Interesse",
  "Zu teuer",
  "Falsches Timing",
  "Bereits Lösung",
  "Kein Budget",
  "Falsche Zielgruppe",
] as const;

export type AnswerCategory = (typeof ANSWER_CATEGORIES)[number];

// Farben komplett über Theme-Tokens (globals.css), damit Light + Dark
// funktionieren. Owner-Slots dienen hier nur als neutrale Palette-Slots.
export const CATEGORY_CONFIG: Record<
  AnswerCategory,
  { color: string; bg: string; border: string }
> = {
  "Interessiert":         { color: "var(--color-success-text)", bg: "var(--color-success-bg)", border: "var(--color-success-border)" },
  "Kein Interesse":       { color: "var(--text-subtle)",        bg: "var(--surface-150)",      border: "var(--border)" },
  "Zu teuer":             { color: "var(--color-warning-text)", bg: "var(--color-warning-bg)", border: "var(--color-warning-border)" },
  "Falsches Timing":      { color: "var(--owner-1)",            bg: "var(--owner-1-bg)",       border: "color-mix(in srgb, var(--owner-1) 35%, transparent)" },
  "Bereits Lösung":       { color: "var(--owner-2)",            bg: "var(--owner-2-bg)",       border: "color-mix(in srgb, var(--owner-2) 35%, transparent)" },
  "Kein Budget":          { color: "var(--color-error-text)",   bg: "var(--color-error-bg)",   border: "var(--color-error-border)" },
  "Falsche Zielgruppe":   { color: "var(--text-muted)",         bg: "var(--surface-200)",      border: "var(--border-bright)" },
};
