"use client";

import Link from "next/link";
import { useState } from "react";
import { updateKunde } from "@/app/actions/kunden";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Feld } from "@/components/kunden/Feld";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Fehler, useAktion } from "@/components/kunden/bausteine";
import { KUNDEN_STATUS, KUNDEN_STATUS_LABELS, type Kunde, type KundenStatus, type TeamMitglied } from "@/lib/kunden";

export function ZustaendigSelect({
  kundeId,
  wert,
  team,
}: {
  kundeId: string;
  wert: string | null;
  team: TeamMitglied[];
}) {
  const { error, pending, run } = useAktion();
  return (
    <div className="ks-zustaendig" aria-busy={pending}>
      <Select
        value={wert ?? ""}
        ariaLabel="Zuständig"
        onChange={(v) => run(() => updateKunde(kundeId, { betreuer_user_id: v || null }))}
        options={[
          { value: "", label: "Niemand zuständig" },
          ...team.filter((t) => t.zuordenbar).map((t) => ({ value: t.user_id, label: `Zuständig: ${t.username}` })),
        ]}
      />
      <Fehler text={error} />
    </div>
  );
}

export function SteckbriefKarte({ kunde }: { kunde: Kunde }) {
  const [text, setText] = useState(kunde.steckbrief ?? "");
  const { error, pending, run } = useAktion();
  const geaendert = text !== (kunde.steckbrief ?? "");
  return (
    <Card>
      <CardHeader title="Steckbrief" meta="Was man wissen muss, bevor man übernimmt." />
      <div className="ks-stapel" data-gap="eng">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          autoGrow
          aria-label="Steckbrief"
          placeholder="Ausgangslage, Ziel, Angebot, Besonderheiten im Umgang"
        />
        <Fehler text={error} />
        {geaendert && (
          <div className="ks-dialog-fuss">
            <Button variant="secondary" loading={pending} onClick={() => run(() => updateKunde(kunde.id, { steckbrief: text }))}>
              Speichern
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

export function StammdatenKarte({
  kunde,
  orgs,
  kundenOrg,
  darfZuordnen,
  closing,
}: {
  kunde: Kunde;
  orgs: { id: string; name: string }[];
  kundenOrg: { id: string; name: string } | null;
  darfZuordnen: boolean;
  closing: { id: string; label: string } | null;
}) {
  const start = {
    name: kunde.name,
    firma: kunde.firma ?? "",
    email: kunde.email ?? "",
    telefon: kunde.telefon ?? "",
    status: kunde.status as string,
    org: kunde.kunden_workspace_id ?? "",
  };
  const [f, setF] = useState(start);
  const { error, pending, run } = useAktion();
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const geaendert = (Object.keys(start) as (keyof typeof start)[]).some((k) => f[k] !== start[k]);
  const ende = (f.status === "gekuendigt" || f.status === "abgesprungen") && f.status !== kunde.status;

  const orgOptionen = [
    { value: "", label: "Keine" },
    ...(kundenOrg && !orgs.some((o) => o.id === kundenOrg.id) ? [{ value: kundenOrg.id, label: kundenOrg.name }] : []),
    ...orgs.map((o) => ({ value: o.id, label: o.name })),
  ];

  return (
    <Card>
      <CardHeader
        title="Stammdaten"
        meta={
          closing ? (
            <Link href={`/closing/${closing.id}`} className="ks-link">
              {closing.label}
            </Link>
          ) : undefined
        }
      />
      <div className="ks-stapel" data-gap="eng">
        <div className="ks-felder" data-schmal="true">
          <Feld label="Name">
            <Input value={f.name} onChange={(e) => set("name", e.target.value)} />
          </Feld>
          <Feld label="Firma">
            <Input value={f.firma} onChange={(e) => set("firma", e.target.value)} />
          </Feld>
          <Feld label="E-Mail">
            <Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
          </Feld>
          <Feld label="Telefon">
            <Input type="tel" value={f.telefon} onChange={(e) => set("telefon", e.target.value)} />
          </Feld>
          <Feld label="Status">
            <Select
              value={f.status}
              onChange={(v) => set("status", v)}
              // Kündigung und Abbruch gehören zu den Finanzrechten (kunden_guard).
              disabled={!darfZuordnen && (kunde.status === "gekuendigt" || kunde.status === "abgesprungen")}
              options={KUNDEN_STATUS.filter(
                (s) => darfZuordnen || s === kunde.status || (s !== "gekuendigt" && s !== "abgesprungen"),
              ).map((s) => ({ value: s, label: KUNDEN_STATUS_LABELS[s] }))}
            />
          </Feld>
          {darfZuordnen && (
            <Feld label="Organisation in der Software">
              <Select value={f.org} onChange={(v) => set("org", v)} options={orgOptionen} />
            </Feld>
          )}
        </div>
        {ende && (
          <p className="ks-warnung">
            Der Status allein ändert keine Raten. Kündigung und Abbruch erfasst ein Admin im Reiter „Zahlungen“.
          </p>
        )}
        <Fehler text={error} />
        {geaendert && (
          <div className="ks-dialog-fuss">
            <Button
              variant="secondary"
              loading={pending}
              onClick={() =>
                run(() =>
                  updateKunde(kunde.id, {
                    name: f.name,
                    firma: f.firma,
                    email: f.email,
                    telefon: f.telefon,
                    status: f.status as KundenStatus,
                    ...(darfZuordnen && f.org !== start.org ? { kunden_workspace_id: f.org || null } : {}),
                  }),
                )
              }
            >
              Speichern
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
