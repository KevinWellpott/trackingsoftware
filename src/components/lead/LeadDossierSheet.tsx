"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { getLeadDossier, type LeadDossierResult } from "@/app/actions/leadDossier";
import type { DossierEntityKind } from "@/lib/leadDossier";
import { LeadDossierEmpty, LeadDossierPanel } from "@/components/lead/LeadDossierPanel";

// Das Dossier als Overlay über einem Board. Damit lässt es sich später aus
// /nachfassen und /erinnerungen mit zwei Zeilen öffnen (ein Zustand, ein
// <LeadDossierSheet …/>), ohne dass die Seiten dafür serverseitig etwas
// nachladen müssen.
//
// Geladen wird ERST beim Öffnen: Eine Karte, die ihr Dossier im Voraus
// mitbrächte, verteuerte jedes Board um acht Abfragen JE KARTE — gelesen wird
// aber immer nur eines.
//
// Der geladene Stand trägt seinen Lead-Schlüssel mit sich, statt beim Wechsel
// zurückgesetzt zu werden. Zwei Gründe: Ein synchrones `setState` im
// Effektkörper erzeugt eine Kaskadenrenderung (react-hooks/set-state-in-effect),
// und ohne den Schlüssel könnte die späte Antwort des vorigen Leads im Panel
// des nächsten landen.

type Props = {
  open: boolean;
  onClose: () => void;
  kind: DossierEntityKind;
  id: string;
};

export function LeadDossierSheet({ open, onClose, kind, id }: Props) {
  const [loaded, setLoaded] = useState<{ key: string; result: LeadDossierResult } | null>(null);
  const key = `${kind}:${id}`;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getLeadDossier(kind, id)
      .then((result) => {
        if (!cancelled) setLoaded({ key: `${kind}:${id}`, result });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.error("LeadDossierSheet:", e instanceof Error ? e.message : e);
        setLoaded({
          key: `${kind}:${id}`,
          result: { dossier: null, available: true, error: "Das Dossier ließ sich nicht laden." },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [open, kind, id]);

  const result = loaded?.key === key ? loaded.result : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Lead-Dossier"
      subtitle="Alles zu diesem Lead — für das Gespräch"
      width={760}
    >
      {!result ? (
        <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>Wird geladen …</p>
      ) : result.dossier ? (
        <LeadDossierPanel dossier={result.dossier} />
      ) : (
        <LeadDossierEmpty available={result.available} error={result.error} />
      )}
    </Modal>
  );
}
