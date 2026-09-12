// Rückbau, Spur Einstellungen: was hier geprüft wird, ist eine ABWESENHEIT.
//
// Der Vorlagen-Editor (31 Texte, Suche, Vorschau, Ebenen-Umschalter), die
// Ansicht der 21 Kaskadenstufen und die neun Wartezeiten je Verlustgrund sind
// aus /settings entfernt. Ein Test, der das festhält, ist kein Selbstzweck:
// Diese Bausteine sind nicht durch einen Fehler entstanden, sondern durch
// Fleiß — und genau so kommen sie zurück, wenn niemand widerspricht. Die
// Versionsverwaltung ist das Archiv; diese Datei ist der Widerspruch.
//
// Geprüft wird am QUELLTEXT, dieselbe Bauart wie schreibpfadGrenzen.test.ts:
// Die Karten sind Client-Komponenten mit JSX, der Runner
// (`node --experimental-strip-types`) lädt sie nicht, und eine Attrappe bewiese
// nur, dass die Attrappe stimmt.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function pfad(relative: string): string {
  return fileURLToPath(new URL(`../${relative}`, import.meta.url));
}

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(pfad(relative), "utf8").replace(/\r\n/g, "\n");
}

const PAGE = read("src/app/(dashboard)/settings/page.tsx");
const CARD = read("src/components/settings/PipelineSettingsCard.tsx");

/* ------------------------------------------------------------------ *
 * Die entfernten Dateien
 * ------------------------------------------------------------------ */

describe("Rückbau: entfernte Dateien", () => {
  test("es gibt keinen Vorlagen-Editor und keinen Schreibpfad dazu mehr", () => {
    // „Keine Templates" ist wörtlich gemeint. Die Vorlagen-BIBLIOTHEK bleibt
    // (src/lib/messageTemplates.ts) — /nachfassen rendert die Texte weiter;
    // was fällt, ist die Oberfläche, in der man sie bearbeitet, und die beiden
    // Server-Actions dahinter.
    for (const datei of [
      "src/components/settings/MessageTemplatesCard.tsx",
      "src/app/actions/messageTemplates.ts",
    ]) {
      assert.equal(existsSync(pfad(datei)), false, `${datei} ist wieder da`);
    }
  });

  test("der Aufklapp-Baustein der Settings-Karten ist mit seinen Verwendern gegangen", () => {
    // `Collapsible` gab es nur, weil eine Karte vierzehn Zahlen und eine andere
    // 31 Texte zu verstecken hatte. Beides ist weg; eine Komponente ohne
    // Verwender sieht aus wie die geltende Konvention und wäre der nächste
    // Baustein, in den jemand wieder etwas einklappt.
    assert.equal(existsSync(pfad("src/components/settings/Collapsible.tsx")), false);
    assert.doesNotMatch(CARD, /Collapsible/);
  });
});

/* ------------------------------------------------------------------ *
 * Die Seite
 * ------------------------------------------------------------------ */

describe("Rückbau: /settings", () => {
  test("die Seite lädt weder Vorlagen noch Kaskadenstufen", () => {
    // Zwei Abfragen weniger je Aufruf. Beide Loader lebten in
    // actions/reminders.ts weiter, solange Nachfassen und Termin-Kaskade sie
    // riefen; mit dem Kern ist die ganze Datei gefallen. Die Zusicherung an
    // /settings bleibt trotzdem stehen — sie beschreibt, was die Seite NICHT
    // tut, und das gilt unabhängig davon, wo der Loader wohnt.
    assert.doesNotMatch(PAGE, /getTemplateBundles/);
    assert.doesNotMatch(PAGE, /getCascadeSteps/);
    assert.doesNotMatch(PAGE, /MessageTemplatesCard/);
    assert.doesNotMatch(PAGE, /EMPTY_TEMPLATE_BUNDLE/);
  });

  test("die Kopfzeile verspricht keine Vorlagen mehr", () => {
    // Sie zählte auf, was die Seite trägt. „Vorlagen" stünde dort als einziger
    // Punkt ohne Karte darunter.
    assert.doesNotMatch(PAGE, /meta="[^"]*Vorlagen/);
  });

  test("die vier tragenden Karten stehen weiter", () => {
    // Nutzerverwaltung und Leistungsziele sind vom Rückbau ausdrücklich
    // ausgenommen; der Workspace-Block ist die Identität der Organisation.
    for (const anker of [">Workspace<", ">Team<", ">Ziele<", "PipelineSettingsCard"]) {
      assert.ok(PAGE.includes(anker), `${anker} fehlt in /settings`);
    }
  });

  test("das Owner-Gate der Pipeline bleibt strenger als das der Nutzerverwaltung", () => {
    // role='owner' allein reicht nicht: Die beiden Zahlen gelten team-weit,
    // deshalb wörtlich dasselbe Prädikat wie can_manage_org_settings() in der
    // RLS. Ohne den zweiten Teil dürfte ein Owner mit eingeschränkter
    // Datensicht die Recycling-Frist des ganzen Teams stellen.
    assert.match(
      PAGE,
      /const canManageOrgSettings = access\.role === "owner" && access\.data_scope === "workspace"/,
    );
  });
});

