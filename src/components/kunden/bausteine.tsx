"use client";

import { useOptimistic, useState, useTransition, type ReactNode } from "react";
import { CornerDownLeft, Square, SquareCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { aktionFertig } from "@/components/kunden/AktionsPuls";
import { Textarea } from "@/components/ui/Textarea";

// Kleine Client-Bausteine des Kundenspace.
//
// Der Haken reagiert SOFORT (useOptimistic) und springt bei einem Fehler mit
// Meldung zurück. Server Actions laufen in Next nacheinander: Wer fünf Punkte
// schnell abhakt, sieht fünf Haken, gespeichert wird der Reihe nach.

export function useAktion() {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>, danach?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      aktionFertig();
      if (r.error) setError(r.error);
      else danach?.();
    });
  return { error, pending, run };
}

export function Fehler({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div role="alert" className="ks-fehler">
      {text}
    </div>
  );
}

export function Haken({
  an,
  label,
  onSetzen,
  children,
}: {
  an: boolean;
  /** Für Screenreader: worum es geht. */
  label: string;
  onSetzen: (an: boolean) => Promise<{ error?: string }>;
  children: ReactNode;
}) {
  const [sichtbar, setSichtbar] = useOptimistic(an);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  return (
    <div className="ks-haken-huelle">
      <button
        type="button"
        role="checkbox"
        aria-checked={sichtbar}
        aria-label={label}
        className="ks-haken"
        onClick={() =>
          start(async () => {
            const neu = !sichtbar;
            setSichtbar(neu);
            setError(null);
            const r = await onSetzen(neu);
            aktionFertig();
            if (r.error) setError(r.error);
          })
        }
      >
        {sichtbar ? <SquareCheck size={18} aria-hidden /> : <Square size={18} aria-hidden />}
        <span className="ks-haken-text">{children}</span>
      </button>
      <Fehler text={error} />
    </div>
  );
}

/** Tippen + Enter. Mehrere eingefügte Zeilen werden mehrere Punkte. */
export function ZeilenEingabe({
  placeholder,
  label,
  onAdd,
}: {
  placeholder: string;
  label: string;
  onAdd: (text: string) => Promise<{ error?: string }>;
}) {
  const [text, setText] = useState("");
  const { error, pending, run } = useAktion();
  const absenden = () => {
    if (!text.trim() || pending) return;
    run(() => onAdd(text), () => setText(""));
  };
  return (
    <div className="ks-stapel" data-gap="eng">
      <div className="ks-eingabe">
        <Textarea
          value={text}
          rows={1}
          autoGrow
          readOnly={pending}
          aria-label={label}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            absenden();
          }}
        />
        <Button variant="secondary" loading={pending} disabled={!text.trim()} onClick={absenden} icon={<CornerDownLeft size={14} aria-hidden />}>
          Hinzufügen
        </Button>
      </div>
      <Fehler text={error} />
    </div>
  );
}

export function DialogFuss({
  label,
  pending,
  onClose,
  onSubmit,
  disabled,
  destructive,
}: {
  label: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <div className="ui-modal-actions ks-dialog-fuss">
      <Button variant="ghost" onClick={onClose}>
        Abbrechen
      </Button>
      <Button variant={destructive ? "danger" : "primary"} loading={pending} disabled={disabled} onClick={onSubmit}>
        {label}
      </Button>
    </div>
  );
}
