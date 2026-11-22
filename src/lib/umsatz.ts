// Umsatz-Rechnung der internen Kundenübersicht (Migration 0047).
//
// Reine Bibliothek ohne Datenbank — alles, was „kassiert", „ausstehend" oder
// „überfällig" heißt, entsteht HIER und nur hier. Seite, Kundenakte und Tests
// lesen dieselben Funktionen; zwei Rechnungen derselben Zahl liefen früher oder
// später auseinander (Muster `dranRegel.ts`).
//
// ── DIE EINE REGEL: Zahlungen werden nach Fälligkeit verteilt ─────────────
// Eine Zahlung hängt an keiner bestimmten Rate. Die Summe aller Eingänge eines
// Kunden füllt seine aktiven Raten in der Reihenfolge ihrer Fälligkeit auf —
// wie ein Kontosaldo. Daraus folgen alle Sonderfälle ohne eigene Regel:
//
//   · Teilzahlung       → die älteste offene Rate ist „teilbezahlt"
//   · Überzahlung       → was nach der letzten Rate übrig ist, ist Guthaben
//   · Rücklastschrift   → eine negative Zahlung, die Summe sinkt, die zuletzt
//                         gefüllte Rate ist wieder offen
//   · Vorauszahlung     → füllt die nächsten Raten mit, bevor sie fällig sind
//
// Gespeichert wird davon NICHTS: Der Zustand einer Rate ist abgeleitet, eine
// Spalte daneben wäre eine zweite Wahrheit.
//
// ── WAS GESPEICHERT WIRD: zwei Entscheidungen ────────────────────────────
//   storniert      die Rate wird nicht mehr geschuldet (Kündigung, Nachlass)
//   abgeschrieben  die Rate wäre geschuldet, wird aber nicht mehr kommen
//                  (Kunde abgesprungen, zahlt nicht)
// Beide Raten nehmen an der Verteilung NICHT teil. Kommt auf eine
// abgeschriebene Rate doch noch Geld (Inkasso), steht es als Guthaben da, bis
// jemand die Rate wieder aktiviert.
//
// Gerechnet wird in CENT (ganze Zahlen). 3 × 1633,33 € ergibt in Gleitkomma
// nicht 4899,99 €, und eine Übersicht, die um einen Cent „offen" zeigt, glaubt
// danach niemand mehr.

export type Erlass = "storniert" | "abgeschrieben";

export type UmsatzRate = {
  id: string;
  faellig_am: string; // YYYY-MM-DD
  betrag: number; // €
  erlass: Erlass | null;
  urspruenglich_faellig_am?: string | null;
  created_at?: string | null;
  notiz?: string | null;
  erlass_grund?: string | null;
  erlass_am?: string | null;
  /** Die Erstattung, die diese Rate storniert hat (Löschen stellt sie wieder her). */
  erlass_zahlung_id?: string | null;
  /** Beim Teilen: die Rate, von der dieser Teil stammt. */
  herkunft_rate_id?: string | null;
};

export type ZahlungsArt = "zahlung" | "erstattung" | "ruecklastschrift";

export type UmsatzZahlung = {
  id: string;
  eingang_am: string; // YYYY-MM-DD
  betrag: number; // €, vorzeichenbehaftet
  art: ZahlungsArt;
  zahlungsweg?: string | null;
  notiz?: string | null;
};

export type UmsatzVertrag = {
  vertragswert: number;
  gekuendigt_am: string | null;
  kuendigung_wirksam_zum: string | null;
  abgebrochen_am: string | null;
};

export type RatenZustand =
  | "bezahlt"
  | "teilbezahlt"
  | "offen"
  | "ueberfaellig"
  | "storniert"
  | "abgeschrieben";

export type VerteilteRate = UmsatzRate & {
  bezahlt: number; // €
  rest: number; // €
  zustand: RatenZustand;
  /** Tage nach Fälligkeit, solange ein Rest offen ist. Abgeleitet, nie gespeichert. */
  tage: number;
  /** Gestundet und auch das vereinbarte Datum ist verstrichen. */
  vereinbarungGebrochen: boolean;
};

export const RATEN_ZUSTAND_LABELS: Record<RatenZustand, string> = {
  bezahlt: "Bezahlt",
  teilbezahlt: "Teilbezahlt",
  offen: "Offen",
  ueberfaellig: "Überfällig",
  storniert: "Storniert",
  abgeschrieben: "Abgeschrieben",
};

