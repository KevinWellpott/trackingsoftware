"use client";

import { useState, useTransition } from "react";
import { geldAktion } from "@/app/actions/umsatz";
import { aktionFertig } from "@/components/kunden/AktionsPuls";
import { Input } from "@/components/ui/Input";
import { Feld } from "@/components/kunden/Feld";
import { Segmented } from "@/components/ui/Segmented";
import { bruttoZuNetto } from "@/lib/finanzen";
import { formatEurGenau, parseEuro, type KundenKennzahlen } from "@/lib/umsatz";
import { vorschau, type GeldSicht } from "@/lib/geldSicht";
import type { GeldAktion } from "@/lib/geldAktion";

/** Eine Geldaktion auf dem Stand, den diese Person sieht. */
export function useGeldAktion(geld: GeldSicht) {
  const [error, setError] = useState<string | null>(null);
  const [doppelt, setDoppelt] = useState<{ text: string; fuer: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (aktion: GeldAktion, danach?: () => void) =>
    start(async () => {
      setError(null);
      setDoppelt(null);
      const r = await geldAktion(geld.id, geld.vertrag.version, aktion);
      aktionFertig();
      if (r.error) setError(r.error);
      else if (r.doppelt) setDoppelt({ text: r.doppelt, fuer: JSON.stringify({ ...aktion, trotzDoppelt: undefined }) });
      else danach?.();
    });
  return { error, doppelt, pending, run };
}

/** Deutsche Schreibweise für ein Eingabefeld, ohne Tausenderpunkt. */
export function alsEingabe(v: number | null | undefined): string {
  return v ? String(v).replace(".", ",") : "";
}

/**
 * Alles wird netto gespeichert. Wer vom Kontoauszug abschreibt, hat brutto vor
 * sich: Der Umschalter rechnet um, statt still 19 % zu viel zu buchen.
 */
export function BetragFeld({
  label,
  wert,
  onChange,
  hint,
  autoFocus,
}: {
  label: string;
  /** Immer netto. */
  wert: string;
  onChange: (netto: string) => void;
  hint?: string;
  autoFocus?: boolean;
}) {
  const [brutto, setBrutto] = useState<string | null>(null);
  const [satz, setSatz] = useState<"19" | "7">("19");

  const uebernehmen = (roh: string, s: string) => {
    const n = parseEuro(roh);
    onChange(n === null ? "" : alsEingabe(bruttoZuNetto(n, Number(s))));
  };

  return (
    <div className="ks-stapel" data-gap="eng">
      {brutto === null ? (
        <Feld label={`${label} (netto, €)`} hint={hint}>
          <Input inputMode="decimal" value={wert} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} />
        </Feld>
      ) : (
        <Feld label={`${label} (brutto, €)`} hint={wert ? `Gespeichert werden ${wert} € netto.` : "Gespeichert wird netto."}>
          <div className="ks-eingabe">
            <Input
              inputMode="decimal"
              aria-label={`${label} (brutto)`}
              value={brutto}
              autoFocus
              onChange={(e) => {
                setBrutto(e.target.value);
                uebernehmen(e.target.value, satz);
              }}
            />
            <Segmented
              options={[
                { value: "19", label: "19 %" },
                { value: "7", label: "7 %" },
              ]}
              value={satz}
              ariaLabel="Umsatzsteuersatz"
              onChange={(s) => {
                setSatz(s);
                uebernehmen(brutto, s);
              }}
            />
          </div>
        </Feld>
      )}
      <button
        type="button"
        className="ks-textknopf"
        onClick={() => {
          if (brutto !== null) return setBrutto(null);
          setBrutto("");
          onChange("");
        }}
      >
        {brutto === null ? "Brutto eingeben" : "Netto eingeben"}
      </button>
    </div>
  );
}

const ZEILEN: { label: string; von: (k: KundenKennzahlen) => number }[] = [
  { label: "Überfällig", von: (k) => k.ueberfaellig },
  { label: "Noch erwartet", von: (k) => k.kuenftig },
  { label: "Kassiert", von: (k) => k.kassiert },
  { label: "Storniert", von: (k) => k.storniert },
  { label: "Ausfall", von: (k) => k.abgeschrieben },
  { label: "Guthaben", von: (k) => k.guthaben },
  { label: "Noch ohne Rate", von: (k) => k.nichtVerplant },
  { label: "Über Vertragswert", von: (k) => k.zuvielVerplant },
];

/** Vorher und nachher, bevor irgendwer speichert (G5). */
export function VorherNachher({ geld, aktion, heute }: { geld: GeldSicht; aktion: GeldAktion; heute: string }) {
  const v = vorschau(geld, aktion, heute);
  if ("error" in v) return <p className="ks-leise">{v.error}</p>;
  const anders = ZEILEN.filter((z) => z.von(v.vorher) !== z.von(v.nachher));
  if (!anders.length) return <p className="ks-leise">An den Summen ändert sich nichts.</p>;
  return (
    <dl className="ks-vorschau" aria-live="polite">
      {anders.map((z) => (
        <div key={z.label}>
          <dt>{z.label}</dt>
          <dd>
            <span className="ks-leise">{formatEurGenau(z.von(v.vorher))}</span>
            <span aria-hidden="true"> → </span>
            {formatEurGenau(z.von(v.nachher))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
