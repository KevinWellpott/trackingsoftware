import Papa from "papaparse";

// Parser für Google-Maps-Scraper-Exporte (Telefonakquise-Import).
// Wir brauchen nur Firma, Telefonnummer, Website. Die Spaltenpositionen
// driften pro Zeile, deshalb Header-Hint + Zellinhalt-Heuristik.

export type ParsedPhoneRow = {
  company: string | null;
  phone: string | null;
  website: string | null;
  /**
   * Branche/Zielgruppe aus einer optionalen CSV-Spalte `branche` bzw.
   * `zielgruppe`. Nur für GEMISCHTE Dateien gedacht — der Normalfall ist eine
   * Datei pro Branche, dort wird der Wert im Import-Dialog einmal gesetzt.
   * `null` = Spalte fehlt oder Zelle leer; dann greift der Dialog-Wert.
   */
  targetGroup: string | null;
  /**
   * Ansprechpartner aus einer Spalte wie „GF Name" / „Ansprechpartner".
   * Handrecherchierte Listen tragen den Entscheider oft schon — ihn beim Import
   * wegzuwerfen heisst, dass ihn jemand im Call-Mode ein zweites Mal ermittelt.
   */
  deciderName: string | null;
  /** E-Mail — per Spaltenkopf ODER aus einer beliebigen Zelle erkannt (§ unten). */
  email: string | null;
};

export type PhoneCsvResult = {
  rows: ParsedPhoneRow[]; // nur verwertbare Zeilen (mind. Telefon ODER Firma)
  totalDataRows: number; // alle nicht-leeren Datenzeilen (ohne Header)
};

const PHONE_RE = /(\+?\d[\d\s()/.\-]{6,}\d)/;
const GOOGLE_HOSTS = /google\.[a-z.]+\/maps|goo\.gl|\/maps\/place|schema\.org|gstatic|googleusercontent/i;

function normalizePhone(raw: string): string {
  // Ziffern + führendes + behalten
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/[^\d]/g, "");
  return plus + digits;
}

function looksLikePhone(cell: string): boolean {
  const digits = cell.replace(/[^\d]/g, "");
  return digits.length >= 7 && digits.length <= 15 && PHONE_RE.test(cell);
}

function looksLikeWebsite(cell: string): boolean {
  return /^https?:\/\//i.test(cell.trim()) && !GOOGLE_HOSTS.test(cell);
}

