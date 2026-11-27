// Ein Geldbetrag in Listen und Zeilen (Redesign Phase 6): immer zwei
// Nachkommastellen, das Euro-Zeichen gedämpft daneben — die Ziffern sind die
// Aussage, das Zeichen nur die Einheit. Tabellarische Ziffern, damit Beträge
// untereinander fluchten.
//
// Bewusst nur für Zeilen: Kennzahl-Kacheln bleiben bei `formatEur` (ganze
// Euro) — dort zählt die Größenordnung, nicht der Cent.

const ZAHL = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function Betrag({ wert }: { wert: number }) {
  return (
    <span className="betrag">
      {ZAHL.format(wert)}
      <span className="betrag-eur"> €</span>
    </span>
  );
}
