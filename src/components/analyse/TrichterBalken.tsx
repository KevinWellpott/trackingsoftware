import type { ReactNode } from "react";

// Der Trichter im Prototyp-Stil (Redesign Phase 6): je Stufe eine Zeile mit
// Beschriftung, einer schraffierten Spur und dem gefüllten Anteil, Wert und
// Anteil an Stufe 1 rechts. Zwischen zwei Stufen steht „↓ x % weiter · n raus".
//
// „weiter" ist das tragende Wort: Die Zahl ist die DURCHLASSquote, nicht der
// Verlust — der Pfeil zeigt nur die Leserichtung. Die schraffierte Spur ist
// der Rest bis Stufe 1: Was dort leer bleibt, ist unterwegs herausgefallen.
//
// Eine Stufe kann einen Bruch markieren (`bruch`): Dann steht statt einer Quote
// ein Satz — für Trichter, deren Stufen nicht alle aus derselben Menge kommen
// (Dashboard: Termine nach Buchung, Closings nach Closing-Termin). Eine Quote
// zwischen zwei verschiedenen Mengen wäre eine erfundene Zahl.
//
// Server-tauglich (keine Hooks) — benutzt vom Funnel-Tab (`BarFunnel`) und
// von der Übersicht.

export type TrichterStufe = {
  label: string;
  value: number;
  /** Statt der Durchlassquote zur Vorstufe steht dieser Satz (andere Menge). */
  bruch?: string;
};

const INT = new Intl.NumberFormat("de-DE");
const PCT = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

export function TrichterBalken({
  stufen,
  abschluss,
}: {
  stufen: TrichterStufe[];
  /** Abschlusszeile ohne Balken (z. B. der Umsatz). */
  abschluss?: { label: string; value: ReactNode };
}) {
  const base = stufen[0]?.value ?? 0;
  // Gedeckelt bei 100 %: In der Periodensicht kann eine späte Stufe größer
  // sein als Stufe 1 — der Balken liefe sonst aus der Spur.
  const breite = (v: number) => (base <= 0 ? 0 : Math.min(100, (v / base) * 100));

  return (
    <div className="trichter">
      {stufen.map((s, i) => {
        const prev = i > 0 ? stufen[i - 1] : null;
        let verbindung: string | null = null;
        if (prev) {
          if (s.bruch) verbindung = s.bruch;
          else if (prev.value > 0) {
            const raus = prev.value - s.value;
            verbindung = `↓ ${PCT.format((s.value / prev.value) * 100)} % weiter${raus > 0 ? ` · ${INT.format(raus)} raus` : ""}`;
          } else verbindung = "—";
        }
        return (
          <div key={`${s.label}-${i}`}>
            {verbindung !== null && (
              <div className="trichter-conn" data-bruch={s.bruch ? "true" : undefined}>
                <span>{verbindung}</span>
              </div>
            )}
            <div className="trichter-row">
              <span className="trichter-lb">{s.label}</span>
              <div className="trichter-track" aria-hidden>
                <div className="trichter-fill funnel-bar" style={{ width: `${breite(s.value)}%`, animationDelay: `${i * 60}ms` }} />
              </div>
              <span className="trichter-val">
                <b>{INT.format(s.value)}</b>
                <span>{i === 0 ? "Basis" : base > 0 ? `${PCT.format((s.value / base) * 100)} %` : "—"}</span>
              </span>
            </div>
          </div>
        );
      })}
      {abschluss && (
        <div className="trichter-row trichter-abschluss">
          <span className="trichter-lb">{abschluss.label}</span>
          <span />
          <span className="trichter-val">
            <b>{abschluss.value}</b>
          </span>
        </div>
      )}
    </div>
  );
}
