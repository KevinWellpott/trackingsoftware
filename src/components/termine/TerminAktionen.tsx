"use client";

import { Button } from "@/components/ui/Button";
import { DateTimeField } from "@/components/ui/DateTimeField";
import type { TerminEvent } from "@/lib/termine";
import { CalendarPlus, Check, Skull } from "lucide-react";
import { useState } from "react";

// Die drei Handgriffe einer Zeile — alle ohne Seitenwechsel.
//
// „Wichtig ist nur zweierlei: dass der Zuständige sieht, dass er nerven muss,
// und dass er es abhaken kann." Daraus folgen genau drei Knöpfe, und es folgt
// vor allem, was NICHT hier steht: kein Kanal, keine Stufe, kein Textbaustein,
// kein Grund-Katalog. Wie jemand genervt wurde, fragt die Software nicht mehr.
//
// Die Reihenfolge ist die Häufigkeit: abhaken (täglich), neu terminieren (der
// eine gute Ausgang), tot (der eine schlechte). Der Ein-Klick-Stempel steht
// deshalb links und ohne Rückfrage — er ist folgenlos und morgen wieder fällig.
// „Tot" fragt nach, weil es die Zeile beendet.

export function TerminAktionen({
  event,
  pending,
  onGenervt,
  onNeuerTermin,
  onTot,
}: {
  event: TerminEvent;
  /** Läuft für DIESE Zeile gerade eine Aktion? */
  pending: boolean;
  onGenervt: () => void;
  /** Berlin-Wandzeit ("2026-09-21T10:00") — dasselbe Format wie überall sonst. */
  onNeuerTermin: (berlinInput: string) => void;
  onTot: () => void;
}) {
  // Das Datumsfeld klappt PRO ZEILE auf, statt dauerhaft dazustehen: In einer
  // Tabelle mit dreißig Zeilen wären dreißig Datumsfelder eine Wand.
  const [open, setOpen] = useState(false);
  //
  // LEER, nicht mit dem alten Termin vorbelegt. Die Vorbelegung wäre bequemer
  // und gefährlicher: Der alte Termin ist bei jeder Zeile dieser Liste
  // entweder vorbei oder abgesagt. Ein Klick auf „Setzen" ohne Änderung schriebe
  // dann genau denselben Zeitpunkt zurück — die Zeile bliebe in der
  // Arbeitsmenge, und für den Nutzer sähe es aus, als hätte der Knopf nichts
  // getan. Leer plus ein gesperrtes „Setzen" macht denselben Fehler unmöglich;
  // die Uhrzeit setzt das Feld beim Datumsklick von selbst (09:00).
  const [wert, setWert] = useState("");

  if (open) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
        <DateTimeField
          value={wert}
          onChange={setWert}
          disabled={pending}
          ariaLabel={`Neuer Termin für ${event.title}`}
          style={{ minWidth: 0 }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending || !wert}
          onClick={() => {
            onNeuerTermin(wert);
            setOpen(false);
          }}
        >
          Setzen
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setOpen(false)}>
          Abbrechen
        </Button>
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={onGenervt}
        title={
          event.dran
            ? "Heute kontaktiert — die Zeile wird ruhig und leuchtet morgen wieder."
            : "Nochmal als kontaktiert eintragen."
        }
      >
        <Check size={13} /> Genervt
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => setOpen(true)}
        title="Neuen Termin ansetzen — danach ist die Zeile versorgt."
      >
        <CalendarPlus size={13} /> Termin
      </Button>
      <Button
        type="button"
        variant="danger"
        size="sm"
        disabled={pending}
        onClick={onTot}
        title={
          event.kind === "setting"
            ? "Als toten Lead markieren."
            : "Als „Kein Close“ abschließen — das Gegenstück zu „tot“ beim Closing."
        }
      >
        <Skull size={13} /> Tot
      </Button>
    </span>
  );
}
