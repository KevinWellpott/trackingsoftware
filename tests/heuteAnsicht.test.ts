// „Heute“ (28.11.): saubere Meta-Zeile, Umschalter Meine/Ganze Organisation,
// in der Organisations-Ansicht „terminiert“ und „geführt“.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const EINGANG = read("src/components/nachfassen/NachfassEingang.tsx");
const DATA = read("src/lib/nachfassenData.ts");

describe("Meta-Zeile", () => {
  test("kein Umbruch zwischen Symbol und Nummer, Trenner aus dem CSS", () => {
    const css = read("src/app/globals.css");
    assert.match(css, /\.nf-meta > \* \{ white-space: nowrap; \}/);
    assert.match(css, /\.nf-meta > \* \+ \*::before \{ content: "·";/);
    assert.match(EINGANG, /<div className="nf-meta">/);
    assert.doesNotMatch(EINGANG, />\s*· <Phone/);
  });
  test("Firma, die nur den Namen wiederholt, steht nicht doppelt", () => {
    assert.match(EINGANG, /e\.firma\.trim\(\)\.toLowerCase\(\) !== e\.name\.trim\(\)\.toLowerCase\(\)/);
  });
  test("fehlendes Ergebnis heißt nicht „kein Termin“", () => {
    assert.match(DATA, /kontext: ergebnisFehlt\s*\? art === "setting"\s*\? "Erstgespräch"\s*: "Closing"/);
  });
});

describe("Meine / Ganze Organisation", () => {
  test("der Schalter steht vorn und heißt deutlich", () => {
    assert.match(EINGANG, /\{ value: "alle", label: "Ganze Organisation" \}/);
    assert.ok(EINGANG.indexOf('label: "Ganze Organisation"') < EINGANG.indexOf('ariaLabel="Ansicht"'));
  });
  test("in der Organisations-Ansicht: terminiert und geführt", () => {
    assert.match(DATA, /const terminiert = art === "setting" \? nameVon\(r\.assigned_user_id \?\? r\.created_by_user_id\) : nameVon\(r\.created_by_user_id\);/);
    assert.match(DATA, /const gefuehrt = nameVon\(r\.conducted_by_user_id\);/);
    assert.match(EINGANG, /\{alle &&\s*e\.rollen\.map/);
    assert.match(EINGANG, /alle=\{props\.wer === "alle"\}/);
  });
});
