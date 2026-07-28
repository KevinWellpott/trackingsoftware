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

// Closing Skript v.2 — 1:1 aus "Closing_Skript.pdf".
// Die Nummerierung im UI kommt aus der Reihenfolge (Badge im ScriptRunner),
// die Labels tragen sie deshalb bewusst NICHT.
// Mehrzeilige Hinweise sind gewollt: der Block ist waehrend des Calls der
// Leitfaden, nicht nur eine Ueberschrift.
export const CLOSING_BLOCKS: ScriptBlock[] = [
  {
    key: "BEGRUESSUNG",
    label: "Begrüßung",
    hint: "„Hey [Name], freut mich, dass es geklappt hat.“\n→ Prospect einmal sympathisch zum Lächeln bringen.",
  },
  {
    key: "AGENDA",
    label: "Agenda",
    hint: "„Du hast bereits mit [Setter] gesprochen, ich hab hier ein paar Notizen vorliegen. Ich würde gerne direkt ins Meeting reinstarten und mir auch ein Bild von dir machen, okay?“",
  },
  {
    key: "TIME_FRAME",
    label: "Time Frame",
    hint: "„Der Call sollte nicht länger als 30–45 Minuten gehen. Aber angenommen, der Call geht jetzt 46 Minuten — gibt es irgendwas, wo du dann eilig hinmusst?“",
  },
  {
    key: "OUTCOME",
    label: "Grösstes Outcome / Goal",
    hint: "Ziel: Munition sammeln, aber noch nicht zu tief gehen. Wir wollen ein EMOTIONALES Outcome — „ich will frei leben“ reicht noch nicht.\n→ „Du bist in [Businessmodell], was sind so deine Ziele, die du damit verfolgst?“",
  },
  {
    key: "IST",
    label: "Ist-Situation",
    hint: "→ „Arbeitest du noch oder bist du voll selbstständig?“\n→ „Wie kommen zurzeit Kunden bei dir rein?“\n→ „Wie viele Kunden betreust du aktuell?“\n→ „Wie viel Umsatz und Gewinn machst du pro Kunde?“\n→ „Was fällt dir noch am schwersten im Thema Kundengewinnung?“\n\nZusammenfassung IST festhalten.",
  },
  {
    key: "LOGICAL_ESCAPE",
    label: "Logical Escape",
    hint: "Ziel: Der Prospect sagt verbindlich, was er will — dann fühlt sich das Graben nach dem Pain für ihn natürlicher an.\n\nNur wenn er 9–5 arbeitet:\n→ „Ist dein Ziel mit [Businessmodell], deinen 9–5 zu kündigen, oder siehst du das eher als Sidehustle?“\n\nWenn nicht 9–5:\n→ „Ist dein Ziel mit [Businessmodell] also sehr viel Geld zu verdienen, um [Outcome] zu erreichen?“\n\nZusammenfassung Logical Escape festhalten.",
  },
  {
    key: "PAIN",
    label: "Stärkster Pain",
    hint: "Ziel: Herausfinden, WARUM er seine jetzige Situation verlassen will. Dieses Warum muss GROSS sein — „ich will 10k, weil ich gerne reise“ reicht nicht. Der Part darf ruhig dauern, hier wird gegraben.\n→ „Okay, und was ist der größte Grund, warum du [9–5 / Current Situation] verlassen willst?“\n\nZusammenfassung Stärkster Pain festhalten.",
  },
  {
    key: "TIME_GAP",
    label: "Time Gap",
    hint: "Ziel: Je mehr Zeit seit dem Pain vergangen ist, desto größer ist er.\n→ „Und wie lange fühlst du dich schon [Antwort aus der Pain-Frage]?“\n\nZusammenfassung Time Gap festhalten.",
  },
  {
    key: "VOREINWAND",
    label: "Voreinwandbehandlung",
    hint: "Ziel: Einwände und falsche Glaubenssätze vor dem Pitch behandeln — die Gesprächsdynamik davor ist eine ganz andere. Hier sehr tief reingehen.\n\nSetup Question:\n→ „Hast du dir schonmal Hilfe geholt, um [Pain] zu lösen oder an [Outcome] zu kommen?“ — bei Ja alles darüber wissen wollen, bis der Limiting Belief steht.\n\nGet Leverage:\n→ „Was hat sich an deinem Denken verändert, dass wir trotzdem heute diesen Call haben, damit du [Current Situation] verlassen kannst?“\n\nSeparate Belief from them:\n→ „Merkst du, wie [Limiting Belief] dich in die jetzige Situation gebracht hat, aus der du eigentlich raus willst?“\n\nLoss Aversion:\n→ „Und was hast du alles verloren aufgrund deines [Limiting Belief]?“\n\nCost of Inaction:\n→ „Was würde passieren, wenn wir deinem [Limiting Belief] weiter erlauben, so zu denken, damit du nicht in dein Skillset und deine Zukunft investierst?“\n\nCommitment:\n→ „Meine Frage ist nicht, ob du [Outcome] erreichen willst — das will jeder. Meine Frage ist, ob du das Commitment hast, nicht auf deinen [Limiting Belief] zu hören und zu deinen Zielen durchzupushen?“\n\nAb hier ist die Tür zu.",
  },
  {
    key: "HEAVEN_HELL",
    label: "Heaven & Hell",
    hint: "Ziel: In die Wunde des Limiting Belief drücken und zeigen, wie sein Leben aussieht, wenn er durchzieht — und wenn er bleibt. Erzeugt die Dringlichkeit.\n\nFuture Pacing Tangible:\n→ „Angenommen, wir brechen [Limiting Belief], holen dir die passenden Skills und fangen an, mit dir [Outcome] konsistent zu machen — was würde sich dann konkret für dich verändern?“\n\nFuture Pacing Emotional:\n→ „Und wenn du [Tangible Outcomes] erreichst — wie würdest du dich damit fühlen?“\n\nTransition:\n→ „Wir wissen beide, dass es möglich ist. Denkst du aber, dass du in die Umsetzung kommen solltest?“\n\nKonsequenz Tangible:\n→ „Was würde passieren, wenn wir nie etwas ändern und du genau so bleibst, wie du jetzt bist?“\n\nKonsequenz Emotional:\n→ „Und wenn wir in 2 Monaten oder 2 Jahren zurückschauen und du stehst noch da, wo du jetzt stehst — obwohl wir wussten, dass wir [Limiting Belief] hätten brechen können — wie würde sich das anfühlen?“\n\nResponsibility:\n→ „Was denkst du, musst du jetzt machen, um [Outcome] zu erreichen?“\n\nPreframe Decision:\n→ „Und wenn dein [Limiting Belief] nochmal auftaucht — hab ich dann deine Erlaubnis, dich accountable zu halten?“",
  },
  {
    key: "PITCH",
    label: "Pitch",
    hint: "Ziel: 1. Kaufmotive verstehen. 2. Den Pitch maßschneidern, damit er sich persönlich angesprochen fühlt.\n\nBuying Values:\n→ „Was denkst du, wird dir jetzt am meisten weiterhelfen bei einer Zusammenarbeit?“\n→ „Warum ist dir [Kaufmotiv] am wichtigsten?“\n\nFoundation: Offerstrategie · Funnelstrategie · Leadgen-Strategie (Content oder Outbound) · Closingstrategie · Trackingsoftware oder LMS\n\nCoaching: 24/7 WhatsApp-Support · mind. 1 Call pro Woche · Sales-Call-Analyse gemeinsam · Accountability über die KPIs\n\nUSP: pro Situation anpassen ODER die Garantie, dass er nach der Zusammenarbeit selbst versteht, warum sein Business läuft — weil alles getrackt und gemeinsam ausgewertet wird.\n\nTipp: Zeig etwas visuell, z. B. den Pitch-Tracker, während du über den USP sprichst.",
  },
  {
    key: "EINWAENDE",
    label: "Einwandbehandlung",
    hint: "Welche Einwände kamen nach dem Pitch — und wie wurden sie behandelt?",
  },
];

/**
 * Closing-Keys aus der Vorversion des Skripts. Bestehende Antworten bleiben
 * in `script_answers` erhalten und werden read-only ausgewiesen, statt still
 * zu verschwinden. `IST` und `EINWAENDE` gibt es weiterhin — deren Antworten
 * wandern automatisch in die neuen Bloecke.
 */
export const LEGACY_CLOSING_BLOCKS: ScriptBlock[] = [
  { key: "SOLL", label: "Soll-Situation", hint: "Wo will er hin?" },
  { key: "GAP", label: "Gap", hint: "Was fehlt zwischen Ist und Soll?" },
  { key: "KONSEQUENZ", label: "Konsequenz", hint: "Was passiert, wenn er nichts ändert?" },
  { key: "MOTIV", label: "Motiv hinter dem Ziel", hint: "Warum ist ihm das Ziel wirklich wichtig?" },
  { key: "PITCH_REAKTION", label: "Reaktion auf Pitch", hint: "Wie reagiert er auf Angebot / Cases / Ablauf?" },
  { key: "NAECHSTE_SCHRITTE", label: "Nächste Schritte", hint: "Was ist vereinbart?" },
];
