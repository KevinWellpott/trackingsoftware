// Migration 0041 — der Rückbau in der Datenbank: die drei Pflichtfeld-Trigger
// fallen, der Nachfass-Stempel kommt.
//
// Geprüft wird am DATEITEXT, dieselbe Bauart wie schreibpfadGrenzen.test.ts und
// recycleCadence.test.ts. Eine echte Probe bräuchte eine Datenbank; die steht
// im Verifikationsblock der Migration und gehört ins Runbook, nicht in eine
// Testsuite.
//
// Was ein Dateitext-Test hier wirklich leistet, ist an beiden Teilen ein
// anderer:
//   * Teil 1 ENTFERNT etwas. Der Fehler wäre, zu viel oder das Falsche zu
//     entfernen — deshalb der Abgleich gegen die eingefrorene 0035: gedroppt
//     werden genau ihre drei Trigger, ihre beiden Funktionen bleiben.
//   * Teil 2 FÜGT etwas hinzu. Der Fehler wäre eine zweite Konvention für
//     dieselbe Bedeutung — deshalb der Abgleich gegen 0033.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const MIGRATION_0041 = read("supabase/migrations/20260404000041_rueckbau_pflichtfelder_und_nachfass_stempel.sql");
const MIGRATION_0035 = read("supabase/migrations/20260404000035_pflichtfelder.sql");
const MIGRATION_0033 = read("supabase/migrations/20260404000033_lead_recycling.sql");
const MIGRATION_0032 = read("supabase/migrations/20260404000032_reminder_cascade.sql");

/**
 * Die Datei ohne Zeilenkommentare — alles unterhalb der Verifikations-
 * überschrift ist auskommentiert und darf beim Zählen von Anweisungen nicht
 * mitreden. Die Zeichenketten der beiden `comment on function` bleiben stehen;
 * sie enthalten das Wort CHECK in Großschreibung, weshalb unten überall
 * groß-/kleinschreibungsgenau gesucht wird.
 */
const STATEMENTS_0041 = MIGRATION_0041.replace(/--[^\n]*/g, "");

