import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatTile } from "@/components/dashboard/StatTile";
import { PlanButton } from "@/components/umsatz/PlanButton";
import { FINANZ_STATUS_LABELS, FINANZ_TONE, formatEur, type FinanzStatus, type KundenKennzahlen } from "@/lib/umsatz";
import { geldSicht } from "@/lib/geldSicht";
import type { KundenGeld } from "@/lib/internData";

// Alle Verträge. Hier findet die Schnellerfassung des Bestands statt, ein
// Knopf je Kunde ohne Plan.

const VORNE: FinanzStatus[] = ["vertrag_fehlt", "plan_fehlt", "plan_unvollstaendig", "ueberfaellig"];

export function VertraegeAnsicht({
  geld,
  heute,
  namen,
  nichtMehrGewonnen,
}: {
  geld: KundenGeld[];
  heute: string;
  namen: Map<string, string>;
  /** Kunden, deren Closing nicht mehr auf „Gewonnen" steht (B16). */
  nichtMehrGewonnen: Set<string>;
}) {
  const summe = (f: (k: KundenKennzahlen) => number) => geld.reduce((s, g) => s + f(g.k), 0);
  const rang = (g: KundenGeld) => {
    const i = VORNE.indexOf(g.k.status);
    return i < 0 ? VORNE.length : i;
  };
  const zeilen = [...geld].sort((a, b) => rang(a) - rang(b) || a.name.localeCompare(b.name, "de"));

  return (
    <div className="ks-stapel">
      <div className="kpi-row" data-cols="4">
        <StatTile label="Volumen" value={formatEur(summe((k) => k.vertragswert))} sub={`${geld.length} ${geld.length === 1 ? "Kunde" : "Kunden"}, netto`} />
        <StatTile label="Kassiert" value={formatEur(summe((k) => k.kassiert))} tone="success" />
        <StatTile label="Noch offen" value={formatEur(summe((k) => k.offen))} sub="laut Plan" />
        <StatTile
          label="Noch ohne Plan"
          value={formatEur(summe((k) => (k.status === "gekuendigt" || k.status === "abgebrochen" ? 0 : k.nichtVerplant)))}
          tone={geld.some((g) => g.k.status === "plan_fehlt") ? "warning" : "neutral"}
        />
      </div>

      <Card padding={0}>
        {zeilen.length === 0 ? (
          <p className="ks-leer">In dieser Ansicht ist kein Vertrag.</p>
        ) : (
          <ul className="ks-liste-schlicht">
            {zeilen.map((g) => (
              <li key={g.id} className="ks-vertrag">
                <Link href={`/kunden/${g.id}?tab=zahlungen`} className="ks-vertrag-name">
                  <span className="ks-name">{g.name}</span>
                  <span className="ks-unter">{namen.get(g.id) ?? "Niemand zuständig"}</span>
                </Link>
                <span className="ks-marken">
                  <Badge tone={FINANZ_TONE[g.k.status]}>{FINANZ_STATUS_LABELS[g.k.status]}</Badge>
                  {g.k.zuvielVerplant > 0 && <Badge tone="warning">Plan über Vertrag</Badge>}
                  {nichtMehrGewonnen.has(g.id) && <Badge tone="warning">Closing nicht mehr gewonnen</Badge>}
                </span>
                <dl className="ks-vertrag-zahlen">
                  <div>
                    <dt>Vertrag</dt>
                    <dd>{formatEur(g.k.vertragswert)}</dd>
                  </div>
                  <div>
                    <dt>Kassiert</dt>
                    <dd>{formatEur(g.k.kassiert)}</dd>
                  </div>
                  <div>
                    <dt>Offen</dt>
                    <dd className={g.k.ueberfaellig ? "ks-rot" : undefined}>{formatEur(g.k.offen)}</dd>
                  </div>
                </dl>
                <span className="ks-rate-aktion">
                  {g.k.status === "plan_fehlt" && <PlanButton geld={geldSicht(g)} heute={heute} />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
