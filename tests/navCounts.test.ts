// Der Aufgaben-Zähler der Seitenleiste.
//
// FRÜHER WAREN ES DREI, DANN ZWEI, JETZT EINER. Der Erinnerungs-Zähler hing an
// der Kaskade und ist mit ihr gefallen; der Ablage-Zähler ist mit der Liste
// gefallen, die er zählte („Ersatztermin steht aus" — die einzige Ablage-Ansicht
// mit einer offenen Handlung, und sie steht seit dem Rückbau in der
// Terminliste). Übrig ist der Nachfassen-Zähler, und der liest seit der
// Nachbesserung genau EINE Quelle, weil die Seite genau eine zeigt.
//
// DIE ERWARTUNGEN DIESER DATEI HABEN SICH DAMIT ZWEIMAL GEÄNDERT — beide Male,
// weil sie einen Zustand als Soll festhielten, den es nicht mehr gab:
//
//  · `p_list: "ersatztermin_offen"` stand hier als Zusicherung. Der Rückbau hat
//    diesen Schlüssel aus der Oberfläche genommen; das Badge führte danach auf
//    eine DISJUNKTE Ansicht und ging nie auf null. Ein Test, der so etwas
//    zementiert, verteidigt den Fehler.
//  · `nachfassen_tasks` stand hier mit vier Zweigen, von denen die Seite drei
//    nicht mehr zeigt (Telefon-Rückruf, Setting- und Closing-Wiedervorlage sind
//    in die Terminliste gezogen). Das Badge zeigte 14, die Seite zwei Karten.
//
// Die Entscheidungen darunter sind unverändert — sie beschreiben, wie ein
// Zähler zu seiner Zahl kommt, nicht welche es gibt:
//
//  1. Die KÖRNUNG kommt aus der QUELLE, nicht aus dem Datentyp. `next_recycle_at`
//     ist ein Tagesdatum; nach dem Typ gelesen wäre ab 02:00 Berlin alles
//     überfällig (siehe dueState.test.ts).
//  2. Die Gesamtzahl ist der `count` der Datenbank, nicht die Zahl der geholten
//     Zeilen — die ist bei 500 gedeckelt.
//  3. Fehlt eine Zahl, erscheint GAR KEIN Zähler statt einer 0. Eine 0 wäre eine
//     Behauptung über die Daten, die niemand geprüft hat.
//  4. Der Zähler darf die Navigation nicht aufhalten.
//
// Der Supabase-Client wird dafür durch eine Attrappe ersetzt: Sie protokolliert,
// WONACH gefragt wurde, und antwortet mit fertigen Zeilen. Ohne sie ließe sich
// keine dieser Entscheidungen prüfen, ohne eine Datenbank zu betreiben.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { AccessContext } from "@/lib/access";
import { EMPTY_NAV_COUNTS, loadNavCounts } from "@/lib/navCounts";

/* ------------------------------------------------------------------ *
 * Attrappe
 * ------------------------------------------------------------------ */

type Antwort = { data?: unknown[] | null; error?: unknown; count?: number | null };
/** Eine Abfrage, die nie antwortet — für die Frist. */
const HAENGT = Symbol("hängt");
type Verhalten = Antwort | typeof HAENGT | Error;

/** Was eine Abfrage erfahren hat: RPC-Parameter und gesetzte Filter. */
type Protokoll = { name: string; params?: Record<string, unknown>; filter: Record<string, unknown> };

function abfrage(verhalten: Verhalten, filter: Record<string, unknown>) {
  const api: Record<string, unknown> = {};
  // Diese Methoden ändern nur die Form der Antwort, nicht ihre Auswahl.
  for (const m of ["select", "order", "range", "limit"]) api[m] = () => api;
  // Diese schon — sie landen im Protokoll, damit die Tests sie prüfen können.
  for (const m of ["eq", "is", "lte", "gte", "lt", "in", "not"]) {
    api[m] = (spalte: string, wert: unknown) => {
      filter[`${m}:${spalte}`] = wert;
      return api;
    };
  }
  api.then = (erfuellen: (v: unknown) => void, ablehnen: (e: unknown) => void) => {
    if (verhalten === HAENGT) return; // nie erfüllt: die Frist muss greifen
    if (verhalten instanceof Error) return ablehnen(verhalten);
    erfuellen({ data: null, error: null, count: null, ...verhalten });
  };
  return api;
}

