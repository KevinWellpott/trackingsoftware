// Die Zähl-Regeln des Analyse-Bereichs, die man einer falschen Zahl nicht
// ansieht.
//
// Alle vier Helfer hier haben dieselbe Bauart: Sie stehen in `src/lib/analyse.ts`
// (reines Fundament, ohne Datenbank), weil die Tabs sie sonst jeder für sich
// formulieren würden — und genau daran ist der Bereich zuletzt auseinander-
// gelaufen. `channelKeyOf` lag dreimal im Code, und der Setting-Tab verglich
// stattdessen den Rohwert; die Show-Quote des Closings zählte jede Absage als
// Nicht-Erschienen, weil ihr Nenner „alle Termine" hieß.
//
// Was hier NICHT geprüft wird: ob die Tabs die Helfer auch benutzen. Das ist
// eine Frage an den Quelltext und steht in analyseVerdrahtung.test.ts — eine
// Bibliothek, die niemand ruft, bestünde jeden Test hier.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  channelKeyOf,
  closingShowRate,
  isRecycleCandidate,
  listOwnerMatches,
  type RecycleRowState,
} from "@/lib/analyse";

/* ------------------------------------------------------------------ *
 * Kanal-Schlüssel (Befund B)
 * ------------------------------------------------------------------ */

