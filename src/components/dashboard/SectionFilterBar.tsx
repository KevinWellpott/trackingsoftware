"use client";

import { useState } from "react";
import { Calendar, ChevronDown, X } from "lucide-react";
import type { PitchList } from "@/lib/types";
import type { SectionFilterState } from "./useSectionFilter";

const OWNER_COLORS: Record<string, string> = { Kevin: "#818cf8", Simon: "#a78bfa", Daniel: "#34d399" };

type Props = {
  lists: PitchList[];
  period: SectionFilterState["period"];
  from: string;
  to: string;
  selectedListIds: Set<string>;
  owner: "" | "Kevin" | "Simon" | "Daniel";
  periodLabel: string;
  onPeriod: (p: SectionFilterState["period"]) => void;
  onCustom: (from: string, to: string) => void;
  onToggleList: (id: string) => void;
  onOwner: (o: "" | "Kevin" | "Simon" | "Daniel") => void;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  hideOwner?: boolean;
  hideLists?: boolean;
};

const PRESETS: { v: SectionFilterState["period"]; label: string }[] = [
  { v: "week", label: "W" },
  { v: "month", label: "M" },
  { v: "year", label: "J" },
  { v: "all", label: "∞" },
];

const pill = (active: boolean, color = "#6366f1"): React.CSSProperties => ({
  padding: "2px 8px",
  borderRadius: 99,
  border: `1px solid ${active ? color + "55" : "#27272a"}`,
  background: active ? color + "15" : "transparent",
  color: active ? color : "#52525b",
  fontSize: "0.6875rem",
  fontWeight: active ? 700 : 500,
  cursor: "pointer",
  whiteSpace: "nowrap" as const,
  transition: "all 0.1s",
});

export function SectionFilterBar({
  lists, period, from, to, selectedListIds, owner, periodLabel,
  onPeriod, onCustom, onToggleList, onOwner, onFromChange, onToChange,
  hideOwner, hideLists,
}: Props) {
  const [showDate, setShowDate] = useState(false);
  const [localFrom, setLocalFrom] = useState(from);
  const [localTo, setLocalTo] = useState(to);

  const isCustom = period === "custom";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      {/* Row 1: Period + Date */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap" }}>
        {/* Preset pills */}
        <div style={{ display: "flex", gap: "0.2rem", background: "#0d0d10", border: "1px solid #1c1c1f", borderRadius: 8, padding: "2px" }}>
          {PRESETS.map((p) => (
            <button key={p.v} type="button" onClick={() => { onPeriod(p.v); setShowDate(false); }}
              style={{ padding: "2px 7px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: "0.6875rem", fontWeight: period === p.v && !isCustom ? 800 : 500, background: period === p.v && !isCustom ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "transparent", color: period === p.v && !isCustom ? "#fff" : "#52525b", transition: "all 0.1s" }}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom date toggle */}
        <button type="button" onClick={() => setShowDate((v) => !v)}
          style={{ display: "flex", alignItems: "center", gap: "0.25rem", ...pill(isCustom || showDate), padding: "2px 7px" }}>
          <Calendar size={10} />
          {isCustom ? periodLabel : "Datum"}
          <ChevronDown size={9} style={{ transform: showDate ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
        </button>

        {/* Owner filter */}
        {!hideOwner && (
          <div style={{ display: "flex", gap: "0.2rem", marginLeft: "0.25rem" }}>
            {(["", "Kevin", "Simon", "Daniel"] as const).map((o) => (
              <button key={o || "all"} type="button" onClick={() => onOwner(o)}
                style={pill(owner === o, o ? OWNER_COLORS[o] : "#6366f1")}>
                {o || "Alle"}
              </button>
            ))}
          </div>
        )}

        {/* Active filter summary */}
        {(selectedListIds.size > 0 || owner || isCustom) && (
          <button type="button"
            onClick={() => { onPeriod("all"); onOwner(""); selectedListIds.forEach(id => onToggleList(id)); setShowDate(false); }}
            style={{ display: "flex", alignItems: "center", gap: "0.2rem", ...pill(false), marginLeft: "auto", color: "#f87171", borderColor: "rgba(248,113,113,0.25)" }}>
            <X size={9} /> Filter zurücksetzen
          </button>
        )}
      </div>

      {/* Custom date picker */}
      {showDate && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.15)", borderRadius: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.6875rem", color: "#52525b", fontWeight: 600 }}>Von</span>
          <input type="date" value={localFrom} onChange={(e) => { setLocalFrom(e.target.value); onFromChange(e.target.value); }}
            style={{ background: "#09090b", border: "1px solid #27272a", borderRadius: 6, padding: "2px 6px", fontSize: "0.75rem", color: "#fafafa", colorScheme: "dark", outline: "none" }} />
          <span style={{ fontSize: "0.6875rem", color: "#3f3f46" }}>—</span>
          <span style={{ fontSize: "0.6875rem", color: "#52525b", fontWeight: 600 }}>Bis</span>
          <input type="date" value={localTo} onChange={(e) => { setLocalTo(e.target.value); onToChange(e.target.value); }}
            style={{ background: "#09090b", border: "1px solid #27272a", borderRadius: 6, padding: "2px 6px", fontSize: "0.75rem", color: "#fafafa", colorScheme: "dark", outline: "none" }} />
          <button type="button" onClick={() => { if (localFrom && localTo) { onCustom(localFrom, localTo); setShowDate(false); } }}
            disabled={!localFrom || !localTo}
            style={{ padding: "2px 10px", borderRadius: 6, border: "none", background: localFrom && localTo ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "#18181b", color: localFrom && localTo ? "white" : "#3f3f46", fontSize: "0.6875rem", fontWeight: 700, cursor: "pointer" }}>
            Anwenden
          </button>
        </div>
      )}

      {/* Row 2: List filter */}
      {!hideLists && lists.length > 0 && (
        <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "0.5rem", fontWeight: 700, color: "#27272a", textTransform: "uppercase", letterSpacing: "0.08em" }}>LISTEN:</span>
          <button type="button" onClick={() => selectedListIds.forEach(id => onToggleList(id))}
            style={pill(selectedListIds.size === 0)}>
            Alle
          </button>
          {lists.map((l) => {
            const active = selectedListIds.has(l.id);
            const color = OWNER_COLORS[l.owner_name ?? ""] ?? "#71717a";
            return (
              <button key={l.id} type="button" onClick={() => onToggleList(l.id)} title={l.name}
                style={{ ...pill(active, color), maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>
                {active && "✓ "}
                {l.owner_name ? <span style={{ opacity: 0.6, marginRight: 2 }}>{l.owner_name[0]}</span> : null}
                {l.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