type Antworten = {
  nachfassen_tasks?: Verhalten;
  recycle_tasks?: Verhalten;
  dropout_lists?: Verhalten;
};

const LEER: Antwort = { data: [], count: 0 };

function supabase(antworten: Antworten, protokoll: Protokoll[]) {
  return {
    rpc(name: string, params: Record<string, unknown>) {
      const filter: Record<string, unknown> = {};
      protokoll.push({ name, params, filter });
      return abfrage(antworten[name as keyof Antworten] ?? LEER, filter);
    },
    // Bleibt in der Attrappe, obwohl kein Zähler mehr eine Tabelle direkt
    // liest: Nur so lässt sich prüfen, dass `reminder_touches` wirklich nicht
    // mehr angefragt wird (statt dass der Aufruf am fehlenden `from` scheitert
    // und damit gar nichts beweist).
    from(tabelle: string) {
      const filter: Record<string, unknown> = {};
      protokoll.push({ name: tabelle, filter });
      return abfrage(LEER, filter);
    },
  } as unknown as Parameters<typeof loadNavCounts>[0];
}

function zugriff(over: Partial<AccessContext> = {}): AccessContext {
  return {
    workspace_id: "ws-1",
    user: { id: "u-ich" },
    effective_user_id: null,
    ...over,
  } as unknown as AccessContext;
}

/** 8.9.2026, 10:00 Berliner Wandzeit (Sommerzeit, UTC+2). */
const JETZT = Date.parse("2026-09-08T08:00:00Z");

