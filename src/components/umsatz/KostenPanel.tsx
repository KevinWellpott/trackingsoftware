"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import {
  kostenAnlegen,
  kostenBearbeiten,
  kostenBeenden,
  kostenBetragAb,
  kostenLoeschen,
  kostenMonat,
} from "@/app/actions/umsatz";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Feld } from "@/components/kunden/Feld";
import { Select } from "@/components/ui/Select";
import { Segmented } from "@/components/ui/Segmented";
import { StatTile } from "@/components/dashboard/StatTile";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { DialogFuss, Fehler, useAktion } from "@/components/kunden/bausteine";
import { BetragFeld, alsEingabe } from "@/components/umsatz/geld";
import { formatEur, formatEurGenau } from "@/lib/umsatz";
import {
  KOSTEN_KATEGORIE_LABELS,
  RHYTHMUS_LABELS,
  kostenImMonat,
  monatLabel,
  monatPlus,
  type KostenDaten,
  type KostenKategorie,
  type KostenPosition,
  type KostenRhythmus,
} from "@/lib/finanzen";

// Große Kostenpositionen. Ist ersetzt Plan (G8), eine Änderung gilt ab Monat X
// und lässt frühere Monate stehen (G9).

const KATEGORIEN = Object.entries(KOSTEN_KATEGORIE_LABELS).map(([value, label]) => ({ value, label }));
const RHYTHMEN = Object.entries(RHYTHMUS_LABELS).map(([value, label]) => ({ value, label }));

