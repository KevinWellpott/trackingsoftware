// Lead-Dossier: Zusammenführung, Sortierung und „zuletzt kontaktiert".
//
// Geprüft wird genau das, was ein falsches Dossier gefährlich macht:
//
//  1. Verschmelzung NUR über Fremdschlüssel — ein LinkedIn-Kontakt und ein
//     Telefon-Lead derselben Firma dürfen nie stillschweigend eine Akte
//     werden. Wer sich auf ein Gespräch beruft, das er mit jemand anderem
//     geführt hat, verliert den Termin.
//  2. Die Zeitleiste mischt zwei Zeitgenauigkeiten (Tagesdatum und
//     Zeitstempel) und muss trotzdem stabil und richtig herum sortieren.
//  3. „Zuletzt kontaktiert" zählt über ALLE Quellen und nur über echte
//     Kontakte — ein gebuchter Termin ist keiner, ein geführter schon.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildDossier,
  collectCore,
  normalizeCompany,
  type DossierAttempt,
  type DossierClosing,
  type DossierContact,
  type DossierInput,
  type DossierPhoneLead,
  type DossierSetting,
} from "@/lib/leadDossier";

const NOW = "2026-09-09T10:00:00.000Z";

/* ------------------------------------------------------------------ *
 * Zeilen-Fabriken — nur die Felder, die der jeweilige Test setzt
 * ------------------------------------------------------------------ */

const RECYCLE = {
  next_recycle_at: null,
  recycle_attempt_count: 0,
  recycle_excluded_at: null,
  recycle_last_contacted_at: null,
  recycle_responded_at: null,
  recycle_reason_code: null,
};

function contact(partial: Partial<DossierContact> & { id: string }): DossierContact {
  return {
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
    pitched_at: null,
    follow_up_number: null,
    next_follow_up_at: null,
    last_contacted_at: null,
    appointment_set: null,
    appointment_at: null,
    blocked_at: null,
    setting_call_id: null,
    created_at: "2026-08-01T08:00:00.000Z",
    updated_at: "2026-08-01T08:00:00.000Z",
    ...RECYCLE,
    ...partial,
  };
}

function phoneLead(partial: Partial<DossierPhoneLead> & { id: string }): DossierPhoneLead {
  return {
    list_id: "plist-1",
    list_name: "Akquise Nord",
    list_owner_name: "Kevin",
    decider_name: "Bernd Meier",
    company: "Meier GmbH",
    phone: "+49 30 1234",
    decider_direct_dial: null,
    email: null,
    website: null,
    target_group: null,
    script_label: null,
    status: "aktiv",
    first_call_at: null,
    call_attempt: null,
    gatekeeper_reached: null,
    decider_reached: null,
    pitch_delivered: null,
    mailbox: null,
    answer_sentiment: null,
    callback_at: null,
    appointment_set: null,
    appointment_at: null,
    no_transfer_reason: null,
    no_pitch_reason: null,
    no_appointment_reason: null,
    objection_notes: null,
    notes: null,
    created_at: "2026-08-01T08:00:00.000Z",
    updated_at: "2026-08-01T08:00:00.000Z",
    ...RECYCLE,
    ...partial,
  };
}

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
    created_at: "2026-08-10T08:00:00.000Z",
    updated_at: "2026-08-10T08:00:00.000Z",
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
    created_at: "2026-08-20T08:00:00.000Z",
    updated_at: "2026-08-20T08:00:00.000Z",
    ...RECYCLE,
    ...partial,
  };
}

