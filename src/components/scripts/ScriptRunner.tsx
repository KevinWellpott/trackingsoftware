"use client";

import { Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

// Generischer Script-Runner: rendert ausfüllbare Script-Blöcke (Setting & Closing).
// Große, ruhige Darstellung für den Live-Call — Antworten werden lokal gehalten
// und beim Verlassen eines Feldes (Blur) als komplettes Objekt gespeichert.

export type ScriptRunnerBlock = { key: string; label: string; hint: string };

type Props = {
  blocks: ScriptRunnerBlock[];
  initial: Record<string, string>;
  onSave: (answers: Record<string, string>) => Promise<{ error?: string }>;
};

function AutoGrowTextarea({
  value,
  onChange,
  onBlur,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 88)}px`;
  }, []);

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
        overflow: "hidden",
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

export function ScriptRunner({ blocks, initial, onSave }: Props) {
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

  const filled = blocks.filter((b) => (answers[b.key] ?? "").trim().length > 0).length;
  const progressPct = blocks.length > 0 ? Math.round((filled / blocks.length) * 100) : 0;

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
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              color: "var(--text-subtle)",
            }}
          >
            Script-Fortschritt
          </span>
          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-muted)" }}>
            {filled} / {blocks.length}
          </span>
        </div>
        <div
          style={{
            height: 6,
            borderRadius: 99,
            background: "var(--surface-200)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progressPct}%`,
              borderRadius: 99,
              background: "var(--brand-500)",
              transition: "width var(--transition-slow)",
            }}
          />
        </div>
      </div>

      {error && (
        <div
          style={{
            background: "var(--color-error-bg)",
            border: "1px solid var(--color-error-border)",
            color: "var(--color-error-text)",
            borderRadius: "var(--radius-md)",
            padding: "0.625rem 0.875rem",
            fontSize: "0.8125rem",
            fontWeight: 600,
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
                  fontWeight: 800,
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
                  fontWeight: 800,
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
                    fontWeight: 700,
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
    </div>
  );
}
