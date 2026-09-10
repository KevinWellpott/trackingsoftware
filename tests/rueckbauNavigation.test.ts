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
//   · die Seite unter /erinnerungen — sie ist zu einer Weiterleitung geworden
//
// Was der Rückbau ausdrücklich NICHT genommen hat, und was diese Datei deshalb
// mitprüft: die Route selbst (Lesezeichen dürfen nicht ins Leere laufen) und
// die Doktrin `null` heißt „nicht ermittelbar" (docs §5.4) für die beiden
// verbliebenen Zähler.
//
// GEPRÜFT WIRD AM QUELLTEXT — dieselbe Bauart wie sidebarBloecke.test.ts und
// dashboardQuicklinks.test.ts: Seitenleiste und Streifen sind Client
// Components mit JSX, die der Test-Runner (`node --experimental-strip-types`)
// nicht laden kann. Das VERHALTEN der Zähler prüft navCounts.test.ts.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const ROUTE = read("src/app/(dashboard)/erinnerungen/page.tsx");
const NAVCOUNTS = read("src/lib/navCounts.ts");
const SIDEBAR = read("src/components/Sidebar.tsx");
const QUICKLINKS = read("src/components/dashboard/QuickLinks.tsx");
const MOBILE = read("src/components/MobileHeader.tsx");

/* ------------------------------------------------------------------ *
 * 1 — Die Route: abgeklemmt, nicht gelöscht
 * ------------------------------------------------------------------ */

describe("Die Route /erinnerungen ist eine Weiterleitung", () => {
  test("sie leitet auf die Terminliste, statt zu verschwinden", () => {
    // Ein `rm -rf` auf den Ordner hätte jedes Lesezeichen und jeden offenen Tab
    // auf eine 404 geschickt. Das Haus hat dafür ein Muster (/organic, /crm,
    // /follow-up, /setting) — eine Datei, ein `redirect`, ein Satz warum.
    assert.match(ROUTE, /import \{ redirect \} from "next\/navigation";/);
    assert.match(ROUTE, /redirect\("\/termine"\)/);
  });

  test("sie lädt nichts mehr — kein Zugriff, keine Abfrage, kein Board", () => {
    // Eine Weiterleitung, die vorher noch Daten holt, ist keine: Sie kostet
    // jeden Aufruf einen Roundtrip auf Tabellen, die niemand mehr anzeigt.
    for (const rest of ["getAccessContext", "createClient", "ErinnerungenBoard", "getDueReminderTouches", "PageHeader"]) {
      assert.ok(!ROUTE.includes(rest), `Die Weiterleitung schleppt noch „${rest}" mit`);
    }
    // Und sie ist klein genug, dass man das auf einen Blick sieht.
    assert.ok(ROUTE.split("\n").length < 20, "Die Weiterleitung ist wieder zu einer Seite gewachsen");
  });

  test("dasselbe Muster wie die drei abgeklemmten Vorbilder", () => {
    // Vier Routen, ein Bauplan. Wer die fünfte abklemmt, findet hier, wie.
    for (const vorbild of [
      "src/app/(dashboard)/organic/page.tsx",
      "src/app/(dashboard)/crm/page.tsx",
      "src/app/(dashboard)/follow-up/page.tsx",
    ]) {
      assert.match(read(vorbild), /redirect\("\/[a-z-]*"\)/, `${vorbild} folgt dem Muster nicht mehr`);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 2 — Der Zähler ist weg, die Tabelle bleibt unangetastet
 * ------------------------------------------------------------------ */

describe("Kein Erinnerungs-Zähler mehr", () => {
  test("`NavCounts` trägt genau zwei Zweige", () => {
    // Der dritte hing an /erinnerungen. Ein Zähler auf `reminder_touches`
    // zählte danach eine Tabelle, die keine Oberfläche mehr füllt: erst
    // dauerhaft dieselbe Zahl, dann dauerhaft 0.
    assert.match(NAVCOUNTS, /export const EMPTY_NAV_COUNTS: NavCounts = \{ nachfassen: null, ablage: null \};/);
    assert.doesNotMatch(NAVCOUNTS, /erinnerungen: NavCount/);
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
    // Der Ablage-Zähler beweist es an der einzigen Stelle, an der die Datenbank
    // eine Zahl schuldig bleiben kann.
    assert.match(NAVCOUNTS, /if \(error \|\| count == null\) return null;/);
  });

  test("der Nachfassen-Zähler behält beide Quellen — und seine Alles-oder-nichts-Regel", () => {
    // Er ist der einzige verbliebene Zähler mit mehr als einer Quelle. Fällt
    // eine aus, gibt es KEINEN Zähler statt einer halben Wahrheit; und ein
    // abgeschnittenes Fenster ergibt lieber gar keine Zahl als eine zu kleine.
    //
    // BEIDE Quellen stehen hier, weil /nachfassen sie beide zeigt. Zieht der
    // Telefon-Rückruf in die Terminliste um, muss dieser Zähler mitziehen —
    // ein Badge, das weniger zählt als die Seite darunter, ist derselbe Fehler
    // wie eines, das mehr zählt.
    assert.match(NAVCOUNTS, /if \(tasks\.error \|\| recycle\.error\) return null;/);
    assert.match(NAVCOUNTS, /if \(tasks\.count == null \|\| recycle\.count == null\) return null;/);
    assert.match(NAVCOUNTS, /if \(tasks\.count > taskRows\.length \|\| recycle\.count > recycleRows\.length\) return null;/);
  });
});

/* ------------------------------------------------------------------ *
 * 3 — Die drei Flächen zeigen die Seite nicht mehr an
 * ------------------------------------------------------------------ */

describe("Kein Weg führt mehr auf die abgeklemmte Seite", () => {
  test("weder Seitenleiste noch Quicklinks noch der mobile Menü-Punkt", () => {
    // Geprüft am CODE, nicht am Fließtext: Die Kommentarköpfe erklären, warum
    // es die Zeile nicht mehr gibt — das ist erwünscht und muss stehen bleiben.
    for (const [name, quelle] of [
      ["Seitenleiste", SIDEBAR],
      ["Quicklinks", QUICKLINKS],
      ["MobileHeader", MOBILE],
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
    assert.doesNotMatch(QUICKLINKS, /BellRing/);
  });
});
