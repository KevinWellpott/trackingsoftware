// Jede Anwahl zählt — auch Rückrufe und Folgeanrufe.
//
// WARUM ES DIESE DATEI GIBT: Das Wochenziel „Telefon Woche" auf `/`, die
// Telefon-Übersicht und der Team-Vergleich zählten `rpc_phone_day_metrics.calls`
// — ERSTKONTAKTE, also jede Firma genau einmal (docs §1). Wer einen Tag lang
// seine Rückrufliste abtelefonierte, stand am Abend bei 0, obwohl jede dieser
// Anwahlen im Anruf-Log stand. Gezählt wird seither das Log. Fällt eine der
// drei Stellen auf die RPC zurück, sieht das niemand — die Zahl wäre nur
// still zu klein.
//
// Geprüft wird zum einen die Zuordnungsregel (rein, testbar), zum anderen am
// Quelltext, dass die drei Zähler das Log lesen.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { dialOwnerKey, type DialRow } from "@/lib/phoneAttemptsData";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const row = (owner_name: string | null, created_by_user_id: string | null): DialRow => ({
  owner_name,
  created_by_user_id,
  called_at: "2026-10-19T08:00:00Z",
  day: "2026-10-19",
});

describe("1 · Wem eine Anwahl zählt", () => {
  const users = new Map([["u-kevin", "Kevin"]]);

  test("dem Listen-Owner des Anrufzeitpunkts — auch wenn ein anderer gewählt hat", () => {
    assert.equal(dialOwnerKey(row("Samuel", "u-kevin"), users), "samuel");
  });

  test("ohne Owner dem, der gewählt hat", () => {
    assert.equal(dialOwnerKey(row(null, "u-kevin"), users), "kevin");
  });

  test("nicht auflösbar bleibt null statt geraten", () => {
    assert.equal(dialOwnerKey(row(null, "u-weg"), users), null);
    assert.equal(dialOwnerKey(row("  ", null), users), null);
  });
});

describe("2 · Die drei Zähler lesen das Anruf-Log", () => {
  test("Dashboard: Wochenziel und Telefon-Karte zählen Anwahlen", () => {
    const src = read("src/app/(dashboard)/page.tsx");
    assert.match(src, /loadDialRows\(/);
    // Seit dem 28.11. baugleich zur LinkedIn-Karte: Ziel Heute und Woche.
    assert.match(src, /label="Diese Woche" current=\{weekDials\} goal=\{phoneWeeklyGoal\} unit="Anwahlen"/);
    assert.match(src, /label="Heute" current=\{todayDials\} goal=\{phoneDailyGoal\} unit="Anwahlen"/);
    assert.doesNotMatch(src, /current=\{phoneWeek\.calls\}/);
  });

  test("Telefon-Übersicht setzt die Anwahlen in die Owner-Zeilen ein", () => {
    const src = read("src/components/telefon/PhoneDashboard.tsx");
    assert.match(src, /loadDialRows\(/);
    assert.match(src, /label="Anwahlen diese Woche"/);
  });

  test("Team-Vergleich zählt Anwahlen der Woche", () => {
    const src = read("src/app/(dashboard)/team/page.tsx");
    assert.match(src, /loadDialRows\(supabase, access\.workspace_id, monday, today\)/);
  });

  test("Rückrufe im Nachfass-Eingang laufen über setPhoneLeadOutcome — dort wird die Anwahl erfasst", () => {
    // Der frühere Rückruf-Reiter in /termine führte in den Call-Modus. Seit dem
    // Nachfass-Eingang stehen Rückrufe auf /nachfassen und tragen ihre
    // Ergebnis-Knöpfe direkt in der Zeile. Zählen muss die Anwahl trotzdem:
    // Jeder Knopf geht über `setPhoneLeadOutcome`, und genau dort wird ins
    // Anruf-Log geschrieben — ein zweites Protokoll für dieselbe Anwahl gäbe es
    // nicht (Plan §4.3).
    const src = read("src/components/nachfassen/NachfassEingang.tsx");
    assert.match(src, /setPhoneLeadOutcome\(\{ leadId: e\.id, listId, outcome \}\)/);
    assert.match(src, /outcome: "rueckruf", callbackAt: wert/);
    const action = read("src/app/actions/phone.ts");
    const koerper = action.slice(action.indexOf("export async function setPhoneLeadOutcome("));
    assert.match(koerper, /await logCallAttempt\(/);
  });
});
