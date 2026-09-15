// „Durchgeführt von" — drei Personenfragen an einem Termin (Migration 0042).
//
//   „Wenn ich einen Termin lege, muss ich ihn an den Termin erinnern. Wenn er
//    nicht erscheint, muss weiterhin ich ihn nerven. Aber wenn Kevin das
//    Closing gemacht hätte, würde er die Zuweisung [bekommen]."
//
// Daraus folgen drei Regeln, und diese Datei hält sie auseinander:
//   · Wer erinnert und nervt  → `erinnererOf()`        (Arbeitsliste)
//   · Wem die Analyse zählt   → `gespraechsPersonOf()` (Tabs, Vergleich, /team)
//   · Achse der Datenbank     → `personOf()`           (RLS, RPCs) — unverändert
//
// Bauart wie arbeitslisteNeuerTermin.test.ts: Was eine reine Funktion
// entscheidet, wird als VERHALTEN geprüft; was eine Server Action oder eine
// Migration entscheidet, am QUELLTEXT — eine echte Probe bräuchte eine
// Datenbank.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { erinnererOf, gespraechsPersonIn, gespraechsPersonOf, personOf } from "@/lib/personResolution";
import { buildEvents, type WithCancellation } from "@/lib/termine";
import type { ClosingCall, SettingCall } from "@/lib/types";

function read(relative: string): string {
  // CRLF → LF, sonst finden Anker mit `\n` unter Windows nichts.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/** Die Datei OHNE Kommentare — für „das steht hier nicht (mehr)"-Prüfungen. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/^\s*--[^\n]*$/gm, "");
}