describe("Teil 1 — die drei Pflichtfeld-Trigger aus 0035 fallen", () => {
  test("gedroppt werden genau die Trigger, die 0035 angelegt hat — Name und Tabelle", () => {
    // Der Abgleich läuft gegen die eingefrorene Datei, nicht gegen eine Liste
    // im Kopf: Hätte 0035 einen vierten Trigger angelegt, fiele es hier auf,
    // und ein Tippfehler im Tabellennamen (drop auf der falschen Tabelle ist
    // schlicht folgenlos) ebenfalls.
    const angelegt = [
      ...MIGRATION_0035.matchAll(/create trigger (\w+)\s+before insert or update of [^\n]+ on public\.(\w+)/g),
    ].map((m) => `${m[1]}@${m[2]}`);
    assert.equal(angelegt.length, 3);

    const gedroppt = [...MIGRATION_0041.matchAll(/drop trigger if exists (\w+) on public\.(\w+);/g)].map(
      (m) => `${m[1]}@${m[2]}`,
    );
    assert.deepEqual(new Set(gedroppt), new Set(angelegt));
  });

  test("die beiden Triggerfunktionen bleiben stehen — kein drop, kein Neuschreiben", () => {
    // Die getroffene Entscheidung, und sie ist der teure Teil: In den Funktionen
    // steckt nicht die Regel, sondern die Bauart, mit der sie Bestandszeilen
    // verschont (OLD/NEW-Vergleich, geschachtelte IFs statt `or`). Wer sie
    // löscht, leitet das beim Wiederanhängen neu her — und baut vermutlich den
    // CHECK-Constraint nach, den 0035 ausdrücklich vermieden hat.
    assert.doesNotMatch(STATEMENTS_0041, /drop function/i);
    assert.doesNotMatch(STATEMENTS_0041, /create or replace function/i);
    for (const name of ["require_cancel_reason", "require_disqualify_reason"] as const) {
      // Stattdessen: ein Vermerk, damit niemand rätselt, warum die Funktion
      // ohne Trigger dasteht. Er ist zugleich der Nachweis im Verifikations-
      // block, dass die Datei ganz durchgelaufen ist und nicht nur bis zu den
      // drei Drops (Teil-Ausführung im Editor, docs §7).
      assert.match(STATEMENTS_0041, new RegExp(`comment on function public\\.${name} \\(\\) is`), name);
    }
    assert.match(STATEMENTS_0041, /STILLGELEGT mit 0041/);
  });

  test("der Vermerk wird nur gesetzt, wenn die Funktion überhaupt da ist", () => {
    // `comment on function` auf eine fehlende Funktion wirft — und ein Abbruch
    // mitten in der Datei rollt in der Supabase-Konsole alles davor zurück
    // (docs §7). Genau deshalb steht er hinter einer Existenzprüfung: Die Datei
    // muss auch auf einer Datenbank durchlaufen, auf der 0035 nie lief.
    assert.match(STATEMENTS_0041, /to_regprocedure\('public\.require_cancel_reason\(\)'\) is not null/);
    assert.match(STATEMENTS_0041, /to_regprocedure\('public\.require_disqualify_reason\(\)'\) is not null/);
  });

  test("0035 selbst bleibt unangetastet — sie ist eingespielt und eingefroren", () => {
    assert.match(MIGRATION_0035, /DIESE MIGRATION IST EINGESPIELT UND DAMIT EINGEFROREN/);
    assert.equal((MIGRATION_0035.match(/create trigger /g) ?? []).length, 3);
  });

  test("entfernt wird der Trigger, nicht die Regel darunter", () => {
    // Der Paar-CHECK aus 0032 (`cancelled_at` und `cancel_outlook` sind ein
    // Paar) bleibt stehen. Er ist im Verifikationsblock die Gegenprobe, die
    // beweist, dass die Absage-Statements die Tabelle wirklich erreichen — ohne
    // ihn sähe „läuft durch" genauso aus wie „lief an der Tabelle vorbei".
    assert.doesNotMatch(STATEMENTS_0041, /drop constraint/i);
    assert.match(MIGRATION_0041, /setting_calls_cancelled_pair_chk/);
    assert.match(MIGRATION_0032, /constraint setting_calls_cancelled_pair_chk/);
  });

  test("kein Backfill: erfasste Gründe werden nicht nachträglich geleert", () => {
    // „Tabellen bleiben stehen" gilt auch für Zeileninhalte. Ein Grund, der
    // einmal erfasst wurde, ist erhobene Information — ihn wegzuräumen wäre
    // teurer als ihn stehenzulassen, und rückgängig zu machen wäre er nicht.
    assert.doesNotMatch(STATEMENTS_0041, /^\s*(insert into|update |delete from)/im);
  });
});

