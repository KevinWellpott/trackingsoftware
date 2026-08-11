// Zentrale Owner-Farben: bildet Namen deterministisch auf die 6 Owner-Slots
// (--owner-1 … --owner-6 in globals.css) ab. Ersetzt die verstreuten
// Hardcode-Paletten (OWNER_COLORS / CHIP_PALETTE) — dark-mode-sicher, da
// die Slots pro Theme in globals.css überschrieben werden.
// Reines Sync-Modul: kein "use client"/"use server" nötig, überall importierbar.

export type OwnerColor = {
  /** Vordergrund (Text/Icon/Avatar-Initialen), z. B. "var(--owner-1)" */
  fg: string;
  /** Sehr heller Flächen-Tint (Chip-/Avatar-Hintergrund), z. B. "var(--owner-1-bg)" */
  bg: string;
};

/** Feste Slot-Zuordnung für das bekannte Team. */
const FIXED_SLOTS: Record<string, number> = {
  Kevin: 1,
  Simon: 2,
  Daniel: 3,
  Shanice: 3,
  "Samuel Kerber": 4,
};

const SLOT_COUNT = 6;

/** Stabiler Fallback für unbekannte Namen: Summe der Char-Codes mod 6. */
function hashSlot(name: string): number {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return (sum % SLOT_COUNT) + 1;
}

/**
 * Liefert Vorder-/Hintergrundfarbe für einen Owner-Namen als CSS-var()-Strings.
 * Bekannte Teammitglieder haben feste Slots, unbekannte Namen werden stabil
 * gehasht. Leere Namen erhalten neutrale Töne.
 */
export function ownerColor(name: string | null | undefined): OwnerColor {
  const trimmed = (name ?? "").trim();
  if (!trimmed) {
    return { fg: "var(--text-subtle)", bg: "var(--surface-150)" };
  }
  const slot = FIXED_SLOTS[trimmed] ?? hashSlot(trimmed);
  return { fg: `var(--owner-${slot})`, bg: `var(--owner-${slot}-bg)` };
}

/**
 * Marken-Rampe fuer die Personen-Marker im Team-Dashboard.
 *
 * Warum eine zweite Palette: `ownerColor` verteilt sechs eigenstaendige Hues
 * (Blau, Violett, Gruen, Teal, Gold, Fuchsia). Auf einer Seite, die aus vier
 * Personen-Panels, vier Karten, einer Legende und einem Balkendiagramm besteht,
 * standen dadurch bis zu sechs Fremdfarben gleichzeitig — die Seite las sich
 * bunt statt als Teil dieser Marke.
 *
 * Die Rampe wechselt bewusst zwischen Orange-Stufen und Neutraltoenen: benachbarte
 * Slots bleiben im Balkendiagramm unterscheidbar (dort IST die Farbe der einzige
 * Schluessel zur Person), ohne dass eine Farbe auftaucht, die es im Markenraum
 * nicht gibt. Die Slot-Zuordnung ist dieselbe wie bei `ownerColor` — eine Person
 * behaelt ihren Slot, egal welche Palette ihn einfaerbt.
 *
 * Nur im Team-Dashboard im Einsatz; alle anderen Ansichten (Termine, Analyse,
 * Listen) unterscheiden weiterhin ueber `ownerColor`.
 */
const BRAND_SLOTS = [
  "var(--orange-500)",     // Markenorange
  "var(--text-secondary)", // helles Neutral
  "var(--orange-300)",     // helles Orange
  "var(--text-muted)",     // mittleres Neutral
  "var(--orange-700)",     // tiefes Orange
  "var(--orange-200)",     // hellste Orange-Stufe
] as const;

/** Wie `ownerColor`, aber ausschliesslich in Markenfarben (siehe BRAND_SLOTS). */
export function ownerBrandColor(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "var(--text-subtle)";
  const slot = FIXED_SLOTS[trimmed] ?? hashSlot(trimmed);
  return BRAND_SLOTS[slot - 1];
}

/**
 * Initialen für Avatare/Chips: Anfangsbuchstaben der ersten beiden Wörter,
 * großgeschrieben, max. 2 Zeichen. Leere Namen → "?".
 */
export function ownerInitials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((w) => (w[0] ?? "").toUpperCase())
    .join("");
}