function finde(protokoll: Protokoll[], name: string): Protokoll {
  const treffer = protokoll.find((p) => p.name === name);
  assert.ok(treffer, `Abfrage "${name}" wurde nie gestellt`);
  return treffer;
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe("EMPTY_NAV_COUNTS", () => {
  test("null heißt 'nicht ermittelbar' — nirgends eine 0", () => {
    assert.deepEqual(EMPTY_NAV_COUNTS, { nachfassen: null });
  });

  test("es gibt weder einen Erinnerungs- noch einen Ablage-Zweig mehr", () => {
    // Beide zählten eine Menge, die keine Oberfläche mehr zeigt: /erinnerungen
    // ist abgeschaltet, und die gezählte Ablage-Liste („Ersatztermin steht
    // aus") gibt es dort nicht mehr — ihr Inhalt steht in der Terminliste.
    assert.ok(!("erinnerungen" in EMPTY_NAV_COUNTS));
    assert.ok(!("ablage" in EMPTY_NAV_COUNTS));
  });
});

describe("Nachfassen-Zähler", () => {
  test("gezählt wird auf dem BERLINER Tag, nicht auf dem Datentyp", async (t) => {
    // `next_recycle_at` ist eine `date`-Spalte; die RPC castet sie nach
    // `timestamptz`, also auf Mitternacht UTC = 02:00 Berlin. Roh gegen `now()`
    // gehalten wäre um 10 Uhr morgens JEDE Zeile überfällig — und weil die RPC
    // ohnehin nur Fälliges liefert, wäre schlicht alles überfällig.
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const counts = await loadNavCounts(
      supabase(
        {
          recycle_tasks: {
            data: [
              { due_at: "2026-09-08T00:00:00+00:00" }, // heute fällig
              { due_at: "2026-09-08T00:00:00+00:00" },
              { due_at: "2026-09-07T00:00:00+00:00" }, // gestern → überfällig
            ],
            count: 3,
          },
        },
        [],
      ),
      zugriff(),
    );

    assert.deepEqual(counts.nachfassen, { total: 3, overdue: 1 });
  });

  test("der Zähler liest GENAU DIE EINE Quelle, die die Seite zeigt", async (t) => {
    // DIE KERNZUSICHERUNG dieser Datei. `/nachfassen` trägt seit der zweiten
    // Rückbau-Welle nur noch das Recycling (`getNachfassenTasks` →
    // `loadRecycleTasks`); Telefon-Rückruf, Setting- und Closing-Wiedervorlage
    // stehen in der Terminliste. Solange der Zähler `nachfassen_tasks`
    // mitzählte, zeigte das Badge 14 und die Seite darunter zwei Karten.
    //
    // Ein Badge, das MEHR zählt als die Seite, ist derselbe Fehler wie eines,
    // das weniger zählt; nur fällt letzteres später auf.
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const protokoll: Protokoll[] = [];
    const counts = await loadNavCounts(
      supabase(
        {
          // Wäre die RPC noch im Spiel, stünden diese vier Zeilen im Badge.
          nachfassen_tasks: {
            data: [
              { source: "telefon", due_at: "2026-09-08T07:00:00+00:00" },
              { source: "setting", due_at: "2026-09-08T00:00:00+00:00" },
              { source: "closing", due_at: "2026-09-08T00:00:00+00:00" },
              { source: "linkedin", due_at: "2026-09-08T00:00:00+00:00" },
            ],
            count: 4,
          },
          recycle_tasks: { data: [{ due_at: "2026-09-08T00:00:00+00:00" }], count: 1 },
        },
        protokoll,
      ),
      zugriff(),
    );

    assert.deepEqual(counts.nachfassen, { total: 1, overdue: 0 });
    assert.deepEqual(
      protokoll.map((p) => p.name),
      ["recycle_tasks"],
      "der Zähler fragt eine Quelle, die die Seite nicht zeigt",
    );
  });

  test("der Zähler schneidet NICHTS weg — genau wie die Seite darunter", async (t) => {
    // NACHGEZOGEN, und zwar in der Gegenrichtung. Hier stand „der Zähler
    // schneidet Altlasten weg": Eine Fälligkeit, die über 90 Tage zurücklag,
    // fiel aus Badge UND Board. Der Auftraggeber hat diesen Schnitt gestrichen
    // („wer offen ist, wird jeden Tag kontaktiert — ohne Ausnahme, ohne
    // Intervall-Logik"), also zählt das Badge wieder beide Zeilen.
    //
    // Die Zusicherung dahinter ist unverändert und ist der Grund, warum der Test
    // überhaupt hier steht: Badge und Seite zeigen dieselbe Menge. Sie hat sich
    // nur von „beide schneiden gleich" zu „beide schneiden gar nicht" verschoben.
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const counts = await loadNavCounts(
      supabase(
        {
          recycle_tasks: {
            data: [{ due_at: "2025-11-01T00:00:00+00:00" }, { due_at: "2026-08-20T00:00:00+00:00" }],
            count: 2,
          },
        },
        [],
      ),
      zugriff(),
    );

    assert.deepEqual(counts.nachfassen, { total: 2, overdue: 2 });
  });

  test("oberhalb des 500er-Fensters nennt das Badge wieder die exakte Zahl", async (t) => {
    // NACHGEZOGEN. Hier stand „dann gibt es KEIN Badge statt einer zu kleinen
    // Zahl" — richtig, solange geschnitten wurde: `count` zählt vor dem Fenster,
    // der Schnitt wirkte danach, die gefilterte Gesamtzahl war oberhalb des
    // Deckels nicht mehr zu ermitteln. Ohne Schnitt ist `count` die Wahrheit.
    //
    // Gedeckelt bleibt allein der ÜBERFÄLLIG-Anteil: Er wird über höchstens 500
    // Zeilen ermittelt. Das ist ungefährlich, weil aufsteigend nach Fälligkeit
    // sortiert wird — die überfälligen stehen vorn (docs §5.4).
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const counts = await loadNavCounts(
      supabase({ recycle_tasks: { data: [{ due_at: "2026-09-08T00:00:00+00:00" }], count: 812 } }, []),
      zugriff(),
    );

    assert.deepEqual(counts.nachfassen, { total: 812, overdue: 0 });
  });

  test("fällt die Quelle aus, gibt es keinen Zähler statt einer 0", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const counts = await loadNavCounts(
      supabase({ recycle_tasks: { error: { message: "function recycle_tasks does not exist" } } }, []),
      zugriff(),
    );

    assert.equal(counts.nachfassen, null);
  });

  test("eine abgelehnte Abfrage nimmt die Navigation nicht mit", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const counts = await loadNavCounts(supabase({ recycle_tasks: new Error("Netzwerk weg") }, []), zugriff());
    assert.equal(counts.nachfassen, null);
  });

  test("eine fehlende Gesamtzahl darf nicht als 0 durchgehen", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const counts = await loadNavCounts(
      supabase(
        {
          // Antwort ohne Content-Range: Zeilen ja, Gesamtzahl nein.
          recycle_tasks: { data: [{ due_at: "2026-09-08" }, { due_at: "2026-09-08" }], count: null },
        },
        [],
      ),
      zugriff(),
    );

    // `(count ?? 0)` hätte hier 0 gemeldet und zwei fällige Aufgaben
    // stillschweigend unterschlagen. Kein Zähler ist die einzige ehrliche
    // Antwort — die geholten Zeilen sind wegen des Deckels von 500 auch keine
    // belastbare Ersatzzahl.
    assert.equal(counts.nachfassen, null);
  });

  test("gezählt wird persönlich — auch für einen Owner mit Team-Sicht", async (t) => {
    // /nachfassen ist eine persönliche Aufgabenliste, kein Org-Bestand.
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const protokoll: Protokoll[] = [];
    await loadNavCounts(supabase({}, protokoll), zugriff({ effective_user_id: null }));
    assert.equal(finde(protokoll, "recycle_tasks").params?.p_effective_user_id, "u-ich");

    // Mit eingestellter Datensicht zählt die gewählte Person — das ist die
    // bewusste Umschaltung, nicht der Standard.
    const fremd: Protokoll[] = [];
    await loadNavCounts(supabase({}, fremd), zugriff({ effective_user_id: "u-kollegin" }));
    assert.equal(finde(fremd, "recycle_tasks").params?.p_effective_user_id, "u-kollegin");
  });
});

