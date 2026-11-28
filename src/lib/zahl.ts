// Zahlen auf dem Bildschirm — EIN Format für die ganze App (Prüfung 28.11.:
// „42.5%“ stand neben „33,3 %“, die Umsatz-Achse zeigte „10.5k“, das
// Minuszeichen war mal ein Bindestrich, mal ein echtes Minus).
//
// Regeln: deutsches Komma, schmales Leerzeichen-freies „ %“ mit Leerzeichen
// davor, echtes Minus (U+2212) und ein Plus bei Veränderungen.

const FMT = new Map<number, Intl.NumberFormat>();

function fmt(stellen: number): Intl.NumberFormat {
  let f = FMT.get(stellen);
  if (!f) {
    f = new Intl.NumberFormat("de-DE", { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
    FMT.set(stellen, f);
  }
  return f;
}

/** 1234,5 → „1.234,5“; negatives mit echtem Minus. */
export function zahl(n: number, stellen = 0): string {
  const s = fmt(stellen).format(Math.abs(n));
  return n < 0 && s !== fmt(stellen).format(0) ? `−${s}` : s;
}

/** 42.5 → „42,5 %“ (der Wert ist schon in Prozent). */
export function prozent(n: number, stellen = 1): string {
  return `${zahl(n, stellen)} %`;
}

/** Anteil n von t als Prozent; ohne Basis „0 %“. */
export function anteil(n: number, t: number, stellen = 1): string {
  return prozent(t === 0 ? 0 : (n / t) * 100, stellen);
}

/** Veränderung mit Vorzeichen: „+12,5“, „−3,0“, „±0“. */
export function veraenderung(n: number, stellen = 1): string {
  if (n === 0) return `±${zahl(0, stellen)}`;
  return `${n > 0 ? "+" : ""}${zahl(n, stellen)}`;
}

/** Achsenbeschriftung für Euro-Beträge: 10500 → „10,5 T€“. */
export function euroAchse(v: number): string {
  return Math.abs(v) >= 1000 ? `${zahl(v / 1000, Math.abs(v) % 1000 === 0 ? 0 : 1)} T€` : `${zahl(v)} €`;
}
