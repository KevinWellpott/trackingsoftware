"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import {
  addVorlagePunkte,
  createVorlage,
  deleteVorlage,
  deleteVorlagePunkt,
  duplicateVorlage,
  setReihenfolge,
  updateVorlage,
  updateVorlagePunkt,
} from "@/app/actions/kunden";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Feld } from "@/components/kunden/Feld";
import { Textarea } from "@/components/ui/Textarea";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { DialogFuss, Fehler, ZeilenEingabe, useAktion } from "@/components/kunden/bausteine";
import { nachPhase, verschobeneReihenfolge, zeilenZuPunkten, type Vorlage, type VorlagePunkt } from "@/lib/kunden";

// Vorlagen starten leer (Entscheidung 22.11.). Der schnelle Weg hinein: eine
// ganze Liste einfügen, eine Zeile ist eine Checkbox, „# Titel" eine Phase.

export function VorlageAnlegenButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [liste, setListe] = useState("");
  const { error, pending, run } = useAktion();
  const router = useRouter();
  const punkte = zeilenZuPunkten(liste);

  const submit = () =>
    run(async () => {
      const r = await createVorlage(name, liste);
      if (r.error || !r.id) return { error: r.error ?? "Anlegen fehlgeschlagen." };
      setOpen(false);
      setName("");
      setListe("");
      router.push(`/kunden/vorlagen?id=${r.id}`);
      return {};
    });

  return (
    <>
      <Button variant="primary" icon={<Plus size={15} aria-hidden />} onClick={() => setOpen(true)}>
        Vorlage anlegen
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Vorlage anlegen" width={560} closeOnBackdrop={false}>
        <div className="ks-stapel">
          <Feld label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Feld>
          <Feld label="Punkte" hint="Eine Zeile ist eine Checkbox. Eine Zeile mit # davor beginnt eine Phase.">
            <Textarea value={liste} onChange={(e) => setListe(e.target.value)} rows={10} placeholder={"# Woche 1\nErster Punkt\nZweiter Punkt"} />
          </Feld>
          {punkte.length > 0 && <p className="ks-leise">{punkte.length} Checkboxen erkannt.</p>}
          <Fehler text={error} />
          <DialogFuss label="Anlegen" pending={pending} disabled={!name.trim()} onClose={() => setOpen(false)} onSubmit={submit} />
        </div>
      </Modal>
    </>
  );
}

