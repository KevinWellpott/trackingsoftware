"use client";

// Das EINE Notizfeld an Setting und Closing (28.11.): groß, offen, speichert
// selbst — kurz nach der letzten Eingabe und beim Verlassen des Felds. Es
// ersetzt den Gesprächsleitfaden mit seinen Notizfeldern je Block.
//
// Was in diesen Blöcken schon stand (`script_answers`), geht nicht verloren:
// Es steht eingeklappt und nur lesbar darunter, solange es welches gibt.

import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, FileText } from "lucide-react";

export function NotizFeld({
  initial,
  onSave,
  fruehere = [],
  titel = "Notizen",
}: {
  initial: string | null;
  /** Speichert den Text (`null` = leer). */
  onSave: (text: string | null) => void;
  /** Einträge aus dem früheren Gesprächsleitfaden — nur lesend. */
  fruehere?: { key: string; label: string; text: string }[];
  titel?: string;
}) {
  const [text, setText] = useState(initial ?? "");
  const [stand, setStand] = useState<"leer" | "tippt" | "gespeichert">("leer");
  const gespeichert = useRef(initial ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const speichern = () => {
    if (timer.current) clearTimeout(timer.current);
    if (text === gespeichert.current) return;
    gespeichert.current = text;
    onSave(text.trim() ? text : null);
    setStand("gespeichert");
  };

  // Beim Verlassen der Seite nichts verlieren.
  const speichernRef = useRef(speichern);
  useEffect(() => {
    speichernRef.current = speichern;
  });
  useEffect(() => () => speichernRef.current(), []);

  return (
    <section className="nz-karte">
      <header className="nz-kopf">
        <FileText size={16} aria-hidden />
        <h2>{titel}</h2>
        <span className="nz-stand" data-stand={stand}>
          {stand === "gespeichert" ? (
            <>
              <Check size={13} aria-hidden /> Gespeichert
            </>
          ) : stand === "tippt" ? (
            "…"
          ) : null}
        </span>
      </header>
      <textarea
        className="nz-feld"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setStand("tippt");
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => speichernRef.current(), 900);
        }}
        onBlur={speichern}
        placeholder="Alles zum Gespräch — frei notieren…"
        aria-label={titel}
      />
      {fruehere.length > 0 && (
        <details className="nz-frueher">
          <summary>
            <ChevronRight size={13} className="collapse-chevron" aria-hidden />
            Frühere Gesprächsnotizen ({fruehere.length})
          </summary>
          <dl>
            {fruehere.map((e) => (
              <div key={e.key}>
                <dt>{e.label}</dt>
                <dd>{e.text}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </section>
  );
}
