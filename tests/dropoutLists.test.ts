// Die Ablage — zwei Ansichten, vier Grund-Familien in EINER Spalte.
//
// Zwei Zusicherungen tragen diese Datei:
//
// 1. `DROPOUT_REASON_LABELS` legt vier Code-Familien (Absage, Disqualifikation,
//    Verlust, Recycling-Ursprung) in eine einzige Nachschlagetabelle. Das ist
//    nur deshalb gefahrlos, weil die mehrfach vorkommenden Codes in jeder
//    Familie dasselbe Wort tragen. Genau das prüfen die Tests unten gegen
//    Literale — und gegen die CHECK-Listen der eingefrorenen Migration 0032,
//    damit ein neuer DB-Code nicht unbeschriftet durchrutscht.
//
// 2. `listFeedsRecycling()` beantwortet, welche QUELLE überhaupt einen Zweig von
//    `recycle_tasks` speist. Ein vorgezogenes Recycling-Datum auf einer Zeile,
//    die kein Zweig abfragt, wäre unsichtbar: Die Aufgabe tauchte in
//    „Nachfassen" nie auf, und niemand wüsste, warum. Die Wahrheitstabelle
//    steht hier vollständig, weil ein einzelner falscher Eintrag genau so
//    aussieht wie ein leerer Arbeitstag.
//
// SEIT DEM RÜCKBAU fragt sie nach der Quelle der Zeile statt nach der Ansicht.
// Der Grund ist derselbe, aus dem aus sechs Reitern zwei geworden sind: Die
// vier Endzustände liegen jetzt in einer Liste, und dort steht ein verlorenes
// Closing neben einem abgesagten — die Antwort ist innerhalb einer Ansicht
// nicht mehr einheitlich. Die Wahrheitstabelle selbst ist davon unberührt, sie
// beschreibt weiterhin die Status-Zweige von `recycle_tasks`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  DROPOUT_LISTS,
  DROPOUT_REASON_LABELS,
  DROPOUT_SOURCE_LABELS,
  dropoutListMeta,
  dropoutReasonLabel,
  isDropoutListKey,
  listFeedsRecycling,
  parseDropoutList,
  recycleBlockedReason,
  type DropoutEntity,
  type DropoutSourceList,
  type RecycleGate,
} from "@/lib/dropoutLists";

function migration(name: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt auch die
  // Migrationsdateien unter Windows mit CRLF ab; Anker mit `\n` fänden sie
  // sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../supabase/migrations/${name}`, import.meta.url)), "utf8").replace(
    /\r\n/g,
    "\n",
  );
}

const MIGRATION_0032 = migration("20260404000032_reminder_cascade.sql");
const MIGRATION_0033 = migration("20260404000033_lead_recycling.sql");

