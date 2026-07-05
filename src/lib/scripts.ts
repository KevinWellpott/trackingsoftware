// Ausfüllbare Script-Blöcke für Setting- und Closing-Calls.
// Die Antworten landen als jsonb (setting_calls.script_answers / closing_calls.script_answers),
// key = block.key. Reine Datei (kein "use server"), client- und server-nutzbar.

export type ScriptBlock = {
  key: string;
  label: string;
  hint: string;
};

// Setting Skript v.2 (Agenturen) — Reihenfolge wie im Skript.
export const SETTING_BLOCKS: ScriptBlock[] = [
  { key: "OUTCOME", label: "Outcome", hint: "Warum sitzen wir heute hier? Was erhoffst du dir vom Meeting?" },
  { key: "KONTEXT_IST", label: "Kontext / IST", hint: "Wie läuft die Zusammenarbeit mit Kunden ab? Was kostet am meisten Zeit? Wie viele Kunden? Wie lange bleibt ein Kunde?" },
  { key: "PAIN", label: "Pain", hint: "Wo stehst du vs. wo willst du hin (Umsatz & Zeit)? Was bleibt liegen? Was bedeutet das, wenn es so weiterläuft?" },
  { key: "ZEIT", label: "Zeit", hint: "Wie lange geht das schon so? (Pain verstärken)" },
  { key: "GESCHEITERTE_VERSUCHE", label: "Gescheiterte Versuche", hint: "Was hast du versucht? Warum hat es nicht funktioniert?" },
  { key: "GAP", label: "Gap", hint: "Warum stehst du noch nicht da, wo du hinwillst? (Ideal-Antwort: mir fehlt das System)" },
  { key: "KONSEQUENZ", label: "Konsequenz", hint: "Was kostet es dich, wenn sich das 12 Monate nicht ändert?" },
  { key: "BEREITSCHAFT", label: "Bereitschaft", hint: "Bist du bereit, etwas zu verändern?" },
  { key: "ENTSCHEIDER", label: "Entscheider", hint: "Entscheidest du allein? (falls nein → muss zum nächsten Call dazu)" },
  { key: "GELD", label: "Geld", hint: "Mittlerer/oberer vierstelliger Bereich investierbar? (Agenturen: mittlerer · Coaches: oberer)" },
  { key: "START", label: "Start", hint: "Könntest du direkt starten?" },
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
