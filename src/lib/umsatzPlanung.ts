// Geldaktionen des Kundenspace: reine Funktionen, keine Datenbank.
//
// Jede Aktion bekommt den STAND eines Kunden und liefert eine ÄNDERUNG, die
// `finanz_anwenden()` (Migration 0047) in EINER Transaktion schreibt. Dieselben
// Funktionen rechnen die Vorschau im Dialog und die Wahrheit auf dem Server.
//
// ── DIE INVARIANTE ────────────────────────────────────────────────────────
// Zahlungen hängen an keiner Rate, sie füllen die älteste zuerst. Wer eine
// angezahlte Rate als Ganzes verschöbe, schickte ihre Anzahlung auf die nächste
// (B2: 500 € bezahlt, Überfällig sinkt um 1.000 € statt um 500 €). Deshalb gilt
// überall: Was bezahlt ist, bleibt an seinem Datum stehen. Bewegt, erlassen
// oder ersetzt wird ausschließlich der offene REST, notfalls durch Teilen.

import {
  addMonthsISO,
  cent,
  eur,
  ratenFuerKuendigung,
  schritteFuerAbbruch,
  verteileZahlungen,
  type Erlass,
  type UmsatzRate,
  type UmsatzVertrag,
  type UmsatzZahlung,
  type VerteilteRate,
  type ZahlungsArt,
} from "@/lib/umsatz";

export const ERLASS_KUENDIGUNG = "Kündigung";
export const ERLASS_ABBRUCH = "Abbruch";
const ERLASS_ERSTATTUNG = "Erstattung";
const DATUM = /^\d{4}-\d{2}-\d{2}$/;

export type Stand = {
  vertrag: UmsatzVertrag;
  raten: readonly UmsatzRate[];
  zahlungen: readonly UmsatzZahlung[];
};

export type VereinbarungArt = "zusage" | "stundung" | "uebertrag";

export type NeueVereinbarung = {
  rate_id: string | null;
  art: VereinbarungArt;
  betrag: number;
  von_datum: string;
  auf_datum: string;
  grund: string;
};

export type Aenderung = {
  ratenAendern?: (Partial<UmsatzRate> & { id: string })[];
  ratenNeu?: UmsatzRate[];
  ratenLoeschen?: string[];
  zahlungenNeu?: UmsatzZahlung[];
  zahlungenLoeschen?: string[];
  vereinbarungen?: NeueVereinbarung[];
  /** Raten, deren Stundungs-Vermerk beim Zurücknehmen wegfällt. */
  stundungLoeschen?: string[];
  vertrag?: Partial<UmsatzVertrag> & Record<string, unknown>;
  /** Kundenstatus; mit `nurVon` nur, wenn er gerade so steht. */
  status?: { auf: string; nurVon?: string };
  /** Eine Zeile für den Verlauf. */
  log: string;
};

export type Ergebnis = { aenderung: Aenderung } | { error: string } | { doppelt: string };
export type Kontext = { heute: string; neueId: () => string };

const tag = (iso: string) => iso.split("-").reverse().join(".");
const euro = (v: number) => `${v.toLocaleString("de-DE", { maximumFractionDigits: 2 })} €`;