/** Die Codes einer `check (… in ('a', 'b', …))`-Liste aus dem Migrationstext. */
function codesFromCheck(sql: string, constraint: string): string[] {
  const found = new RegExp(`${constraint}[\\s\\S]{0,400}?\\bin\\s*\\(([^)]*)\\)`).exec(sql);
  assert.ok(found, `CHECK ${constraint} nicht in der Migration gefunden`);
  return [...found[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/* ------------------------------------------------------------------ *
 * Die sechs Listen
 * ------------------------------------------------------------------ */

describe("DROPOUT_LISTS", () => {
  test("zwei Ansichten: der Aktenschrank, dann das Verbot", () => {
    // Die Sperrliste ist keine Stufe des Funnels, sondern eine Anweisung — und
    // steht deshalb hinten.
    assert.deepEqual(DROPOUT_LISTS.map((l) => l.key), ["ausgeschieden", "gesperrt"]);
  });

  test("jede Quelle, die die App schickt, kennt die eingefrorene RPC", () => {
    // Die RPC wirft bei jedem anderen Wert. Eine Ansicht, deren Quelle die
    // Datenbank nicht kennt, führte auf eine Seite mit einer Ausnahme statt
    // einer Liste.
    const erlaubt = /p_list not in \(([\s\S]{0,300}?)\)\s*then/.exec(MIGRATION_0033);
    assert.ok(erlaubt, "Die Prüfliste von dropout_lists() wurde nicht gefunden");
    const ausDerDb = new Set([...erlaubt[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
    assert.equal(ausDerDb.size, 6);
    for (const meta of DROPOUT_LISTS) {
      for (const source of meta.sources) {
        assert.ok(ausDerDb.has(source), `${meta.key}: ${source} kennt die RPC nicht`);
      }
    }
  });

  test("„ersatztermin_offen“ wird bewusst NICHT mehr abgefragt", () => {
    // Der sechste RPC-Wert beschreibt keinen Endzustand, sondern einen Lead
    // ohne nächsten Termin — also genau den, der in der Hauptliste steht und
    // täglich kontaktiert wird. Ein Archivreiter daneben wäre eine zweite,
    // stille Arbeitsliste. Die RPC kennt den Wert weiterhin (sie ist
    // eingefroren, Gegenprobe im Test darüber) — die App sendet ihn nicht.
    const gesendet = DROPOUT_LISTS.flatMap((l) => [...l.sources]);
    assert.equal(gesendet.includes("ersatztermin_offen" as DropoutSourceList), false);
    assert.match(MIGRATION_0033, /'ersatztermin_offen'/);
  });

  test("die vier Endzustände liegen in EINER Ansicht", () => {
    // Vier Reiter für „ist raus" trugen, solange der Grund die Wartezeit bis
    // zum nächsten Versuch bestimmte. Eine Frist für alle heißt: Der
    // Unterschied löst nichts mehr aus und gehört auf die Karte, nicht in die
    // Navigation.
    assert.deepEqual([...dropoutListMeta("ausgeschieden").sources], [
      "disqualifiziert",
      "kein_close",
      "abgesagt",
      "no_show_ohne_antwort",
    ]);
    assert.deepEqual([...dropoutListMeta("gesperrt").sources], ["gesperrt"]);
  });

  test("die Vorrangkette beim Entdoppeln stellt den aussagekräftigsten Grund nach vorn", () => {
    // Dieselbe Zeile kann in mehreren Quellen stehen (ein disqualifiziertes
    // Erstgespräch, das später abgesagt wurde). Vorn muss stehen, was einen
    // eigenen Grund-Code mitbringt — die RPC liefert für den No-Show gar
    // keinen, und aus der Absage kommt nur der Absagegrund.
    const sources = [...dropoutListMeta("ausgeschieden").sources];
    assert.ok(sources.indexOf("disqualifiziert") < sources.indexOf("abgesagt"));
    assert.ok(sources.indexOf("kein_close") < sources.indexOf("abgesagt"));
    assert.equal(sources[sources.length - 1], "no_show_ohne_antwort");

    // Und der Nebeneffekt, auf dem die Karte steht: Wo eine Zeile über mehrere
    // Quellen erreichbar ist, gewinnt die, deren Zweig auch wirklich ein
    // Recycling speist. Für ein Closing ist das ausschließlich `kein_close`.
    const ersteFuerClosing = sources.find((s) => listFeedsRecycling(s, "closing"));
    assert.equal(ersteFuerClosing, "kein_close");
  });

  test("nur die Sperrliste liefert org-weit", () => {
    // Ein Kontaktverbot, das nur sein Besitzer sieht, ist keines. Umgekehrt
    // dürfte keine andere Liste die Datensicht aushebeln.
    for (const meta of DROPOUT_LISTS) {
      assert.equal(meta.orgWide === true, meta.key === "gesperrt", meta.key);
    }
  });

  test("jede Ansicht bringt Reiter, Titel, Kurztext, Herleitung und Quellen mit", () => {
    // Die Herleitung steht hinter dem Info-Icon und ist die einzige Stelle, an
    // der ein Nutzer erfährt, WORAUS die Zeilen abgeleitet wurden.
    for (const meta of DROPOUT_LISTS) {
      for (const feld of ["tab", "title", "meta", "derivation"] as const) {
        assert.ok(meta[feld].trim().length > 0, `${meta.key}.${feld}`);
      }
      assert.ok(meta.sources.length > 0, `${meta.key}.sources`);
    }
  });

  test("dropoutListMeta liefert zu jedem Schlüssel genau seine Zeile", () => {
    for (const meta of DROPOUT_LISTS) {
      assert.equal(dropoutListMeta(meta.key).key, meta.key);
    }
    assert.equal(dropoutListMeta("gesperrt").title, "Sperrliste");
  });

  test("jede Quelle trägt ein Kennzeichen für die Karte", () => {
    // In der zusammengelegten Ansicht ist das die einzige Stelle, an der die
    // vier Endzustände noch auseinandergehalten werden — vorher trug das der
    // Reitername. Ein fehlendes Kennzeichen wäre eine leere Stelle auf der
    // Karte, kein Fehler, und fiele deshalb nicht auf.
    for (const meta of DROPOUT_LISTS) {
      for (const source of meta.sources) {
        assert.ok(DROPOUT_SOURCE_LABELS[source]?.trim().length > 0, source);
      }
    }
    assert.equal(DROPOUT_SOURCE_LABELS.kein_close, "Kein Close");
    assert.equal(DROPOUT_SOURCE_LABELS.no_show_ohne_antwort, "No-Show ohne Antwort");
  });
});

describe("parseDropoutList / isDropoutListKey", () => {
  test("ein bekannter Schlüssel bleibt unangetastet", () => {
    for (const meta of DROPOUT_LISTS) {
      assert.equal(parseDropoutList(meta.key), meta.key);
      assert.equal(isDropoutListKey(meta.key), true, meta.key);
    }
  });

  test("die alten Reiter-Adressen führen dorthin, wo ihr Inhalt jetzt liegt", () => {
    // Sie stehen in Lesezeichen und in geteilten Links. Ohne diese Zuordnung
    // landete jeder davon stumm auf der ersten Ansicht — bei „gesperrt" wäre
    // das die falsche.
    for (const alt of ["abgesagt", "disqualifiziert", "kein_close", "no_show_ohne_antwort"]) {
      assert.equal(parseDropoutList(alt), "ausgeschieden", alt);
      // Sie sind KEINE gültigen Ansichts-Schlüssel mehr — sonst schriebe die
      // Umschaltleiste sie wieder in die URL.
      assert.equal(isDropoutListKey(alt), false, alt);
    }
    assert.equal(parseDropoutList("gesperrt"), "gesperrt");
  });

  test("alles Unbekannte fällt auf die erste Ansicht zurück, statt zu werfen", () => {
    // Der Wert kommt aus der URL — ein Tippfehler darf keine Fehlerseite geben.
    // `ersatztermin_offen` steht bewusst dabei: Sein Inhalt ist in die
    // Hauptliste gewandert, nicht ins Archiv; es gibt hier keine Ansicht, auf
    // die er ehrlich zeigen könnte.
    for (const murks of ["", "Gesperrt", "kein-close", "ersatztermin_offen", null, undefined, 42, {}]) {
      assert.equal(parseDropoutList(murks), "ausgeschieden", String(murks));
      assert.equal(isDropoutListKey(murks), false, String(murks));
    }
  });
});

/* ------------------------------------------------------------------ *
 * Gründe: vier Familien, eine Tabelle
 * ------------------------------------------------------------------ */

/** Absagegründe — CHECK `*_cancel_reason_code_chk` (Migration 0032). */
const ABSAGE: Record<string, string> = {
  kein_neuer_termin: "Kein neuer Termin",
  krank: "Krank",
  familiaer: "Familiär",
  beruflich: "Beruflich",
  preis: "Preis",
  sonstiges: "Sonstiges",
};

/** Disqualifizierungsgründe — CHECK `setting_calls_disqualify_reason_code_chk`. */
const DISQUALIFIKATION: Record<string, string> = {
  geld: "Geld",
  kein_budget: "Kein Budget",
  kein_bedarf: "Kein Bedarf",
  falscher_zeitpunkt: "Falscher Zeitpunkt",
  kein_entscheider: "Kein Entscheider",
  falsche_zielgruppe: "Falsche Zielgruppe",
  keine_zusammenarbeit: "Keine Zusammenarbeit",
  sonstiges: "Sonstiges",
};

/** Verlustgründe — CHECK `closing_calls_lost_reason_code_chk`. */
const VERLUST: Record<string, string> = {
  preis: "Preis",
  timing: "Timing",
  kein_bedarf: "Kein Bedarf",
  entscheider: "Entscheider",
  wettbewerb: "Wettbewerb",
  vertrauen: "Vertrauen",
  ghosting: "Ghosting",
  falsche_zielgruppe: "Falsche Zielgruppe",
  kein_fit: "Kein Fit",
  sonstiges: "Sonstiges",
};

/** Die beiden Ursprungs-Token der Lead-Tabellen (kein DB-Enum, docs §4). */
const RECYCLING_URSPRUNG: Record<string, string> = {
  dead: "Dead",
  fu_exhausted: "Ohne Antwort",
};

describe("dropoutReasonLabel", () => {
  test("beschriftet jeden Absagegrund", () => {
    for (const [code, label] of Object.entries(ABSAGE)) {
      assert.equal(dropoutReasonLabel(code), label, code);
    }
  });

  test("beschriftet jeden Disqualifizierungsgrund", () => {
    for (const [code, label] of Object.entries(DISQUALIFIKATION)) {
      assert.equal(dropoutReasonLabel(code), label, code);
    }
  });

  test("beschriftet jeden Verlustgrund", () => {
    for (const [code, label] of Object.entries(VERLUST)) {
      assert.equal(dropoutReasonLabel(code), label, code);
    }
  });

  test("beschriftet die beiden Ursprünge der Sperrliste", () => {
    // 'dead' und 'fu_exhausted' liefert nur `recycle_tasks`; ohne sie stünde in
    // der Sperrliste eines LinkedIn-Kontakts der rohe Token.
    for (const [code, label] of Object.entries(RECYCLING_URSPRUNG)) {
      assert.equal(dropoutReasonLabel(code), label, code);
    }
  });

  test("mehrfach vorkommende Codes tragen in JEDER Familie dasselbe Wort", () => {
    // Genau diese Zusicherung macht das Zusammenlegen der vier Maps
    // ungefährlich. Bräche sie, hinge die Beschriftung davon ab, in welcher
    // Reihenfolge die Maps zusammengeschüttet werden — und dieselbe Zeile
    // hieße je nach Liste anders.
    const familien = { ABSAGE, DISQUALIFIKATION, VERLUST, RECYCLING_URSPRUNG };
    const gesehen = new Map<string, { label: string; familie: string }>();
    let ueberschneidungen = 0;

    for (const [familie, map] of Object.entries(familien)) {
      for (const [code, label] of Object.entries(map)) {
        const vorher = gesehen.get(code);
        if (vorher) {
          ueberschneidungen++;
          assert.equal(label, vorher.label, `${code}: ${familie} vs. ${vorher.familie}`);
        } else {
          gesehen.set(code, { label, familie });
        }
        assert.equal(dropoutReasonLabel(code), label, code);
      }
    }
    // Gegenprobe, damit der Test nicht leer durchläuft: preis, kein_bedarf,
    // falsche_zielgruppe und sonstiges kommen mehrfach vor (sonstiges dreimal).
    assert.equal(ueberschneidungen, 5);
  });

  test("ein unbekannter Code wird roh gezeigt, nicht still als 'Sonstiges' verbucht", () => {
    // Sonst verschwände ein neuer DB-Code lautlos in einer Sammelzeile.
    assert.equal(dropoutReasonLabel("grund_von_2027"), "grund_von_2027");
  });

  test("ohne Grund steht 'Ohne Grund'", () => {
    assert.equal(dropoutReasonLabel(null), "Ohne Grund");
  });

  test("jeder Code, den die Datenbank zulässt, hat eine Beschriftung", () => {
    // Der Gegencheck zu den Literalen oben: Die eingefrorene Migration 0032 ist
    // die Autorität über die Schlüsselmenge.
    const proCheck: [string, string, Record<string, string>][] = [
      ["setting_calls_cancel_reason_code_chk", "Absage", ABSAGE],
      ["setting_calls_disqualify_reason_code_chk", "Disqualifikation", DISQUALIFIKATION],
      ["closing_calls_lost_reason_code_chk", "Verlust", VERLUST],
    ];
    for (const [constraint, familie, literale] of proCheck) {
      const ausDerDb = codesFromCheck(MIGRATION_0032, constraint).sort();
      assert.ok(ausDerDb.length >= 6, `${familie}: nur ${ausDerDb.length} Codes gefunden`);
      assert.deepEqual(ausDerDb, Object.keys(literale).sort(), familie);
      for (const code of ausDerDb) {
        assert.ok(DROPOUT_REASON_LABELS[code], `${familie}: ${code} ohne Beschriftung`);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Welche Liste speist das Recycling?
 * ------------------------------------------------------------------ */

describe("listFeedsRecycling", () => {
  /** Vollständige Wahrheitstabelle: 5 Quellen × 4 Ursprünge. */
  const SOLL: Record<DropoutSourceList, Record<DropoutEntity, boolean>> = {
    // Absage ohne Aussicht: nur am Erstgespräch ein Recycling-Zweig
    // (`cancel_outlook = 'ohne_aussicht'`); beim Closing verlangt der Zweig
    // `status = 'verloren'`, eine Absage erfüllt das nicht.
    abgesagt: { setting: true, closing: false, linkedin: false, telefon: false },
    disqualifiziert: { setting: true, closing: false, linkedin: false, telefon: false },
    kein_close: { setting: false, closing: true, linkedin: false, telefon: false },
    no_show_ohne_antwort: { setting: true, closing: false, linkedin: false, telefon: false },
    // Die Sperrliste speist grundsätzlich nichts.
    gesperrt: { setting: false, closing: false, linkedin: false, telefon: false },
  };

  test("die Wahrheitstabelle stimmt in allen 20 Feldern", () => {
    let geprueft = 0;
    for (const [source, proEntity] of Object.entries(SOLL) as [DropoutSourceList, Record<DropoutEntity, boolean>][]) {
      for (const [entity, soll] of Object.entries(proEntity) as [DropoutEntity, boolean][]) {
        assert.equal(listFeedsRecycling(source, entity), soll, `${source} × ${entity}`);
        geprueft++;
      }
    }
    assert.equal(geprueft, 20);
  });

  test("in EINER Ansicht liegen Zeilen mit und ohne Recycling-Zweig nebeneinander", () => {
    // Genau deshalb fragt die Funktion nach der Quelle und nicht mehr nach der
    // Ansicht: „Ausgeschieden" trägt beides. Wäre die Antwort weiter je Ansicht,
    // bekäme entweder ein abgesagtes Closing einen Knopf, der nichts bewirkt,
    // oder ein verlorenes verlöre den, der wirkt.
    assert.equal(listFeedsRecycling("kein_close", "closing"), true);
    assert.equal(listFeedsRecycling("abgesagt", "closing"), false);
    const sources = [...dropoutListMeta("ausgeschieden").sources];
    assert.ok(sources.includes("kein_close") && sources.includes("abgesagt"));
  });

  test("LinkedIn- und Telefon-Leads speisen aus keiner Quelle heraus", () => {
    // Sie erscheinen nur in der Sperrliste, und dort weist `excluded` jede
    // Wiedervorlage ohnehin ab.
    for (const source of Object.keys(SOLL) as DropoutSourceList[]) {
      assert.equal(listFeedsRecycling(source, "linkedin"), false, source);
      assert.equal(listFeedsRecycling(source, "telefon"), false, source);
    }
  });

  test("die drei Setting-Zweige stehen wörtlich so in recycle_tasks", () => {
    // Gegenprobe gegen die eingefrorene Migration 0033: Verschwindet einer der
    // drei Zweige dort, zeigt die Ablage einen Knopf, der nichts bewirkt.
    const settingZweig = /-- Erstgespräch: dead oder unqualifiziert[\s\S]{0,1400}?union all/.exec(MIGRATION_0033);
    assert.ok(settingZweig, "Setting-Zweig von recycle_tasks nicht gefunden");
    assert.match(settingZweig[0], /sc\.status in \('dead', 'unqualifiziert'\)/);
    assert.match(settingZweig[0], /sc\.no_show_resolution = 'ohne_antwort'/);
    assert.match(settingZweig[0], /sc\.cancel_outlook = 'ohne_aussicht'/);
  });

  test("der Closing-Zweig kennt AUSSCHLIESSLICH 'verloren'", () => {
    const closingZweig = /-- Closing: verloren[\s\S]{0,1200}?;\s*$/m.exec(MIGRATION_0033);
    assert.ok(closingZweig, "Closing-Zweig von recycle_tasks nicht gefunden");
    assert.match(closingZweig[0], /cc\.status = 'verloren'/);
    // Eine Absage oder ein No-Show am Closing steht in der Ablage, speist aber
    // kein Recycling — sonst wäre `listFeedsRecycling` zu streng.
    assert.doesNotMatch(closingZweig[0], /cc\.cancel_outlook/);
    assert.doesNotMatch(closingZweig[0], /cc\.no_show_resolution/);
  });
});

/* ------------------------------------------------------------------ *
 * Darf das Recycling vorgezogen werden?
 * ------------------------------------------------------------------ */

describe("recycleBlockedReason", () => {
  /** Eine Zeile, bei der nichts im Weg steht. */
  function offen(over: Partial<RecycleGate> = {}): RecycleGate {
    return {
      entity: "closing",
      excluded: false,
      revived: false,
      responded: false,
      reasonCode: "timing",
      attemptCount: 0,
      maxAttempts: 2,
      inRecycleBranch: true,
      ...over,
    };
  }

  test("ohne Hindernis ist das Vorziehen erlaubt", () => {
    assert.equal(recycleBlockedReason(offen()), null);
    assert.equal(recycleBlockedReason(offen({ reasonCode: null })), null);
  });

  test("die Reihenfolge der Sperren steht fest — die Sperre schlägt alles", () => {
    // Alle sechs Hindernisse zugleich; danach eines nach dem anderen entfernen.
    // So steht die Rangfolge als Kette da, statt in sechs Einzeltests.
    const alles = offen({
      entity: "setting",
      excluded: true,
      revived: true,
      responded: true,
      reasonCode: "falsche_zielgruppe",
      attemptCount: 9,
      inRecycleBranch: false,
    });
    assert.equal(
      recycleBlockedReason(alles),
      "Dauerhaft gesperrt — eine Wiedervorlage widerspräche der Sperre.",
    );
    assert.equal(
      recycleBlockedReason({ ...alles, excluded: false }),
      "Der Vorgang ist bereits zurück im Funnel.",
    );
    assert.equal(
      recycleBlockedReason({ ...alles, excluded: false, revived: false }),
      "Der Lead hat auf einen Recycling-Versuch schon reagiert.",
    );
    assert.equal(
      recycleBlockedReason({ ...alles, excluded: false, revived: false, responded: false }),
      "„Falsche Zielgruppe“ bekommt bewusst nie eine Wiedervorlage.",
    );
    assert.equal(
      recycleBlockedReason({
        ...alles,
        excluded: false,
        revived: false,
        responded: false,
        reasonCode: "timing",
      }),
      "Der Deckel von 2 Versuchen ist erreicht.",
    );
    assert.equal(
      recycleBlockedReason({
        ...alles,
        excluded: false,
        revived: false,
        responded: false,
        reasonCode: "timing",
        attemptCount: 0,
      }),
      "Dieser Vorgang speist keinen Zweig von „Nachfassen“ — eine Wiedervorlage bliebe unsichtbar.",
    );
  });

  test("die 'nie wieder'-Codes gelten je Termin-Art, nicht global", () => {
    // Jede Termin-Art hat ihre eigene Grund-Familie: 'keine_zusammenarbeit'
    // gibt es nur als Disqualifizierungsgrund, 'kein_fit' nur als Verlustgrund.
    // Ein globaler Code-Topf würde beide auf beiden Seiten sperren und damit
    // Zeilen aus dem Recycling nehmen, die hineingehören.
    const nie = (entity: DropoutEntity, code: string) =>
      recycleBlockedReason(offen({ entity, reasonCode: code, inRecycleBranch: true }));

    assert.equal(nie("setting", "falsche_zielgruppe"), "„Falsche Zielgruppe“ bekommt bewusst nie eine Wiedervorlage.");
    assert.equal(nie("setting", "keine_zusammenarbeit"), "„Keine Zusammenarbeit“ bekommt bewusst nie eine Wiedervorlage.");
    assert.equal(nie("setting", "kein_fit"), null);

    assert.equal(nie("closing", "falsche_zielgruppe"), "„Falsche Zielgruppe“ bekommt bewusst nie eine Wiedervorlage.");
    assert.equal(nie("closing", "kein_fit"), "„Kein Fit“ bekommt bewusst nie eine Wiedervorlage.");
    assert.equal(nie("closing", "keine_zusammenarbeit"), null);
  });

  test("dieselben Codes stehen in schedule_recycle() (Migration 0033)", () => {
    // Zwei Wahrheiten wären hier teuer: Der Knopf verspräche eine Wiedervorlage,
    // die die Datenbank dann doch nicht anlegt (oder umgekehrt).
    assert.match(MIGRATION_0033, /in \('falsche_zielgruppe', 'kein_fit'\)/);
    assert.match(MIGRATION_0033, /in \('falsche_zielgruppe', 'keine_zusammenarbeit'\)/);
  });

  test("der Versuchs-Deckel greift beim Erreichen, nicht erst beim Überschreiten", () => {
    assert.equal(recycleBlockedReason(offen({ attemptCount: 1, maxAttempts: 2 })), null);
    assert.equal(
      recycleBlockedReason(offen({ attemptCount: 2, maxAttempts: 2 })),
      "Der Deckel von 2 Versuchen ist erreicht.",
    );
    assert.equal(
      recycleBlockedReason(offen({ attemptCount: 3, maxAttempts: 2 })),
      "Der Deckel von 2 Versuchen ist erreicht.",
    );
    // Der Deckel wird angezeigt, nicht geraten: Er kommt aus pipeline_settings.
    assert.equal(
      recycleBlockedReason(offen({ attemptCount: 4, maxAttempts: 5 })),
      null,
    );
    assert.equal(
      recycleBlockedReason(offen({ attemptCount: 5, maxAttempts: 5 })),
      "Der Deckel von 5 Versuchen ist erreicht.",
    );
  });

  test("eine Quelle ohne Recycling-Zweig sperrt den Knopf mit eigener Begründung", () => {
    // Der Fall, der ohne diesen Zweig am teuersten wäre: Alles sieht erlaubt
    // aus, das Datum wird gesetzt — und die Aufgabe erscheint nie. Er steht
    // seit der Zusammenlegung MITTEN in der Liste: Das abgesagte Closing hier
    // liegt in derselben Ansicht wie das verlorene darunter.
    assert.equal(
      recycleBlockedReason(
        offen({ entity: "closing", inRecycleBranch: listFeedsRecycling("abgesagt", "closing") }),
      ),
      "Dieser Vorgang speist keinen Zweig von „Nachfassen“ — eine Wiedervorlage bliebe unsichtbar.",
    );
    assert.equal(
      recycleBlockedReason(
        offen({ entity: "closing", inRecycleBranch: listFeedsRecycling("kein_close", "closing") }),
      ),
      null,
    );
  });
});
