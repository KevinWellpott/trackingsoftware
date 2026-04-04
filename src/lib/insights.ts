import type { ContactWithStage, PitchList } from "./types";

export type InsightLevel = "success" | "warning" | "danger" | "tip";

export type Insight = {
  level: InsightLevel;
  title: string;
  body: string;
  action?: string;
  listId?: string;
};

function pct(n: number, total: number) {
  if (total === 0) return 0;
  return Math.round((n / total) * 100);
}

export function generateInsights(
  lists: PitchList[],
  contacts: ContactWithStage[],
): Insight[] {
  const insights: Insight[] = [];

  // ── 1. Gesamtüberblick ─────────────────────────────────────
  const total = contacts.length;
  const answered = contacts.filter((c) => c.answered === true).length;
  const appts = contacts.filter((c) => c.appointment_set === true).length;
  const openFUs = contacts.filter(
    (c) => c.answered !== true && c.next_follow_up_at && c.follow_up_number !== 3,
  ).length;

  if (total === 0) {
    insights.push({ level: "tip", title: "Starte jetzt!", body: "Lege deine erste Liste an und trage deinen ersten Pitch ein." });
    return insights;
  }

  const answerRate = pct(answered, total);
  const apptRate = pct(appts, total);

  if (answerRate >= 20) {
    insights.push({ level: "success", title: `Starke Antwortrate: ${answerRate}%`, body: "Dein Pitch trifft den Nerv. Skaliere weiter auf diesen Ansatz." });
  } else if (answerRate < 8 && total >= 20) {
    insights.push({ level: "danger", title: `Antwortrate zu niedrig: ${answerRate}%`, body: "Unter 8% ist ein klares Signal — der Pitch-Text oder die Zielgruppe muss überarbeitet werden. Teste eine andere Hook-Zeile.", action: "Schlechte Listen analysieren" });
  }

  if (apptRate >= 5 && answered > 0) {
    insights.push({ level: "success", title: `Gute Terminquote: ${apptRate}%`, body: `${appts} von ${answered} Antworten führten zu einem Gespräch.` });
  }

  if (openFUs > 10) {
    insights.push({ level: "warning", title: `${openFUs} offene Follow-ups`, body: "Offene Follow-ups liegen Geld auf dem Tisch. Jeden Tag ohne FU kostet Conversion.", action: "Follow-ups abarbeiten" });
  }

  // ── 2. Pro Liste analysieren ──────────────────────────────
  const listStats = lists.map((l) => {
    const lContacts = contacts.filter((c) => c.list_id === l.id);
    const lTotal = lContacts.length;
    const lAnswered = lContacts.filter((c) => c.answered === true).length;
    const lAppts = lContacts.filter((c) => c.appointment_set === true).length;
    return {
      list: l,
      total: lTotal,
      answerRate: pct(lAnswered, lTotal),
      apptRate: pct(lAppts, lTotal),
      answered: lAnswered,
      appts: lAppts,
    };
  });

  // Beste Liste
  const best = listStats
    .filter((s) => s.total >= 10)
    .sort((a, b) => b.apptRate - a.apptRate)[0];
  if (best && best.apptRate > 0) {
    insights.push({
      level: "success",
      title: `"${best.list.name}" ist dein bester Pitch`,
      body: `${best.apptRate}% Terminrate, ${best.answerRate}% Antwortrate. Skaliere genau diesen Pitch.`,
      listId: best.list.id,
    });
  }

  // Schlechteste Liste (mit genug Daten)
  const worst = listStats
    .filter((s) => s.total >= 15 && s.answerRate < 5)
    .sort((a, b) => a.answerRate - b.answerRate)[0];
  if (worst) {
    insights.push({
      level: "danger",
      title: `"${worst.list.name}" performt schwach (${worst.answerRate}% Antworten)`,
      body: `Bei ${worst.total} Pitches und nur ${worst.answered} Antworten: entweder Zielgruppe oder Pitch-Text ändern. Vergleiche mit der besten Liste.`,
      listId: worst.list.id,
      action: "Pitch-Text überarbeiten",
    });
  }

  // Liste mit Antworten aber keinen Terminen
  const highAnswerLowAppt = listStats.find(
    (s) => s.total >= 10 && s.answerRate >= 15 && s.apptRate === 0,
  );
  if (highAnswerLowAppt) {
    insights.push({
      level: "warning",
      title: `"${highAnswerLowAppt.list.name}": Antworten ohne Termine`,
      body: `${highAnswerLowAppt.answerRate}% antworten, aber 0 Termine. Das Follow-up-Gespräch (die "Bridge" Nachricht) muss optimiert werden.`,
      listId: highAnswerLowAppt.list.id,
      action: "Follow-up-Nachricht überarbeiten",
    });
  }

  // Zu große Liste (zu viele Kontakte, sinkende Rate)
  const bigLowPerf = listStats.find(
    (s) => s.total >= 50 && s.answerRate < 10,
  );
  if (bigLowPerf) {
    insights.push({
      level: "warning",
      title: `"${bigLowPerf.list.name}" ist zu groß für die Performance`,
      body: `${bigLowPerf.total} Pitches, nur ${bigLowPerf.answerRate}% Antworten. Erstelle eine neue, fokussiertere Liste mit überarbeitetem Pitch.`,
      listId: bigLowPerf.list.id,
    });
  }

  // ── 3. Follow-up Verhalten ────────────────────────────────
  const pitchedNoFU = contacts.filter(
    (c) =>
      c.pitched_at &&
      c.answered !== true &&
      c.follow_up_number === null,
  ).length;
  if (pitchedNoFU > 5) {
    insights.push({
      level: "tip",
      title: `${pitchedNoFU} Kontakte ohne Follow-up`,
      body: "Diese Kontakte haben noch kein FU bekommen. Ein FU1 erhöht die Antwortrate um bis zu 30%.",
      action: "Follow-ups eintragen",
    });
  }

  // Nur FU1, kein FU2
  const stuckAtFU1 = contacts.filter(
    (c) => c.follow_up_number === 1 && c.answered !== true,
  ).length;
  if (stuckAtFU1 > 5) {
    insights.push({
      level: "tip",
      title: `${stuckAtFU1} Kontakte warten auf FU2`,
      body: "FU2 nach 5 Tagen ist oft der entscheidende Touchpoint. Nicht liegen lassen.",
    });
  }

  // ── 4. Tipp: Pitch-Text fehlt ─────────────────────────────
  const listsWithoutText = lists.filter((l) => !l.pitch_text).length;
  if (listsWithoutText > 0) {
    insights.push({
      level: "tip",
      title: `${listsWithoutText} Listen ohne Pitch-Text`,
      body: "Ohne den Pitch-Text im System kannst du keine A/B-Vergleiche ziehen. Trage ihn nach.",
    });
  }

  return insights.slice(0, 8); // Max 8 Insights gleichzeitig
}
