// Dashboard (28.11.): LinkedIn und Telefon gleichrangig, Trend auch für
// Telefon und für die Pipeline ab Setting.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const PAGE = read("src/app/(dashboard)/page.tsx");

describe("Kanäle gleichrangig", () => {
  test("beide Karten im gleich breiten Raster", () => {
    assert.match(read("src/app/globals.css"), /\.dash-kanaele \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/);
    const block = PAGE.slice(PAGE.indexOf("══ KANÄLE ══"), PAGE.indexOf("══ TREND ══"));
    assert.match(block, /<div className="dash-kanaele">/);
    assert.match(block, /title="LinkedIn"/);
    assert.match(block, /title="Telefon"/);
  });
  test("die Telefon-Karte fällt nicht mehr auf einen Leertext zurück", () => {
    assert.doesNotMatch(PAGE, /showPhoneCard/);
  });
  test("die Kennzahl-Reihe bevorzugt keinen Kanal", () => {
    assert.match(PAGE, /label=\{`Qualifiziert · \$\{periodLabel\}`\}/);
    assert.doesNotMatch(PAGE, /label=\{`Anwahlen · \$\{periodLabel\}`\}/);
    assert.doesNotMatch(PAGE, /label=\{`DMs · \$\{periodLabel\}`\}/);
  });
});

describe("Trend", () => {
  test("LinkedIn und Telefon mit demselben Diagramm", () => {
    assert.equal((PAGE.match(/<KanalWochenChart/g) ?? []).length, 2);
    assert.match(PAGE, /mengeLabel="Anwahlen"/);
    assert.match(PAGE, /mengeLabel="DMs"/);
  });
  test("Pipeline ab Setting: Settings, Erschienen, Qualifiziert, Closings, Gewonnen", () => {
    assert.match(PAGE, /<PipelineWochenChart data=\{trendPipeline\} \/>/);
    const charts = read("src/components/DashboardCharts.tsx");
    for (const n of ["Settings", "Erschienen", "Qualifiziert", "Closings", "Gewonnen"]) {
      assert.match(charts, new RegExp(`name: "${n}"`), n);
    }
  });
  test("nur begonnene Termine ohne Absage, nach Termin-Tag", () => {
    assert.match(PAGE, /const i = wocheVon\(settingEffDate\(sc\)\);/);
    assert.match(PAGE, /const i = wocheVon\(closingEffDate\(cc\)\);/);
    assert.match(PAGE, /if \(absageWirktNoch\(sc\)\) continue;/);
  });
});

describe("Trends zugeklappt (28.11.)", () => {
  test("standardmäßig zu, per Klick auf, Zustand je Gerät", () => {
    const t = read("src/components/dashboard/TrendBereich.tsx");
    assert.match(t, /const zu = \(\): boolean => false;/);
    assert.match(t, /\{offen && <div className="dash-trends-inhalt">\{children\}<\/div>\}/);
    assert.match(t, /localStorage\.setItem\(KEY, offen \? "0" : "1"\)/);
    assert.match(PAGE, /<TrendBereich meta=/);
    assert.ok(PAGE.indexOf("<TrendBereich") < PAGE.indexOf("<PipelineWochenChart"));
  });
});
