// Kunden-Übersicht nach den Regeln (28.11.) und Dateien an Vorlagen (0052).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { sichererDateiname } from "@/lib/kunden";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

describe("Kunden-Übersicht", () => {
  const page = read("src/app/(dashboard)/kunden/page.tsx");
  test("Erklärung im Info-Icon, kein Gold und kein Orange als Status", () => {
    assert.match(page, /<InfoPopover label="Was steht hier\?"/);
    assert.doesNotMatch(page, /ks-gold|KUNDEN_STATUS_TONE/);
    assert.match(page, /className="kd-badge" data-ton="rot"/);
  });
  test("eine Leiste mit Reitern, Suche und Personen; Tabelle mit fluchtenden Spalten", () => {
    assert.match(page, /<div className="kd-leiste">/);
    assert.match(page, /<nav className="kd-reiter" aria-label="Welche Kunden">/);
    assert.match(read("src/app/globals.css"), /\.kd-kopf, \.kd-zeile \{ display: grid; grid-template-columns: var\(--kd-spalten\);/);
  });
});

describe("Dateien an Vorlagen", () => {
  test("Migration: Tabelle mit RLS, privater Bucket, Hochladen nur in eine existierende Vorlage", () => {
    const mig = read("supabase/migrations/20260404000052_vorlagen_dateien.sql");
    assert.match(mig, /create table if not exists public\.fulfillment_vorlage_dateien/);
    assert.match(mig, /values \('vorlagen-dateien', 'vorlagen-dateien', false, 52428800\)/);
    assert.match(mig, /split_part\(name, '\/', 1\) in \(select id::text from public\.fulfillment_vorlagen\)/);
    assert.match(mig, /is_intern_member\(\)/);
  });
  test("Speicherpfad wird geprüft, Download nur über kurzlebigen Link, Löschen räumt den Bucket", () => {
    const a = read("src/app/actions/kunden.ts");
    assert.match(a, /if \(!input\.storage_path\.startsWith\(`\$\{vorlageId\}\/`\) \|\| input\.storage_path\.includes\("\.\."\)\)/);
    assert.match(a, /createSignedUrl\(d\.storage_path, 300/);
    assert.match(a, /if \(pfade\.length\) await ctx\.supabase\.storage\.from\(VORLAGEN_BUCKET\)\.remove\(pfade\);/);
  });
  test("sichere Dateinamen", () => {
    assert.equal(sichererDateiname("Onboarding Präsentation (v2).pdf"), "Onboarding_Pra_sentation_v2_.pdf");
    assert.equal(sichererDateiname("   "), "_");
  });
  test("die Vorlage zeigt ihre Dateien als eigenen Abschnitt", () => {
    const seite = read("src/app/(dashboard)/kunden/vorlagen/page.tsx");
    assert.match(seite, /dateien=\{dateien\?\.dateien \?\? \[\]\}/);
    assert.match(read("src/components/kunden/VorlagenEditor.tsx"), /<VorlagenDateien\s+vorlageId=\{vorlage\.id\}/);
  });
  // 28.11.: volle Breite, alles einklappbar, Erklärungen im Info-Icon.
  test("Vorlagen: volle Breite, Liste links, Phasen und Dateien einklappbar", () => {
    const seite = read("src/app/(dashboard)/kunden/vorlagen/page.tsx");
    assert.doesNotMatch(seite, /data-schmal/);
    assert.match(seite, /className="vl-layout"/);
    assert.match(seite, /className="vl-archiv-gruppe"/);
    const editor = read("src/components/kunden/VorlagenEditor.tsx");
    assert.match(editor, /<Abschnitt key=\{k\} offen=\{!zu\.has\(k\)\}/);
    assert.match(editor, /\{allesZu \? "Alle aufklappen" : "Alle zuklappen"\}/);
    assert.match(editor, /offen=\{!zu\.has\(DATEIEN\)\}/);
    assert.match(editor, /<InfoPopover label="So wirken Änderungen"/);
    assert.match(read("src/components/kunden/VorlagenDateien.tsx"), /<Abschnitt\s/);
  });
});
