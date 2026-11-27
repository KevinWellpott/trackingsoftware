import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

// Kennzahl-Modul der Übersicht (Redesign Phase 6, Prototyp `.mod`):
// Beschriftung · Wert (mit Einheit) · darunter Vergleich bzw. Unterzeile und
// rechts ein Verlauf (84×26) ODER ein Ziel-Balken. Fehlt ein Wert, steht „—".
// Zählt die Zahl eine Liste, ist das Modul ein Link dorthin (UMSETZUNG §3).
//
// `dran` ist Gold — ausschließlich für „du bist dran" (lib/dranRegel.ts), also
// nur am Modul, das die Arbeitsmenge von „Heute" zählt.

export function Sparkline({ punkte }: { punkte: number[] }) {
  if (punkte.length < 2) return null;
  const W = 84;
  const H = 26;
  const max = Math.max(...punkte);
  const min = Math.min(...punkte);
  const xy = punkte.map((v, i) => [(i / (punkte.length - 1)) * W, H - 3 - ((v - min) / (max - min || 1)) * (H - 6)]);
  const letzter = xy[xy.length - 1];
  return (
    <svg className="km-spark" viewBox={`-3 0 ${W + 6} ${H}`} aria-hidden>
      <polyline
        points={xy.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={letzter[0]} cy={letzter[1].toFixed(1)} r={2.4} fill="var(--accent)" />
    </svg>
  );
}

export function KennzahlModul({
  label,
  value,
  unit,
  sub,
  spark,
  meter,
  href,
  dran = false,
}: {
  label: string;
  value: string;
  /** Kleine Einheit hinter dem Wert („von 40", „€"). */
  unit?: string;
  /** Vergleich bzw. Unterzeile — sagt, wogegen die Zahl zu lesen ist. */
  sub?: ReactNode;
  /** Verlauf; nur, wo dieselbe Zählweise über die Zeit vorliegt. */
  spark?: number[];
  /** Ziel-Balken in Prozent (gedeckelt bei 100). */
  meter?: number | null;
  href?: string;
  dran?: boolean;
}) {
  const inhalt = (
    <>
      <span className="km-l">
        {label}
        {href && <ArrowUpRight size={14} className="km-go" aria-hidden />}
      </span>
      <span className="km-v">
        <b>{value}</b>
        {unit && <small>{unit}</small>}
      </span>
      {meter != null && (
        <div className="km-meter" role="img" aria-label={`${Math.round(meter)} % des Ziels`}>
          <i data-voll={meter >= 100 ? "true" : undefined} style={{ width: `${Math.min(100, Math.max(0, meter))}%` }} />
        </div>
      )}
      <span className="km-c">
        <span>{sub}</span>
        {spark && <Sparkline punkte={spark} />}
      </span>
    </>
  );
  return href ? (
    <Link href={href} className="km" data-dran={dran ? "true" : undefined}>
      {inhalt}
    </Link>
  ) : (
    <div className="km" data-dran={dran ? "true" : undefined}>
      {inhalt}
    </div>
  );
}