function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `Anker nicht gefunden: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `Endanker nicht gefunden: ${to}`);
  return source.slice(start, end);
}

const HEUTE = "2026-09-15";
const GESTERN = "2026-09-14T08:00:00.000Z";
const MORGEN = "2026-09-16T08:00:00.000Z";
const NAMEN = new Map([
  ["simon", "Simon"],
  ["kevin", "Kevin"],
  ["lisa", "Lisa"],
]);

/** Lisa hat gelegt, Kevin hat das Gespräch geführt. */
const ROW = { assigned_user_id: "lisa", created_by_user_id: "lisa", conducted_by_user_id: "kevin" };

/* ------------------------------------------------------------------ *
 * 1 — Wer erinnert und nervt
 * ------------------------------------------------------------------ */

describe("1 · erinnererOf — wer die Zeile abarbeitet", () => {
  test("No-Show und „Nicht qualifiziert\" bleiben beim, der gelegt hat", () => {
    // Der Kern der Rückmeldung: Auch wenn Kevin eingetragen ist, bleibt das
    // Nerven nach einem No-Show bei Lisa.
    for (const z of ["no_show", "nicht_qualifiziert", "offen", "verlegt"]) {
      assert.equal(erinnererOf(ROW, z), "lisa", z);
    }
  });

  test("nach einem stattgefundenen Gespräch ohne Ergebnis: wer es geführt hat", () => {
    assert.equal(erinnererOf(ROW, "show"), "kevin");
  });

  test("ohne Eintrag bleibt auch die Show beim, der gelegt hat", () => {
    assert.equal(erinnererOf({ ...ROW, conducted_by_user_id: null }, "show"), "lisa");
    // Zeilen aus Abfragen ohne die Spalte (vor 0042) — das Feld fehlt ganz.
    assert.equal(erinnererOf({ assigned_user_id: null, created_by_user_id: "lisa" }, "show"), "lisa");
  });
});

/* ------------------------------------------------------------------ *
 * 2 — Wem die Analyse zählt
 * ------------------------------------------------------------------ */

describe("2 · gespraechsPersonOf — wem die Analyse den Termin zurechnet", () => {
  test("wer geführt hat, schlägt die Zuweisung", () => {
    assert.equal(gespraechsPersonOf(ROW), "kevin");
    assert.equal(gespraechsPersonIn(ROW, new Set(["kevin"])), "kevin");
    assert.equal(gespraechsPersonIn(ROW, new Set(["lisa"])), null);
  });

  test("ohne Eintrag zählt, wer gelegt hat", () => {
    assert.equal(gespraechsPersonOf({ ...ROW, conducted_by_user_id: null }), "lisa");
    assert.equal(gespraechsPersonOf({ assigned_user_id: null, created_by_user_id: "lisa" }), "lisa");
  });

  test("personOf bleibt unverändert — sie ist wörtlich die SQL-Achse", () => {
    // `coalesce(assigned_user_id, created_by_user_id)` steht so in RLS,
    // `rpc_appointments_booked` und `recycle_tasks`. Eine Umdeutung hier wäre
    // eine zweite Wahrheit zwischen App und Datenbank.
    assert.equal(personOf(ROW), "lisa");
  });

  test("die Analyse-Tabs, der Vergleich und /team zählen danach", () => {
    for (const datei of [
      "src/components/analyse/tabs/UebersichtTab.tsx",
      "src/components/analyse/tabs/SettingTab.tsx",
      "src/components/analyse/tabs/ClosingTab.tsx",
      "src/components/analyse/tabs/FunnelTab.tsx",
      "src/lib/compare/facts.ts",
      "src/app/(dashboard)/team/page.tsx",
    ]) {
      const quelle = code(read(datei));
      assert.match(quelle, /gespraechsPerson(Of|In)\(/, datei);
      assert.doesNotMatch(quelle, /\bperson(Of|In)\(/, `${datei} zählt noch nach der Zuweisung`);
    }
    // „Termine gelegt" im LinkedIn-Tab ist Buchungs-Aktivität — gebucht hat,
    // wer gelegt hat. Er bleibt bewusst bei `personOf`.
    assert.match(code(read("src/components/analyse/tabs/LinkedInTab.tsx")), /\bpersonOf\(sc\)/);
  });

  test("die Analyse lädt die Spalte — auch das Team-Dashboard", () => {
    const analyse = read("src/lib/analyseData.ts");
    assert.match(slice(analyse, "const SETTING_COLUMNS =", ";"), /conducted_by_user_id/);
    assert.match(slice(analyse, "const CLOSING_COLUMNS =", ";"), /conducted_by_user_id/);
    assert.match(read("src/app/(dashboard)/team/page.tsx"), /conducted_by_user_id/);
  });
});

/* ------------------------------------------------------------------ *
 * 3 — Die Arbeitsliste folgt der Regel
 * ------------------------------------------------------------------ */

describe("3 · buildEvents — die Zeile landet in der richtigen Liste", () => {
  function setting(patch: Record<string, unknown>): WithCancellation<SettingCall> {
    return {
      id: "s1",
      status: "offen",
      show_status: null,
      appointment_at: null,
      lead_name: "Meier",
      company: null,
      meet_link: null,
      meeting_kind: null,
      phone: null,
      source_type: "linkedin",
      source_detail: null,
      ...ROW,
      ...patch,
    } as unknown as WithCancellation<SettingCall>;
  }

  function closing(patch: Record<string, unknown>): WithCancellation<ClosingCall> {
    return {
      id: "c1",
      status: "offen",
      show_status: null,
      call_at: null,
      lead_name: "Meier",
      company: null,
      meet_link: null,
      deal_volume: null,
      ...ROW,
      ...patch,
    } as unknown as WithCancellation<ClosingCall>;
  }

  function einzige(s: WithCancellation<SettingCall>[], c: WithCancellation<ClosingCall>[]) {
    const { events, ohneTermin } = buildEvents(s, c, NAMEN, HEUTE, null);
    const alle = [...events, ...ohneTermin];
    assert.equal(alle.length, 1);
    return alle[0];
  }

  test("No-Show → bei Lisa, und der Gesprächsname steht trotzdem dran", () => {
    const e = einzige([setting({ appointment_at: GESTERN, status: "no_show", show_status: "no_show" })], []);
    assert.equal(e.zustand, "no_show");
    assert.equal(e.assignee?.user_id, "lisa");
    assert.equal(e.conductedBy?.username, "Kevin");
  });

  test("erschienen, kein Ergebnis → bei Kevin", () => {
    const e = einzige([setting({ appointment_at: GESTERN, show_status: "show" })], []);
    assert.equal(e.zustand, "show");
    assert.equal(e.assignee?.user_id, "kevin");
  });

  test("Closing auf „Nachfassen\" nach dem Gespräch → wer es geführt hat", () => {
    const e = einzige([], [closing({ call_at: GESTERN, status: "nachfassen", show_status: "show" })]);
    assert.equal(e.zustand, "show");
    assert.equal(e.assignee?.user_id, "kevin");
  });

  test("ein stehender Termin wird von dem erinnert, der ihn gelegt hat", () => {
    const e = einzige([], [closing({ call_at: MORGEN, assigned_user_id: "simon" })]);
    assert.equal(e.zustand, "verlegt");
    assert.equal(e.assignee?.user_id, "simon");
  });

  test("ohne Eintrag bleibt „Durchgeführt von\" leer — nichts wird erraten", () => {
    const e = einzige([setting({ appointment_at: GESTERN, show_status: "show", conducted_by_user_id: null })], []);
    assert.equal(e.conductedBy, null);
    assert.equal(e.assignee?.user_id, "lisa");
  });

  test("die Datensicht lädt auch geführte Gespräche", () => {
    // Sonst stünde die Zeile in Kevins Liste, käme bei aktiver Datensicht auf
    // Kevin aber gar nicht erst aus der Datenbank.
    const page = read("src/app/(dashboard)/termine/page.tsx");
    assert.match(slice(page, "function personScope(", "\n}"), /conducted_by_user_id\.eq\.\$\{userId\}/);
    const analyse = read("src/lib/analyseData.ts");
    assert.match(slice(analyse, "function assignedOrCreatedBy(", "\n}"), /conducted_by_user_id\.eq\.\$\{userId\}/);
  });
});

/* ------------------------------------------------------------------ *
 * 4 — Beim Buchen: wer bucht, bekommt den Termin
 * ------------------------------------------------------------------ */

describe("4 · Buchen: die Zuweisung geht an den, der bucht", () => {
  const APPOINTMENTS = read("src/app/actions/appointments.ts");
  const BOOKING = slice(APPOINTMENTS, "async function assignedUserForBooking(", "\n}\n");

  test("der Buchende steht VOR dem Listen-Owner", () => {
    const bucher = BOOKING.indexOf("memberIds.has(access.user.id)");
    const owner = BOOKING.indexOf("ownerUserIdOfList(");
    assert.notEqual(bucher, -1);
    assert.notEqual(owner, -1);
    assert.ok(bucher < owner, "der Listen-Owner gewinnt wieder vor dem Buchenden");
  });

  test("beide Listen-Pfade benutzen die Regel, die alte gibt es nicht mehr", () => {
    assert.equal(APPOINTMENTS.split("await assignedUserForBooking(").length - 1, 2);
    assert.doesNotMatch(code(APPOINTMENTS), /assignedUserForList/);
  });
});

/* ------------------------------------------------------------------ *
 * 5 — Das Feld: leer, von jedem eintragbar, nur Mitglieder
 * ------------------------------------------------------------------ */

describe("5 · „Durchgeführt von\" eintragen", () => {
  const ASSIGNEES = read("src/app/actions/assignees.ts");
  const SET = ASSIGNEES.slice(ASSIGNEES.indexOf("export async function setConductedBy("));

  test("jedes Mitglied darf — anders als bei der Zuweisung", () => {
    assert.ok(SET.length > 0, "setConductedBy fehlt");
    assert.doesNotMatch(code(SET), /can_switch_view/);
    assert.match(SET, /belongsToWorkspace\(entity, entityId\)/);
  });

  test("eingetragen werden nur Mitglieder der aktiven Organisation", () => {
    assert.match(SET, /isMember\(supabase, access\.workspace_id, userId\)/);
    assert.match(SET, /\.update\(\{ conducted_by_user_id: userId \}\)/);
  });

  test("beide Editoren zeigen das Feld — außerhalb der Admin-Weiche", () => {
    for (const datei of ["src/components/scripts/SettingCallEditor.tsx", "src/components/closing/ClosingCallEditor.tsx"]) {
      const editor = read(datei);
      const feld = editor.indexOf('field="conducted"');
      const adminRueckfall = editor.indexOf('{assignedName ?? creatorName ?? "—"}');
      assert.notEqual(feld, -1, `${datei}: Feld fehlt`);
      assert.ok(feld > adminRueckfall, `${datei}: das Feld steckt in der Admin-Weiche`);
      assert.match(editor, /value=\{call\.conducted_by_user_id \?\? null\}/, datei);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 6 — Migration 0042
 * ------------------------------------------------------------------ */

describe("6 · Migration 0042", () => {
  const MIG = read("supabase/migrations/20260404000042_durchgefuehrt_von.sql");
  const SQL = code(MIG);

  test("die Spalte steht auf beiden Tabellen — ohne Default, ohne Backfill", () => {
    for (const t of ["setting_calls", "closing_calls"]) {
      assert.match(
        SQL,
        new RegExp(
          `alter table public\\.${t}\\s+add column if not exists conducted_by_user_id uuid references auth\\.users \\(id\\) on delete set null;`,
        ),
        t,
      );
    }
    assert.doesNotMatch(SQL, /\bdefault\b/i);
    assert.doesNotMatch(SQL, /^\s*update\s/im, "die Migration schreibt Zeilen");
  });

  test("der Guard hängt an INSERT, Setzen und Org-Umzug", () => {
    for (const t of ["setting_calls", "closing_calls"]) {
      assert.match(
        SQL,
        new RegExp(
          `create trigger ${t}_conducted_guard\\s+before insert or update of workspace_id, conducted_by_user_id on public\\.${t}`,
        ),
        t,
      );
    }
    assert.match(SQL, /new\.conducted_by_user_id := null;/);
  });

  test("RLS: wer geführt hat, sieht die Zeile — in USING und WITH CHECK", () => {
    for (const t of ["setting_calls", "closing_calls"]) {
      const policy = slice(SQL, `create policy "${t}_scoped_member"`, ");\n");
      assert.equal(
        policy.split(`${t}.conducted_by_user_id)`).length - 1,
        2,
        `${t}: der dritte Zweig fehlt in USING oder WITH CHECK`,
      );
      // Die beiden Zweige aus 0028 bleiben stehen.
      assert.equal(policy.split(`${t}.assigned_user_id)`).length - 1, 2, t);
      assert.equal(policy.split(`${t}.created_by_user_id)`).length - 1, 2, t);
    }
  });
});
