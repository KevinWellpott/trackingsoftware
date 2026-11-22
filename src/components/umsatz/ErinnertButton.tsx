"use client";

import { BellRing } from "lucide-react";
import { zahlungErinnert } from "@/app/actions/umsatz";
import { Button } from "@/components/ui/Button";
import { Fehler, useAktion } from "@/components/kunden/bausteine";

// Derselbe Gedanke wie der Nachfass-Stempel der Terminliste: WIE erinnert
// wurde, ist egal. Es geht nur darum, dass nicht zwei am selben Tag anrufen.

export function ErinnertButton({ kundeId, heuteSchon }: { kundeId: string; heuteSchon: boolean }) {
  const { error, pending, run } = useAktion();
  if (heuteSchon) return null;
  return (
    <>
      <Button size="sm" variant="secondary" loading={pending} icon={<BellRing size={13} aria-hidden />} onClick={() => run(() => zahlungErinnert(kundeId))}>
        Habe erinnert
      </Button>
      <Fehler text={error} />
    </>
  );
}
