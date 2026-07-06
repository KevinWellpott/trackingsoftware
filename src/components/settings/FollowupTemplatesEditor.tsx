"use client";

import { setFollowupTemplate } from "@/app/actions/templates";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { Check } from "lucide-react";
import { useRef, useState, useTransition } from "react";

// Editor für die persönlichen Follow-up-Vorlagen (FU1–FU3).
// Leeres Feld = Vorlage löschen → Fallback auf die Standardtexte
// (identisch zu linkedinFollowUpText in nachfassen.ts, als Placeholder sichtbar).

type Props = { initial: { fu_number: number; body: string }[] };

const FU_FIELDS: { fu: number; label: string; timing: string; placeholder: string }[] = [
  {
    fu: 1,
    label: "FU1",
    timing: "nach 3 Tagen",
    placeholder:
      "Hey {name}, ich wollte kurz nachhaken – hattest du schon die Gelegenheit, dir meine Nachricht anzuschauen?",
  },
  {
    fu: 2,
    label: "FU2",
    timing: "nach 5 Tagen",
    placeholder:
      "Hey {name}, ich weiß, es ist gerade viel los. Magst du mir kurz Bescheid geben, ob das Thema für dich grundsätzlich spannend ist?",
  },
  {
    fu: 3,
    label: "FU3",
    timing: "nach 7 Tagen",
    placeholder:
      "Hey {name}, letzter Versuch von meiner Seite – wenn es aktuell nicht passt, ist das völlig okay, dann melde ich mich in ein paar Monaten nochmal.",
  },
];

function TemplateField({
  fu,
  label,
  timing,
  placeholder,
  initialBody,
}: {
  fu: number;
  label: string;
  timing: string;
  placeholder: string;
  initialBody: string;
}) {
  const [body, setBody] = useState(initialBody);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await setFollowupTemplate(fu, body);
      if (res.error) {
        setError(res.error);
        return;
      }
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2500);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      <label
        htmlFor={`fu-template-${fu}`}
        style={{ display: "flex", alignItems: "baseline", gap: "0.375rem", fontSize: "0.8125rem" }}
      >
        <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>{label}</span>
        <span style={{ fontSize: "0.75rem", color: "var(--text-subtle)", fontWeight: 500 }}>{timing}</span>
      </label>
      <Textarea
        id={`fu-template-${fu}`}
        autoGrow
        rows={2}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setSaved(false);
        }}
        placeholder={placeholder}
      />
      <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
        <Button size="sm" variant="secondary" loading={isPending} onClick={save}>
          Speichern
        </Button>
        {saved && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.25rem",
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "var(--color-success-text)",
            }}
          >
            <Check size={12} /> Gespeichert
          </span>
        )}
        {error && (
          <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-error-text)" }}>{error}</span>
        )}
      </div>
    </div>
  );
}

export function FollowupTemplatesEditor({ initial }: Props) {
  const byFu = new Map(initial.map((t) => [t.fu_number, t.body]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.125rem" }}>
      {FU_FIELDS.map((f) => (
        <TemplateField
          key={f.fu}
          fu={f.fu}
          label={f.label}
          timing={f.timing}
          placeholder={f.placeholder}
          initialBody={byFu.get(f.fu) ?? ""}
        />
      ))}
      <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-subtle)", lineHeight: 1.5 }}>
        Platzhalter {"{name}"} wird durch den Vornamen des Leads ersetzt. Leer lassen = Standardtext.
      </p>
    </div>
  );
}
