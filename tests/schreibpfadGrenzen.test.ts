// Die drei Schreibpfade, an denen die Mandantengrenze nicht zu Ende gezogen
// war (Migration 0040).
//
// Geprüft wird am QUELLTEXT — dieselbe Bauart wie recycleCadence.test.ts und
// lifecycleWiring.test.ts. Eine echte Probe bräuchte eine Datenbank mit zwei
// Organisationen und drei Sitzungen; eine Attrappe bewiese nur, dass die
// Attrappe stimmt. Was ein Quelltext-Test dagegen wirklich leistet: Er hält
// fest, dass eine Prüfung NICHT WIEDER VERSCHWINDET. Genau das ist die
// Fehlerklasse hier — keine dieser drei Lücken hat je einen Fehler ausgelöst,
// sie waren alle drei einfach nicht da.
//
// Die echten Proben stehen im Verifikationsblock von 0040 und gehören ins
// Deploy-Runbook, nicht in eine Testsuite.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/** Der Rumpf einer Funktion — von ihrer Signatur bis zum Grant dahinter. */
function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `Anker nicht gefunden: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `Endanker nicht gefunden: ${to}`);
  return source.slice(start, end);
}

const MIGRATION_0040 = read("supabase/migrations/20260404000040_schreibpfad_mandantengrenzen.sql");
const MIGRATION_0028 = read("supabase/migrations/20260404000028_fundament.sql");
const RECYCLE = read("src/app/actions/recycle.ts");

const SCHEDULE = slice(
  MIGRATION_0040,
  "create or replace function public.schedule_recycle",
  "grant execute on function public.schedule_recycle",
);
const ATTEMPT = slice(
  MIGRATION_0040,
  "create or replace function public.recycle_attempt",
  "grant execute on function public.recycle_attempt",
);

describe("Befund 1 — die schreibenden Recycling-RPCs prüfen den Besitz", () => {
  test("beide Funktionen tragen Mitgliedschafts- UND Besitzprüfung", () => {
    // Die Mitgliedschaft kommt aus 0037 und darf beim Neuschreiben des Rumpfes
    // nicht verlorengehen — sie beantwortet die andere Hälfte der Frage.
    for (const [name, body] of [
      ["schedule_recycle", SCHEDULE],
      ["recycle_attempt", ATTEMPT],
    ] as const) {
      assert.match(body, /Kein Zugriff auf diese Organisation/, name);
      assert.match(body, /nur der eigene Lead wiedervorlegen/, name);
    }
  });

  test("der Besitz folgt der Regel aus docs §2 — je Ursprung die richtige Achse", () => {
    // Listen-Ursprünge über list_owned_by_user() (owner_name hat Vorrang),
    // Termine über coalesce(assigned_user_id, created_by_user_id). Wörtlich
    // dieselben Prädikate benutzt recycle_tasks() für seinen Personenfilter —
    // nur deshalb kann die Prüfung keine Aufgabe blockieren, die die
    // Oberfläche jemandem anzeigt.
    for (const [name, body] of [
      ["schedule_recycle", SCHEDULE],
      ["recycle_attempt", ATTEMPT],
    ] as const) {
      assert.match(body, /public\.list_owned_by_user\(l\.owner_name, l\.created_by_user_id, auth\.uid\(\)\)/, name);
      assert.match(
        body,
        /public\.list_owned_by_user\(pll\.owner_name, pll\.created_by_user_id, auth\.uid\(\)\)/,
        name,
      );
      assert.match(body, /coalesce\(sc\.assigned_user_id, sc\.created_by_user_id\) = auth\.uid\(\)/, name);
      assert.match(body, /coalesce\(cc\.assigned_user_id, cc\.created_by_user_id\) = auth\.uid\(\)/, name);
    }
  });

  test("eingeschränkt wird NUR bei data_scope='own'", () => {
    // Ein Owner mit Team-Sicht darf jede Zeile seiner Organisation anfassen,
    // und ein Plattform-Admin hat dort gar keine Mitgliedschaft und damit kein
    // data_scope — ohne diesen Zweig wäre der Org-Umschalter hier tot.
    for (const [name, body] of [
      ["schedule_recycle", SCHEDULE],
      ["recycle_attempt", ATTEMPT],
    ] as const) {
      assert.match(body, /if v_scope = 'own' then/, name);
    }
  });

  test("beide Blöcke sind wortgleich — sie stehen inline statt in einem Helfer", () => {
    // Der Preis für „kein neuer security-definer-Helfer" (der entweder ein
    // Besitz-Orakel für jeden Angemeldeten wäre oder am Eigentümer seiner
    // Aufrufer hinge) ist Verdopplung. Diese Prüfung ist der Ersatz für den
    // Helfer: Läuft einer der beiden Blöcke davon, fällt es hier auf.
    const extract = (body: string) => {
      const from = body.indexOf("v_owned := case p_origin");
      const to = body.indexOf("end;", from);
      assert.ok(from !== -1 && to !== -1, "Besitzblock nicht gefunden");
      return body.slice(from, to).replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
    };
    assert.equal(extract(SCHEDULE), extract(ATTEMPT));
  });

  test("die App stellt jeder schreibenden Aktion dieselbe Vorprüfung voran", () => {
    // canAccessRecycleRow() fragt über den NUTZER-Client, läuft also durch die
    // RLS — das ist die Besitzprüfung auf der App-Seite. scheduleRecycle war
    // als einzige der vier ohne sie unterwegs.
    const scheduleAction = slice(
      RECYCLE,
      "export async function scheduleRecycle(",
      "async function updateRecycleRow(",
    );
    assert.match(scheduleAction, /canAccessRecycleRow\(access, origin, entityId\)/);

    // Gegenprobe an den drei Geschwistern: Sie laufen weiterhin darüber.
    assert.match(RECYCLE, /export async function markRecycleContacted\([\s\S]{0,600}canAccessRecycleRow/);
    assert.match(RECYCLE, /async function updateRecycleRow\([\s\S]{0,600}canAccessRecycleRow/);
  });

  test("beide RPC-Aufrufe schicken p_today explizit mit", () => {
    // Ein ausgelassener Parameter mit Vorgabewert zwingt PostgREST zur
    // Funktionsauflösung; scheitert die, kommt PGRST202 — und das übersetzte
    // der Fehlerpfad in „Migration 0033 fehlt", eine frei erfundene Ursache.
    assert.match(RECYCLE, /rpc\("schedule_recycle", \{[\s\S]{0,300}p_today: todayBerlin\(\)/);
    assert.match(RECYCLE, /rpc\("recycle_attempt", \{[\s\S]{0,300}p_today: todayBerlin\(\)/);
    // Und zwar der Berliner Kalendertag, nicht new Date(): auf Vercel läuft
    // der Server in UTC und läge abends einen Tag daneben (docs §6).
    assert.match(RECYCLE, /function todayBerlin\(\): string \{\s*return berlinDateISO\(/);
  });

  test("die Unverfügbarkeits-Meldung behauptet keine Ursache mehr", () => {
    assert.doesNotMatch(RECYCLE, /Recycling ist nicht verfügbar — Migration 0033 fehlt/);
    assert.match(RECYCLE, /RECYCLE_UNAVAILABLE/);
  });
});

describe("Befund 2 — seed_workspace_defaults steht nicht mehr jedem Konto offen", () => {
  test("das Ausführungsrecht wird PUBLIC entzogen, nicht nur `authenticated`", () => {
    // PostgreSQL grantet EXECUTE auf eine neue Funktion per Vorgabe an PUBLIC.
    // Ein revoke nur von `authenticated` nähme den expliziten Eintrag aus 0034
    // weg — über PUBLIC dürfte dieselbe Rolle weiter aufrufen, und `anon` dazu.
    assert.match(MIGRATION_0040, /revoke all on function public\.seed_workspace_defaults \(uuid\) from public;/);
    assert.match(
      MIGRATION_0040,
      /revoke all on function public\.seed_workspace_defaults \(uuid\) from authenticated;/,
    );
  });

  test("der Seeding-Trigger wird nicht angetastet — er braucht den Grant nicht", () => {
    // Er ruft die Funktion aus einer `security definer`-Triggerfunktion heraus
    // auf; dort ist der aktuelle Benutzer ihr Eigentümer, und der besitzt das
    // Ausführungsrecht implizit. Legte 0040 den Trigger neu an oder änderte
    // sie ihn, wäre genau das die Stelle, an der eine neue Organisation
    // stillschweigend ohne Kaskaden entstünde.
    assert.doesNotMatch(MIGRATION_0040, /create trigger workspaces_seed_defaults/);
    assert.doesNotMatch(MIGRATION_0040, /create or replace function public\.workspaces_seed_defaults/);
    // Stattdessen: eine Pflicht-Probe im Verifikationsblock.
    assert.match(MIGRATION_0040, /ZZZ 0040 Grant-Probe/);
  });
});

describe("Befund 3 — der Zuweisungs-Wächter hängt jetzt auch am INSERT und am reinen Zuweisungs-UPDATE", () => {
  test("beide Termin-Tabellen bekommen einen INSERT-Trigger auf dieselbe Funktion", () => {
    for (const table of ["setting_calls", "closing_calls"] as const) {
      assert.match(
        MIGRATION_0040,
        new RegExp(
          `create trigger ${table}_assigned_guard_ins\\s+before insert on public\\.${table}\\s+for each row execute function public\\.assigned_user_guard \\(\\);`,
        ),
        table,
      );
      // Eigener Name mit Suffix `_ins`, damit der UPDATE-Trigger aus 0028
      // stehenbleibt (Muster reminder_touches_ws_guard_ins, 0039).
      assert.match(MIGRATION_0040, new RegExp(`drop trigger if exists ${table}_assigned_guard_ins`), table);
    }
  });

  test("der UPDATE-Trigger horcht auf zwei Spalten, nicht mehr nur auf workspace_id", () => {
    // Der zweite, leisere Weg zur heimatlosen Zeile: ein PATCH, der NUR
    // `assigned_user_id` setzt. Der Trigger aus 0028 hing an `update of
    // workspace_id` und feuerte dabei gar nicht. Fällt `assigned_user_id` aus
    // der Spaltenliste, steht diese Lücke wieder offen — und zwar lautlos, weil
    // der Trigger dann immer noch existiert und beim Nutzer-Umzug greift.
    for (const table of ["setting_calls", "closing_calls"] as const) {
      assert.match(
        MIGRATION_0040,
        new RegExp(
          `create trigger ${table}_assigned_guard\\s+before update of workspace_id, assigned_user_id on public\\.${table}\\s+for each row execute function public\\.assigned_user_guard \\(\\);`,
        ),
        table,
      );
    }
    // Gegenprobe: 0028 trägt weiterhin die engere Spaltenliste. 0040 ersetzt
    // ihren Trigger unter DEMSELBEN Namen — nur deshalb bleibt die eingefrorene
    // Datei unangetastet, ohne dass ein zweiter Trigger danebensteht.
    assert.match(MIGRATION_0028, /before update of workspace_id on public\.setting_calls/);
    assert.doesNotMatch(MIGRATION_0028, /before update of workspace_id, assigned_user_id/);
  });

  test("die Triggerfunktion aus 0028 bleibt unangetastet und kennt kein OLD", () => {
    // Der INSERT-Fall ist nur deshalb ungefährlich: Die Funktion liest
    // ausschließlich `new`. Ein Zugriff auf `OLD` wäre bei einem INSERT ein
    // Laufzeitfehler und hätte jedes Anlegen eines Termins zerbrochen.
    const guard = slice(
      MIGRATION_0028,
      "create or replace function public.assigned_user_guard ()",
      "drop trigger if exists setting_calls_assigned_guard",
    );
    assert.match(guard, /new\.assigned_user_id/);
    assert.doesNotMatch(guard, /\bold\b/i);
    assert.doesNotMatch(MIGRATION_0040, /create or replace function public\.assigned_user_guard/);
  });
});