/** Echtes Datum, nicht nur das Muster: der 31.02. ist keines. */
export function istDatum(s: unknown): s is string {
  if (typeof s !== "string" || !DATUM.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Der Referenztag ändert an bezahlt/Rest nichts, nur an offen/überfällig.
const verteilt = (s: Stand, heute = "0000-01-01") => verteileZahlungen(s.raten, s.zahlungen, heute);

function offeneRate(s: Stand, id: string): VerteilteRate | { error: string } {
  const r = verteilt(s).raten.find((x) => x.id === id);
  if (!r) return { error: "Rate nicht gefunden." };
  if (r.erlass) return { error: "Die Rate ist storniert oder abgeschrieben." };
  if (cent(r.rest) <= 0) return { error: "Die Rate ist schon vollständig bezahlt." };
  return r;
}

function teilbetrag(r: VerteilteRate, betrag: number | undefined): number | { error: string } {
  const c = betrag === undefined ? cent(r.rest) : cent(betrag);
  if (!Number.isFinite(c) || c <= 0) return { error: "Bitte einen Betrag über 0 eingeben." };
  if (c > cent(r.rest)) return { error: `Offen sind auf dieser Rate nur ${euro(r.rest)}.` };
  return c;
}

/**
 * Nimmt `c` Cent aus dem Rest einer Rate und gibt ihnen neue Eigenschaften.
 * Ist es die ganze unbezahlte Rate, ändert sie sich selbst; sonst wird geteilt.
 */
function restAbspalten(
  r: VerteilteRate,
  c: number,
  neu: Partial<UmsatzRate>,
  ctx: Kontext,
): { id: string; aendern: Partial<UmsatzRate> & { id: string }; rate?: UmsatzRate } {
  if (c === cent(r.betrag)) return { id: r.id, aendern: { id: r.id, ...neu } };
  const id = ctx.neueId();
  return {
    id,
    aendern: { id: r.id, betrag: eur(cent(r.betrag) - c) },
    rate: {
      id,
      faellig_am: r.faellig_am,
      betrag: eur(c),
      erlass: null,
      urspruenglich_faellig_am: r.urspruenglich_faellig_am ?? null,
      herkunft_rate_id: r.id,
      ...neu,
    },
  };
}

/** Der Tag, auf den der Plan zielt: 31 bei 31.01., 28.02., 31.03. */
function ankerTag(raten: readonly UmsatzRate[]): number {
  return raten.reduce((max, r) => (r.erlass ? max : Math.max(max, Number(r.faellig_am.slice(8)))), 0);
}

/** Monate addieren, ohne den Monatsletzten zu verlieren: 28.02. + 1 ist im Plan vom 31. der 31.03. */
function monatePlus(iso: string, n: number, anker: number): string {
  const tagImMonat = Number(iso.slice(8));
  const letzter = (monat: string) => new Date(Date.UTC(Number(monat.slice(0, 4)), Number(monat.slice(5, 7)), 0)).getUTCDate();
  if (anker <= tagImMonat || tagImMonat !== letzter(iso)) return addMonthsISO(iso, n);
  const ziel = addMonthsISO(`${iso.slice(0, 7)}-01`, n).slice(0, 7);
  return `${ziel}-${String(Math.min(anker, letzter(ziel))).padStart(2, "0")}`;
}

/** Vor eine bezahlte Rate gezogen nähme eine Rate ihr das Geld weg (älteste zuerst). */
function zoegeVorBezahlte(s: Stand, id: string, auf: string): boolean {
  return verteilt(s).raten.some((r) => r.id !== id && !r.erlass && cent(r.bezahlt) > 0 && r.faellig_am > auf);
}

// ── Ratenplan ──────────────────────────────────────────────────────────────

/**
 * Was ein neuer Plan verteilen soll. Nie ein Rückfall auf den Vertragswert:
 * genau der hat einen vollen Plan verdoppelt (B1).
 */
export function planVorschlag(s: Stand, modus: "ersetzen" | "ergaenzen", heute: string): number {
  let bleibt = 0;
  for (const r of verteilt(s, heute).raten) {
    bleibt += modus === "ergaenzen" || r.erlass ? cent(r.betrag) : cent(r.bezahlt);
  }
  return eur(Math.max(0, cent(s.vertrag.vertragswert) - bleibt));
}

export function planAnlegen(
  s: Stand,
  input: {
    modus: "ersetzen" | "ergaenzen";
    raten: readonly { faellig_am: string; betrag: number }[];
    /** Schnellerfassung: die ersten X Raten sind schon bezahlt. */
    bezahltBis?: number;
    /** Schnellerfassung: so viel ist auf die Rate danach angezahlt. */
    teilbetrag?: number;
  },
  ctx: Kontext,
): Ergebnis {
  if (input.modus !== "ersetzen" && input.modus !== "ergaenzen") return { error: "Unbekannte Planart." };
  if (!input.raten.length || input.raten.length > 121) return { error: "Ein Plan hat 1 bis 120 Raten." };
  if (input.raten.some((r) => !istDatum(r.faellig_am) || !(cent(r.betrag) > 0))) {
    return { error: "Jede Rate braucht ein Datum und einen Betrag über 0." };
  }
  const bis = input.bezahltBis ?? 0;
  const teil = cent(input.teilbetrag ?? 0);
  if (!Number.isInteger(bis) || bis < 0 || bis > input.raten.length) return { error: "So viele Raten hat der Plan nicht." };
  if (!Number.isFinite(teil) || teil < 0) return { error: "Ungültige Anzahlung." };
  if ((bis > 0 || teil > 0) && s.zahlungen.length > 0) {
    return { error: "Es sind schon Zahlungen gebucht. Weitere bitte einzeln erfassen." };
  }
  if ((bis > 0 || teil > 0) && input.modus === "ergaenzen" && s.raten.some((r) => !r.erlass)) {
    return { error: "Es gibt schon Raten. Schnellerfassung geht nur für den ersten Plan oder beim Ersetzen." };
  }
  const sortiert = [...input.raten].sort((a, b) => a.faellig_am.localeCompare(b.faellig_am));
  if (teil > 0 && (bis >= sortiert.length || teil >= cent(sortiert[bis].betrag))) {
    return { error: "Die Anzahlung muss kleiner sein als die nächste Rate." };
  }

  const a: Aenderung = { log: "" };
  if (input.modus === "ersetzen") {
    a.ratenAendern = [];
    a.ratenLoeschen = [];
    for (const r of verteilt(s, ctx.heute).raten) {
      if (r.erlass || cent(r.rest) === 0) continue;
      if (cent(r.bezahlt) > 0) a.ratenAendern.push({ id: r.id, betrag: r.bezahlt });
      else a.ratenLoeschen.push(r.id);
    }
  }
  a.ratenNeu = sortiert.map((r) => ({
    id: ctx.neueId(),
    faellig_am: r.faellig_am,
    betrag: eur(cent(r.betrag)),
    erlass: null,
  }));

  if (bis > 0 || teil > 0) {
    const eingang = (d: string) => (d < ctx.heute ? d : ctx.heute);
    const notiz = "Schnellerfassung: Datum laut Plan, nicht laut Konto";
    a.zahlungenNeu = sortiert.slice(0, bis).map((r) => ({
      id: ctx.neueId(),
      eingang_am: eingang(r.faellig_am),
      betrag: eur(cent(r.betrag)),
      art: "zahlung",
      notiz,
    }));
    if (teil > 0) {
      a.zahlungenNeu.push({ id: ctx.neueId(), eingang_am: eingang(sortiert[bis].faellig_am), betrag: eur(teil), art: "zahlung", notiz });
    }
  }

  const summe = eur(sortiert.reduce((n, r) => n + cent(r.betrag), 0));
  a.log =
    `${input.modus === "ersetzen" ? "Offenen Plan ersetzt" : "Ratenplan angelegt"}: ${sortiert.length} Raten, ${euro(summe)}` +
    (bis ? `, davon ${bis} als bezahlt übernommen` : "") +
    ".";
  return { aenderung: a };
}

// ── Vereinbarungen ─────────────────────────────────────────────────────────

/** Stundung: eine echte Einigung. Bis zum neuen Datum nicht überfällig. */
export function verschieben(
  s: Stand,
  input: { rateId: string; auf: string; grund: string; betrag?: number },
  ctx: Kontext,
): Ergebnis {
  const grund = input.grund?.trim();
  if (!grund) return { error: "Bitte festhalten, was vereinbart wurde." };
  if (!istDatum(input.auf) || input.auf < ctx.heute) return { error: "Das neue Datum darf nicht in der Vergangenheit liegen." };
  const r = offeneRate(s, input.rateId);
  if ("error" in r) return r;
  if (input.auf <= r.faellig_am) return { error: "Eine Stundung geht nur nach hinten. Zahlt er früher, einfach den Eingang buchen." };
  const c = teilbetrag(r, input.betrag);
  if (typeof c !== "number") return c;

  const t = restAbspalten(
    r,
    c,
    { faellig_am: input.auf, urspruenglich_faellig_am: r.urspruenglich_faellig_am ?? r.faellig_am },
    ctx,
  );
  return {
    aenderung: {
      ratenAendern: [t.aendern],
      ratenNeu: t.rate ? [t.rate] : undefined,
      vereinbarungen: [{ rate_id: t.id, art: "stundung", betrag: eur(c), von_datum: r.faellig_am, auf_datum: input.auf, grund }],
      log: `${euro(eur(c))} vom ${tag(r.faellig_am)} auf den ${tag(input.auf)} gestundet: ${grund}`,
    },
  };
}

/** Übertrag: der Rest verteilt sich auf die kommenden Raten. */
export function aufFolgeraten(
  s: Stand,
  input: { rateId: string; grund: string; betrag?: number },
  ctx: Kontext,
): Ergebnis {
  const grund = input.grund?.trim();
  if (!grund) return { error: "Bitte festhalten, was vereinbart wurde." };
  const r = offeneRate(s, input.rateId);
  if ("error" in r) return r;
  const c = teilbetrag(r, input.betrag);
  if (typeof c !== "number") return c;

  const ziele = verteilt(s, ctx.heute).raten.filter(
    (x) => !x.erlass && cent(x.rest) > 0 && x.faellig_am >= ctx.heute && x.faellig_am > r.faellig_am,
  );
  if (!ziele.length) return { error: "Es gibt keine spätere Rate. Bitte ans Planende verschieben." };

  const basis = Math.floor(c / ziele.length);
  const a: Aenderung = {
    ratenAendern: [],
    vereinbarungen: [],
    log: `${euro(eur(c))} vom ${tag(r.faellig_am)} auf ${ziele.length} Folgeraten übertragen: ${grund}`,
  };
  ziele.forEach((ziel, i) => {
    const anteil = i === ziele.length - 1 ? c - basis * (ziele.length - 1) : basis;
    if (!anteil) return;
    a.ratenAendern!.push({ id: ziel.id, betrag: eur(cent(ziel.betrag) + anteil) });
    a.vereinbarungen!.push({
      rate_id: ziel.id,
      art: "uebertrag",
      betrag: eur(anteil),
      von_datum: r.faellig_am,
      auf_datum: ziel.faellig_am,
      grund,
    });
  });
  if (c === cent(r.betrag)) a.ratenLoeschen = [r.id];
  else a.ratenAendern!.push({ id: r.id, betrag: eur(cent(r.betrag) - c) });
  return { aenderung: a };
}

/** Das Datum einen Rhythmus nach der letzten aktiven Rate. */
export function planEnde(raten: readonly UmsatzRate[]): string | null {
  const d = [...new Set(raten.filter((r) => !r.erlass).map((r) => r.faellig_am))].sort();
  if (!d.length) return null;
  const letzte = d[d.length - 1];
  let schritt = 1;
  if (d.length > 1) {
    const monate = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7));
    const abstand = monate(letzte) - monate(d[d.length - 2]);
    if (abstand === 3 || abstand === 6 || abstand === 12) schritt = abstand;
  }
  return monatePlus(letzte, schritt, ankerTag(raten));
}

