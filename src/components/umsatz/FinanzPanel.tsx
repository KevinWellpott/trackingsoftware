"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Feld } from "@/components/kunden/Feld";
import { Textarea } from "@/components/ui/Textarea";
import { DatePicker } from "@/components/ui/DatePicker";
import { Segmented } from "@/components/ui/Segmented";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { StatTile } from "@/components/dashboard/StatTile";
import { DialogFuss, Fehler } from "@/components/kunden/bausteine";
import { BetragFeld, VorherNachher, alsEingabe, useGeldAktion } from "@/components/umsatz/geld";
import { RatenplanForm } from "@/components/umsatz/RatenplanForm";
import { ZahlungButton } from "@/components/umsatz/ZahlungDialog";
import { AendernButton, VereinbarenButton } from "@/components/umsatz/RateAktionen";
import { RatenMarken } from "@/components/umsatz/RatenMarken";
import { ZAHLUNGS_ART_LABELS, datumDe, formatEurGenau, kundenKennzahlen } from "@/lib/umsatz";
import { zusageZuRate, type Vereinbarung } from "@/lib/finanzen";
import { anzahlVerschoben } from "@/lib/umsatzPlanung";
import type { KundenZahlung } from "@/lib/kunden";
import type { GeldAktion } from "@/lib/geldAktion";
import type { GeldSicht } from "@/lib/geldSicht";

// Der Reiter „Zahlungen" der Akte, nur für Admins. Hier wird nichts selbst
// gerechnet, jede Änderung zeigt vorher ihre Wirkung.

type Dialog = null | "plan" | "rate" | "pause" | "vertrag" | "kuendigung" | "abbruch";

const ART_LABEL: Record<Vereinbarung["art"], string> = { stundung: "Gestundet", uebertrag: "Übertragen", zusage: "Zugesagt" };

