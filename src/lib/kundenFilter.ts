// „Meine · je Person · Alle": die EINE Regel für /kunden und /umsatz.
// Zuständigkeit FILTERT, Rechte vergibt sie nicht (Z2).

import type { TeamMitglied } from "@/lib/kunden";

export const WER_ALLE = "alle";
export const WER_MEIN = "mein";
export const WER_OHNE = "ohne";

type MitBetreuer = { betreuer_user_id: string | null };

/**
 * Vorgabe ist „Meine", aber nur für den, der auch Kunden hat. Sonst öffnete
 * die Seite für Nicht-Admins (nie zuständig) dauerhaft leer.
 */
export function werAusUrl(
  roh: string | undefined,
  kunden: readonly MitBetreuer[],
  team: readonly TeamMitglied[],
  userId: string,
  vorgabe: "mein" | "alle" = "mein",
): string {
  if (roh === WER_ALLE || roh === WER_MEIN || roh === WER_OHNE) return roh;
  if (roh && team.some((t) => t.user_id === roh)) return roh;
  return vorgabe === "mein" && kunden.some((k) => k.betreuer_user_id === userId) ? WER_MEIN : WER_ALLE;
}

/**
 * Wer nicht mehr zuständig sein kann (ausgeschieden, kein Admin mehr), gilt als
 * niemand. Sonst läge der Betrag bei einer Person, die keiner mehr anklickt (Z1).
 */
export function mitGueltigerPerson<T extends MitBetreuer>(kunden: readonly T[], team: readonly TeamMitglied[]): T[] {
  const gueltig = new Set(team.filter((t) => t.zuordenbar).map((t) => t.user_id));
  return kunden.map((k) => (k.betreuer_user_id && !gueltig.has(k.betreuer_user_id) ? { ...k, betreuer_user_id: null } : k));
}

export function passtZuWer(k: MitBetreuer, wer: string, userId: string): boolean {
  if (wer === WER_ALLE) return true;
  if (wer === WER_OHNE) return k.betreuer_user_id === null;
  return k.betreuer_user_id === (wer === WER_MEIN ? userId : wer);
}

export function werEintraege(
  kunden: readonly MitBetreuer[],
  team: readonly TeamMitglied[],
  userId: string,
  href: (wer: string) => string,
): { key: string; label: string; href: string; zahl: number; warnung?: boolean }[] {
  const zahl = (wer: string) => kunden.filter((k) => passtZuWer(k, wer, userId)).length;
  const out: { key: string; label: string; href: string; zahl: number; warnung?: boolean }[] = [];
  if (team.some((t) => t.user_id === userId && t.zuordenbar)) {
    out.push({ key: WER_MEIN, label: "Meine", href: href(WER_MEIN), zahl: zahl(WER_MEIN) });
  }
  out.push({ key: WER_ALLE, label: "Alle", href: href(WER_ALLE), zahl: zahl(WER_ALLE) });
  for (const t of team) {
    if (!t.zuordenbar || t.user_id === userId) continue;
    out.push({ key: t.user_id, label: t.username, href: href(t.user_id), zahl: zahl(t.user_id) });
  }
  const ohne = zahl(WER_OHNE);
  if (ohne) out.push({ key: WER_OHNE, label: "Ohne Zuständigen", href: href(WER_OHNE), zahl: ohne, warnung: true });
  return out;
}
