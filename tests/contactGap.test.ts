// Kontaktfrequenz: „Wann haben wir diesen Lead zuletzt angefasst?"
//
// Die Zahl löst eine Warnung aus und steht wortgleich auf drei Seiten (Dossier,
// Nachfassen, Erinnerungen). Zwei Dinge müssen deshalb festliegen: Sie zählt
// BERLINER KALENDERTAGE und keine 24-Stunden-Blöcke — „gestern 23:00" ist
// gestern, auch wenn es zwei Stunden her ist —, und sie heißt überall gleich.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CONTACT_GAP_WARN_DAYS,
  contactAgeDays,
  contactGapWindowStart,
  dayDiff,
  isWithinContactGap,
  lastContactLabel,
} from "@/lib/contactGap";

describe("dayDiff", () => {
  test("zählt ganze Kalendertage, vorwärts wie rückwärts", () => {
    assert.equal(dayDiff("2026-09-01", "2026-09-08"), 7);
    assert.equal(dayDiff("2026-09-08", "2026-09-01"), -7);
    assert.equal(dayDiff("2026-09-08", "2026-09-08"), 0);
  });

  test("eine Zeitumstellung verschluckt und erfindet keinen Tag", () => {
    // In Berlin hat der 29.3.2026 nur 23 und der 25.10.2026 25 Stunden. Würde
    // die Differenz in Ortszeit gerechnet, käme hier 1 bzw. 3 statt 2 heraus —
    // ein Lead wäre zweimal im Jahr einen Tag zu alt oder zu jung.
    assert.equal(dayDiff("2026-03-28", "2026-03-30"), 2);
    assert.equal(dayDiff("2026-10-24", "2026-10-26"), 2);
    // Über eine ganze Sommerzeit-Periode hinweg (1.3. → 1.11.2026).
    assert.equal(dayDiff("2026-03-01", "2026-11-01"), 245);
  });

  test("Monats-, Jahres- und Schaltjahresgrenzen stimmen", () => {
    assert.equal(dayDiff("2025-12-31", "2026-01-01"), 1);
    assert.equal(dayDiff("2026-01-31", "2026-02-01"), 1);
    assert.equal(dayDiff("2024-02-28", "2024-03-01"), 2);
    assert.equal(dayDiff("2026-02-28", "2026-03-01"), 1);
  });

  test("eine unlesbare Eingabe ergibt 0 statt NaN", () => {
    // Ein NaN würde sich durch jede Beschriftung fressen („vor NaN Tagen").
    assert.equal(dayDiff("gestern", "2026-09-08"), 0);
    assert.equal(dayDiff("2026-09-08", ""), 0);
  });
});

describe("contactAgeDays", () => {
  test("ohne Kontakt gibt es kein Alter — und keine 0", () => {
    // 0 hieße „heute kontaktiert"; das ist etwas völlig anderes als „noch nie".
    assert.equal(contactAgeDays(null), null);
    assert.equal(contactAgeDays(undefined), null);
    assert.equal(contactAgeDays(""), null);
  });

  test("zählt Kalendertage, keine 24-Stunden-Blöcke", () => {
    // Der Fall aus dem Kopf der Datei: Kontakt am 7.9. um 23:00 Berlin,
    // jetzt ist es der 8.9. um 01:00 Berlin. Zwei Stunden her — aber gestern.
    const kontakt = "2026-09-07T21:00:00Z"; // 7.9., 23:00 Berlin
    const jetzt = "2026-09-07T23:00:00Z"; // 8.9., 01:00 Berlin
    assert.equal(contactAgeDays(kontakt, jetzt), 1);
    assert.equal(lastContactLabel(contactAgeDays(kontakt, jetzt)), "gestern");
  });

  test("kurz nach Mitternacht Berlin ist heute, obwohl UTC noch auf gestern steht", () => {
    // 22:30 UTC am 7.9. = 00:30 Berlin am 8.9. Wer den UTC-Datumsteil liest,
    // meldet hier „gestern" und warnt eine Runde zu früh.
    assert.equal(contactAgeDays("2026-09-07T22:30:00Z", "2026-09-08T09:00:00Z"), 0);
    assert.equal(lastContactLabel(0), "heute");
  });

  test("eine reine Datumsangabe wird wie ein Zeitstempel gelesen", () => {
    assert.equal(contactAgeDays("2026-09-01", "2026-09-08T10:00:00Z"), 7);
  });

  test("ein Kontakt in der Zukunft ist nicht negativ alt", () => {
    // Kommt bei umterminierten Erinnerungen vor; „vor -2 Tagen" wäre Unsinn.
    assert.equal(contactAgeDays("2026-09-10T10:00:00Z", "2026-09-08T10:00:00Z"), 0);
  });

  test("die Zeitumstellung ändert das Alter nicht", () => {
    assert.equal(contactAgeDays("2026-03-28T12:00:00Z", "2026-03-30T12:00:00Z"), 2);
    assert.equal(contactAgeDays("2026-10-24T12:00:00Z", "2026-10-26T12:00:00Z"), 2);
  });

  test("ohne zweiten Zeitpunkt gilt jetzt", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-08T08:00:00Z") });
    assert.equal(contactAgeDays("2026-09-08T06:00:00Z"), 0);
    assert.equal(contactAgeDays("2026-09-05T06:00:00Z"), 3);
  });
});

