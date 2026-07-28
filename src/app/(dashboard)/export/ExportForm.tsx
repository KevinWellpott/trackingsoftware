"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { ANSWER_CATEGORIES, CATEGORY_CONFIG, type AnswerCategory } from "@/lib/categories";
import { ownerColor, type OwnerColor } from "@/lib/ownerColor";

type ListOption = { id: string; name: string; owner_name: string | null; archived: boolean };

type Props = {
  lists: ListOption[];
  currentFrom: string;
  currentTo: string;
  currentOwner: string;
  currentListIds: string[];
  currentCategory: string;
};

/** "Ohne Zuordnung" bleibt neutral, echte Namen laufen über die Owner-Slots. */
function groupColor(name: string): OwnerColor {
  if (name === "Ohne Zuordnung") return { fg: "var(--text-subtle)", bg: "var(--surface-150)" };
  return ownerColor(name);
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--text-subtle)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: "0.375rem",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--surface-0)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "0.4rem 0.625rem",
  fontSize: "0.8125rem",
  color: "var(--text-primary)",
  colorScheme: "light dark",
  outline: "none",
  boxSizing: "border-box",
};

export function ExportForm({ lists, currentFrom, currentTo, currentOwner, currentListIds, currentCategory }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [from, setFrom] = useState(currentFrom);
  const [to, setTo] = useState(currentTo);
  const [owner, setOwner] = useState(currentOwner);
  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(new Set(currentListIds));
  const [category, setCategory] = useState(currentCategory);

  function apply() {
    const params = new URLSearchParams(searchParams.toString());
    if (from) params.set("from", from); else params.delete("from");
    if (to) params.set("to", to); else params.delete("to");
    if (owner) params.set("owner", owner); else params.delete("owner");
    if (selectedListIds.size > 0) params.set("listIds", [...selectedListIds].join(",")); else params.delete("listIds");
    if (category) params.set("category", category); else params.delete("category");
    startTransition(() => router.push(`/export?${params.toString()}`, { scroll: false }));
  }

  function toggleList(id: string) {
    const next = new Set(selectedListIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedListIds(next);
  }

  function reset() {
    setFrom(""); setTo(""); setOwner(""); setSelectedListIds(new Set()); setCategory("");
    startTransition(() => router.push("/export", { scroll: false }));
  }

  const owners = Array.from(
    new Set(lists.map((l) => l.owner_name).filter((o): o is string => Boolean(o))),
  );
  const unassignedLists = lists.filter((l) => !l.owner_name);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", opacity: isPending ? 0.6 : 1, transition: "opacity 0.15s" }}>

      {/* Date range */}
      <div>
        <label style={labelStyle}>Zeitraum</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
          <div>
            <div style={{ fontSize: "0.6875rem", color: "var(--text-subtle)", marginBottom: 3 }}>Von</div>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: "0.6875rem", color: "var(--text-subtle)", marginBottom: 3 }}>Bis</div>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={inputStyle} />
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
          {[
            { label: "Heute", from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) },
            { label: "Diese Woche", from: getMonday(), to: new Date().toISOString().slice(0, 10) },
            { label: "Dieser Monat", from: new Date().toISOString().slice(0, 7) + "-01", to: new Date().toISOString().slice(0, 10) },
            { label: "Dieses Jahr", from: new Date().getFullYear() + "-01-01", to: new Date().toISOString().slice(0, 10) },
            { label: "Alles", from: "", to: "" },
          ].map((preset) => (
            <button key={preset.label} type="button" onClick={() => { setFrom(preset.from); setTo(preset.to); }} style={{ padding: "2px 8px", borderRadius: "var(--r-full)", border: "1px solid var(--border)", background: from === preset.from && to === preset.to ? "var(--color-info-bg)" : "transparent", color: from === preset.from && to === preset.to ? "var(--brand-500)" : "var(--text-subtle)", fontSize: "0.6875rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Owner filter */}
      <div>
        <label style={labelStyle}>Person</label>
        <div style={{ display: "flex", gap: "0.375rem" }}>
          {["", ...owners].map((o) => {
            const oc = o ? ownerColor(o) : { fg: "var(--brand-500)", bg: "var(--color-info-bg)" };
            return (
              <button key={o || "all"} type="button" onClick={() => setOwner(o)} style={{ flex: 1, padding: "0.3rem", borderRadius: "var(--r-full)", border: `1px solid ${owner === o ? `color-mix(in srgb, ${oc.fg} 40%, transparent)` : "var(--border)"}`, background: owner === o ? oc.bg : "transparent", color: owner === o ? oc.fg : "var(--text-subtle)", fontSize: "0.8125rem", fontWeight: owner === o ? 700 : 400, cursor: "pointer", transition: "all 0.12s" }}>
                {o || "Alle"}
              </button>
            );
          })}
        </div>
      </div>

      {/* Category filter */}
      <div>
        <label style={labelStyle}>Kategorie</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
          <button type="button" onClick={() => setCategory("")} style={{ padding: "2px 8px", borderRadius: "var(--r-full)", border: `1px solid ${!category ? "var(--color-info-border)" : "var(--border)"}`, background: !category ? "var(--color-info-bg)" : "transparent", color: !category ? "var(--brand-500)" : "var(--text-subtle)", fontSize: "0.6875rem", fontWeight: !category ? 700 : 400, cursor: "pointer" }}>Alle</button>
          {ANSWER_CATEGORIES.map((cat) => {
            const cfg = CATEGORY_CONFIG[cat as AnswerCategory];
            const active = category === cat;
            return (
              <button key={cat} type="button" onClick={() => setCategory(active ? "" : cat)} style={{ padding: "2px 8px", borderRadius: "var(--r-full)", border: `1px solid ${active ? cfg.border : "var(--border)"}`, background: active ? cfg.bg : "transparent", color: active ? cfg.color : "var(--text-subtle)", fontSize: "0.6875rem", fontWeight: active ? 700 : 400, cursor: "pointer", whiteSpace: "nowrap" }}>
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* List filter */}
      <div>
        <label style={labelStyle}>Listen</label>
        <div style={{ display: "flex", gap: "0.375rem", marginBottom: "0.5rem" }}>
          <button type="button" onClick={() => setSelectedListIds(new Set())} style={{ padding: "2px 8px", borderRadius: "var(--r-full)", border: `1px solid ${selectedListIds.size === 0 ? "var(--color-info-border)" : "var(--border)"}`, background: selectedListIds.size === 0 ? "var(--color-info-bg)" : "transparent", color: selectedListIds.size === 0 ? "var(--brand-500)" : "var(--text-subtle)", fontSize: "0.6875rem", fontWeight: selectedListIds.size === 0 ? 700 : 400, cursor: "pointer" }}>Alle</button>
          {selectedListIds.size > 0 && <button type="button" onClick={() => setSelectedListIds(new Set())} style={{ padding: "2px 8px", borderRadius: "var(--r-full)", border: "1px solid var(--border)", background: "transparent", color: "var(--text-subtle)", fontSize: "0.6875rem", cursor: "pointer" }}>✕ Auswahl löschen</button>}
        </div>
        {[
          ...owners.map((o) => ({ owner: o, lists: lists.filter((l) => l.owner_name === o) })),
          ...(unassignedLists.length > 0 ? [{ owner: "Ohne Zuordnung", lists: unassignedLists }] : []),
        ].map(({ owner: ownerName, lists: ownerLists }) => ownerLists.length === 0 ? null : (
          <div key={ownerName} style={{ marginBottom: "0.5rem" }}>
            <div style={{ fontSize: "0.6875rem", color: groupColor(ownerName).fg, fontWeight: 600, marginBottom: "0.25rem" }}>{ownerName}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
              {ownerLists.map((l) => {
                const active = selectedListIds.has(l.id);
                const oc = groupColor(ownerName);
                return (
                  <button key={l.id} type="button" onClick={() => toggleList(l.id)} title={l.name} style={{ padding: "2px 8px", borderRadius: "var(--r-full)", border: `1px solid ${active ? `color-mix(in srgb, ${oc.fg} 33%, transparent)` : "var(--border)"}`, background: active ? oc.bg : "transparent", color: active ? oc.fg : "var(--text-subtle)", fontSize: "0.6875rem", fontWeight: active ? 700 : 400, cursor: "pointer", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {l.name}{l.archived ? " (archiviert)" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" onClick={apply} className="btn-primary" style={{ flex: 1 }}>
          Vorschau aktualisieren
        </button>
        <button type="button" onClick={reset} style={{ padding: "0.5rem 0.75rem", borderRadius: "var(--r-full)", border: "1px solid var(--border)", background: "transparent", color: "var(--text-subtle)", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer" }}>
          Reset
        </button>
      </div>
    </div>
  );
}

function getMonday(): string {
  const now = new Date();
  const day = now.getDay();
  now.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  return now.toISOString().slice(0, 10);
}
