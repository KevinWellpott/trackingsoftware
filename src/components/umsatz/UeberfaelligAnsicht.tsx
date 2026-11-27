import Link from "next/link";
import { Betrag } from "@/components/umsatz/Betrag";
import { Card, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/dashboard/StatTile";
import { RatenMarken } from "@/components/umsatz/RatenMarken";
import { ZahlungButton } from "@/components/umsatz/ZahlungDialog";
import { VereinbarenButton } from "@/components/umsatz/RateAktionen";
import { datumDe, formatEur, tageZwischen, type VerteilteRate } from "@/lib/umsatz";
import { KontaktLinks } from "@/components/kunden/Kontakt";
import { ErinnertButton } from "@/components/umsatz/ErinnertButton";
import { ALTERSKLASSE_LABELS, altersklasse, zusageZuRate, type Altersklasse } from "@/lib/finanzen";
import { geldSicht } from "@/lib/geldSicht";
import type { Erinnerung, KundenGeld } from "@/lib/internData";

// Wer, wie viel, wie viele Tage, wer kümmert sich.

export function UeberfaelligAnsicht({
  geld,
  heute,
  namen,
  kontakte,
  erinnerungen,
  personen,
}: {
  geld: KundenGeld[];
  heute: string;
  namen: Map<string, string>;
  kontakte: Map<string, { telefon: string | null; email: string | null }>;
  erinnerungen: Map<string, Erinnerung>;
  /** user_id → Name, für „wer hat erinnert". */
  personen: Map<string, string>;
}) {
  const erinnert = (id: string) => {
    const e = erinnerungen.get(id);
    if (!e) return "Noch nie erinnert";
    const t = tageZwischen(e.tag, heute);
    const wann = t <= 0 ? "Heute erinnert" : t === 1 ? "Gestern erinnert" : `Vor ${t} Tagen erinnert`;
    const wer = e.user_id ? personen.get(e.user_id) : undefined;
    return wer ? `${wann} · ${wer}` : wann;
  };
  const zeilen = geld
    .filter((g) => g.k.ueberfaellig > 0)
    .sort((a, b) => b.k.tageUeberfaellig - a.k.tageUeberfaellig || b.k.ueberfaellig - a.k.ueberfaellig)
    .map((g) => ({
      g,
      raten: g.k.raten
        .filter((r) => r.zustand === "ueberfaellig")
        .map((r: VerteilteRate) => ({ r, zusage: zusageZuRate(r, g.vereinbarungen, heute) })),
    }));

  const klassen: Record<Altersklasse, number> = { bis7: 0, bis30: 0, ueber30: 0 };
  let summe = 0;
  let zugesagt = 0;
  for (const { raten } of zeilen) {
    for (const { r, zusage } of raten) {
      summe += r.rest;
      klassen[altersklasse(r.tage)] += r.rest;
      if (zusage && !zusage.gebrochen) zugesagt += r.rest;
    }
  }

  return (
    <div className="ks-stapel">
      <div className="kpi-row" data-cols="4">
        <StatTile
          label="Überfällig"
          value={formatEur(summe)}
          tone={summe ? "error" : "neutral"}
          sub={zugesagt ? `davon ${formatEur(zugesagt)} zugesagt` : undefined}
        />
        {(Object.keys(klassen) as Altersklasse[]).map((k) => (
          <StatTile key={k} label={ALTERSKLASSE_LABELS[k]} value={formatEur(klassen[k])} tone={k === "ueber30" && klassen[k] ? "error" : "neutral"} />
        ))}
      </div>

      {zeilen.length === 0 && (
        <Card>
          <p className="ks-leise">Niemand ist überfällig.</p>
        </Card>
      )}

      {zeilen.map(({ g, raten }) => (
        <Card key={g.id}>
          <CardHeader
            title={
              <Link href={`/kunden/${g.id}?tab=zahlungen`} className="ks-name">
                {g.name}
              </Link>
            }
            meta={namen.get(g.id) ? `Kümmert sich: ${namen.get(g.id)}` : <span className="ks-gold">Niemand zuständig</span>}
            action={
              <p className="ks-betrag-rechts ks-rot">
                <Betrag wert={g.k.ueberfaellig} />
                <span>
                  {g.k.tageUeberfaellig} {g.k.tageUeberfaellig === 1 ? "Tag" : "Tage"}
                </span>
              </p>
            }
          />
          <div className="ks-kuemmern">
            <span className={erinnerungen.get(g.id)?.tag === heute ? "ks-gruen" : "ks-leise"}>{erinnert(g.id)}</span>
            <KontaktLinks telefon={kontakte.get(g.id)?.telefon ?? null} email={kontakte.get(g.id)?.email ?? null} />
            <ErinnertButton kundeId={g.id} heuteSchon={erinnerungen.get(g.id)?.tag === heute} />
          </div>
          <ul className="ks-liste-schlicht">
            {raten.map(({ r, zusage }) => (
              <li key={r.id} className="ks-rate">
                <span className="ks-rate-datum">
                  {datumDe(r.faellig_am)}
                  {r.urspruenglich_faellig_am && r.urspruenglich_faellig_am !== r.faellig_am && (
                    <span className="ks-herkunft">ursprünglich {datumDe(r.urspruenglich_faellig_am)}</span>
                  )}
                </span>
                <span className="ks-rate-betrag"><Betrag wert={r.rest} /></span>
                <RatenMarken rate={r} zusage={zusage} />
                <span className="ks-rate-aktion">
                  <ZahlungButton geld={geldSicht(g)} heute={heute} vorschlag={r.rest} />
                  <VereinbarenButton geld={geldSicht(g)} rate={r} heute={heute} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
