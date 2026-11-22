// Gesamtübersicht des Kundenspace: was kommt rein, was geht raus, was bleibt.
// Reine Bibliothek, der Referenztag kommt immer vom Aufrufer.
//
// DREI REGELN
//   · Plan und Ist werden nie addiert: Ist ersetzt den Plan der Zeile.
//   · Überfälliges ist keine sichere Einnahme und steht getrennt daneben.
//   · Eine Kostenänderung gilt ab Monat X, frühere Monate behalten ihren Betrag.

import { cent, eur, type KundenKennzahlen, type UmsatzZahlung, type VerteilteRate } from "@/lib/umsatz";
import type { NeueVereinbarung } from "@/lib/umsatzPlanung";

export type Vereinbarung = NeueVereinbarung & { id: string; created_at?: string };

export type KundeFinanz = {
  id: string;
  name: string;
  k: KundenKennzahlen;
  zahlungen: readonly UmsatzZahlung[];
  vereinbarungen: readonly Vereinbarung[];
};

// ── Monate ─────────────────────────────────────────────────────────────────

/** YYYY-MM mit echtem Monat, für alles, was aus der URL kommt. */
export function istMonat(s: unknown): boolean {
  return typeof s === "string" && /^20\d{2}-(0[1-9]|1[0-2])$/.test(s);
}

const monatNr = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;

export function monatPlus(m: string, n: number): string {
  const x = monatNr(m) + n;
  return `${Math.floor(x / 12)}-${String((x % 12) + 1).padStart(2, "0")}`;
}

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

