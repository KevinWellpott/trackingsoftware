// Lead-Recycling: reine Bibliothek (kein "use server"/"use client"), Muster
// src/lib/channels.ts — Typ und Beschriftung an EINER Stelle.
//
// Vier Ursprünge teilen sich dieselbe Idee: ein Lead, der terminal negativ
// endet (Closing verloren, Telefon-/Setting-Lead dead, LinkedIn-FU-Flow ohne
// Antwort zu Ende), bekommt statt eines stillen Endes ein Wiedervorlage-Datum.
// Der Mechanismus bleibt; die Staffelung ist mit dem Rückbau gefallen.
//
// Was hier NICHT mehr steht, und warum:
//
//  · Die KADENZ (`recycleIntervalDays()` / `computeNextRecycleAt()`) ist schon
//    mit Migration 0033 in die Datenbank gewandert — `schedule_recycle()` liest
//    Grund UND Status aus der Ursprungszeile, statt sich beides vom Client
//    sagen zu lassen (docs §4).
//  · Der ANLASS-Satz je Grund (`renderRecycleTemplate` samt seiner Hinweis-Map)
//    ist mit dem Rückbau gefallen. Er füllte `{anlass}` in einer Recycling-
//    Vorlage, und Vorlagen gibt es nicht mehr: /nachfassen zeigt den Namen und
//    den Grund, nicht einen vorformulierten Satz. Die Staffelung, aus der er
//    seinen Sinn zog („falscher Zeitpunkt" nach Wochen, „Vertrauen verloren"
//    erst nach Monaten), ist mit ihm gefallen — eine Frist gilt jetzt für alle.
//
// Geblieben ist, was weiterhin einen Verbraucher hat: der Ursprungs-Typ (vier
// Tabellen, drei Server-Actions und das Nachfassen-Board) und die Beschriftung
// des Grundes — sie liefert der Ablage die beiden Codes `dead` und
// `fu_exhausted`, die keine andere Grund-Familie kennt (`DROPOUT_REASON_LABELS`
// in src/lib/dropoutLists.ts).

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
