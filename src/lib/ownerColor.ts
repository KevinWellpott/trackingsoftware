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
