// Rückbau, zweite Welle: Ablage und Lead-Dossier.
//
// Zwei Entscheidungen stehen hier unter Beobachtung, und beide sind
// Entfernungen — die gefährlichste Sorte Änderung, weil ihr Schaden nicht als
// Fehler auftritt, sondern als etwas, das nicht mehr da ist.
//
// 1. AUS SECHS ABLAGE-REITERN WERDEN ZWEI. Vier davon beschreiben Endzustände,
//    die nach dem Rückbau alle dasselbe bedeuten: raus. Der Reiter war die
//    einzige Stelle, an der der Unterschied stand — er muss deshalb auf die
//    Karte, sonst geht mit den Reitern eine Auskunft verloren. Und einer der
//    sechs ist gar kein Endzustand: „Ersatztermin steht aus" ist ein Lead ohne
//    nächsten Termin, also genau der, der in die Hauptliste gehört.
//
// 2. DAS DOSSIER VERLIERT DIE QUELLE „ERINNERUNG". Sie hing an der Kaskade;
//    `reminder_touches` füllt keine Oberfläche mehr. Ihr Ereignis war aber
//    zugleich der häufigste ECHTE Kontakt in der Zeitleiste — ohne Ersatz
//    zeigte „zuletzt kontaktiert" bei einem täglich bearbeiteten Lead das
//    Datum seines letzten Termins. Der Ersatz ist der Nachfass-Stempel der
//    Terminliste (Migration 0041).
//
// Was NICHT geprüft wird, weil es sich nicht geändert hat: die Zwei-Stufen-
// Lösung der Lead-Identität (belegt gegen vermutet). Sie steht in
// leadDossier.test.ts und hat mit dem Rückbau nichts zu tun.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  DROPOUT_LISTS,
  DROPOUT_SOURCE_LABELS,
  dropoutListMeta,
  parseDropoutList,
} from "@/lib/dropoutLists";
import {
  buildDossier,
  type DossierClosing,
  type DossierContact,
  type DossierInput,
  type DossierSetting,
} from "@/lib/leadDossier";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; mehrere Anker unten tragen ein `\n`.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const DROPOUT = read("src/app/actions/dropout.ts");
const BOARD = read("src/components/ablage/AblageBoard.tsx");
const NAV = read("src/components/ablage/AblageNav.tsx");
const PAGE = read("src/app/(dashboard)/ablage/page.tsx");
const DOSSIER_LIB = read("src/lib/leadDossier.ts");
const DOSSIER_ACTION = read("src/app/actions/leadDossier.ts");
const PANEL = read("src/components/lead/LeadDossierPanel.tsx");
const MIGRATION_0033 = read("supabase/migrations/20260404000033_lead_recycling.sql");
const MIGRATION_0041 = read("supabase/migrations/20260404000041_rueckbau_pflichtfelder_und_nachfass_stempel.sql");

/* ------------------------------------------------------------------ *
 * 1. Die Ablage: zwei Ansichten
 * ------------------------------------------------------------------ */

