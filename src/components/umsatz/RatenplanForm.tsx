"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Feld } from "@/components/kunden/Feld";
import { DatePicker } from "@/components/ui/DatePicker";
import { Segmented } from "@/components/ui/Segmented";
import { Select } from "@/components/ui/Select";
import { Fehler } from "@/components/kunden/bausteine";
import { BetragFeld, VorherNachher, alsEingabe, useGeldAktion } from "@/components/umsatz/geld";
import { datumDe, formatEurGenau } from "@/lib/umsatz";
import { planVorschlag } from "@/lib/umsatzPlanung";
import { planRaten, type GeldAktion, type PlanEingabe } from "@/lib/geldAktion";
import { standAus, type GeldSicht } from "@/lib/geldSicht";

// Ratenplan und Schnellerfassung in einem. Für Bestandskunden: Plan wählen,
// in der Vorschau die letzte bezahlte Rate anhaken, fertig.
//
// Nichts wird geraten: kein Startdatum, keine Ratenzahl. Beides stünde sonst
// als Tatsache im Plan.

const RHYTHMEN = [
  { value: "1", label: "Monatlich" },
  { value: "2", label: "Alle 2 Monate" },
  { value: "3", label: "Quartalsweise" },
  { value: "6", label: "Halbjährlich" },
  { value: "12", label: "Jährlich" },
];

export function RatenplanForm({
  geld,
  heute,
  onDone,
  onCancel,
}: {
  geld: GeldSicht;
  heute: string;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const stand = standAus(geld);
  const hatRaten = geld.raten.some((r) => !r.erlass);

  const [modus, setModus] = useState<"ersetzen" | "ergaenzen">(hatRaten ? "ersetzen" : "ergaenzen");
  const [gesamt, setGesamt] = useState(() => alsEingabe(planVorschlag(stand, hatRaten ? "ersetzen" : "ergaenzen", heute)));
  const [art, setArt] = useState<"raten" | "einmal">(geld.vertrag.zahlungsart);
  const [anzahl, setAnzahl] = useState("");
  const [rhythmus, setRhythmus] = useState("1");
  const [erstes, setErstes] = useState<string | null>(hatRaten ? null : geld.vertrag.vertragsstart);
  const [anzahlung, setAnzahlung] = useState("");
  const [anzahlungAm, setAnzahlungAm] = useState<string | null>(null);
  const [bis, setBis] = useState(0);
  const [teil, setTeil] = useState("");
  const { error, pending, run } = useGeldAktion(geld);
  // Auf einen bestehenden Plan angehängt landete die Zahlung auf der ältesten alten Rate.
  const schnell = geld.zahlungen.length === 0 && (modus === "ersetzen" || !hatRaten);

  const wechsel = (m: "ersetzen" | "ergaenzen") => {
    setModus(m);
    setGesamt(alsEingabe(planVorschlag(stand, m, heute)));
  };

  const plan: PlanEingabe = {
    gesamt,
    anzahlung: art === "raten" ? anzahlung : "",
    anzahlungDatum: anzahlungAm ?? undefined,
    anzahl: art === "einmal" ? 1 : Math.floor(Number(anzahl) || 0),
    erstesDatum: erstes ?? "",
    rhythmusMonate: Number(rhythmus),
  };
  const bereit = !!gesamt && !!erstes && (art === "einmal" || anzahl !== "");
  const ergebnis = bereit ? planRaten(plan) : [];
  const fehler = "error" in ergebnis ? ergebnis.error : null;
  const raten = "error" in ergebnis ? [] : [...ergebnis].sort((a, b) => a.faellig_am.localeCompare(b.faellig_am));
  const bezahltBis = schnell ? Math.min(bis, raten.length) : 0;

  const aktion: GeldAktion = {
    typ: "plan",
    modus,
    plan,
    bezahltBis,
    teilbetrag: schnell && bezahltBis < raten.length ? teil : "",
  };

  return (
    <div className="ks-stapel">
      {hatRaten && (
        <>
          <Segmented
            options={[
              { value: "ersetzen", label: "Offene Raten ersetzen" },
              { value: "ergaenzen", label: "Zusätzlich anhängen" },
            ]}
            value={modus}
            onChange={wechsel}
            ariaLabel="Was mit dem bestehenden Plan passiert"
            fullWidth
          />
          <p className="ks-leise">
            {modus === "ersetzen"
              ? "Bezahltes bleibt stehen. Vorgeschlagen ist, was vom Vertrag noch offen ist."
              : "Für einen Upsell. Vorher den Vertragswert erhöhen, dann stimmt der Vorschlag."}
          </p>
        </>
      )}

      <Segmented
        options={[
          { value: "raten", label: "Raten" },
          { value: "einmal", label: "Einmalzahlung" },
        ]}
        value={art}
        onChange={setArt}
        ariaLabel="Zahlungsart"
        fullWidth
      />

      <div className="ks-felder">
        <BetragFeld key={modus} label="Zu verteilen" wert={gesamt} onChange={setGesamt} hint={`Vertrag: ${formatEurGenau(geld.vertrag.vertragswert)}`} />
        <Feld label={art === "einmal" ? "Fällig am" : "Erste Rate fällig am"}>
          <DatePicker value={erstes} onChange={setErstes} variant="input" placeholder="Datum wählen" />
        </Feld>
        {art === "raten" && (
          <>
            <Feld label="Anzahl Raten">
              <Input type="number" inputMode="numeric" min={1} max={120} value={anzahl} onChange={(e) => setAnzahl(e.target.value)} />
            </Feld>
            <Feld label="Rhythmus">
              <Select value={rhythmus} onChange={setRhythmus} options={RHYTHMEN} />
            </Feld>
            <Feld label="Davon Anzahlung (netto, €)" hint="Optional, als eigene Rate">
              <Input inputMode="decimal" value={anzahlung} onChange={(e) => setAnzahlung(e.target.value)} />
            </Feld>
            {anzahlung && (
              <Feld label="Anzahlung fällig am" hint="Leer = mit der ersten Rate">
                <DatePicker value={anzahlungAm} onChange={setAnzahlungAm} variant="input" clearable />
              </Feld>
            )}
          </>
        )}
      </div>

      {raten.length > 0 && (
        <div className="ks-auswahl" data-hoch="true">
          {schnell && <p className="ks-leise">Schon bezahlt? Die letzte bezahlte Rate anhaken, die davor zählen mit.</p>}
          {raten.map((r, i) => (
            <label key={i} className="ks-wahl">
              {schnell && (
                <input
                  type="checkbox"
                  checked={i < bezahltBis}
                  onChange={() => setBis(i < bezahltBis ? i : i + 1)}
                  aria-label={`Rate ${i + 1} ist bezahlt`}
                />
              )}
              <span className="ks-planzeile">
                <span>
                  {i + 1}. {datumDe(r.faellig_am)}
                </span>
                <span>{formatEurGenau(r.betrag)}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      {schnell && raten.length > 0 && bezahltBis < raten.length && (
        <Feld label={`Auf Rate ${bezahltBis + 1} schon angezahlt (netto, €)`} hint="Optional">
          <Input inputMode="decimal" value={teil} onChange={(e) => setTeil(e.target.value)} />
        </Feld>
      )}

      {raten.length > 0 && <VorherNachher geld={geld} aktion={aktion} heute={heute} />}
      <Fehler text={error ?? fehler} />
      <div className="ui-modal-actions ks-dialog-fuss">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Später
          </Button>
        )}
        <Button variant="primary" loading={pending} disabled={!raten.length} onClick={() => run(aktion, onDone)}>
          Plan speichern
        </Button>
      </div>
    </div>
  );
}
