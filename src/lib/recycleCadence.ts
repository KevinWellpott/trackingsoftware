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
 * Die Aufhänger stehen als benannte Konstanten da, weil ZWEI Grund-Familien in
 * derselben Spalte landen: `schedule_recycle()` stempelt bei einem verlorenen
 * Closing den VERLUST-Code (`lost_reason_code`) und bei einem Erstgespräch den
 * DISQUALIFIKATIONS-Code (`disqualify_reason_code`) in `recycle_reason_code`
 * (docs §4). „Falscher Zeitpunkt" und „Timing" meinen dasselbe und müssen
 * deshalb denselben Satz erzeugen — zwei getippte Zwillinge liefen beim
 * nächsten Textfeinschliff auseinander.
 */
const HINT_TIMING = "vielleicht passt der Zeitpunkt inzwischen besser";
const HINT_BUDGET = "falls sich beim Budget etwas getan hat";
const HINT_BEDARF = "falls sich der Bedarf inzwischen geändert hat";
const HINT_ENTSCHEIDER = "vielleicht sitzt inzwischen jemand anders am Drücker";
const HINT_WETTBEWERB = "falls die aktuelle Lösung nicht mehr überzeugt";

/**
 * Kurzer, GRUND-spezifischer Anlass für {anlass} in der Vorlage — macht aus
 * "melde mich nochmal" einen konkreten Aufhänger statt einer Floskel. Ohne
 * Eintrag setzt renderRecycleTemplate einen neutralen Platzhaltersatz.
 *
 * WARUM die Disqualifikationsgründe hier stehen müssen: Das Konzept verlangt
 * beim Erstgespräch ausdrücklich „Nachfassen mit dem Grund der damaligen
 * Disqualifikation". Von den acht Codes kannte diese Map lange nur
 * `kein_bedarf` — ein Lead, der wegen `falscher_zeitpunkt` disqualifiziert
 * wurde, bekam nach 56 Tagen die Floskel „es gibt vielleicht Neues zu
 * besprechen", obwohl der passende Satz eine Zeile darüber unter `timing`
 * stand. Ausgerechnet die Gründe, bei denen ein zweiter Anlauf am meisten Sinn
 * ergibt (Zeitpunkt, Budget, Entscheider), waren die stummen.
 *
 * Ohne Aufhänger bleiben bewusst:
 *  · `vertrauen`, `ghosting`, `sonstiges`, `dead`, `fu_exhausted` — für sie
 *    gibt es keinen ehrlichen Aufhänger; ein erfundener wäre schlimmer als der
 *    neutrale Satz.
 *  · `falsche_zielgruppe` und `keine_zusammenarbeit` (Erstgespräch) sowie
 *    `falsche_zielgruppe` und `kein_fit` (Closing) — diese vier bekommen nie
 *    ein Recycling-Datum (docs §4), es kann also gar keine Karte für sie geben.
 */
const RECYCLE_REASON_HINTS: Record<string, string> = {
  // ── Verlustgründe eines Closings (closing_calls.lost_reason_code) ──
  timing: HINT_TIMING,
  preis: HINT_BUDGET,
  kein_bedarf: HINT_BEDARF,
  entscheider: HINT_ENTSCHEIDER,
  wettbewerb: HINT_WETTBEWERB,
  // ── Disqualifikationsgründe eines Erstgesprächs
  //    (setting_calls.disqualify_reason_code). `kein_bedarf` trägt in beiden
  //    Familien denselben Schlüssel und steht deshalb schon oben. ──
  falscher_zeitpunkt: HINT_TIMING,
  geld: HINT_BUDGET,
  kein_budget: HINT_BUDGET,
  kein_entscheider: HINT_ENTSCHEIDER,
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
