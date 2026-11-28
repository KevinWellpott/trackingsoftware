// Rückbau, Spur Navigation: Was hier weg ist, muss weg bleiben.
//
// WARUM ES DIESE DATEI GIBT: Entfernungen haben keinen Anker. Eine gelöschte
// Zeile hinterlässt nichts, was bei der nächsten Runde widerspricht — und
// ausgerechnet Navigationszeilen und Zähler kommen leicht zurück, weil sie
// billig sind und nach einer Verbesserung aussehen. Ein Quicklink mehr, ein
// Badge mehr, und die Oberfläche zeigt wieder auf einen Mechanismus, den es
// nicht mehr gibt.
//
// Was der Rückbau in dieser Spur genommen hat:
//   · die Zeile „Erinnerungen" in der Seitenleiste samt Tooltip und Zähler
//   · die Kachel „Erinnerungen" im Quicklink-Streifen des Dashboards
//   · den Zweig `erinnerungen` in `NavCounts` und die Abfrage auf
//     `reminder_touches`, die ihn füllte
//   · die Seite unter /erinnerungen — sie war zuerst eine Weiterleitung und
//     ist mit dem Nachfass-Eingang (27.11.2026) ganz gelöscht, zusammen mit
//     den drei älteren Weiterleitungen /organic, /crm und /follow-up und den
//     Smart Views unter /ansicht
//
// Was diese Datei deshalb mitprüft: dass keine Fläche mehr auf eine dieser
// Routen zeigt (eine gelöschte Route mit einem Link davor ist eine 404 mit
// Ansage), und die Doktrin `null` heißt „nicht ermittelbar" (docs §5.4) für
// den verbliebenen Zähler — der seit dem Nachfass-Eingang aus
// src/lib/navCountsData.ts kommt.
//
// GEPRÜFT WIRD AM QUELLTEXT — dieselbe Bauart wie sidebarBloecke.test.ts und
// dashboardQuicklinks.test.ts: Seitenleiste und Streifen sind Client
// Components mit JSX, die der Test-Runner (`node --experimental-strip-types`)
// nicht laden kann. Das VERHALTEN der Zähler prüft navCounts.test.ts.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/**
 * Die Datei OHNE Kommentare — Muster `code()` aus rueckbauArbeitsflaeche.test.ts.
 * Ein Abwesenheits-Test gegen den Rohtext verböte einer Datei, zu erklären,
 * warum sie etwas nicht mehr tut.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const NAVCOUNTS_DATA = read("src/lib/navCountsData.ts");
const NAVCOUNTS = read("src/lib/navCounts.ts");
const SIDEBAR = read("src/components/Sidebar.tsx");
// GEÄNDERT (Redesign Phase 4/6): Der Quicklink-Streifen ist in der Übersicht
// aufgegangen; geprüft werden jetzt die Übersicht selbst, ihre Karten und die
// untere Tab-Leiste am Handy — die Flächen, die heute auf Seiten verlinken.
const UEBERSICHT = read("src/app/(dashboard)/page.tsx") + read("src/components/dashboard/HeuteKarten.tsx");
const TABBAR = read("src/components/MobileBottomNav.tsx");
const MOBILE = read("src/components/MobileHeader.tsx");

/* ------------------------------------------------------------------ *
 * 1 — Die abgeklemmten Routen sind gelöscht
 * ------------------------------------------------------------------ */

