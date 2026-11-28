// Die zehn Punkte der finalen Analyse vom 28.11.2026 — Regeln als Verhalten,
// Verdrahtung am Quelltext.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  badgeZahl,
  gruppeVon,
  gruppiere,
  heuteVorbeiOhneErgebnis,
  parseFilter,
  parseReiter,
  plusWerktage,
  REITER_GRUPPEN,
  SAMMEL_PAKET,
  type NachfassEintrag,
} from "@/lib/nachfassRegel";
import { anteil, euroAchse, prozent, veraenderung, zahl } from "@/lib/zahl";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}
function exists(relative: string): boolean {
  return existsSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)));
}

const HEUTE = "2026-12-09";
const JETZT = Date.parse("2026-12-09T15:00:00Z");

function eintrag(p: Partial<NachfassEintrag>): NachfassEintrag {
  return {
    key: `${p.art ?? "setting"}:${p.id ?? "x"}`,
    quelle: "termin",
    art: "setting",
    id: "x",
    name: "Lead",
    firma: null,
    faelligAm: HEUTE,
    koernung: "tag",
    ergebnisFehlt: false,
    lebenszeichen: HEUTE,
    kontakte: [],
    ...p,
  };
}

describe("Punkt 1 — Dialoge mit Glas", () => {
  test("die Einblend-Animation hält ihren Endzustand nicht fest", () => {
    // `both` hielt die Deckkraft-Animation am Hintergrund aktiv — der Dialog
    // darüber verlor damit seinen Glas-Effekt.
    const modal = read("src/components/ui/Modal.tsx");
    assert.match(modal, /modal-scrim var\(--dur-2\) var\(--ease-out\) backwards/);
    assert.doesNotMatch(modal, /modal-scrim[^"]*both/);
  });
});

describe("Punkt 2 — Darstellung", () => {
  test("Analyse-Raster laufen nicht aus der Seite", () => {
    assert.match(read("src/app/globals.css"), /\.analyse-row \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/);
  });

  test("die Sparkline steht im Fluss, nicht über dem Vergleichswert", () => {
    assert.doesNotMatch(read("src/components/analyse/AnalyseViz.tsx"), /position: "absolute", right: "var\(--sp-7\)", bottom: "var\(--sp-6\)"/);
  });

  test("Lead-Details zeigen keine rohen Zeitstempel", () => {
    const dossier = read("src/lib/leadDossier.ts");
    assert.doesNotMatch(dossier, /joinDetails\(\[s\.lead_name, s\.company, s\.appointment_at \?\? s\.call_at\]\)/);
    assert.doesNotMatch(dossier, /joinDetails\(\[c\.lead_name, c\.company, c\.call_at\]\)/);
  });

  test("ein Zahlenformat: Komma, Leerzeichen vor %, echtes Minus", () => {
    assert.equal(prozent(42.5), "42,5 %");
    assert.equal(anteil(1, 3), "33,3 %");
    assert.equal(anteil(1, 0), "0,0 %");
    assert.equal(veraenderung(12.5), "+12,5");
    assert.equal(veraenderung(-3), "−3,0");
    assert.equal(veraenderung(0), "±0,0");
    assert.equal(zahl(-1234), "−1.234");
    assert.equal(euroAchse(10500), "10,5 T€");
    assert.equal(euroAchse(20000), "20 T€");
    assert.equal(euroAchse(500), "500 €");
  });
});

describe("Punkt 3 — Kontaktwege in „Heute“", () => {
  const data = read("src/lib/nachfassenData.ts");
  test("Termine bekommen Nummer, Mail und LinkedIn aus ihrer Quelle", () => {
    assert.match(data, /supabase\.from\("contacts"\)\.select\("id, list_id, linkedin_url, email"\)/);
    assert.match(data, /e\.telefon = e\.telefon \?\? st\?\.phone \?\? lead\?\.phone \?\? null;/);
    assert.match(data, /e\.linkedinUrl = kontakt\?\.linkedin_url \?\? null;/);
  });
  test("die Zeile bietet „Anrufen“ an", () => {
    assert.match(read("src/components/nachfassen/NachfassEingang.tsx"), /href=\{`tel:\$\{e\.telefon\}`\} className="ui-btn"/);
  });
});

describe("Punkt 4 — Rückruf direkt im Call-Modus", () => {
  test("„Anrufen“ und „Termin“ springen auf genau diesen Lead", () => {
    const eingang = read("src/components/nachfassen/NachfassEingang.tsx");
    assert.match(eingang, /`\/telefon\/\$\{listId\}\?lead=\$\{e\.id\}&from=nachfassen`/);
    assert.match(eingang, /router\.push\(`\$\{callModus\}&aktion=termin`\)/);
    assert.doesNotMatch(eingang, /Zur Liste/);
  });
  test("der Call-Modus öffnet das Termin-Fach und führt zurück nach „Heute“", () => {
    assert.match(read("src/components/telefon/CallModeRunner.tsx"), /searchParams\.get\("aktion"\) !== "termin"/);
    assert.match(read("src/app/(dashboard)/telefon/[listId]/page.tsx"), /sp\.from === "nachfassen" \? "\/nachfassen"/);
  });
});

describe("Punkt 5 — schlankes Badge", () => {
  test("Badge und Übersicht lesen den schlanken Loader, die Seite den vollen", () => {
    assert.match(read("src/lib/navCountsData.ts"), /ladeNachfassenSchlank\(\)/);
    assert.match(read("src/app/(dashboard)/page.tsx"), /ladeNachfassenSchlank\(\)/);
    assert.match(read("src/app/(dashboard)/nachfassen/page.tsx"), /await ladeNachfassen\(/);
  });
  test("schlank lässt Wiedervorlage und Kontaktwege weg, nicht die Gruppenregel", () => {
    const data = read("src/lib/nachfassenData.ts");
    assert.match(data, /schlank\s*\? Promise\.resolve\(\{ rows: \[\] as RecycleRow\[\], available: true \}\)/);
    assert.match(data, /if \(!schlank\) \{/);
    // Das Protokoll entscheidet „Altfall ja/nein“ — dafür wird es geladen.
    assert.match(data, /const fuerProtokoll = schlank \? eintraege\.filter\(\(e\) => istAltfall\(e, today\)\) : eintraege;/);
  });
  test("Termine werden auf die Person vorgefiltert statt organisationsweit geladen", () => {
    assert.match(read("src/lib/nachfassenData.ts"), /if \(!alle\) q = q\.or\(personFilter\);/);
  });
});

describe("Punkt 6 — heute vorbei ohne Ergebnis", () => {
  const basis = {
    at: "2026-12-09T09:00:00Z",
    dauerMin: 60,
    status: "offen",
    showStatus: null,
    abgesagt: false,
    today: HEUTE,
    nowMs: JETZT,
  };
  test("ab Terminende, nicht erst morgen", () => {
    assert.equal(heuteVorbeiOhneErgebnis(basis), true);
    assert.equal(heuteVorbeiOhneErgebnis({ ...basis, at: "2026-12-09T14:30:00Z" }), false, "läuft noch");
    assert.equal(heuteVorbeiOhneErgebnis({ ...basis, at: "2026-12-09T14:30:00Z", dauerMin: 30 }), true, "30 Minuten vorbei");
  });
  test("nicht mit Ergebnis, nicht abgesagt, nicht an einem anderen Tag", () => {
    assert.equal(heuteVorbeiOhneErgebnis({ ...basis, showStatus: "show" }), false);
    assert.equal(heuteVorbeiOhneErgebnis({ ...basis, status: "gewonnen" }), false);
    assert.equal(heuteVorbeiOhneErgebnis({ ...basis, abgesagt: true }), false);
    assert.equal(heuteVorbeiOhneErgebnis({ ...basis, at: "2026-12-08T09:00:00Z" }), false);
  });
  test("der Loader nimmt sie auf und markiert „Ergebnis fehlt“", () => {
    const data = read("src/lib/nachfassenData.ts");
    assert.match(data, /if \(!istInArbeitsmenge\(zustand\) && !closingNachfassen && !heuteVorbei\) continue;/);
    assert.match(data, /const ergebnisFehlt =\s*heuteVorbei \|\|/);
  });
});

describe("Punkt 7 — Sammelaktion in Paketen", () => {
  test("kleine Pakete mit Fortschritt, Vorgabe nächster Werktag", () => {
    const eingang = read("src/components/nachfassen/NachfassEingang.tsx");
    assert.equal(SAMMEL_PAKET, 25);
    assert.match(eingang, /for \(let i = 0; i < ziel\.length; i \+= SAMMEL_PAKET\)/);
    assert.match(eingang, /von \$\{fortschritt\.gesamt\} erledigt/);
    assert.match(eingang, /useState<string \| null>\(\(\) => plusWerktage\(today, 1\)\)/);
    assert.equal(plusWerktage("2026-12-11", 1), "2026-12-14", "Freitag → Montag");
  });
  test("der Server nimmt höchstens 100 je Aufruf", () => {
    assert.match(read("src/app/actions/nachfassKontakt.ts"), /\(eintraege \?\? \[\]\)\.slice\(0, 100\)/);
  });
});

describe("Punkt 8 — Wiedervorlage als eigener Reiter", () => {
  const tot = eintrag({ quelle: "recycling", art: "phone_lead", id: "r1", faelligAm: "2026-11-01", lebenszeichen: "2026-11-01" });
  const termin = eintrag({ id: "t1", faelligAm: "2026-12-08" });
  test("Recycling-Einträge landen in „Wiedervorlage“, nie in „Fällig“", () => {
    assert.equal(gruppeVon(tot, HEUTE, JETZT), "wiedervorlage");
    assert.equal(gruppeVon(termin, HEUTE, JETZT, "2026-12-01"), "ueberfaellig");
    assert.ok(!REITER_GRUPPEN.faellig.includes("wiedervorlage"));
  });
  test("… und zählen nicht im Badge", () => {
    const g = gruppiere([tot, termin], HEUTE, JETZT, "2026-12-01");
    assert.deepEqual(badgeZahl(g), { total: 1, overdue: 1 });
  });
  test("Reiter und Filter", () => {
    assert.equal(parseReiter("wiedervorlage"), "wiedervorlage");
    assert.equal(parseFilter("recycling"), "alle", "alte Links fallen auf „Alle“");
  });
});

describe("Punkt 9 — weniger Orte für dasselbe", () => {
  test("„Erinnert“ nur, wo eine Erinnerung zu schließen ist", () => {
    const aktionen = read("src/components/termine/TerminAktionen.tsx");
    assert.match(aktionen, /onGenervt\?: \(\) => void;/);
    assert.match(aktionen, /<Check size=\{13\} \/> Erinnert/);
    assert.doesNotMatch(aktionen, /> Genervt/);
    assert.match(read("src/components/termine/TermineList.tsx"), /onGenervt=\{art !== null \|\| e\.erinnerung \? \(\) => onGenervt\(e\) : undefined\}/);
    assert.match(read("src/components/vertrieb/VorgangListe.tsx"), /onGenervt=\{e\.erinnerung \? \(\) => onGenervt\(e\) : undefined\}/);
  });
  test("/no-shows und die No-Show-Listen sind weg — alte Links leiten um", () => {
    for (const p of [
      "src/app/(dashboard)/no-shows/page.tsx",
      "src/app/(dashboard)/telefon/setting-no-show/page.tsx",
      "src/app/(dashboard)/listen/setting-no-show/page.tsx",
      "src/lib/settingNoShowData.ts",
    ]) {
      assert.equal(exists(p), false, p);
    }
    const config = read("next.config.ts");
    assert.match(config, /\{ source: "\/no-shows", destination: "\/nachfassen" \}/);
    assert.match(config, /\{ source: "\/telefon\/setting-no-show", destination: "\/telefon" \}/);
    assert.match(config, /\{ source: "\/listen\/setting-no-show", destination: "\/listen" \}/);
  });
  test("die Ablage hat keine Navigationszeile mehr, die Route bleibt", () => {
    assert.doesNotMatch(read("src/components/Sidebar.tsx"), /href="\/ablage"/);
    assert.equal(exists("src/app/(dashboard)/ablage/page.tsx"), true);
  });
});

describe("Punkt 10 — ein Wort je Handlung", () => {
  test("„Tot“ statt Aufgeben, Toter Lead und Dead", () => {
    const eingang = read("src/components/nachfassen/NachfassEingang.tsx");
    assert.doesNotMatch(eingang, />\s*Aufgeben\s*</);
    assert.doesNotMatch(read("src/components/telefon/CallModeRunner.tsx"), /Toter Lead|label: "Dead"/);
    assert.match(read("src/lib/settingLabels.ts"), /dead: "Tot",/);
  });
  test("kein „Recycling“ und keine Kürzel auf dem Bildschirm", () => {
    assert.doesNotMatch(read("src/components/Sidebar.tsx"), /label: "RR"|label: "NE"|label: "KT"|label: "NS"/);
    assert.doesNotMatch(read("src/components/nachfassen/NachfassEingang.tsx"), /label: "Recycling"/);
    assert.match(read("src/components/settings/PipelineSettingsCard.tsx"), /label: "Wiedervorlage — Wartezeit \(Tage\)"/);
    assert.doesNotMatch(read("src/app/(dashboard)/telefon/page.tsx"), /Arm „/);
  });
});