/** Pause: alle offenen künftigen Raten rücken. Überfälliges bleibt überfällig. */
export function pausieren(s: Stand, input: { monate: number; grund: string }, ctx: Kontext): Ergebnis {
  const grund = input.grund?.trim();
  if (!grund) return { error: "Bitte festhalten, was vereinbart wurde." };
  if (!Number.isInteger(input.monate) || input.monate < 1 || input.monate > 24) return { error: "1 bis 24 Monate." };
  const offen = verteilt(s, ctx.heute).raten.filter((r) => !r.erlass && cent(r.rest) > 0 && r.faellig_am >= ctx.heute);
  if (!offen.length) return { error: "Es gibt keine künftige offene Rate." };

  const a: Aenderung = {
    ratenAendern: [],
    ratenNeu: [],
    vereinbarungen: [],
    log: `${input.monate} Monate Zahlungspause, ${offen.length} Raten verschoben: ${grund}`,
  };
  const anker = ankerTag(s.raten);
  for (const r of offen) {
    const auf = monatePlus(r.faellig_am, input.monate, anker);
    const c = cent(r.rest);
    const t = restAbspalten(r, c, { faellig_am: auf, urspruenglich_faellig_am: r.urspruenglich_faellig_am ?? r.faellig_am }, ctx);
    a.ratenAendern!.push(t.aendern);
    if (t.rate) a.ratenNeu!.push(t.rate);
    a.vereinbarungen!.push({ rate_id: t.id, art: "stundung", betrag: eur(c), von_datum: r.faellig_am, auf_datum: auf, grund });
  }
  return { aenderung: a };
}

