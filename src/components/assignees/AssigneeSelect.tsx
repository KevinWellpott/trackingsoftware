"use client";

import { setAssignee, type AssigneeEntity } from "@/app/actions/assignees";
import { Select, type SelectOption } from "@/components/ui/Select";
import { ownerColor } from "@/lib/ownerColor";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

// Einzelauswahl fuer die fachliche Zuordnung eines Setting-/Closing-Calls.
// Loest den frueheren Multi-Select ab: Ein Termin gehoert genau einer Person —
// mehrere Zuweisungen liessen die Frage „wessen Termin ist das?" offen und
// jede Auswertung haette denselben Termin mehrfach gezaehlt.
//
// Gespeichert wird sofort bei der Auswahl (kein Speichern-Knopf), analog zu
// den uebrigen Feldern der Detailansichten.

type UserOption = { user_id: string; username: string };

/** „Niemand": der Select kennt nur Strings, `null` reist als leerer Wert. */
const NOBODY = "";

export function AssigneeSelect({
  entityType,
  entityId,
  users,
  value,
}: {
  entityType: AssigneeEntity;
  entityId: string;
  users: UserOption[];
  /** Aktuell zugewiesene user_id — `null` = niemand. */
  value: string | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string>(value ?? NOBODY);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // „Niemand" steht bewusst zur Wahl: Ohne diese Option liesse sich eine
  // versehentliche Zuweisung nur durch eine andere ersetzen, nie loeschen.
  const options: SelectOption[] = [
    { value: NOBODY, label: "Niemand" },
    ...users.map((u) => ({
      value: u.user_id,
      label: u.username,
      color: ownerColor(u.username).fg,
    })),
  ];

  // Der Zugewiesene kann fehlen (Nutzer geloescht oder in eine andere
  // Organisation umgezogen). Ohne diesen Eintrag zeigte das Feld „Niemand" an,
  // obwohl in der Zeile eine user_id steht.
  if (selected !== NOBODY && !options.some((o) => o.value === selected)) {
    options.push({ value: selected, label: "Unbekannter Nutzer", color: "var(--text-muted)" });
  }

  function handleChange(next: string) {
    const previous = selected;
    setSelected(next);
    startTransition(async () => {
      const res = await setAssignee(entityType, entityId, next === NOBODY ? null : next);
      if (res?.error) {
        // Zuruecksetzen, sonst zeigt das Feld eine Zuordnung, die nicht in der
        // Datenbank steht.
        setSelected(previous);
        setError(res.error);
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", maxWidth: 260 }}>
      <Select
        value={selected}
        onChange={handleChange}
        options={options}
        ariaLabel="Zuweisung"
        placeholder="Niemand"
        disabled={isPending}
      />
      {error && (
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--color-error-text)" }}>{error}</span>
      )}
    </div>
  );
}
