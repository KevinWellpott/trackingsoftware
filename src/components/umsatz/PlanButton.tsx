"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { RatenplanForm } from "@/components/umsatz/RatenplanForm";
import type { GeldSicht } from "@/lib/geldSicht";

export function PlanButton({ geld, heute }: { geld: GeldSicht; heute: string }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Plan erfassen
      </Button>
      {open && (
        <Modal open onClose={close} title="Plan erfassen" subtitle={geld.name} width={580} closeOnBackdrop={false}>
          <RatenplanForm geld={geld} heute={heute} onDone={close} onCancel={close} />
        </Modal>
      )}
    </>
  );
}