/** Zusage: er verspricht nur. Fälligkeit und Tage bleiben, es kommt ein Vermerk dazu. */
export function zusagen(
  s: Stand,
  input: { rateId: string; auf: string; grund?: string; betrag?: number },
  ctx: Kontext,
): Ergebnis {
  if (!istDatum(input.auf) || input.auf < ctx.heute) return { error: "Das zugesagte Datum darf nicht in der Vergangenheit liegen." };
  const r = offeneRate(s, input.rateId);
  if ("error" in r) return r;
  const c = teilbetrag(r, input.betrag);
  if (typeof c !== "number") return c;
  const grund = input.grund?.trim() || "Zahlung zugesagt";
  return {
    aenderung: {
      vereinbarungen: [{ rate_id: r.id, art: "zusage", betrag: eur(c), von_datum: r.faellig_am, auf_datum: input.auf, grund }],
      log: `${euro(eur(c))} zum ${tag(input.auf)} zugesagt (fällig ${tag(r.faellig_am)}): ${grund}`,
    },
  };
}

// ── Einzelne Raten ─────────────────────────────────────────────────────────

/** Nachlass oder Ausfall: trifft nur den offenen Rest. */
export function erlassen(
  s: Stand,
  input: { rateId: string; erlass: Erlass; grund?: string },
  ctx: Kontext,
): Ergebnis {
  if (input.erlass !== "storniert" && input.erlass !== "abgeschrieben") return { error: "Unbekannte Art." };
  const r = offeneRate(s, input.rateId);
  if ("error" in r) return r;
  let grund = input.grund?.trim() || null;
  // Diese beiden Wörter erkennen das Zurücknehmen von Kündigung und Abbruch.
  if (grund === ERLASS_KUENDIGUNG || grund === ERLASS_ABBRUCH) {
    grund = `${input.erlass === "storniert" ? "Nachlass" : "Ausfall"}: ${grund}`;
  }
  const t = restAbspalten(r, cent(r.rest), { erlass: input.erlass, erlass_am: ctx.heute, erlass_grund: grund }, ctx);
  return {
    aenderung: {
      ratenAendern: [t.aendern],
      ratenNeu: t.rate ? [t.rate] : undefined,
      log: `${euro(r.rest)} vom ${tag(r.faellig_am)} ${input.erlass}${grund ? `: ${grund}` : ""}.`,
    },
  };
}

