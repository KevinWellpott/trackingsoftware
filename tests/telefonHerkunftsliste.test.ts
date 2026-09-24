// Unteransichten einer Importliste (Migration 0044):
//
// Rückruf, Nicht erreicht und Kein Termin verschieben einen Lead physisch in
// die gemeinsame Routing-Liste des Inhabers. Die Importliste fragte nur nach
// `list_id` und zeigte deshalb in genau diesen drei Unteransichten nie etwas —
// nur Termin und Dead, die in der Liste liegen bleiben.
//
// Bauart wie telefonKeinTerminUndAutoTot.test.ts: Verdrahtung am QUELLTEXT.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const MIGRATION = read("supabase/migrations/20260404000044_telefon_herkunftsliste.sql");
const LIST_PAGE = read("src/app/(dashboard)/telefon/[listId]/page.tsx");
const OVERVIEW = read("src/app/(dashboard)/telefon/page.tsx");
const ACTION = read("src/app/actions/phone.ts");
const RUNNER = read("src/components/telefon/CallModeRunner.tsx");

describe("Migration 0044 hält die Herkunft am Lead fest", () => {
  test("Spalte mit FK auf phone_lists, beim Löschen der Liste genullt", () => {
    assert.match(MIGRATION, /add column if not exists origin_list_id uuid\s+references public\.phone_lists \(id\) on delete set null/);
  });

  test("der Trigger greift beim Anlegen UND beim Umzug", () => {
    assert.match(MIGRATION, /before insert or update of list_id on public\.phone_leads/);
    // Beim Umzug zählt die ALTE Liste — die neue ist ja die Routing-Liste.
    assert.match(MIGRATION, /where l\.id = old\.list_id and l\.list_kind = 'akquise'/);
    // Einmal gesetzt, bleibt sie: sonst verlöre ein Lead, der von „Nicht
    // erreicht" weiter nach „Rückruf" wandert, seine Importliste.
    assert.match(MIGRATION, /if new\.origin_list_id is not null then\s+return new;/);
  });

  test("die App schreibt die Spalte nie — ein Deploy vor 0044 bricht nichts", () => {
    assert.ok(!/origin_list_id/.test(ACTION), "phone.ts schreibt origin_list_id");
  });
});

describe("Die Importliste zeigt ihre abgewanderten Leads", () => {
  test("Akquise-Listen laden über list_id ODER origin_list_id", () => {
    assert.match(LIST_PAGE, /q\.or\(`list_id\.eq\.\$\{listId\},origin_list_id\.eq\.\$\{listId\}`\)/);
    assert.match(LIST_PAGE, /list\.list_kind === "akquise" \? loadLeads\(true\)/);
  });

  test("ohne Migration 0044 fällt die Seite auf list_id zurück statt leer zu bleiben", () => {
    assert.match(LIST_PAGE, /loadLeads\(true\)\.catch\(\(\) => loadLeads\(false\)\)/);
  });

  test("Aktionen laufen über die list_id DES LEADS, nicht über die Seite", () => {
    // Sonst liefe ein Update auf einen abgewanderten Lead mit der falschen
    // Liste ins Leere (`.eq("list_id", listId)` in updatePhoneLead).
    assert.match(RUNNER, /updatePhoneLead\(id, lead\?\.list_id \?\? "", savePatch\)/);
    assert.match(RUNNER, /const listId = current\.list_id;/);
  });
});

describe("Die Karten auf /telefon zählen die abgewanderten Leads mit", () => {
  test("eigene RPC, und die Gesamtzahl zählt sie nicht doppelt", () => {
    assert.match(OVERVIEW, /supabase\.rpc\("rpc_phone_origin_counts"/);
    const originLoop = OVERVIEW.slice(OVERVIEW.indexOf("originRows ?? []"));
    assert.ok(!/totalLeads \+=/.test(originLoop.slice(0, 400)), "abgewanderte Leads landen in totalLeads");
  });

  test("die RPC zählt nur Leads außerhalb ihrer Herkunftsliste", () => {
    assert.match(MIGRATION, /and pl\.origin_list_id <> pl\.list_id/);
  });
});
