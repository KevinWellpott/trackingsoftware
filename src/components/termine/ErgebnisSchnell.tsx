"use client";

// Ergebnis-Schnellknöpfe (Prüfliste O1, O2, O5) — für Termine, die begonnen
// haben und noch kein Ergebnis tragen. Erstgespräch: Erschienen · Nicht
// erschienen. Closing: Gewonnen · Verloren · Nachfassen · Nicht erschienen.
// Alles, was mehr braucht als eine Angabe (Qualifizierung, Zahlungsart,
// Vertrag), bleibt auf der Detailseite.

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { DateTimeField } from "@/components/ui/DateTimeField";
import { AnchoredPopover, useAnchor } from "@/components/ui/AnchoredPopover";
import {
  closingErgebnis,
  closingNichtErschienen,
  settingErschienen,
  settingNichtErschienen,
} from "@/app/actions/ergebnisSchnell";
import { parseBetrag } from "@/lib/betrag";
import { CLOSING_LOST_REASON_CODES, CLOSING_LOST_REASON_LABELS, type ClosingLostReasonCode } from "@/lib/types";

type Props = {
  kind: "setting" | "closing";
  id: string;
  onDone: (text: string) => void;
  onError: (text: string) => void;
  size?: "sm" | "md";
};

const POP: React.CSSProperties = { display: "grid", gap: "var(--sp-4)", padding: "var(--sp-6)" };

export function ErgebnisSchnell({ kind, id, onDone, onError, size = "sm" }: Props) {
  const [pending, start] = useTransition();
  const { anchor: noShowAnchor, ref: noShowRef, toggle: noShowToggle, close: noShowClose } = useAnchor();
  const { anchor: wonAnchor, ref: wonRef, toggle: wonToggle, close: wonClose } = useAnchor();
  const { anchor: lostAnchor, ref: lostRef, toggle: lostToggle, close: lostClose } = useAnchor();
  const { anchor: nfAnchor, ref: nfRef, toggle: nfToggle, close: nfClose } = useAnchor();
  const [betrag, setBetrag] = useState("");
  const [grund, setGrund] = useState<ClosingLostReasonCode | "">("");
  const [nf, setNf] = useState("");

  const run = (fn: () => Promise<{ error?: string }>, text: string, close?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.error) onError(res.error);
      else {
        close?.();
        onDone(text);
      }
    });

  const nichtErschienen = (ausgang: "antwort" | "ohne_antwort" | null) =>
    run(
      () => (kind === "setting" ? settingNichtErschienen(id, ausgang) : closingNichtErschienen(id, ausgang)),
      ausgang === "ohne_antwort" ? "Nicht erschienen, keine Antwort" : "Nicht erschienen",
      noShowClose,
    );

  return (
    <span style={{ display: "inline-flex", gap: "var(--sp-2)", flexWrap: "wrap", opacity: pending ? 0.5 : 1 }}>
      {kind === "setting" ? (
        <Button size={size} variant="success" disabled={pending} onClick={() => run(() => settingErschienen(id), "Erschienen")}>
          Erschienen
        </Button>
      ) : (
        <>
          <span ref={wonRef as React.RefObject<HTMLSpanElement>}>
            <Button size={size} variant="success" disabled={pending} onClick={wonToggle}>
              Gewonnen
            </Button>
          </span>
          <span ref={lostRef as React.RefObject<HTMLSpanElement>}>
            <Button size={size} variant="secondary" disabled={pending} onClick={lostToggle}>
              Verloren
            </Button>
          </span>
          <span ref={nfRef as React.RefObject<HTMLSpanElement>}>
            <Button size={size} variant="secondary" disabled={pending} onClick={nfToggle}>
              Nachfassen
            </Button>
          </span>
        </>
      )}
      <span ref={noShowRef as React.RefObject<HTMLSpanElement>}>
        <Button size={size} variant="ghost" disabled={pending} onClick={noShowToggle}>
          Nicht erschienen
        </Button>
      </span>

      {noShowAnchor && (
        <AnchoredPopover anchor={noShowAnchor} onClose={noShowClose} label="Nicht erschienen" width={280} align="end">
          <div style={POP}>
            <div className="eyebrow eyebrow-muted">Schon eine Antwort?</div>
            <Button size="sm" variant="primary" onClick={() => nichtErschienen(null)}>
              Noch offen — nachfassen
            </Button>
            <Button size="sm" variant="secondary" onClick={() => nichtErschienen("antwort")}>
              Hat geantwortet
            </Button>
            <Button size="sm" variant="ghost" onClick={() => nichtErschienen("ohne_antwort")}>
              Keine Antwort — in die Ablage
            </Button>
          </div>
        </AnchoredPopover>
      )}
      {wonAnchor && (
        <AnchoredPopover anchor={wonAnchor} onClose={wonClose} label="Gewonnen" width={260} align="end">
          <div style={POP}>
            <div className="eyebrow eyebrow-muted">Deal-Volumen (netto, €)</div>
            <input
              className="input"
              inputMode="decimal"
              value={betrag}
              onChange={(e) => setBetrag(e.target.value)}
              placeholder="z. B. 4900"
              style={{ fontSize: 16 }}
              autoFocus
            />
            <Button
              size="sm"
              variant="success"
              onClick={() => {
                const n = parseBetrag(betrag);
                if (n === undefined) {
                  onError("Betrag nicht lesbar — z. B. 4900 oder 4.900,50.");
                  return;
                }
                run(() => closingErgebnis(id, { outcome: "gewonnen", dealVolume: n }), "Gewonnen", wonClose);
              }}
            >
              Speichern
            </Button>
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
              Zahlungsart und Vertrag auf der Detailseite.
            </span>
          </div>
        </AnchoredPopover>
      )}
      {lostAnchor && (
        <AnchoredPopover anchor={lostAnchor} onClose={lostClose} label="Verloren" width={280} align="end">
          <div style={POP}>
            <div className="eyebrow eyebrow-muted">Verlustgrund</div>
            <select className="input" value={grund} onChange={(e) => setGrund(e.target.value as ClosingLostReasonCode)} style={{ fontSize: 16 }}>
              <option value="">Bitte wählen</option>
              {CLOSING_LOST_REASON_CODES.map((c) => (
                <option key={c} value={c}>
                  {CLOSING_LOST_REASON_LABELS[c]}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="primary"
              disabled={!grund}
              onClick={() =>
                grund && run(() => closingErgebnis(id, { outcome: "verloren", lostReasonCode: grund }), "Verloren", lostClose)
              }
            >
              Speichern
            </Button>
          </div>
        </AnchoredPopover>
      )}
      {nfAnchor && (
        <AnchoredPopover anchor={nfAnchor} onClose={nfClose} label="Nachfassen" width={300} align="end">
          <div style={POP}>
            <div className="eyebrow eyebrow-muted">Nächster Kontakt</div>
            <DateTimeField value={nf} onChange={setNf} ariaLabel="Nächster Kontakt" />
            <Button
              size="sm"
              variant="primary"
              disabled={!nf}
              onClick={() => run(() => closingErgebnis(id, { outcome: "nachfassen", berlinInput: nf }), "Nachfassen", nfClose)}
            >
              Speichern
            </Button>
          </div>
        </AnchoredPopover>
      )}
    </span>
  );
}