export function FinanzPanel({
  geld,
  vereinbarungen,
  heute,
  personen,
}: {
  geld: GeldSicht;
  vereinbarungen: Vereinbarung[];
  heute: string;
  personen: Record<string, string>;
}) {
  const [modal, setModal] = useState<Dialog>(null);
  const { error, pending, run } = useGeldAktion(geld);
  const [korrektur, setKorrektur] = useState<KundenZahlung | null>(null);
  const { confirm, dialog } = useConfirm();
  const close = () => setModal(null);
  const { vertrag } = geld;
  const k = kundenKennzahlen(vertrag, geld.raten, geld.zahlungen, heute);
  const hatRaten = k.raten.some((r) => !r.erlass);

  return (
    <div className="ks-stapel">
      {dialog}
      <div className="kpi-row" data-cols="4">
        <StatTile label="Vertrag" value={formatEurGenau(k.vertragswert)} sub="netto" />
        <StatTile
          label="Kassiert"
          value={formatEurGenau(k.kassiert)}
          tone="success"
          sub={k.vertragswert ? `${Math.round((k.kassiert / k.vertragswert) * 100)} % vom Vertrag` : undefined}
        />
        <StatTile
          label="Überfällig"
          value={formatEurGenau(k.ueberfaellig)}
          tone={k.ueberfaellig > 0 ? "error" : "neutral"}
          sub={k.tageUeberfaellig ? `seit ${k.tageUeberfaellig} ${k.tageUeberfaellig === 1 ? "Tag" : "Tagen"}` : "nichts zu spät"}
        />
        <StatTile
          label="Noch erwartet"
          value={formatEurGenau(k.kuenftig)}
          sub={k.naechsteRate && k.naechsteRate.zustand !== "ueberfaellig" ? `nächste ${datumDe(k.naechsteRate.faellig_am)}` : undefined}
        />
      </div>

      {vertrag.gekuendigt_am && (
        <p className="ks-warnung">
          Gekündigt am {datumDe(vertrag.gekuendigt_am)}, wirksam zum {datumDe(vertrag.kuendigung_wirksam_zum)}
          {vertrag.kuendigung_grund ? `: ${vertrag.kuendigung_grund}` : "."}
        </p>
      )}
      {vertrag.abgebrochen_am && (
        <p className="ks-warnung">
          Abgebrochen am {datumDe(vertrag.abgebrochen_am)}
          {vertrag.abbruch_grund ? `: ${vertrag.abbruch_grund}` : "."}
        </p>
      )}
      {k.status === "vertrag_fehlt" && <p className="ks-warnung">Kein Vertragswert erfasst. Bitte unten unter „Vertrag“ eintragen.</p>}
      {k.nichtVerplant > 0 && <p className="ks-warnung">{formatEurGenau(k.nichtVerplant)} vom Vertrag haben noch keine Rate.</p>}
      {k.zuvielVerplant > 0 && (
        <p className="ks-warnung">Die Raten fordern {formatEurGenau(k.zuvielVerplant)} mehr, als der Vertrag hergibt.</p>
      )}
      {k.guthaben > 0 && <p className="ks-warnung">{formatEurGenau(k.guthaben)} Guthaben: mehr gezahlt als offen war.</p>}
      {k.guthaben < 0 && <p className="ks-warnung">Saldo {formatEurGenau(k.guthaben)}: mehr zurückgegangen als eingegangen. Bitte prüfen.</p>}
      <Fehler text={error} />

      <Card>
        <div className="ks-kopf-umbruch">
        <CardHeader
          title="Ratenplan"
          action={
            <div className="ks-reihe">
              <ZahlungButton geld={geld} heute={heute} vorschlag={k.naechsteRate?.rest} variant={hatRaten ? "primary" : "secondary"} />
              <Button size="sm" variant={hatRaten ? "secondary" : "primary"} onClick={() => setModal("plan")}>
                {hatRaten ? "Plan ändern" : "Plan erfassen"}
              </Button>
            </div>
          }
        />
        </div>
        {k.raten.length === 0 ? (
          <p className="ks-leise">Noch kein Plan. Beim Erfassen lässt sich anhaken, welche Raten schon bezahlt sind.</p>
        ) : (
          <ul className="ks-liste-schlicht">
            {k.raten.map((r) => (
              <li key={r.id} className="ks-rate" data-erlassen={r.erlass ? "true" : undefined}>
                <span className="ks-rate-datum">
                  {datumDe(r.faellig_am)}
                  {r.urspruenglich_faellig_am && r.urspruenglich_faellig_am !== r.faellig_am && (
                    <span className="ks-herkunft">
                      ursprünglich {datumDe(r.urspruenglich_faellig_am)}
                      {(() => {
                        const n = anzahlVerschoben(r.id, geld.raten, vereinbarungen);
                        return n > 1 ? ` · ${n}-mal verschoben` : "";
                      })()}
                    </span>
                  )}
                </span>
                <span className="ks-rate-betrag">
                  {formatEurGenau(r.betrag)}
                  {r.bezahlt > 0 && r.rest > 0 && <span className="ks-herkunft">{formatEurGenau(r.rest)} offen</span>}
                  {r.erlass_grund && <span className="ks-herkunft">{r.erlass_grund}</span>}
                </span>
                <RatenMarken rate={r} zusage={zusageZuRate(r, vereinbarungen, heute)} />
                <span className="ks-rate-aktion">
                  {r.erlass ? (
                    !r.erlass_zahlung_id && (
                      <Button size="sm" variant="ghost" loading={pending} onClick={() => run({ typ: "reaktivieren", rateId: r.id })}>
                        Wieder aktivieren
                      </Button>
                    )
                  ) : (
                    <>
                      {r.rest > 0 && <VereinbarenButton geld={geld} rate={r} heute={heute} />}
                      <AendernButton geld={geld} rate={r} heute={heute} />
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="ks-reihe ks-fussreihe">
          <Button size="sm" variant="ghost" onClick={() => setModal("rate")}>
            Einzelne Rate
          </Button>
          {k.kuenftig > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setModal("pause")}>
              Zahlungspause
            </Button>
          )}
        </div>
      </Card>

      {vereinbarungen.length > 0 && (
        <Card>
          <CardHeader title="Vereinbarungen" />
          <ul className="ks-liste-schlicht">
            {[...vereinbarungen].reverse().map((v) => (
              <li key={v.id} className="ks-buchung">
                <span>
                  {ART_LABEL[v.art]}: {formatEurGenau(v.betrag)}, {datumDe(v.von_datum)} → {datumDe(v.auf_datum)}
                </span>
                <span className="ks-leise">{v.grund}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Buchungen" />
        {geld.zahlungen.length === 0 ? (
          <p className="ks-leise">Noch nichts gebucht.</p>
        ) : (
          <ul className="ks-liste-schlicht">
            {[...geld.zahlungen].reverse().map((z) => (
              <li key={z.id} className="ks-buchung">
                <span>
                  {datumDe(z.eingang_am)} · {ZAHLUNGS_ART_LABELS[z.art]}
                  <span className="ks-herkunft">
                    {[z.notiz, z.erfasst_von_user_id ? personen[z.erfasst_von_user_id] : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="ks-buchung-betrag" data-negativ={z.betrag < 0 ? "true" : undefined}>
                  {formatEurGenau(z.betrag)}
                  {z.art === "zahlung" && (
                    <IconButton
                      label={`Zahlung vom ${datumDe(z.eingang_am)} korrigieren`}
                      icon={<Pencil size={14} aria-hidden />}
                      onClick={() => setKorrektur(z)}
                    />
                  )}
                  <IconButton
                    label={`Buchung vom ${datumDe(z.eingang_am)} löschen`}
                    tone="danger"
                    icon={<Trash2 size={14} aria-hidden />}
                    onClick={async () => {
                      const ja = await confirm({
                        title: "Buchung löschen?",
                        message: "Nur für Fehleingaben. Geld, das zurückgegangen ist, wird als Rücklastschrift gebucht.",
                        confirmLabel: "Löschen",
                        destructive: true,
                      });
                      if (ja) run({ typ: "buchung_loeschen", zahlungId: z.id });
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Vertrag"
          meta={[
            formatEurGenau(vertrag.vertragswert),
            vertrag.vertragsstart ? `ab ${datumDe(vertrag.vertragsstart)}` : "Start offen",
            vertrag.laufzeit_monate ? `${vertrag.laufzeit_monate} Monate` : null,
            vertrag.zahlungsart === "einmal" ? "Einmalzahlung" : "Raten",
          ]
            .filter(Boolean)
            .join(" · ")}
          action={
            <Button size="sm" variant="secondary" onClick={() => setModal("vertrag")}>
              Bearbeiten
            </Button>
          }
        />
        {vertrag.notiz && <p className="ks-absatz">{vertrag.notiz}</p>}
        <div className="ks-reihe ks-fussreihe">
          {vertrag.gekuendigt_am ? (
            <Button size="sm" variant="ghost" loading={pending} onClick={() => run({ typ: "kuendigung_zurueck" })}>
              Kündigung zurücknehmen
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setModal("kuendigung")}>
              Kündigung erfassen
            </Button>
          )}
          {vertrag.abgebrochen_am ? (
            <Button size="sm" variant="ghost" loading={pending} onClick={() => run({ typ: "abbruch_zurueck" })}>
              Abbruch zurücknehmen
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setModal("abbruch")}>
              Kunde abgesprungen
            </Button>
          )}
        </div>
      </Card>

      {modal === "plan" && (
        <Modal open onClose={close} title={hatRaten ? "Plan ändern" : "Plan erfassen"} subtitle={geld.name} width={580} closeOnBackdrop={false}>
          <RatenplanForm geld={geld} heute={heute} onDone={close} onCancel={close} />
        </Modal>
      )}
      {korrektur && <KorrekturDialog geld={geld} heute={heute} zahlung={korrektur} onClose={() => setKorrektur(null)} />}
      {modal === "rate" && <RateNeuDialog geld={geld} heute={heute} onClose={close} />}
      {modal === "pause" && <PauseDialog geld={geld} heute={heute} onClose={close} />}
      {modal === "vertrag" && <VertragDialog geld={geld} heute={heute} onClose={close} />}
      {modal === "kuendigung" && <KuendigungDialog geld={geld} heute={heute} onClose={close} />}
      {modal === "abbruch" && <AbbruchDialog geld={geld} heute={heute} onClose={close} />}
    </div>
  );
}

type DialogProps = { geld: GeldSicht; heute: string; onClose: () => void };

function KorrekturDialog({ geld, heute, zahlung, onClose }: DialogProps & { zahlung: KundenZahlung }) {
  const [datum, setDatum] = useState<string | null>(zahlung.eingang_am);
  const [betrag, setBetrag] = useState(alsEingabe(zahlung.betrag));
  const [notiz, setNotiz] = useState(zahlung.notiz ?? "");
  const { error, pending, run } = useGeldAktion(geld);
  const aktion: GeldAktion = { typ: "buchung_korrigieren", zahlungId: zahlung.id, betrag, eingang_am: datum ?? "", notiz };
  return (
    <Modal open onClose={onClose} title="Zahlung korrigieren" subtitle="Für Tippfehler in Betrag, Datum oder Notiz.">
      <div className="ks-stapel">
        <div className="ks-felder">
          <Feld label="Eingegangen am">
            <DatePicker value={datum} onChange={setDatum} variant="input" />
          </Feld>
          <BetragFeld label="Betrag" wert={betrag} onChange={setBetrag} />
        </div>
        <Feld label="Notiz">
          <Input value={notiz} onChange={(e) => setNotiz(e.target.value)} />
        </Feld>
        {betrag && <VorherNachher geld={geld} aktion={aktion} heute={heute} />}
        <Fehler text={error} />
        <DialogFuss label="Korrigieren" pending={pending} disabled={!betrag || !datum} onClose={onClose} onSubmit={() => run(aktion, onClose)} />
      </div>
    </Modal>
  );
}

function RateNeuDialog({ geld, heute, onClose }: DialogProps) {
  const [datum, setDatum] = useState<string | null>(null);
  const [betrag, setBetrag] = useState("");
  const [notiz, setNotiz] = useState("");
  const { error, pending, run } = useGeldAktion(geld);
  const aktion: GeldAktion = { typ: "rate_neu", faellig_am: datum ?? "", betrag, notiz };
  return (
    <Modal open onClose={onClose} title="Einzelne Rate">
      <div className="ks-stapel">
        <div className="ks-felder">
          <Feld label="Fällig am">
            <DatePicker value={datum} onChange={setDatum} variant="input" placeholder="Datum wählen" />
          </Feld>
          <BetragFeld label="Betrag" wert={betrag} onChange={setBetrag} />
        </div>
        <Feld label="Notiz">
          <Input value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="Optional" />
        </Feld>
        {datum && betrag && <VorherNachher geld={geld} aktion={aktion} heute={heute} />}
        <Fehler text={error} />
        <DialogFuss label="Hinzufügen" pending={pending} disabled={!datum || !betrag} onClose={onClose} onSubmit={() => run(aktion, onClose)} />
      </div>
    </Modal>
  );
}

function PauseDialog({ geld, heute, onClose }: DialogProps) {
  const [monate, setMonate] = useState("1");
  const [grund, setGrund] = useState("");
  const { error, pending, run } = useGeldAktion(geld);
  const aktion: GeldAktion = { typ: "pause", monate: Number(monate), grund };
  return (
    <Modal open onClose={onClose} title="Zahlungspause" subtitle="Alle offenen künftigen Raten rücken nach hinten. Überfälliges bleibt überfällig.">
      <div className="ks-stapel">
        <Feld label="Monate">
          <Input type="number" inputMode="numeric" min={1} max={24} value={monate} onChange={(e) => setMonate(e.target.value)} />
        </Feld>
        <Feld label="Was wurde vereinbart?">
          <Input value={grund} onChange={(e) => setGrund(e.target.value)} />
        </Feld>
        {grund && <VorherNachher geld={geld} aktion={aktion} heute={heute} />}
        <Fehler text={error} />
        <DialogFuss label="Pause eintragen" pending={pending} disabled={!grund.trim()} onClose={onClose} onSubmit={() => run(aktion, onClose)} />
      </div>
    </Modal>
  );
}

function VertragDialog({ geld, heute, onClose }: DialogProps) {
  const v = geld.vertrag;
  const [wert, setWert] = useState(alsEingabe(v.vertragswert));
  const [start, setStart] = useState<string | null>(v.vertragsstart);
  const [laufzeit, setLaufzeit] = useState(v.laufzeit_monate ? String(v.laufzeit_monate) : "");
  const [art, setArt] = useState<"einmal" | "raten">(v.zahlungsart);
  const [notiz, setNotiz] = useState(v.notiz ?? "");
  const { error, pending, run } = useGeldAktion(geld);
  const aktion: GeldAktion = {
    typ: "vertrag",
    vertragswert: wert,
    vertragsstart: start,
    laufzeit_monate: laufzeit ? Number(laufzeit) : null,
    zahlungsart: art,
    notiz,
  };
  return (
    <Modal open onClose={onClose} title="Vertrag">
      <div className="ks-stapel">
        <div className="ks-felder">
          <BetragFeld label="Vertragswert" wert={wert} onChange={setWert} />
          <Feld label="Vertragsstart">
            <DatePicker value={start} onChange={setStart} variant="input" clearable />
          </Feld>
          <Feld label="Laufzeit (Monate)">
            <Input type="number" inputMode="numeric" min={1} max={120} value={laufzeit} onChange={(e) => setLaufzeit(e.target.value)} />
          </Feld>
          <Feld label="Zahlungsart">
            <Segmented
              options={[
                { value: "raten", label: "Raten" },
                { value: "einmal", label: "Einmal" },
              ]}
              value={art}
              onChange={setArt}
              fullWidth
            />
          </Feld>
        </div>
        <Feld label="Notiz">
          <Textarea value={notiz} onChange={(e) => setNotiz(e.target.value)} rows={3} />
        </Feld>
        {wert && <VorherNachher geld={geld} aktion={aktion} heute={heute} />}
        <Fehler text={error} />
        <DialogFuss label="Speichern" pending={pending} disabled={!wert} onClose={onClose} onSubmit={() => run(aktion, onClose)} />
      </div>
    </Modal>
  );
}

function KuendigungDialog({ geld, heute, onClose }: DialogProps) {
  const [am, setAm] = useState<string | null>(heute);
  const [zum, setZum] = useState<string | null>(null);
  const [grund, setGrund] = useState("");
  const { error, pending, run } = useGeldAktion(geld);
  const aktion: GeldAktion = { typ: "kuendigung", gekuendigt_am: am ?? "", wirksam_zum: zum ?? "", grund };
  return (
    <Modal open onClose={onClose} title="Kündigung erfassen" subtitle="Was bis zum Wirksamkeitstag fällig ist, bleibt geschuldet. Danach wird storniert.">
      <div className="ks-stapel">
        <div className="ks-felder">
          <Feld label="Gekündigt am">
            <DatePicker value={am} onChange={setAm} variant="input" />
          </Feld>
          <Feld label="Wirksam zum">
            <DatePicker value={zum} onChange={setZum} variant="input" placeholder="Datum wählen" />
          </Feld>
        </div>
        <Feld label="Grund">
          <Input value={grund} onChange={(e) => setGrund(e.target.value)} placeholder="Optional" />
        </Feld>
        {zum && <VorherNachher geld={geld} aktion={aktion} heute={heute} />}
        <Fehler text={error} />
        <DialogFuss label="Kündigung speichern" destructive pending={pending} disabled={!am || !zum} onClose={onClose} onSubmit={() => run(aktion, onClose)} />
      </div>
    </Modal>
  );
}

function AbbruchDialog({ geld, heute, onClose }: DialogProps) {
  const [datum, setDatum] = useState<string | null>(heute);
  const [grund, setGrund] = useState("");
  const { error, pending, run } = useGeldAktion(geld);
  const aktion: GeldAktion = { typ: "abbruch", datum: datum ?? "", grund };
  return (
    <Modal open onClose={onClose} title="Kunde abgesprungen" subtitle="Alles Offene wird als Ausfall abgeschrieben. Lässt sich zurücknehmen.">
      <div className="ks-stapel">
        <Feld label="Seit">
          <DatePicker value={datum} onChange={setDatum} variant="input" />
        </Feld>
        <Feld label="Grund">
          <Input value={grund} onChange={(e) => setGrund(e.target.value)} placeholder="Optional" />
        </Feld>
        {datum && <VorherNachher geld={geld} aktion={aktion} heute={heute} />}
        <Fehler text={error} />
        <DialogFuss label="Abbruch speichern" destructive pending={pending} disabled={!datum} onClose={onClose} onSubmit={() => run(aktion, onClose)} />
      </div>
    </Modal>
  );
}
