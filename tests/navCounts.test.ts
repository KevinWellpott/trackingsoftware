// Die beiden Aufgaben-Zähler der Seitenleiste.
//
// FRÜHER WAREN ES DREI. Der dritte hing an /erinnerungen und damit an der
// Erinnerungs-Kaskade; beide sind mit dem Rückbau gefallen. Die Erwartungen
// dieser Datei haben sich deshalb an genau einer Stelle geändert: `NavCounts`
// trägt keinen Zweig `erinnerungen` mehr, und keine Abfrage rührt
// `reminder_touches` an. Die vier Entscheidungen darunter sind unverändert —
// sie beschreiben, wie ein Zähler zu seiner Zahl kommt, nicht welche es gibt.
//
// Reine Logik steckt hier in vier Entscheidungen, und jede davon ist eine, die
// man einer falschen Zahl nicht ansieht:
//
//  1. Die KÖRNUNG kommt aus der QUELLE, nicht aus dem Datentyp. `nachfassen_tasks`
//     castet vier Tages-Spalten nach `timestamptz`; nach dem Typ gelesen wäre ab
//     02:00 Berlin alles überfällig (siehe dueState.test.ts).
//  2. Die Gesamtzahl ist der `count` der Datenbank, nicht die Zahl der geholten
//     Zeilen — die ist bei 500 gedeckelt.
//  3. Fehlt eine Zahl, erscheint GAR KEIN Zähler statt einer 0. Eine 0 wäre eine
//     Behauptung über die Daten, die niemand geprüft hat.
//  4. Jeder Zweig fällt einzeln aus, und keiner darf die Navigation aufhalten.
//
// Der Supabase-Client wird dafür durch eine Attrappe ersetzt: Sie protokolliert,
// WONACH gefragt wurde, und antwortet mit fertigen Zeilen. Ohne sie ließe sich
// keine dieser vier Entscheidungen prüfen, ohne eine Datenbank zu betreiben.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { AccessContext } from "@/lib/access";
import { ABLAGE_COUNT_LABEL, EMPTY_NAV_COUNTS, loadNavCounts } from "@/lib/navCounts";

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
    assert.deepEqual(EMPTY_NAV_COUNTS, { nachfassen: null, ablage: null });
  });

  test("es gibt keinen Erinnerungs-Zweig mehr", () => {
    // Der Rückbau hat /erinnerungen abgeschaltet. Ein Zweig, der weiterhin
    // `reminder_touches` zählte, mahnte Arbeit an, für die es keine Seite mehr
    // gibt — dieselbe Falle wie beim LinkedIn-Zweig des Nachfassen-Zählers.
    assert.ok(!("erinnerungen" in EMPTY_NAV_COUNTS));
  });
});

