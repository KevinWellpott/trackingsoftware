"use client";

import { useRouter } from "next/navigation";
import { deleteKunde } from "@/app/actions/kunden";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Fehler, useAktion } from "@/components/kunden/bausteine";

/** Nur für Fehlanlagen (Test, Dublette, versehentlich „Gewonnen"). */
export function KundeLoeschen({ id, name }: { id: string; name: string }) {
  const { error, pending, run } = useAktion();
  const { confirm, dialog } = useConfirm();
  const router = useRouter();
  return (
    <div className="ks-loeschen">
      {dialog}
      <Button
        size="sm"
        variant="ghost"
        loading={pending}
        onClick={async () => {
          const ja = await confirm({
            title: `„${name}“ endgültig löschen?`,
            message:
              "Nur für Fehlanlagen. Akte, Protokolle, Checklisten, Ablage und Ratenplan gehen verloren. Wer aufgehört hat, bekommt stattdessen den Status „Abgeschlossen“ oder eine Kündigung.",
            confirmLabel: "Endgültig löschen",
            destructive: true,
          });
          if (ja) run(() => deleteKunde(id), () => router.replace("/kunden"));
        }}
      >
        Fehlanlage löschen
      </Button>
      <Fehler text={error} />
    </div>
  );
}
