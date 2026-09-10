// Vorlagen: Auflösungskette, Platzhalter, Prüfung.
//
// Warum gerade hier Tests: Ein Fehler in diesem Modul erzeugt keine
// Fehlermeldung, sondern eine falsche Nachricht an einen echten Lead — die
// rohe Klammer im Text oder der Standardtext der Organisation unter dem Namen
// einer Person, die ihn längst überschrieben hat.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  LIST_SCOPED_KEYS,
  PLACEHOLDERS,
  PREVIEW_EXAMPLE,
  PREVIEW_LABEL,
  TEMPLATE_DEFAULTS,
  TEMPLATE_KEYS,
  TEMPLATE_META,
  renderTemplate,
  resolveTemplate,
  templateWriteErrorMessage,
  validateTemplate,
} from "@/lib/messageTemplates";
import type { TemplateBundle, TemplateKey } from "@/lib/messageTemplates";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const EMPTY: TemplateBundle = { own: {}, org: {} };

function bundle(part: Partial<TemplateBundle>): TemplateBundle {
  return { own: part.own ?? {}, org: part.org ?? {} };
}

/* ------------------------------------------------------------------ *
 * resolveTemplate — die vier Stufen der Vorrangkette
 * ------------------------------------------------------------------ */

describe("resolveTemplate", () => {
  test("Stufe 1: der Text der Liste schlägt persönlich und Organisation", () => {
    const b = bundle({
      own: { linkedin_fu_1: { body: "persönlicher Text" } },
      org: { linkedin_fu_1: { body: "Org-Text" } },
    });
    const r = resolveTemplate("linkedin_fu_1", b, "  Text der Liste  ");
    assert.equal(r.source, "liste");
    // Der Listentext wird getrimmt übernommen, nicht roh.
    assert.equal(r.body, "Text der Liste");
    assert.equal(r.subject, null);
  });

  test("Stufe 2: die persönliche Vorlage schlägt die der Organisation", () => {
    const b = bundle({
      own: { setting_msg_1: { body: "meiner" } },
      org: { setting_msg_1: { body: "der der Organisation" } },
    });
    const r = resolveTemplate("setting_msg_1", b);
    assert.equal(r.source, "persoenlich");
    assert.equal(r.body, "meiner");
  });

  test("Stufe 3: ohne persönliche Vorlage greift die der Organisation", () => {
    const b = bundle({ org: { setting_msg_1: { body: "der der Organisation" } } });
    const r = resolveTemplate("setting_msg_1", b);
    assert.equal(r.source, "organisation");
    assert.equal(r.body, "der der Organisation");
  });

  test("Stufe 4: ohne alles der Auslieferungstext", () => {
    const r = resolveTemplate("setting_msg_1", EMPTY);
    assert.equal(r.source, "auslieferung");
    assert.equal(r.body, TEMPLATE_DEFAULTS.setting_msg_1.body);
  });

  test("kein Bundle (null/undefined) ist wie ein leeres", () => {
    for (const b of [null, undefined]) {
      const r = resolveTemplate("closing_msg_2", b);
      assert.equal(r.source, "auslieferung");
      assert.equal(r.body, TEMPLATE_DEFAULTS.closing_msg_2.body);
    }
  });

  test("ein leerer Text ist keine Vorlage — die Kette läuft weiter", () => {
    // Ein geleertes Feld soll die Stufe abschalten, nicht eine leere Nachricht
    // erzeugen. Whitespace zählt als leer.
    const b = bundle({
      own: { setting_msg_1: { body: "   \n  " } },
      org: { setting_msg_1: { body: "der der Organisation" } },
    });
    assert.equal(resolveTemplate("setting_msg_1", b).source, "organisation");

    const onlyBlank = bundle({ own: { setting_msg_1: { body: "" } }, org: { setting_msg_1: { body: " " } } });
    assert.equal(resolveTemplate("setting_msg_1", onlyBlank).source, "auslieferung");
  });

  test("die Listen-Stufe gilt NUR für linkedin_fu_1..3", () => {
    // Der Text der Liste ist der Nachfasstext DIESER Liste. Griffe er auch für
    // Termin-Erinnerungen, bekäme ein Lead die LinkedIn-Nachfassnachricht als
    // Terminbestätigung.
    assert.deepEqual([...LIST_SCOPED_KEYS], ["linkedin_fu_1", "linkedin_fu_2", "linkedin_fu_3"]);

    for (const key of LIST_SCOPED_KEYS) {
      assert.equal(resolveTemplate(key, EMPTY, "Listentext").source, "liste", key);
    }

    const others = TEMPLATE_KEYS.filter((k) => !LIST_SCOPED_KEYS.includes(k));
    assert.ok(others.length > 0);
    for (const key of others) {
      const r = resolveTemplate(key, EMPTY, "Listentext");
      assert.equal(r.source, "auslieferung", `${key} darf den Listentext nicht ziehen`);
      assert.equal(r.body, TEMPLATE_DEFAULTS[key].body, key);
    }
  });

  test("ein leerer Listentext schaltet die Listen-Stufe ab", () => {
    for (const listText of [null, undefined, "", "   "]) {
      const r = resolveTemplate("linkedin_fu_1", EMPTY, listText);
      assert.equal(r.source, "auslieferung");
    }
  });

  test("der Betreff wird durchgereicht, wo es einen gibt", () => {
    const fromDefault = resolveTemplate("setting_mail_1", EMPTY);
    assert.equal(fromDefault.subject, TEMPLATE_DEFAULTS.setting_mail_1.subject);
    assert.ok(fromDefault.subject);
  });

  test("Betreff und Text laufen UNABHÄNGIG durch die Kette (K11)", () => {
    // Der Editor hat für den Betreff gar kein Feld — eine persönliche
    // Mail-Vorlage ohne Betreff ist deshalb der Normalfall, nicht die
    // Ausnahme. Hing der Betreff am Fundort des Textes, verlor genau dieser
    // Normalfall den Betreff der Ebene darunter, und die Mail ginge betrefflos
    // raus. Heute folgenlos (Mail-Spur inaktiv), beim Aktivieren von Phase 2
    // nicht mehr.
    const b = bundle({
      own: { setting_mail_1: { body: "nur Text" } },
      org: { setting_mail_1: { body: "Text der Organisation", subject: "Betreff der Organisation" } },
    });
    const r = resolveTemplate("setting_mail_1", b);
    assert.equal(r.source, "persoenlich");
    assert.equal(r.body, "nur Text");
    assert.equal(r.subject, "Betreff der Organisation");

    // Gibt es auch dort keinen, greift der Auslieferungs-Betreff.
    const ohneOrg = resolveTemplate("setting_mail_1", bundle({ own: { setting_mail_1: { body: "nur Text" } } }));
    assert.equal(ohneOrg.subject, TEMPLATE_DEFAULTS.setting_mail_1.subject);

    // Ein eigener Betreff schlägt den darunter — die Kette gilt in beide Richtungen.
    const eigener = resolveTemplate(
      "setting_mail_1",
      bundle({
        own: { setting_mail_1: { body: "nur Text", subject: "  mein Betreff  " } },
        org: { setting_mail_1: { body: "Org", subject: "Betreff der Organisation" } },
      }),
    );
    assert.equal(eigener.subject, "mein Betreff");
  });

  test("eine Vorlage ohne Betreff bleibt ohne Betreff", () => {
    // Kein Nicht-Mail-Key hat einen Auslieferungs-Betreff — die Kette darf
    // keinen erfinden.
    for (const key of TEMPLATE_KEYS) {
      if (TEMPLATE_DEFAULTS[key].subject) continue;
      assert.equal(resolveTemplate(key, EMPTY).subject, null, key);
    }
  });

  test("jeder Katalog-Schlüssel hat einen Auslieferungstext", () => {
    // Ein Key ohne Default ließe resolveTemplate mit undefined.body abstürzen.
    for (const key of TEMPLATE_KEYS) {
      const r = resolveTemplate(key, EMPTY);
      assert.equal(typeof r.body, "string", key);
      assert.ok(r.body.trim().length > 0, `${key} hat einen leeren Auslieferungstext`);
    }
  });
});