export function reaktivieren(s: Stand, id: string): Ergebnis {
  const r = s.raten.find((x) => x.id === id);
  if (!r?.erlass) return { error: "Die Rate ist nicht storniert oder abgeschrieben." };
  if (r.erlass_zahlung_id) return { error: "Gehört zu einer Erstattung. Bitte stattdessen die Erstattung löschen." };
  return {
    aenderung: {
      ratenAendern: [{ id, erlass: null, erlass_am: null, erlass_grund: null }],
      log: `${euro(r.betrag)} vom ${tag(r.faellig_am)} wieder aktiv.`,
    },
  };
}

/** Nur für Eingabefehler. Eine Einigung mit dem Kunden ist eine Stundung. */
export function rateKorrigieren(
  s: Stand,
  input: { rateId: string; betrag: number; faellig_am: string; notiz?: string | null },
): Ergebnis {
  const r = verteilt(s).raten.find((x) => x.id === input.rateId);
  if (!r || r.erlass) return { error: "Rate nicht gefunden." };
  if (!istDatum(input.faellig_am)) return { error: "Bitte ein gültiges Datum angeben." };
  if (!(cent(input.betrag) > 0)) return { error: "Bitte einen Betrag über 0 eingeben." };
  if (cent(input.betrag) < cent(r.bezahlt)) return { error: `Darauf sind schon ${euro(r.bezahlt)} bezahlt.` };
  if (cent(r.bezahlt) > 0 && input.faellig_am !== r.faellig_am) {
    return { error: "Auf die Rate ist schon gezahlt. Den Rest bitte stunden." };
  }
  if (input.faellig_am < r.faellig_am && zoegeVorBezahlte(s, r.id, input.faellig_am)) {
    return { error: "Das läge vor einer schon bezahlten Rate und nähme ihr die Zahlung weg." };
  }
  return {
    aenderung: {
      ratenAendern: [
        {
          id: r.id,
          betrag: eur(cent(input.betrag)),
          faellig_am: input.faellig_am,
          ...(input.notiz !== undefined ? { notiz: input.notiz?.trim() || null } : {}),
        },
      ],
      log: `Rate korrigiert: ${euro(r.betrag)} am ${tag(r.faellig_am)} → ${euro(input.betrag)} am ${tag(input.faellig_am)}.`,
    },
  };
}

