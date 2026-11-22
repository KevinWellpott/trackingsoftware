"use client";

import Link from "next/link";
import { setBausteinErledigt } from "@/app/actions/kunden";
import { Card, CardHeader } from "@/components/ui/Card";
import { Haken } from "@/components/kunden/bausteine";
import { bausteinFortschritt, type KundenBaustein, type KundenCheckliste } from "@/lib/kunden";

const ZEIGE = 3;

/** Checklisten im Überblick: je Liste die nächsten offenen Punkte, direkt abhakbar. */
export function ChecklistenKompakt({
  kundeId,
  checklisten,
  bausteine,
  heute,
}: {
  kundeId: string;
  checklisten: KundenCheckliste[];
  bausteine: KundenBaustein[];
  heute: string;
}) {
  return (
    <Card>
      <CardHeader
        title="Fulfillment"
        action={
          <Link href={`/kunden/${kundeId}?tab=fulfillment`} className="ks-link">
            {checklisten.length ? "Alle Punkte" : "Vorlage zuweisen"}
          </Link>
        }
      />
      <div className="ks-stapel">
        {checklisten.length === 0 && <p className="ks-leise">Noch keine Checkliste.</p>}
        {checklisten.map((l) => {
          const eigene = bausteine.filter((b) => b.checkliste_id === l.id);
          const f = bausteinFortschritt(eigene);
          const offen = eigene.filter((b) => !b.erledigt_am).slice(0, ZEIGE);
          // Heute Abgehaktes bleibt stehen: ein Klick nimmt es zurück.
          const eben = eigene.filter((b) => b.erledigt_am === heute);
          const zeilen = eigene.filter((b) => offen.includes(b) || eben.includes(b));
          return (
            <div key={l.id}>
              <div className="ks-kopfzeile">
                <h3 className="ks-zwischen">{l.titel}</h3>
                <span className="ks-leise">
                  {f.erledigt} / {f.gesamt}
                </span>
              </div>
              <div className="progress-track">
                <div className="progress-fill ks-fortschritt" style={{ width: f.gesamt ? `${(f.erledigt / f.gesamt) * 100}%` : 0 }} />
              </div>
              <ul className="ks-liste-schlicht">
                {zeilen.map((b) => (
                  <li key={b.id} className="ks-punkt">
                    <Haken an={!!b.erledigt_am} label={b.titel} onSetzen={(an) => setBausteinErledigt(b.id, an)}>
                      {b.titel}
                      {b.phase && <span className="ks-herkunft">{b.phase}</span>}
                    </Haken>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
