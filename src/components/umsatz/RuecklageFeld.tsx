"use client";

import { useState } from "react";
import { setRuecklage } from "@/app/actions/umsatz";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Fehler, useAktion } from "@/components/kunden/bausteine";

export function RuecklageFeld({ prozent }: { prozent: number }) {
  const start = String(prozent).replace(".", ",");
  const [wert, setWert] = useState(start);
  const { error, pending, run } = useAktion();
  return (
    <div className="ks-reihe">
      <label className="ks-prozent">
        Steuerrücklage
        <Input inputMode="decimal" value={wert} onChange={(e) => setWert(e.target.value)} />%
      </label>
      {wert !== start && (
        <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => setRuecklage(wert))}>
          Speichern
        </Button>
      )}
      <Fehler text={error} />
    </div>
  );
}
