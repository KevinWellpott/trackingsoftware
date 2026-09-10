import { getNachfassenTasks } from "@/app/actions/nachfassen";
import { NachfassenBoard } from "@/components/nachfassen/NachfassenBoard";
import { BackLink } from "@/components/ui/BackLink";
import { InfoPopover } from "@/components/ui/InfoPopover";
import { PageHeader } from "@/components/ui/PageHeader";

// Nachfassen: Union-Tasklist aller fälligen Aufgaben aus VIER Quellen —
// Telefon-Rückruf, Erstgespräch- und Closing-Wiedervorlage sowie Recycling —
// mit vorbereitetem Kopier-Text, kein Auto-Versand.
//
// LinkedIn-Follow-ups stehen hier nicht mehr; sie werden in der Ansicht
// „Nachfassen" der jeweiligen Pitch-Liste erledigt, wo auch die FU-Sequenz der
// Liste gepflegt wird (Begründung in actions/nachfassen.ts).

export default async function NachfassenPage({
  searchParams,
}: {
  searchParams: Promise<{ alle?: string }>;
}) {
  const sp = await searchParams;
  // `?alle=1` hat genau einen Zweck: die Altlasten mitladen. Vorher hing daran
  // zusätzlich der Pitch-Schnitt der LinkedIn-Leads — der ist mit der Quelle
  // entfallen, der Schalter bleibt, weil es weiterhin etwas auszupacken gibt.
  const showingAll = sp.alle === "1";
  // Bewusst als Ganzes durchgereicht statt Feld für Feld: Das Ergebnis trägt
  // neben den Aufgaben zwei Verfügbarkeits-Flaggen und die Altlast-Zähler, und
  // ein hier vergessenes Feld wäre auf dieser Seite besonders teuer — eine
  // nicht durchgereichte Flagge sähe im Board exakt wie „nichts zu tun" aus.
  const result = await getNachfassenTasks({ includeOlder: showingAll });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <BackLink href="/" label="Dashboard" />

      {/* Die Beschreibung der Seite steht hinter dem Info-Icon, nicht als Absatz
          darunter: Wer dieses Board jeden Morgen abarbeitet, liest sie zum
          hundertsten Mal — die Filterreihe darunter sagt ihm ohnehin sofort,
          was heute fällig ist. Nachschlagbar bleibt sie an Ort und Stelle.
          Das `info`-Element trägt bewusst keinen Handler: Die Seite ist eine
          Server Component, `preventDefault`/`stopPropagation` sitzen im
          Client-Teil `InfoPopover` (docs §5.1). */}
      <PageHeader
        eyebrow="Wiedervorlage"
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" }}>
            Nachfassen
            <InfoPopover label="Nachfassen: was hier steht" width={380}>
              Was ist heute fällig? Telefon-Rückrufe, Wiedervorlagen aus Setting und Closing sowie fällige
              Recycling-Versuche — jeweils mit fertigem Text zum Kopieren, kein Auto-Versand.
              LinkedIn-Follow-ups stehen nicht hier, sondern in der Ansicht &bdquo;Nachfassen&ldquo; der jeweiligen
              Pitch-Liste, wo auch die Follow-up-Texte gepflegt werden.
            </InfoPopover>
          </span>
        }
      />

      <NachfassenBoard {...result} showingAll={showingAll} />
    </div>
  );
}