describe("Was der Zähler NICHT mehr anfasst", () => {
  test("weder `reminder_touches` noch `dropout_lists` noch `nachfassen_tasks`", async (t) => {
    // Alle drei zählten eine Menge ohne Oberfläche: `reminder_touches` füllt
    // seit dem Wegfall der Kaskade niemand mehr, `dropout_lists` lieferte die
    // Ablage-Liste, die es nicht mehr gibt, und `nachfassen_tasks` drei Zweige,
    // die auf der Seite nicht stehen. Die Attrappe beantwortet `from()`
    // weiterhin, damit dieser Test an der PROTOKOLLIERTEN Abfrage scheitert und
    // nicht an einer fehlenden Methode.
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const protokoll: Protokoll[] = [];
    await loadNavCounts(supabase({}, protokoll), zugriff());
    // Gegenprobe in einem: genau eine Abfrage, und zwar die richtige. Ein
    // reiner Abwesenheits-Test wäre auch dann grün, wenn gar nichts mehr
    // abgefragt würde.
    assert.deepEqual(new Set(protokoll.map((p) => p.name)), new Set(["recycle_tasks"]));
  });
});

describe("Frist", () => {
  test("eine hängende Abfrage kostet höchstens die Frist", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const begonnen = process.hrtime.bigint();
    const counts = await loadNavCounts(supabase({ recycle_tasks: HAENGT }, []), zugriff());
    const dauerMs = Number(process.hrtime.bigint() - begonnen) / 1e6;

    assert.equal(counts.nachfassen, null);
    // Die Frist steht bei 1500 ms. Untergrenze, damit der Test nicht auch dann
    // grün wäre, wenn die Attrappe sofort null lieferte; Obergrenze, weil
    // „lieber kein Zähler als eine hängende Navigation" sonst nur ein Kommentar
    // wäre.
    assert.ok(dauerMs >= 1400, `zu früh aufgegeben: ${dauerMs.toFixed(0)} ms`);
    assert.ok(dauerMs < 4000, `Navigation zu lange blockiert: ${dauerMs.toFixed(0)} ms`);
  });
});
