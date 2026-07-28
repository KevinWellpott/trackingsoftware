import { getNachfassenTasks } from "@/app/actions/nachfassen";
import { NachfassenBoard } from "@/components/nachfassen/NachfassenBoard";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/PageHeader";

// Nachfassen: Union-Tasklist aller fälligen Aufgaben (LinkedIn + Telefon + Closing)
// mit vorbereitetem Kopier-Text — kein Auto-Versand.

export default async function NachfassenPage({
  searchParams,
}: {
  searchParams: Promise<{ alle?: string }>;
}) {
  const sp = await searchParams;
  const showingAll = sp.alle === "1";
  const { tasks, hiddenOlder } = await getNachfassenTasks({ includeOlder: showingAll });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <BackLink href="/" label="Dashboard" />

      <PageHeader
        eyebrow="Wiedervorlage"
        title="Nachfassen"
        meta="Alle fälligen Aufgaben aus LinkedIn, Telefon und Closing — mit fertigem Text zum Kopieren."
      />

      <NachfassenBoard tasks={tasks} hiddenOlder={hiddenOlder} showingAll={showingAll} />
    </div>
  );
}