describe("lastContactLabel", () => {
  test("beschriftet jede Stufe wörtlich so, wie sie auf allen drei Seiten steht", () => {
    assert.equal(lastContactLabel(null), "noch nie kontaktiert");
    assert.equal(lastContactLabel(0), "heute");
    assert.equal(lastContactLabel(1), "gestern");
    assert.equal(lastContactLabel(2), "vor 2 Tagen");
    assert.equal(lastContactLabel(3), "vor 3 Tagen");
    assert.equal(lastContactLabel(42), "vor 42 Tagen");
  });
});

describe("CONTACT_GAP_WARN_DAYS", () => {
  test("die Warnschwelle steht bei 3 Tagen", () => {
    // Eine Code-Konstante, bewusst keine Organisationseinstellung: eine
    // konfigurierbare Sperre kollidierte mit der Kaskadenstufe „eine Stunde
    // vorher".
    assert.equal(CONTACT_GAP_WARN_DAYS, 3);
  });

  test("innerhalb der Schwelle wird gewarnt, ab der Schwelle nicht mehr", () => {
    const jetzt = "2026-09-08T10:00:00Z";
    const warnt = (kontakt: string) => (contactAgeDays(kontakt, jetzt) ?? Infinity) < CONTACT_GAP_WARN_DAYS;
    assert.equal(warnt("2026-09-08T09:00:00Z"), true); // heute
    assert.equal(warnt("2026-09-07T09:00:00Z"), true); // gestern
    assert.equal(warnt("2026-09-06T09:00:00Z"), true); // vor 2 Tagen
    assert.equal(warnt("2026-09-05T09:00:00Z"), false); // vor 3 Tagen
    // Und ohne je kontaktiert worden zu sein, warnt nichts.
    assert.equal((contactAgeDays(null, jetzt) ?? Infinity) < CONTACT_GAP_WARN_DAYS, false);
  });

  test("die Schwelle liegt auf derselben Körnung wie die Beschriftung", () => {
    // Der Fall, an dem Schwelle und Beschriftung auseinanderliefen: Kontakt am
    // 7.9. um 23:00 Berlin, jetzt ist es der 10.9. um 01:00 Berlin — 50 Stunden
    // her, aber DREI Kalendertage. Die Boards rechneten mit
    // `now - last < CONTACT_GAP_WARN_DAYS * 86_400_000` (24-Stunden-Blöcke) und
    // warnten deshalb, während die Karte daneben „vor 3 Tagen" schrieb, also
    // genau die Schwelle. Seit `isWithinContactGap` gibt es nur noch eine
    // Auswertung, und sie zählt Kalendertage wie die Beschriftung.
    const kontakt = "2026-09-07T21:00:00Z";
    const jetzt = "2026-09-09T23:00:00Z";
    assert.equal(contactAgeDays(kontakt, jetzt), 3);
    assert.equal(isWithinContactGap(kontakt, jetzt), false);

    // Gegenprobe auf derselben Stundenlage, aber einen Kalendertag jünger.
    assert.equal(contactAgeDays("2026-09-08T21:00:00Z", jetzt), 2);
    assert.equal(isWithinContactGap("2026-09-08T21:00:00Z", jetzt), true);
  });
});

describe("isWithinContactGap", () => {
  test("beantwortet dieselbe Frage wie die Beschriftung daneben", () => {
    const jetzt = "2026-09-08T10:00:00Z";
    assert.equal(isWithinContactGap("2026-09-08T09:00:00Z", jetzt), true); // heute
    assert.equal(isWithinContactGap("2026-09-07T09:00:00Z", jetzt), true); // gestern
    assert.equal(isWithinContactGap("2026-09-06T09:00:00Z", jetzt), true); // vor 2 Tagen
    assert.equal(isWithinContactGap("2026-09-05T09:00:00Z", jetzt), false); // vor 3 Tagen
  });

  test("ohne Kontakt wird nicht gewarnt", () => {
    assert.equal(isWithinContactGap(null), false);
    assert.equal(isWithinContactGap(undefined), false);
    assert.equal(isWithinContactGap(""), false);
  });
});

describe("contactGapWindowStart", () => {
  test("das Ladefenster schließt jeden noch warnenden Kontakt ein", () => {
    // Ungünstigster Fall: es ist kurz vor Mitternacht Berlin, der älteste noch
    // warnende Kontakt liegt am Anfang seines Kalendertages. Ein knapperes
    // Fenster verlöre ihn, und die Warnung bliebe stumm.
    const jetzt = "2026-09-08T21:30:00Z"; // 8.9., 23:30 Berlin
    const aeltester = "2026-09-05T22:10:00Z"; // 6.9., 00:10 Berlin → vor 2 Tagen
    assert.equal(isWithinContactGap(aeltester, jetzt), true);
    assert.ok(contactGapWindowStart(jetzt) <= aeltester, contactGapWindowStart(jetzt));
  });
});
