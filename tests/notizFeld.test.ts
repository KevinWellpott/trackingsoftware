// Das eine Notizfeld an Setting und Closing (28.11.).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { fruehereNotizen } from "@/lib/scripts";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

describe("frühere Leitfaden-Notizen bleiben lesbar", () => {
  test("nur gefüllte Einträge, mit Beschriftung des Blocks", () => {
    const bloecke = [{ key: "pain", label: "Pain", hint: "" }];
    assert.deepEqual(fruehereNotizen({ pain: " zu wenig Leads ", leer: "  " , alt: "x" }, bloecke), [
      { key: "pain", label: "Pain", text: "zu wenig Leads" },
      { key: "alt", label: "alt", text: "x" },
    ]);
    assert.deepEqual(fruehereNotizen(null, bloecke), []);
  });
});

describe("speichert selbst", () => {
  test("kurz nach der letzten Eingabe und beim Verlassen", () => {
    const src = read("src/components/scripts/NotizFeld.tsx");
    assert.match(src, /timer\.current = setTimeout\(\(\) => speichernRef\.current\(\), 900\);/);
    assert.match(src, /onBlur=\{speichern\}/);
    assert.match(src, /useEffect\(\(\) => \(\) => speichernRef\.current\(\), \[\]\);/);
  });
});
