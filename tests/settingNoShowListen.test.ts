// „Setting No-Show"-Listen für Telefon und LinkedIn.
//
// „Da sollen nur Leute stehen, die terminiert worden sind und wo Setting auf
// No-Show steht." Die Regel ist eine reine Funktion (src/lib/settingNoShow.ts)
// und wird als VERHALTEN geprüft; die Verdrahtung am Quelltext.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { istSettingNoShow, noShowJeLead, type NoShowSettingRow } from "@/lib/settingNoShow";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

function row(p: Partial<NoShowSettingRow> & { source_id: string; created_at: string }): NoShowSettingRow {
  return { id: `${p.source_id}-${p.created_at}`, status: "offen", no_show_resolution: null, appointment_at: null, ...p };
}

describe("die Regel", () => {
  test("nur status='no_show' zählt", () => {
    assert.equal(istSettingNoShow({ status: "no_show", no_show_resolution: null }), true);
    for (const status of ["offen", "dead", "unqualifiziert", "qualifiziert", "closing_gelegt"]) {
      assert.equal(istSettingNoShow({ status, no_show_resolution: null }), false, status);
    }
  });

  test("No-Show ohne Antwort ist schon tot (Arbeitsliste, Ablage) und steht nicht hier", () => {
    assert.equal(istSettingNoShow({ status: "no_show", no_show_resolution: "ohne_antwort" }), false);
    assert.equal(istSettingNoShow({ status: "no_show", no_show_resolution: "antwort" }), true);
  });

  test("maßgeblich ist das JÜNGSTE Setting je Lead", () => {
    const m = noShowJeLead([
      // Lead a: alter No-Show, danach neuer Termin → nicht in der Liste.
      row({ source_id: "a", created_at: "2026-09-01", status: "no_show" }),
      row({ source_id: "a", created_at: "2026-09-10", status: "offen" }),
      // Lead b: alter erledigter Anlauf, jüngster ist No-Show → in der Liste.
      row({ source_id: "b", created_at: "2026-08-01", status: "dead" }),
      row({ source_id: "b", created_at: "2026-09-05", status: "no_show" }),
      // Lead c: nie terminiert gewesen geht gar nicht erst hier hinein.
    ]);
    assert.deepEqual([...m.keys()], ["b"]);
  });

  test("Ersatztermin (Status zurück auf offen) nimmt den Lead heraus", () => {
    assert.equal(noShowJeLead([row({ source_id: "x", created_at: "2026-09-01", status: "offen" })]).size, 0);
  });
});

describe("Telefon", () => {
  const DATA = read("src/lib/settingNoShowData.ts");
  const PHONE = read("src/app/actions/phone.ts");
  const RUNNER = read("src/components/telefon/CallModeRunner.tsx");

  test("nur Leads, die noch auf 'termin' stehen — ein neues Ergebnis nimmt sie heraus", () => {
    assert.match(DATA, /\.eq\("status", "termin"\)/);
  });

  test("der Call-Mode arbeitet über die list_id des Leads, nicht über eine Seiten-Liste", () => {
    assert.ok(!/list\.id/.test(RUNNER), "CallModeRunner benutzt wieder list.id");
    assert.match(RUNNER, /listId: current\.list_id/);
  });

  test("„Tot“ im Call-Mode beendet auch ein No-Show-Setting", () => {
    assert.match(PHONE, /if \(setting\?\.status === "no_show"\) await markTerminDead\("setting", setting\.id\)/);
  });

  test("die Seite existiert und nimmt ?owner=", () => {
    const PAGE = read("src/app/(dashboard)/telefon/setting-no-show/page.tsx");
    assert.match(PAGE, /loadPhoneNoShowLeads\(access\)/);
    assert.match(PAGE, /\.owner\?\.trim\(\)/);
  });
});

describe("LinkedIn", () => {
  test("die Seite zeigt das Board über mehrere Listen", () => {
    const PAGE = read("src/app/(dashboard)/listen/setting-no-show/page.tsx");
    assert.match(PAGE, /loadLinkedInNoShowContacts\(access\)/);
    assert.match(PAGE, /<ListBoardV2 listId=\{null\}/);
  });
});

describe("Neuer Termin für einen No-Show ist ein Ersatztermin", () => {
  const APPT = read("src/app/actions/appointments.ts");

  test("beide Kanäle laufen über denselben Helfer", () => {
    assert.equal((APPT.match(/await neuerTerminAmBestehendenSetting\(settingCallId,/g) ?? []).length, 2);
  });

  test("steht das Setting auf No-Show, läuft das Datum über rescheduleSetting", () => {
    assert.match(APPT, /if \(warNoShow\) return rescheduleSetting\(settingCallId, t\.berlinInput\)/);
  });

  test("der Anruf, der zum Ersatztermin führte, landet im Anruf-Log", () => {
    assert.match(APPT, /if \(isNewSetting \|\| warNoShow\) \{\s*await logCallAttempt/);
  });
});

describe("Navigation", () => {
  const SIDEBAR = read("src/components/Sidebar.tsx");
  test("beide Listen stehen fest in der Seitenleiste", () => {
    assert.match(SIDEBAR, /href="\/listen\/setting-no-show"/);
    assert.match(SIDEBAR, /href="\/telefon\/setting-no-show"/);
  });
});
