// Vorlagen: Auflösungskette, Platzhalter, Prüfung.
//
// Warum gerade hier Tests: Ein Fehler in diesem Modul erzeugt keine
// Fehlermeldung, sondern eine falsche Nachricht an einen echten Lead — die
// rohe Klammer im Text oder der Standardtext der Organisation unter dem Namen
// einer Person, die ihn längst überschrieben hat.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  LIST_SCOPED_KEYS,
  TEMPLATE_DEFAULTS,
  TEMPLATE_KEYS,
  renderTemplate,
  resolveTemplate,
  validateTemplate,
} from "@/lib/messageTemplates";
import type { TemplateBundle, TemplateKey } from "@/lib/messageTemplates";

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

    // Eine Übersteuerung ohne Betreff liefert null, nicht den Betreff der Stufe darunter.
    const overridden = resolveTemplate("setting_mail_1", bundle({ own: { setting_mail_1: { body: "nur Text" } } }));
    assert.equal(overridden.source, "persoenlich");
    assert.equal(overridden.subject, null);
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
});
