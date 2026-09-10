import { getNachfassenTasks } from "@/app/actions/nachfassen";
import { NachfassenBoard } from "@/components/nachfassen/NachfassenBoard";
import { BackLink } from "@/components/ui/BackLink";
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

      <PageHeader
        eyebrow="Wiedervorlage"
        title="Nachfassen"
        meta={
          "Was ist heute fällig? Telefon-Rückrufe, Wiedervorlagen aus Setting und Closing sowie " +
          "fällige Recycling-Versuche — jeweils mit fertigem Text zum Kopieren. " +
          "LinkedIn-Follow-ups stehen in der jeweiligen Pitch-Liste."
        }
      />

      <NachfassenBoard {...result} showingAll={showingAll} />
    </div>
  );
}