export function VorlagenEditor({ vorlage }: { vorlage: Vorlage }) {
  const [name, setName] = useState(vorlage.name);
  const [punkt, setPunkt] = useState<VorlagePunkt | null>(null);
  const { error, pending, run } = useAktion();
  const { confirm, dialog } = useConfirm();
  const router = useRouter();
  const gruppen = nachPhase(vorlage.punkte);

  const verschiebe = (id: string, richtung: -1 | 1) => {
    const ids = verschobeneReihenfolge(vorlage.punkte, id, richtung);
    if (ids) run(() => setReihenfolge("vorlage", ids));
  };

  return (
    <Card>
      {dialog}
      <CardHeader
        title={vorlage.name}
        meta={`${vorlage.punkte.length} Punkte${vorlage.archiviert_at ? " · archiviert" : ""} · Änderungen gelten für neue Zuweisungen, laufende Kunden bleiben unverändert.`}
      />
      <div className="ks-stapel">
        <div className="ks-reihe">
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name der Vorlage" className="ks-dehnbar" />
          {name !== vorlage.name && (
            <Button variant="secondary" loading={pending} onClick={() => run(() => updateVorlage(vorlage.id, { name }))}>
              Umbenennen
            </Button>
          )}
          <Button
            variant="ghost"
            icon={<Copy size={14} aria-hidden />}
            onClick={() =>
              run(async () => {
                const r = await duplicateVorlage(vorlage.id);
                if (r.id) router.push(`/kunden/vorlagen?id=${r.id}`);
                return r;
              })
            }
          >
            Duplizieren
          </Button>
          <Button
            variant="ghost"
            icon={vorlage.archiviert_at ? <ArchiveRestore size={14} aria-hidden /> : <Archive size={14} aria-hidden />}
            onClick={() => run(() => updateVorlage(vorlage.id, { archiviert: !vorlage.archiviert_at }))}
          >
            {vorlage.archiviert_at ? "Zurückholen" : "Archivieren"}
          </Button>
          <Button
            variant="ghost"
            icon={<Trash2 size={14} aria-hidden />}
            onClick={async () => {
              const ja = await confirm({
                title: `„${vorlage.name}“ löschen?`,
                message: "Checklisten, die Kunden schon haben, bleiben erhalten.",
                confirmLabel: "Löschen",
                destructive: true,
              });
              if (ja) run(() => deleteVorlage(vorlage.id), () => router.push("/kunden/vorlagen"));
            }}
          >
            Löschen
          </Button>
        </div>

        {gruppen.map((g) => (
          <div key={g.phase ?? "_"}>
            {g.phase && <h3 className="ks-zwischen">{g.phase}</h3>}
            <ul className="ks-liste-schlicht">
              {g.rows.map((p, i) => (
                <li key={p.id} className="ks-punkt">
                  <span className="ks-punkt-text">
                    {p.titel}
                    {p.beschreibung && <span className="ks-herkunft">{p.beschreibung}</span>}
                  </span>
                  <div className="ks-werkzeug">
                    <IconButton label="Nach oben" icon={<ArrowUp size={14} aria-hidden />} disabled={i === 0 || pending} onClick={() => verschiebe(p.id, -1)} />
                    <IconButton label="Nach unten" icon={<ArrowDown size={14} aria-hidden />} disabled={i === g.rows.length - 1 || pending} onClick={() => verschiebe(p.id, 1)} />
                    <IconButton label="Bearbeiten" icon={<Pencil size={14} aria-hidden />} onClick={() => setPunkt(p)} />
                    <IconButton label="Löschen" tone="danger" icon={<Trash2 size={14} aria-hidden />} onClick={() => run(() => deleteVorlagePunkt(p.id))} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <ZeilenEingabe
          label="Neue Punkte"
          placeholder="Punkt oder ganze Liste einfügen, Enter"
          onAdd={(t) => addVorlagePunkte(vorlage.id, t, gruppen[gruppen.length - 1]?.phase)}
        />
        <p className="ks-leise">Mehrere Zeilen werden mehrere Checkboxen. Eine Zeile mit # davor beginnt eine Phase.</p>
        <Fehler text={error} />
      </div>
      {punkt && <PunktDialog punkt={punkt} onClose={() => setPunkt(null)} />}
    </Card>
  );
}

function PunktDialog({ punkt, onClose }: { punkt: VorlagePunkt; onClose: () => void }) {
  const [f, setF] = useState({ titel: punkt.titel, phase: punkt.phase ?? "", beschreibung: punkt.beschreibung ?? "" });
  const { error, pending, run } = useAktion();
  return (
    <Modal open onClose={onClose} title="Punkt bearbeiten">
      <div className="ks-stapel">
        <Feld label="Titel">
          <Input value={f.titel} onChange={(e) => setF({ ...f, titel: e.target.value })} autoFocus />
        </Feld>
        <Feld label="Phase">
          <Input value={f.phase} onChange={(e) => setF({ ...f, phase: e.target.value })} />
        </Feld>
        <Feld label="Beschreibung">
          <Textarea value={f.beschreibung} onChange={(e) => setF({ ...f, beschreibung: e.target.value })} rows={3} />
        </Feld>
        <Fehler text={error} />
        <DialogFuss label="Speichern" pending={pending} onClose={onClose} onSubmit={() => run(() => updateVorlagePunkt(punkt.id, f), onClose)} />
      </div>
    </Modal>
  );
}
