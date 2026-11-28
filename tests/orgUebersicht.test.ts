// „Organisationen im Blick“ (/admin/uebersicht): Zeiträume, Soll und Zählung
// als Verhalten, Zugriff und Verdrahtung am Quelltext.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  aktivImMonat,
  arbeitstage,
  erfuellung,
  fruehesterTag,
  leererZaehler,
  monatsEnde,
  parseRichtwert,
  sollBisHeute,
  sollGesamt,
  summiere,
  summiereRichtwerte,
  zaehle,
  zeitraumBeginn,
  KEINE_RICHTWERTE,
} from "@/lib/orgUebersicht";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

// Mittwoch, 2. Dezember 2026 — die Woche beginnt am Montag im November.
const HEUTE = "2026-12-02";

describe("Zeiträume", () => {
  test("Heute · Woche ab Montag · Monat ab dem 1.", () => {
    assert.deepEqual(zeitraumBeginn(HEUTE), { tag: HEUTE, woche: "2026-11-30", monat: "2026-12-01" });
  });
  test("der Loader holt ab dem frühesten Beginn — die Woche reicht in den Vormonat", () => {
    assert.equal(fruehesterTag(HEUTE), "2026-11-30");
    assert.equal(fruehesterTag("2026-12-15"), "2026-12-01");
  });
  test("Arbeitstage Mo–Fr, Monatsende", () => {
    assert.equal(arbeitstage("2026-11-30", "2026-12-06"), 5);
    assert.equal(arbeitstage("2026-12-05", "2026-12-06"), 0, "Wochenende");
    assert.equal(monatsEnde("2026-12-02"), "2026-12-31");
    assert.equal(monatsEnde("2028-02-10"), "2028-02-29");
    assert.equal(arbeitstage("2026-12-01", monatsEnde("2026-12-01")), 23);
  });
});

describe("Soll", () => {
  test("bis heute: Richtwert × Arbeitstage seit Beginn", () => {
    assert.equal(sollBisHeute(40, "tag", HEUTE), 40);
    assert.equal(sollBisHeute(40, "woche", HEUTE), 120, "Mo, Di, Mi");
    assert.equal(sollBisHeute(40, "monat", HEUTE), 80, "1. und 2. Dezember");
    assert.equal(sollBisHeute(40, "tag", "2026-12-05"), 0, "Samstag");
    assert.equal(sollBisHeute(null, "woche", HEUTE), null, "ohne Richtwert kein Soll");
  });
  test("ganzer Zeitraum für den Hinweis", () => {
    assert.equal(sollGesamt(40, "woche", HEUTE), 200);
    assert.equal(sollGesamt(40, "monat", HEUTE), 920);
  });
  test("Erfüllung: ohne Soll keine, Soll 0 gilt als erfüllt", () => {
    assert.equal(erfuellung(30, 60), 0.5);
    assert.equal(erfuellung(0, 0), 1);
    assert.equal(erfuellung(5, null), null);
  });
});

describe("Zählen", () => {
  test("ein Ereignis landet in jedem Zeitraum, der es umfasst — Zukunft nie", () => {
    const z = leererZaehler();
    zaehle(z, "anwahlen", HEUTE, HEUTE);
    zaehle(z, "anwahlen", "2026-11-30", HEUTE); // Montag, Vormonat
    zaehle(z, "anwahlen", "2026-12-01", HEUTE);
    zaehle(z, "anwahlen", "2026-11-20", HEUTE); // weder Woche noch Monat
    zaehle(z, "anwahlen", "2026-12-03", HEUTE); // morgen
    zaehle(z, "anwahlen", null, HEUTE);
    assert.deepEqual(z.anwahlen, { tag: 1, woche: 3, monat: 2 });
  });
  test("Summen über Organisationen", () => {
    const a = leererZaehler();
    const b = leererZaehler();
    zaehle(a, "pitches", HEUTE, HEUTE);
    zaehle(b, "pitches", HEUTE, HEUTE);
    assert.equal(summiere([a, b]).pitches.tag, 2);
    assert.equal(aktivImMonat(a), true);
    assert.equal(aktivImMonat(leererZaehler()), false);
  });
  test("Richtwerte summieren sich nur, wo es welche gibt", () => {
    const s = summiereRichtwerte([{ ...KEINE_RICHTWERTE, anwahlen: 40 }, { ...KEINE_RICHTWERTE, anwahlen: 20, pitches: 10 }]);
    assert.equal(s.anwahlen, 60);
    assert.equal(s.pitches, 10);
    assert.equal(s.closings, null);
  });
  test("Eingabe: leer = kein Richtwert, nur ganze Zahlen bis 100.000", () => {
    assert.equal(parseRichtwert(""), null);
    assert.equal(parseRichtwert(" 40 "), 40);
    assert.equal(parseRichtwert("4,5"), undefined);
    assert.equal(parseRichtwert("-1"), undefined);
    assert.equal(parseRichtwert("100001"), undefined);
  });
});

