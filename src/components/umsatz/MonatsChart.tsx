"use client";

import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS_PROPS,
  BAR_RADIUS,
  CURSOR_FILL,
  GRID_PROPS,
  LEGEND_STYLE,
  TOOLTIP_LABEL_STYLE,
  TOOLTIP_STYLE,
  VIZ,
} from "@/lib/viz";
import { monatLabel, type MonatsAbschluss } from "@/lib/finanzen";
import { formatEur } from "@/lib/umsatz";

// Zwei Serien nebeneinander, nie gestapelt. Überfälliges steckt in keiner von
// beiden (G7), es steht in der Tabelle in einer eigenen Spalte.

export function MonatsChart({ reihe, heuteMonat }: { reihe: MonatsAbschluss[]; heuteMonat: string }) {
  const kurz = (m: string) => `${monatLabel(m).slice(0, 3)} ${m.slice(2, 4)}`;
  const data = reihe.map((m) => ({ label: kurz(m.monat), Rein: m.rein, Raus: m.raus }));
  const jetzt = reihe.some((m) => m.monat === heuteMonat) ? kurz(heuteMonat) : null;

  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} barGap={2} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="label" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} width={44} tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}k` : String(v))} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={{ color: "var(--text-primary)" }}
            cursor={CURSOR_FILL}
            formatter={(v) => formatEur(Number(v))}
          />
          <Legend itemSorter={null} iconType="circle" iconSize={8} wrapperStyle={LEGEND_STYLE} />
          {jetzt && (
            <ReferenceLine
              x={jetzt}
              stroke="var(--text-muted)"
              strokeDasharray="3 3"
              label={{ value: "jetzt", fill: "var(--text-muted)", fontSize: 11, position: "top" }}
            />
          )}
          <Bar dataKey="Rein" fill={VIZ[0]} radius={BAR_RADIUS} />
          <Bar dataKey="Raus" fill={VIZ[1]} radius={BAR_RADIUS} />
        </BarChart>
      </ResponsiveContainer>
      <details className="ks-details">
        <summary>Als Tabelle</summary>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Monat</th>
                <th className="num">Rein</th>
                <th className="num">Raus</th>
                <th className="num">Bleibt</th>
                <th className="num">Frei</th>
                <th className="num">Überfällig</th>
              </tr>
            </thead>
            <tbody>
              {reihe.map((m) => (
                <tr key={m.monat}>
                  <td>{kurz(m.monat)}</td>
                  <td className="num">{formatEur(m.rein)}</td>
                  <td className="num">{formatEur(m.raus)}</td>
                  <td className="num">{formatEur(m.gewinn)}</td>
                  <td className="num">{formatEur(m.frei)}</td>
                  <td className="num">{formatEur(m.ueberfaelligImMonat)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
