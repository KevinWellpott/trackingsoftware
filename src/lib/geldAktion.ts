// Die EINE Tür für Geldaktionen: aus einer Absicht („stunde Rate X auf den
// 30.") wird eine Änderung. Server Action und Dialog-Vorschau rufen dieselbe
// Funktion, damit die Vorschau nie etwas anderes verspricht, als gebucht wird.

import { cent, erzeugeRatenplan, eur, parseEuro, type Erlass, type ZahlungsArt } from "@/lib/umsatz";
import * as P from "@/lib/umsatzPlanung";
import type { Aenderung, Ergebnis, Kontext, Stand } from "@/lib/umsatzPlanung";

/** Beträge kommen, wie ein Mensch sie tippt („1.633,33"). */
type Betrag = string | number;

export type PlanEingabe = {
  gesamt: Betrag;
  anzahlung?: Betrag;
  anzahlungDatum?: string;
  anzahl: number;
  erstesDatum: string;
  rhythmusMonate: number;
};

export type GeldAktion =
  | { typ: "plan"; modus: "ersetzen" | "ergaenzen"; plan: PlanEingabe; bezahltBis?: number; teilbetrag?: Betrag }
  | { typ: "rate_neu"; faellig_am: string; betrag: Betrag; notiz?: string }
  | { typ: "rate_korrigieren"; rateId: string; faellig_am: string; betrag: Betrag; notiz?: string }
  | { typ: "rate_loeschen"; rateId: string }
  | { typ: "stunden"; rateId: string; auf: string; grund: string; betrag?: Betrag }
  | { typ: "folgeraten"; rateId: string; grund: string; betrag?: Betrag }
  | { typ: "pause"; monate: number; grund: string }
  | { typ: "zusage"; rateId: string; auf: string; grund?: string; betrag?: Betrag }
  | { typ: "erlass"; rateId: string; erlass: Erlass; grund?: string }
  | { typ: "reaktivieren"; rateId: string }
  | {
      typ: "buchung";
      art: ZahlungsArt;
      betrag: Betrag;
      eingang_am: string;
      zahlungsweg?: string;
      notiz?: string;
      trotzDoppelt?: boolean;
    }
  | { typ: "buchung_loeschen"; zahlungId: string }
  | { typ: "buchung_korrigieren"; zahlungId: string; betrag: Betrag; eingang_am: string; notiz?: string }
  | { typ: "stundung_zurueck"; rateId: string }
  | {
      typ: "vertrag";
      vertragswert: Betrag;
      vertragsstart: string | null;
      laufzeit_monate: number | null;
      zahlungsart: "einmal" | "raten";
      notiz: string;
    }
  | { typ: "kuendigung"; gekuendigt_am: string; wirksam_zum: string; grund?: string }
  | { typ: "kuendigung_zurueck" }
  | { typ: "abbruch"; datum: string; grund?: string }
  | { typ: "abbruch_zurueck" };

/** Leer heißt „nicht angegeben", Unlesbares ist NaN und fällt in der Prüfung durch. */
function optional(v: Betrag | undefined): number | undefined {
  if (v === undefined || v === "") return undefined;
  return parseEuro(v) ?? Number.NaN;
}
const pflicht = (v: Betrag): number => parseEuro(v) ?? Number.NaN;

/** Die Raten aus der Formulareingabe, für Vorschau und Server. */
export function planRaten(p: PlanEingabe): { faellig_am: string; betrag: number }[] | { error: string } {
  const gesamt = pflicht(p.gesamt);
  const anzahlung = optional(p.anzahlung) ?? 0;
  if (!(gesamt > 0)) return { error: "Bitte den zu verteilenden Betrag angeben." };
  if (!(anzahlung >= 0) || cent(anzahlung) > cent(gesamt)) return { error: "Ungültige Anzahlung." };
  if (!P.istDatum(p.erstesDatum)) return { error: "Bitte das Datum der ersten Rate angeben." };
  if (p.anzahlungDatum && !P.istDatum(p.anzahlungDatum)) return { error: "Ungültiges Datum der Anzahlung." };
  if (!Number.isInteger(p.anzahl) || p.anzahl < 0 || p.anzahl > 120) return { error: "Anzahl der Raten zwischen 1 und 120." };
  if (![1, 2, 3, 6, 12].includes(p.rhythmusMonate)) return { error: "Unbekannter Rhythmus." };
  const rest = eur(cent(gesamt) - cent(anzahlung));
  if (rest > 0 && p.anzahl === 0) return { error: "Für den Rest braucht es mindestens eine Rate." };
  return erzeugeRatenplan({
    gesamt: rest,
    anzahl: p.anzahl,
    erstesDatum: p.erstesDatum,
    rhythmusMonate: p.rhythmusMonate,
    anzahlung,
    anzahlungDatum: p.anzahlungDatum,
  });
}

