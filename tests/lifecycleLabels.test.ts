// Beschriftungen der Mandanten-Vorschauen (Organisation löschen, Nutzer
// verschieben).
//
// WARUM DAS EINEN TEST WERT IST: Beide Vorschauen kommen als jsonb aus der
// Datenbank und tragen technische Schlüssel. Die Map lag früher doppelt in zwei
// Dialogen — und genau das Nachziehen ist zweimal ausgeblieben, als neue
// Migrationen Zähler hinzufügten. Ein roher Tabellenname in einer LÖSCHvorschau
// liest sich wie ein Fehler und beschädigt das Vertrauen in die Zahl daneben,
// die dort unwiderruflich ist.
//
// Die beiden Abdeckungstests unten lesen die Schlüssel deshalb aus der
// eingefrorenen Migration 0036 (der jüngsten Fassung beider Vorschau-RPCs) und
// nicht aus einer zweiten Liste im Testcode: Nur so schlägt der Test an, wenn
// eine spätere Migration einen Zähler hinzufügt, den niemand beschriftet hat.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { COUNT_LABELS, countLabel, moveWarningText } from "@/lib/lifecycleLabels";

// Zeilenenden vereinheitlichen — `core.autocrlf=true` legt auch die
// Migrationsdateien unter Windows mit CRLF ab; die Anker unten tragen ein `\n`.
const MIGRATION_0036 = readFileSync(
  fileURLToPath(new URL("../supabase/migrations/20260404000036_tenant_lifecycle_nachtrag.sql", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

/** Alle Schlüssel aus den `'counts', jsonb_build_object(…)`-Blöcken. */
function zaehlerSchluessel(): string[] {
  const bloecke = [...MIGRATION_0036.matchAll(/'counts', jsonb_build_object\(([\s\S]*?)\n {4}\),?\n/g)];
  assert.ok(bloecke.length >= 2, `Erwartet: Umzugs- UND Löschvorschau, gefunden: ${bloecke.length}`);
  const keys = new Set<string>();
  for (const block of bloecke) {
    // Ein Eintrag beginnt am Zeilenanfang mit dem Schlüssel in Anführungszeichen.
    for (const m of block[1].matchAll(/^\s*'([a-z_]+)',/gm)) keys.add(m[1]);
  }
  return [...keys];
}

describe("countLabel — Abdeckung", () => {
  test("jeder Zähler beider Vorschauen hat eine deutsche Beschriftung", () => {
    const keys = zaehlerSchluessel();
    // Ohne diese Untergrenze liefe der Test grün, sobald der Ausdruck oben
    // nichts mehr findet — ein Abdeckungstest, der nichts abdeckt.
    assert.ok(keys.length >= 18, `Nur ${keys.length} Zähler gefunden: ${keys.join(", ")}`);
    const ohneLabel = keys.filter((k) => !(k in COUNT_LABELS));
    assert.deepEqual(ohneLabel, [], `Zähler ohne Beschriftung: ${ohneLabel.join(", ")}`);
  });

  test("die fünf Nachzügler aus 0036 sind dabei", () => {
    // Sie sind der Grund, aus dem die Map überhaupt aus den Dialogen
    // herausgezogen wurde.
    assert.equal(countLabel("phone_call_attempts"), "Anwahlen");
    assert.equal(countLabel("message_templates"), "Nachrichtenvorlagen");
    assert.equal(countLabel("pipeline_settings"), "Pipeline-Einstellungen");
    assert.equal(countLabel("cascade_steps"), "Kaskaden-Stufen");
    assert.equal(countLabel("reminder_touches"), "Erinnerungen");
  });

  test("Tabellennamen werden übersetzt, nicht eingedeutscht durchgereicht", () => {
    assert.equal(countLabel("lists"), "LinkedIn-Listen");
    assert.equal(countLabel("contacts"), "Kontakte");
    assert.equal(countLabel("list_views"), "Smart Views");
    assert.equal(countLabel("setting_calls"), "Setting-Termine");
    assert.equal(countLabel("closing_calls"), "Closing-Termine");
    assert.equal(countLabel("followup_templates"), "FU-Vorlagen");
  });
});

describe("countLabel — Rückfall", () => {
  test("ein unbekannter Schlüssel bleibt lesbar, statt zu verschwinden", () => {
    // Die Zeile darf niemals fehlen, nur weil ihr Name fehlt: In einer
    // Löschvorschau wäre eine verschwiegene Tabelle der teuerste Fehler.
    assert.equal(countLabel("mail_versand_log"), "Mail versand log");
    assert.equal(countLabel("neu"), "Neu");
    assert.equal(countLabel("a_b_c"), "A b c");
  });

  test("der Rückfall ersetzt nie eine vorhandene Beschriftung", () => {
    // Gegenprobe zur Reihenfolge in countLabel: Erst die Map, dann der Notnagel.
    assert.notEqual(countLabel("phone_call_attempts"), "Phone call attempts");
  });
});

describe("moveWarningText", () => {
  test("der Text der Datenbank hat Vorrang — er bringt die Anzahl schon mit", () => {
    assert.equal(
      moveWarningText({ code: "assignee_dropped", count: 3, text: "3 Zuweisung(en) werden entfernt." }),
      "3 Zuweisung(en) werden entfernt.",
    );
  });

  test("ein leerer DB-Text zählt als kein Text", () => {
    // Sonst stünde ein Warndreieck über einer leeren Zeile, und der Admin
    // bestätigte eine Warnung, die er nie gelesen hat.
    assert.equal(
      moveWarningText({ code: "orphan_view_parent", count: 2, text: "   " }),
      "2: Ansichten werden zum Wurzelknoten (Ordner bleibt zurück).",
    );
    assert.equal(
      moveWarningText({ code: "orphan_view_parent", count: 2, text: null }),
      "2: Ansichten werden zum Wurzelknoten (Ordner bleibt zurück).",
    );
    assert.equal(
      moveWarningText({ code: "orphan_view_parent", count: 2 }),
      "2: Ansichten werden zum Wurzelknoten (Ordner bleibt zurück).",
    );
  });

  test("ohne DB-Text und ohne Beschriftung bleibt wenigstens die Anzahl stehen", () => {
    // Die Anzahl ist die eine Information, wegen der man eine Warnung liest.
    assert.equal(moveWarningText({ code: "neuer_fall_2027", count: 7 }), "Neuer fall 2027: 7");
  });

  test("jede Warnung der Umzugsvorschau hat einen Rückfall-Text", () => {
    const codes = [...new Set([...MIGRATION_0036.matchAll(/'code', '([a-z_]+)'/g)].map((m) => m[1]))];
    assert.ok(codes.length >= 6, `Nur ${codes.length} Warncodes gefunden: ${codes.join(", ")}`);
    for (const code of codes) {
      // Bekannter Code → "<Anzahl>: <Beschriftung>"; unbekannter Code stellt
      // stattdessen den eingedeutschten Schlüssel voran. Das Präfix "1: " ist
      // also genau die Probe darauf, dass eine Beschriftung existiert.
      assert.match(moveWarningText({ code, count: 1 }), /^1: \S/, `${code} ohne Rückfall-Text`);
    }
  });

  test("der Nachzügler aus 0036 ist beschriftet", () => {
    assert.equal(
      moveWarningText({ code: "reminder_touch_superseded", count: 4 }),
      "4: Erinnerungen an Terminen der alten Organisation bleiben zurück und werden entwertet.",
    );
  });
});