describe("„Ersatztermin steht aus“ ist kein Archiv-Reiter mehr", () => {
  test("keine Ansicht fragt ihn ab, und die Oberfläche nennt ihn nicht", () => {
    // Der Zustand („abgesagt, neuer Termin in Aussicht, noch keiner
    // eingetragen") ist ein Lead ohne nächsten Termin — er wird täglich
    // kontaktiert und steht damit in der Hauptliste. Ein zweiter Ort dafür wäre
    // eine stille Arbeitsliste neben der einen richtigen.
    const gesendet = DROPOUT_LISTS.flatMap((l) => [...l.sources]);
    assert.equal(gesendet.includes("ersatztermin_offen" as never), false);
    for (const [name, quelle] of [
      ["actions/dropout.ts", DROPOUT],
      ["AblageBoard.tsx", BOARD],
      ["AblageNav.tsx", NAV],
      ["ablage/page.tsx", PAGE],
    ] as const) {
      assert.doesNotMatch(quelle, /ersatztermin_offen/, name);
    }
  });

  test("Gegenprobe: die eingefrorene RPC kennt den Wert weiterhin", () => {
    // Entfernt wurde die AUFRUFSTELLE, nicht die Funktion — eine Änderung an
    // `dropout_lists()` bräuchte eine neue Migration, und dafür gibt es keinen
    // Grund: Die Ansicht ist weg, die Abfrage schadet niemandem.
    assert.match(MIGRATION_0033, /'ersatztermin_offen'/);
    assert.match(MIGRATION_0033, /when 'ersatztermin_offen'\s+then sc\.cancel_outlook = 'neuer_termin'/);
  });

  test("die alte Adresse führt trotzdem irgendwohin, statt zu werfen", () => {
    // Sie steht in Lesezeichen. `?liste=ersatztermin_offen` hat in der Ablage
    // keinen ehrlichen Nachfolger — die erste Ansicht ist der Rückfall.
    assert.equal(parseDropoutList("ersatztermin_offen"), "ausgeschieden");
  });
});