/* ------------------------------------------------------------------ *
 * renderTemplate — Platzhalter
 * ------------------------------------------------------------------ */

describe("renderTemplate", () => {
  test("{name} ist ein Alias auf {vorname} — der teuerste Regressionsfall", () => {
    // In lists.fuN_text stehen gespeicherte Texte im alten {name}-Dialekt.
    // Fällt der Alias weg, geht die rohe Klammer an echte Leads raus, ohne
    // dass irgendwo eine Fehlermeldung erscheint.
    const ctx = { leadName: "Anna Schmidt" };
    assert.equal(renderTemplate("Hi {name}, kurz gefragt.", ctx), "Hi Anna, kurz gefragt.");
    assert.equal(renderTemplate("Hi {name}!", ctx), renderTemplate("Hi {vorname}!", ctx));

    // Und der Auslieferungstext der LinkedIn-Sequenz, der ihn benutzt.
    const rendered = renderTemplate(TEMPLATE_DEFAULTS.linkedin_fu_1.body, ctx);
    assert.ok(rendered.includes("Anna"));
    assert.ok(!rendered.includes("{"), rendered);
  });

  test("{name} nimmt den Vornamen, nicht den vollen Namen", () => {
    // Das Label sagt „voller Name" — gerendert wird bewusst der Vorname, damit
    // Alt-Texte gleich klingen wie neue.
    assert.equal(renderTemplate("{name}", { leadName: "Anna Schmidt" }), "Anna");
    assert.equal(renderTemplate("{nachname}", { leadName: "Anna Schmidt" }), "Schmidt");
    // Einteiliger Name: kein Nachname, kein Rest vom Vornamen.
    assert.equal(renderTemplate("{vorname}|{nachname}", { leadName: "Cher" }), "Cher|");
  });

  test("Ersetzung ist case-insensitiv", () => {
    const ctx = { leadName: "Max Mustermann", company: "Acme GmbH" };
    assert.equal(renderTemplate("{Vorname} von {FIRMA}", ctx), "Max von Acme GmbH");
    assert.equal(renderTemplate("{VoRnAmE}", ctx), "Max");
  });

  test("unbekannte Token bleiben unangetastet", () => {
    // Sichtbar stehen lassen statt still löschen: ein Tippfehler soll auffallen,
    // und validateTemplate meldet ihn im Editor.
    const out = renderTemplate("Hi {vorname}, {vornmae} {kunde}", { leadName: "Max" });
    assert.ok(out.includes("{vornmae}"), out);
    assert.ok(out.includes("{kunde}"), out);
    assert.ok(out.startsWith("Hi Max,"), out);
  });

  test("leere Platzhalter kollabieren sauber", () => {
    // "Hallo {vorname} von {firma}," ohne Firma darf nicht "Hallo Max von ,"
    // ergeben — genau das ging bisher an Leads raus.
    const out = renderTemplate("Hallo {vorname} von {firma},", { leadName: "Max Mustermann", company: null });
    assert.equal(out, "Hallo Max,");
    assert.ok(!out.includes(" ,"));
    assert.ok(!/\bvon\s*,/.test(out));

    // Mit Firma bleibt der Satz vollständig.
    assert.equal(
      renderTemplate("Hallo {vorname} von {firma},", { leadName: "Max Mustermann", company: "Acme GmbH" }),
      "Hallo Max von Acme GmbH,",
    );
  });

  test("ein verwaistes Verbindungswort am Zeilenende fällt weg", () => {
    const out = renderTemplate("Hi {vorname}, kurze Frage zu {firma}", { leadName: "Max", company: "" });
    assert.equal(out, "Hi Max, kurze Frage");
  });

  test("ALLE elf Verbinder fallen mit ihrem leeren Platzhalter weg — auch „über“ (M7)", () => {
    // Der Test prüfte bisher nur „zu". „über" fiel deshalb jahrelang durch:
    // `\b` ist in JavaScript ASCII-basiert, `ü` ist dort kein Wortzeichen, und
    // zwischen Leerzeichen und `ü` liegt damit keine Wortgrenze — `\büber\b`
    // griff NIE. Aus „Frage über {firma}." wurde ohne Firma „Frage über.".
    // Trifft keinen Auslieferungstext, wohl aber jeden selbst geschriebenen.
    const VERBINDER = ["von", "bei", "für", "aus", "in", "mit", "zu", "an", "nach", "über", "um"];

    for (const wort of VERBINDER) {
      assert.equal(
        renderTemplate(`Kurze Frage ${wort} {firma}.`, { company: null }),
        "Kurze Frage.",
        `„${wort}" bleibt hängen`,
      );
      // Gegenprobe: mit Wert bleibt der Satz vollständig.
      assert.equal(
        renderTemplate(`Kurze Frage ${wort} {firma}.`, { company: "Acme GmbH" }),
        `Kurze Frage ${wort} Acme GmbH.`,
        wort,
      );
    }

    // Groß geschrieben dieselbe Regel — auch beim Umlaut.
    assert.equal(renderTemplate("Kurze Frage ÜBER {firma}.", { company: "" }), "Kurze Frage.");
    assert.equal(renderTemplate("Kurze Frage Über {firma}.", { company: "" }), "Kurze Frage.");
  });

  test("ein Verbinder, der nur zufällig in einem Wort steckt, bleibt stehen", () => {
    // Die Wortgrenze muss Umlaute mitzählen, darf aber weiterhin keine
    // Wortmitte treffen — sonst verlöre „Umsatz" sein „Um" und „zufrieden"
    // sein „zu".
    assert.equal(renderTemplate("Wir sprechen über Umsatz {firma}.", { company: "" }), "Wir sprechen über Umsatz.");
    assert.equal(renderTemplate("Ich bin zufrieden {firma}.", { company: "" }), "Ich bin zufrieden.");
    assert.equal(renderTemplate("Der Termin {firma}.", { company: "" }), "Der Termin.");
  });

  test("kein Auslieferungstext kündigt einen Link an, den es nicht geben muss (M8)", () => {
    // Ein Erstgespräch mit meeting_kind='telefon' hat keinen meet_link — die
    // Rufnummer steht in setting_calls.phone und ist gar kein Platzhalter.
    // „wollte dir noch einmal den Link durchschicken." ging dort ohne Link
    // raus: der Satz blieb, der Gegenstand fehlte.
    for (const key of TEMPLATE_KEYS) {
      const def = TEMPLATE_DEFAULTS[key];
      for (const [teil, text] of [
        ["Text", def.body],
        ["Betreff", def.subject],
      ] as const) {
        if (!text || !/\{link\}/i.test(text)) continue;
        const out = renderTemplate(text, {
          leadName: "Anna Schmidt",
          company: "Acme GmbH",
          appointmentAtIso: "2026-07-20T08:00:00.000Z",
          link: null,
          absender: "Simon",
        });
        assert.ok(!/link/i.test(out), `${key} (${teil}) spricht ohne Link vom Link: "${out}"`);
        // Und der Satz trägt trotzdem noch: er darf nicht zum Fragment werden.
        assert.ok(out.trim().length > 0, `${key} (${teil}) fällt ohne Link ganz weg`);
      }
    }
  });

  test("mit Link steht der Link auch drin", () => {
    // Gegenprobe zu M8: Die Umformulierung darf den Link nicht verlieren.
    for (const key of ["setting_msg_3", "closing_msg_3"] as const) {
      const out = renderTemplate(TEMPLATE_DEFAULTS[key].body, {
        leadName: "Anna Schmidt",
        appointmentAtIso: "2026-07-20T08:00:00.000Z",
        link: "https://meet.example/abc",
      });
      assert.ok(out.includes("https://meet.example/abc"), `${key}: ${out}`);
    }
  });

  test("der Beispiel-Lead der Vorschau füllt jeden Platzhalter", () => {
    // Die Vorschau im Editor rendert gegen PREVIEW_EXAMPLE. Bliebe dort ein
    // Wert leer, zeigte ausgerechnet die Vorschau einen zusammengefallenen
    // Satz — und niemand wüsste, ob das am Text liegt oder am Beispiel.
    for (const p of PLACEHOLDERS) {
      const out = renderTemplate(`[{${p}}]`, PREVIEW_EXAMPLE);
      assert.ok(out !== "[]", `{${p}} bleibt im Beispiel leer`);
    }
    // Die Beschriftung der Vorschau nennt diese Werte wörtlich — sie darf
    // nicht vom Beispiel abdriften.
    assert.equal(renderTemplate("{vorname} {nachname}", PREVIEW_EXAMPLE), "Max Meier");
    assert.equal(renderTemplate("{firma}", PREVIEW_EXAMPLE), "Muster GmbH");
    assert.equal(renderTemplate("{datum}, {uhrzeit}", PREVIEW_EXAMPLE), "Do 17.07., 14:00");
  });

  test(
    "das Aufräumen darf nur verwaiste Wörter treffen, keine echten Satzenden",
    // Bekannter Defekt, hier festgehalten statt stillschweigend akzeptiert:
    // tidy() prüft nur „Verbindungswort direkt vor einem Satzzeichen", nicht
    // „durch einen leeren Platzhalter verwaist". Ein Satz, der regulär auf
    // mit/zu/in/bei/von/für/aus endet — im Deutschen die abgetrennte Vorsilbe
    // („die Unterlagen mit.") — verliert dieses Wort, obwohl gar kein
    // Platzhalter kollabiert ist. Trifft keine Auslieferungsvorlage, wohl aber
    // selbst geschriebene Listen- und Nutzertexte.
    () => {
      assert.equal(
        renderTemplate("Hi {vorname}, ich bringe die Unterlagen mit.", { leadName: "Max" }),
        "Hi Max, ich bringe die Unterlagen mit.",
      );
      assert.equal(
        renderTemplate("Hi {vorname}, das machen wir so mit; passt das?", { leadName: "Max" }),
        "Hi Max, das machen wir so mit; passt das?",
      );
    },
  );

  test("Zeilenumbrüche der Mail-Vorlagen bleiben erhalten", () => {
    const out = renderTemplate("Hallo {vorname},\n\nkurze Erinnerung.\n\nGrüße\n{absender}", {
      leadName: "Max",
      absender: "Simon",
    });
    assert.equal(out, "Hallo Max,\n\nkurze Erinnerung.\n\nGrüße\nSimon");
  });

  test("Datum und Uhrzeit kommen in Berliner Wandzeit", () => {
    // 27.10.2026 10:00 Berlin liegt hinter der Zeitumstellung (UTC+1).
    const out = renderTemplate("{datum} um {uhrzeit}", { appointmentAtIso: "2026-10-27T09:00:00.000Z" });
    assert.equal(out, "Di 27.10. um 10:00");
  });

  test("ohne Termin bleiben {datum}/{uhrzeit} leer statt 'Invalid Date'", () => {
    assert.equal(renderTemplate("[{datum}][{uhrzeit}]", { leadName: "Max" }), "[][]");
  });

  test("kein Auslieferungstext lässt einen Trenner zurück, wenn der Wert fehlt", () => {
    // Der teure Fall: „Erstgespräch wieder aufnehmen — {firma}." ging bei einem
    // Kontakt ohne Firma wörtlich als „Erstgespräch wieder aufnehmen —." raus,
    // „unser Termin am {datum}" bei einem Termin ohne Datum als „unser Termin
    // am". `tidy()` räumt NUR Verbindungswörter aus CONNECTORS weg — ein
    // Gedankenstrich, ein Doppelpunkt und die zusammengezogenen Präpositionen
    // (am/im/zum/beim …) bleiben stehen. Deshalb muss jeder optionale Wert im
    // Katalog hinter einem dieser Verbindungswörter oder hinter einem
    // abgeschlossenen Satz sitzen.
    //
    // {anlass} ist bewusst gefüllt: In den vier Recycling-Texten kann er nicht
    // leer werden (RECYCLE_REASON_FALLBACK_HINT in lib/recycleCadence.ts), und
    // die Anlass-Texte sind kleingeschriebene Teilsätze, die genau den Platz
    // hinter dem Gedankenstrich brauchen.
    const leer = { anlass: "vielleicht passt der Zeitpunkt inzwischen besser" };

    const HAENGENDER_TRENNER = /[—–:]\s*(?:[.,;:!?]|$)/;
    // an/in/zu/bei/… stehen in CONNECTORS und werden mitgenommen; die
    // zusammengezogenen Formen nicht — und die können, anders als „mit" oder
    // „an", nie eine abgetrennte Vorsilbe am Satzende sein.
    const HAENGENDE_PRAEPOSITION = /\b(?:am|im|beim|zum|zur|vom|ins|aufs|fürs)\s*(?:[.,;:!?]|$)/i;

    for (const key of TEMPLATE_KEYS) {
      const def = TEMPLATE_DEFAULTS[key];
      for (const [teil, text] of [
        ["Text", def.body],
        ["Betreff", def.subject],
      ] as const) {
        if (!text) continue;
        const out = renderTemplate(text, leer);
        assert.ok(!HAENGENDER_TRENNER.test(out), `${key} (${teil}): hängender Trenner in "${out}"`);
        assert.ok(!HAENGENDE_PRAEPOSITION.test(out), `${key} (${teil}): hängende Präposition in "${out}"`);
        assert.ok(!/\s[,;:!?]/.test(out), `${key} (${teil}): Leerzeichen vor Satzzeichen in "${out}"`);
        assert.ok(out.trim().length > 0, `${key} (${teil}) fällt ohne Werte komplett weg`);
      }
    }
  });

  test("die drei Aufgaben-Texte lesen sich mit und ohne Firma", () => {
    // Namentlich festgehalten, weil genau diese drei auf /nachfassen bei jedem
    // Kontakt ohne Firma sichtbar werden — LinkedIn-Kontakte haben oft keine.
    const ohne = { leadName: "Anna Schmidt" };
    const mit = { ...ohne, company: "Acme GmbH" };

    assert.equal(renderTemplate(TEMPLATE_DEFAULTS.setting_wiedervorlage.body, ohne), "Erstgespräch wieder aufnehmen.");
    assert.equal(
      renderTemplate(TEMPLATE_DEFAULTS.setting_wiedervorlage.body, mit),
      "Erstgespräch mit Acme GmbH wieder aufnehmen.",
    );

    assert.equal(renderTemplate(TEMPLATE_DEFAULTS.closing_wiedervorlage.body, ohne), "Closing nachfassen.");
    assert.equal(renderTemplate(TEMPLATE_DEFAULTS.closing_wiedervorlage.body, mit), "Closing bei Acme GmbH nachfassen.");

    assert.equal(renderTemplate(TEMPLATE_DEFAULTS.telefon_rueckruf.body, ohne), "Rückruf vereinbart — jetzt anrufen.");
    assert.equal(
      renderTemplate(TEMPLATE_DEFAULTS.telefon_rueckruf.body, mit),
      "Rückruf vereinbart — jetzt bei Acme GmbH anrufen.",
    );
  });

  test("alle Auslieferungstexte rendern ohne Restklammer", () => {
    const ctx = {
      leadName: "Anna Schmidt",
      company: "Acme GmbH",
      appointmentAtIso: "2026-07-20T08:00:00.000Z",
      link: "https://meet.example/abc",
      anlass: "vielleicht passt der Zeitpunkt besser",
      notiz: "Budget",
      kanal: "LinkedIn",
      absender: "Simon",
    };
    for (const key of TEMPLATE_KEYS) {
      const def = TEMPLATE_DEFAULTS[key];
      const body = renderTemplate(def.body, ctx);
      assert.ok(!/[{}]/.test(body), `${key}: ${body}`);
      if (def.subject) {
        const subject = renderTemplate(def.subject, ctx);
        assert.ok(!/[{}]/.test(subject), `${key} (Betreff): ${subject}`);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * validateTemplate
 * ------------------------------------------------------------------ */

describe("validateTemplate", () => {
  test("meldet unbekannte Token", () => {
    const { unknownTokens } = validateTemplate("Hi {vorname}, {kunde} und {vornmae}");
    assert.deepEqual(unknownTokens.sort(), ["kunde", "vornmae"]);
  });

  test("meldet bekannte Token NICHT — auch nicht in anderer Schreibweise", () => {
    assert.deepEqual(validateTemplate("{vorname} {nachname} {name} {firma} {datum}").unknownTokens, []);
    assert.deepEqual(validateTemplate("{Vorname} {FIRMA} {UhrZeit}").unknownTokens, []);
  });

  test("meldet jedes unbekannte Token nur einmal, in Originalschreibweise", () => {
    assert.deepEqual(validateTemplate("{Kunde} {Kunde}").unknownTokens, ["Kunde"]);
  });

  test("ein Text ohne Platzhalter meldet nichts", () => {
    assert.deepEqual(validateTemplate("Rückruf vereinbart.").unknownTokens, []);
  });

  test("kein Auslieferungstext enthält ein unbekanntes Token", () => {
    // Fängt einen Tippfehler im Katalog ab, bevor er beim Kunden auffällt.
    for (const key of TEMPLATE_KEYS as readonly TemplateKey[]) {
      const def = TEMPLATE_DEFAULTS[key];
      assert.deepEqual(validateTemplate(def.body).unknownTokens, [], `${key} (Text)`);
      if (def.subject) assert.deepEqual(validateTemplate(def.subject).unknownTokens, [], `${key} (Betreff)`);
    }
  });

  test("Tippfehler mit Ziffer und Platzhalter mit Leerzeichen werden gemeldet (K7)", () => {
    // Das alte Muster `\{([A-Za-zÄÖÜäöüß_]+)\}` erkannte weder `{vorname2}`
    // noch `{ vorname }` — sie wurden weder ersetzt NOCH gemeldet und gingen
    // wörtlich an den Lead. Erkannt wird jetzt alles zwischen geschweiften
    // Klammern; ersetzt weiterhin nur, was exakt passt.
    const r = validateTemplate("Hi {vorname2}, { vorname } {xyz}");
    assert.deepEqual(r.unknownTokens.sort(), [" vorname ", "vorname2", "xyz"]);

    // Gegenprobe: gemeldet heißt nicht ersetzt — der Text geht unverändert raus.
    assert.equal(
      renderTemplate("Hi {vorname2}, { vorname }", { leadName: "Max Mustermann" }),
      "Hi {vorname2}, { vorname }",
    );
  });

  test("leere Klammern sind kein Platzhalter-Versuch und werden nicht gemeldet", () => {
    assert.deepEqual(validateTemplate("Betrag {} und {  }").unknownTokens, []);
  });
});

/* ------------------------------------------------------------------ *
 * validateTemplate je Vorlage — M6
 * ------------------------------------------------------------------ */

describe("validateTemplate je Vorlagenschlüssel", () => {
  test("ein Platzhalter, den dieser Pfad nie füllt, wird gemeldet", () => {
    // Vorher bot der Editor allen 31 Vorlagen dieselben elf Platzhalter an.
    // Ein {notiz} in setting_msg_1 kam durch die Prüfung, verschwand beim
    // Rendern lautlos und ließ den Gedankenstrich davor stehen: „wegen —
    // steht unser Termin". Zu unauffällig zum Bemerken, auffällig genug zum
    // Rausgehen.
    const r = validateTemplate("Hi {vorname}, wegen {notiz} steht unser Termin für {datum}?", "setting_msg_1");
    assert.deepEqual(r.unknownTokens, []);
    assert.deepEqual(r.unsupportedTokens, ["notiz"]);
  });

  test("derselbe Platzhalter ist anderswo völlig richtig", () => {
    // {notiz} ist der Freitext neben dem Grund — den füllt genau der
    // Recycling-Pfad (actions/nachfassen.ts).
    assert.deepEqual(validateTemplate("Damals ging es um {notiz}.", "recycle_closing").unsupportedTokens, []);
    // {anlass} umgekehrt: nur im Recycling.
    assert.deepEqual(validateTemplate("Kurz zu {anlass}.", "recycle_closing").unsupportedTokens, []);
    assert.deepEqual(validateTemplate("Kurz zu {anlass}.", "setting_msg_1").unsupportedTokens, ["anlass"]);
  });

  test("ohne Schlüssel bleibt es bei der globalen Prüfung", () => {
    const r = validateTemplate("Hi {vorname}, wegen {notiz} und {kunde}");
    assert.deepEqual(r.unsupportedTokens, []);
    assert.deepEqual(r.unknownTokens, ["kunde"]);
  });

  test("ein unbekanntes Token wird nicht zusätzlich als „nicht verfügbar“ gemeldet", () => {
    // Zwei Meldungen für denselben Tippfehler wären eine Meldung zu viel —
    // und die falsche: {kunde} verschwindet nicht, es geht mit Klammer raus.
    const r = validateTemplate("{kunde}", "setting_msg_1");
    assert.deepEqual(r.unknownTokens, ["kunde"]);
    assert.deepEqual(r.unsupportedTokens, []);
  });

  test("jeder Schlüssel führt nur Platzhalter, die die App überhaupt kennt", () => {
    for (const key of TEMPLATE_KEYS) {
      for (const p of TEMPLATE_META[key].placeholders) {
        assert.ok((PLACEHOLDERS as readonly string[]).includes(p), `${key}: {${p}} gibt es nicht`);
      }
      // Ohne Namen ist keine Nachricht denkbar — ein leeres Set wäre ein
      // Tippfehler in der Tabelle, kein Befund.
      assert.ok(TEMPLATE_META[key].placeholders.includes("vorname"), key);
    }
  });

  test("kein Auslieferungstext benutzt einen Platzhalter, den sein Pfad nicht füllt", () => {
    // Der strukturelle Nachweis für M5: kein_close_1/2 benutzten {notiz}, und
    // die einzigen beiden Touch-Renderer übergeben kein notiz. Ausgeführt kam
    // „…sag mir gern, was du noch brauchst." heraus — es ging nur deshalb
    // grammatisch gut, weil „zu" in CONNECTORS steht.
    for (const key of TEMPLATE_KEYS) {
      const def = TEMPLATE_DEFAULTS[key];
      for (const [teil, text] of [
        ["Text", def.body],
        ["Betreff", def.subject],
      ] as const) {
        if (!text) continue;
        assert.deepEqual(validateTemplate(text, key).unsupportedTokens, [], `${key} (${teil})`);
      }
    }
  });

  test("die Tabelle deckt den Katalog aus Migration 0031 ab — mit EINER benannten Ausnahme", () => {
    // Der Katalog in der DB ist die Referenz, die Prüfung gehört nach
    // TypeScript (wie die Auslieferungstexte). Diese Abfrage hält beide
    // zusammen: TEMPLATE_META darf MEHR erlauben als der Katalog nennt — die
    // Renderer füllen an mehreren Stellen mehr, als 0031 aufzählt (etwa
    // {absender} in jeder Kaskaden-Stufe) —, aber nichts weglassen.
    //
    // Ausnahme kein_close_1/2 mit {notiz}: Da irrt der KATALOG. Der
    // No-Close-Pfad läuft über die beiden Touch-Renderer, und die übergeben
    // kein notiz. 0031 ist eingefroren, die Zeile lässt sich nur mit einer
    // neuen Migration korrigieren; gelesen wird die Spalte von keiner Zeile
    // Code, der Fehler bleibt damit folgenlos.
    const KATALOG_IRRT: Partial<Record<TemplateKey, string[]>> = {
      kein_close_1: ["notiz"],
      kein_close_2: ["notiz"],
    };

    const sql = read("supabase/migrations/20260404000031_message_templates.sql");
    const zeilen = [...sql.matchAll(/\('([a-z0-9_]+)',\s*'[^']*',\s*'[a-z_]+',\s*array\[([^\]]*)\]/g)];
    assert.equal(zeilen.length, TEMPLATE_KEYS.length, "Katalog und TEMPLATE_KEYS sind verschieden groß");

    for (const [, key, liste] of zeilen) {
      assert.ok(TEMPLATE_KEYS.includes(key as TemplateKey), `${key} fehlt in TEMPLATE_KEYS`);
      const katalog = [...liste.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
      const erlaubt: readonly string[] = TEMPLATE_META[key as TemplateKey].placeholders;
      const ausnahme = KATALOG_IRRT[key as TemplateKey] ?? [];
      for (const p of katalog) {
        if (ausnahme.includes(p)) {
          assert.ok(!erlaubt.includes(p), `${key}: {${p}} steht als Ausnahme drin, wird aber doch erlaubt`);
          continue;
        }
        assert.ok(erlaubt.includes(p), `${key}: Katalog nennt {${p}}, TEMPLATE_META nicht`);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * templateWriteErrorMessage — Deploy-Befund 21
 * ------------------------------------------------------------------ */

describe("templateWriteErrorMessage", () => {
  test("aus 23505 wird ein deutscher Satz statt des Constraint-Namens", () => {
    // Der Schreibpfad liest erst und schreibt dann (die Unique-Indizes aus
    // 0031 sind partiell, ein upsert findet keinen Arbiter). Speichern zwei
    // Sitzungen dieselbe Vorlage gleichzeitig, stand bisher „duplicate key
    // value violates unique constraint …" als Feldfehler unter dem Textfeld.
    const msg = templateWriteErrorMessage({
      code: "23505",
      message: 'duplicate key value violates unique constraint "uq_message_templates_org"',
    });
    assert.ok(!/duplicate|constraint|uq_message_templates/i.test(msg), msg);
    assert.ok(/neu/i.test(msg), `sagt nicht, was zu tun ist: ${msg}`);
  });

  test("jeder andere Fehler bleibt wörtlich stehen", () => {
    // Eine erfundene Übersetzung verdeckte die Ursache — RLS-Verweigerung und
    // fehlende Migration sehen für den Nutzer sonst gleich aus.
    assert.equal(
      templateWriteErrorMessage({ code: "42501", message: "permission denied for table message_templates" }),
      "permission denied for table message_templates",
    );
    assert.equal(templateWriteErrorMessage({ message: "Network error" }), "Network error");
  });
});

/* ------------------------------------------------------------------ *
 * Oberfläche — Deploy-Befund 19
 * ------------------------------------------------------------------ */

describe("PREVIEW_LABEL — die Beschriftung über der Vorschau", () => {
  test("nennt genau die Werte, die PREVIEW_EXAMPLE auch liefert", () => {
    // Die Beschriftung zitiert den Beispiel-Lead wörtlich. Solange sie als
    // modul-lokale Konstante in der Karte stand, las sie kein Test — wer den
    // Beispiel-Lead änderte, behauptete über der Vorschau einen Namen, der
    // darin gar nicht mehr vorkam, und merkte nichts davon.
    assert.ok(PREVIEW_LABEL.includes(renderTemplate("{vorname} {nachname}", PREVIEW_EXAMPLE)), PREVIEW_LABEL);
    assert.ok(PREVIEW_LABEL.includes(renderTemplate("{firma}", PREVIEW_EXAMPLE)), PREVIEW_LABEL);
    assert.ok(PREVIEW_LABEL.includes(renderTemplate("{datum}, {uhrzeit}", PREVIEW_EXAMPLE)), PREVIEW_LABEL);
  });

  test("sagt weiterhin, dass dort der WIRKENDE Text steht", () => {
    // Zwischenzeitlich hieß die Beschriftung nur noch „Beispiel — …". Damit
    // stand über dem Block nicht mehr, dass er die GEWINNENDE Ebene der
    // Vorrangkette zeigt und nicht zwingend den eigenen Entwurf; die ganze
    // Information hing am Badge daneben.
    assert.match(PREVIEW_LABEL, /Wirkt bei dir/);
  });

  test("die Karte benutzt sie, statt eine zweite zu führen", () => {
    const card = read("src/components/settings/MessageTemplatesCard.tsx");
    assert.match(card, /PREVIEW_LABEL/);
    assert.doesNotMatch(card, /const PREVIEW_LABEL/);
  });
});

/* ------------------------------------------------------------------ *
 * MessageTemplatesCard — am Quelltext geprüft
 * ------------------------------------------------------------------ *
 * Die Karte ist eine Client-Komponente mit JSX; der Runner
 * (`node --experimental-strip-types`) lädt sie nicht, und eine Attrappe
 * bewiese nur, dass die Attrappe stimmt. Dieselbe Bauart wie
 * tests/analyseVerdrahtung.test.ts.
 */

describe("MessageTemplatesCard", () => {
  const CARD = read("src/components/settings/MessageTemplatesCard.tsx");

  test("die Vorschau löst gegen den ENTWURF auf, nicht gegen den gespeicherten Stand", () => {
    // Vorher rendete der Block `resolveTemplate(templateKey, bundle)` — den
    // Stand aus dem Server-Bundle. Wer tippte, sah die Vorschau nicht
    // mitlaufen; sie sprang erst nach dem Speichern um (revalidatePath), also
    // genau dann nicht, wenn man sie braucht.
    assert.match(CARD, /resolveTemplate\(templateKey, merged\)/);
    assert.doesNotMatch(CARD, /resolveTemplate\(templateKey, bundle\)/);
    assert.match(CARD, /const entwurf = value\.trim\(\)/);
  });

  test("der Entwurf ersetzt NUR seine eigene Ebene, die Kette bleibt bestehen", () => {
    // Sonst zeigte die Vorschau den Org-Entwurf eines Owners, für den selbst
    // eine persönliche Vorlage gilt — also einen Text, der bei ihm gar nicht
    // wirkt. Die Beschriftung darüber verspricht „Wirkt bei dir".
    assert.match(CARD, /\{ \.\.\.bundle\.org, \[templateKey\]: entwurf \}/);
    assert.match(CARD, /\{ \.\.\.bundle\.own, \[templateKey\]: entwurf \}/);
  });

  test("die Entwürfe liegen in der Karte, nicht in der Zeile", () => {
    // Eine Zeile wird beim Suchen neu aufgebaut (Trefferfilter, und der
    // Collapsible-Key wechselt beim ersten getippten Zeichen). Lag der Entwurf
    // im useState der Zeile, war ein ungespeicherter Text danach weg — lautlos
    // und ausgelöst von einer Eingabe an ganz anderer Stelle.
    assert.match(CARD, /const \[drafts, setDrafts\] = useState<Record<string, string>>/);
    assert.doesNotMatch(CARD, /useState\(stored\)/);
    // Ebene im Schlüssel: sonst trüge der Umschalter den halb getippten
    // Org-Standard in die persönliche Vorlage hinüber.
    assert.match(CARD, /const draftKey = `\$\{level\}-\$\{key\}`/);
  });

  test("bei aktiver Suche zählt auch der Mail-Block Treffer", () => {
    // `mailKeys` ist dann bereits gefiltert. „5 Vorlagen" stand daneben in den
    // Gruppen als „2 Treffer" — dieselbe Zahl, zwei Bedeutungen.
    assert.match(CARD, /mailKeys\.length\} Treffer/);
    assert.match(CARD, /keys\.length\} Treffer/);
  });

  test("der Listen-Vorbehalt steht einmal je Zeile, nicht zweimal", () => {
    // Das Badge trug zusätzlich „· Liste geht vor" — in derselben Zeile, in
    // der TEMPLATE_META den Hinweis schon sichtbar führt. Und es behauptete
    // ihn auch dort, wo gar keine Liste einen eigenen FU-Text trägt: Die Karte
    // bekommt die Listentexte nicht übergeben und kann beide Fälle nicht
    // unterscheiden.
    assert.doesNotMatch(CARD, /· Liste geht vor/);
    for (const key of LIST_SCOPED_KEYS) {
      assert.equal(TEMPLATE_META[key].hint, "Text der Liste geht vor", key);
    }
    // Als Regel bleibt er am Badge im title — dort liest er sich nicht als
    // Befund über diesen einen Kontakt.
    assert.match(CARD, /Trägt die Liste einen eigenen Nachfass-Text/);
  });
});

/* ------------------------------------------------------------------ *
 * Settings-Seite — eine Speichern-Konvention statt zweier
 * ------------------------------------------------------------------ */

describe("Speichern-Knöpfe der Settings-Seite", () => {
  test("kein ✓-Knopf mehr neben den Ziel-Feldern", () => {
    // Beide Karten daneben waren längst auf „Speichern" umgestellt; die
    // Ziele-Sektion trug als einzige noch das Häkchen. Ohne Hover war dort
    // nicht zu erkennen, ob der Knopf speichert oder etwas abhakt.
    const page = read("src/app/(dashboard)/settings/page.tsx");
    assert.doesNotMatch(page, />\s*✓\s*</);
    assert.doesNotMatch(page, /title="Ziel speichern"/);
    assert.match(page, /Speichern\s*<\/Button>/);
  });

  test("der Stil des ✓-Knopfs ist mit ihm verschwunden", () => {
    // Ein exportierter Stil ohne Aufrufer sieht aus wie die geltende
    // Konvention — und wäre der nächste, den jemand wieder einbaut.
    const styles = read("src/components/settings/settingsStyles.ts");
    assert.doesNotMatch(styles, /export const SAVE_BUTTON/);
  });
});

describe("PipelineSettingsCard", () => {
  test("der Hinweis nennt BEIDE Gründe ohne Recycling", () => {
    // Es sind zwei Codes: 'falsche_zielgruppe' und 'kein_fit' (Migration 0033,
    // CHECK auf closing_calls). Der sichtbare Satz nannte nur den ersten —
    // wer „Kein Fit" wählt, wartet dann auf eine Wiedervorlage, die nie kommt.
    const quelle = read("src/components/settings/PipelineSettingsCard.tsx");
    const hinweis = quelle.slice(quelle.indexOf("Recycling — Wartezeit"));
    assert.ok(/Falsche Zielgruppe/.test(hinweis));
    assert.ok(/Kein Fit/.test(hinweis), "„Kein Fit“ fehlt im sichtbaren Hinweis");
  });
});
