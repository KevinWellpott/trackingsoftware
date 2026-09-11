"use client";

import { ManualAppointmentModal } from "@/components/appointment/ManualAppointmentModal";
import { Button } from "@/components/ui/Button";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Die EINE Aktion des Termine-Bereichs — und der einzige Primär-CTA dieser
// View (DESIGN.md §3.8, COMPONENTS.md §2.1).
//
// ── Warum sie eine eigene Datei bekommt ──────────────────────────────────
// Sie steht im `actions`-Slot des `PageHeader` und damit NEBEN dem Seitentitel,
// wo der eine CTA einer View hingehört. Die Seite selbst ist eine Server
// Component; der Knopf öffnet ein Modal und braucht Zustand. Diese Hülle ist
// das kleinstmögliche Stück Client dazwischen — sie liegt bewusst nicht im
// `TermineBoard`, weil der Knopf dort in einer eigenen rechtsbündigen Zeile
// ÜBER der Filterleiste stand: eine zweite Kopfzeile neben der echten.
//
// ── Und warum er aus der Button-Familie kommt ────────────────────────────
// Vorher war er ein handgebautes <button> mit `--grad-cta` und 13px weißem
// Text. Weiß auf --orange-500 ist 2.8:1 und deshalb nur ab 14px/600 zulässig
// (DESIGN.md §3.8) — 13px war genau der ausgeschlossene Fall. `Button` liefert
// Größe, Kontrast, Press und den Touch-Bump aus dem System.
//
// Beschriftet ist er „Termin buchen" — wortgleich zur Seitenleiste, zum
// Quicklink, zum Call-Modus und zum Titel des Modals. „Termin manuell" war das
// fünfte Wort für dieselbe Sache.

export function TerminBuchenAktion() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="primary" icon={<Plus size={15} />} onClick={() => setOpen(true)}>
        Termin buchen
      </Button>
      <ManualAppointmentModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => router.refresh()}
      />
    </>
  );
}