/* ------------------------------------------------------------------ *
 * Die Pipeline-Karte
 * ------------------------------------------------------------------ */

describe("Rückbau: PipelineSettingsCard", () => {
  test("das Verschiebe-Kontingent bleibt — es ist die eine Zahl, die zählt", () => {
    // Kein Kaskaden- und kein Recycling-Feld: `max_reschedules` trennt „liegt
    // in der Luft" von „ist versorgt" und ist damit genau die Unterscheidung,
    // auf der die neue Arbeitsliste steht.
    assert.match(CARD, /"max_reschedules"/);
    assert.match(CARD, /Verschiebungen je Termin/);
  });

  test("die Kaskadenstufen werden nicht mehr angezeigt", () => {
    // 21 Stufen in neun Kaskaden, nur lesbar — eine Erklärung dafür, welcher
    // Text wann greift. Ohne Kaskaden gibt es nichts zu erklären.
    assert.doesNotMatch(CARD, /cascadeEngine/);
    assert.doesNotMatch(CARD, /CASCADE_KIND_LABELS/);
    assert.doesNotMatch(CARD, /Erinnerungs-Stufen/);
  });

  test("es gibt kein Feld je Verlustgrund mehr", () => {
    // Neun Wartezeiten, deren Unterschied zueinander niemand begründen kann —
    // das war die Bedienoberfläche zu einem Regelwerk für zwanzig Setter.
    assert.doesNotMatch(CARD, /LOST_REASON_FIELDS/);
    assert.doesNotMatch(CARD, /Feinstaffelung/);
    // Und kein Erinnerungs-Horizont: Die Seite, die er steuerte, gibt es nicht
    // mehr.
    assert.doesNotMatch(CARD, /reminder_horizon_days/);
  });

  test("der Versuchs-Deckel ist NICHT mehr einstellbar — der Wert bleibt trotzdem", () => {
    // NACHGEZOGEN, und zwar zum zweiten Mal an derselben Zeile. Die Geschichte
    // gehört dazu, sonst dreht sie die nächste Runde noch einmal:
    //
    //  1. Der Rückbau nahm das Feld heraus. Hier stand
    //     `assert.doesNotMatch(CARD, /max_attempts/)`.
    //  2. Eine adversarische Prüfung befand das als Fehler: Der Deckel WIRKT
    //     weiter (`recycle_attempt()`, Migration 0033, EINGEFROREN, nullt bei
    //     `recycle_attempt_count >= max_attempts` das `next_recycle_at`), war
    //     aber unsichtbar und unverstellbar. Also kam das Feld zurück.
    //  3. Der Auftraggeber hat es wieder weggenommen — und zwar mit Ansage: Der
    //     Wert soll bleiben, wie er ist, die Zahl ist nur nichts, was jemand
    //     stellen soll. Drei Zahlen in den Einstellungen waren eine zu viel.
    //
    // Punkt 2 bleibt trotzdem gültig und ist der Grund für den nächsten Test:
    // Was verschwindet, ist das BEDIENELEMENT, nicht der Deckel — und schon gar
    // nicht der gespeicherte Wert.
    assert.doesNotMatch(CARD, /"max_attempts"/);
    assert.doesNotMatch(CARD, /ATTEMPTS_FIELD/);
    assert.doesNotMatch(CARD, /Versuche je Lead/);
  });

  test("… und die Karte behauptet nirgends, es gebe keinen Deckel", () => {
    // Die eine Formulierung, die hier nie stehen darf. Genau sie stand schon
    // einmal im Analyse-Bereich und war falsch (tests/rueckbauTexteUndDeckel).
    // Eine Oberfläche, die eine wirkende Grenze verschweigt, ist ärgerlich; eine,
    // die ihr Gegenteil behauptet, schickt jemanden auf die Suche nach einem
    // Fehler, den es nicht gibt.
    assert.doesNotMatch(CARD, /kein(en)? (Versuchs-)?Deckel/i);
    assert.doesNotMatch(CARD, /unbegrenzt/i);
    // Gegenprobe: Der Kopf sagt, dass es ihn gibt und wo er wirkt.
    assert.match(CARD, /recycle_attempt\(\)/);
    assert.match(CARD, /Ablage/);
  });

  test("GEGENRICHTUNG: der gespeicherte Deckel überlebt jedes Speichern", () => {
    // DER TEUERSTE FEHLER, DEN DIESE ÄNDERUNG HABEN KÖNNTE. `updatePipelineSettings`
    // schreibt per `upsert` die GANZE Zeile: `{...current.settings, ...clean}`.
    // `current.settings` ist aber nicht die Datenbankzeile, sondern
    // `{...PIPELINE_DEFAULTS, ...row}` — eine Spalte, die der SELECT nicht holt,
    // kommt dort mit ihrem AUSLIEFERUNGSWERT an und wird genau so
    // zurückgeschrieben. Fiele `max_attempts` aus der Spaltenliste (die
    // naheliegende „Aufräumarbeit", nachdem das Feld weg ist), setzte das
    // nächste Speichern der Recycling-Frist den Deckel einer Organisation von 4
    // still auf 2 zurück — sichtbar wäre das nirgends, weil die Zahl keine
    // Oberfläche mehr hat.
    const ACTION = read("src/app/actions/pipelineSettings.ts");

    // 1. Der Typ und die Auslieferungswerte führen die Spalte weiter.
    assert.match(ACTION, /max_attempts: number;/);
    assert.match(ACTION, /max_attempts: 2,/);

    // 2. Die Spaltenliste des SELECT wird aus den Auslieferungswerten ABGELEITET
    //    — nicht abgeschrieben. Nur so kann sie gar nicht erst unvollständig
    //    werden.
    assert.match(ACTION, /const SETTINGS_COLUMNS = Object\.keys\(PIPELINE_DEFAULTS\)\.join\(", "\);/);
    assert.match(ACTION, /\.select\(SETTINGS_COLUMNS\)/);

    // 3. Und der gelesene Stand steht im Upsert VOR dem Patch: Was niemand
    //    ändert, wird unverändert zurückgeschrieben.
    const upsert = ACTION.slice(ACTION.indexOf('.from("pipeline_settings").upsert('), ACTION.indexOf("if (error) return { error: error.message };"));
    assert.ok(
      upsert.indexOf("...current.settings") < upsert.indexOf("...clean"),
      "der Patch muss NACH dem gelesenen Stand stehen, sonst überschreibt der Stand den Patch",
    );

    // 4. Gegenprobe an der Grundgesamtheit: JEDE Spalte des Typs steht in den
    //    Auslieferungswerten — sonst holt der SELECT sie nicht, und Punkt 3
    //    schriebe eine `undefined`-Lücke bzw. einen geratenen Wert.
    const typ = ACTION.slice(
      ACTION.indexOf("export type PipelineSettings = {"),
      ACTION.indexOf("};", ACTION.indexOf("export type PipelineSettings = {")),
    );
    const defaults = ACTION.slice(
      ACTION.indexOf("const PIPELINE_DEFAULTS: PipelineSettings = {"),
      ACTION.indexOf("};", ACTION.indexOf("const PIPELINE_DEFAULTS: PipelineSettings = {")),
    );
    const spalten = [...typ.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);
    assert.ok(spalten.includes("max_attempts"), "der Typ führt max_attempts nicht mehr");
    for (const spalte of spalten) {
      assert.ok(defaults.includes(`${spalte}:`), `${spalte} fehlt in PIPELINE_DEFAULTS — der SELECT holt sie nicht`);
    }
  });

  test("die eine Frist schreibt JEDE Wartezeit-Spalte — sonst wäre sie eine Behauptung", () => {
    // Der Kern des flachen Recyclings, und die Stelle, an der es lautlos
    // zurückfallen würde: `schedule_recycle()` (Migration 0033, eingefroren)
    // sucht sich je Ursprung und Verlustgrund EINE dieser Spalten aus. Schriebe
    // das Feld nur eine davon, gälte für drei der vier Ursprünge und für jeden
    // Closing-Verlustgrund weiter die alte Staffelung — sichtbar nirgends.
    //
    // Geprüft wird gegen den Typ `PipelineSettings` statt gegen eine
    // abgeschriebene Liste: Kommt je eine Wartezeit-Spalte dazu, schlägt dieser
    // Test an, statt dass sie still aus der einen Frist herausfällt.
    //
    // Der Typ ist mit dem Rückbau umgezogen — aus `actions/reminders.ts`, wo er
    // neben der Kaskade stand, in die eigene `actions/pipelineSettings.ts`.
    // Dieselbe Zeile `pipeline_settings` versorgt weiterhin BEIDES, was von ihr
    // übrig ist: das Verschiebe-Kontingent und die Recycling-Frist.
    const typ = read("src/app/actions/pipelineSettings.ts");
    const block = typ.slice(
      typ.indexOf("export type PipelineSettings = {"),
      typ.indexOf("};", typ.indexOf("export type PipelineSettings = {")),
    );
    const spalten = [...block.matchAll(/^\s*(days_[a-z_]+):/gm)].map((m) => m[1]);
    assert.ok(spalten.length >= 14, `nur ${spalten.length} Wartezeit-Spalten gefunden`);

    const liste = CARD.slice(CARD.indexOf("const RECYCLE_COLUMNS"), CARD.indexOf("];", CARD.indexOf("const RECYCLE_COLUMNS")));
    for (const spalte of spalten) {
      assert.ok(liste.includes(`"${spalte}"`), `${spalte} fehlt in RECYCLE_COLUMNS`);
    }
  });

  test("angezeigt wird die längste bisherige Wartezeit, nicht die kürzeste", () => {
    // Solange die alte Staffelung noch in der Datenbank steht, ist die Anzeige
    // eine Vorbelegung — und die kürzeste Frist auf alles anzuwenden hieße, den
    // gesamten toten Bestand auf einmal wieder in die Arbeitsliste zu spülen.
    assert.match(CARD, /const laengste = Math\.max\(\.\.\.gespeichert\)/);
    assert.match(CARD, /value=\{laengste\}/);
  });
});
