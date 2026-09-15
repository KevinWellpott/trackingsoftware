"use client";

import { setAssignee, setConductedBy, type AssigneeEntity } from "@/app/actions/assignees";
import { Select, type SelectOption } from "@/components/ui/Select";
import { ownerColor } from "@/lib/ownerColor";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

// Einzelauswahl fuer eine Person an einem Setting-/Closing-Call — fuer ZWEI
// Felder mit zwei verschiedenen Fragen (docs/data-model.md §2):
//
//  · `assigned`  — die Zuweisung (`assigned_user_id`): Wer erinnert und nervt,
//                  also wer den Termin gelegt hat. Umverteilen ist Admin-Sache;
//                  die Editoren zeigen diese Auswahl nur einem Owner mit
//                  Team-Sicht.
//  · `conducted` — „Durchgeführt von" (`conducted_by_user_id`, Migration 0042):
//                  wer das Gespraech gefuehrt hat. Das traegt jeder selbst ein.
//
// Ein Termin hat je Feld genau EINE Person — mehrere Zuweisungen liessen die
// Frage „wessen Termin ist das?" offen, und jede Auswertung haette denselben
// Termin mehrfach gezaehlt.
//
// Gespeichert wird sofort bei der Auswahl (kein Speichern-Knopf), analog zu
// den uebrigen Feldern der Detailansichten.

type UserOption = { user_id: string; username: string };

/** Die leere Auswahl: der Select kennt nur Strings, `null` reist als leerer Wert. */
const NOBODY = "";

/**
 * Was die beiden Felder unterscheidet — Schreibpfad und Beschriftung, sonst
 * nichts. Die leere Auswahl heisst verschieden: Eine Zuweisung auf „Niemand"
 * ist eine Entscheidung, ein leeres „Durchgeführt von" dagegen der
 * Normalzustand, bis jemand das Gespraech gefuehrt hat.
 */
const FELD = {
  assigned: { save: setAssignee, empty: "Niemand", aria: "Zuweisung" },
  conducted: { save: setConductedBy, empty: "Noch nicht eingetragen", aria: "Durchgeführt von" },
} as const;

export function AssigneeSelect({
  entityType,
  entityId,
  users,
  value,
  field = "assigned",
}: {
  entityType: AssigneeEntity;
  entityId: string;
  users: UserOption[];
  /** Aktuell eingetragene user_id — `null` = niemand. */
  value: string | null;
  /** Welches der beiden Personenfelder diese Auswahl schreibt. */
  field?: keyof typeof FELD;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string>(value ?? NOBODY);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const feld = FELD[field];

  // Die leere Option steht bewusst zur Wahl: Ohne sie liesse sich eine
  // versehentliche Auswahl nur durch eine andere ersetzen, nie loeschen.
  const options: SelectOption[] = [
    { value: NOBODY, label: feld.empty },
    ...users.map((u) => ({
      value: u.user_id,
      label: u.username,
      color: ownerColor(u.username).fg,
    })),
  ];

  // Die eingetragene Person kann fehlen (Nutzer geloescht oder in eine andere
  // Organisation umgezogen). Ohne diesen Eintrag zeigte das Feld die leere
  // Auswahl an, obwohl in der Zeile eine user_id steht.
  if (selected !== NOBODY && !options.some((o) => o.value === selected)) {
    options.push({ value: selected, label: "Unbekannter Nutzer", color: "var(--text-muted)" });
  }

  function handleChange(next: string) {
    const previous = selected;
    setSelected(next);
    startTransition(async () => {
      const res = await feld.save(entityType, entityId, next === NOBODY ? null : next);
      if (res?.error) {
        // Zuruecksetzen, sonst zeigt das Feld eine Auswahl, die nicht in der
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
        ariaLabel={feld.aria}
        placeholder={feld.empty}
        disabled={isPending}
      />
      {error && (
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--color-error-text)" }}>{error}</span>
      )}
    </div>
  );
}