describe("Teil 2 — der Nachfass-Stempel folgt der Konvention aus 0033", () => {
  const SPALTEN = ["follow_up_last_contacted_at", "follow_up_last_contacted_by_user_id"] as const;

  test("beide Termin-Tabellen bekommen beide Spalten, additiv und wiederholbar", () => {
    for (const table of ["setting_calls", "closing_calls"] as const) {
      const block = STATEMENTS_0041.slice(
        STATEMENTS_0041.indexOf(`alter table public.${table}`),
        STATEMENTS_0041.indexOf(";", STATEMENTS_0041.indexOf(`alter table public.${table}`)),
      );
      for (const spalte of SPALTEN) {
        assert.match(block, new RegExp(`add column if not exists ${spalte}\\s`), `${table}.${spalte}`);
      }
    }
    // Vier Spalten, kein `add column` ohne `if not exists`: Die Datei muss
    // beliebig oft laufen dürfen.
    assert.equal((STATEMENTS_0041.match(/add column if not exists/g) ?? []).length, 4);
    assert.equal((STATEMENTS_0041.match(/add column/g) ?? []).length, 4);
  });

  test("Typ und Nullability sind wörtlich die von recycle_last_contacted_at", () => {
    // Zwei Felder derselben Bedeutung mit verschiedenen Konventionen wären ein
    // Fehler — und die beiden leben im Rückbau nebeneinander weiter: das
    // Recycling für die toten Enden, der Stempel für die offenen Vorgänge.
    assert.match(MIGRATION_0033, /add column if not exists recycle_last_contacted_at timestamptz\s*,/);
    const stempel = [...STATEMENTS_0041.matchAll(/add column if not exists follow_up_last_contacted_at\s+(\w+)/g)];
    assert.equal(stempel.length, 2);
    for (const treffer of stempel) assert.equal(treffer[1], "timestamptz");

    // Nullable und ohne Default — beides steht dadurch da, dass NICHTS
    // dahintersteht. Ein Default `now()` behauptete für jeden Bestandstermin,
    // er sei heute nachgefasst worden: Die Liste wäre am ersten Tag abgehakt.
    assert.doesNotMatch(STATEMENTS_0041, /follow_up_last_contacted_at\s+timestamptz\s+not null/i);
    assert.doesNotMatch(STATEMENTS_0041, /follow_up_last_contacted_at\s+timestamptz\s+default/i);
  });

  test("die Wer-Spalte hängt per `on delete set null` an auth.users", () => {
    // Dasselbe Muster wie reminder_touches.done_by_user_id (0032) und
    // assigned_user_id (0028): Das Löschen eines Nutzers darf weder scheitern
    // (`not null`) noch die Zeile mitnehmen (`on delete cascade`) — der Termin
    // bleibt, der Zeitstempel bleibt, nur der Name verschwindet.
    const treffer = [
      ...STATEMENTS_0041.matchAll(
        /add column if not exists follow_up_last_contacted_by_user_id\s+uuid references auth\.users \(id\) on delete set null/g,
      ),
    ];
    assert.equal(treffer.length, 2);
    assert.doesNotMatch(STATEMENTS_0041, /follow_up_last_contacted_by_user_id[^\n]*on delete cascade/i);
  });

  test("KEIN Paar-CHECK zwischen Zeitstempel und Person — die Falle aus 0032", () => {
    // reminder_touches trägt `check ((done_at is null) = (done_by_user_id is
    // null))` UND `on delete set null` auf derselben Spalte. Die beiden
    // widersprechen einander: Wird ein Nutzer gelöscht, nullt der Fremdschlüssel
    // die Spalte, und genau dieses UPDATE verletzt den CHECK. Hier wird die
    // Paarung deshalb nicht wiederholt; „Zeitstempel ohne Person" ist ein
    // zulässiger und wahrer Zustand („wurde nachgefasst, der Kollege ist weg").
    assert.doesNotMatch(STATEMENTS_0041, /check \([^)]*follow_up_last_contacted/);
    assert.doesNotMatch(STATEMENTS_0041, /add constraint/i);
    // Gegenprobe, dass die Falle real ist und nicht behauptet: 0032 hat beides.
    assert.match(MIGRATION_0032, /done_by_user_id uuid references auth\.users \(id\) on delete set null/);
    assert.match(MIGRATION_0032, /check \(\(done_at is null\) = \(done_by_user_id is null\)\)/);
  });

  test("kein Index auf einer Spalte, nach der nichts filtert", () => {
    // Das Recycling hat einen (`idx_*_next_recycle`), weil next_recycle_at eine
    // FÄLLIGKEIT ist, nach der die RPC filtert. Der Stempel wird geschrieben und
    // angezeigt, nicht gefiltert — und ausgerechnet geschrieben wird er oft.
    assert.doesNotMatch(STATEMENTS_0041, /create index/i);
    assert.match(MIGRATION_0033, /create index if not exists %I on public\.%I \(workspace_id, next_recycle_at\)/);
  });

  test("beide Spalten sind kommentiert, und die Person als AUDIT-Feld markiert", () => {
    // docs §2: `created_by_user_id` = Audit („wer hat geklickt"),
    // `assigned_user_id` = Fachlichkeit („wem gehört der Termin"). Der Stempler
    // gehört auf die Audit-Seite; keine Auswertung darf ihn als Personenachse
    // benutzen, sonst schreibt eine Datensicht die Zahlen des Kollegen um.
    for (const table of ["setting_calls", "closing_calls"] as const) {
      for (const spalte of SPALTEN) {
        assert.match(STATEMENTS_0041, new RegExp(`comment on column public\\.${table}\\.${spalte} is`), `${table}.${spalte}`);
      }
    }
    assert.match(STATEMENTS_0041, /AUDIT-Feld/);
  });

  test("die neuen Spalten werden PostgREST bekannt gemacht", () => {
    // Ohne das Signal antwortet die API mit PGRST204 („column ... does not
    // exist"), bis der Schema-Cache von selbst nachzieht — und die neue
    // Arbeitsliste könnte ihren einzigen Knopf nicht speichern.
    assert.match(STATEMENTS_0041, /notify pgrst, 'reload schema';/);
  });
});

