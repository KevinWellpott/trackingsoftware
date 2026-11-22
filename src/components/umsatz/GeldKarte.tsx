import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { RatenMarken } from "@/components/umsatz/RatenMarken";
import { ZahlungButton } from "@/components/umsatz/ZahlungDialog";
import { VereinbarenButton } from "@/components/umsatz/RateAktionen";
import { FINANZ_STATUS_LABELS, datumDe, formatEurGenau } from "@/lib/umsatz";
import { zusageZuRate } from "@/lib/finanzen";
import { geldSicht } from "@/lib/geldSicht";
import type { KundenGeld } from "@/lib/internData";

// Die Zahlungskarte im Überblick der Akte: was offen ist und seit wie vielen
// Tagen, mit den zwei Handgriffen direkt daran.

export function GeldKarte({ geld, heute }: { geld: KundenGeld; heute: string }) {
  const { k } = geld;
  const rate = k.naechsteRate;
  const sicht = geldSicht(geld);
  const anteil = k.vertragswert > 0 ? Math.min(100, Math.max(0, (k.kassiert / k.vertragswert) * 100)) : 0;
  const link = `/kunden/${geld.id}?tab=zahlungen`;

  return (
    <Card style={k.ueberfaellig > 0 ? { borderColor: "var(--danger)" } : undefined}>
      <CardHeader
        title="Zahlung"
        action={
          <Link href={link} className="ks-link">
            Alle Zahlungen
          </Link>
        }
      />
      <div className="ks-stapel" data-gap="eng">
        {k.ueberfaellig > 0 ? (
          <p className="ks-betrag-gross ks-rot">
            {formatEurGenau(k.ueberfaellig)}
            <span>
              seit {k.tageUeberfaellig} {k.tageUeberfaellig === 1 ? "Tag" : "Tagen"} überfällig
            </span>
          </p>
        ) : (
          <p className="ks-betrag-gross">
            {formatEurGenau(k.offen)}
            <span>offen · {FINANZ_STATUS_LABELS[k.status]}</span>
          </p>
        )}

        <div className="progress-track" role="img" aria-label={`${Math.round(anteil)} Prozent kassiert`}>
          <div className="progress-fill ks-fortschritt" style={{ width: `${anteil}%` }} />
        </div>
        <p className="ks-leise">
          {formatEurGenau(k.kassiert)} von {formatEurGenau(k.vertragswert)} kassiert
        </p>

        {rate && (
          <div className="ks-naechste-rate">
            <span>
              {formatEurGenau(rate.rest)} am {datumDe(rate.faellig_am)}
            </span>
            <RatenMarken rate={rate} zusage={zusageZuRate(rate, geld.vereinbarungen, heute)} />
            <span className="ks-reihe">
              <ZahlungButton geld={sicht} heute={heute} vorschlag={rate.rest} />
              <VereinbarenButton geld={sicht} rate={rate} heute={heute} />
            </span>
          </div>
        )}
        {(k.status === "plan_fehlt" || k.status === "vertrag_fehlt") && (
          <Link href={link} className="ks-link">
            {k.status === "plan_fehlt" ? "Plan und bisherige Zahlungen erfassen" : "Vertragswert eintragen"}
          </Link>
        )}
        {k.zuvielVerplant > 0 && <p className="ks-warnung">Plan liegt {formatEurGenau(k.zuvielVerplant)} über dem Vertrag.</p>}
      </div>
    </Card>
  );
}