describe("Die abgeklemmten Routen sind gelöscht, nicht nur umgeleitet", () => {
  // HIER STAND: „Die Route /erinnerungen ist eine Weiterleitung" — samt den
  // drei Vorbildern /organic, /crm und /follow-up. Mit dem Nachfass-Eingang
  // sind alle vier Weiterleitungen gelöscht (dazu die Smart Views unter
  // /ansicht). Eine Weiterleitung auf eine Seite, die selbst nicht mehr die
  // gemeinte Arbeit trägt, ist kein Lesezeichen-Schutz mehr, sondern ein
  // Umweg.
  const GELOESCHT = ["erinnerungen", "organic", "crm", "follow-up", "ansicht"] as const;

  test("die Ordner existieren nicht mehr", () => {
    for (const route of GELOESCHT) {
      const ordner = fileURLToPath(new URL(`../src/app/(dashboard)/${route}`, import.meta.url));
      assert.equal(existsSync(ordner), false, `/${route} ist wieder da`);
    }
  });

  test("und keine Navigationsfläche verlinkt auf sie", () => {
    for (const [name, quelle] of [
      ["Seitenleiste", SIDEBAR],
      ["Übersicht", UEBERSICHT],
      ["MobileHeader", MOBILE],
      ["Tab-Leiste", TABBAR],
    ] as const) {
      for (const route of GELOESCHT) {
        assert.doesNotMatch(code(quelle), new RegExp(`["'\`]/${route}\\b`), `${name} verlinkt weiterhin auf /${route}`);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * 2 — Der Zähler ist weg, die Tabelle bleibt unangetastet
 * ------------------------------------------------------------------ */

describe("Kein Erinnerungs-Zähler mehr", () => {
  test("`NavCounts` trägt genau einen Zweig", () => {
    // Es waren drei. Der Erinnerungs-Zähler hing an /erinnerungen und zählte
    // danach eine Tabelle, die keine Oberfläche mehr füllt: erst dauerhaft
    // dieselbe Zahl, dann dauerhaft 0.
    //
    // Der Ablage-Zähler ist danach gefallen, und diese Zeile hat es
    // nachzuziehen statt zu verteidigen: Er zählte `ersatztermin_offen` — die
    // einzige Ablage-Liste mit einer offenen Handlung, und genau die hat der
    // Rückbau aus der Ablage genommen (ihr Inhalt steht in der Terminliste).
    // Das Badge führte danach auf eine DISJUNKTE Ansicht und ging nie auf null.
    assert.match(NAVCOUNTS, /export const EMPTY_NAV_COUNTS: NavCounts = \{ nachfassen: null \};/);
    assert.doesNotMatch(NAVCOUNTS, /erinnerungen: NavCount/);
    assert.doesNotMatch(NAVCOUNTS, /ablage: NavCount/);
  });

  test("keine Abfrage auf `reminder_touches` und keine Kaskaden-Frist", () => {
    // `reminder_touches` und `reminderDueSpec` gehören zur Kaskade: Ohne
    // Stufen gibt es keinen Sofort-Touch, dessen Frist am Termin hängt.
    assert.doesNotMatch(NAVCOUNTS, /from\("reminder_touches"\)/);
    assert.doesNotMatch(NAVCOUNTS, /reminderDueSpec/);
    assert.doesNotMatch(NAVCOUNTS, /countErinnerungen/);
  });

  test("die Doktrin gilt weiter: keine stille 0", () => {
    // docs §5.4: `null` heißt „nicht ermittelbar", nicht „null Aufgaben". Beim
    // Kürzen eines Bündels ist ein `?? 0` die naheliegendste und leiseste Art,
    // sie zu brechen — die fehlende Zahl sähe dann aus wie Feierabend.
    assert.doesNotMatch(NAVCOUNTS, /total \?\? 0/);
    assert.match(NAVCOUNTS, /Ein Zähler\. `null` heißt „nicht ermittelbar" — nicht „null Aufgaben"\./);
    // Bewiesen an der Stelle, an der die Datenbank eine Zahl schuldig bleiben
    // kann: ohne exakten `count` gibt es kein Badge.
    assert.match(NAVCOUNTS, /if \(recycle\.count == null\) return null;/);
  });

  test("der Nachfassen-Zähler liest den Loader der SEITE — und nur den", () => {
    // Die Bindungspflicht aus docs §5.4: Ein Badge, das anders zählt als die
    // Seite darunter, ist ein Fehler. Zuerst hieß das „dieselbe RPC wie die
    // Seite" (`recycle_tasks` in lib/navCounts.ts). Seit dem Nachfass-Eingang
    // liest die Seite den Loader `ladeNachfassen` — also liest ihn auch das
    // Badge, mit derselben Gruppierung (`gruppiere`) und der Zählregel
    // `badgeZahl` aus src/lib/nachfassRegel.ts. Eine eigene Abfrage daneben
    // wäre eine zweite Definition von „fällig".
    // Schlanke Form desselben Loaders (Punkt 5, 28.11.).
    assert.match(NAVCOUNTS_DATA, /import \{ ladeNachfassenSchlank \} from "@\/lib\/nachfassenData";/);
    assert.match(NAVCOUNTS_DATA, /import \{ badgeZahl, gruppiere \} from "@\/lib\/nachfassRegel";/);
    assert.match(NAVCOUNTS_DATA, /ladeNachfassenSchlank\(\)/);
    assert.match(NAVCOUNTS_DATA, /nachfassen: badgeZahl\(gruppiere\(daten\.eintraege, daten\.today, daten\.nowMs\)\)/);
    const nurCode = code(NAVCOUNTS_DATA);
    assert.doesNotMatch(nurCode, /\.rpc\(|\.from\(/, "Das Badge fragt wieder selbst die Datenbank.");
    assert.doesNotMatch(nurCode, /nachfassen_tasks|dropout_lists|ersatztermin_offen|loadNavCounts/);
  });

  test("ein Ausfall oder eine Zeitüberschreitung gibt kein Badge — keine 0", () => {
    // docs §5.4: Fehlt die Zahl, verschwindet das Badge. `EMPTY_NAV_COUNTS`
    // trägt `null`, und genau das liefert die Hülle in allen drei Fällen:
    // nicht angemeldet, Frist abgelaufen, Fehler.
    assert.match(NAVCOUNTS_DATA, /if \(!access\) return EMPTY_NAV_COUNTS;/);
    // Auch eine unvollständige Ladung (gescheiterte Grundabfrage) gibt kein Badge.
    // Die Wiedervorlage zählt seit dem 28.11. nicht mehr mit — ihr Ausfall
    // ändert die Badge-Zahl nicht und nimmt das Badge deshalb nicht weg.
    assert.match(NAVCOUNTS_DATA, /if \(!daten \|\| !daten\.vollstaendig\) return EMPTY_NAV_COUNTS;/);
    assert.match(NAVCOUNTS_DATA, /\} catch \{\s*return EMPTY_NAV_COUNTS;/);
    assert.match(NAVCOUNTS_DATA, /const DEADLINE_MS = 1500;/);
    assert.doesNotMatch(NAVCOUNTS_DATA, /\?\? 0/);
  });
});

/* ------------------------------------------------------------------ *
 * 3 — Die drei Flächen zeigen die Seite nicht mehr an
 * ------------------------------------------------------------------ */

describe("Kein Weg führt mehr auf die abgeklemmte Seite", () => {
  test("weder Seitenleiste noch Übersicht noch die mobilen Flächen", () => {
    // Geprüft am CODE, nicht am Fließtext: Die Kommentarköpfe erklären, warum
    // es die Zeile nicht mehr gibt — das ist erwünscht und muss stehen bleiben.
    for (const [name, quelle] of [
      ["Seitenleiste", SIDEBAR],
      ["Übersicht", UEBERSICHT],
      ["MobileHeader", MOBILE],
      ["Tab-Leiste", TABBAR],
    ] as const) {
      assert.doesNotMatch(quelle, /href[=:] ?"\/erinnerungen"/, `${name} verlinkt weiterhin auf /erinnerungen`);
      assert.doesNotMatch(quelle, /navCounts\?\.erinnerungen|counts\?\.erinnerungen/, `${name} liest weiterhin den Erinnerungs-Zähler`);
    }
  });

  test("das Glocken-Icon ist aus beiden Flächen raus", () => {
    // Ein importiertes, ungenutztes Icon wäre die Einladung, die Zeile „schnell
    // wieder" einzuhängen — und eslint sähe es nicht, sobald es irgendwo
    // einmal vorkommt.
    assert.doesNotMatch(SIDEBAR, /BellRing/);
    assert.doesNotMatch(UEBERSICHT, /BellRing/);
    assert.doesNotMatch(TABBAR, /BellRing/);
  });
});