export function rateLoeschen(s: Stand, id: string): Ergebnis {
  const r = verteilt(s).raten.find((x) => x.id === id);
  if (!r) return { error: "Rate nicht gefunden." };
  if (cent(r.bezahlt) > 0) return { error: "Auf die Rate ist gezahlt, sie kann nicht gelöscht werden." };
  if (r.erlass_zahlung_id) return { error: "Gehört zu einer Erstattung. Bitte diese löschen." };
  return { aenderung: { ratenLoeschen: [id], log: `Rate über ${euro(r.betrag)} vom ${tag(r.faellig_am)} gelöscht.` } };
}

// ── Buchungen ──────────────────────────────────────────────────────────────

export function buchen(
  s: Stand,
  input: {
    art: ZahlungsArt;
    /** Immer positiv, das Vorzeichen folgt der Art. */
    betrag: number;
    eingang_am: string;
    zahlungsweg?: string | null;
    notiz?: string | null;
    trotzDoppelt?: boolean;
  },
  ctx: Kontext,
): Ergebnis {
  if (input.art !== "zahlung" && input.art !== "erstattung" && input.art !== "ruecklastschrift") {
    return { error: "Unbekannte Buchungsart." };
  }
  const c = Math.abs(cent(input.betrag));
  if (!Number.isFinite(c) || c === 0) return { error: "Bitte einen Betrag eingeben." };
  if (!istDatum(input.eingang_am)) return { error: "Bitte ein gültiges Datum angeben." };
  if (input.eingang_am > ctx.heute) return { error: "Gebucht wird erst, wenn das Geld da ist. Für später gibt es die Zusage." };

  const v = verteilt(s, ctx.heute);
  if (input.art !== "zahlung" && c > cent(v.kassiert)) return { error: `Eingegangen sind nur ${euro(v.kassiert)}.` };

  const signiert = input.art === "zahlung" ? c : -c;
  if (
    !input.trotzDoppelt &&
    s.zahlungen.some((z) => z.eingang_am === input.eingang_am && z.art === input.art && cent(z.betrag) === signiert)
  ) {
    return { doppelt: `Am ${tag(input.eingang_am)} sind schon ${euro(eur(c))} gebucht. Wirklich noch einmal?` };
  }

  const id = ctx.neueId();
  const was = { zahlung: "Zahlung", erstattung: "Erstattung", ruecklastschrift: "Rücklastschrift" }[input.art];
  const a: Aenderung = {
    zahlungenNeu: [
      {
        id,
        eingang_am: input.eingang_am,
        betrag: eur(signiert),
        art: input.art,
        zahlungsweg: input.zahlungsweg?.trim() || null,
        notiz: input.notiz?.trim() || null,
      },
    ],
    log: `${was} über ${euro(eur(c))} am ${tag(input.eingang_am)} gebucht.`,
  };

  if (input.art === "erstattung") {
    // Eine Erstattung ist keine neue Forderung: Was sie über das Guthaben
    // hinaus zurückgibt, wird von den zuletzt gefüllten Raten storniert.
    let rest = c - Math.max(0, cent(v.guthaben));
    a.ratenAendern = [];
    a.ratenNeu = [];
    for (const r of [...v.raten].reverse()) {
      if (rest <= 0) break;
      if (r.erlass || cent(r.bezahlt) <= 0) continue;
      const x = Math.min(rest, cent(r.bezahlt));
      rest -= x;
      const t = restAbspalten(
        r,
        x,
        { erlass: "storniert", erlass_am: input.eingang_am, erlass_grund: ERLASS_ERSTATTUNG, erlass_zahlung_id: id },
        ctx,
      );
      a.ratenAendern.push(t.aendern);
      if (t.rate) a.ratenNeu.push(t.rate);
    }
  }
  return { aenderung: a };
}

