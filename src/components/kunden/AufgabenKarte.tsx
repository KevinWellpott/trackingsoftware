"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { addAufgabe, deleteAufgabe, setAufgabeErledigt } from "@/app/actions/kunden";
import { IconButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Fehler, Haken, ZeilenEingabe, useAktion } from "@/components/kunden/bausteine";
import { datumDe, tageZwischen } from "@/lib/umsatz";
import type { KundenAufgabe } from "@/lib/kunden";

// Offene Aufgaben beider Seiten, mit Alter. Erledigtes von heute bleibt
// sichtbar, damit ein Fehlklick mit einem Klick zurückzunehmen ist.

export function AufgabenKarte({
  kundeId,
  aufgaben,
  heute,
}: {
  kundeId: string;
  /** `seit` ist der Berliner Tag der Anlage, vom Server gebildet. */
  aufgaben: (KundenAufgabe & { seit: string })[];
  heute: string;
}) {
  const [seite, setSeite] = useState<"wir" | "kunde">("wir");
  const { error, run } = useAktion();
  const sichtbar = aufgaben.filter((a) => !a.erledigt_am || a.erledigt_am === heute);

  const alter = (a: KundenAufgabe & { seit: string }) => {
    if (a.erledigt_am) return "heute erledigt";
    const t = tageZwischen(a.seit, heute);
    return t <= 0 ? "von heute" : t === 1 ? "seit gestern" : `seit ${t} Tagen (${datumDe(a.seit)})`;
  };

  return (
    <Card>
      <CardHeader title="Offene Aufgaben" />
      <div className="ks-stapel">
        {sichtbar.length === 0 && <p className="ks-leise">Keine offenen Aufgaben.</p>}
        {(["wir", "kunde"] as const).map((s) => {
          const zeilen = sichtbar.filter((a) => a.seite === s);
          if (!zeilen.length) return null;
          return (
            <div key={s}>
              <h3 className="ks-zwischen">{s === "wir" ? "Wir" : "Kunde"}</h3>
              <ul className="ks-liste-schlicht">
                {zeilen.map((a) => (
                  <li key={a.id} className="ks-punkt">
                    <Haken an={!!a.erledigt_am} label={a.text} onSetzen={(an) => setAufgabeErledigt(a.id, an)}>
                      {a.text}
                      <span className="ks-herkunft">{alter(a)}</span>
                    </Haken>
                    <IconButton label={`Aufgabe entfernen: ${a.text}`} icon={<X size={14} aria-hidden />} onClick={() => run(() => deleteAufgabe(a.id))} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        <div className="ks-stapel" data-gap="eng">
          <div className="ks-chips" role="group" aria-label="Wer erledigt die Aufgabe">
            {(["wir", "kunde"] as const).map((s) => (
              <button key={s} type="button" className="ks-chip" data-active={seite === s} aria-pressed={seite === s} onClick={() => setSeite(s)}>
                {s === "wir" ? "Für uns" : "Für den Kunden"}
              </button>
            ))}
          </div>
          <ZeilenEingabe label="Aufgabe" placeholder="Neue Aufgabe, Enter" onAdd={(t) => addAufgabe(kundeId, seite, t)} />
        </div>
        <Fehler text={error} />
      </div>
    </Card>
  );
}