describe("Aufbau der Datei — Reihenfolge, Wiederholbarkeit, Verifikation", () => {
  test("Teil 1 steht vor Teil 2", () => {
    // Nicht Geschmack: Ein Abbruch im harmlosen Teil 2 (etwa an der
    // Vorbedingung 0033) darf den dringenden Teil 1 nicht mit sich ziehen. Die
    // Supabase-Konsole führt bei markiertem Text nur die Markierung aus und
    // hinterlässt Halbzustände (docs §7).
    const teil1 = MIGRATION_0041.indexOf("drop trigger if exists setting_calls_require_cancel_reason");
    const teil2 = MIGRATION_0041.indexOf("alter table public.setting_calls");
    assert.ok(teil1 > 0 && teil2 > 0);
    assert.ok(teil1 < teil2, "Teil 1 muss vor Teil 2 stehen");
  });

  test("der Kopf sagt, wann eingespielt werden darf — und dass Teil 1 nicht warten kann", () => {
    // Der gefährlichste Punkt des Rückbaus ist einseitig: zu früh kostet
    // nichts, zu spät zerbricht jede Absage und jede Disqualifizierung an einer
    // DB-Exception, beim nächsten Klick und für alle.
    assert.match(MIGRATION_0041, /VOR dem Deploy der neuen Oberfläche/);
    assert.match(MIGRATION_0041, /TEIL 2[^\n]*jederzeit/);
  });

  test("Teil 2 prüft seine Vorbedingung, statt eine halbe Konvention anzulegen", () => {
    assert.match(STATEMENTS_0041, /0041 Teil 2 setzt Migration 0033 voraus/);
  });

  test("die Datei fasst keine Tabelle strukturell an außer den zwei ADD COLUMN", () => {
    assert.doesNotMatch(STATEMENTS_0041, /drop table/i);
    assert.doesNotMatch(STATEMENTS_0041, /drop column/i);
    assert.doesNotMatch(STATEMENTS_0041, /create table/i);
    assert.doesNotMatch(STATEMENTS_0041, /create trigger/i);
    assert.equal((STATEMENTS_0041.match(/drop trigger if exists/g) ?? []).length, 3);
    assert.equal((STATEMENTS_0041.match(/alter table/g) ?? []).length, 2);
  });

  test("der Verifikationsblock hat die Falle aus 0037 nicht", () => {
    // 0037 prüfte zwei Aufrufe, die im SQL-Editor BEIDE scheitern mussten
    // (auth.uid() ist dort NULL) — beide Seiten scheiterten, das sah wie ein
    // bestandener Test aus und bewies nichts. Hier hat dieselbe Falle eine
    // andere Gestalt: Die Datei NIMMT etwas weg, und ein UPDATE, dessen WHERE
    // nichts trifft, „läuft" genauso durch wie eines, das den entfernten
    // Trigger passiert hat.
    assert.match(MIGRATION_0041, /Verifikationsblock von 0037/);

    // Die Abhilfe, und sie muss in jeder dynamischen Probe stehen: `returning`
    // plus die ausdrückliche Ansage, dass eine leere Antwort KEIN bestandener
    // Test ist.
    assert.match(MIGRATION_0041, /KEINE Zeile ist KEIN bestandener Test/);
    const proben = MIGRATION_0041.match(/^--\s+update public\.\w+$/gm) ?? [];
    assert.ok(proben.length >= 4, `zu wenige dynamische Proben: ${proben.length}`);
    assert.ok(
      (MIGRATION_0041.match(/returning/g) ?? []).length >= proben.length - 1,
      "jede dynamische Probe braucht ein returning",
    );

    // Und zu jeder Probe eine Gegenprobe, die weiterhin scheitern bzw.
    // weiterhin etwas finden muss — erst beide zusammen beweisen etwas.
    for (const anker of [
      /A2\) DIE GEGENPROBE, ohne die A1 nichts beweist/,
      /A4\) DIE GEGENPROBE ZU A3/,
      /B4\) DIE GEGENPROBE ZU B1-B3/,
    ]) {
      assert.match(MIGRATION_0041, anker);
    }
  });
});