export function buchungLoeschen(s: Stand, id: string): Ergebnis {
  const z = s.zahlungen.find((x) => x.id === id);
  if (!z) return { error: "Buchung nicht gefunden." };
  if (s.zahlungen.reduce((n, x) => n + (x.id === id ? 0 : cent(x.betrag)), 0) < 0) {
    return { error: "Danach wäre mehr zurückgegangen als eingegangen. Bitte zuerst die Erstattung oder Rücklastschrift löschen." };
  }
  return {
    aenderung: {
      zahlungenLoeschen: [id],
      ratenAendern: s.raten
        .filter((r) => r.erlass_zahlung_id === id)
        .map((r) => ({ id: r.id, erlass: null, erlass_am: null, erlass_grund: null, erlass_zahlung_id: null })),
      log: `Buchung über ${euro(z.betrag)} vom ${tag(z.eingang_am)} gelöscht.`,
    },
  };
}

/** Tippfehler in einer Zahlung: ein Schritt, eine Transaktion. */
export function buchungKorrigieren(
  s: Stand,
  input: { zahlungId: string; betrag: number; eingang_am: string; notiz?: string | null },
  ctx: Kontext,
): Ergebnis {
  const alt = s.zahlungen.find((x) => x.id === input.zahlungId);
  if (!alt || alt.art !== "zahlung") return { error: "Korrigieren lässt sich nur eine Zahlung." };
  if (!(cent(input.betrag) > 0)) return { error: "Bitte einen Betrag über 0 eingeben." };
  const ohne = s.zahlungen.filter((x) => x.id !== alt.id);
  if (ohne.reduce((n, x) => n + cent(x.betrag), cent(input.betrag)) < 0) {
    return { error: "Danach wäre mehr zurückgegangen als eingegangen." };
  }
  const e = buchen(
    { ...s, zahlungen: ohne },
    {
      art: "zahlung",
      betrag: input.betrag,
      eingang_am: input.eingang_am,
      zahlungsweg: alt.zahlungsweg,
      notiz: input.notiz ?? alt.notiz,
      trotzDoppelt: true,
    },
    ctx,
  );
  if (!("aenderung" in e)) return e;
  return {
    aenderung: {
      ...e.aenderung,
      zahlungenLoeschen: [alt.id],
      log: `Zahlung korrigiert: ${euro(alt.betrag)} am ${tag(alt.eingang_am)} → ${euro(input.betrag)} am ${tag(input.eingang_am)}.`,
    },
  };
}

/** Versehentlich gestundet: zurück auf das erste Datum, der Vermerk fällt weg. */
export function stundungZurueck(s: Stand, id: string): Ergebnis {
  const r = verteilt(s).raten.find((x) => x.id === id);
  const erstes = r?.urspruenglich_faellig_am;
  if (!r || r.erlass || !erstes || erstes === r.faellig_am) return { error: "Die Rate ist nicht gestundet." };
  if (cent(r.bezahlt) > 0) return { error: "Auf die gestundete Rate ist schon gezahlt." };
  if (zoegeVorBezahlte(s, id, erstes)) {
    return { error: "Eine spätere Rate ist schon bezahlt. Zurücknehmen nähme ihr die Zahlung weg." };
  }
  return {
    aenderung: {
      ratenAendern: [{ id, faellig_am: erstes, urspruenglich_faellig_am: null }],
      stundungLoeschen: [id],
      log: `Stundung zurückgenommen: ${euro(r.betrag)} wieder am ${tag(erstes)} fällig.`,
    },
  };
}

/** Wie oft verschoben, auch über Teilungen hinweg. */
export function anzahlVerschoben(
  id: string,
  raten: readonly { id: string; herkunft_rate_id?: string | null }[],
  vereinbarungen: readonly { rate_id: string | null; art: VereinbarungArt }[],
): number {
  const kette = new Set<string>();
  let an: string | null | undefined = id;
  while (an && !kette.has(an)) {
    kette.add(an);
    const aktuell: string = an;
    an = raten.find((r) => r.id === aktuell)?.herkunft_rate_id;
  }
  return vereinbarungen.filter((v) => v.art === "stundung" && !!v.rate_id && kette.has(v.rate_id)).length;
}

