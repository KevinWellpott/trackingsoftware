import Link from "next/link";
import { Betrag } from "@/components/umsatz/Betrag";
import { Card, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/dashboard/StatTile";
import { RatenMarken } from "@/components/umsatz/RatenMarken";
import { ZahlungButton } from "@/components/umsatz/ZahlungDialog";
import { VereinbarenButton } from "@/components/umsatz/RateAktionen";
import { ZAHLUNGS_ART_LABELS, datumDe, formatEur } from "@/lib/umsatz";
import { monatLabel, monatsTage, zusageZuRate } from "@/lib/finanzen";
import { geldSicht } from "@/lib/geldSicht";
import type { KundenGeld } from "@/lib/internData";

// „Was sollte diesen Monat an welchen Tagen reinkommen?" Am Rechner als
// Kalender plus Liste, am Handy nur die Liste.

const WOCHE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** 0 = Montag. Auf dem Datums-String gerechnet, ohne Zeitzone. */
const wochentag = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;

export function MonatAnsicht({ geld, monat, heute }: { geld: KundenGeld[]; monat: string; heute: string }) {
  const tage = monatsTage(geld, monat);
  const je = new Map(geld.map((g) => [g.id, g]));
  const jeTag = new Map(tage.map((t) => [t.tag, t]));

  let faellig = 0;
  let eingegangen = 0;
  let uebertragen = 0;
  let offen = 0;
  for (const t of tage) {
    faellig += t.faellig;
    eingegangen += t.eingegangen;
    uebertragen += t.uebertragen;
    for (const r of t.raten) offen += r.rate.rest;
  }
  // Was aus früheren Monaten noch offen ist, gehört gesagt, aber nicht in diesen Monat gezählt.
  let alt = 0;
  for (const g of geld) {
    for (const r of g.k.raten) if (r.zustand === "ueberfaellig" && r.faellig_am.slice(0, 7) < monat) alt += r.rest;
  }

  const [j, m] = monat.split("-").map(Number);
  const anzahlTage = new Date(Date.UTC(j, m, 0)).getUTCDate();
  const versatz = wochentag(`${monat}-01`);

  return (
    <div className="ks-stapel">
      <div className="kpi-row" data-cols="4">
        <StatTile label="Fällig" value={formatEur(faellig)} sub="sollte kommen" />
        <StatTile label="Eingegangen" value={formatEur(eingegangen)} tone="success" sub="nach Eingangstag" />
        <StatTile label="Noch offen" value={formatEur(offen)} tone={offen ? "warning" : "neutral"} sub="von diesem Monat" />
        <StatTile label="Übertragen" value={formatEur(uebertragen)} sub="vereinbart verschoben" />
      </div>

      {alt > 0 && (
        <p className="ks-warnung">
          Dazu {formatEur(alt)} aus früheren Monaten.{" "}
          <Link href="/umsatz?ansicht=ueberfaellig" className="ks-link">
            Überfällige ansehen
          </Link>
        </p>
      )}

      <div className="ks-kalender" aria-hidden="true">
        {WOCHE.map((w) => (
          <span key={w} className="ks-kalender-kopf">
            {w}
          </span>
        ))}
        {Array.from({ length: versatz }, (_, i) => (
          <span key={`leer-${i}`} />
        ))}
        {Array.from({ length: anzahlTage }, (_, i) => {
          const iso = `${monat}-${String(i + 1).padStart(2, "0")}`;
          const t = jeTag.get(iso);
          const spaet = t?.raten.some((r) => r.rate.zustand === "ueberfaellig");
          const inhalt = (
            <>
              <span className="ks-kalender-tag">{i + 1}</span>
              {t && t.faellig > 0 && <span className={spaet ? "ks-rot" : undefined}>{formatEur(t.faellig)} fällig</span>}
              {t && t.eingegangen !== 0 && <span className="ks-gruen">{formatEur(t.eingegangen)} da</span>}
              {t && t.uebertragen > 0 && <span className="ks-gold">{formatEur(t.uebertragen)} verlegt</span>}
            </>
          );
          return t ? (
            <a key={iso} href={`#tag-${iso}`} tabIndex={-1} className="ks-kalender-zelle" data-heute={iso === heute}>
              {inhalt}
            </a>
          ) : (
            <span key={iso} className="ks-kalender-zelle" data-heute={iso === heute}>
              {inhalt}
            </span>
          );
        })}
      </div>

      <Card>
        <CardHeader title={`${monatLabel(monat)} nach Tagen`} />
        {tage.length === 0 ? (
          <p className="ks-leise">In diesem Monat ist nichts fällig und nichts eingegangen.</p>
        ) : (
          tage.map((t) => {
            const w = wochentag(t.tag);
            return (
              <section key={t.tag} id={`tag-${t.tag}`} className="ks-tag">
                <h3 className="ks-tag-kopf">
                  {WOCHE[w]}, {datumDe(t.tag)}
                  {t.tag === heute && <span className="ks-heute">heute</span>}
                  {w >= 5 && t.raten.length > 0 && <span className="ks-leise">Wochenende, Geld kommt meist erst Montag</span>}
                </h3>
                <ul className="ks-liste-schlicht">
                  {t.raten.map(({ kundeId, kunde, rate }) => {
                    const g = je.get(kundeId)!;
                    return (
                      <li key={rate.id} className="ks-rate">
                        <Link href={`/kunden/${kundeId}?tab=zahlungen`} className="ks-rate-datum ks-name">
                          {kunde}
                        </Link>
                        <span className="ks-rate-betrag">
                          <Betrag wert={rate.betrag} />
                          {rate.bezahlt > 0 && rate.rest > 0 && <span className="ks-herkunft"><Betrag wert={rate.rest} /> offen</span>}
                        </span>
                        <RatenMarken rate={rate} zusage={zusageZuRate(rate, g.vereinbarungen, heute)} />
                        <span className="ks-rate-aktion">
                          {rate.rest > 0 && (
                            <>
                              <ZahlungButton geld={geldSicht(g)} heute={heute} vorschlag={rate.rest} />
                              <VereinbarenButton geld={geldSicht(g)} rate={rate} heute={heute} />
                            </>
                          )}
                        </span>
                      </li>
                    );
                  })}
                  {t.zahlungen.map(({ kundeId, kunde, zahlung }) => (
                    <li key={zahlung.id} className="ks-buchung">
                      <span>
                        {kunde}
                        <span className="ks-herkunft">{ZAHLUNGS_ART_LABELS[zahlung.art]}</span>
                      </span>
                      <Link href={`/kunden/${kundeId}?tab=zahlungen`} className={zahlung.betrag < 0 ? "ks-rot" : "ks-gruen"}>
                        <Betrag wert={zahlung.betrag} /> {zahlung.betrag < 0 ? "zurück" : "eingegangen"}
                      </Link>
                    </li>
                  ))}
                  {t.uebertraege.map(({ kunde, vereinbarung: v }) => (
                    <li key={v.id} className="ks-buchung">
                      <span>
                        {kunde}
                        <span className="ks-herkunft">{v.grund}</span>
                      </span>
                      <span className="ks-gold">
                        <Betrag wert={v.betrag} /> übertragen auf {datumDe(v.auf_datum)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </Card>
    </div>
  );
}