describe("0040 ist wiederholbar und fasst keine Tabelle an", () => {
  test("keine DDL auf Spalten, kein Backfill", () => {
    // Die Datei darf beliebig oft laufen: Die Supabase-Konsole führt bei
    // markiertem Text nur die Markierung aus und hinterlässt Halbzustände
    // (docs §7) — ein zweiter Durchlauf muss folgenlos sein.
    //
    // Gemessen wird auf STATEMENT-Ebene: Funktionsrümpfe (zwischen `as $$` und
    // `$$;`) und Kommentare fallen vorher heraus. Sonst schlüge das `update
    // public.%I` INNERHALB von recycle_attempt an — das ist der Zweck der
    // Funktion, nicht eine Datenbewegung der Migration.
    const statements = MIGRATION_0040.replace(/as \$\$[\s\S]*?\$\$;/g, "as $$ … $$;").replace(/--[^\n]*/g, "");
    assert.doesNotMatch(statements, /alter table/i);
    assert.doesNotMatch(statements, /^\s*(insert into|update |delete from)/im);
    assert.doesNotMatch(statements, /drop function/i);
    // Was die Datei stattdessen tut, und zwar ausschließlich: zwei Funktionen
    // neu schreiben und VIER Trigger hängen — je Tabelle einer am INSERT und
    // einer am UPDATE. Die beiden UPDATE-Trigger tragen die Namen aus 0028 und
    // ersetzen sie unter demselben Namen; die eingefrorene Datei 0028 bleibt
    // dabei unangetastet (siehe Befund 3).
    assert.equal((statements.match(/create or replace function/g) ?? []).length, 2);
    assert.equal((statements.match(/drop trigger if exists/g) ?? []).length, 4);
    assert.equal((statements.match(/create trigger/g) ?? []).length, 4);
  });

  test("jedem `create trigger` geht sein eigenes `drop trigger if exists` voraus", () => {
    // Der eigentliche Grund für die Zählung darüber: Ein `create trigger` ohne
    // vorangestelltes `drop` scheitert beim zweiten Durchlauf mit „trigger
    // already exists" — und ein Abbruch mitten in der Datei rollt in der
    // Supabase-Konsole alles davor zurück (docs §7). Namen statt Anzahlen zu
    // vergleichen fängt zusätzlich den Fall ab, dass beide Zahlen stimmen, ein
    // `drop` aber auf den falschen Trigger zeigt.
    const created = [...MIGRATION_0040.matchAll(/create trigger (\w+)/g)].map((m) => m[1]);
    const dropped = new Set([...MIGRATION_0040.matchAll(/drop trigger if exists (\w+)/g)].map((m) => m[1]));
    assert.equal(created.length, 4);
    for (const name of created) assert.ok(dropped.has(name), `ohne drop: ${name}`);
  });

  test("die Signaturen beider RPCs bleiben byte-gleich zu 0033/0037", () => {
    // Nur so genügt `create or replace`; ein `drop function` nähme die Grants
    // einer produktiv aufgerufenen Funktion mit.
    for (const name of ["schedule_recycle", "recycle_attempt"] as const) {
      assert.match(
        MIGRATION_0040,
        new RegExp(
          `create or replace function public\\.${name} \\(\\s*p_workspace_id uuid,\\s*p_origin\\s+text,\\s*p_entity_id\\s+uuid,\\s*p_today\\s+date default \\(now\\(\\) at time zone 'Europe/Berlin'\\)::date\\s*\\)`,
        ),
        name,
      );
    }
  });
});