describe("Vier Endzustände, eine Liste — die Unterscheidung wandert auf die Karte", () => {
  test("die Ansicht legt genau die vier zusammen", () => {
    assert.deepEqual([...dropoutListMeta("ausgeschieden").sources].sort(), [
      "abgesagt",
      "disqualifiziert",
      "kein_close",
      "no_show_ohne_antwort",
    ]);
  });

  test("jede der vier trägt ein eigenes Kennzeichen — sonst wäre die Auskunft weg", () => {
    // Das ist die Bedingung, unter der das Zusammenlegen überhaupt vertretbar
    // ist: Der Reiter war eine Auskunft, keine Dekoration. Vier gleich
    // aussehende Karten wären ein Verlust, kein Rückbau.
    const kennzeichen = dropoutListMeta("ausgeschieden").sources.map((s) => DROPOUT_SOURCE_LABELS[s]);
    assert.equal(new Set(kennzeichen).size, 4);
    for (const label of kennzeichen) assert.ok(label.trim().length > 0);
  });

  test("die Karte zeigt es auch, aber nicht dort, wo es sich wiederholen würde", () => {
    // In der Sperrliste stünde „Gesperrt" neben dem roten Badge „Gesperrt".
    assert.match(BOARD, /\{showSource && \(/);
    assert.match(BOARD, /DROPOUT_SOURCE_LABELS\[row\.source_list\]/);
    assert.match(BOARD, /const showSource = meta\.sources\.length > 1;/);
  });

  test("das Kennzeichen kommt aus der Quelle der Zeile, nicht aus der Ansicht", () => {
    // Es wird beim Laden an die Zeile geheftet. Aus der Ansicht ließe es sich
    // gar nicht mehr ableiten — dort liegen alle vier nebeneinander.
    assert.match(DROPOUT, /return rows\.map\(\(r\) => \(\{ \.\.\.r, source_list: source \}\)\);/);
    assert.match(DROPOUT, /source_list: DropoutSourceList;/);
  });
});

describe("Eine Ansicht aus mehreren Aufrufen — ohne Dubletten", () => {
  test("es wird je Quelle einmal abgefragt, parallel", () => {
    // Die RPC ist eingefroren und nimmt genau EINEN Schlüssel entgegen.
    assert.match(DROPOUT, /sources\.map\(async \(source\) => \{/);
    assert.match(DROPOUT, /p_list: source,/);
  });

  test("dieselbe Zeile aus zwei Quellen wird EINE Karte", () => {
    // Ein disqualifiziertes Erstgespräch, das später abgesagt wurde, kommt aus
    // zwei Aufrufen zurück. In den sechs alten Reitern fiel das nicht auf: Es
    // stand in zwei Reitern, aber nie zweimal nebeneinander.
    const zusammenlegen = DROPOUT.slice(
      DROPOUT.indexOf("const raw: (DropoutRowRaw"),
      DROPOUT.indexOf("const lineage = await loadLineage"),
    );
    assert.match(zusammenlegen, /const seen = new Set<string>\(\);/);
    assert.match(zusammenlegen, /if \(seen\.has\(key\)\) continue;/);
    assert.match(zusammenlegen, /\$\{r\.entity_type\}:\$\{r\.entity_id\}/);
  });

  test("und genau deshalb trägt die Umschaltleiste keine Zahl", () => {
    // Vier Einzelzähler summierten sich über die Dubletten hinweg und wären
    // größer als die Liste darunter.
    assert.doesNotMatch(NAV, /count/);
    assert.doesNotMatch(PAGE, /loadDropoutCounts/);
  });
});

describe("Die Sperrliste bleibt unangetastet", () => {
  test("sie ist weiter eine eigene Ansicht und weiter org-weit", () => {
    // Ein Kontaktverbot, das nur sein Besitzer sieht, ist keines — und in der
    // Ablage-Sammelliste wäre es eine Zeile unter hundert statt einer Ansage.
    const meta = dropoutListMeta("gesperrt");
    assert.equal(meta.orgWide, true);
    assert.deepEqual([...meta.sources], ["gesperrt"]);
    assert.equal(DROPOUT_LISTS.filter((l) => l.orgWide).length, 1);
  });

  test("der Grund-Nachschlag läuft weiter nur dort", () => {
    assert.match(DROPOUT, /list === "gesperrt" \? await loadBlockReasons\(access, raw\) : null/);
  });
});

/* ------------------------------------------------------------------ *
 * 2. Das Dossier ohne die Erinnerungs-Quelle
 * ------------------------------------------------------------------ */

describe("Die Quelle „Erinnerung“ ist weg — mitsamt ihrem Laden", () => {
  test("weder Bibliothek noch Server-Action fassen `reminder_touches` an", () => {
    // Eine Abfrage auf eine Tabelle, die keine Oberfläche mehr füllt, liefert
    // zuerst dauerhaft dasselbe und dann dauerhaft nichts — beides ist eine
    // Aussage über nichts, und sie kostet eine Abfrage je Dossier.
    // Geprüft wird auf die ABFRAGE, nicht auf das Wort: Die Begründung, warum
    // die Tabelle nicht mehr gelesen wird, steht als Kommentar in beiden
    // Dateien und soll dort auch stehen bleiben.
    assert.doesNotMatch(DOSSIER_ACTION, /from\("reminder_touches"\)/);
    assert.doesNotMatch(DOSSIER_ACTION, /TOUCH_COLUMNS|touchOr|touches:/);
    assert.doesNotMatch(DOSSIER_LIB, /DossierTouch/);
    assert.doesNotMatch(DOSSIER_LIB, /cascade_kind|superseded_at|touch_kind/);
  });

  test("auch die Beschriftungen der Kaskade sind mitgegangen", () => {
    // `CASCADE_KIND_LABELS` und `TEMPLATE_META` beschrieben Stufen einer
    // Kaskade, die es nicht mehr gibt. Sie bleiben in ihren eigenen Dateien
    // stehen (andere Stellen lesen sie noch) — hier haben sie nichts verloren.
    assert.doesNotMatch(DOSSIER_LIB, /CASCADE_KIND_LABELS|TEMPLATE_META|isTemplateKey/);
  });

  test("„Erinnerung“ ist auch als Ereignis-Quelle verschwunden", () => {
    // Ein Eintrag in `SOURCE_META`, den nichts mehr erzeugt, ist eine
    // Beschriftung ohne Gegenstand.
    assert.doesNotMatch(DOSSIER_LIB, /"erinnerung"/);
    assert.doesNotMatch(PANEL, /erinnerung:/);
  });

  test("die Erklärtexte behaupten keine Erinnerungen mehr", () => {
    // Sie standen wörtlich in zwei InfoPopovern („abgehakte Erinnerungen",
    // „Entwertete Erinnerungen"). Ein Erklärtext, der eine Quelle nennt, die es
    // nicht gibt, ist schlimmer als keiner.
    assert.doesNotMatch(PANEL, /abgehakte Erinnerungen/);
    assert.doesNotMatch(PANEL, /Entwertete Erinnerungen/);
  });
});

/* ------------------------------------------------------------------ *
 * 3. Der Ersatz: der Nachfass-Stempel der Terminliste
 * ------------------------------------------------------------------ */

const NOW = "2026-09-10T10:00:00.000Z";

const RECYCLE = {
  next_recycle_at: null,
  recycle_attempt_count: 0,
  recycle_excluded_at: null,
  recycle_last_contacted_at: null,
  recycle_responded_at: null,
  recycle_reason_code: null,
};

function setting(partial: Partial<DossierSetting> & { id: string }): DossierSetting {
  return {
    lead_name: "Anna Meier",
    company: "Meier GmbH",
    phone: null,
    wa_phone: null,
    wa_consent_at: null,
    wa_refused_at: null,
    source_type: "linkedin",
    source_detail: null,
    source_contact_id: null,
    source_phone_lead_id: null,
    appointment_at: null,
    call_at: null,
    meeting_kind: null,
    meet_link: null,
    status: "offen",
    show_status: null,
    branche: null,
    has_budget_8k: null,
    sole_decider: null,
    can_decide_now: null,
    clear_need: null,
    ist_pain: null,
    warmth: null,
    soll_ziel: null,
    script_answers: null,
    notes: null,
    objections_handled: null,
    objections_open: null,
    follow_up_due: null,
    follow_up_last_contacted_at: null,
    follow_up_last_contacted_by_user_id: null,
    follow_up_last_contacted_username: null,
    no_show_count: 0,
    no_show_resolution: null,
    cancelled_at: null,
    cancel_reason_code: null,
    cancel_reason: null,
    cancel_outlook: null,
    reschedule_count: 0,
    last_reschedule_at: null,
    revived_at: null,
    disqualify_reason_code: null,
    disqualify_reason: null,
    assigned_user_id: null,
    created_by_user_id: null,
    assigned_username: null,
    created_at: "2026-08-01T08:00:00.000Z",
    updated_at: "2026-08-01T08:00:00.000Z",
    ...RECYCLE,
    ...partial,
  };
}

function closing(partial: Partial<DossierClosing> & { id: string }): DossierClosing {
  return {
    setting_call_id: null,
    lead_name: "Anna Meier",
    company: "Meier GmbH",
    call_at: null,
    meet_link: null,
    status: "offen",
    show_status: null,
    deal_volume: null,
    payment_type: null,
    signature_received: null,
    contract_start: null,
    onboarding_at: null,
    lost_reason_code: null,
    lost_reason: null,
    follow_up_due: null,
    follow_up_due_at: null,
    follow_up_last_contacted_at: null,
    follow_up_last_contacted_by_user_id: null,
    follow_up_last_contacted_username: null,
    script_answers: null,
    notes: null,
    objections_handled: null,
    objections_open: null,
    cancelled_at: null,
    cancel_reason_code: null,
    cancel_reason: null,
    cancel_outlook: null,
    reschedule_count: 0,
    last_reschedule_at: null,
    revived_at: null,
    assigned_user_id: null,
    created_by_user_id: null,
    assigned_username: null,
    created_at: "2026-08-05T08:00:00.000Z",
    updated_at: "2026-08-05T08:00:00.000Z",
    ...RECYCLE,
    ...partial,
  };
}

function input(partial: Partial<DossierInput> & { anchor: DossierInput["anchor"] }): DossierInput {
  return {
    contacts: [],
    phoneLeads: [],
    settings: [],
    closings: [],
    attempts: [],
    now: NOW,
    ...partial,
  };
}

describe("Der Nachfass-Stempel ersetzt die erledigte Erinnerung", () => {
  test("er zählt als echter Kontakt und schlägt den geführten Termin", () => {
    // Ohne ihn zeigte „zuletzt kontaktiert" bei einem Lead, der seit Wochen
    // täglich genervt wird, das Datum seines letzten Termins — also die eine
    // Zahl, für die das Dossier überhaupt gelesen wird, um einen Monat daneben.
    const d = buildDossier(
      input({
        anchor: { kind: "setting", id: "s1" },
        settings: [
          setting({
            id: "s1",
            appointment_at: "2026-08-20T08:00:00.000Z",
            show_status: "show",
            follow_up_last_contacted_at: "2026-09-09T15:00:00.000Z",
            follow_up_last_contacted_username: "Kevin",
          }),
        ],
      }),
    );

    assert.equal(d.lastContact.at, "2026-09-09T15:00:00.000Z");
    assert.equal(d.lastContact.daysAgo, 1);
    assert.equal(d.lastContact.label, "gestern");
    // Kein „≈": Der Stempel trägt einen erfassten Zeitpunkt, anders als eine
    // FU-Stufe. Die Zahl darf sich nicht unsicherer geben, als sie ist.
    assert.equal(d.lastContact.estimated, false);
  });

  test("Gegenprobe: ohne Stempel bleibt der geführte Termin der letzte Kontakt", () => {
    // Sonst liefe der Test darüber auch grün, wenn der Stempel gar kein
    // Ereignis erzeugte.
    const d = buildDossier(
      input({
        anchor: { kind: "setting", id: "s1" },
        settings: [setting({ id: "s1", appointment_at: "2026-08-20T08:00:00.000Z", show_status: "show" })],
      }),
    );
    assert.equal(d.lastContact.at, "2026-08-20T08:00:00.000Z");
    assert.equal(d.events.some((e) => e.id === "setting:s1:followed_up"), false);
  });

  test("wer nachgefasst hat, steht dabei — und die Karte sagt, dass es nur der letzte ist", () => {
    // Die Spalte hält einen Zeitpunkt, keine Historie. Ein einzelner Eintrag,
    // der wie der vollständige Verlauf aussieht, wäre eine Behauptung.
    const d = buildDossier(
      input({
        anchor: { kind: "setting", id: "s1" },
        settings: [
          setting({
            id: "s1",
            follow_up_last_contacted_at: "2026-09-09T15:00:00.000Z",
            follow_up_last_contacted_username: "Kevin",
          }),
        ],
      }),
    );
    const e = d.events.find((x) => x.id === "setting:s1:followed_up");
    assert.ok(e, "Der Stempel erzeugt kein Ereignis");
    assert.match(e!.detail ?? "", /Kevin/);
    assert.match(e!.detail ?? "", /nicht fest/);
  });

  test("das Closing bekommt denselben Stempel", () => {
    // Migration 0041 legt die Spalten auf BEIDEN Termin-Tabellen an — ein
    // Dossier, das nur eine liest, verlöre die Hälfte der Nachfass-Kontakte.
    const d = buildDossier(
      input({
        anchor: { kind: "closing", id: "cl1" },
        closings: [closing({ id: "cl1", follow_up_last_contacted_at: "2026-09-09T15:00:00.000Z" })],
      }),
    );
    assert.equal(d.lastContact.at, "2026-09-09T15:00:00.000Z");
    assert.equal(d.lastContact.source, "closing");
  });

  test("Gegenprobe an der Migration: die Spalten heißen wirklich so", () => {
    // Sie stehen NAMENTLICH in der Hauptabfrage des Dossiers. Ein Tippfehler
    // wäre kein fehlendes Feld, sondern eine abgewiesene Abfrage — das ganze
    // Dossier bliebe leer (Muster 0029/0032).
    for (const tabelle of ["setting_calls", "closing_calls"]) {
      assert.match(
        MIGRATION_0041,
        new RegExp(`alter table public\\.${tabelle}[\\s\\S]{0,400}?follow_up_last_contacted_at`),
        tabelle,
      );
    }
    assert.match(MIGRATION_0041, /follow_up_last_contacted_by_user_id\s+uuid references auth\.users/);
    assert.match(DOSSIER_ACTION, /follow_up_last_contacted_at, follow_up_last_contacted_by_user_id/);
  });

  test("der Name des Nachfassenden wird mit denselben Profilen aufgelöst", () => {
    // Er muss nicht der Zuständige sein: In einem Dreier-Team hakt ab, wer
    // gerade Zeit hat. Eine zweite Profil-Abfrage dafür wäre eine Abfrage zu
    // viel — die Ids gehen in dieselbe hinein.
    assert.match(DOSSIER_ACTION, /follow_up_last_contacted_by_user_id as string \| null\)/);
    assert.match(DOSSIER_ACTION, /const stampNameOf = /);
  });
});

describe("Trägt das Dossier ohne die Erinnerungen noch?", () => {
  test("fünf Quellen bleiben, und die Zeitleiste füllt sich weiterhin aus allen", () => {
    // Die Frage hinter dem Rückbau: Bleibt genug übrig, dass die Akte ihren
    // Zweck erfüllt (Gesprächsvorbereitung)? Der Durchstich zeigt LinkedIn,
    // Telefon, Setting, Closing und Recycling in einer Leiste.
    const contactRow: DossierContact = {
      id: "c1",
      list_id: "l1",
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
      pitched_at: "2026-08-01",
      follow_up_number: null,
      next_follow_up_at: null,
      last_contacted_at: null,
      appointment_set: null,
      appointment_at: null,
      blocked_at: null,
      setting_call_id: "s1",
      created_at: "2026-08-01T08:00:00.000Z",
      updated_at: "2026-08-01T08:00:00.000Z",
      ...RECYCLE,
    };

    const d = buildDossier(
      input({
        anchor: { kind: "contact", id: "c1" },
        contacts: [contactRow],
        settings: [
          setting({
            id: "s1",
            source_contact_id: "c1",
            source_phone_lead_id: "p1",
            appointment_at: "2026-08-20T08:00:00.000Z",
            show_status: "show",
            status: "closing_gelegt",
          }),
        ],
        phoneLeads: [
          {
            id: "p1",
            list_id: "pl1",
            list_name: "Akquise Nord",
            list_owner_name: "Kevin",
            decider_name: "Anna Meier",
            company: "Meier GmbH",
            phone: "+49 30 1234",
            decider_direct_dial: null,
            email: null,
            website: null,
            target_group: null,
            script_label: null,
            status: "termin",
            first_call_at: "2026-08-10",
            call_attempt: 1,
            gatekeeper_reached: null,
            decider_reached: null,
            pitch_delivered: null,
            mailbox: null,
            answer_sentiment: null,
            callback_at: null,
            appointment_set: true,
            appointment_at: null,
            no_transfer_reason: null,
            no_pitch_reason: null,
            no_appointment_reason: null,
            objection_notes: null,
            notes: null,
            created_at: "2026-08-09T08:00:00.000Z",
            updated_at: "2026-08-09T08:00:00.000Z",
            ...RECYCLE,
          },
        ],
        closings: [
          closing({
            id: "cl1",
            setting_call_id: "s1",
            call_at: "2026-09-01T08:00:00.000Z",
            status: "verloren",
            lost_reason_code: "preis",
            recycle_last_contacted_at: "2026-09-05T08:00:00.000Z",
          }),
        ],
      }),
    );

    const quellen = new Set(d.events.map((e) => e.source));
    assert.deepEqual(
      [...quellen].sort(),
      ["closing", "linkedin", "recycling", "setting", "telefon"],
    );
    // Und der Verlauf ist nicht auf ein paar Zeilen zusammengeschrumpft.
    assert.ok(d.events.length >= 6, `nur ${d.events.length} Ereignisse`);
  });
});
