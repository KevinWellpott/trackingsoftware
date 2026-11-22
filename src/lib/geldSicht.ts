// Was ein Dialog von einem Kunden braucht: den gesehenen Stand samt `version`.
// Reines Modul, damit Serverseiten und Client-Dialoge dieselbe Form teilen.

import type { KundenRate, KundenVertrag, KundenZahlung } from "@/lib/kunden";
import { kundenKennzahlen, type KundenKennzahlen } from "@/lib/umsatz";
import type { Stand } from "@/lib/umsatzPlanung";
import { nachAenderung, planeAktion, type GeldAktion } from "@/lib/geldAktion";

export type GeldSicht = {
  id: string;
  name: string;
  vertrag: KundenVertrag;
  raten: KundenRate[];
  zahlungen: KundenZahlung[];
};

export function geldSicht(g: {
  id: string;
  name: string;
  vertrag: KundenVertrag;
  rohRaten: KundenRate[];
  zahlungen: KundenZahlung[];
}): GeldSicht {
  return { id: g.id, name: g.name, vertrag: g.vertrag, raten: g.rohRaten, zahlungen: g.zahlungen };
}

export function standAus(g: GeldSicht): Stand {
  return { vertrag: g.vertrag, raten: g.raten, zahlungen: g.zahlungen };
}

export type Vorschau = { error: string } | { vorher: KundenKennzahlen; nachher: KundenKennzahlen };

/** Dieselbe Rechnung wie auf dem Server, nur ohne zu schreiben. */
export function vorschau(g: GeldSicht, aktion: GeldAktion, heute: string): Vorschau {
  let n = 0;
  const stand = standAus(g);
  const bestaetigt: GeldAktion = aktion.typ === "buchung" ? { ...aktion, trotzDoppelt: true } : aktion;
  const e = planeAktion(stand, bestaetigt, { heute, neueId: () => `vorschau-${++n}` });
  if ("error" in e) return { error: e.error };
  if ("doppelt" in e) return { error: e.doppelt };
  const neu = nachAenderung(stand, e.aenderung);
  return {
    vorher: kundenKennzahlen(stand.vertrag, stand.raten, stand.zahlungen, heute),
    nachher: kundenKennzahlen(neu.vertrag, neu.raten, neu.zahlungen, heute),
  };
}