// ── Ende ───────────────────────────────────────────────────────────────────

export function kuendigung(
  s: Stand,
  input: { gekuendigt_am: string; wirksam_zum: string; grund?: string },
): Ergebnis {
  if (!istDatum(input.gekuendigt_am) || !istDatum(input.wirksam_zum)) return { error: "Bitte beide Daten angeben." };
  if (input.wirksam_zum < input.gekuendigt_am) return { error: "Die Kündigung kann nicht vor ihrem Eingang wirksam werden." };
  if (s.vertrag.gekuendigt_am) return { error: "Es ist schon eine Kündigung erfasst." };
  const ids = ratenFuerKuendigung(s.raten, input.wirksam_zum);
  const grund = input.grund?.trim() || null;
  return {
    aenderung: {
      ratenAendern: ids.map((id) => ({ id, erlass: "storniert", erlass_am: input.gekuendigt_am, erlass_grund: ERLASS_KUENDIGUNG })),
      vertrag: { gekuendigt_am: input.gekuendigt_am, kuendigung_wirksam_zum: input.wirksam_zum, kuendigung_grund: grund },
      status: { auf: "gekuendigt" },
      log: `Gekündigt zum ${tag(input.wirksam_zum)}, ${ids.length} Raten storniert${grund ? `: ${grund}` : ""}.`,
    },
  };
}

export function kuendigungZurueck(s: Stand): Ergebnis {
  if (!s.vertrag.gekuendigt_am) return { error: "Es ist keine Kündigung erfasst." };
  return {
    aenderung: {
      ratenAendern: s.raten
        .filter((r) => r.erlass === "storniert" && r.erlass_grund === ERLASS_KUENDIGUNG)
        .map((r) => ({ id: r.id, erlass: null, erlass_am: null, erlass_grund: null })),
      vertrag: { gekuendigt_am: null, kuendigung_wirksam_zum: null, kuendigung_grund: null },
      status: { auf: "aktiv", nurVon: "gekuendigt" },
      log: "Kündigung zurückgenommen.",
    },
  };
}

export function abbruch(s: Stand, input: { datum: string; grund?: string }, ctx: Kontext): Ergebnis {
  if (!istDatum(input.datum) || input.datum > ctx.heute) return { error: "Bitte ein Datum bis heute angeben." };
  if (s.vertrag.abgebrochen_am) return { error: "Es ist schon ein Abbruch erfasst." };
  const neu = { erlass: "abgeschrieben", erlass_am: input.datum, erlass_grund: ERLASS_ABBRUCH } as const;
  const a: Aenderung = { ratenAendern: [], ratenNeu: [], log: "" };
  const schritte = schritteFuerAbbruch(s.raten, s.zahlungen, ctx.heute);
  for (const x of schritte) {
    if (x.art === "abschreiben") {
      a.ratenAendern!.push({ id: x.id, ...neu });
    } else {
      a.ratenAendern!.push({ id: x.id, betrag: x.bezahlt });
      a.ratenNeu!.push({ id: ctx.neueId(), faellig_am: x.faellig_am, betrag: x.rest, herkunft_rate_id: x.id, ...neu });
    }
  }
  const grund = input.grund?.trim() || null;
  a.vertrag = { abgebrochen_am: input.datum, abbruch_grund: grund };
  a.status = { auf: "abgesprungen" };
  a.log = `Abbruch am ${tag(input.datum)}, ${schritte.length} Raten abgeschrieben${grund ? `: ${grund}` : ""}.`;
  return { aenderung: a };
}

export function abbruchZurueck(s: Stand): Ergebnis {
  if (!s.vertrag.abgebrochen_am) return { error: "Es ist kein Abbruch erfasst." };
  return {
    aenderung: {
      ratenAendern: s.raten
        .filter((r) => r.erlass === "abgeschrieben" && r.erlass_grund === ERLASS_ABBRUCH)
        .map((r) => ({ id: r.id, erlass: null, erlass_am: null, erlass_grund: null })),
      vertrag: { abgebrochen_am: null, abbruch_grund: null },
      status: { auf: "aktiv", nurVon: "abgesprungen" },
      log: "Abbruch zurückgenommen.",
    },
  };
}
