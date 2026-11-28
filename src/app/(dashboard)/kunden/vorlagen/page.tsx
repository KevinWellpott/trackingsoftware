import Link from "next/link";
import { notFound } from "next/navigation";
import { getInternRechte, loadVorlageDateien, loadVorlagen } from "@/lib/internData";
import { PageHeader } from "@/components/ui/PageHeader";
import { BackLink } from "@/components/ui/BackLink";
import { InfoPopover } from "@/components/ui/InfoPopover";
import { VorlageAnlegenButton, VorlagenEditor } from "@/components/kunden/VorlagenEditor";
import { nachPhase, type Vorlage } from "@/lib/kunden";

// Fulfillment-Vorlagen. Beliebig viele, ein Kunde kann mehrere bekommen (F1).
// Volle Breite (28.11.): links die Vorlagen, rechts die gewählte mit
// einklappbaren Phasen und Dateien.

export const dynamic = "force-dynamic";

function VorlageLink({ v, aktiv }: { v: Vorlage; aktiv: boolean }) {
  const phasen = nachPhase(v.punkte).filter((g) => g.phase).length;
  return (
    <li>
      <Link href={`/kunden/vorlagen?id=${v.id}`} className="vl-link" data-aktiv={aktiv || undefined} aria-current={aktiv ? "page" : undefined}>
        <span className="vl-link-name">{v.name}</span>
        <span className="vl-link-meta">
          {v.punkte.length} {v.punkte.length === 1 ? "Punkt" : "Punkte"}
          {phasen > 0 && ` · ${phasen} ${phasen === 1 ? "Phase" : "Phasen"}`}
        </span>
      </Link>
    </li>
  );
}

export default async function VorlagenPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const rechte = await getInternRechte();
  if (rechte.fehler) throw new Error("Rechte nicht prüfbar.");
  if (!rechte.kunden) notFound();
  const [sp, vorlagen] = await Promise.all([searchParams, loadVorlagen()]);

  const laufend = vorlagen.filter((v) => !v.archiviert_at);
  const archiviert = vorlagen.filter((v) => v.archiviert_at);
  const aktiv = vorlagen.find((v) => v.id === sp.id) ?? laufend[0] ?? archiviert[0] ?? null;
  const dateien = aktiv ? await loadVorlageDateien(aktiv.id) : null;

  return (
    <div className="ks-seite">
      <BackLink href="/kunden" label="Kunden" />
      <PageHeader
        eyebrow="Kundenspace"
        title={
          <span className="vl-titel">
            Vorlagen
            <InfoPopover label="Was sind Vorlagen?" width={300}>
              Checklisten für das Fulfillment. Beim Zuweisen bekommt der Kunde eine eigene Kopie; ein Kunde kann mehrere
              Vorlagen bekommen.
            </InfoPopover>
          </span>
        }
        actions={<VorlageAnlegenButton />}
      />

      {aktiv ? (
        <div className="vl-layout">
          <nav className="card vl-liste" aria-label="Vorlagen">
            <div className="vl-liste-kopf">
              <span>Vorlagen</span>
              <span className="kd-zahl">{laufend.length}</span>
            </div>
            <ul>
              {laufend.map((v) => (
                <VorlageLink key={v.id} v={v} aktiv={v.id === aktiv.id} />
              ))}
            </ul>
            {archiviert.length > 0 && (
              <details className="vl-archiv-gruppe" open={!!aktiv.archiviert_at}>
                <summary className="vl-liste-kopf">
                  <span>Archiviert</span>
                  <span className="kd-zahl">{archiviert.length}</span>
                </summary>
                <ul>
                  {archiviert.map((v) => (
                    <VorlageLink key={v.id} v={v} aktiv={v.id === aktiv.id} />
                  ))}
                </ul>
              </details>
            )}
          </nav>
          <VorlagenEditor
            key={`${aktiv.id}:${aktiv.name}`}
            vorlage={aktiv}
            dateien={dateien?.dateien ?? []}
            dateienVerfuegbar={dateien?.verfuegbar ?? false}
          />
        </div>
      ) : (
        <section className="card vl-leer">
          <p>Noch keine Vorlage. Leg eine an und füg euren Ablauf als Liste ein, eine Zeile je Checkbox.</p>
        </section>
      )}
    </div>
  );
}
