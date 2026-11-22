"use client";

import { useOptimistic, useState } from "react";
import { CalendarX2, X } from "lucide-react";
import {
  addAgenda,
  deleteAgenda,
  meetingAbschliessen,
  meetingAusgefallen,
  setMeetingTermin,
  updateAgenda,
} from "@/app/actions/kunden";
import { Button, IconButton } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Feld } from "@/components/kunden/Feld";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { DateTimeField } from "@/components/ui/DateTimeField";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { DialogFuss, Fehler, Haken, ZeilenEingabe, useAktion } from "@/components/kunden/bausteine";
import { berlinInputToIso, formatTermin, isoToBerlinInput } from "@/lib/apptTime";
import { datumDe } from "@/lib/umsatz";
import type { AgendaPunkt, KundenBaustein, KundenMeeting, TeamMitglied } from "@/lib/kunden";

// Das Wichtigste der Akte, deshalb ganz oben (M2): wann das nächste Meeting
// ist und WAS besprochen wird.
//
// Abschließen ist EIN Ablauf (M3): abhaken, Ergebnis, nächster Termin, nächste
// Agenda. Was nicht besprochen wurde, wandert mit (M4).

export function NaechstesMeeting({
  kundeId,
  kundeName,
  meeting,
  punkte: gespeichert,
  offeneBausteine,
  team,
  currentUserId,
  hinweise,
}: {
  kundeId: string;
  kundeName: string;
  meeting: KundenMeeting;
  punkte: AgendaPunkt[];
  offeneBausteine: KundenBaustein[];
  team: TeamMitglied[];
  currentUserId: string;
  hinweise: string[];
}) {
  const [termin, setTermin] = useState(isoToBerlinInput(meeting.termin));
  const [abschluss, setAbschluss] = useState(false);
  const { error, pending, run } = useAktion();
  const { confirm, dialog } = useConfirm();
  // Ein neuer Termin vom Server zieht das Feld nach, ohne die Karte neu zu
  // bauen: Ein Remount schlösse einen offenen Abschluss-Dialog mit allem Getippten.
  const [gesehen, setGesehen] = useState(meeting.termin);
  if (gesehen !== meeting.termin) {
    setGesehen(meeting.termin);
    setTermin(isoToBerlinInput(meeting.termin));
  }
  const geaendert = termin !== isoToBerlinInput(meeting.termin);
  // Der Haken gehört der KARTE, nicht der Zeile: Wer abhakt und sofort
  // „Abschließen" drückt, gäbe dem Dialog sonst den Stand von vor dem Haken,
  // und der besprochene Punkt wanderte ins nächste Meeting mit.
  const [punkte, setzeBesprochen] = useOptimistic(gespeichert, (alt, h: { id: string; an: boolean }) =>
    alt.map((p) => (p.id === h.id ? { ...p, besprochen: h.an } : p)),
  );

  return (
    <Card style={{ borderColor: "var(--border-accent)" }}>
      {dialog}
      <div className="ks-kopf-umbruch">
      <CardHeader
        eyebrow="Nächstes Meeting"
        title={formatTermin(meeting.termin) ?? "Noch kein Termin"}
        action={
          // Ohne Termin ist „Termin setzen“ der Handgriff, nicht das Abschließen.
          <Button variant={meeting.termin ? "primary" : "secondary"} onClick={() => setAbschluss(true)}>
            Meeting abschließen
          </Button>
        }
      />
      </div>
      <div className="ks-stapel">
        {hinweise.length > 0 && (
          <div className="ks-reihe">
            {hinweise.map((h) => (
              <Badge key={h} tone="warning">
                {h}
              </Badge>
            ))}
          </div>
        )}

        <div className="ks-reihe">
          <div className="ks-termin">
            <DateTimeField value={termin} onChange={setTermin} clearable ariaLabel="Termin des nächsten Meetings" />
          </div>
          {geaendert && (
            <Button
              variant="secondary"
              loading={pending}
              onClick={() => run(() => setMeetingTermin(kundeId, meeting.id, berlinInputToIso(termin)))}
            >
              Termin speichern
            </Button>
          )}
          {meeting.termin && !geaendert && (
            <Button
              variant="ghost"
              loading={pending}
              icon={<CalendarX2 size={14} aria-hidden />}
              onClick={async () => {
                const ja = await confirm({
                  title: "Meeting ausgefallen?",
                  message: "Der Termin wird entfernt und im Verlauf vermerkt. Die Agenda bleibt.",
                  confirmLabel: "Ausgefallen",
                });
                if (ja) run(() => meetingAusgefallen(kundeId, meeting.id));
              }}
            >
              Ausgefallen
            </Button>
          )}
        </div>

        <div className="ks-stapel" data-gap="eng">
          <h3 className="ks-zwischen">Was besprochen wird</h3>
          {punkte.length === 0 ? (
            <p className="ks-leise">Noch keine Agenda. Wer übernimmt, weiß sonst nicht, worum es geht.</p>
          ) : (
            <ul className="ks-liste-schlicht">
              {punkte.map((p) => (
                <li key={p.id} className="ks-punkt">
                  <Haken
                    an={p.besprochen}
                    label={`Besprochen: ${p.text}`}
                    onSetzen={(an) => {
                      // Läuft in der Transition von <Haken>, vor deren erstem await.
                      setzeBesprochen({ id: p.id, an });
                      return updateAgenda(p.id, { besprochen: an });
                    }}
                  >
                    {p.text}
                    {p.uebernommen_von && <span className="ks-herkunft">übernommen vom {datumDe(p.uebernommen_von)}</span>}
                  </Haken>
                  <IconButton
                    label={`Punkt entfernen: ${p.text}`}
                    icon={<X size={14} aria-hidden />}
                    onClick={() => run(() => deleteAgenda(p.id))}
                  />
                </li>
              ))}
            </ul>
          )}
          <ZeilenEingabe label="Agenda-Punkt" placeholder="Punkt für das Meeting, Enter" onAdd={(t) => addAgenda(kundeId, meeting.id, t)} />
          {offeneBausteine.length > 0 && (
            <div className="ks-aus-checkliste">
              <Select
                value=""
                placeholder="Aus der Checkliste auf die Agenda …"
                ariaLabel="Aus der Checkliste auf die Agenda"
                onChange={(id) => {
                  const b = offeneBausteine.find((x) => x.id === id);
                  if (b) run(() => addAgenda(kundeId, meeting.id, b.titel));
                }}
                options={offeneBausteine
                  .filter((b) => !punkte.some((p) => p.text === b.titel))
                  .map((b) => ({ value: b.id, label: b.titel }))}
              />
            </div>
          )}
        </div>
        <Fehler text={error} />
      </div>

      {abschluss && (
        <AbschlussDialog
          kundeId={kundeId}
          kundeName={kundeName}
          meeting={meeting}
          punkte={punkte}
          offeneBausteine={offeneBausteine}
          team={team}
          currentUserId={currentUserId}
          onClose={() => setAbschluss(false)}
        />
      )}
    </Card>
  );
}