describe("channelKeyOf", () => {
  test("leere und unbekannte Quellen landen bei „sonstige“", () => {
    // `setting_calls.source_type` ist nullable und wurde nie backgefillt. Ein
    // roher Vergleich (`r.source_type !== quelle`) lässt genau diese Zeilen aus
    // JEDER Auswertung fallen, während der Donut daneben sie als „Sonstige"
    // beschriftet — dieselbe Zeile, zwei Antworten.
    assert.equal(channelKeyOf(null), "sonstige");
    assert.equal(channelKeyOf(undefined), "sonstige");
    assert.equal(channelKeyOf(""), "sonstige");
    assert.equal(channelKeyOf("gibt_es_nicht"), "sonstige");
  });

  test("bekannte Registry-Werte bleiben unverändert — auch die Altwerte", () => {
    // Altwerte dürfen NICHT eingesammelt werden: `manuell` ist filterbar und
    // hält den Großteil des historischen Volumens (docs §4).
    for (const key of ["linkedin", "telefon", "social_media", "ads", "sonstige", "manuell", "inbound", "website"]) {
      assert.equal(channelKeyOf(key), key);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Show-Quote des Closings (Befund A)
 * ------------------------------------------------------------------ */

describe("closingShowRate", () => {
  test("ein abgesagter Termin fällt aus dem Nenner, statt als No-Show zu zählen", () => {
    // 10 Termine, 2 abgesagt, 8 erschienen. Die Absage lässt `show_status`
    // bewusst unangetastet (docs §3) — im vollen Nenner stünde sie als
    // garantierte Null und drückte die Quote auf 80 %.
    assert.equal(closingShowRate(8, 10, 2), 100);
    assert.equal(closingShowRate(8, 10, 0), 80);
  });

  test("Termine OHNE Angabe bleiben im Nenner — das ist der Sinn der Kennzahl", () => {
    // docs §5: Der Nenner ist bewusst „alle Closing-Termine", damit die Quote
    // nicht misst, wer das Häkchen gesetzt hat. Nur die abgesagten kommen raus
    // — die haben nachweislich nicht stattgefunden.
    assert.equal(closingShowRate(5, 10, 0), 50);
    assert.equal(closingShowRate(5, 10, 2), 62.5);
  });

  test("ohne Termin gibt es keine Quote — null statt 0 %", () => {
    assert.equal(closingShowRate(0, 0, 0), null);
    // Nur Absagen im Fenster: derselbe Fall, sonst stünden dort 0 %.
    assert.equal(closingShowRate(0, 3, 3), null);
  });
});

/* ------------------------------------------------------------------ *
 * Status-Riegel des Recyclings (Befund C)
 * ------------------------------------------------------------------ */

/** Eine Zeile, die den jeweiligen Zweig von `recycle_tasks` gerade noch erfüllt. */
const KANDIDAT: Record<string, RecycleRowState> = {
  linkedin: {
    origin: "linkedin",
    excluded_at: null,
    responded_at: null,
    blocked_at: null,
    answered: null,
    appointment_set: null,
    follow_up_number: 3,
  },
  telefon: { origin: "telefon", excluded_at: null, responded_at: null, status: "dead" },
  setting: { origin: "setting", excluded_at: null, responded_at: null, status: "dead", revived_at: null },
  closing: { origin: "closing", excluded_at: null, responded_at: null, status: "verloren", revived_at: null },
};

describe("isRecycleCandidate", () => {
  test("die vier Zweige aus recycle_tasks sagen ja", () => {
    for (const [name, row] of Object.entries(KANDIDAT)) {
      assert.equal(isRecycleCandidate(row), true, name);
    }
  });

  test("ein Lead, der auf anderem Weg zurückkam, ist keiner mehr", () => {
    // Das ist der Kern von Befund C: Kein Rückkehrpfad räumt `next_recycle_at`
    // ab. Ohne diese Riegel zählte die Kachel „Warten aktuell" ein gewonnenes
    // Closing, einen Telefon-Lead mit Termin und einen beantworteten Kontakt
    // als offene Wiedervorlage — das Board /nachfassen zeigt sie längst nicht
    // mehr an, weil die RPC dieselben Riegel führt.
    assert.equal(isRecycleCandidate({ ...KANDIDAT.closing, status: "gewonnen" }), false);
    assert.equal(isRecycleCandidate({ ...KANDIDAT.telefon, status: "termin" }), false);
    assert.equal(isRecycleCandidate({ ...KANDIDAT.linkedin, appointment_set: true }), false);
    assert.equal(isRecycleCandidate({ ...KANDIDAT.linkedin, answered: true }), false);
    assert.equal(isRecycleCandidate({ ...KANDIDAT.setting, status: "closing_gelegt" }), false);
  });

  test("gesperrt, beantwortet oder zurückgeholt schließt jeden Ursprung aus", () => {
    for (const [name, row] of Object.entries(KANDIDAT)) {
      assert.equal(isRecycleCandidate({ ...row, excluded_at: "2026-09-01T10:00:00Z" }), false, name);
      assert.equal(isRecycleCandidate({ ...row, responded_at: "2026-09-01T10:00:00Z" }), false, name);
    }
    // `revived_at` gibt es nur an den beiden Termin-Tabellen (Migration 0032).
    assert.equal(isRecycleCandidate({ ...KANDIDAT.setting, revived_at: "2026-09-01T10:00:00Z" }), false);
    assert.equal(isRecycleCandidate({ ...KANDIDAT.closing, revived_at: "2026-09-01T10:00:00Z" }), false);
  });

  test("LinkedIn zählt erst nach FU3 — und nie mit Blockierung", () => {
    // Der Zweig verlangt `follow_up_number = 3`: Vor der letzten Stufe ist der
    // Kontakt nicht ausgereizt, sondern noch im normalen Nachfassen.
    for (const stufe of [null, 0, 1, 2]) {
      assert.equal(isRecycleCandidate({ ...KANDIDAT.linkedin, follow_up_number: stufe }), false, String(stufe));
    }
    assert.equal(isRecycleCandidate({ ...KANDIDAT.linkedin, blocked_at: "2026-09-01T10:00:00Z" }), false);
  });

  test("das Erstgespräch hat drei gleichwertige Auslöser", () => {
    // dead/unqualifiziert ODER No-Show ohne Antwort ODER Absage ohne Aussicht.
    // Die letzten beiden lassen `status` bewusst unangetastet (docs §3) — wer
    // nur den Status liest, verliert sie.
    const offen: RecycleRowState = { origin: "setting", excluded_at: null, responded_at: null, status: "offen", revived_at: null };
    assert.equal(isRecycleCandidate(offen), false);
    assert.equal(isRecycleCandidate({ ...offen, status: "unqualifiziert" }), true);
    assert.equal(isRecycleCandidate({ ...offen, no_show_resolution: "ohne_antwort" }), true);
    assert.equal(isRecycleCandidate({ ...offen, cancel_outlook: "ohne_aussicht" }), true);
    // Die Gegenwerte derselben Spalten lösen nichts aus.
    assert.equal(isRecycleCandidate({ ...offen, no_show_resolution: "ersatztermin" }), false);
    assert.equal(isRecycleCandidate({ ...offen, cancel_outlook: "neuer_termin" }), false);
  });
});

/* ------------------------------------------------------------------ *
 * Personenachse listen-gebundener Zeilen (Befund D)
 * ------------------------------------------------------------------ */

describe("listOwnerMatches", () => {
  const owners = new Set(["maria"]);
  const ids = new Set(["u-maria"]);

  test("owner_name hat Vorrang und wird case-insensitiv verglichen", () => {
    assert.equal(listOwnerMatches({ owner_name: "Maria", list_created_by_user_id: null }, owners, ids), true);
    assert.equal(listOwnerMatches({ owner_name: " maria ", list_created_by_user_id: null }, owners, ids), true);
    assert.equal(listOwnerMatches({ owner_name: "Kevin", list_created_by_user_id: "u-maria" }, owners, ids), false);
  });

  test("ohne Namen entscheidet der Ersteller der Liste — sonst zählt die Zeile bei niemandem", () => {
    // Genau das war Befund D: `ownerKey(null)` ergibt "" und trifft nie. Eine
    // Liste ohne `owner_name` fiel damit bei aktivem Personenfilter aus der
    // ganzen Sektion, obwohl `list_owned_by_user()` und `buildOwnScope()`
    // überall sonst auf den Ersteller zurückfallen.
    assert.equal(listOwnerMatches({ owner_name: null, list_created_by_user_id: "u-maria" }, owners, ids), true);
    assert.equal(listOwnerMatches({ owner_name: "", list_created_by_user_id: "u-maria" }, owners, ids), true);
    assert.equal(listOwnerMatches({ owner_name: null, list_created_by_user_id: "u-kevin" }, owners, ids), false);
  });

  test("ohne beides gehört die Zeile niemandem", () => {
    assert.equal(listOwnerMatches({ owner_name: null, list_created_by_user_id: null }, owners, ids), false);
  });
});
