// Regressionstests zum Live-Test vom 26.11.2026 — je Befund der Fall, an dem
// er gefunden wurde. Reine Regeln als Verhalten, Server Actions am Quelltext
// (Bauart wie terminRiegel.test.ts): Keiner der Befunde hat je einen Fehler
// geworfen, sie waren still — der Test hält fest, dass die Korrektur bleibt.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { absageWirktNoch } from "@/lib/terminMeta";
import { terminZustand, type TerminZustandInput } from "@/lib/dranRegel";
import { closingShowRate } from "@/lib/analyse";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const HEUTE = "2026-11-26";

function setting(over: Partial<TerminZustandInput>): TerminZustandInput {
  return {
    kind: "setting",
    status: "offen",
    showStatus: null,
    at: "2026-11-26T09:00:00.000Z",
    cancelledAt: null,
    cancelOutlook: null,
    noShowResolution: null,
    revivedAt: null,
    ...over,
  };
}

describe("P1-3 — eine neu terminierte Absage wirkt nicht mehr", () => {
  test("abgesagt → neu terminiert zählt als stattgefunden", () => {
    assert.equal(absageWirktNoch({ cancelled_at: "2026-11-20T10:00:00Z", revived_at: "2026-11-21T10:00:00Z" }), false);
    assert.equal(absageWirktNoch({ cancelled_at: "2026-11-20T10:00:00Z", revived_at: null }), true);
    assert.equal(absageWirktNoch({ cancelled_at: null, revived_at: null }), false);
  });

  test("mit Nachfolger aus der Ablage bleibt die alte Zeile abgesagt", () => {
    assert.equal(absageWirktNoch({ cancelled_at: "2026-11-20T10:00:00Z", revived_at: "2026-11-21T10:00:00Z" }, true), true);
  });

  test("Funnel, Closing-Tab und Vergleich lesen die Regel, nicht cancelled_at", () => {
    assert.match(read("src/lib/analyseData.ts"), /absage_wirkt: absageWirktNoch\(r, nachfolger\.has\(r\.id\)\)/);
    assert.doesNotMatch(read("src/components/analyse/tabs/FunnelTab.tsx"), /if \(r\.cancelled_at\) continue;/);
  });

  test("eine zweite Absage nach dem Neu-Terminieren ist eine neue Absage", () => {
    const cancel = read("src/app/actions/settingCalls.ts");
    assert.match(cancel, /\.\.\.\(neueAbsage \? \{ revived_at: null \} : \{\}\)/);
  });
});

describe("P2-2 — No-Show am Termintag steht sofort in „Zu tun“", () => {
  test("ein erfasster No-Show schlägt den Termin von heute", () => {
    assert.equal(terminZustand(setting({ showStatus: "no_show" }), HEUTE), "no_show");
    assert.equal(terminZustand(setting({ showStatus: "show" }), HEUTE), "show");
  });

  test("ohne Ergebnis bleibt ein Termin von heute „Termin steht“", () => {
    assert.equal(terminZustand(setting({}), HEUTE), "verlegt");
  });

  test("ein Termin an einem späteren Tag gewinnt gegen einen alten Show-Status", () => {
    assert.equal(terminZustand(setting({ showStatus: "no_show", at: "2026-11-30T09:00:00.000Z" }), HEUTE), "verlegt");
  });
});

describe("N10 — Show-Quote Closing nur über erfasste Ergebnisse", () => {
  test("13 von 20 ohne Eintrag drücken die Quote nicht mehr", () => {
    // Simon, November: 7 erschienen, kein No-Show erfasst → 100 %, nicht 35 %.
    assert.equal(closingShowRate(7, 0), 100);
  });
});

describe("Schreibpfade", () => {
  test("P1-1 — der Termin aus dem Call-Modus setzt den Erstkontakt", () => {
    const src = read("src/app/actions/appointments.ts");
    assert.match(src, /first_call_at: berlinDateISO\(new Date\(\)\.toISOString\(\)\)/);
    assert.match(src, /decider_reached: true/);
  });

  test("N5 — „Kein Termin“ setzt den Entscheider", () => {
    assert.match(read("src/app/actions/phone.ts"), /if \(newStatus === "kein_termin"\) patch\.decider_reached = true;/);
  });

  test("P1-7 — „Reagiert“ setzt den Kontaktzeitpunkt, falls leer", () => {
    assert.match(read("src/app/actions/recycle.ts"), /\.is\("recycle_last_contacted_at", null\)/);
  });

  test("P1-5 — Dashboard-Closings zählen nach „Durchgeführt von“", () => {
    assert.match(read("src/app/(dashboard)/page.tsx"), /\.or\(gespraechsFilter\)/);
  });

  test("P2-4 — „Setting offen“ zählt keine wirkende Absage", () => {
    assert.match(read("src/app/(dashboard)/page.tsx"), /cancelled_at\.is\.null,revived_at\.not\.is\.null/);
  });

  test("P2-1 — der Telefon-Tab zählt nur angerufene Leads", () => {
    assert.match(read("src/components/analyse/tabs/TelefonTab.tsx"), /if \(!r\.first_call_at\) return false;/);
  });

  test("P1-2 — /telefon summiert keine Laufzeitwerte mehr", () => {
    assert.doesNotMatch(read("src/components/telefon/PhoneDashboard.tsx"), /rpc\("rpc_phone_owner_metrics"/);
  });

  test("P3-1 — Tages-RPCs werden paginiert geladen", () => {
    for (const f of [
      "src/components/analyse/tabs/UebersichtTab.tsx",
      "src/components/analyse/tabs/TelefonTab.tsx",
      "src/components/analyse/tabs/FunnelTab.tsx",
      "src/app/(dashboard)/team/page.tsx",
    ]) {
      assert.doesNotMatch(read(f), /supabase\.rpc\("rpc_(owner|phone)_day_metrics"/, f);
    }
  });
});
