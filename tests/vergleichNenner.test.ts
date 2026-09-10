// Die Nenner des Serienvergleichs gegen die Nenner der Analyse-Tabs.
//
// Warum eine eigene Datei: Die Vergleichsseite rechnet dieselben Kennzahlen wie
// die Tabs, aber über eine ganz andere Maschinerie (Registry aus Zähler und
// Nenner statt einer Zeile Code je Kachel). Genau daran ist die Show-Quote
// Closing auseinandergelaufen — der Tab nahm die abgesagten Termine aus dem
// Nenner, die Registry nicht, und dieselbe Kennzahl lieferte je nach Seite zwei
// Zahlen. docs §5 schließt das ausdrücklich aus („Diese Nenner gelten überall
// gleich"), und ein Nutzer, der zwei Show-Quoten nebeneinander sieht, glaubt
// danach keiner Zahl der Seite mehr.
//
// `metrics.ts` und `model.ts` sind bewusst frei von Server-Importen und lassen
// sich deshalb echt laden. `facts.ts` nicht (es zieht @/lib/analyseData →
// supabase/server) — der Mapper wird am Quelltext geprüft, dieselbe Bauart wie
// analyseVerdrahtung.test.ts.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { METRICS, metricOf, metricSources } from "@/lib/compare/metrics";

const FACTS = readFileSync(fileURLToPath(new URL("../src/lib/compare/facts.ts", import.meta.url)), "utf8");

describe("Show-Quote Closing — derselbe Nenner wie im Closing-Tab", () => {
  test("die abgesagten Termine stehen nicht mehr im Nenner", () => {
    // Der Tab rechnet `closingShowRate(shows, closings, abgesagt)`, also gegen
    // alle Termine MINUS die abgesagten. Die Registry kann nur zählen und
    // teilen, nicht subtrahieren — deshalb die eigene Messgröße.
    const m = metricOf("closing_showquote");
    assert.ok(m, "closing_showquote fehlt in der Registry");
    assert.equal(m.num, "closing_shows");
    assert.equal(m.den, "closing_not_cancelled");
  });

  test("der Nenner ist trotzdem die volle Termin-Menge, nicht „mit Ergebnis“", () => {
    // Es gibt bewusst KEIN `closing_decided`: `show_status` wird beim
    // Eintragen eines Ergebnisses abgeleitet (docs §4), ein Nenner aus
    // erfassten Feldern misst dort die Erfassungsdisziplin statt des
    // Ergebnisses. Genau eine Menge kommt heraus — die abgesagten.
    const keys = new Set(METRICS.flatMap((m) => [m.num, m.den].filter(Boolean)));
    assert.ok(!keys.has("closing_decided" as never));
  });

  test("die Absagequote behält dagegen ALLE Closingtermine im Nenner", () => {
    // Gegenprobe zur Zeile darüber: Eine Absage kann jeden geplanten Termin
    // treffen, und nur im vollen Nenner ist die Quote die Brücke zwischen den
    // beiden Terminzahlen (docs §5). Würde sie beim Umbau mitgezogen, stünde
    // sie konstant bei 0 % — der abgesagte Termin fehlte in seinem eigenen
    // Nenner.
    assert.equal(metricOf("closing_absagequote")?.den, "closings");
    assert.equal(metricOf("absagequote")?.den, "settings");
  });

  test("die neue Messgröße stammt aus den Closings und wird auch gefüllt", () => {
    // Eine Registry-Zeile auf eine Messgröße, die kein Mapper schreibt, ergibt
    // eine stumme Division durch 0 — das Diagramm bliebe leer und riete
    // „Zeitraum vergrößern".
    assert.deepEqual(metricSources(metricOf("closing_showquote")!), ["closing"]);
    assert.match(FACTS, /closing_not_cancelled: r\.cancelled_at \? 0 : 1,/);
    assert.match(FACTS, /closing_cancelled: r\.cancelled_at \? 1 : 0,/);
  });
});
