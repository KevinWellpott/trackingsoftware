"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { createKunde } from "@/app/actions/kunden";
import { aktionFertig } from "@/components/kunden/AktionsPuls";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Feld } from "@/components/kunden/Feld";
import { Select } from "@/components/ui/Select";
import { DialogFuss, Fehler } from "@/components/kunden/bausteine";
import type { TeamMitglied } from "@/lib/kunden";

// Ein Kunde entsteht von selbst, wenn ein Closing gewonnen wird. Dieser Knopf
// ist für alles, was nie durch die Software lief.

export function KundeAnlegenButton({ team, darfZuordnen }: { team: TeamMitglied[]; darfZuordnen: boolean }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", firma: "", email: "", telefon: "", betreuer: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await createKunde({
        name: f.name,
        firma: f.firma,
        email: f.email,
        telefon: f.telefon,
        betreuer_user_id: f.betreuer || null,
      });
      aktionFertig();
      if (r.error || !r.id) setError(r.error ?? "Anlegen fehlgeschlagen.");
      else router.push(`/kunden/${r.id}`);
    });

  return (
    <>
      <Button variant="primary" icon={<UserPlus size={15} aria-hidden />} onClick={() => setOpen(true)}>
        Kunde anlegen
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Kunde anlegen" subtitle="Für Kunden ohne gewonnenes Closing in der Software.">
        <div className="ks-stapel">
          <Feld label="Name">
            <Input value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus />
          </Feld>
          <Feld label="Firma">
            <Input value={f.firma} onChange={(e) => set("firma", e.target.value)} />
          </Feld>
          <div className="ks-felder">
            <Feld label="E-Mail">
              <Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
            </Feld>
            <Feld label="Telefon">
              <Input type="tel" value={f.telefon} onChange={(e) => set("telefon", e.target.value)} />
            </Feld>
          </div>
          {darfZuordnen && (
            <Feld label="Zuständig" hint="Eine Person für Meetings und Zahlungen.">
              <Select
                value={f.betreuer}
                onChange={(v) => set("betreuer", v)}
                options={[
                  { value: "", label: "Niemand" },
                  ...team.filter((t) => t.zuordenbar).map((t) => ({ value: t.user_id, label: t.username })),
                ]}
              />
            </Feld>
          )}
          <Fehler text={error} />
          <DialogFuss label="Anlegen" pending={pending} disabled={!f.name.trim()} onClose={() => setOpen(false)} onSubmit={submit} />
        </div>
      </Modal>
    </>
  );
}