export function KostenPanel({ kosten, monat }: { kosten: KostenDaten; monat: string }) {
  const [neu, setNeu] = useState(false);
  const [edit, setEdit] = useState<KostenPosition | null>(null);
  const { zeilen, summe } = kostenImMonat(kosten, monat);
  const uebrige = kosten.positionen.filter((p) => !zeilen.some((z) => z.position.id === p.id));
  const plan = zeilen.reduce((s, z) => s + z.plan, 0);
  const fix = zeilen.filter((z) => z.position.rhythmus !== "einmalig").reduce((s, z) => s + z.betrag, 0);

  return (
    <div className="ks-stapel">
      <div className="kpi-row" data-cols="3">
        <StatTile label="Geht raus" value={formatEur(summe)} sub="Ist, wo eingetragen, sonst Plan" />
        <StatTile label="Geplant" value={formatEur(plan)} />
        <StatTile label="Davon laufend" value={formatEur(fix)} />
      </div>

      <Card>
        <div className="ks-kopf-umbruch">
        <CardHeader
          title={`Kosten ${monatLabel(monat)}`}
          meta="Netto"
          action={
            <Button variant="primary" icon={<Plus size={15} aria-hidden />} onClick={() => setNeu(true)}>
              Kosten eintragen
            </Button>
          }
        />
        </div>
        {zeilen.length === 0 ? (
          <p className="ks-leise">In diesem Monat sind keine Kosten eingetragen, z. B. Ads-Budget, Gehälter, Tools.</p>
        ) : (
          <ul className="ks-liste-schlicht">
            {zeilen.map((z) => (
              <li key={z.position.id}>
                <button type="button" className="ks-kosten" onClick={() => setEdit(z.position)}>
                  <span>
                    <span className="ks-name">{z.position.name}</span>
                    <span className="ks-unter">
                      {KOSTEN_KATEGORIE_LABELS[z.position.kategorie]} · {RHYTHMUS_LABELS[z.position.rhythmus]}
                      {z.position.ende_monat ? ` · bis ${monatLabel(z.position.ende_monat)}` : ""}
                    </span>
                  </span>
                  <span className="ks-kosten-betrag">
                    {formatEurGenau(z.betrag)}
                    {z.ausgesetzt ? (
                      <Badge tone="neutral">ausgesetzt</Badge>
                    ) : z.ist !== null ? (
                      <span className="ks-unter">Ist, Plan {formatEurGenau(z.plan)}</span>
                    ) : (
                      <span className="ks-unter">Plan</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {uebrige.length > 0 && (
        <Card>
          <CardHeader title="Fallen in diesem Monat nicht an" />
          <ul className="ks-liste-schlicht">
            {uebrige.map((p) => (
              <li key={p.id}>
                <button type="button" className="ks-kosten" onClick={() => setEdit(p)}>
                  <span className="ks-name">{p.name}</span>
                  <span className="ks-unter">
                    {RHYTHMUS_LABELS[p.rhythmus]} ab {monatLabel(p.start_monat)}
                    {p.ende_monat ? ` bis ${monatLabel(p.ende_monat)}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {neu && <NeuDialog monat={monat} onClose={() => setNeu(false)} />}
      {edit && <AendernDialog position={edit} kosten={kosten} monat={monat} onClose={() => setEdit(null)} />}
    </div>
  );
}

function monatsOptionen(um: string) {
  return Array.from({ length: 37 }, (_, i) => monatPlus(um, i - 12)).map((m) => ({ value: m, label: monatLabel(m) }));
}

function NeuDialog({ monat, onClose }: { monat: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [kategorie, setKategorie] = useState<KostenKategorie>("marketing");
  const [rhythmus, setRhythmus] = useState<KostenRhythmus>("monatlich");
  const [start, setStart] = useState(monat);
  const [betrag, setBetrag] = useState("");
  const { error, pending, run } = useAktion();
  return (
    <Modal open onClose={onClose} title="Kosten eintragen">
      <div className="ks-stapel">
        <Feld label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Meta-Budget" autoFocus />
        </Feld>
        <div className="ks-felder">
          <BetragFeld label="Betrag je Fälligkeit" wert={betrag} onChange={setBetrag} />
          <Feld label="Kategorie">
            <Select value={kategorie} onChange={(v) => setKategorie(v as KostenKategorie)} options={KATEGORIEN} />
          </Feld>
          <Feld label="Wie oft">
            <Select value={rhythmus} onChange={(v) => setRhythmus(v as KostenRhythmus)} options={RHYTHMEN} />
          </Feld>
          <Feld label={rhythmus === "einmalig" ? "Monat" : "Ab Monat"}>
            <Select value={start} onChange={setStart} options={monatsOptionen(monat)} />
          </Feld>
        </div>
        <Fehler text={error} />
        <DialogFuss
          label="Eintragen"
          pending={pending}
          disabled={!name.trim() || !betrag}
          onClose={onClose}
          onSubmit={() => run(() => kostenAnlegen({ name, kategorie, rhythmus, start, betrag }), onClose)}
        />
      </div>
    </Modal>
  );
}

type Wie = "monat" | "ab" | "ende" | "angaben";

function AendernDialog({
  position: p,
  kosten,
  monat,
  onClose,
}: {
  position: KostenPosition;
  kosten: KostenDaten;
  monat: string;
  onClose: () => void;
}) {
  const zeile = kostenImMonat(kosten, monat).zeilen.find((z) => z.position.id === p.id);
  const [wie, setWie] = useState<Wie>(zeile ? "monat" : "angaben");
  const [ist, setIst] = useState(zeile?.ist === 0 ? "0" : alsEingabe(zeile?.ist));
  const [aus, setAus] = useState(zeile?.ausgesetzt ?? false);
  const [ab, setAb] = useState(monat < p.start_monat ? p.start_monat : monat);
  const [betrag, setBetrag] = useState(alsEingabe(zeile?.plan));
  const [ende, setEnde] = useState(p.ende_monat ?? "");
  const [name, setName] = useState(p.name);
  const [kategorie, setKategorie] = useState<KostenKategorie>(p.kategorie);
  const { error, pending, run } = useAktion();
  const { confirm, dialog } = useConfirm();

  const optionen: { value: Wie; label: string }[] = [
    ...(zeile ? ([{ value: "monat", label: "Dieser Monat" }] as const) : []),
    { value: "ab", label: "Ab Monat" },
    ...(p.rhythmus !== "einmalig" ? ([{ value: "ende", label: "Beenden" }] as const) : []),
    { value: "angaben", label: "Angaben" },
  ];

  const speichern = () =>
    run(
      () =>
        wie === "monat"
          ? kostenMonat(p.id, monat, { ist: aus ? "" : ist, ausgesetzt: aus })
          : wie === "ab"
            ? kostenBetragAb(p.id, ab, betrag)
            : wie === "ende"
              ? kostenBeenden(p.id, ende || null)
              : kostenBearbeiten(p.id, { name, kategorie }),
      onClose,
    );

  return (
    <Modal open onClose={onClose} title={p.name} subtitle={monatLabel(monat)} width={540}>
      {dialog}
      <div className="ks-stapel">
        <Segmented options={optionen} value={wie} onChange={setWie} ariaLabel="Was ändern" fullWidth />

        {wie === "monat" && (
          <>
            <label className="ks-wahl">
              <input type="checkbox" checked={aus} onChange={(e) => setAus(e.target.checked)} />
              <span>In {monatLabel(monat)} aussetzen</span>
            </label>
            {!aus && (
              <BetragFeld
                label="Tatsächlich ausgegeben"
                wert={ist}
                onChange={setIst}
                hint={`Ersetzt den Plan von ${formatEurGenau(zeile?.plan ?? 0)}. Leer heißt: Plan gilt.`}
              />
            )}
          </>
        )}
        {wie === "ab" && (
          <div className="ks-felder">
            <Feld label="Gilt ab" hint="Frühere Monate behalten ihren Betrag.">
              <Select value={ab} onChange={setAb} options={monatsOptionen(monat).filter((o) => o.value >= p.start_monat)} />
            </Feld>
            <BetragFeld label="Neuer Betrag" wert={betrag} onChange={setBetrag} />
          </div>
        )}
        {wie === "ende" && (
          <Feld label="Letzter Monat">
            <Select
              value={ende}
              onChange={setEnde}
              options={[{ value: "", label: "Läuft weiter" }, ...monatsOptionen(monat).filter((o) => o.value >= p.start_monat)]}
            />
          </Feld>
        )}
        {wie === "angaben" && (
          <>
            <div className="ks-felder">
              <Feld label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Feld>
              <Feld label="Kategorie">
                <Select value={kategorie} onChange={(v) => setKategorie(v as KostenKategorie)} options={KATEGORIEN} />
              </Feld>
            </div>
            <div className="ks-reihe">
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  const ja = await confirm({
                    title: `„${p.name}“ löschen?`,
                    message: "Die Position verschwindet auch aus allen vergangenen Monaten. Zum Aufhören ist „Beenden“ richtig.",
                    confirmLabel: "Löschen",
                    destructive: true,
                  });
                  if (ja) run(() => kostenLoeschen(p.id), onClose);
                }}
              >
                Position löschen
              </Button>
            </div>
          </>
        )}

        <Fehler text={error} />
        <DialogFuss label="Speichern" pending={pending} disabled={wie === "ab" && !betrag} onClose={onClose} onSubmit={speichern} />
      </div>
    </Modal>
  );
}
