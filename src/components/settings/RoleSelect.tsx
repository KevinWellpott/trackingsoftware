"use client";

import { updateUserRole } from "@/app/actions/workspace";
import { Select } from "@/components/ui/Select";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

// Inline-Editor fuer die Rolle eines bestehenden Nutzers — baugleich zu
// DataScopeSelect, weil es dieselbe Geste ist: eine der beiden unabhaengigen
// Achsen einer Mitgliedschaft umstellen (role = Admin-Rechte,
// data_scope = Datensichtbarkeit).
//
// Die eigene Zeile ist gesperrt: wer sich selbst zum Mitglied macht, verliert
// im selben Klick die Nutzerverwaltung. Das ist zusaetzlich serverseitig
// abgesichert (updateUserRole) — hier steht es nur, damit die UI ehrlich ist.

export function RoleSelect({
  userId,
  role,
  disabled = false,
}: {
  userId: string;
  role: "owner" | "member";
  disabled?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(next: string) {
    if (next === role) return;
    startTransition(async () => {
      const res = await updateUserRole(userId, next as "owner" | "member");
      if (res.error) {
        // Die Settings-Seite hat kein Toast-System — konsistent mit den
        // anderen Nutzerverwaltungs-Aktionen bleibt die einfache Meldung.
        alert(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Select
      value={role}
      onChange={handleChange}
      disabled={disabled || isPending}
      variant="cell"
      ariaLabel="Rolle"
      title={disabled ? "Die eigene Rolle lässt sich nicht ändern" : "Rolle"}
      options={[
        { value: "owner", label: "Owner", hint: "Nutzer verwalten, Ziele setzen" },
        { value: "member", label: "Mitglied" },
      ]}
    />
  );
}
