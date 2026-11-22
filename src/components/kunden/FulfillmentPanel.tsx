"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDown, ArrowUp, ListPlus, Pencil, Trash2 } from "lucide-react";
import {
  addBausteine,
  checklisteAusVorlage,
  createCheckliste,
  deleteBaustein,
  deleteCheckliste,
  renameCheckliste,
  setBausteinErledigt,
  setReihenfolge,
  updateBaustein,
} from "@/app/actions/kunden";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Feld } from "@/components/kunden/Feld";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { DialogFuss, Fehler, Haken, ZeilenEingabe, useAktion } from "@/components/kunden/bausteine";
import { datumDe } from "@/lib/umsatz";
import {
  bausteinFortschritt,
  nachPhase,
  verschobeneReihenfolge,
  type KundenBaustein,
  type KundenCheckliste,
  type Vorlage,
} from "@/lib/kunden";

// Fulfillment je Kunde: beliebig viele Checklisten (F1), jede eine KOPIE ihrer
// Vorlage (F2). Nachziehen hängt nur an (F3). Ein Punkt ist eine Checkbox (F5).

type Dialog = null | { art: "vorlage"; liste?: KundenCheckliste } | { art: "leer" };

export function FulfillmentPanel({
  kundeId,
  checklisten,
  bausteine,
  vorlagen,
  namen,
}: {
  kundeId: string;
  checklisten: KundenCheckliste[];
  bausteine: KundenBaustein[];
  vorlagen: Vorlage[];
  namen: Record<string, string>;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);

  return (
    <div className="ks-stapel">
      <div className="ks-reihe">
        <Button variant="primary" icon={<ListPlus size={15} aria-hidden />} onClick={() => setDialog({ art: "vorlage" })}>
          Vorlage zuweisen
        </Button>
        <Button variant="secondary" onClick={() => setDialog({ art: "leer" })}>
          Leere Checkliste
        </Button>
      </div>

      {checklisten.length === 0 && (
        <Card>
          <p className="ks-leise">
            Noch keine Checkliste. Weise eine Vorlage zu oder leg eine eigene Liste für diesen Kunden an.
          </p>
        </Card>
      )}

      {checklisten.map((liste) => {
        const vorlage = vorlagen.find((v) => v.id === liste.vorlage_id);
        const eigene = bausteine.filter((b) => b.checkliste_id === liste.id);
        const fehlen = vorlage?.punkte.filter((p) => !eigene.some((b) => b.vorlage_punkt_id === p.id)).length ?? 0;
        return (
          <Checkliste
            key={liste.id}
            kundeId={kundeId}
            liste={liste}
            bausteine={eigene}
            namen={namen}
            fehlen={fehlen}
            onNachziehen={() => setDialog({ art: "vorlage", liste })}
          />
        );
      })}

      {dialog?.art === "vorlage" && (
        <VorlageDialog
          kundeId={kundeId}
          vorlagen={vorlagen}
          ziel={dialog.liste}
          checklisten={checklisten}
          bausteine={bausteine}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.art === "leer" && <NameDialog kundeId={kundeId} onClose={() => setDialog(null)} />}
    </div>
  );
}

function Checkliste({
  kundeId,
  liste,
  bausteine,
  namen,
  fehlen,
  onNachziehen,
}: {
  kundeId: string;
  liste: KundenCheckliste;
  bausteine: KundenBaustein[];
  namen: Record<string, string>;
  fehlen: number;
  onNachziehen: () => void;
}) {
  const [bearbeiten, setBearbeiten] = useState(false);
  const [punkt, setPunkt] = useState<KundenBaustein | null>(null);
  const [titel, setTitel] = useState(liste.titel);
  const { error, pending, run } = useAktion();
  const { confirm, dialog } = useConfirm();
  const f = bausteinFortschritt(bausteine);
  const gruppen = nachPhase(bausteine);

  const verschiebe = (id: string, richtung: -1 | 1) => {
    const ids = verschobeneReihenfolge(bausteine, id, richtung);
    if (ids) run(() => setReihenfolge("baustein", ids, kundeId));
  };

  return (
    <Card>
      {dialog}
      <CardHeader
        title={liste.titel}
        meta={`${f.erledigt} von ${f.gesamt} erledigt`}
        action={
          <Button size="sm" variant="ghost" onClick={() => setBearbeiten((b) => !b)} aria-pressed={bearbeiten}>
            {bearbeiten ? "Fertig" : "Bearbeiten"}
          </Button>
        }
      />
      <div className="ks-stapel">
        <div className="progress-track" role="img" aria-label={`${f.erledigt} von ${f.gesamt} erledigt`}>
          <div className="progress-fill ks-fortschritt" style={{ width: f.gesamt ? `${(f.erledigt / f.gesamt) * 100}%` : 0 }} />
        </div>

        {bearbeiten && (
          <div className="ks-reihe">
            <Input value={titel} onChange={(e) => setTitel(e.target.value)} aria-label="Name der Checkliste" className="ks-dehnbar" />
            {titel !== liste.titel && (
              <Button variant="secondary" loading={pending} onClick={() => run(() => renameCheckliste(liste.id, titel))}>
                Umbenennen
              </Button>
            )}
            <Button
              variant="danger"
              onClick={async () => {
                const ja = await confirm({
                  title: `„${liste.titel}“ entfernen?`,
                  message: "Alle Haken und Notizen dieser Liste gehen verloren.",
                  confirmLabel: "Entfernen",
                  destructive: true,
                });
                if (ja) run(() => deleteCheckliste(liste.id));
              }}
            >
              Liste entfernen
            </Button>
          </div>
        )}

        {gruppen.map((g) => (
          <div key={g.phase ?? "_"}>
            {g.phase && <h3 className="ks-zwischen">{g.phase}</h3>}
            <ul className="ks-liste-schlicht">
              {g.rows.map((b, i) => (
                <li key={b.id} className="ks-punkt">
                  <Haken an={!!b.erledigt_am} label={b.titel} onSetzen={(an) => setBausteinErledigt(b.id, an)}>
                    {b.titel}
                    {b.beschreibung && <span className="ks-herkunft">{b.beschreibung}</span>}
                    {b.notiz && <span className="ks-herkunft">Notiz: {b.notiz}</span>}
                    {b.erledigt_am && (
                      <span className="ks-herkunft">
                        erledigt {datumDe(b.erledigt_am)}
                        {b.erledigt_von_user_id && namen[b.erledigt_von_user_id] ? ` · ${namen[b.erledigt_von_user_id]}` : ""}
                      </span>
                    )}
                  </Haken>
                  {bearbeiten && (
                    <div className="ks-werkzeug">
                      <IconButton label="Nach oben" icon={<ArrowUp size={14} aria-hidden />} disabled={i === 0 || pending} onClick={() => verschiebe(b.id, -1)} />
                      <IconButton label="Nach unten" icon={<ArrowDown size={14} aria-hidden />} disabled={i === g.rows.length - 1 || pending} onClick={() => verschiebe(b.id, 1)} />
                      <IconButton label="Bearbeiten" icon={<Pencil size={14} aria-hidden />} onClick={() => setPunkt(b)} />
                      <IconButton label="Löschen" tone="danger" icon={<Trash2 size={14} aria-hidden />} onClick={() => run(() => deleteBaustein(b.id))} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}

        <ZeilenEingabe
          label={`Punkt für ${liste.titel}`}
          placeholder="Neuer Punkt, Enter"
          onAdd={(t) => addBausteine(kundeId, liste.id, t, gruppen[gruppen.length - 1]?.phase)}
        />
        {fehlen > 0 && (
          <div className="ks-reihe">
            <Button size="sm" variant="ghost" onClick={onNachziehen}>
              {fehlen === 1 ? "1 Punkt der Vorlage fehlt hier" : `${fehlen} Punkte der Vorlage fehlen hier`}: ergänzen
            </Button>
          </div>
        )}
        <Fehler text={error} />
      </div>
      {punkt && <PunktDialog punkt={punkt} onClose={() => setPunkt(null)} />}
    </Card>
  );
}

function PunktDialog({ punkt, onClose }: { punkt: KundenBaustein; onClose: () => void }) {
  const [f, setF] = useState({
    titel: punkt.titel,
    phase: punkt.phase ?? "",
    beschreibung: punkt.beschreibung ?? "",
    notiz: punkt.notiz ?? "",
  });
  const { error, pending, run } = useAktion();
  return (
    <Modal open onClose={onClose} title="Punkt bearbeiten" subtitle="Gilt nur für diesen Kunden.">
      <div className="ks-stapel">
        <Feld label="Titel">
          <Input value={f.titel} onChange={(e) => setF({ ...f, titel: e.target.value })} autoFocus />
        </Feld>
        <Feld label="Phase">
          <Input value={f.phase} onChange={(e) => setF({ ...f, phase: e.target.value })} />
        </Feld>
        <Feld label="Beschreibung">
          <Textarea value={f.beschreibung} onChange={(e) => setF({ ...f, beschreibung: e.target.value })} rows={2} />
        </Feld>
        <Feld label="Notiz zu diesem Kunden">
          <Textarea value={f.notiz} onChange={(e) => setF({ ...f, notiz: e.target.value })} rows={2} />
        </Feld>
        <Fehler text={error} />
        <DialogFuss label="Speichern" pending={pending} onClose={onClose} onSubmit={() => run(() => updateBaustein(punkt.id, f), onClose)} />
      </div>
    </Modal>
  );
}

function NameDialog({ kundeId, onClose }: { kundeId: string; onClose: () => void }) {
  const [titel, setTitel] = useState("");
  const { error, pending, run } = useAktion();
  return (
    <Modal open onClose={onClose} title="Leere Checkliste">
      <div className="ks-stapel">
        <Feld label="Name">
          <Input value={titel} onChange={(e) => setTitel(e.target.value)} autoFocus />
        </Feld>
        <Fehler text={error} />
        <DialogFuss label="Anlegen" pending={pending} disabled={!titel.trim()} onClose={onClose} onSubmit={() => run(() => createCheckliste(kundeId, titel), onClose)} />
      </div>
    </Modal>
  );
}

/** Vorschau mit Abwahl (F4). Mit `ziel` wird nur angeboten, was dort fehlt. */
function VorlageDialog({
  kundeId,
  vorlagen,
  ziel,
  checklisten,
  bausteine,
  onClose,
}: {
  kundeId: string;
  vorlagen: Vorlage[];
  ziel?: KundenCheckliste;
  checklisten: KundenCheckliste[];
  bausteine: KundenBaustein[];
  onClose: () => void;
}) {
  const waehlbar = ziel
    ? vorlagen.filter((v) => v.id === ziel.vorlage_id)
    : vorlagen.filter((v) => !v.archiviert_at && v.punkte.length > 0);
  const [id, setId] = useState(waehlbar.length === 1 ? waehlbar[0].id : "");
  const [aus, setAus] = useState(() => new Set<string>());
  const { error, pending, run } = useAktion();

  const vorlage = waehlbar.find((v) => v.id === id);
  const punkte = (vorlage?.punkte ?? []).filter(
    (p) => !ziel || !bausteine.some((b) => b.checkliste_id === ziel.id && b.vorlage_punkt_id === p.id),
  );
  const schonDa = !ziel && !!id && checklisten.some((c) => c.vorlage_id === id);
  const gewaehlt = punkte.filter((p) => !aus.has(p.id));

  return (
    <Modal open onClose={onClose} title={ziel ? "Aus der Vorlage ergänzen" : "Vorlage zuweisen"} subtitle={ziel?.titel} width={560}>
      <div className="ks-stapel">
        {waehlbar.length === 0 ? (
          <p className="ks-leise">
            Es gibt noch keine Vorlage mit Punkten.{" "}
            <Link href="/kunden/vorlagen" className="ks-link">
              Vorlagen anlegen
            </Link>
          </p>
        ) : (
          <>
            {!ziel && (
              <Feld label="Vorlage">
                <Select
                  value={id}
                  placeholder="Auswählen"
                  onChange={(v) => {
                    setId(v);
                    setAus(new Set());
                  }}
                  options={waehlbar.map((v) => ({ value: v.id, label: v.name, hint: `${v.punkte.length} Punkte` }))}
                />
              </Feld>
            )}
            {schonDa && <p className="ks-warnung">Diese Vorlage hat der Kunde schon. Es entstünde eine zweite Liste.</p>}
            {vorlage && (
              <div className="ks-auswahl" data-hoch="true">
                {nachPhase(punkte).map((g) => (
                  <div key={g.phase ?? "_"}>
                    {g.phase && <h3 className="ks-zwischen">{g.phase}</h3>}
                    {g.rows.map((p) => (
                      <label key={p.id} className="ks-wahl">
                        <input
                          type="checkbox"
                          checked={!aus.has(p.id)}
                          onChange={() =>
                            setAus((alt) => {
                              const neu = new Set(alt);
                              if (!neu.delete(p.id)) neu.add(p.id);
                              return neu;
                            })
                          }
                        />
                        <span>{p.titel}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <Fehler text={error} />
        <DialogFuss
          label={ziel ? `${gewaehlt.length} ergänzen` : `Mit ${gewaehlt.length} Punkten zuweisen`}
          pending={pending}
          disabled={!gewaehlt.length}
          onClose={onClose}
          onSubmit={() => run(() => checklisteAusVorlage(kundeId, id, gewaehlt.map((p) => p.id), ziel?.id), onClose)}
        />
      </div>
    </Modal>
  );
}
