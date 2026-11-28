// Mitglieder-Verwaltung (28.11.): Passwort, Name, Rechte, Sperren, Löschen
// und „Mein Konto“. Regeln als Verhalten, Schutzregeln am Quelltext.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { PASSWORT_MIN, erzeugePasswort, passwortFehler, zuletztText } from "@/lib/mitglieder";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const WS = read("src/app/actions/workspace.ts");

function rumpf(name: string): string {
  const start = WS.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, name);
  const ende = WS.indexOf("\nexport async function ", start + 10);
  return WS.slice(start, ende === -1 ? undefined : ende);
}

describe("Passwort-Regeln", () => {
  test("Mindestlänge, Höchstlänge, keine Leerzeichen am Rand", () => {
    assert.equal(PASSWORT_MIN, 8);
    assert.match(passwortFehler("kurz") ?? "", /mindestens 8/);
    assert.equal(passwortFehler("ausreichend1"), null);
    assert.match(passwortFehler(" leerzeichen") ?? "", /Leerzeichen/);
    assert.match(passwortFehler("x".repeat(73)) ?? "", /höchstens 72/);
  });
  test("erzeugte Passwörter taugen und meiden verwechselbare Zeichen", () => {
    const pw = erzeugePasswort(12, (n) => Uint32Array.from({ length: n }, (_, i) => i * 7));
    assert.equal(pw.length, 12);
    assert.equal(passwortFehler(pw), null);
    assert.doesNotMatch(erzeugePasswort(200), /[0O1lI]/);
  });
  test("„zuletzt angemeldet“", () => {
    const jetzt = Date.parse("2026-12-02T12:00:00Z");
    assert.equal(zuletztText(null, jetzt), "noch nie angemeldet");
    assert.equal(zuletztText("2026-12-02T08:00:00Z", jetzt), "zuletzt heute angemeldet");
    assert.equal(zuletztText("2026-11-29T08:00:00Z", jetzt), "zuletzt vor 3 Tagen angemeldet");
  });
});

describe("Berechtigung", () => {
  test("ein Owner verwaltet seine aktive Organisation, ein Plattform-Admin jede", () => {
    assert.match(WS, /const darf = access\.is_platform_admin \|\| \(ws === access\.workspace_id && access\.role === "owner"\);/);
    // Der Helfer ist nicht exportiert — in einer "use server"-Datei wäre er sonst vom Client aufrufbar.
    assert.match(WS, /\nasync function verwaltung\(/);
    for (const name of ["renameUser", "updateUserRole", "updateUserScope", "deleteUser", "setUserPassword", "setUserGesperrt", "listMitglieder"]) {
      assert.match(rumpf(name), /const v = await verwaltung\(workspaceId\);/, name);
    }
  });
  test("ein Kunden-Owner kann keinen Plattform-Admin ändern oder löschen", () => {
    assert.match(WS, /if \(!access\.is_platform_admin && \(await istPlattformAdmin\(admin, userId\)\)\)/);
    assert.match(rumpf("setUserPassword"), /zielPruefen\(admin, access, ws, userId\)/);
    assert.match(rumpf("setUserGesperrt"), /zielPruefen\(admin, access, ws, userId\)/);
  });
});

describe("Schutzregeln", () => {
  test("nicht sich selbst sperren, löschen oder die Rolle ändern", () => {
    assert.match(rumpf("setUserGesperrt"), /if \(userId === access\.user\.id\) return \{ error: "Du kannst dich nicht selbst sperren\." \};/);
    assert.match(rumpf("deleteUser"), /Du kannst dich nicht selbst löschen\./);
    assert.match(rumpf("updateUserRole"), /Du kannst deine eigene Rolle nicht ändern\./);
  });
  test("der letzte Owner bleibt — beim Rollenwechsel, Sperren und Löschen", () => {
    assert.match(rumpf("updateUserRole"), /Die Organisation braucht mindestens einen Owner\./);
    assert.match(rumpf("setUserGesperrt"), /Der einzige Owner lässt sich nicht sperren\./);
    assert.match(rumpf("deleteUser"), /ownerAnzahl\(admin, ws\)\) <= 1/);
  });
  test("Sperren ist ein Auth-Bann, Entsperren hebt ihn auf", () => {
    assert.match(rumpf("setUserGesperrt"), /ban_duration: gesperrt \? "876000h" : "none"/);
  });
  test("das eigene Passwort nur mit dem aktuellen", () => {
    const eigen = rumpf("changeOwnPassword");
    assert.match(eigen, /signInWithPassword\(\{ email, password: aktuell \}\)/);
    assert.match(eigen, /persistSession: false/);
    assert.match(eigen, /"Das aktuelle Passwort stimmt nicht\."/);
    // Fremde Passwörter setzt nur die Verwaltung — nie das eigene über diesen Weg.
    assert.match(rumpf("setUserPassword"), /Dein eigenes Passwort änderst du unter „Mein Konto“\./);
  });
});

describe("Oberfläche", () => {
  test("/settings: „Mein Konto“ für alle, die Verwaltung für Owner — der alte Hinweis ist weg", () => {
    const seite = read("src/app/(dashboard)/settings/page.tsx");
    assert.match(seite, /<EigenesKonto/);
    assert.match(seite, /<MitgliederVerwaltung mitglieder=\{mitglieder\} meId=\{access\.user\.id\} \/>/);
    assert.doesNotMatch(seite, /Nutzer löschen und neu anlegen/);
  });
  test("/admin/org/[id] verwaltet Mitglieder direkt, „Verschieben“ bleibt", () => {
    const admin = read("src/app/(dashboard)/admin/org/[id]/page.tsx");
    assert.match(admin, /<MitgliederVerwaltung[\s\S]*?workspaceId=\{id\}/);
    assert.match(admin, /<MoveUserButton/);
  });
  test("der Dialog bietet Name, Rechte, Passwort, Zugang und Löschen", () => {
    const dlg = read("src/components/settings/MitgliederVerwaltung.tsx");
    for (const titel of ["Name", "Rechte", "Passwort", "Zugang", "Löschen"]) {
      assert.match(dlg, new RegExp(`<Abschnitt\\s+titel="${titel}"`), titel);
    }
  });
});