export function planeAktion(s: Stand, a: GeldAktion, ctx: Kontext): Ergebnis {
  switch (a.typ) {
    case "plan": {
      const raten = planRaten(a.plan);
      if ("error" in raten) return raten;
      return P.planAnlegen(s, { modus: a.modus, raten, bezahltBis: a.bezahltBis, teilbetrag: optional(a.teilbetrag) }, ctx);
    }
    case "rate_neu": {
      const betrag = pflicht(a.betrag);
      if (!(cent(betrag) > 0)) return { error: "Bitte einen Betrag über 0 eingeben." };
      if (!P.istDatum(a.faellig_am)) return { error: "Bitte ein gültiges Datum angeben." };
      return {
        aenderung: {
          ratenNeu: [{ id: ctx.neueId(), faellig_am: a.faellig_am, betrag, erlass: null, notiz: a.notiz?.trim() || null }],
          log: `Rate über ${betrag.toLocaleString("de-DE")} € zum ${a.faellig_am.split("-").reverse().join(".")} ergänzt.`,
        },
      };
    }
    case "rate_korrigieren":
      return P.rateKorrigieren(s, { rateId: a.rateId, faellig_am: a.faellig_am, betrag: pflicht(a.betrag), notiz: a.notiz });
    case "rate_loeschen":
      return P.rateLoeschen(s, a.rateId);
    case "stunden":
      return P.verschieben(s, { rateId: a.rateId, auf: a.auf, grund: a.grund, betrag: optional(a.betrag) }, ctx);
    case "folgeraten":
      return P.aufFolgeraten(s, { rateId: a.rateId, grund: a.grund, betrag: optional(a.betrag) }, ctx);
    case "pause":
      return P.pausieren(s, { monate: a.monate, grund: a.grund }, ctx);
    case "zusage":
      return P.zusagen(s, { rateId: a.rateId, auf: a.auf, grund: a.grund, betrag: optional(a.betrag) }, ctx);
    case "erlass":
      return P.erlassen(s, { rateId: a.rateId, erlass: a.erlass, grund: a.grund }, ctx);
    case "reaktivieren":
      return P.reaktivieren(s, a.rateId);
    case "buchung":
      return P.buchen(
        s,
        {
          art: a.art,
          betrag: pflicht(a.betrag),
          eingang_am: a.eingang_am,
          zahlungsweg: a.zahlungsweg,
          notiz: a.notiz,
          trotzDoppelt: a.trotzDoppelt === true,
        },
        ctx,
      );
    case "buchung_loeschen":
      return P.buchungLoeschen(s, a.zahlungId);
    case "buchung_korrigieren":
      return P.buchungKorrigieren(
        s,
        { zahlungId: a.zahlungId, betrag: pflicht(a.betrag), eingang_am: a.eingang_am, notiz: a.notiz },
        ctx,
      );
    case "stundung_zurueck":
      return P.stundungZurueck(s, a.rateId);
    case "vertrag": {
      const wert = pflicht(a.vertragswert);
      if (!(wert >= 0)) return { error: "Bitte einen gültigen Vertragswert eingeben." };
      if (a.vertragsstart && !P.istDatum(a.vertragsstart)) return { error: "Ungültiges Startdatum." };
      const monate = a.laufzeit_monate;
      if (monate !== null && (!Number.isInteger(monate) || monate < 1 || monate > 120)) {
        return { error: "Laufzeit zwischen 1 und 120 Monaten." };
      }
      const alt = s.vertrag.vertragswert;
      return {
        aenderung: {
          vertrag: {
            vertragswert: wert,
            vertragsstart: a.vertragsstart || null,
            laufzeit_monate: monate,
            zahlungsart: a.zahlungsart === "einmal" ? "einmal" : "raten",
            notiz: a.notiz?.trim() || null,
          },
          log:
            cent(alt) === cent(wert)
              ? "Vertragsdaten geändert."
              : `Vertragswert ${alt.toLocaleString("de-DE")} € → ${wert.toLocaleString("de-DE")} €.`,
        },
      };
    }
    case "kuendigung":
      return P.kuendigung(s, { gekuendigt_am: a.gekuendigt_am, wirksam_zum: a.wirksam_zum, grund: a.grund });
    case "kuendigung_zurueck":
      return P.kuendigungZurueck(s);
    case "abbruch":
      return P.abbruch(s, { datum: a.datum, grund: a.grund }, ctx);
    case "abbruch_zurueck":
      return P.abbruchZurueck(s);
    default:
      return { error: "Unbekannte Aktion." };
  }
}

/** Was nach der Änderung dastünde. Nur für die Vorschau, geschrieben wird in der Datenbank. */
export function nachAenderung(s: Stand, a: Aenderung): Stand {
  const raten = s.raten
    .map((r) => ({ ...r, ...(a.ratenAendern?.find((u) => u.id === r.id) ?? {}) }))
    .filter((r) => !a.ratenLoeschen?.includes(r.id));
  return {
    vertrag: { ...s.vertrag, ...(a.vertrag ?? {}) },
    raten: [...raten, ...(a.ratenNeu ?? [])],
    zahlungen: [...s.zahlungen, ...(a.zahlungenNeu ?? [])].filter((z) => !a.zahlungenLoeschen?.includes(z.id)),
  };
}
