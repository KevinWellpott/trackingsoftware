"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export type Period = "week" | "month" | "year" | "all";

const OPTIONS: { value: Period; label: string }[] = [
  { value: "week",  label: "Diese Woche" },
  { value: "month", label: "Dieser Monat" },
  { value: "year",  label: "Dieses Jahr" },
  { value: "all",   label: "Gesamt" },
];

export function PeriodFilter({ current }: { current: Period }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function select(v: Period) {
    const params = new URLSearchParams(searchParams.toString());
    if (v === "all") params.delete("period");
    else params.set("period", v);
    startTransition(() => {
      router.push(`/?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div style={{ display: "flex", gap: "0.25rem", background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "3px", opacity: isPending ? 0.6 : 1, transition: "opacity 0.15s" }}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => select(o.value)}
          style={{
            padding: "0.3125rem 0.875rem",
            borderRadius: 7,
            border: "none",
            cursor: "pointer",
            fontSize: "0.8125rem",
            fontWeight: current === o.value ? 700 : 500,
            background: current === o.value ? "linear-gradient(135deg, #6366f1, #8b5cf6)" : "transparent",
            color: current === o.value ? "#fff" : "var(--text-muted)",
            transition: "all 0.15s",
            boxShadow: current === o.value ? "0 2px 8px rgba(99,102,241,0.35)" : "none",
            whiteSpace: "nowrap",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
