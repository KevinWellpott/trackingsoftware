// Lead-Dossier: zwei Stellen, an denen die Akte etwas BEHAUPTET, das sie nicht
// weiß.
//
// 1. Ein gescheiterter Abruf (Netz, Zeitüberschreitung, Zugriffsrecht) meldet
//    `available: true` samt Fehlertext — die Oberfläche machte daraus die
//    definitive Aussage „Kein Lead unter dieser Adresse". Aus einer
//    abgerissenen Verbindung wurde so die Behauptung, den Menschen gebe es
//    nicht. Genau die Verwechslung, die dieses Projekt sonst überall trennt
//    („leer" gegen „nicht verfügbar", docs §5.1).
//
// 2. „Steht an" führte jedes gesetzte Follow-up-Datum als offene Aufgabe —
//    auch für Kontakte, die geantwortet haben, einen Termin haben, uns
//    blockiert haben oder mit FU3 durch sind. `/nachfassen` listet genau die
//    nicht. Wer der Akte glaubt, fasst gegen eine laufende Unterhaltung nach.
//
// Der Kern des Dossiers bleibt dabei unberührt: Vermutetes zählt weiterhin
// nirgends mit (docs §5.3) — die Gegenprobe dazu steht in leadDossier.test.ts.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  buildDossier,
  dossierEmptyKind,
  type DossierContact,
  type DossierInput,
} from "@/lib/leadDossier";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; mehrere Anker unten tragen ein `\n`.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/** Der Rumpf einer Funktion — von ihrer Signatur bis zum nächsten Anker. */
function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `Anker nicht gefunden: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `Endanker nicht gefunden: ${to}`);
  return source.slice(start, end);
}

const PANEL = read("src/components/lead/LeadDossierPanel.tsx");
const SHEET = read("src/components/lead/LeadDossierSheet.tsx");
const ACTION = read("src/app/actions/leadDossier.ts");

/* ------------------------------------------------------------------ *
 * A — der dritte Leerzustand
 * ------------------------------------------------------------------ */

describe("Ein Ladefehler ist keine Auskunft über den Lead", () => {
  test("die drei Fälle werden auseinandergehalten", () => {
    // Fehlendes Schema trifft JEDEN Lead, ein Ladefehler KEINEN — und nur der
    // dritte Fall ist eine Aussage über diese eine Zeile.
    assert.equal(dossierEmptyKind(false), "missing_schema");
    assert.equal(dossierEmptyKind(false, "Spalte fehlt"), "missing_schema");
    assert.equal(dossierEmptyKind(true, "Verbindung abgebrochen"), "load_failed");
    assert.equal(dossierEmptyKind(true), "not_found");
    assert.equal(dossierEmptyKind(true, null), "not_found");
  });

  test("ein leerer Fehlertext ist kein Fehler", () => {
    // Die Server-Action setzt `error` nur im Fehlerfall; ein leerer String käme
    // aus einer Ausnahme ohne Meldung und dürfte nicht zur Fehlerkarte führen,
    // die dann nichts erklärt.
    assert.equal(dossierEmptyKind(true, ""), "not_found");
  });

  test("die Fehlerkarte nennt den Fehler und bietet einen zweiten Versuch an", () => {
    const body = slice(PANEL, "export function LeadDossierEmpty(", "\n/** Kleiner Verweis");
    assert.match(body, /dossierEmptyKind\(available, error\)/);
    assert.match(body, /Dossier konnte nicht geladen werden/);
    assert.match(body, /Nochmal versuchen/);
    // Der Fehlertext selbst muss im load_failed-Zweig auftauchen — ihn
    // wegzuwerfen war der Fehler.
    const zweig = slice(body, 'kind === "load_failed"', 'kind === "load_failed" &&');
    assert.match(zweig, /\$\{error\}|\{error\}/);
  });

  test("„Kein Lead unter dieser Adresse\" steht NUR im not_found-Fall", () => {
    // Die Gegenprobe zur Regel darüber: Der Satz ist definitiv und darf keinen
    // Zweig teilen, in dem gar nichts nachgesehen wurde.
    const body = slice(PANEL, "export function LeadDossierEmpty(", "\n/** Kleiner Verweis");
    const satz = body.indexOf("Kein Lead unter dieser Adresse");
    assert.notEqual(satz, -1);
    const davor = body.slice(0, satz);
    // Zwischen der letzten Fallunterscheidung und dem Satz darf nur noch der
    // Rest-Zweig stehen — geprüft über die Reihenfolge der drei Titel.
    assert.ok(
      davor.includes("Dossier nicht verfügbar") && davor.includes("Dossier konnte nicht geladen werden"),
      "der Satz steht vor den beiden Fehlerfällen — dann trägt er sie mit",
    );
  });

  test("was die Karte anzeigt, ist deutsch — die rohe Meldung bleibt im Server-Log", () => {
    // Die Fehlerkarte rendert `error` wörtlich. Auf der eigenen Route kam dort
    // bisher `e.message` an: die englische PostgREST-/Postgres-Meldung samt
    // Tabellen- und Spaltennamen — genau das Vokabular, das nirgends auf den
    // Bildschirm gehört, und noch dazu ohne jede Handlungsanweisung.
    const fang = slice(ACTION, "} catch (e) {", "\n}\n");
    const rueckgabe = fang.slice(fang.indexOf("return {"));
    assert.doesNotMatch(rueckgabe, /e\.message/);
    assert.match(rueckgabe, /ließ sich nicht laden/);
    // Gegenprobe: Für die Fehlersuche muss der Rohtext trotzdem irgendwo
    // landen — im Log, wo er hingehört.
    assert.match(fang, /console\.error\("getLeadDossier:"[\s\S]*e\.message/);
  });

  test("„Nochmal versuchen\" lädt wirklich neu, statt den alten Stand zu zeigen", () => {
    // Ohne einen Zähler im Effekt-Schlüssel änderte sich an `open`, `kind` und
    // `id` nichts — der Knopf wäre eine Attrappe.
    assert.match(SHEET, /onRetry=\{\(\) => setAttempt\(\(n\) => n \+ 1\)\}/);
    assert.match(SHEET, /\}, \[open, kind, id, attempt\]\);/);
  });
});

/* ------------------------------------------------------------------ *
 * E — „Steht an" zeigt nur, was auch wirklich ansteht
 * ------------------------------------------------------------------ */

const NOW = "2026-09-09T10:00:00.000Z";

const RECYCLE = {
  next_recycle_at: null,
  recycle_attempt_count: 0,
  recycle_excluded_at: null,
  recycle_last_contacted_at: null,
  recycle_responded_at: null,
  recycle_reason_code: null,
};

function contact(partial: Partial<DossierContact> = {}): DossierContact {
  return {
    id: "c1",
    list_id: "list-1",
    list_name: "Agenturen KW34",
    list_owner_name: "Kevin",
    name: "Anna Meier",
    company: "Meier GmbH",
    email: null,
    phone: null,
    linkedin_url: null,
    target_group: null,
    notes: null,
    meeting_notes: null,
    answer_text: null,
    answer_category: null,
    answered: null,
    pitched_at: "2026-09-01",
    follow_up_number: 1,
    // Morgen — landet also in „Steht an" und nicht im Verlauf.
    next_follow_up_at: "2026-09-10",
    last_contacted_at: null,
    appointment_set: null,
    appointment_at: null,
    blocked_at: null,
    setting_call_id: null,
    created_at: "2026-09-01T08:00:00.000Z",
    updated_at: "2026-09-01T08:00:00.000Z",
    ...RECYCLE,
    ...partial,
  };
}

function input(c: DossierContact): DossierInput {
  return {
    anchor: { kind: "contact", id: c.id },
    contacts: [c],
    phoneLeads: [],
    settings: [],
    closings: [],
    attempts: [],
    now: NOW,
  };
}

/** Steht das Follow-up irgendwo in der Akte — in „Steht an" ODER im Verlauf? */
function hatFolgeAufgabe(c: DossierContact): boolean {
  const d = buildDossier(input(c));
  return [...d.upcoming, ...d.events].some((e) => e.id === `contact:${c.id}:next_fu`);
}

describe("„Steht an“ folgt denselben Ausschlüssen wie die Wiedervorlage", () => {
  test("Gegenprobe: ein Kontakt im laufenden Flow zeigt sein Follow-up", () => {
    // Ohne diesen Fall liefe der Test leer durch — die vier Regeln unten
    // könnten dann auch von einem generell fehlenden Ereignis kommen.
    assert.equal(hatFolgeAufgabe(contact()), true);
    const d = buildDossier(input(contact()));
    assert.equal(d.upcoming.length, 1);
    assert.match(d.upcoming[0].title, /Follow-up fällig \(FU2\)/);
  });

  test("wer geantwortet hat, wird nicht mehr nachgefasst", () => {
    assert.equal(hatFolgeAufgabe(contact({ answered: true })), false);
  });

  test("wer einen Termin hat, wird nicht mehr nachgefasst", () => {
    assert.equal(hatFolgeAufgabe(contact({ appointment_set: true })), false);
  });

  test("wer uns blockiert hat, wird nicht mehr nachgefasst", () => {
    assert.equal(hatFolgeAufgabe(contact({ blocked_at: "2026-09-05T09:00:00.000Z" })), false);
  });

  test("nach FU3 ist die Sequenz zu Ende — auch mit altem Datum in der Zeile", () => {
    // Bestandsdaten tragen Fälligkeiten aus der Zeit, als der Nachfassen-Pfad
    // nach FU3 noch eine setzte. Ohne diesen Riegel führte die Akte eine
    // vierte Stufe, die es gar nicht gibt.
    assert.equal(hatFolgeAufgabe(contact({ follow_up_number: 3 })), false);
  });

  test("nicht true ist Nein — NULL ist der Normalfall, nicht false", () => {
    // `answered`/`appointment_set` sind `boolean | null` und stehen bei einem
    // frisch gepitchten Kontakt auf NULL (docs §7). Ein Vergleich auf `false`
    // verlöre genau die Mehrheit der Zeilen.
    assert.equal(hatFolgeAufgabe(contact({ answered: null, appointment_set: null })), true);
    assert.equal(hatFolgeAufgabe(contact({ answered: false, appointment_set: false })), true);
  });

  test("die vier Ausschlüsse stehen wörtlich so in der Wiedervorlage-Abfrage", () => {
    // Gegenprobe an der eingefrorenen Migration: Wären es dort andere, wäre
    // nicht das Dossier falsch, sondern dieser Test.
    const sql = read("supabase/migrations/20260404000033_lead_recycling.sql");
    for (const bedingung of [
      /c\.blocked_at is null/,
      /c\.answered is not true/,
      /c\.appointment_set is not true/,
      /c\.follow_up_number = 3/,
    ]) {
      assert.match(sql, bedingung);
    }
  });

  test("der Antwort-Eintrag bleibt — er beschreibt, was WAR", () => {
    // Die Ausschlüsse gelten für die offene Aufgabe, nicht für den Verlauf:
    // Eine Antwort ist ein Ereignis und gehört in die Zeitleiste.
    const d = buildDossier(input(contact({ answered: true })));
    assert.ok(d.events.some((e) => e.id === "contact:c1:answer"));
  });
});
