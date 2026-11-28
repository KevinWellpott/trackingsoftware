"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, ChevronsDownUp, ChevronsUpDown, Copy, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Feld } from "@/components/kunden/Feld";
import { Textarea } from "@/components/ui/Textarea";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { InfoPopover } from "@/components/ui/InfoPopover";
import { Abschnitt, DialogFuss, Fehler, ZeilenEingabe, useAktion } from "@/components/kunden/bausteine";
import { VorlagenDateien } from "@/components/kunden/VorlagenDateien";
import { nachPhase, verschobeneReihenfolge, zeilenZuPunkten, type Vorlage, type VorlageDatei, type VorlagePunkt } from "@/lib/kunden";

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

/** Schlüssel des Datei-Abschnitts neben den Phasen ("_" = ohne Phase). */
const DATEIEN = "__dateien";

export function VorlagenEditor({
  vorlage,
  dateien,
  dateienVerfuegbar,
}: {
  vorlage: Vorlage;
  dateien: VorlageDatei[];
  dateienVerfuegbar: boolean;
}) {
  const [name, setName] = useState(vorlage.name);
  const [punkt, setPunkt] = useState<VorlagePunkt | null>(null);
  const [neuePhase, setNeuePhase] = useState("");
  // Zugeklappt statt aufgeklappt merken: Eine neu entstandene Phase ist offen.
  const [zu, setZu] = useState<Set<string>>(() => new Set());
  const { error, pending, run } = useAktion();
  const { confirm, dialog } = useConfirm();
  const router = useRouter();
  const gruppen = nachPhase(vorlage.punkte);
  const phasen = gruppen.filter((g) => g.phase).length;
  const schluessel = [...gruppen.map((g) => g.phase ?? "_"), DATEIEN];
  const allesZu = schluessel.every((k) => zu.has(k));
  const umschalten = (k: string) =>
    setZu((alt) => {
      const neu = new Set(alt);
      if (neu.has(k)) neu.delete(k);
      else neu.add(k);
      return neu;
    });
  const umbenennen = () => {
    if (name.trim() && name !== vorlage.name) run(() => updateVorlage(vorlage.id, { name }));
  };

  const verschiebe = (id: string, richtung: -1 | 1) => {
    const ids = verschobeneReihenfolge(vorlage.punkte, id, richtung);
    if (ids) run(() => setReihenfolge("vorlage", ids));
  };

  return (
    <div className="vl-editor">
      {dialog}
      <section className="card vl-kopf">
        <div className="vl-kopf-zeile">
          <span className="vl-kopf-icon" aria-hidden>
            <ListChecks size={18} />
          </span>
          <input
            className="vl-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && umbenennen()}
            aria-label="Name der Vorlage"
          />
          {name !== vorlage.name && name.trim() && (
            <Button size="sm" variant="primary" loading={pending} onClick={umbenennen}>
              Umbenennen
            </Button>
          )}
          {vorlage.archiviert_at && <span className="vl-archiv">Archiviert</span>}
          <div className="vl-aktionen">
            <Button
              size="sm"
              variant="secondary"
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
              size="sm"
              variant="secondary"
              icon={vorlage.archiviert_at ? <ArchiveRestore size={14} aria-hidden /> : <Archive size={14} aria-hidden />}
              onClick={() => run(() => updateVorlage(vorlage.id, { archiviert: !vorlage.archiviert_at }))}
            >
              {vorlage.archiviert_at ? "Zurückholen" : "Archivieren"}
            </Button>
            <IconButton
              label="Vorlage löschen"
              tone="danger"
              size={32}
              icon={<Trash2 size={15} aria-hidden />}
              onClick={async () => {
                const ja = await confirm({
                  title: `„${vorlage.name}“ löschen?`,
                  message: "Checklisten, die Kunden schon haben, bleiben erhalten. Die Dateien der Vorlage werden mit gelöscht.",
                  confirmLabel: "Löschen",
                  destructive: true,
                });
                if (ja) run(() => deleteVorlage(vorlage.id), () => router.push("/kunden/vorlagen"));
              }}
            />
          </div>
        </div>
        <div className="vl-kopf-meta">
          <span>
            <b>{vorlage.punkte.length}</b> {vorlage.punkte.length === 1 ? "Punkt" : "Punkte"}
          </span>
          <span>
            <b>{phasen}</b> {phasen === 1 ? "Phase" : "Phasen"}
          </span>
          <span>
            <b>{dateien.length}</b> {dateien.length === 1 ? "Datei" : "Dateien"}
          </span>
          <InfoPopover label="So wirken Änderungen" width={300}>
            Beim Zuweisen bekommt der Kunde eine eigene Kopie. Änderungen hier gelten für neue Zuweisungen, laufende Kunden
            bleiben unverändert.
          </InfoPopover>
        </div>
        <Fehler text={error} />
      </section>

      <div className="vl-leiste">
        <h2 className="vl-leiste-titel">Checkliste</h2>
        <Button
          size="sm"
          variant="ghost"
          icon={allesZu ? <ChevronsUpDown size={14} aria-hidden /> : <ChevronsDownUp size={14} aria-hidden />}
          onClick={() => setZu(allesZu ? new Set() : new Set(schluessel))}
        >
          {allesZu ? "Alle aufklappen" : "Alle zuklappen"}
        </Button>
      </div>

      {gruppen.length === 0 && (
        <section className="card vl-leer">
          <p>Noch keine Punkte. Unten eine Phase anlegen oder eine ganze Liste einfügen.</p>
        </section>
      )}

      {gruppen.map((g) => {
        const k = g.phase ?? "_";
        const titel = g.phase ?? "Ohne Phase";
        return (
          <Abschnitt key={k} offen={!zu.has(k)} onUmschalten={() => umschalten(k)} titel={titel} zahl={g.rows.length}>
            <ul className="vl-punkte">
              {g.rows.map((p, i) => (
                <li key={p.id} className="vl-punkt">
                  <span className="vl-box" aria-hidden />
                  <span className="vl-punkt-text">
                    <span className="vl-punkt-titel">{p.titel}</span>
                    {p.beschreibung && <span className="vl-punkt-beschr">{p.beschreibung}</span>}
                  </span>
                  <div className="vl-werkzeug">
                    <IconButton label="Nach oben" size={30} icon={<ArrowUp size={14} aria-hidden />} disabled={i === 0 || pending} onClick={() => verschiebe(p.id, -1)} />
                    <IconButton
                      label="Nach unten"
                      size={30}
                      icon={<ArrowDown size={14} aria-hidden />}
                      disabled={i === g.rows.length - 1 || pending}
                      onClick={() => verschiebe(p.id, 1)}
                    />
                    <IconButton label="Bearbeiten" size={30} icon={<Pencil size={14} aria-hidden />} onClick={() => setPunkt(p)} />
                    <IconButton label="Löschen" size={30} tone="danger" icon={<Trash2 size={14} aria-hidden />} onClick={() => run(() => deleteVorlagePunkt(p.id))} />
                  </div>
                </li>
              ))}
            </ul>
            <ZeilenEingabe
              label={`Punkt zu „${titel}“ hinzufügen`}
              placeholder="Punkt hinzufügen, Enter"
              onAdd={(t) => addVorlagePunkte(vorlage.id, t, g.phase)}
            />
          </Abschnitt>
        );
      })}

      <section className="card vl-neu">
        <div className="vl-neu-kopf">
          <Plus size={15} aria-hidden />
          <h3>Neue Phase</h3>
          <InfoPopover label="Neue Phase anlegen" width={300}>
            Name eintragen und die Punkte darunter einfügen, eine Zeile je Checkbox. Ohne Namen landen die Punkte unter
            „Ohne Phase“. Eine Zeile mit # davor beginnt mitten in der Liste eine weitere Phase.
          </InfoPopover>
        </div>
        <Input value={neuePhase} onChange={(e) => setNeuePhase(e.target.value)} placeholder="Name der Phase, z. B. Woche 1" aria-label="Name der neuen Phase" />
        <ZeilenEingabe
          label="Punkte der neuen Phase"
          placeholder="Punkte einfügen, eine Zeile je Checkbox"
          onAdd={async (t) => {
            const r = await addVorlagePunkte(vorlage.id, t, neuePhase.trim() || null);
            if (!r.error) setNeuePhase("");
            return r;
          }}
        />
      </section>

      <VorlagenDateien
        vorlageId={vorlage.id}
        dateien={dateien}
        verfuegbar={dateienVerfuegbar}
        offen={!zu.has(DATEIEN)}
        onUmschalten={() => umschalten(DATEIEN)}
      />

      {punkt && <PunktDialog punkt={punkt} onClose={() => setPunkt(null)} />}
    </div>
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
