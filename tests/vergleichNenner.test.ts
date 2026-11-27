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

// Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
// unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
const FACTS = readFileSync(fileURLToPath(new URL("../src/lib/compare/facts.ts", import.meta.url)), "utf8").replace(
  /\r\n/g,
  "\n",
);

describe("Show-Quote Closing — derselbe Nenner wie im Closing-Tab", () => {
  test("Nenner sind die Closings mit erfasstem Ergebnis (Live-Test, N10)", () => {
    // Der Tab rechnet `closingShowRate(shows, noShows)`. Die Registry braucht
    // dafür eine eigene Messgröße, weil sie nur zählen und teilen kann.
    const m = metricOf("closing_showquote");
    assert.ok(m, "closing_showquote fehlt in der Registry");
    assert.equal(m.num, "closing_shows");
    assert.equal(m.den, "closing_decided");
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
    assert.match(FACTS, /closing_decided: r\.show_status === "show" \|\| r\.show_status === "no_show" \? 1 : 0,/);
    assert.match(FACTS, /closing_cancelled: r\.cancelled_at \? 1 : 0,/);
  });
});

describe("Gatekeeper ist keine Kennzahl mehr (Live-Test 26.11., N4)", () => {
  test("die Registry bietet keine Gatekeeper-Messgröße an", () => {
    // Bei 13 von 1.708 Anwahlen erfasst lieferte jede Quote darauf Unsinn
    // (bis 710 %). Ein alter Link mit `s=gatekeeper` fällt still weg.
    assert.ok(!METRICS.some((m) => m.num === "gatekeeper" || m.den === "gatekeeper"));
  });
});
