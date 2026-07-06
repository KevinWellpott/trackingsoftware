import { getNachfassenTasks } from "@/app/actions/nachfassen";
import { NachfassenBoard } from "@/components/nachfassen/NachfassenBoard";
import { ArrowLeft, Bell } from "lucide-react";
import Link from "next/link";

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
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", fontSize: "0.8125rem", color: "var(--text-subtle)", textDecoration: "none", marginBottom: "1.25rem" }}>
        <ArrowLeft size={13} /> Dashboard
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <div style={{ width: 38, height: 38, borderRadius: "var(--radius-md)", background: "var(--brand-50)", border: "1px solid var(--brand-200)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-sm)" }}>
          <Bell size={18} color="var(--brand-500)" />
        </div>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 850, color: "var(--text-primary)", letterSpacing: "-0.03em", margin: 0 }}>Nachfassen</h1>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-subtle)", margin: 0 }}>
            Alle fälligen Aufgaben aus LinkedIn, Telefon und Closing — mit fertigem Text zum Kopieren.
          </p>
        </div>
      </div>

      <NachfassenBoard tasks={tasks} hiddenOlder={hiddenOlder} showingAll={showingAll} />
    </div>
  );
}
