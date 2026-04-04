"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Calendar, ChevronDown, X } from "lucide-react";

export type Period = "week" | "month" | "year" | "all" | "custom";

const PRESETS: { value: Period; label: string }[] = [
  { value: "week",  label: "Woche" },
  { value: "month", label: "Monat" },
  { value: "year",  label: "Jahr" },
  { value: "all",   label: "Gesamt" },
];

const OWNER_COLORS: Record<string, string> = {
  Kevin: "#818cf8",
  Simon: "#a78bfa",
};

type ListOption = { id: string; name: string; owner_name: string | null };

type Props = {
  lists: ListOption[];
  currentPeriod: Period;
  currentFrom: string;
  currentTo: string;
  currentListIds: string[];
};

export function FilterPanel({ lists, currentPeriod, currentFrom, currentTo, currentListIds }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [showDatePicker, setShowDatePicker] = useState(currentPeriod === "custom");
  const [fromDate, setFromDate] = useState(currentFrom);
  const [toDate, setToDate] = useState(currentTo);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(currentListIds));

  function push(params: URLSearchParams) {
    startTransition(() => {
      router.push(`/?${params.toString()}`, { scroll: false });
    });
  }

  function buildParams() {
    return new URLSearchParams(searchParams.toString());
  }

  // ── Period presets ──────────────────────────────────────────
  function selectPreset(v: Period) {
    const p = buildParams();
    p.delete("from");
    p.delete("to");
    if (v === "all") p.delete("period");
    else p.set("period", v);
    setShowDatePicker(false);
    push(p);
  }

  // ── Custom date range ────────────────────────────────────────
  function applyDateRange() {
    if (!fromDate || !toDate) return;
    const p = buildParams();
    p.set("period", "custom");
    p.set("from", fromDate);
    p.set("to", toDate);
    push(p);
  }

  function clearDateRange() {
    selectPreset("all");
    setFromDate("");
    setToDate("");
  }

  // ── List filter ──────────────────────────────────────────────
  function toggleList(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
    const p = buildParams();
    if (next.size === 0) p.delete("listIds");
    else p.set("listIds", [...next].join(","));
    push(p);
  }

  function selectAllLists() {
    setSelectedIds(new Set());
    const p = buildParams();
    p.delete("listIds");
    push(p);
  }

  const allSelected = selectedIds.size === 0;
  const isCustom = currentPeriod === "custom";
  const activePeriodExcludeCustom = isCustom ? null : currentPeriod;

  const inputStyle: React.CSSProperties = {
    background: "#09090b",
    border: "1px solid #27272a",
    borderRadius: 7,
    padding: "0.3rem 0.625rem",
    fontSize: "0.8125rem",
    color: "#fafafa",
    colorScheme: "dark",
    outline: "none",
    fontFamily: "inherit",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.625rem",
        opacity: isPending ? 0.7 : 1,
        transition: "opacity 0.15s",
      }}
    >
      {/* ── Row 1: Presets + Custom-Range button ── */}
      <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", flexWrap: "wrap" }}>
        {/* Preset pills */}
        <div style={{ display: "flex", gap: "0.2rem", background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "3px" }}>
          {PRESETS.map((o) => {
            const active = activePeriodExcludeCustom === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => selectPreset(o.value)}
                style={{
                  padding: "0.3rem 0.75rem",
                  borderRadius: 7,
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.8125rem",
                  fontWeight: active ? 700 : 500,
                  background: active ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "transparent",
                  color: active ? "#fff" : "#71717a",
                  boxShadow: active ? "0 2px 8px rgba(99,102,241,0.35)" : "none",
                  transition: "all 0.12s",
                  whiteSpace: "nowrap",
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>

        {/* Custom range toggle */}
        <button
          type="button"
          onClick={() => setShowDatePicker((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.35rem",
            padding: "0.3rem 0.75rem",
            borderRadius: "var(--radius-md)",
            border: `1px solid ${showDatePicker || isCustom ? "rgba(99,102,241,0.5)" : "var(--border)"}`,
            background: showDatePicker || isCustom ? "rgba(99,102,241,0.1)" : "var(--surface-100)",
            color: showDatePicker || isCustom ? "#818cf8" : "#71717a",
            fontSize: "0.8125rem",
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.12s",
            whiteSpace: "nowrap",
          }}
        >
          <Calendar size={13} />
          {isCustom && currentFrom && currentTo
            ? `${currentFrom.slice(5)} → ${currentTo.slice(5)}`
            : "Eigener Zeitraum"}
          <ChevronDown
            size={12}
            style={{
              transform: showDatePicker ? "rotate(180deg)" : "none",
              transition: "transform 0.15s",
            }}
          />
        </button>
      </div>

      {/* ── Row 2: Date picker (expandable) ── */}
      {showDatePicker && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.625rem",
            padding: "0.75rem 1rem",
            background: "rgba(99,102,241,0.05)",
            border: "1px solid rgba(99,102,241,0.18)",
            borderRadius: "var(--radius-md)",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
            <span style={{ fontSize: "0.75rem", color: "#52525b", fontWeight: 600 }}>Von</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ fontSize: "0.75rem", color: "#3f3f46" }}>—</div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
            <span style={{ fontSize: "0.75rem", color: "#52525b", fontWeight: 600 }}>Bis</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              style={inputStyle}
            />
          </div>
          <button
            type="button"
            onClick={applyDateRange}
            disabled={!fromDate || !toDate}
            style={{
              padding: "0.3rem 0.875rem",
              borderRadius: 7,
              border: "none",
              cursor: fromDate && toDate ? "pointer" : "not-allowed",
              fontSize: "0.8125rem",
              fontWeight: 700,
              background: fromDate && toDate
                ? "linear-gradient(135deg,#6366f1,#8b5cf6)"
                : "#18181b",
              color: fromDate && toDate ? "white" : "#52525b",
              boxShadow: fromDate && toDate ? "0 2px 8px rgba(99,102,241,0.35)" : "none",
              transition: "all 0.12s",
            }}
          >
            Anwenden
          </button>
          {isCustom && (
            <button
              type="button"
              onClick={clearDateRange}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.25rem",
                padding: "0.3rem 0.5rem",
                borderRadius: 7,
                border: "1px solid #27272a",
                cursor: "pointer",
                fontSize: "0.75rem",
                background: "transparent",
                color: "#71717a",
              }}
            >
              <X size={11} />
              Zurücksetzen
            </button>
          )}
        </div>
      )}

      {/* ── Row 3: List filter ── */}
      <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#3f3f46", textTransform: "uppercase", letterSpacing: "0.07em", flexShrink: 0, marginRight: "0.125rem" }}>
          Listen:
        </span>

        {/* Alle */}
        <ListPill
          label="Alle"
          active={allSelected}
          color="#818cf8"
          onClick={selectAllLists}
        />

        {/* Individual lists */}
        {lists.map((l) => (
          <ListPill
            key={l.id}
            label={l.name}
            active={selectedIds.has(l.id)}
            color={OWNER_COLORS[l.owner_name ?? ""] ?? "#71717a"}
            onClick={() => toggleList(l.id)}
            prefix={l.owner_name ? l.owner_name[0] : undefined}
          />
        ))}

        {/* Clear selection badge */}
        {!allSelected && (
          <button
            type="button"
            onClick={selectAllLists}
            style={{ display: "flex", alignItems: "center", gap: "0.25rem", padding: "0.1875rem 0.5rem", borderRadius: 99, border: "1px solid #27272a", background: "transparent", color: "#52525b", fontSize: "0.6875rem", cursor: "pointer" }}
          >
            <X size={10} />
            {selectedIds.size} aktiv
          </button>
        )}
      </div>
    </div>
  );
}

function ListPill({
  label, active, color, onClick, prefix,
}: {
  label: string;
  active: boolean;
  color: string;
  onClick: () => void;
  prefix?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.25rem",
        padding: "0.1875rem 0.625rem",
        borderRadius: 99,
        border: `1px solid ${active ? color + "55" : "#27272a"}`,
        background: active ? color + "18" : "transparent",
        color: active ? color : "#52525b",
        fontSize: "0.75rem",
        fontWeight: active ? 700 : 400,
        cursor: "pointer",
        transition: "all 0.12s",
        maxWidth: 160,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {prefix && (
        <span style={{ fontSize: "0.625rem", fontWeight: 800, opacity: 0.7, flexShrink: 0 }}>
          {prefix}
        </span>
      )}
      {active && <span style={{ fontSize: "0.6875rem", flexShrink: 0 }}>✓</span>}
      {label}
    </button>
  );
}
