"use client";

import { updateUserScope } from "@/app/actions/workspace";
import { Select } from "@/components/ui/Select";
import type { DataScope } from "@/lib/access";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

// Inline-Editor fuer die Datensicht eines bestehenden Nutzers — die Erstell-
// Form (settings/page.tsx) setzt sie nur beim Anlegen, das hier ist das
// fehlende Gegenstueck fuer Bestandsnutzer.

export function DataScopeSelect({ userId, dataScope }: { userId: string; dataScope: DataScope }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(next: string) {
    if (next === dataScope) return;
    startTransition(async () => {
      const res = await updateUserScope(userId, next as DataScope);
      if (res.error) {
        // Settings-Seite hat kein Toast-System — konsistent mit den anderen
        // Nutzerverwaltungs-Aktionen bleibt nur die einfache Meldung.
        alert(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Select
      value={dataScope}
      onChange={handleChange}
      disabled={isPending}
      variant="cell"
      ariaLabel="Datensicht"
      title="Datensicht"
      options={[
        { value: "workspace", label: "Alle Daten" },
        { value: "own", label: "Nur eigene Daten" },
      ]}
    />
  );
}