function isNoise(cell: string): boolean {
  const c = cell.trim();
  if (c === "" || c === "·" || c === "-" || c === "—") return true;
  if (/^https?:\/\//i.test(c)) return true; // URLs sind keine Firma
  if (looksLikePhone(c)) return true;
  if (/^\(?\d[\d.,]*\)?$/.test(c)) return true; // reine Zahlen (Rating/Reviews)
  if (/^\d+[.,]\d+$/.test(c)) return true; // 4,7 Rating
  return false;
}

/**
 * Header-Namen, unter denen eine Branchen-Spalte akzeptiert wird.
 * Bewusst klein geschrieben — der Abgleich läuft case-insensitiv, weil solche
 * Dateien von Hand entstehen und „Branche"/„BRANCHE" gleich gemeint sind.
 */
const TARGET_GROUP_HEADERS = ["branche", "zielgruppe", "target_group", "targetgroup"];

/**
 * Spaltenköpfe je Feld. Zwei Sorten stehen hier nebeneinander:
 * die Google-Maps-Scraper-Codes (`qBF1Pd` & Co.) und deutsche Klartext-Namen,
 * wie sie in von Hand gepflegten Listen stehen.
 *
 * Verglichen wird auf **exakte Gleichheit** des normalisierten Kopfes, nicht auf
 * Teilstrings. Genau daran haengt der haeufigste Fall: Eine Liste mit den Spalten
 * „Name" (Firma) und „GF Name" (Entscheider) wuerde bei Teilstring-Suche beide
 * Male dieselbe Spalte treffen — der Firmenname landete als Ansprechpartner.
 *
 * `art`/`kategorie` sind bewusst NICHT als Branche gemappt: Google Maps fuellt
 * das je Eintrag verschieden („Autowäsche" vs. „Dienst für professionelle
 * Autopflege"), das ergaebe zwei Zielgruppen fuer dieselbe Branche. Die Branche
 * wird im Dialog einmal gesetzt — dort weiss sie jemand.
 */
const HEADERS = {
  company: ["qBF1Pd", "name", "firma", "firmenname", "unternehmen", "company", "betrieb"],
  phone: ["UsdlK", "telefon", "telefonnummer", "rufnummer", "tel", "phone"],
  website: ["lcr4fd href", "website", "webseite", "homepage", "url"],
  decider: [
    "gf name",
    "gf",
    "geschaeftsfuehrer",
    "geschäftsführer",
    "ansprechpartner",
    "entscheider",
    "inhaber",
    "kontaktperson",
    "decider",
  ],
  email: ["email", "e-mail", "e mail", "mail"],
} as const;

/** Kopfzeilen-Abgleich: trimmen, Mehrfach-Leerzeichen einkochen, case-insensitiv. */
function normHeader(h: string): string {
  return h.trim().replace(/\s+/g, " ").toLowerCase();
}

function findHeader(header: string[], names: readonly string[]): number {
  const norm = header.map(normHeader);
  for (const n of names) {
    const i = norm.indexOf(normHeader(n));
    if (i >= 0) return i;
  }
  return -1;
}

// E-Mails werden zusaetzlich OHNE Spaltenkopf erkannt. Das ist die eine
// Ausnahme von „nur per Header": Eine Zeichenkette mit @ und Punkt-TLD ist
// eindeutig eine E-Mail und kann mit keinem anderen Feld verwechselt werden —
// anders als ein Personen- oder Branchenname. In der Praxis stehen genau so die
// Mails in solchen Listen: in einer namenlosen Notizspalte am Zeilenende.
const EMAIL_RE = /[^\s,;<>()"']+@[^\s,;<>()"']+\.[a-z]{2,}/i;

export function parsePhoneCsv(text: string): PhoneCsvResult {
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: true,
  });
  const table = (parsed.data ?? []).filter(
    (r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim() !== ""),
  );
  if (table.length === 0) return { rows: [], totalDataRows: 0 };

  const header = table[0].map((h) => String(h ?? "").trim());
  const idxCompany = findHeader(header, HEADERS.company);
  const idxPhone = findHeader(header, HEADERS.phone);
  const idxWebsite = findHeader(header, HEADERS.website);
  const idxDecider = findHeader(header, HEADERS.decider);
  const idxEmail = findHeader(header, HEADERS.email);
  const idxTargetGroup = findHeader(header, TARGET_GROUP_HEADERS);

  // Spalten, die bereits ein Feld belegen, scheiden fuer die Firmen-Heuristik
  // aus. Ohne das landet in einer Datei ohne Firmen-Kopf der Ansprechpartner
  // oder die Branche als Firmenname — beides faellt erst im Call-Mode auf.
  const claimed = new Set([idxDecider, idxEmail, idxTargetGroup].filter((i) => i >= 0));

  const dataRows = table.slice(1);
  const rows: ParsedPhoneRow[] = [];

  for (const row of dataRows) {
    const cells = row.map((c) => String(c ?? "").trim());

    // Telefon: Header-Hint, sonst erste telefon-artige Zelle
    let phone: string | null = null;
    if (idxPhone >= 0 && cells[idxPhone] && looksLikePhone(cells[idxPhone])) {
      phone = normalizePhone(cells[idxPhone]);
    } else {
      const hit = cells.find((c) => looksLikePhone(c));
      if (hit) phone = normalizePhone(hit);
    }

    // Website: Header-Hint, sonst erste http-Zelle die nicht Google Maps ist
    let website: string | null = null;
    if (idxWebsite >= 0 && cells[idxWebsite] && looksLikeWebsite(cells[idxWebsite])) {
      website = cells[idxWebsite];
    } else {
      const hit = cells.find((c) => looksLikeWebsite(c));
      if (hit) website = hit;
    }

    // Branche: ausschliesslich per Header-Hint. Eine Heuristik gibt es hier
    // bewusst nicht — „Handwerk" sieht wie jede andere Textzelle aus, und ein
    // falsch geratener Wert landet als eigene Testgruppe in der Auswertung.
    const targetGroup =
      idxTargetGroup >= 0 && cells[idxTargetGroup] ? cells[idxTargetGroup] : null;

    // Ansprechpartner: ausschliesslich per Spaltenkopf, aus demselben Grund wie
    // die Branche — ein geratener Personenname ist schlimmer als gar keiner.
    const deciderName = idxDecider >= 0 && cells[idxDecider] ? cells[idxDecider] : null;

    // E-Mail: Spaltenkopf zuerst, sonst die erste Zelle, die eine enthaelt.
    let email: string | null = null;
    if (idxEmail >= 0 && cells[idxEmail] && EMAIL_RE.test(cells[idxEmail])) {
      email = cells[idxEmail].match(EMAIL_RE)?.[0] ?? null;
    } else {
      for (const c of cells) {
        const hit = c.match(EMAIL_RE);
        if (hit) {
          email = hit[0];
          break;
        }
      }
    }

    // Firma: Header-Hint, sonst erste "echte" Textzelle. Bereits belegte Spalten
    // werden dabei uebersprungen: sonst wuerde in einer Datei ohne Google-Header
    // die Branche oder der Ansprechpartner als Firmenname landen.
    let company: string | null = null;
    if (idxCompany >= 0 && cells[idxCompany] && !isNoise(cells[idxCompany])) {
      company = cells[idxCompany];
    } else {
      const hit = cells.find(
        (c, i) =>
          !claimed.has(i) && c !== "" && !isNoise(c) && !EMAIL_RE.test(c) && !c.startsWith("category-list"),
      );
      if (hit) company = hit;
    }

    // Nur verwertbare Zeilen behalten
    if (phone || company) {
      rows.push({ company, phone, website, targetGroup, deciderName, email });
    }
  }

  return { rows, totalDataRows: dataRows.length };
}