export const ZAHLUNGS_ART_LABELS: Record<ZahlungsArt, string> = {
  zahlung: "Zahlung",
  erstattung: "Erstattung",
  ruecklastschrift: "Rücklastschrift",
};

export const cent = (eur: number | string | null | undefined): number =>
  Math.round(Number(eur ?? 0) * 100);
export const eur = (c: number): number => c / 100;

/** Kalendertage zwischen zwei YYYY-MM-DD; in UTC gerechnet, damit die Umstellung nichts kostet. */
export function tageZwischen(von: string, bis: string): number {
  return Math.round((Date.parse(`${bis}T00:00:00Z`) - Date.parse(`${von}T00:00:00Z`)) / 86_400_000);
}

function sortRaten<T extends UmsatzRate>(raten: readonly T[]): T[] {
  return [...raten].sort(
    (a, b) =>
      a.faellig_am.localeCompare(b.faellig_am) ||
      (a.created_at ?? "").localeCompare(b.created_at ?? "") ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Verteilt die Summe aller Zahlungen auf die aktiven Raten, älteste zuerst.
 * `heute` entscheidet nur zwischen „offen" und „überfällig" — eine Rate, die
 * HEUTE fällig ist, ist noch nicht überfällig (Tages-Körnung wie die ganze App,
 * docs §6). Der Tag kommt immer vom Aufrufer, nie aus `new Date()`.
 */
export function verteileZahlungen(
  raten: readonly UmsatzRate[],
  zahlungen: readonly UmsatzZahlung[],
  heute: string,
): { raten: VerteilteRate[]; guthaben: number; kassiert: number } {
  const kassiertC = zahlungen.reduce((s, z) => s + cent(z.betrag), 0);
  let pool = Math.max(0, kassiertC);

  const verteilt: VerteilteRate[] = sortRaten(raten).map((r) => {
    const betragC = cent(r.betrag);
    if (r.erlass) {
      return { ...r, bezahlt: 0, rest: 0, zustand: r.erlass, tage: 0, vereinbarungGebrochen: false };
    }
    const bezahltC = Math.min(pool, betragC);
    pool -= bezahltC;
    const restC = betragC - bezahltC;
    const zustand: RatenZustand =
      restC === 0
        ? "bezahlt"
        : r.faellig_am < heute
          ? "ueberfaellig"
          : bezahltC > 0
            ? "teilbezahlt"
            : "offen";
    const spaet = zustand === "ueberfaellig";
    return {
      ...r,
      bezahlt: eur(bezahltC),
      rest: eur(restC),
      zustand,
      tage: spaet ? tageZwischen(r.faellig_am, heute) : 0,
      vereinbarungGebrochen:
        spaet && !!r.urspruenglich_faellig_am && r.urspruenglich_faellig_am !== r.faellig_am,
    };
  });

  // Ein negativer Saldo (Rücklastschrift ohne vorherige Zahlung) ist ein
  // Erfassungsfehler — er erscheint als negatives Guthaben, statt verschluckt
  // zu werden.
  const guthabenC = kassiertC < 0 ? kassiertC : pool;
  return { raten: verteilt, guthaben: eur(guthabenC), kassiert: eur(kassiertC) };
}

export type FinanzStatus =
  | "vertrag_fehlt"
  | "plan_fehlt"
  | "plan_unvollstaendig"
  | "ueberfaellig"
  | "laeuft"
  | "bezahlt"
  | "gekuendigt"
  | "abgebrochen";

export const FINANZ_STATUS_LABELS: Record<FinanzStatus, string> = {
  vertrag_fehlt: "Vertrag fehlt",
  plan_fehlt: "Zahlungsplan fehlt",
  plan_unvollstaendig: "Plan unvollständig",
  ueberfaellig: "Überfällig",
  laeuft: "Läuft",
  bezahlt: "Vollständig bezahlt",
  gekuendigt: "Gekündigt",
  abgebrochen: "Abgebrochen",
};

/** Badge-Töne (Werte von `BadgeTone`, hier als Literal, damit das Modul
 *  ohne Komponenten-Import auskommt). */
export const FINANZ_TONE: Record<FinanzStatus, "warning" | "error" | "info" | "success" | "neutral"> = {
  vertrag_fehlt: "warning",
  plan_fehlt: "warning",
  plan_unvollstaendig: "warning",
  ueberfaellig: "error",
  laeuft: "info",
  bezahlt: "success",
  gekuendigt: "neutral",
  abgebrochen: "warning",
};

export const ZUSTAND_TONE: Record<RatenZustand, "success" | "info" | "neutral" | "error" | "warning"> = {
  bezahlt: "success",
  teilbezahlt: "info",
  offen: "neutral",
  ueberfaellig: "error",
  storniert: "neutral",
  abgeschrieben: "warning",
};

export type KundenKennzahlen = {
  vertragswert: number;
  /** Summe aller Eingänge, Erstattungen und Rücklastschriften abgezogen. */
  kassiert: number;
  /** Rest aller aktiven Raten, deren Fälligkeit vor heute liegt. */
  ueberfaellig: number;
  /** Rest aller aktiven Raten, die heute oder später fällig sind. */
  kuenftig: number;
  /** überfällig + künftig */
  offen: number;
  abgeschrieben: number;
  storniert: number;
  /** Vertragswert, den noch keine Rate abbildet (auch keine stornierte). */
  nichtVerplant: number;
  /** So viel fordern die Raten mehr, als der Vertrag hergibt. */
  zuvielVerplant: number;
  /** Tage der ältesten überfälligen Rate, sonst 0. */
  tageUeberfaellig: number;
  guthaben: number;
  naechsteRate: VerteilteRate | null;
  raten: VerteilteRate[];
  status: FinanzStatus;
};

export function kundenKennzahlen(
  vertrag: UmsatzVertrag | null,
  raten: readonly UmsatzRate[],
  zahlungen: readonly UmsatzZahlung[],
  heute: string,
): KundenKennzahlen {
  const v = verteileZahlungen(raten, zahlungen, heute);
  let ueberC = 0;
  let kuenftigC = 0;
  let abgC = 0;
  let stornoC = 0;
  let geplantC = 0;
  for (const r of v.raten) {
    geplantC += cent(r.betrag);
    if (r.zustand === "abgeschrieben") abgC += cent(r.betrag);
    else if (r.zustand === "storniert") stornoC += cent(r.betrag);
    else if (r.zustand === "ueberfaellig") ueberC += cent(r.rest);
    else kuenftigC += cent(r.rest);
  }
  const vertragswertC = cent(vertrag?.vertragswert ?? 0);
  const nichtVerplantC = Math.max(0, vertragswertC - geplantC);
  const naechsteRate =
    v.raten.find((r) => r.zustand === "ueberfaellig") ??
    v.raten.find((r) => r.zustand === "offen" || r.zustand === "teilbezahlt") ??
    null;

  let status: FinanzStatus;
  if (vertrag?.abgebrochen_am) status = "abgebrochen";
  else if (vertrag?.gekuendigt_am && ueberC === 0 && kuenftigC === 0) status = "gekuendigt";
  else if (ueberC > 0) status = "ueberfaellig";
  else if (raten.length === 0) status = vertragswertC > 0 ? "plan_fehlt" : "vertrag_fehlt";
  else if (vertrag?.gekuendigt_am) status = "gekuendigt";
  else if (kuenftigC > 0) status = "laeuft";
  else if (nichtVerplantC > 0) status = "plan_unvollstaendig";
  else status = "bezahlt";

  return {
    vertragswert: eur(vertragswertC),
    kassiert: v.kassiert,
    ueberfaellig: eur(ueberC),
    kuenftig: eur(kuenftigC),
    offen: eur(ueberC + kuenftigC),
    abgeschrieben: eur(abgC),
    storniert: eur(stornoC),
    nichtVerplant: eur(nichtVerplantC),
    // Stornos zählen hier nicht: Sie fordern nichts mehr.
    zuvielVerplant: eur(Math.max(0, geplantC - stornoC - vertragswertC)),
    tageUeberfaellig: v.raten.reduce((max, r) => Math.max(max, r.tage), 0),
    guthaben: v.guthaben,
    naechsteRate,
    raten: v.raten,
    status,
  };
}

// ── Ratenplan erzeugen ─────────────────────────────────────────────────────

/** Monate addieren mit Monatsende-Klemme: 31.01. + 1 Monat = 28./29.02. */
export function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

export type RatenplanInput = {
  /** Was über die Raten verteilt wird (Vertragswert minus Anzahlung). */
  gesamt: number;
  anzahl: number;
  erstesDatum: string;
  /** 1 = monatlich, 3 = quartalsweise … */
  rhythmusMonate: number;
  /** Optional: eine Anzahlung als eigene Rate vor den übrigen. */
  anzahlung?: number | null;
  anzahlungDatum?: string | null;
};

/**
 * Teilt einen Betrag auf `anzahl` gleiche Raten; der Rundungsrest landet auf
 * der LETZTEN Rate, damit die Summe exakt stimmt (4900 / 3 = 1633,33 +
 * 1633,33 + 1633,34).
 */
export function erzeugeRatenplan(input: RatenplanInput): { faellig_am: string; betrag: number }[] {
  const out: { faellig_am: string; betrag: number }[] = [];
  const anzC = cent(input.anzahlung ?? 0);
  if (anzC > 0) {
    out.push({ faellig_am: input.anzahlungDatum || input.erstesDatum, betrag: eur(anzC) });
  }
  const n = Math.max(0, Math.floor(input.anzahl));
  const gesamtC = cent(input.gesamt);
  if (n === 0 || gesamtC <= 0) return out;
  const basis = Math.floor(gesamtC / n);
  const rest = gesamtC - basis * n;
  const schritt = Math.max(1, Math.floor(input.rhythmusMonate || 1));
  for (let i = 0; i < n; i++) {
    out.push({
      faellig_am: addMonthsISO(input.erstesDatum, i * schritt),
      betrag: eur(i === n - 1 ? basis + rest : basis),
    });
  }
  return out.filter((r) => r.betrag > 0);
}

// ── Kündigung und Abbruch ──────────────────────────────────────────────────

/**
 * Kündigung zum `wirksamZum`: Alle aktiven Raten, die NACH diesem Tag fällig
 * werden, werden storniert. Was bis dahin fällig war, bleibt geschuldet — eine
 * Kündigung ist kein Erlass. Rein: liefert nur die IDs.
 */
export function ratenFuerKuendigung(raten: readonly UmsatzRate[], wirksamZum: string): string[] {
  return raten.filter((r) => !r.erlass && r.faellig_am > wirksamZum).map((r) => r.id);
}

export type AbbruchSchritt =
  | { art: "abschreiben"; id: string }
  /** Teilbezahlte Rate: auf den bezahlten Teil kürzen, der Rest wird eine
   *  eigene, abgeschriebene Rate. Sonst stünde der bezahlte Teil danach als
   *  Guthaben da, obwohl er die Rate bezahlt hat. */
  | { art: "teilen"; id: string; bezahlt: number; rest: number; faellig_am: string };

/**
 * Abbruch: Alles, was noch offen ist, wird abgeschrieben. Vollständig bezahlte
 * Raten bleiben, teilbezahlte werden geteilt.
 */
export function schritteFuerAbbruch(
  raten: readonly UmsatzRate[],
  zahlungen: readonly UmsatzZahlung[],
  heute: string,
): AbbruchSchritt[] {
  const v = verteileZahlungen(raten, zahlungen, heute);
  const out: AbbruchSchritt[] = [];
  for (const r of v.raten) {
    if (r.erlass || r.rest <= 0) continue;
    if (r.bezahlt > 0) {
      out.push({ art: "teilen", id: r.id, bezahlt: r.bezahlt, rest: r.rest, faellig_am: r.faellig_am });
    } else {
      out.push({ art: "abschreiben", id: r.id });
    }
  }
  return out;
}

/**
 * Liest einen Betrag so, wie ihn ein Mensch in Deutschland tippt:
 * „1.633,33", „1633,33", „1633.33", „4900", „4.900 €". Ein einzelner Punkt
 * mit genau drei Ziffern dahinter ist ein Tausenderpunkt („4.900"), sonst ein
 * Dezimalpunkt („1633.5"). Liefert null bei allem, was keine Zahl ist.
 */
export function parseEuro(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw * 100) / 100 : null;
  let s = (raw ?? "").replace(/[€\s]/g, "");
  if (!s) return null;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function formatEur(v: number, opts: { cents?: boolean } = {}): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  }).format(v);
}

/** Cent-genau, aber ohne ,00 bei glatten Beträgen. */
export function formatEurGenau(v: number): string {
  return formatEur(v, { cents: cent(v) % 100 !== 0 });
}

/**
 * „30.11.2026". Eigene Funktion statt `formatDateDe`: Die lebt in einem
 * "use client"-Modul, und aus einer Serverseite aufgerufen wirft sie zur
 * Laufzeit, obwohl der Build durchläuft (B19).
 */
export function datumDe(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10).split("-").reverse().join(".");
}
