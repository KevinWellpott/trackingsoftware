"use client";

// Die Handgriffe einer Termin-Zeile außerhalb des Kalenders — für /setting,
// /closing und /no-shows. Dieselben Server-Actions und dieselbe Rückfrage bei
// „Tot" wie in der Terminliste (components/termine/TermineList.tsx): Genervt
// stempelt, Termin setzt neu an (`setNeuerTermin` — macht bei „Nicht
// qualifiziert" das Erstgespräch wieder auf), Tot beendet mit Recycling
// (`markTerminDead`). Ein Termin, der begonnen hat und kein Ergebnis trägt,
// bekommt statt dieser drei die Ergebnis-Schnellknöpfe (`brauchtErgebnis`).
//
// Bewusst ohne optimistische Anzeige: Die Folgen (Zustand, Recycling-Datum)
// bestimmt der Server.

import { markFollowUpContacted, markTerminDead, setNeuerTermin } from "@/app/actions/followUpStamp";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ErgebnisSchnell } from "@/components/termine/ErgebnisSchnell";
import { brauchtErgebnis } from "@/lib/nachfassRegel";
import type { TerminEvent } from "@/lib/termine";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

export function useTerminHandgriffe(onError: (message: string | null) => void, nowMs: number | null) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const run = useCallback(
    (event: TerminEvent, aktion: () => Promise<{ error?: string }>) => {
      onError(null);
      setBusyId(event.id);
      startTransition(async () => {
        const res = await aktion();
        if (res?.error) {
          setBusyId(null);
          onError(res.error);
          return;
        }
        router.refresh();
      });
    },
    [onError, router],
  );

  const onGenervt = useCallback((e: TerminEvent) => run(e, () => markFollowUpContacted(e.kind, e.refId)), [run]);

  const onNeuerTermin = useCallback(
    (e: TerminEvent, berlinInput: string) => run(e, () => setNeuerTermin(e.kind, e.refId, berlinInput)),
    [run],
  );

  const onTot = useCallback(
    async (e: TerminEvent) => {
      const ok = await confirm({
        title: e.kind === "setting" ? "Lead als tot markieren?" : "Als „Kein Close“ abschließen?",
        message: `„${e.title}“ ist damit beendet. Nach der Wartezeit kommt der Lead als Wiedervorlage zurück. Rückgängig geht das nur auf der Detailseite.`,
        confirmLabel: e.kind === "setting" ? "Als tot markieren" : "Kein Close",
        destructive: true,
      });
      if (!ok) return;
      run(e, () => markTerminDead(e.kind, e.refId));
    },
    [confirm, run],
  );

  /** Ergebnis-Schnellknöpfe, falls der Termin begonnen hat und kein Ergebnis trägt — sonst `null`. */
  const ergebnisFuer = (e: TerminEvent) =>
    brauchtErgebnis({
      kind: e.kind,
      status: e.status,
      showStatus: e.showStatus,
      at: e.at,
      abgesagt: e.cancelled,
      nowMs,
    }) ? (
      <ErgebnisSchnell
        kind={e.kind}
        id={e.refId}
        onDone={() => {
          onError(null);
          router.refresh();
        }}
        onError={(m) => onError(m)}
      />
    ) : null;

  return {
    pendingFor: (e: TerminEvent) => pending && busyId === e.id,
    onGenervt,
    onNeuerTermin,
    onTot,
    ergebnisFuer,
    dialog,
  };
}
