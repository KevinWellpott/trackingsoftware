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

export const CATEGORY_CONFIG: Record<
  AnswerCategory,
  { color: string; bg: string; border: string; emoji: string }
> = {
  "Interessiert":         { color: "#4ade80", bg: "#052e16", border: "#166534", emoji: "✓" },
  "Kein Interesse":       { color: "#71717a", bg: "#18181b", border: "#3f3f46", emoji: "✗" },
  "Zu teuer":             { color: "#f97316", bg: "#1c0700", border: "#7c2d12", emoji: "€" },
  "Falsches Timing":      { color: "#818cf8", bg: "#1e1b4b", border: "#3730a3", emoji: "⏱" },
  "Bereits Lösung":       { color: "#a78bfa", bg: "#2e1065", border: "#6d28d9", emoji: "⚡" },
  "Kein Budget":          { color: "#f87171", bg: "#450a0a", border: "#7f1d1d", emoji: "—" },
  "Falsche Zielgruppe":   { color: "#94a3b8", bg: "#0f172a", border: "#334155", emoji: "⊘" },
};