describe("Nachfassen-Zähler", () => {
  test("nur der Telefon-Rückruf trägt eine Uhrzeit, alles andere den ganzen Tag", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const protokoll: Protokoll[] = [];
    const counts = await loadNavCounts(
      supabase(
        {
          nachfassen_tasks: {
            data: [
              // Tages-Werte: die RPC castet `date` → Mitternacht UTC = 02:00 Berlin.
              { source: "linkedin", due_at: "2026-09-08T00:00:00+00:00" }, // heute fällig
              { source: "setting", due_at: "2026-09-07T00:00:00+00:00" }, // gestern → überfällig
              { source: "closing", due_at: "2026-09-08T00:00:00+00:00" }, // heute fällig
              // Verabredete Uhrzeiten: hier ist die Stunde die Aussage.
              { source: "telefon", due_at: "2026-09-08T07:00:00+00:00" }, // 09:00 Berlin → vorbei
              { source: "telefon", due_at: "2026-09-08T09:00:00+00:00" }, // 11:00 Berlin → steht an
            ],
            count: 5,
          },
          // Ein Recycling-Versuch ist immer auf den Tag fällig.
          recycle_tasks: { data: [{ due_at: "2026-09-08T00:00:00+00:00" }], count: 1 },
        },
        protokoll,
      ),
      zugriff(),
    );

    // Läse der Zähler alle Zeilen nach ihrem Datentyp, stünden hier fünf
    // Überfällige — um 10 Uhr morgens, an einem Tag, an dem nichts zu spät ist.
    //
    // Fünf statt sechs: Die LinkedIn-Zeile fällt heraus. Der Zweig steht nicht
    // mehr auf /nachfassen, und ein Badge, das ihn zählt, behauptet Arbeit,
    // die man dort nicht finden kann.
    assert.deepEqual(counts.nachfassen, { total: 5, overdue: 2 });
  });

  test("der Zähler schneidet Altlasten weg — genau wie die Seite darunter", async (t) => {
    // Das Badge zeigte am ersten produktiven Tag 425. Es zählt jetzt dieselbe
    // Menge, die die Seite zeigt: LinkedIn raus, lange Überfälliges raus
    // (lib/staleTasks.ts). Sonst mahnt die Navigation Arbeit an, die auf dem
    // Board gar nicht steht — und §5.4 verspricht, dass die Differenz
    // auflösbar bleibt.
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const counts = await loadNavCounts(
      supabase(
        {
          nachfassen_tasks: {
            data: [
              // Rückruf, Grenze 14 Tage: gestern zählt, ein Vierteljahr nicht.
              { source: "telefon", due_at: "2026-09-07T07:00:00+00:00" },
              { source: "telefon", due_at: "2026-06-01T07:00:00+00:00" },
              // Wiedervorlagen, Grenze 30 Tage.
              { source: "setting", due_at: "2026-09-01T00:00:00+00:00" },
              { source: "setting", due_at: "2026-05-01T00:00:00+00:00" },
              { source: "closing", due_at: "2026-01-15T00:00:00+00:00" },
            ],
            count: 5,
          },
          // Recycling, Grenze 90 Tage: eine frische, eine uralte Fälligkeit.
          recycle_tasks: {
            data: [{ due_at: "2026-08-20T00:00:00+00:00" }, { due_at: "2025-11-01T00:00:00+00:00" }],
            count: 2,
          },
        },
        [],
      ),
      zugriff(),
    );

    // Übrig: 1 Rückruf + 1 Setting + 1 Recycling. Alle drei sind überfällig —
    // und genau das darf das Badge weiterhin sagen.
    assert.deepEqual(counts.nachfassen, { total: 3, overdue: 3 });
  });

  test("wurde das Fenster abgeschnitten, gibt es KEIN Badge statt einer zu kleinen Zahl", async (t) => {
    // `count` ist exakt, das 500er-Fenster ist es nicht — und weil aufsteigend
    // nach Fälligkeit sortiert wird, stehen ausgerechnet die
    // wegzuschneidenden Zeilen vorn. Die gefilterte Gesamtzahl lässt sich dann
    // nicht mehr ermitteln: `null` heißt „nicht ermittelbar", nicht „nichts
    // fällig" (docs §5.4).
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const counts = await loadNavCounts(
      supabase(
        {
          nachfassen_tasks: {
            data: [{ source: "setting", due_at: "2026-09-08T00:00:00+00:00" }],
            count: 812,
          },
          recycle_tasks: { data: [{ due_at: "2026-09-08T00:00:00+00:00" }], count: 4 },
          dropout_lists: { count: 2 },
        },
        [],
      ),
      zugriff(),
    );

    assert.equal(counts.nachfassen, null);
    // …und die anderen Zweige stehen trotzdem.
    assert.deepEqual(counts.ablage, { total: 2, overdue: 0 });
  });

  test("fällt EINE der beiden Quellen aus, gibt es keinen Zähler statt einer halben Wahrheit", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const protokoll: Protokoll[] = [];
    const counts = await loadNavCounts(
      supabase(
        {
          nachfassen_tasks: { data: [{ source: "linkedin", due_at: "2026-09-01" }], count: 9 },
          recycle_tasks: { error: { message: "function recycle_tasks does not exist" } },
          dropout_lists: { count: 2 },
        },
        protokoll,
      ),
      zugriff(),
    );

    assert.equal(counts.nachfassen, null);
    // ... und der andere Zweig steht trotzdem: ein fehlendes Recycling-Schema
    // darf den Ablage-Zähler nicht mitnehmen.
    assert.deepEqual(counts.ablage, { total: 2, overdue: 0 });
  });

  test("eine abgelehnte Abfrage nimmt die Navigation nicht mit", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const counts = await loadNavCounts(
      supabase(
        {
          nachfassen_tasks: new Error("Netzwerk weg"),
          dropout_lists: { count: 1 },
        },
        [],
      ),
      zugriff(),
    );

    assert.equal(counts.nachfassen, null);
    assert.equal(counts.ablage?.total, 1);
  });

  test("eine fehlende Gesamtzahl darf nicht als 0 durchgehen", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const counts = await loadNavCounts(
      supabase(
        {
          nachfassen_tasks: { data: [{ source: "linkedin", due_at: "2026-09-08" }], count: 5 },
          // Antwort ohne Content-Range: Zeilen ja, Gesamtzahl nein.
          recycle_tasks: {
            data: [{ due_at: "2026-09-08" }, { due_at: "2026-09-08" }, { due_at: "2026-09-08" }],
            count: null,
          },
        },
        [],
      ),
      zugriff(),
    );

    // `(count ?? 0)` hätte hier 5 gemeldet und die drei Recycling-Aufgaben
    // stillschweigend unterschlagen. Kein Zähler ist die einzige ehrliche
    // Antwort — dieselbe wie bei einem Fehler und wie bei der Ablage: die drei
    // geholten Zeilen sind wegen des Deckels von 500 auch keine belastbare
    // Ersatzzahl.
    assert.equal(counts.nachfassen, null);
    // ... und der Ablage-Zähler steht trotzdem (hier ohne eigene Antwort: die
    // Attrappe liefert LEER, also eine belastbare 0).
    assert.deepEqual(counts.ablage, { total: 0, overdue: 0 });
  });
});

