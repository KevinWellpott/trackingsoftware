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

describe("Knöpfe der Zeile (28.11.)", () => {
  test("nichts mehr halb ausgegraut, seltene Handlungen als Symbol hinter einem Strich", () => {
    const css = read("src/app/globals.css");
    assert.doesNotMatch(css, /\.nf-ra \.ui-btn\[data-variant="secondary"\] \{ opacity: 0\.6/);
    assert.match(css, /\.nf-ra-sep \{/);
    assert.match(EINGANG, /<IconButton\s+label="Tot/);
    assert.match(EINGANG, /<LeadDossierLink kind=\{e\.art\} id=\{e\.id\} iconOnly \/>/);
  });
  test("kein Erklärsatz neben dem Schalter", () => {
    assert.doesNotMatch(EINGANG, /Deine Vorgänge: was du gelegt hast/);
  });
});

describe("Zeilen-Aufbau (28.11.)", () => {
  test("oben Name und farbiges Status-Badge, darunter Firma in der Meta-Zeile", () => {
    assert.match(EINGANG, /<span className="nf-badge" data-ton=\{e\.ton\}>/);
    const meta = EINGANG.slice(EINGANG.indexOf('<div className="nf-meta">'));
    assert.ok(meta.indexOf('className="nf-firma"') < meta.indexOf("faelligText("), "Firma steht vor der Fälligkeit");
    assert.doesNotMatch(EINGANG, /\{e\.kontext\}/);
  });
  test("No-Show rot, Nachfassen und Rückruf blau, sonst ruhig — kein Gold", () => {
    assert.match(DATA, /ton: ergebnisFehlt \? "neutral" : zustand === "no_show" \? "rot" : closingNachfassen \? "blau" : "neutral",/);
    const css = read("src/app/globals.css");
    // Dezent (28.11.): nur ein Hauch Farbe im Grund, Text neutral.
    assert.match(css, /\.nf-badge\[data-ton="rot"\] \{ background: color-mix\(in srgb, var\(--danger\) 7%, var\(--surface-3\)\); \}/);
    assert.doesNotMatch(css, /\.nf-badge\[data-ton="rot"\] \{[^}]*color: var\(--danger-fg\)/);
    assert.match(css, /\.nf-meta > \.nf-firma \{[\s\S]*?text-overflow: ellipsis;/);
  });
});

describe("Keine doppelten Wörter (28.11.)", () => {
  test("kein „Termin“, „Rückruf“, „kein Ergebnis“ oder „kein nächster Schritt“ in der Zeile", () => {
    const f = EINGANG.slice(EINGANG.indexOf("function faelligText("), EINGANG.indexOf("// ── Kontakt eintragen"));
    assert.doesNotMatch(f, /`Termin |`Rückruf |kein Ergebnis|kein nächster Schritt/);
    assert.match(f, /if \(e\.ergebnisFehlt\) return e\.terminAt \? kurzTermin\(e\.terminAt\) : null;/);
  });
});

describe("Details aufklappbar (28.11.)", () => {
  test("je Zeile per Pfeil, Vorgabe zugeklappt, Schalter für alle, je Gerät gespeichert", () => {
    assert.match(EINGANG, /\{offen && \(\s*<div className="nf-meta">/);
    assert.match(EINGANG, /className="nf-auf"/);
    assert.match(EINGANG, /const detailsServer = \(\): boolean => false;/);
    assert.match(EINGANG, /const istOffen = \(key: string\) => alleDetails !== umgeklappt\.has\(key\);/);
    assert.match(EINGANG, /\{alleDetails \? "Details ausblenden" : "Details einblenden"\}/);
  });
});
