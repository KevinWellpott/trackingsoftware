// Nachträge vom 28.11.: Zeitfilter/-ansichten in /setting und /closing,
// /telefon nur mit eigenen Listen, keine Eck-Kreuze mehr.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  fensterLabel,
  fensterVon,
  gruppenLabel,
  gruppenSchluessel,
  imFenster,
  parseZeitPreset,
  parseZeitachse,
  verschiebeAnker,
} from "@/lib/vorgangZeit";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const HEUTE = "2026-12-02"; // Mittwoch

describe("Zeitfenster", () => {
  test("Tag, Woche, Monat — verschiebbar über den Anker", () => {
    assert.deepEqual(fensterVon("heute", HEUTE), { von: HEUTE, bis: HEUTE });
    assert.deepEqual(fensterVon("woche", HEUTE), { von: "2026-11-30", bis: "2026-12-06" });
    assert.deepEqual(fensterVon("monat", HEUTE), { von: "2026-12-01", bis: "2026-12-31" });
    assert.deepEqual(fensterVon("monat", HEUTE, { anker: "2026-02-10" }), { von: "2026-02-01", bis: "2026-02-28" });
  });
  test("Kommend ab heute, Vergangen bis gestern, Zeitraum frei (vertauscht wird gedreht)", () => {
    assert.deepEqual(fensterVon("kommend", HEUTE), { von: HEUTE, bis: null });
    assert.deepEqual(fensterVon("vergangen", HEUTE), { von: null, bis: "2026-12-01" });
    assert.deepEqual(fensterVon("zeitraum", HEUTE, { von: "2026-12-10", bis: "2026-12-01" }), { von: "2026-12-01", bis: "2026-12-10" });
    assert.deepEqual(fensterVon("alle", HEUTE), { von: null, bis: null });
  });
  test("ohne Termin nur bei „Alle“", () => {
    assert.equal(imFenster(null, { von: null, bis: null }), true);
    assert.equal(imFenster(null, fensterVon("woche", HEUTE)), false);
    assert.equal(imFenster("2026-12-06", fensterVon("woche", HEUTE)), true);
    assert.equal(imFenster("2026-12-07", fensterVon("woche", HEUTE)), false);
  });
  test("Blättern: Tag, Woche (immer ab Montag), Monat über den Jahreswechsel", () => {
    assert.equal(verschiebeAnker("heute", HEUTE, -1), "2026-12-01");
    assert.equal(verschiebeAnker("woche", HEUTE, 1), "2026-12-07");
    assert.equal(verschiebeAnker("monat", "2026-12-15", 1), "2027-01-01");
    assert.equal(verschiebeAnker("monat", "2027-01-15", -1), "2026-12-01");
  });
  test("Beschriftungen", () => {
    assert.equal(fensterLabel("woche", fensterVon("woche", HEUTE), HEUTE), "KW 49 · 30.11.–06.12.2026");
    assert.equal(fensterLabel("monat", fensterVon("monat", HEUTE), HEUTE), "Dezember 2026");
    assert.equal(fensterLabel("heute", fensterVon("heute", HEUTE), HEUTE), "Heute · Mi 02.12.2026");
  });
  test("Gruppen nach Tag oder Woche", () => {
    assert.equal(gruppenSchluessel("2026-12-03", "tage"), "2026-12-03");
    assert.equal(gruppenSchluessel("2026-12-03", "wochen"), "2026-11-30");
    assert.equal(gruppenSchluessel("2026-12-03", "liste"), null);
    assert.equal(gruppenLabel("2026-12-03", "tage", HEUTE), "Morgen · Do 03.12.2026");
    assert.equal(gruppenLabel("2026-11-30", "wochen", HEUTE), "Diese Woche · KW 49 · 30.11.–06.12.2026");
    assert.equal(gruppenLabel(null, "tage", HEUTE), "Ohne Datum");
  });
  test("unbekannte URL-Werte fallen auf die Vorgabe", () => {
    assert.equal(parseZeitPreset("quatsch"), "alle");
    assert.equal(parseZeitachse("x"), "termin");
  });
});

describe("Verdrahtung in der Liste", () => {
  const liste = read("src/components/vertrieb/VorgangListe.tsx");
  test("der Zeitfilter wirkt vor den Segment-Zahlen", () => {
    assert.match(liste, /if \(!imFenster\(tagVon\(e\), fenster\)\) return false;/);
  });
  test("zwei Zeitachsen: Termin und Buchung", () => {
    assert.match(liste, /achse === "gebucht" \? gebuchtAm\.get\(e\.refId\) \?\? null : e\.dayISO/);
  });
  test("Gruppenköpfe in der Zeitansicht", () => {
    assert.match(liste, /className="vg-gruppe"/);
  });
});

describe("/telefon zeigt nur die eigenen Listen und Zahlen", () => {
  const ueb = read("src/components/telefon/TelefonUebersicht.tsx");
  test("eigene Listen auch bei Team-Sicht", () => {
    assert.match(ueb, /const ownScope = team \? ownScopeFilter\(access\) : buildOwnScope\(personId, personName\);/);
    assert.match(ueb, /p_effective_user_id: team \? access\.effective_user_id \?\? null : personId,/);
  });
  test("eigene Zahlen, „Je Person“ nur im Team", () => {
    const dash = read("src/components/telefon/PhoneDashboard.tsx");
    assert.match(dash, /const effectiveUserId = team \? access\.effective_user_id \?\? null : access\.effective_user_id \?\? access\.user\.id;/);
    assert.match(dash, /\{team && rows\.length > 0 && \(/);
  });
  test("das Gesamtbild steht unter /telefon/team, nur mit Team-Sicht", () => {
    const team = read("src/app/(dashboard)/telefon/team/page.tsx");
    assert.match(team, /if \(!access\.can_switch_view \|\| access\.effective_user_id\) redirect\("\/telefon"\);/);
    assert.match(team, /<TelefonUebersicht team /);
    assert.match(read("src/app/(dashboard)/telefon/page.tsx"), /<TelefonUebersicht team=\{false\}/);
  });
});

describe("Keine Eck-Kreuze mehr", () => {
  test("die Klasse zeichnet nichts", () => {
    assert.doesNotMatch(read("src/app/globals.css"), /\.corner-ticks::(before|after)/);
  });
});
