import Papa from "papaparse";

// Parser für Google-Maps-Scraper-Exporte (Telefonakquise-Import).
// Wir brauchen nur Firma, Telefonnummer, Website. Die Spaltenpositionen
// driften pro Zeile, deshalb Header-Hint + Zellinhalt-Heuristik.

export type ParsedPhoneRow = {
  company: string | null;
  phone: string | null;
  website: string | null;
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

export function parsePhoneCsv(text: string): PhoneCsvResult {
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: true,
  });
  const table = (parsed.data ?? []).filter(
    (r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim() !== ""),
  );
  if (table.length === 0) return { rows: [], totalDataRows: 0 };

  const header = table[0].map((h) => String(h ?? "").trim());
  const idxCompany = header.indexOf("qBF1Pd");
  const idxPhone = header.indexOf("UsdlK");
  const idxWebsite = header.indexOf("lcr4fd href");

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

    // Firma: Header-Hint, sonst erste "echte" Textzelle
    let company: string | null = null;
    if (idxCompany >= 0 && cells[idxCompany] && !isNoise(cells[idxCompany])) {
      company = cells[idxCompany];
    } else {
      const hit = cells.find((c) => c !== "" && !isNoise(c) && !c.startsWith("category-list"));
      if (hit) company = hit;
    }

    // Nur verwertbare Zeilen behalten
    if (phone || company) {
      rows.push({ company, phone, website });
    }
  }

  return { rows, totalDataRows: dataRows.length };
}