describe("Der Erinnerungs-Zähler ist weg — und bleibt es", () => {
  test("keine Abfrage rührt `reminder_touches` mehr an", async (t) => {
    // Die Tabelle steht noch (Muster `call_assignees`, docs §3), nur füllt sie
    // niemand mehr. Ein Zähler darauf zeigte erst dauerhaft dieselbe Zahl und
    // dann dauerhaft 0 — beides eine Aussage über nichts, und beides sähe im
    // Betrieb völlig normal aus. Die Attrappe beantwortet `from()` weiterhin,
    // damit dieser Test an der PROTOKOLLIERTEN Abfrage scheitert und nicht an
    // einer fehlenden Methode.
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const protokoll: Protokoll[] = [];
    await loadNavCounts(supabase({}, protokoll), zugriff());
    assert.deepEqual(
      protokoll.map((p) => p.name).filter((n) => n === "reminder_touches"),
      [],
    );
    // Gegenprobe, damit der Test nicht auch dann grün wäre, wenn gar nichts
    // mehr abgefragt würde.
    assert.deepEqual(new Set(protokoll.map((p) => p.name)), new Set(["nachfassen_tasks", "recycle_tasks", "dropout_lists"]));
  });
});

describe("Ablage-Zähler", () => {
  test("fragt genau die eine Liste mit offener Handlung", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const protokoll: Protokoll[] = [];
    const counts = await loadNavCounts(supabase({ dropout_lists: { count: 7 } }, protokoll), zugriff());

    // Die Summe aller sechs Listen wäre ein Aktenschrank, der nie auf null
    // geht — als Abzeichen Rauschen statt Nachricht.
    assert.equal(finde(protokoll, "dropout_lists").params?.p_list, "ersatztermin_offen");
    // Kein Überfällig-Begriff: Eine Absage mit Aussicht auf einen neuen Termin
    // hat kein Datum, an dem sie zu spät wird.
    assert.deepEqual(counts.ablage, { total: 7, overdue: 0 });
  });

  test("die Beschriftung nennt die Liste in Einzahl und Mehrzahl", () => {
    assert.deepEqual(ABLAGE_COUNT_LABEL, [
      "Absage ohne eingetragenen Ersatztermin",
      "Absagen ohne eingetragenen Ersatztermin",
    ]);
  });

  test("die Ablage fragt org-weit, die Aufgabenliste fragt persönlich", async (t) => {
    // Der Zähler muss dieselbe Frage stellen wie die Seite, auf die er
    // verlinkt: /ablage ist ein Aktenschrank der Organisation, /nachfassen ist
    // eine persönliche Aufgabenliste.
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const protokoll: Protokoll[] = [];
    await loadNavCounts(supabase({}, protokoll), zugriff({ effective_user_id: null }));

    assert.equal(finde(protokoll, "dropout_lists").params?.p_effective_user_id, null);
    assert.equal(finde(protokoll, "nachfassen_tasks").params?.p_effective_user_id, "u-ich");
    assert.equal(finde(protokoll, "recycle_tasks").params?.p_effective_user_id, "u-ich");

    // Mit eingestellter Datensicht zählt die gewählte Person — das ist die
    // bewusste Umschaltung, nicht der Standard. (Stand bis zum Rückbau im
    // Erinnerungs-Block; die Zusicherung selbst hat mit ihm nichts zu tun und
    // zieht deshalb hierher um, statt zu verschwinden.)
    const fremd: Protokoll[] = [];
    await loadNavCounts(supabase({}, fremd), zugriff({ effective_user_id: "u-kollegin" }));
    assert.equal(finde(fremd, "nachfassen_tasks").params?.p_effective_user_id, "u-kollegin");
    assert.equal(finde(fremd, "recycle_tasks").params?.p_effective_user_id, "u-kollegin");
  });

  test("ohne exakte Zahl gibt es keinen Zähler statt einer 0", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const counts = await loadNavCounts(supabase({ dropout_lists: { count: null } }, []), zugriff());
    assert.equal(counts.ablage, null);
  });
});

describe("Frist", () => {
  test("eine hängende Abfrage kostet höchstens die Frist und nimmt die anderen nicht mit", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const begonnen = process.hrtime.bigint();
    const counts = await loadNavCounts(
      supabase(
        {
          nachfassen_tasks: HAENGT,
          dropout_lists: { count: 2 },
        },
        [],
      ),
      zugriff(),
    );
    const dauerMs = Number(process.hrtime.bigint() - begonnen) / 1e6;

    assert.equal(counts.nachfassen, null);
    assert.equal(counts.ablage?.total, 2);
    // Die Frist steht bei 1500 ms. Untergrenze, damit der Test nicht auch dann
    // grün wäre, wenn die Attrappe sofort null lieferte; Obergrenze, weil
    // „lieber kein Zähler als eine hängende Navigation" sonst nur ein Kommentar
    // wäre.
    assert.ok(dauerMs >= 1400, `zu früh aufgegeben: ${dauerMs.toFixed(0)} ms`);
    assert.ok(dauerMs < 4000, `Navigation zu lange blockiert: ${dauerMs.toFixed(0)} ms`);
  });
});
