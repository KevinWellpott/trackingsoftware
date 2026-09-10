// Lead-Recycling, TS-Seite.
//
// WO DIE KADENZ HEUTE LEBT: nicht mehr hier. `recycleIntervalDays()` und
// `computeNextRecycleAt()` samt `DEFAULT_RECYCLE_SETTINGS` sind mit Migration
// 0033 in die Datenbank gewandert — die Wartezeit rechnet `schedule_recycle()`
// (`supabase/migrations/20260404000033_lead_recycling.sql`) aus
// `pipeline_settings`, weil der Grund sonst vom Client käme und sich per
// direktem POST jede beliebige Frist auslösen ließe (docs §4, Begründung in
// `src/app/actions/recycle.ts`). Ihre Tests sind deshalb nicht ersatzlos weg:
// Der teure Fall — „falsche Zielgruppe"/„kein Fit" dürfen NIE eine
// Wiedervorlage bekommen — wird unten dort geprüft, wo die Regel jetzt steht,
// nämlich im Text der eingefrorenen Migration.
//
// Was in der Bibliothek blieb, ist die Beschriftung des Grundes.
//
// ── GEÄNDERTE ERWARTUNG, und zwar aus dem Rückbau heraus ───────────────
// HIER STANDEN drei Tests auf `renderRecycleTemplate` — dem Aufhänger, den
// {anlass} je Grund in die Recycling-Vorlage setzte. Die Funktion ist gefallen,
// weil ihre beiden Voraussetzungen gefallen sind: Es gibt keine Vorlagen mehr
// (/nachfassen zeigt Namen und Grund, keinen vorformulierten Satz), und es gibt
// keine Grund-Staffelung mehr, aus der ein grund-spezifischer Satz seinen Sinn
// zöge — es gilt EINE Frist für alle.
//
// Die Zusicherung, die dabei nicht verloren gehen durfte, steht unten und ist
// vom Rückbau unberührt: Jeder Code, den `recycle_tasks` liefern kann, hat ein
// Label. Ohne sie stünde im Badge der rohe Code.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { RECYCLE_REASON_LABELS } from "@/lib/recycleCadence";

// Zeilenenden vereinheitlichen — `core.autocrlf=true` legt auch die
// Migrationsdateien unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst
// nicht.
const MIGRATION_0033 = readFileSync(
  fileURLToPath(new URL("../supabase/migrations/20260404000033_lead_recycling.sql", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

describe("Recycling-Kadenz (in der Datenbank)", () => {
  test("'falsche_zielgruppe' und 'kein_fit' bekommen NIE ein Recycling", () => {
    // Zwei voneinander unabhängige Riegel in 0033: der Zweig in
    // schedule_recycle() und ein CHECK auf closing_calls. Verschwindet einer
    // davon, taucht ein Lead wieder auf, der nie in den Funnel gehörte.
    assert.match(MIGRATION_0033, /schedule_recycle/);
    assert.match(MIGRATION_0033, /in \('falsche_zielgruppe', 'kein_fit'\)/);
    assert.match(MIGRATION_0033, /check[\s\S]{0,400}falsche_zielgruppe[\s\S]{0,200}next_recycle_at is null/i);
  });

  test("die Wartezeiten kommen aus pipeline_settings, nicht aus TypeScript", () => {
    // Gegenprobe zur Doppel-Wahrheit: Stünde die Staffelung wieder im
    // App-Code, hätten wir zwei Fristen für denselben Grund.
    assert.match(MIGRATION_0033, /days_default_closing_lost/);
    assert.match(MIGRATION_0033, /days_ghosting_breakup/);
  });
});

describe("RECYCLE_REASON_LABELS", () => {
  test("kennt jeden Grund, den recycle_tasks liefern kann", () => {
    // Die RPC gibt den lost_reason_code zurück, bei Telefon/Setting 'dead' und
    // bei LinkedIn 'fu_exhausted' (docs §4). Fehlt ein Label, steht im Badge
    // „Unbekannt" statt des Grundes.
    for (const reason of [
      "timing", "preis", "kein_bedarf", "entscheider", "wettbewerb", "vertrauen",
      "ghosting", "falsche_zielgruppe", "kein_fit", "sonstiges", "dead", "fu_exhausted",
    ]) {
      assert.ok(RECYCLE_REASON_LABELS[reason], reason);
    }
  });
});