/** Wann war es? Der geplante Termin, falls er vorbei ist, sonst jetzt (auf 15 min gerundet). */
function vorschlagWann(termin: string | null): string {
  const jetzt = Date.now();
  if (termin && Date.parse(termin) <= jetzt) return isoToBerlinInput(termin);
  const raster = 15 * 60_000;
  return isoToBerlinInput(new Date(Math.floor(jetzt / raster) * raster).toISOString());
}

function AbschlussDialog({
  kundeId,
  kundeName,
  meeting,
  punkte,
  offeneBausteine,
  team,
  currentUserId,
  onClose,
}: {
  kundeId: string;
  kundeName: string;
  meeting: KundenMeeting;
  punkte: AgendaPunkt[];
  offeneBausteine: KundenBaustein[];
  team: TeamMitglied[];
  currentUserId: string;
  onClose: () => void;
}) {
  const [f, setF] = useState(() => ({
    wann: vorschlagWann(meeting.termin),
    person: currentUserId,
    teilnehmer: "",
    ergebnisse: "",
    url: "",
    wir: "",
    kunde: "",
    naechster: "",
    agenda: "",
  }));
  const [besprochen, setBesprochen] = useState(() => new Set(punkte.filter((p) => p.besprochen).map((p) => p.id)));
  const [fallen, setFallen] = useState(() => new Set<string>());
  const [erledigt, setErledigt] = useState(() => new Set<string>());
  const { error, pending, run } = useAktion();

  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const um = (menge: Set<string>, id: string) => {
    const neu = new Set(menge);
    if (!neu.delete(id)) neu.add(id);
    return neu;
  };
  const mit = punkte.filter((p) => !besprochen.has(p.id) && !fallen.has(p.id));

  return (
    <Modal open onClose={onClose} title="Meeting abschließen" subtitle={kundeName} width={680} closeOnBackdrop={false}>
      <div className="ks-stapel">
        <div className="ks-felder">
          <Feld label="Wann">
            <DateTimeField value={f.wann} onChange={(v) => set("wann", v)} ariaLabel="Wann war das Meeting" />
          </Feld>
          <Feld label="Geführt von">
            <Select
              value={f.person}
              onChange={(v) => set("person", v)}
              options={team.map((t) => ({ value: t.user_id, label: t.username }))}
            />
          </Feld>
        </div>

        {punkte.length > 0 && (
          <fieldset className="ks-schritt">
            <legend>1 · Was wurde besprochen?</legend>
            {punkte.map((p) => {
              const an = besprochen.has(p.id);
              return (
                <div key={p.id} className="ks-punkt">
                  <label className="ks-wahl">
                    <input type="checkbox" checked={an} onChange={() => setBesprochen((s) => um(s, p.id))} />
                    <span>{p.text}</span>
                  </label>
                  {!an && (
                    <button type="button" className="ks-umschalter" onClick={() => setFallen((s) => um(s, p.id))}>
                      {fallen.has(p.id) ? "entfällt" : "wandert mit"}
                    </button>
                  )}
                </div>
              );
            })}
          </fieldset>
        )}

        <fieldset className="ks-schritt">
          <legend>2 · Was kam heraus?</legend>
          <Feld label="Ergebnisse und Entscheidungen">
            <Textarea value={f.ergebnisse} onChange={(e) => set("ergebnisse", e.target.value)} rows={3} autoGrow />
          </Feld>
          <div className="ks-felder">
            <Feld label="Aufgaben für uns (je Zeile eine)">
              <Textarea value={f.wir} onChange={(e) => set("wir", e.target.value)} rows={2} autoGrow />
            </Feld>
            <Feld label="Aufgaben für den Kunden (je Zeile eine)">
              <Textarea value={f.kunde} onChange={(e) => set("kunde", e.target.value)} rows={2} autoGrow />
            </Feld>
          </div>
          {offeneBausteine.length > 0 && (
            <Feld label="In der Checkliste erledigt">
              <div className="ks-auswahl">
                {offeneBausteine.map((b) => (
                  <label key={b.id} className="ks-wahl">
                    <input type="checkbox" checked={erledigt.has(b.id)} onChange={() => setErledigt((s) => um(s, b.id))} />
                    <span>
                      {b.titel}
                      {b.phase && <span className="ks-leise"> · {b.phase}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </Feld>
          )}
          <div className="ks-felder">
            <Feld label="Weitere Teilnehmer">
              <Input value={f.teilnehmer} onChange={(e) => set("teilnehmer", e.target.value)} />
            </Feld>
            <Feld label="Aufzeichnung (Link)">
              <Input value={f.url} onChange={(e) => set("url", e.target.value)} placeholder="Loom, Drive, Zoom …" />
            </Feld>
          </div>
        </fieldset>

        <fieldset className="ks-schritt">
          <legend>3 · Wie geht es weiter?</legend>
          <Feld label="Nächstes Meeting">
            <DateTimeField value={f.naechster} onChange={(v) => set("naechster", v)} clearable ariaLabel="Nächstes Meeting" />
          </Feld>
          <Feld
            label="Was wird dann besprochen? (je Zeile ein Punkt)"
            hint={mit.length ? `Dazu wandern mit: ${mit.map((p) => p.text).join(" · ")}` : undefined}
          >
            <Textarea value={f.agenda} onChange={(e) => set("agenda", e.target.value)} rows={3} autoGrow />
          </Feld>
          {!f.naechster && <p className="ks-warnung">Ohne Termin steht der Kunde danach unter „Kein Meeting geplant“.</p>}
          {!f.agenda.trim() && mit.length === 0 && <p className="ks-warnung">Das nächste Meeting hätte keine Agenda.</p>}
        </fieldset>

        <Fehler text={error} />
        <DialogFuss
          label="Abschließen"
          pending={pending}
          onClose={onClose}
          onSubmit={() =>
            run(
              () =>
                meetingAbschliessen(kundeId, meeting.id, {
                  termin: berlinInputToIso(f.wann) ?? "",
                  person: f.person || null,
                  teilnehmer: f.teilnehmer,
                  ergebnisse: f.ergebnisse,
                  aufzeichnung_url: f.url,
                  besprochen: [...besprochen],
                  entfaellt: [...fallen].filter((id) => !besprochen.has(id)),
                  erledigte_bausteine: [...erledigt],
                  aufgaben_wir: f.wir,
                  aufgaben_kunde: f.kunde,
                  naechster_termin: berlinInputToIso(f.naechster),
                  naechste_agenda: f.agenda,
                }),
              onClose,
            )
          }
        />
      </div>
    </Modal>
  );
}
