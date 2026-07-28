"use client";

import { Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

// Generischer Script-Runner: rendert ausfüllbare Script-Blöcke (Setting & Closing).
// Große, ruhige Darstellung für den Live-Call — Antworten werden lokal gehalten
// und beim Verlassen eines Feldes (Blur) als komplettes Objekt gespeichert.

export type ScriptRunnerBlock = { key: string; label: string; hint: string };

type Props = {
  blocks: ScriptRunnerBlock[];
  /**
   * Optionaler hervorgehobener Abschnitt unter dem Verlauf — z. B. die
   * Gold Standards des Settings. 2x2-Raster mit Akzent-Rahmen; zaehlt in
   * den Fortschritt mit.
   */
  highlight?: { title: string; blocks: ScriptRunnerBlock[] };
  initial: Record<string, string>;
  onSave: (answers: Record<string, string>) => Promise<{ error?: string }>;
};

function AutoGrowTextarea({
  value,
  onChange,
  onBlur,
  placeholder,
  fixed = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  placeholder?: string;
  /**
   * Feste Hoehe statt Mitwachsen. Im 2x2-Raster der Gold Standards muessen
   * alle vier Felder exakt gleich hoch bleiben — mitwachsende Boxen
   * zerreissen das Raster, sobald eine Antwort laenger ist als die anderen.
   */
  fixed?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    if (fixed) return;
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 88)}px`;
  }, [fixed]);

  useEffect(() => {
    resize();
  }, [value, resize]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      rows={3}
      style={{
        width: "100%",
        boxSizing: "border-box",
        resize: "none",
        ...(fixed ? { flex: 1, minHeight: 88, overflow: "auto" } : { overflow: "hidden" }),
        background: "var(--surface-50)",
        border: "1px solid var(--border-bright)",
        borderRadius: "var(--radius-md)",
        padding: "0.875rem 1rem",
        fontSize: "0.9375rem",
        lineHeight: 1.6,
        color: "var(--text-primary)",
        outline: "none",
        fontFamily: "inherit",
        transition: "border-color var(--transition-fast), box-shadow var(--transition-fast)",
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = "var(--border-focus)";
        e.currentTarget.style.boxShadow = "var(--glow-sm)";
      }}
      onBlurCapture={(e) => {
        e.currentTarget.style.borderColor = "var(--border-bright)";
        e.currentTarget.style.boxShadow = "none";
      }}
    />
  );
}

export function ScriptRunner({ blocks, highlight, initial, onSave }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>(() => ({ ...initial }));
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const lastSavedRef = useRef<string>(JSON.stringify(initial ?? {}));
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  // Fortschritt zaehlt Verlauf UND Gold Standards — beides gehoert zum Call.
  const allBlocks = highlight ? [...blocks, ...highlight.blocks] : blocks;
  const filled = allBlocks.filter((b) => (answers[b.key] ?? "").trim().length > 0).length;
  const progressPct = allBlocks.length > 0 ? Math.round((filled / allBlocks.length) * 100) : 0;

  function handleBlur(key: string) {
    const merged = { ...answers };
    const snapshot = JSON.stringify(merged);
    if (snapshot === lastSavedRef.current) return;
    startTransition(async () => {
      const res = await onSave(merged);
      if (res?.error) {
        setError(res.error);
        return;
      }
      lastSavedRef.current = snapshot;
      setError(null);
      setSavedKey(key);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSavedKey(null), 2200);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* ── Fortschritt ── */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: "0.375rem",
          }}
        >
          <span
            style={{
              fontSize: "0.6875rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              color: "var(--text-subtle)",
            }}
          >
            Script-Fortschritt
          </span>
          <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)" }}>
            {filled} / {allBlocks.length}
          </span>
        </div>
        <div
          className="progress-track"
        >
          <div className="progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            background: "var(--danger-bg)",
            borderLeft: "2px solid var(--danger)",
            color: "var(--danger-fg)",
            borderRadius: "var(--r-sm)",
            padding: "var(--sp-5) var(--sp-6)",
            fontSize: "var(--fs-base)",
          }}
        >
          Speichern fehlgeschlagen: {error}
        </div>
      )}

      {/* ── Blöcke ── */}
      {blocks.map((block, idx) => {
        const value = answers[block.key] ?? "";
        const hasContent = value.trim().length > 0;
        return (
          <section key={block.key}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                marginBottom: "0.25rem",
              }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  background: hasContent ? "var(--color-success-bg)" : "var(--surface-200)",
                  border: `1px solid ${hasContent ? "var(--color-success-border)" : "var(--border)"}`,
                  color: hasContent ? "var(--color-success-text)" : "var(--text-subtle)",
                }}
              >
                {hasContent ? <Check size={12} strokeWidth={3} /> : idx + 1}
              </span>
              <span
                style={{
                  fontSize: "1rem",
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                  color: "var(--text-primary)",
                }}
              >
                {block.label}
              </span>
              {savedKey === block.key && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.25rem",
                    fontSize: "0.6875rem",
                    fontWeight: 600,
                    color: "var(--color-success-text)",
                  }}
                >
                  <Check size={11} strokeWidth={3} /> gespeichert
                </span>
              )}
            </div>
            <p
              style={{
                fontSize: "0.8125rem",
                lineHeight: 1.5,
                color: "var(--text-muted)",
                whiteSpace: "pre-line",
                margin: "0 0 0.5rem 1.875rem",
              }}
            >
              {block.hint}
            </p>
            <div style={{ marginLeft: "1.875rem" }}>
              <AutoGrowTextarea
                value={value}
                onChange={(v) => setAnswers((prev) => ({ ...prev, [block.key]: v }))}
                onBlur={() => handleBlur(block.key)}
                placeholder="Antwort notieren…"
              />
            </div>
          </section>
        );
      })}

      {/* ── Gold Standards ──
          Kein Erzaehlschritt, sondern eine Checkliste: eigener Kasten mit
          Akzent-Rahmen, 2x2, kompaktere Koepfe als im Verlauf. */}
      {highlight && highlight.blocks.length > 0 && (
        <section className="gold-block">
          <div className="eyebrow" style={{ marginBottom: "var(--sp-6)" }}>
            {highlight.title}
          </div>
          <div className="gold-grid">
            {highlight.blocks.map((block) => {
              const value = answers[block.key] ?? "";
              const hasContent = value.trim().length > 0;
              return (
                // Flex-Spalte + flex:1 auf dem Feld: der Kopf nimmt seine
                // Hoehe, den Rest fuellt die Textbox. Zusammen mit
                // grid-auto-rows:1fr stehen alle vier Zellen exakt gleich hoch.
                <div key={block.key} style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                    <span
                      aria-hidden
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: "var(--r-full)",
                        flexShrink: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: hasContent ? "var(--accent-muted)" : "transparent",
                        border: `1px solid ${hasContent ? "var(--border-accent)" : "var(--border-default)"}`,
                        color: "var(--orange-300)",
                      }}
                    >
                      {hasContent && <Check size={10} strokeWidth={3} />}
                    </span>
                    <span
                      style={{
                        fontSize: "var(--fs-md)",
                        fontWeight: 600,
                        letterSpacing: "var(--ls-tight)",
                        color: "var(--text-primary)",
                      }}
                    >
                      {block.label}
                    </span>
                    {savedKey === block.key && (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.25rem",
                          fontSize: "var(--fs-2xs)",
                          color: "var(--success-fg)",
                        }}
                      >
                        <Check size={11} strokeWidth={3} /> gespeichert
                      </span>
                    )}
                  </div>
                  <p
                    style={{
                      fontSize: "0.8125rem",
                      lineHeight: 1.5,
                      color: "var(--text-muted)",
                      margin: "0 0 0.5rem",
                    }}
                  >
                    {block.hint}
                  </p>
                  <AutoGrowTextarea
                    fixed
                    value={value}
                    onChange={(v) => setAnswers((prev) => ({ ...prev, [block.key]: v }))}
                    onBlur={() => handleBlur(block.key)}
                    placeholder="Antwort notieren…"
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
