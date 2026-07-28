// Ausfüllbare Script-Blöcke für Setting- und Closing-Calls.
// Die Antworten landen als jsonb (setting_calls.script_answers / closing_calls.script_answers),
// key = block.key. Reine Datei (kein "use server"), client- und server-nutzbar.

export type ScriptBlock = {
  key: string;
  label: string;
  hint: string;
};

// Setting Skript v.3 (Agenturen) — Gesprächsverlauf, Reihenfolge wie im Skript.
export const SETTING_BLOCKS: ScriptBlock[] = [
  { key: "KONTEXT_IST", label: "Kontext / IST", hint: "Wie läuft die Zusammenarbeit mit Kunden ab? Was kostet am meisten Zeit? Wie viele Kunden? Wie lange bleibt ein Kunde?" },
  { key: "OUTCOME", label: "Outcome", hint: "Wo willst du hin? Welches Ergebnis in welchem Zeitraum — Umsatz, Kunden, Freizeit?" },
  // Der Ziel-Teil ist in "Outcome" gewandert; hier steht nur noch der Schmerz.
  { key: "PAIN", label: "Pain", hint: "Was hält dich davon ab? Was bleibt liegen? Was bedeutet das, wenn es so weiterläuft?" },
  { key: "ZEIT", label: "Zeit", hint: "Wie lange geht das schon so?" },
  { key: "GESCHEITERTE_VERSUCHE", label: "Gescheiterte Versuche", hint: "Was hast du versucht? Warum hat es nicht funktioniert?" },
];

/**
 * Gold Standards — die vier Qualifizierungsfragen, die über „Closing ja/nein"
 * entscheiden. Bewusst vom Gesprächsverlauf getrennt: sie sind kein
 * Erzählschritt, sondern eine Checkliste, und werden deshalb als eigener,
 * hervorgehobener Block abgefragt.
 */
export const SETTING_GOLD_BLOCKS: ScriptBlock[] = [
  { key: "GELD", label: "Geld", hint: "Mittlerer/oberer vierstelliger Bereich investierbar?" },
  { key: "ENTSCHEIDER", label: "Entscheider", hint: "Entscheidest du allein?" },
  { key: "START", label: "Start", hint: "Könntest du direkt starten?" },
  { key: "BEREITSCHAFT", label: "Bereitschaft", hint: "Bist du bereit, etwas zu verändern?" },
];

/** Alle Setting-Blöcke in Anzeigereihenfolge — für Fortschritt und Spiegel. */
export const ALL_SETTING_BLOCKS: ScriptBlock[] = [...SETTING_BLOCKS, ...SETTING_GOLD_BLOCKS];

/**
 * Keys, die frühere Skript-Versionen kannten und die es nicht mehr gibt.
 * Bestehende Antworten bleiben in `script_answers` erhalten und werden
 * read-only ausgewiesen, statt still zu verschwinden.
 */
export const LEGACY_SETTING_BLOCKS: ScriptBlock[] = [
  { key: "GAP", label: "Gap", hint: "Warum stehst du noch nicht da, wo du hinwillst?" },
  { key: "KONSEQUENZ", label: "Konsequenz", hint: "Was kostet es dich, wenn sich das 12 Monate nicht ändert?" },
];

// Closing Skript — die relevanten Erfassungspunkte.
export const CLOSING_BLOCKS: ScriptBlock[] = [
  { key: "IST", label: "Ist-Situation", hint: "Wo steht er aktuell?" },
  { key: "SOLL", label: "Soll-Situation", hint: "Wo will er hin?" },
  { key: "GAP", label: "Gap", hint: "Was fehlt zwischen Ist und Soll?" },
  { key: "KONSEQUENZ", label: "Konsequenz", hint: "Was passiert, wenn er nichts ändert?" },
  { key: "MOTIV", label: "Motiv hinter dem Ziel", hint: "Warum ist ihm das Ziel wirklich wichtig?" },
  { key: "PITCH_REAKTION", label: "Reaktion auf Pitch", hint: "Wie reagiert er auf Angebot / Cases / Ablauf?" },
  { key: "EINWAENDE", label: "Einwände", hint: "Welche Einwände kamen? Wie behandelt?" },
  { key: "NAECHSTE_SCHRITTE", label: "Nächste Schritte", hint: "Was ist vereinbart?" },
];
