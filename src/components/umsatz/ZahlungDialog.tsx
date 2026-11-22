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
import { ZAHLUNGS_ART_LABELS, type ZahlungsArt } from "@/lib/umsatz";
import type { GeldSicht } from "@/lib/geldSicht";
import type { GeldAktion } from "@/lib/geldAktion";

// Der häufigste Handgriff: zwei Klicks. Öffnen, Buchen. Vorbelegt sind heute
// und der offene Rest der Rate.

export function ZahlungButton({
  geld,
  heute,
  vorschlag,
  label = "Eingang buchen",
  size = "sm",
  variant = "secondary",
}: {
  geld: GeldSicht;
  heute: string;
  vorschlag?: number | null;
  label?: string;
  size?: "sm" | "md";
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && <ZahlungDialog geld={geld} heute={heute} vorschlag={vorschlag} onClose={() => setOpen(false)} />}
    </>
  );
}

const ARTEN: { value: ZahlungsArt; label: string }[] = [
  { value: "zahlung", label: ZAHLUNGS_ART_LABELS.zahlung },
  { value: "ruecklastschrift", label: ZAHLUNGS_ART_LABELS.ruecklastschrift },
  { value: "erstattung", label: ZAHLUNGS_ART_LABELS.erstattung },
];

const ERKLAERUNG: Record<ZahlungsArt, string | null> = {
  zahlung: null,
  ruecklastschrift: "Das Geld ist zurückgegangen. Die zuletzt bezahlte Rate ist danach wieder offen.",
  erstattung: "Wir zahlen Geld zurück. Daraus entsteht keine neue Forderung.",
};

function ZahlungDialog({
  geld,
  heute,
  vorschlag,
  onClose,
}: {
  geld: GeldSicht;
  heute: string;
  vorschlag?: number | null;
  onClose: () => void;
}) {
  const [art, setArt] = useState<ZahlungsArt>("zahlung");
  const [datum, setDatum] = useState<string | null>(heute);
  const [betrag, setBetrag] = useState(alsEingabe(vorschlag));
  const [notiz, setNotiz] = useState("");
  const { error, doppelt, pending, run } = useGeldAktion(geld);

  const aktion: GeldAktion = { typ: "buchung", art, betrag, eingang_am: datum ?? "", notiz };

  // Die Warnung gilt nur für genau das, was sie gemeldet hat.
  const warnung = doppelt && doppelt.fuer === JSON.stringify(aktion) ? doppelt.text : null;

  return (
    <Modal open onClose={onClose} title="Geld buchen" subtitle={geld.name}>
      <div className="ks-stapel">
        <Segmented options={ARTEN} value={art} onChange={setArt} ariaLabel="Art der Buchung" fullWidth />
        {ERKLAERUNG[art] && <p className="ks-leise">{ERKLAERUNG[art]}</p>}
        <div className="ks-felder">
          <Feld label={art === "zahlung" ? "Eingegangen am" : "Gebucht am"}>
            <DatePicker value={datum} onChange={setDatum} variant="input" />
          </Feld>
          <BetragFeld label="Betrag" wert={betrag} onChange={setBetrag} autoFocus />
        </div>
        <Feld label="Notiz">
          <Input value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="Optional" />
        </Feld>
        {betrag && <VorherNachher geld={geld} aktion={aktion} heute={heute} />}
        {warnung && <p className="ks-warnung">{warnung}</p>}
        <Fehler text={error} />
        <DialogFuss
          label={warnung ? "Trotzdem buchen" : "Buchen"}
          pending={pending}
          disabled={!betrag.trim() || !datum}
          onClose={onClose}
          onSubmit={() => run({ ...aktion, trotzDoppelt: !!warnung }, onClose)}
        />
      </div>
    </Modal>
  );
}