export function monatLabel(m: string): string {
  return `${MONATE[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
}

// ── Kosten ─────────────────────────────────────────────────────────────────

export type KostenRhythmus = "einmalig" | "monatlich" | "quartal" | "jaehrlich";

export const RHYTHMUS_LABELS: Record<KostenRhythmus, string> = {
  einmalig: "Einmalig",
  monatlich: "Monatlich",
  quartal: "Quartalsweise",
  jaehrlich: "Jährlich",
};

export const KOSTEN_KATEGORIE_LABELS = {
  marketing: "Marketing & Ads",
  personal: "Personal",
  provision: "Provisionen",
  software: "Software & Tools",
  buero: "Büro & Verwaltung",
  steuern: "Steuern & Abgaben",
  sonstiges: "Sonstiges",
} as const;
export type KostenKategorie = keyof typeof KOSTEN_KATEGORIE_LABELS;

export type KostenPosition = {
  id: string;
  name: string;
  kategorie: KostenKategorie;
  rhythmus: KostenRhythmus;
  start_monat: string;
  ende_monat: string | null;
};

export type KostenDaten = {
  positionen: readonly KostenPosition[];
  betraege: readonly { position_id: string; gueltig_ab: string; betrag: number }[];
  monate: readonly { position_id: string; monat: string; ist: number | null; ausgesetzt: boolean }[];
};

export type KostenZeile = {
  position: KostenPosition;
  plan: number;
  ist: number | null;
  ausgesetzt: boolean;
  /** Was zählt: 0 wenn ausgesetzt, sonst Ist, sonst Plan. */
  betrag: number;
};

const SCHRITT: Record<KostenRhythmus, number> = { einmalig: 0, monatlich: 1, quartal: 3, jaehrlich: 12 };

function faelltAn(p: KostenPosition, monat: string): boolean {
  if (monat < p.start_monat || (p.ende_monat && monat > p.ende_monat)) return false;
  const schritt = SCHRITT[p.rhythmus];
  if (schritt === 0) return monat === p.start_monat;
  return (monatNr(monat) - monatNr(p.start_monat)) % schritt === 0;
}

export function kostenImMonat(d: KostenDaten, monat: string): { zeilen: KostenZeile[]; summe: number } {
  const zeilen: KostenZeile[] = [];
  let summe = 0;
  for (const p of d.positionen) {
    if (!faelltAn(p, monat)) continue;
    let gueltig: { gueltig_ab: string; betrag: number } | null = null;
    for (const b of d.betraege) {
      if (b.position_id !== p.id || b.gueltig_ab > monat) continue;
      if (!gueltig || b.gueltig_ab > gueltig.gueltig_ab) gueltig = b;
    }
    const m = d.monate.find((x) => x.position_id === p.id && x.monat === monat);
    const plan = gueltig?.betrag ?? 0;
    const ist = m?.ist ?? null;
    const ausgesetzt = m?.ausgesetzt === true;
    const betrag = ausgesetzt ? 0 : (ist ?? plan);
    summe += cent(betrag);
    zeilen.push({ position: p, plan, ist, ausgesetzt, betrag });
  }
  return { zeilen, summe: eur(summe) };
}

// ── Was bleibt ─────────────────────────────────────────────────────────────

export type MonatsAbschluss = {
  monat: string;
  eingegangen: number;
  /** Rest der Raten dieses Monats, die noch nicht zu spät sind. */
  nochErwartet: number;
  /** Rest der Raten dieses Monats, die zu spät sind. Nicht in `rein`. */
  ueberfaelligImMonat: number;
  rein: number;
  raus: number;
  gewinn: number;
  ruecklage: number;
  frei: number;
};

export function monatsAbschluss(
  kunden: readonly KundeFinanz[],
  kosten: KostenDaten,
  ruecklageProzent: number,
  monat: string,
  heute: string,
): MonatsAbschluss {
  let eingang = 0;
  let erwartet = 0;
  let spaet = 0;
  for (const kunde of kunden) {
    for (const z of kunde.zahlungen) if (z.eingang_am.slice(0, 7) === monat) eingang += cent(z.betrag);
    for (const r of kunde.k.raten) {
      if (r.erlass || r.faellig_am.slice(0, 7) !== monat) continue;
      if (r.faellig_am < heute) spaet += cent(r.rest);
      else erwartet += cent(r.rest);
    }
  }
  const raus = cent(kostenImMonat(kosten, monat).summe);
  const gewinn = eingang + erwartet - raus;
  const ruecklage = Math.round((Math.max(0, gewinn) * ruecklageProzent) / 100);
  return {
    monat,
    eingegangen: eur(eingang),
    nochErwartet: eur(erwartet),
    ueberfaelligImMonat: eur(spaet),
    rein: eur(eingang + erwartet),
    raus: eur(raus),
    gewinn: eur(gewinn),
    ruecklage: eur(ruecklage),
    frei: eur(gewinn - ruecklage),
  };
}

// ── Monat nach Tagen ───────────────────────────────────────────────────────

type Wer = { kundeId: string; kunde: string };

export type MonatsTag = {
  tag: string;
  faellig: number;
  eingegangen: number;
  uebertragen: number;
  raten: (Wer & { rate: VerteilteRate })[];
  zahlungen: (Wer & { zahlung: UmsatzZahlung })[];
  uebertraege: (Wer & { vereinbarung: Vereinbarung })[];
};

/** Nur Tage, an denen etwas steht, aufsteigend. */
export function monatsTage(kunden: readonly KundeFinanz[], monat: string): MonatsTag[] {
  const tage = new Map<string, MonatsTag>();
  const am = (d: string): MonatsTag => {
    let t = tage.get(d);
    if (!t) {
      t = { tag: d, faellig: 0, eingegangen: 0, uebertragen: 0, raten: [], zahlungen: [], uebertraege: [] };
      tage.set(d, t);
    }
    return t;
  };
  const plus = (a: number, b: number) => eur(cent(a) + cent(b));

  for (const { id: kundeId, name: kunde, k, zahlungen, vereinbarungen } of kunden) {
    for (const rate of k.raten) {
      if (rate.erlass === "storniert" || rate.faellig_am.slice(0, 7) !== monat) continue;
      const t = am(rate.faellig_am);
      t.faellig = plus(t.faellig, rate.betrag);
      t.raten.push({ kundeId, kunde, rate });
    }
    for (const zahlung of zahlungen) {
      if (zahlung.eingang_am.slice(0, 7) !== monat) continue;
      const t = am(zahlung.eingang_am);
      t.eingegangen = plus(t.eingegangen, zahlung.betrag);
      t.zahlungen.push({ kundeId, kunde, zahlung });
    }
    // Der Ursprungsmonat behält die Spur eines Übertrags (B6). Eine Zusage
    // verschiebt nichts und steht deshalb nicht hier.
    for (const vereinbarung of vereinbarungen) {
      if (vereinbarung.art === "zusage" || vereinbarung.von_datum.slice(0, 7) !== monat) continue;
      const t = am(vereinbarung.von_datum);
      t.uebertragen = plus(t.uebertragen, vereinbarung.betrag);
      t.uebertraege.push({ kundeId, kunde, vereinbarung });
    }
  }
  return [...tage.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

// ── Überfällig ─────────────────────────────────────────────────────────────

export type Altersklasse = "bis7" | "bis30" | "ueber30";

export const ALTERSKLASSE_LABELS: Record<Altersklasse, string> = {
  bis7: "1–7 Tage",
  bis30: "8–30 Tage",
  ueber30: "über 30 Tage",
};

export function altersklasse(tage: number): Altersklasse {
  return tage <= 7 ? "bis7" : tage <= 30 ? "bis30" : "ueber30";
}

/** Die jüngste Zusage zu einer Rate, samt der Frage, ob sie gebrochen ist. */
export function zusageZuRate(
  rate: VerteilteRate,
  vereinbarungen: readonly Vereinbarung[],
  heute: string,
): { auf: string; gebrochen: boolean } | null {
  if (rate.rest <= 0 || rate.erlass) return null;
  let letzte: Vereinbarung | null = null;
  for (const v of vereinbarungen) {
    if (v.art !== "zusage" || v.rate_id !== rate.id) continue;
    if (!letzte || (v.created_at ?? "") >= (letzte.created_at ?? "")) letzte = v;
  }
  return letzte ? { auf: letzte.auf_datum, gebrochen: letzte.auf_datum < heute } : null;
}

// ── Brutto-Umrechner ───────────────────────────────────────────────────────

export function bruttoZuNetto(brutto: number, satz: number): number {
  return eur(Math.round((cent(brutto) * 100) / (100 + satz)));
}