function attempt(partial: Partial<DossierAttempt> & { id: string; lead_id: string; called_at: string }): DossierAttempt {
  return {
    attempt_no: 1,
    kind: "erstanruf",
    outcome: "nicht_erreicht",
    mailbox: null,
    gatekeeper_reached: null,
    decider_reached: null,
    pitch_delivered: null,
    notes: null,
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

/* ------------------------------------------------------------------ *
 * 1. Zusammenführung
 * ------------------------------------------------------------------ */

describe("Zusammenführung — nur über Fremdschlüssel", () => {
  test("die ganze Kette Kontakt → Erstgespräch → Closing wird belegt zusammengeführt", () => {
    const data = input({
      anchor: { kind: "contact", id: "c1" },
      contacts: [contact({ id: "c1", setting_call_id: "s1" })],
      settings: [setting({ id: "s1", source_contact_id: "c1" })],
      closings: [closing({ id: "cl1", setting_call_id: "s1" })],
    });

    const core = collectCore(data);
    assert.deepEqual([...core.contactIds], ["c1"]);
    assert.deepEqual([...core.settingIds], ["s1"]);
    assert.deepEqual([...core.closingIds], ["cl1"]);

    const d = buildDossier(data);
    assert.equal(d.found, true);
    assert.deepEqual(
      d.members.map((m) => `${m.kind}:${m.id}`),
      ["contact:c1", "setting:s1", "closing:cl1"],
    );
    assert.equal(d.suspected.length, 0);
  });

  test("vom Closing aus rückwärts findet dieselbe Akte — auch der Telefon-Lead", () => {
    // Der Weg zurück ist der schwierigere: Closing → Setting → Quell-Lead.
    const data = input({
      anchor: { kind: "closing", id: "cl1" },
      phoneLeads: [phoneLead({ id: "p1" })],
      settings: [setting({ id: "s1", source_phone_lead_id: "p1", source_type: "telefon" })],
      closings: [closing({ id: "cl1", setting_call_id: "s1" })],
    });

    const d = buildDossier(data);
    assert.deepEqual(
      d.members.map((m) => `${m.kind}:${m.id}`).sort(),
      ["closing:cl1", "phone_lead:p1", "setting:s1"],
    );
    // Die Begründung steht an der Kante und wird in der Karte gezeigt.
    const lead = d.members.find((m) => m.kind === "phone_lead");
    assert.match(lead!.via, /source_phone_lead_id/);
    assert.equal(lead!.confidence, "belegt");
  });

  test("gleicher Firmenname OHNE Fremdschlüssel wird Vermutung, nicht Mitglied", () => {
    const data = input({
      anchor: { kind: "contact", id: "c1" },
      contacts: [contact({ id: "c1", pitched_at: "2026-08-01" })],
      // Derselbe Firmenname, andere Person, keine Verknüpfung: Bernd ist nicht
      // Anna. Sein Anruf darf in Annas Zeitleiste nicht auftauchen.
      phoneLeads: [phoneLead({ id: "p1", decider_name: "Bernd Meier", first_call_at: "2026-09-08" })],
    });

    const d = buildDossier(data);
    assert.deepEqual(d.members.map((m) => m.id), ["c1"]);
    assert.deepEqual(d.suspected.map((s) => `${s.kind}:${s.id}`), ["phone_lead:p1"]);
    assert.equal(d.suspected[0].confidence, "vermutet");
    assert.match(d.suspected[0].via, /Vermutung/);

    // Und die entscheidende Gegenprobe: der fremde Anruf zählt nirgends mit.
    assert.equal(d.events.some((e) => e.source === "telefon"), false);
    assert.equal(d.lastContact.at, "2026-08-01");
  });

  test("derselbe Firmenname MIT Fremdschlüssel ist keine Vermutung mehr", () => {
    // Sobald ein Termin den Telefon-Lead als Quelle nennt, ist der Bezug
    // belegt — dann gehört er in die Akte und in die Zeitleiste.
    const data = input({
      anchor: { kind: "contact", id: "c1" },
      contacts: [contact({ id: "c1", setting_call_id: "s1" })],
      phoneLeads: [phoneLead({ id: "p1", first_call_at: "2026-09-08" })],
      settings: [setting({ id: "s1", source_contact_id: "c1", source_phone_lead_id: "p1" })],
    });

    const d = buildDossier(data);
    assert.equal(d.suspected.length, 0);
    assert.deepEqual(
      d.members.map((m) => m.kind).sort(),
      ["contact", "phone_lead", "setting"],
    );
    assert.equal(d.events.some((e) => e.source === "telefon"), true);
  });

  test("Firmennamen werden für die Vermutung normalisiert, aber nicht verbogen", () => {
    assert.equal(normalizeCompany("  Meier   GmbH. "), "meier gmbh");
    assert.equal(normalizeCompany("MEIER GMBH"), normalizeCompany("Meier GmbH"));
    // Rechtsform bleibt stehen: zwei Firmen, zwei Akten.
    assert.notEqual(normalizeCompany("Meier GmbH"), normalizeCompany("Meier AG"));
    // Zu kurz, um irgendetwas zu unterscheiden.
    assert.equal(normalizeCompany("AG"), null);
    assert.equal(normalizeCompany(null), null);
  });

  test("Anwahlen und Nachfass-Stempel fremder Zeilen bleiben draußen", () => {
    const data = input({
      anchor: { kind: "contact", id: "c1" },
      contacts: [contact({ id: "c1", setting_call_id: "s1" })],
      settings: [
        setting({ id: "s1", source_contact_id: "c1" }),
        // Gleiche Firma, kein Fremdschlüssel — und jemand hat dort gestern
        // nachgefasst. Das darf weder in der Leiste stehen noch „zuletzt
        // kontaktiert" verjüngen.
        setting({ id: "s-fremd", follow_up_last_contacted_at: "2026-09-08T10:00:00.000Z" }),
      ],
      phoneLeads: [phoneLead({ id: "p-fremd" })],
      attempts: [attempt({ id: "a1", lead_id: "p-fremd", called_at: "2026-09-07T09:00:00.000Z" })],
    });

    const d = buildDossier(data);
    assert.equal(d.events.some((e) => e.id === "attempt:a1"), false);
    assert.equal(d.events.some((e) => e.id === "setting:s-fremd:followed_up"), false);
    // Der eigene Pitch bleibt der jüngste Kontakt — das fremde Nachfassen von
    // gestern hätte die Zahl sonst um einen Monat verjüngt.
    assert.equal(d.lastContact.at, "2026-08-01");
  });
});

/* ------------------------------------------------------------------ *
 * 2. Sortierung
 * ------------------------------------------------------------------ */

describe("Zeitleiste", () => {
  test("Vergangenes absteigend, Geplantes aufsteigend — über beide Zeitgenauigkeiten", () => {
    const data = input({
      anchor: { kind: "phone_lead", id: "p1" },
      phoneLeads: [
        phoneLead({
          id: "p1",
          first_call_at: "2026-08-03", // Tagesdatum
          callback_at: "2026-09-12T09:00:00.000Z", // Zukunft
          next_recycle_at: "2026-10-01", // Zukunft, Tagesdatum
        }),
      ],
      attempts: [
        attempt({
          id: "a2",
          lead_id: "p1",
          called_at: "2026-09-01T09:00:00.000Z",
          attempt_no: 2,
          kind: "folgeanruf",
          outcome: "rueckruf",
          gatekeeper_reached: "ja",
        }),
        attempt({ id: "a1", lead_id: "p1", called_at: "2026-08-03T09:00:00.000Z", mailbox: true }),
      ],
    });

    const d = buildDossier(data);
    // Neuestes zuerst — und der Erstkontakt-Tag entfällt, weil das Anruf-Log
    // ihn bereits als Anwahl 1 trägt (sonst stünde er doppelt da).
    assert.deepEqual(d.events.map((e) => e.id), ["attempt:a2", "attempt:a1"]);
    assert.deepEqual(d.upcoming.map((e) => e.id), ["lead:p1:callback", "lead:p1:recycle_due"]);

    // Die Zeitgenauigkeit wird mitgeführt, nicht weggerundet.
    assert.equal(d.upcoming[1].precision, "day");
    assert.equal(d.events[0].precision, "moment");
  });

  test("ohne Anruf-Log bleibt der Tag des Erstkontakts stehen", () => {
    const d = buildDossier(
      input({
        anchor: { kind: "phone_lead", id: "p1" },
        phoneLeads: [phoneLead({ id: "p1", first_call_at: "2026-08-03" })],
      }),
    );
    const first = d.events.find((e) => e.id === "lead:p1:first_call");
    assert.ok(first, "Erstkontakt fehlt");
    assert.equal(first!.precision, "day");
    assert.match(first!.detail!, /Kein Anruf-Log/);
  });

  test("ein Tagesdatum sortiert zwischen die Uhrzeiten desselben Tages, nicht davor", () => {
    // Mitternacht als Ersatzzeit hätte den Pitch vor den Anruf desselben
    // Morgens geschoben; die Mittagsregel hält ihn dazwischen.
    const data = input({
      anchor: { kind: "contact", id: "c1" },
      contacts: [contact({ id: "c1", pitched_at: "2026-09-01", setting_call_id: "s1" })],
      settings: [setting({ id: "s1", source_contact_id: "c1", source_phone_lead_id: "p1" })],
      phoneLeads: [phoneLead({ id: "p1" })],
      attempts: [
        attempt({ id: "a-frueh", lead_id: "p1", called_at: "2026-09-01T06:00:00.000Z" }),
        attempt({ id: "a-spaet", lead_id: "p1", called_at: "2026-09-01T20:00:00.000Z", attempt_no: 2 }),
      ],
    });

    const d = buildDossier(data);
    const order = d.events.filter((e) => e.source !== "setting").map((e) => e.id);
    assert.deepEqual(order, ["attempt:a-spaet", "contact:c1:pitch", "attempt:a-frueh"]);
  });
});

/* ------------------------------------------------------------------ *
 * 3. Zuletzt kontaktiert
 * ------------------------------------------------------------------ */

describe("Zuletzt kontaktiert", () => {
  test("zählt über alle Quellen und nimmt die jüngste", () => {
    const data = input({
      anchor: { kind: "contact", id: "c1" },
      contacts: [contact({ id: "c1", pitched_at: "2026-08-01", setting_call_id: "s1" })],
      // Der Nachfass-Stempel aus der Terminliste ist der jüngste echte Kontakt.
      settings: [
        setting({
          id: "s1",
          source_contact_id: "c1",
          follow_up_last_contacted_at: "2026-09-04T09:00:00.000Z",
          follow_up_last_contacted_username: "Kevin",
        }),
      ],
    });

    const d = buildDossier(data);
    assert.equal(d.lastContact.at, "2026-09-04T09:00:00.000Z");
    assert.equal(d.lastContact.source, "setting");
    assert.equal(d.lastContact.daysAgo, 5);
    assert.equal(d.lastContact.label, "vor 5 Tagen");
    assert.equal(d.lastContact.estimated, false);
  });

  test("ein gebuchter Termin ist kein Kontakt, ein geführter schon", () => {
    const gebucht = buildDossier(
      input({
        anchor: { kind: "setting", id: "s1" },
        // Termin steht noch bevor: kein Kontakt, nichts zu zählen.
        settings: [setting({ id: "s1", appointment_at: "2026-09-20T08:00:00.000Z" })],
      }),
    );
    assert.equal(gebucht.lastContact.at, null);
    assert.equal(gebucht.lastContact.label, "noch nie kontaktiert");

    const gefuehrt = buildDossier(
      input({
        anchor: { kind: "setting", id: "s1" },
        settings: [
          setting({ id: "s1", appointment_at: "2026-09-08T08:00:00.000Z", show_status: "show", status: "closing_gelegt" }),
        ],
      }),
    );
    assert.equal(gefuehrt.lastContact.at, "2026-09-08T08:00:00.000Z");
    assert.equal(gefuehrt.lastContact.daysAgo, 1);
    assert.equal(gefuehrt.lastContact.label, "gestern");

    // Ein No-Show ist ausdrücklich KEIN Kontakt — da war niemand.
    const noShow = buildDossier(
      input({
        anchor: { kind: "setting", id: "s1" },
        settings: [setting({ id: "s1", appointment_at: "2026-09-08T08:00:00.000Z", show_status: "no_show" })],
      }),
    );
    assert.equal(noShow.lastContact.at, null);
  });

  test("ein Follow-up ohne Zeitstempel wird als geschätzt ausgewiesen", () => {
    // Die App speichert nur die erreichte Stufe. Statt einen Zeitpunkt zu
    // erfinden, sagt das Dossier, dass die Zahl ungenau ist.
    const d = buildDossier(
      input({
        anchor: { kind: "contact", id: "c1" },
        contacts: [
          contact({
            id: "c1",
            pitched_at: "2026-08-01",
            follow_up_number: 2,
            updated_at: "2026-09-05T09:00:00.000Z",
          }),
        ],
      }),
    );
    assert.equal(d.lastContact.at, "2026-09-05T09:00:00.000Z");
    assert.equal(d.lastContact.estimated, true);
    assert.equal(d.lastContact.caveats.length, 1);
    assert.match(d.lastContact.caveats[0], /FU2/);
  });

  test("Sperre und Blockade stehen als Warnung oben, nicht nur in der Leiste", () => {
    const d = buildDossier(
      input({
        anchor: { kind: "contact", id: "c1" },
        contacts: [
          contact({
            id: "c1",
            blocked_at: "2026-09-01T09:00:00.000Z",
            recycle_excluded_at: "2026-09-02T09:00:00.000Z",
          }),
        ],
      }),
    );
    assert.equal(d.warnings.length, 2);
    assert.ok(d.warnings.some((w) => /blockiert/.test(w)));
    assert.ok(d.warnings.some((w) => /gesperrt/i.test(w)));
  });
});
