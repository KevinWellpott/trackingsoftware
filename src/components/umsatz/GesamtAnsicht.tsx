import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/dashboard/StatTile";
import { MonatsChart } from "@/components/umsatz/MonatsChart";
import { RuecklageFeld } from "@/components/umsatz/RuecklageFeld";
import { formatEur } from "@/lib/umsatz";
import {
  KOSTEN_KATEGORIE_LABELS,
  kostenImMonat,
  monatLabel,
  monatPlus,
  monatsAbschluss,
  type KostenDaten,
  type KostenKategorie,
} from "@/lib/finanzen";
import type { KundenGeld } from "@/lib/internData";

// Die fünf Fragen des Auftrags auf einen Blick: was kommt rein, was geht raus,
// was bleibt, wer ist überfällig, wie viel.

export function GesamtAnsicht({
  geld,
  kosten,
  prozent,
  monat,
  heute,
  namen,
}: {
  geld: KundenGeld[];
  kosten: KostenDaten;
  prozent: number;
  monat: string;
  heute: string;
  /** Kunden-ID → zuständige Person. */
  namen: Map<string, string>;
}) {
  const a = monatsAbschluss(geld, kosten, prozent, monat, heute);
  const heuteMonat = heute.slice(0, 7);
  const vorbei = monat < heuteMonat;
  const reihe = Array.from({ length: 12 }, (_, i) =>
    monatsAbschluss(geld, kosten, prozent, monatPlus(monat, i - 6), heute),
  );

  const spaet = geld.filter((g) => g.k.ueberfaellig > 0).sort((x, y) => y.k.tageUeberfaellig - x.k.tageUeberfaellig);
  const spaetSumme = spaet.reduce((s, g) => s + g.k.ueberfaellig, 0);
  const unvollstaendig = geld.filter(
    (g) =>
      !g.vertrag.gekuendigt_am &&
      !g.vertrag.abgebrochen_am &&
      (g.k.nichtVerplant > 0 || g.k.status === "plan_fehlt" || g.k.status === "vertrag_fehlt"),
  );

  const jeKategorie = new Map<KostenKategorie, number>();
  for (const z of kostenImMonat(kosten, monat).zeilen) {
    if (z.betrag) jeKategorie.set(z.position.kategorie, (jeKategorie.get(z.position.kategorie) ?? 0) + z.betrag);
  }
  const kategorien = [...jeKategorie].sort((x, y) => y[1] - x[1]);

  return (
    <div className="ks-stapel">
      {unvollstaendig.length > 0 && (
        <p className="ks-warnung">
          {unvollstaendig.length} von {geld.length} Kunden haben keinen vollständigen Zahlungsplan. Solange fehlen sie in
          „rein“ und „überfällig“.{" "}
          <Link href="/umsatz?ansicht=vertraege" className="ks-link">
            Jetzt erfassen
          </Link>
        </p>
      )}

      <div className="kpi-row" data-cols="4">
        <StatTile
          label="Kommt rein"
          value={formatEur(a.rein)}
          tone="success"
          sub={vorbei ? "eingegangen" : `${formatEur(a.eingegangen)} da, ${formatEur(a.nochErwartet)} kommen noch`}
        />
        <StatTile label="Geht raus" value={formatEur(a.raus)} sub={a.raus ? "Kosten netto" : "noch keine Kosten"} />
        <StatTile
          label={vorbei ? "Blieb übrig" : "Bleibt übrig"}
          value={formatEur(a.frei)}
          tone={a.frei < 0 ? "error" : "neutral"}
          sub={prozent ? `${formatEur(a.gewinn)} vor Rücklage` : "ohne Steuerrücklage"}
        />
        <StatTile
          label="Überfällig gesamt"
          value={formatEur(spaetSumme)}
          tone={spaetSumme ? "error" : "neutral"}
          sub={spaet.length ? `${spaet.length} ${spaet.length === 1 ? "Kunde" : "Kunden"}, nicht eingerechnet` : "niemand zu spät"}
          href="/umsatz?ansicht=ueberfaellig"
        />
      </div>

      <div className="ks-zwei">
        <Card>
          <CardHeader title={`So rechnet sich der ${monatLabel(monat)}`} meta="Netto" />
          <dl className="ks-rechnung">
            <div>
              <dt>Eingegangen</dt>
              <dd>{formatEur(a.eingegangen)}</dd>
            </div>
            {!vorbei && (
              <div>
                <dt>Kommt noch laut Plan</dt>
                <dd>{formatEur(a.nochErwartet)}</dd>
              </div>
            )}
            {kategorien.map(([k, summe]) => (
              <div key={k}>
                <dt>{KOSTEN_KATEGORIE_LABELS[k]}</dt>
                <dd>− {formatEur(summe)}</dd>
              </div>
            ))}
            <div data-summe="true">
              <dt>Gewinn vor Rücklage</dt>
              <dd>{formatEur(a.gewinn)}</dd>
            </div>
            <div>
              <dt>Steuerrücklage {prozent.toLocaleString("de-DE")} %</dt>
              <dd>− {formatEur(a.ruecklage)}</dd>
            </div>
            <div data-summe="true">
              <dt>Wirklich frei</dt>
              <dd>{formatEur(a.frei)}</dd>
            </div>
          </dl>
          {a.ueberfaelligImMonat > 0 && (
            <p className="ks-leise">
              {formatEur(a.ueberfaelligImMonat)} aus diesem Monat sind überfällig und deshalb nicht eingerechnet.
            </p>
          )}
          <div className="ks-fussreihe ks-reihe">
            <RuecklageFeld key={prozent} prozent={prozent} />
            <Link href={`/umsatz?ansicht=kosten&monat=${monat}`} className="ks-link">
              Kosten eintragen
            </Link>
          </div>
        </Card>

        <Card>
          <CardHeader title="Wer ist überfällig" meta="Alle Monate, nach Tagen sortiert" />
          {spaet.length === 0 ? (
            <p className="ks-leise">Niemand ist überfällig.</p>
          ) : (
            <ul className="ks-liste-schlicht">
              {spaet.map((g) => (
                <li key={g.id}>
                  <Link href={`/kunden/${g.id}?tab=zahlungen`} className="ks-schuldner">
                    <span>
                      <span className="ks-name">{g.name}</span>
                      <span className="ks-unter">{namen.get(g.id) ?? "Niemand zuständig"}</span>
                    </span>
                    <span className="ks-rot">
                      {formatEur(g.k.ueberfaellig)}
                      <span className="ks-unter ks-rot">
                        {g.k.tageUeberfaellig} {g.k.tageUeberfaellig === 1 ? "Tag" : "Tage"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Zwölf Monate" meta="Künftige Monate laut Plan. Überfälliges zählt nicht als Einnahme." />
        <MonatsChart reihe={reihe} heuteMonat={heuteMonat} />
      </Card>
    </div>
  );
}
