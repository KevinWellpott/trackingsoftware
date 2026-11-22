"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Feld } from "@/components/kunden/Feld";
import { DatePicker } from "@/components/ui/DatePicker";
import { Segmented } from "@/components/ui/Segmented";
import { DialogFuss, Fehler } from "@/components/kunden/bausteine";
import { BetragFeld, VorherNachher, alsEingabe, useGeldAktion } from "@/components/umsatz/geld";
import { addMonthsISO, datumDe, formatEurGenau, type VerteilteRate } from "@/lib/umsatz";
import { planEnde } from "@/lib/umsatzPlanung";
import type { GeldSicht } from "@/lib/geldSicht";
import type { GeldAktion } from "@/lib/geldAktion";

// Zwei Knöpfe je Rate. „Vereinbaren" ist alles, was man mit dem Kunden
// ausmacht (Stundung, Übertrag, Zusage), „Ändern" alles andere.

type Props = { geld: GeldSicht; rate: VerteilteRate; heute: string };

export function VereinbarenButton(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Vereinbaren
      </Button>
      {open && <VereinbarenDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

export function AendernButton(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Ändern
      </Button>
      {open && <AendernDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

type Art = "stunden" | "folgeraten" | "zusage";

const istWochenende = (iso: string) => [0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay());

const ERKLAERUNG: Record<Art, string> = {
  stunden: "Ihr habt euch geeinigt. Bis zum neuen Datum ist nichts überfällig, das alte bleibt sichtbar.",
  folgeraten: "Ihr habt euch geeinigt. Der Betrag verteilt sich gleichmäßig auf die kommenden Raten.",
  zusage: "Der Kunde verspricht nur. Die Rate bleibt überfällig ab Fälligkeit, mit dem Vermerk der Zusage.",
};

function VereinbarenDialog({ geld, rate, heute, onClose }: Props & { onClose: () => void }) {
  const [art, setArt] = useState<Art>("stunden");
  const [auf, setAuf] = useState<string | null>(null);
  const [grund, setGrund] = useState("");
  const [betrag, setBetrag] = useState(alsEingabe(rate.rest));
  const { error, pending, run } = useGeldAktion(geld);

  const aktion: GeldAktion =
    art === "folgeraten"
      ? { typ: "folgeraten", rateId: rate.id, grund, betrag }
      : { typ: art, rateId: rate.id, auf: auf ?? "", grund, betrag };

  // Der letzte Tag dieses Monats: der Erste des nächsten minus ein Tag.
  const monatsende = (() => {
    const d = new Date(`${addMonthsISO(`${heute.slice(0, 7)}-01`, 1)}T00:00:00Z`);
    d.setUTCDate(0);
    return d.toISOString().slice(0, 10);
  })();
  const basis = rate.faellig_am > heute ? rate.faellig_am : heute;
  const ende = planEnde(geld.raten);
  const schnellwahl = [
    { label: "Monatsende", wert: monatsende },
    { label: "Ein Monat", wert: addMonthsISO(basis, 1) },
    ...(ende && ende >= heute ? [{ label: "Ans Planende", wert: ende }] : []),
  ].filter((s) => art === "zusage" || s.wert > rate.faellig_am);

  const bereit = !!betrag && (art === "folgeraten" || !!auf) && (art === "zusage" || !!grund.trim());
  // Die Wirkung zeigen, auch wenn die Begründung noch fehlt.
  const probe: GeldAktion =
    aktion.typ === "stunden" || aktion.typ === "folgeraten" ? { ...aktion, grund: grund.trim() || "Vorschau" } : aktion;

  return (
    <Modal open onClose={onClose} title="Mit dem Kunden vereinbart" subtitle={`${geld.name}: ${formatEurGenau(rate.rest)} offen, fällig ${datumDe(rate.faellig_am)}`} width={540}>
      <div className="ks-stapel">
        <Segmented
          options={[
            { value: "stunden", label: "Später zahlen" },
            { value: "folgeraten", label: "Übertragen" },
            { value: "zusage", label: "Nur zugesagt" },
          ]}
          value={art}
          onChange={setArt}
          ariaLabel="Art der Vereinbarung"
          fullWidth
        />
        <p className="ks-leise">{ERKLAERUNG[art]}</p>

        {art !== "folgeraten" && (
          <>
            <Feld label={art === "stunden" ? "Neues Datum" : "Zugesagt zum"}>
              <DatePicker value={auf} onChange={setAuf} variant="input" placeholder="Datum wählen" />
            </Feld>
            <div className="ks-chips">
              {schnellwahl.map((s) => (
                <button key={s.label} type="button" className="ks-chip" data-active={auf === s.wert} onClick={() => setAuf(s.wert)}>
                  {s.label} · {datumDe(s.wert)}
                </button>
              ))}
            </div>
          </>
        )}

        {art !== "folgeraten" && auf && istWochenende(auf) && (
          <p className="ks-leise">Das ist ein Wochenende. Das Datum bleibt, das Geld kommt meist erst Montag.</p>
        )}
        <BetragFeld label="Betrag" wert={betrag} onChange={setBetrag} hint="Auch ein Teil geht." />
        <Feld label={art === "zusage" ? "Notiz (optional)" : "Was wurde vereinbart?"}>
          <Input value={grund} onChange={(e) => setGrund(e.target.value)} />
        </Feld>

        {art !== "zusage" && !!betrag && (art === "folgeraten" || !!auf) && <VorherNachher geld={geld} aktion={probe} heute={heute} />}
        <Fehler text={error} />
        <DialogFuss label="Festhalten" pending={pending} disabled={!bereit} onClose={onClose} onSubmit={() => run(aktion, onClose)} />
      </div>
    </Modal>
  );
}

type Wie = "korrigieren" | "zurueck" | "storniert" | "abgeschrieben" | "loeschen";

function AendernDialog({ geld, rate, heute, onClose }: Props & { onClose: () => void }) {
  const offen = rate.rest > 0;
  const unbezahlt = rate.bezahlt === 0;
  const [wie, setWie] = useState<Wie>("korrigieren");
  const [datum, setDatum] = useState<string | null>(rate.faellig_am);
  const [betrag, setBetrag] = useState(alsEingabe(rate.betrag));
  const [grund, setGrund] = useState("");
  const { error, pending, run } = useGeldAktion(geld);

  const aktion: GeldAktion =
    wie === "korrigieren"
      ? { typ: "rate_korrigieren", rateId: rate.id, faellig_am: datum ?? "", betrag }
      : wie === "zurueck"
        ? { typ: "stundung_zurueck", rateId: rate.id }
        : wie === "loeschen"
          ? { typ: "rate_loeschen", rateId: rate.id }
          : { typ: "erlass", rateId: rate.id, erlass: wie, grund };

  const optionen: { value: Wie; label: string }[] = [
    { value: "korrigieren", label: "Korrigieren" },
    ...(unbezahlt && rate.urspruenglich_faellig_am && rate.urspruenglich_faellig_am !== rate.faellig_am
      ? ([{ value: "zurueck", label: "Stundung zurück" }] as const)
      : []),
    ...(offen
      ? ([
          { value: "storniert", label: "Nachlass" },
          { value: "abgeschrieben", label: "Ausfall" },
        ] as const)
      : []),
    ...(unbezahlt ? ([{ value: "loeschen", label: "Löschen" }] as const) : []),
  ];

  const text: Record<Wie, string> = {
    korrigieren: "Nur für Eingabefehler. Eine Einigung mit dem Kunden gehört unter „Vereinbaren“.",
    zurueck: `Die Stundung war ein Versehen. Die Rate ist wieder am ${datumDe(rate.urspruenglich_faellig_am)} fällig.`,
    storniert: "Der offene Rest wird nicht mehr geschuldet.",
    abgeschrieben: "Der offene Rest wäre geschuldet, kommt aber nicht mehr. Er zählt als Ausfall.",
    loeschen: "Die Rate verschwindet aus dem Plan. Für Nachlass und Kündigung ist Löschen falsch.",
  };

  return (
    <Modal open onClose={onClose} title="Rate ändern" subtitle={`${formatEurGenau(rate.betrag)}, fällig ${datumDe(rate.faellig_am)}`} width={540}>
      <div className="ks-stapel">
        <Segmented options={optionen} value={wie} onChange={setWie} ariaLabel="Was ändern" fullWidth />
        <p className="ks-leise">{text[wie]}</p>
        {wie === "korrigieren" && (
          <div className="ks-felder">
            <BetragFeld label="Betrag" wert={betrag} onChange={setBetrag} />
            {unbezahlt && (
              <Feld label="Fällig am">
                <DatePicker value={datum} onChange={setDatum} variant="input" />
              </Feld>
            )}
          </div>
        )}
        {(wie === "storniert" || wie === "abgeschrieben") && (
          <Feld label="Grund">
            <Input value={grund} onChange={(e) => setGrund(e.target.value)} placeholder="Optional" />
          </Feld>
        )}
        <VorherNachher geld={geld} aktion={aktion} heute={heute} />
        <Fehler text={error} />
        <DialogFuss label="Speichern" pending={pending} destructive={wie !== "korrigieren" && wie !== "zurueck"} onClose={onClose} onSubmit={() => run(aktion, onClose)} />
      </div>
    </Modal>
  );
}
