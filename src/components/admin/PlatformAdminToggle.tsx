"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, ShieldPlus } from "lucide-react";
import { grantPlatformAdmin, revokePlatformAdmin } from "@/app/actions/platform";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";

// Plattform-Admin-Rechte vergeben und entziehen.
//
// Warum ein Bestaetigungsdialog fuer eine so kleine Geste: das ist die
// weitreichendste Berechtigung des Systems. Ein Plattform-Admin steht OBERHALB
// der Organisationen — er liest und schreibt in jeder von ihnen, und eine
// Datensicht „nur eigene Daten" hat fuer ihn keine Wirkung mehr. Genau dieser
// Satz steht deshalb im Dialog: er ist die Kernwirkung, kein Kleingedrucktes.

export function PlatformAdminToggle({
  userId,
  username,
  isAdmin,
  isSelf,
}: {
  userId: string;
  username: string;
  isAdmin: boolean;
  /** Die eigene Zeile: Rechte kann man sich selbst nicht entziehen. */
  isSelf: boolean;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    const ok = await confirm(
      isAdmin
        ? {
            title: "Plattform-Rechte entziehen?",
            message: `„${username}" sieht danach nur noch die eigene Organisation. Bestehende Daten bleiben unverändert.`,
            confirmLabel: "Entziehen",
            destructive: true,
          }
        : {
            title: "Zum Plattform-Admin machen?",
            message: (
              <>
                <strong style={{ color: "var(--text-primary)" }}>{username}</strong> sieht
                und bearbeitet danach <strong style={{ color: "var(--text-primary)" }}>jede</strong>{" "}
                Organisation org-weit — eine Einschränkung auf &bdquo;nur eigene Daten&ldquo;
                ist damit aufgehoben.
              </>
            ),
            confirmLabel: "Rechte vergeben",
          },
    );
    if (!ok) return;

    setError(null);
    startTransition(async () => {
      const res = isAdmin ? await revokePlatformAdmin(userId) : await grantPlatformAdmin(userId);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  // Groesse md wie alle Controls im Admin-Bereich: die beiden Tabellen auf
  // /admin stehen untereinander — unterschiedlich hohe Zeilenaktionen liessen
  // sie wie zwei fremde Bausteine wirken.
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", alignItems: "flex-end" }}>
      {isAdmin ? (
        <Button
          type="button"
          variant="ghost"
          onClick={handleClick}
          disabled={isPending || isSelf}
          title={
            isSelf
              ? "Du kannst dir die Plattform-Rechte nicht selbst entziehen"
              : `Plattform-Rechte von ${username} entziehen`
          }
          style={{ color: "var(--orange-300)" }}
        >
          <ShieldCheck size={14} /> Plattform-Admin
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          onClick={handleClick}
          disabled={isPending}
          title={`${username} zum Plattform-Admin machen`}
        >
          <ShieldPlus size={14} /> Zum Admin machen
        </Button>
      )}
      {error && (
        <span role="alert" style={{ fontSize: "var(--fs-2xs)", color: "var(--danger-fg)", textAlign: "right" }}>
          {error}
        </span>
      )}
      {dialog}
    </div>
  );
}
