// Lead-Recycling: reine Bibliothek (kein "use server"/"use client"), Muster
// reminderCascade.ts — Typen und Vorlagen-Logik an EINER Stelle.
//
// Vier Ursprünge teilen sich dieselbe Idee: ein Lead, der terminal negativ
// endet (Closing verloren, Telefon-/Setting-Lead dead, LinkedIn-FU-Flow ohne
// Antwort zu Ende), bekommt statt eines stillen Endes ein Wiedervorlage-Datum
// — mit einer Wartezeit, die vom GRUND abhängt, nicht von einem globalen
// Timer (Recherche: "falscher Zeitpunkt" lohnt sich nach Wochen erneut,
// "Vertrauen verloren" erst nach Monaten, "falsche Zielgruppe" nie).
//
// Die KADENZ steht nicht mehr hier. `recycleIntervalDays()` /
// `computeNextRecycleAt()` und ihr Settings-Objekt sind mit Migration 0033 in
// die Datenbank gewandert — `schedule_recycle()` liest Grund UND Status aus der
// Ursprungszeile, statt sich beides vom Client sagen zu lassen (docs §4, und
// die Begründung in src/app/actions/recycle.ts). Ihre Feldnamen passten
// zusätzlich längst nicht mehr zu `pipeline_settings`. Geblieben ist, was
// weiterhin im Browser gebraucht wird: die Beschriftung des Grundes und der
// daraus abgeleitete Aufhänger für die Nachricht.

export type RecycleOrigin = "linkedin" | "telefon" | "setting" | "closing";

/** Anzeige-Label je Grund — für den Badge in der Karte. */
export const RECYCLE_REASON_LABELS: Record<string, string> = {
  timing: "Timing",
  preis: "Preis",
  kein_bedarf: "Kein Bedarf",
  entscheider: "Entscheider",
  wettbewerb: "Wettbewerb",
  vertrauen: "Vertrauen",
  ghosting: "Ghosting",
  falsche_zielgruppe: "Falsche Zielgruppe",
  kein_fit: "Kein Fit",
  sonstiges: "Sonstiges",
  dead: "Dead",
  fu_exhausted: "Ohne Antwort",
};

/**
 * Kurzer, GRUND-spezifischer Anlass für {anlass} in der Vorlage — macht aus
 * "melde mich nochmal" einen konkreten Aufhänger statt einer Floskel. Leer
 * für Gründe ohne plausiblen Anlass (Vertrauen, Ghosting, Sonstiges,
 * dead/fu_exhausted) — dort ersetzt renderRecycleTemplate durch einen
 * neutralen Platzhaltersatz.
 */
const RECYCLE_REASON_HINTS: Record<string, string> = {
  timing: "vielleicht passt der Zeitpunkt inzwischen besser",
  preis: "falls sich beim Budget etwas getan hat",
  kein_bedarf: "falls sich der Bedarf inzwischen geändert hat",
  entscheider: "vielleicht sitzt inzwischen jemand anders am Drücker",
  wettbewerb: "falls die aktuelle Lösung nicht mehr überzeugt",
};

const RECYCLE_REASON_FALLBACK_HINT = "es gibt vielleicht Neues zu besprechen";

function firstName(name: string | null): string {
  return (name ?? "").trim().split(/\s+/)[0] || "";
}

/** Platzhalter füllen: {vorname}, {firma}, {anlass}. */
export function renderRecycleTemplate(
  template: string,
  ctx: { leadName: string | null; company: string | null; reason: string | null },
): string {
  const anlass = (ctx.reason && RECYCLE_REASON_HINTS[ctx.reason]) || RECYCLE_REASON_FALLBACK_HINT;
  return template
    .replaceAll("{vorname}", firstName(ctx.leadName) || "dir")
    .replaceAll("{firma}", ctx.company?.trim() || "")
    .replaceAll("{anlass}", anlass);
}
