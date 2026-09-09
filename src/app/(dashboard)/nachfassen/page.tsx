import { getNachfassenTasks } from "@/app/actions/nachfassen";
import { NachfassenBoard } from "@/components/nachfassen/NachfassenBoard";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/PageHeader";

// Nachfassen: Union-Tasklist aller fälligen Aufgaben aus fünf Quellen —
// LinkedIn-Follow-up, Telefon-Rückruf, Erstgespräch- und Closing-Wiedervorlage
// sowie Recycling — mit vorbereitetem Kopier-Text, kein Auto-Versand.

export default async function NachfassenPage({
  searchParams,
}: {
  searchParams: Promise<{ alle?: string }>;
}) {
  const sp = await searchParams;
  const showingAll = sp.alle === "1";
  const { tasks, hiddenOlder, recyclingAvailable } = await getNachfassenTasks({ includeOlder: showingAll });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <BackLink href="/" label="Dashboard" />

      <PageHeader
        eyebrow="Wiedervorlage"
        title="Nachfassen"
        meta={
          "Was ist heute fällig? Follow-ups, Rückrufe, Wiedervorlagen aus Erstgespräch und Closing " +
          "sowie fällige Recycling-Versuche — jeweils mit fertigem Text zum Kopieren."
        }
      />

      <NachfassenBoard
        tasks={tasks}
        hiddenOlder={hiddenOlder}
        showingAll={showingAll}
        recyclingAvailable={recyclingAvailable}
      />
    </div>
  );
}
