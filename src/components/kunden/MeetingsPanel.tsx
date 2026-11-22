"use client";

import { useState } from "react";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { deleteProtokoll, saveProtokoll } from "@/app/actions/kunden";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Feld } from "@/components/kunden/Feld";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { DateTimeField } from "@/components/ui/DateTimeField";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { DialogFuss, Fehler, useAktion } from "@/components/kunden/bausteine";
import { berlinInputToIso, formatTermin, isoToBerlinInput } from "@/lib/apptTime";
import { sichereUrl, type AgendaPunkt, type KundenAufgabe, type KundenMeeting, type TeamMitglied } from "@/lib/kunden";

// Protokolle. Ein neues entsteht beim Abschließen des geplanten Meetings;
// hier wird nachgetragen und korrigiert, ohne die Planung anzufassen (M5).

export function MeetingsPanel({
  kundeId,
  protokolle,
  punkte,
  aufgaben,
  team,
  currentUserId,
}: {
  kundeId: string;
  protokolle: KundenMeeting[];
  punkte: AgendaPunkt[];
  aufgaben: KundenAufgabe[];
  team: TeamMitglied[];
  currentUserId: string;
}) {
  const [edit, setEdit] = useState<KundenMeeting | "neu" | null>(null);
  const { error, run } = useAktion();
  const { confirm, dialog } = useConfirm();

  return (
    <div className="ks-stapel">
      {dialog}
      <div className="ks-reihe">
        <Button variant="secondary" icon={<Plus size={15} aria-hidden />} onClick={() => setEdit("neu")}>
          Älteres Meeting nachtragen
        </Button>
      </div>
      <Fehler text={error} />

      {protokolle.length === 0 && (
        <Card>
          <p className="ks-leise">Noch kein Protokoll. Es entsteht, wenn du das nächste Meeting im Überblick abschließt.</p>
        </Card>
      )}

      {protokolle.map((m) => (
        <Card key={m.id}>
          <CardHeader
            title={formatTermin(m.termin)}
            meta={[team.find((t) => t.user_id === m.durchgefuehrt_von_user_id)?.username, m.teilnehmer].filter(Boolean).join(" · ") || undefined}
            action={
              <div className="ks-werkzeug">
                <IconButton label="Protokoll korrigieren" icon={<Pencil size={14} aria-hidden />} onClick={() => setEdit(m)} />
                <IconButton
                  label="Protokoll löschen"
                  tone="danger"
                  icon={<Trash2 size={14} aria-hidden />}
                  onClick={async () => {
                    if (await confirm({ title: "Protokoll löschen?", confirmLabel: "Löschen", destructive: true })) run(() => deleteProtokoll(m.id));
                  }}
                />
              </div>
            }
          />
          <ProtokollInhalt meeting={m} punkte={punkte} aufgaben={aufgaben} />
        </Card>
      ))}

      {edit && (
        <ProtokollDialog
          kundeId={kundeId}
          meeting={edit === "neu" ? null : edit}
          team={team}
          currentUserId={currentUserId}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}

export function ProtokollInhalt({
  meeting: m,
  punkte,
  aufgaben,
}: {
  meeting: KundenMeeting;
  punkte: AgendaPunkt[];
  aufgaben: KundenAufgabe[];
}) {
  const eigene = punkte.filter((p) => p.meeting_id === m.id);
  const besprochen = eigene.filter((p) => p.besprochen);
  const offen = eigene.filter((p) => !p.besprochen);
  const auf = aufgaben.filter((a) => a.meeting_id === m.id);
  const url = sichereUrl(m.aufzeichnung_url);
  const leer = !m.themen && !m.ergebnisse && !eigene.length && !auf.length && !url;

  return (
    <div className="ks-stapel" data-gap="eng">
      {(besprochen.length > 0 || m.themen) && (
        <div>
          <h3 className="ks-zwischen">Besprochen</h3>
          {m.themen && <p className="ks-absatz">{m.themen}</p>}
          {besprochen.length > 0 && (
            <ul className="ks-aufzaehlung">
              {besprochen.map((p) => (
                <li key={p.id}>{p.text}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {m.ergebnisse && (
        <div>
          <h3 className="ks-zwischen">Ergebnisse</h3>
          <p className="ks-absatz">{m.ergebnisse}</p>
        </div>
      )}
      {auf.length > 0 && (
        <div>
          <h3 className="ks-zwischen">Daraus entstandene Aufgaben</h3>
          <ul className="ks-aufzaehlung">
            {auf.map((a) => (
              <li key={a.id}>
                {a.seite === "wir" ? "Wir" : "Kunde"}: {a.text}
                {a.erledigt_am ? " (erledigt)" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {offen.length > 0 && <p className="ks-leise">Nicht besprochen: {offen.map((p) => p.text).join(" · ")}</p>}
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="ks-link">
          <ExternalLink size={13} aria-hidden /> Aufzeichnung
        </a>
      )}
      {leer && <p className="ks-leise">Ohne Notizen abgeschlossen.</p>}
    </div>
  );
}

function ProtokollDialog({
  kundeId,
  meeting,
  team,
  currentUserId,
  onClose,
}: {
  kundeId: string;
  meeting: KundenMeeting | null;
  team: TeamMitglied[];
  currentUserId: string;
  onClose: () => void;
}) {
  const [f, setF] = useState({
    wann: isoToBerlinInput(meeting?.termin),
    person: meeting ? (meeting.durchgefuehrt_von_user_id ?? "") : currentUserId,
    teilnehmer: meeting?.teilnehmer ?? "",
    themen: meeting?.themen ?? "",
    ergebnisse: meeting?.ergebnisse ?? "",
    url: meeting?.aufzeichnung_url ?? "",
  });
  const { error, pending, run } = useAktion();
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <Modal
      open
      onClose={onClose}
      title={meeting ? "Protokoll korrigieren" : "Meeting nachtragen"}
      subtitle="Das geplante nächste Meeting bleibt unverändert."
      width={620}
      closeOnBackdrop={false}
    >
      <div className="ks-stapel">
        <div className="ks-felder">
          <Feld label="Wann">
            <DateTimeField value={f.wann} onChange={(v) => set("wann", v)} ariaLabel="Wann war das Meeting" />
          </Feld>
          <Feld label="Geführt von">
            <Select
              value={f.person}
              onChange={(v) => set("person", v)}
              options={[{ value: "", label: "Keine Angabe" }, ...team.map((t) => ({ value: t.user_id, label: t.username }))]}
            />
          </Feld>
        </div>
        <Feld label="Besprochen">
          <Textarea value={f.themen} onChange={(e) => set("themen", e.target.value)} rows={3} autoGrow />
        </Feld>
        <Feld label="Ergebnisse">
          <Textarea value={f.ergebnisse} onChange={(e) => set("ergebnisse", e.target.value)} rows={3} autoGrow />
        </Feld>
        <div className="ks-felder">
          <Feld label="Weitere Teilnehmer">
            <Input value={f.teilnehmer} onChange={(e) => set("teilnehmer", e.target.value)} />
          </Feld>
          <Feld label="Aufzeichnung (Link)">
            <Input value={f.url} onChange={(e) => set("url", e.target.value)} />
          </Feld>
        </div>
        <Fehler text={error} />
        <DialogFuss
          label="Speichern"
          pending={pending}
          onClose={onClose}
          onSubmit={() =>
            run(
              () =>
                saveProtokoll(kundeId, {
                  id: meeting?.id,
                  termin: berlinInputToIso(f.wann) ?? "",
                  person: f.person || null,
                  teilnehmer: f.teilnehmer,
                  themen: f.themen,
                  ergebnisse: f.ergebnisse,
                  aufzeichnung_url: f.url,
                }),
              onClose,
            )
          }
        />
      </div>
    </Modal>
  );
}
