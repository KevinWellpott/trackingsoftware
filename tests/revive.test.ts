// Die Rückholung aus der Ablage (Entscheidung K10) — die reine Seite.
//
// Zwei Regeln lassen sich ohne Datenbank festnageln, und beide sind teuer,
// wenn sie auseinanderlaufen:
//
// 1. `reviveBlockedReason()` speist BEIDE Seiten — den ausgeschalteten Knopf im
//    Ablage-Board und die Abweisung in `reviveDropout()`. Eine Server-Action ist
//    per direktem POST erreichbar; der Knopf-Zustand ist deshalb nie der Schutz,
//    sondern nur seine Anzeige. Prüft die Action anders als der Knopf, verspricht
//    die Oberfläche etwas, das der Server verweigert (oder schlimmer: umgekehrt).
//
// 2. `lineageCounterSummary()` ist die Sichtbarkeit, mit der die bewusste
//    Auslegung „neuer Vorgang startet bei reschedule_count = 0" (E9 gegen E6)
//    überhaupt vertretbar ist. Steht dort nichts, ist „absagen und zurückholen"
//    ein lautloser Weg an der Verschiebe-Obergrenze vorbei.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  lineageCounterSummary,
  reviveBlockedReason,
  type DropoutEntity,
  type ReviveGate,
} from "@/lib/dropoutLists";

const MIGRATION_0032 = readFileSync(
  fileURLToPath(new URL("../supabase/migrations/20260404000032_reminder_cascade.sql", import.meta.url)),
  "utf8",
);

/** Eine Zeile, die zurückgeholt werden darf — die Tests kippen je ein Feld. */
function offen(patch: Partial<ReviveGate> = {}): ReviveGate {
  return { entity: "setting", revived: false, excluded: false, ...patch };
}

describe("reviveBlockedReason", () => {
  test("ein terminaler Termin ohne Hindernis lässt sich zurückholen", () => {
    assert.equal(reviveBlockedReason(offen()), null);
    assert.equal(reviveBlockedReason(offen({ entity: "closing" })), null);
  });

  test("Leads sind keine Vorgänger — revived_from_* zeigt nur auf Termine", () => {
    // Die beiden Verweise aus 0032 hängen an setting_calls und zeigen auf
    // setting_calls bzw. closing_calls. Für einen LinkedIn-Kontakt oder einen
    // Telefon-Lead gibt es gar keine Spalte, in der die Kette stünde — sein Weg
    // zurück ist ein Termin aus seiner Liste heraus.
    // Der Satz trägt dasselbe Wort wie der Knopf („Neuen Termin ansetzen"),
    // nicht mehr das alte „zurückholen" — sonst stünden auf einer Karte zwei
    // Namen für dieselbe Aktion.
    for (const entity of ["linkedin", "telefon"] as DropoutEntity[]) {
      assert.match(reviveBlockedReason(offen({ entity })) ?? "", /^Nur für Termine/);
    }
  });

  test("die beiden Verweise existieren wirklich nur auf setting_calls (Migration 0032)", () => {
    // Gegenprobe zur Regel darüber: Stünde `revived_from_*` auch auf
    // closing_calls, wäre der Riegel oben falsch begründet.
    const settingBlock = MIGRATION_0032.slice(
      MIGRATION_0032.indexOf("alter table public.setting_calls"),
      MIGRATION_0032.indexOf("alter table public.closing_calls"),
    );
    assert.match(settingBlock, /revived_from_setting_call_id/);
    assert.match(settingBlock, /revived_from_closing_call_id/);
    // Und der CHECK, der höchstens einen der beiden zulässt.
    assert.match(MIGRATION_0032, /setting_calls_revived_from_one_chk/);
  });

  test("die Sperre schlägt alles — sonst wäre das Kontaktverbot umgehbar", () => {
    // Reihenfolge ist Absicht: Ein gesperrter Vorgang darf nicht deshalb
    // durchrutschen, weil er noch keinen Nachfolger hat.
    assert.match(reviveBlockedReason(offen({ excluded: true })) ?? "", /gesperrt/i);
    assert.match(reviveBlockedReason(offen({ excluded: true, revived: true })) ?? "", /gesperrt/i);
  });

  test("zweimal zurückholen ergäbe zwei Nachfolger für eine Vorgängerzeile", () => {
    assert.match(reviveBlockedReason(offen({ revived: true })) ?? "", /^Der neue Termin steht bereits/);
    assert.match(
      reviveBlockedReason(offen({ entity: "closing", revived: true })) ?? "",
      /^Der neue Termin steht bereits/,
    );
  });
});

describe("lineageCounterSummary", () => {
  test("ein sauberer Vorgänger erzeugt keine Zeile statt einer Null-Meldung", () => {
    assert.equal(lineageCounterSummary(0, 0), null);
    assert.equal(lineageCounterSummary(0, null), null);
  });

  test("beide Zähler stehen nebeneinander", () => {
    assert.equal(lineageCounterSummary(3, 1), "3× verschoben · 1× nicht erschienen");
  });

  test("jeder Zähler steht auch allein", () => {
    assert.equal(lineageCounterSummary(2, 0), "2× verschoben");
    assert.equal(lineageCounterSummary(0, 4), "4× nicht erschienen");
  });

  test("no_show_count === null heißt „gibt es an dieser Tabelle nicht“", () => {
    // `closing_calls` führt keinen No-Show-Zähler (den gibt es seit Migration
    // 0018 nur am Erstgespräch). Die Hälfte des Satzes fällt deshalb weg, statt
    // als „0× nicht erschienen" behauptet zu werden.
    assert.equal(lineageCounterSummary(2, null), "2× verschoben");
  });
});
