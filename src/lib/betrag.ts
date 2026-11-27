// Betrags-Eingabe aus Schnellformularen.

/**
 * Deutsche UND englische Schreibweise: „4.900,50" und „4900.50" sind beide
 * 4900,50 €. Ein Punkt gilt nur als Tausendertrenner, wenn ein Komma folgt oder
 * er genau drei Ziffern abtrennt („4.900"). Leer = kein Betrag (null),
 * unlesbar = undefined. Vorher wurde jeder Punkt gestrichen: „4900.50" wurde
 * 490.050 € (Code-Review 27.11.).
 */
export function parseBetrag(eingabe: string): number | null | undefined {
  const s = eingabe.replace(/[\s€]/g, "");
  if (!s) return null;
  let norm: string;
  if (s.includes(",")) norm = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) norm = s.replace(/\./g, "");
  else norm = s;
  if (!/^\d+(\.\d+)?$/.test(norm)) return undefined;
  const n = Number(norm);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