describe("Zugriff und Definitionen", () => {
  const data = read("src/lib/orgUebersichtData.ts");
  test("nur Plattform-Admins — Seite, Loader, Action und Datenbank", () => {
    assert.match(data, /if \(!access\?\.is_platform_admin\) return null;/);
    assert.match(read("src/app/(dashboard)/admin/uebersicht/page.tsx"), /if \(!daten\) redirect\("\/"\);/);
    assert.match(read("src/app/actions/orgRichtwerte.ts"), /if \(!access\?\.is_platform_admin\) return \{ error: "Nur für Plattform-Admins\." \};/);
    const mig = read("supabase/migrations/20260404000051_org_richtwerte.sql");
    assert.match(mig, /using \(public\.is_platform_admin\(\)\)\s*with check \(public\.is_platform_admin\(\)\)/);
    // Kein Cascade-FK auf workspaces — die Löschvorschau-Invariante (§8) bleibt grün.
    assert.doesNotMatch(mig, /references public\.workspaces/);
    assert.match(mig, /after delete on public\.workspaces/);
  });
  test("die Definitionen sind die der App", () => {
    assert.match(data, /\.from\("phone_call_attempts"\)/, "Anwahlen aus dem Anruf-Log");
    assert.match(data, /c\.pitched_at \?\? berlinDateISO\(c\.created_at\)/, "Pitch-Tag wie überall");
    assert.match(data, /zaehle\(z\(s\.workspace_id\), "termine", berlinDateISO\(s\.created_at\), today\)/, "gelegt = Buchungstag");
    assert.match(data, /zaehle\(z\(s\.workspace_id\), "settings", settingEffDate\(s\), today\)/);
    assert.match(data, /zaehle\(z\(c\.workspace_id\), "closings", closingEffDate\(c\), today\)/);
    assert.match(data, /if \(absageWirktNoch\(s\)\) continue;/);
  });
  test("ein Ladefehler wird zu „—“, nie zu 0", () => {
    assert.match(data, /luecken\.push\(name\)/);
    assert.match(read("src/components/admin/OrgUebersicht.tsx"), /\{lk \? "—" : zahl\(ist\)\}/);
  });
  test("die Seitenleiste zeigt die Zeile nur Plattform-Admins", () => {
    assert.match(read("src/components/Sidebar.tsx"), /\{orgSwitch && \(\s*<NavLink\s+href="\/admin\/uebersicht"/);
  });
});

describe("Rangliste: Spalten fluchten (28.11.)", () => {
  test("Zahlen rechtsbündig wie die Überschriften, feste Breiten, sortierte Spalte im Kopf markiert", () => {
    const css = read("src/app/globals.css");
    assert.match(css, /\.ob-tabelle td\.ob-zelle \{ text-align: right; width: 12%;/);
    assert.match(css, /\.ob-tabelle thead th\.r \{ width: 12%;/);
    assert.match(read("src/components/admin/OrgUebersicht.tsx"), /data-sortiert=\{sortierung === k\.key \|\| undefined\} aria-sort=/);
  });
});
