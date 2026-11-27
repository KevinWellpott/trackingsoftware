"use client";

import { useLayoutEffect, useRef, useState } from "react";

// Segmented-Control: Kapsel (Mulde) mit gleitendem Glas-Daumen unter dem
// aktiven Segment. Der aktive Text bleibt Text 1 — Orange ist Aktion, nicht
// Auswahl. Pfeiltasten wechseln Segmente.
// Optik in globals.css (.ui-segmented, .ui-seg-thumb); Touch-Bump (≥44px)
// ueber `.ui-segmented button`.

export type SegmentedOption<T extends string> = { value: T; label: string };

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "sm",
  ariaLabel,
  fullWidth = false,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  ariaLabel?: string;
  fullWidth?: boolean;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  // Den Daumen an das aktive Segment legen — und neu messen, wenn sich die
  // Kapsel veraendert (Schrift geladen, Breite umgebrochen, Zaehler gewachsen).
  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const measure = () => {
      const active = group.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      const next = active ? { left: active.offsetLeft, width: active.offsetWidth } : null;
      setThumb((prev) =>
        prev && next && prev.left === next.left && prev.width === next.width ? prev : next,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(group);
    return () => ro.disconnect();
  }, [value, options]);

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = (index + dir + options.length) % options.length;
    onChange(options[next].value);
  }

  return (
    <div
      ref={groupRef}
      className="ui-segmented"
      role="group"
      aria-label={ariaLabel}
      data-size={size}
      data-full={fullWidth ? "" : undefined}
      data-thumb={thumb ? "" : undefined}
    >
      {thumb && (
        <span className="ui-seg-thumb" aria-hidden="true" style={{ left: thumb.left, width: thumb.width }} />
      )}
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
