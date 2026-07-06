"use client";

import { useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Lock, X } from "lucide-react";
import { Segmented } from "@/components/ui/Segmented";
import { ownerColor, ownerInitials } from "@/lib/ownerColor";
import type { AnalyseTab, Granularity, QuelleKey, RangeKey } from "@/lib/analyse";

// Sticky Client-Filterleiste des Analyse-Bereichs: Flow-Tabs, Zeitraum (Presets
// + eigener Bereich), Granularität, Nutzer-Vergleich, optionale Quelle und eine
// entfernbare Aktiv-Filter-Chipzeile. Schreibt nur die geänderten Keys in die
// URL (Mechanik wie PeriodSwitcher).

const TAB_OPTIONS: { value: AnalyseTab; label: string }[] = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "telefon", label: "Telefon" },
  { value: "setting", label: "Setting" },
  { value: "closing", label: "Closing" },
  { value: "funnel", label: "Funnel" },
];

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: "w", label: "Diese Woche" },
  { value: "m", label: "Dieser Monat" },
  { value: "30", label: "30 Tage" },
  { value: "q", label: "Quartal" },
  { value: "j", label: "Jahr" },
  { value: "custom", label: "Eigener" },
];

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "tag", label: "Tag" },
  { value: "woche", label: "Woche" },
  { value: "monat", label: "Monat" },
];

const QUELLE_OPTIONS: { value: QuelleKey; label: string }[] = [
  { value: "alle", label: "Alle" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "telefon", label: "Telefon" },
];

const QUELLE_LABEL: Record<QuelleKey, string> = {
  alle: "Alle",
  linkedin: "LinkedIn",
  telefon: "Telefon",
};

const DATE_INPUT_STYLE = {
  padding: "0.375rem 0.5rem",
  fontSize: "0.8125rem",
  fontFamily: "inherit",
  color: "var(--text-primary)",
  background: "var(--surface-100)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
} as const;

/** YYYY-MM-DD → DD.MM.YYYY (zeitzonensicher, ohne Date-Parsing). */
function deDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/** YYYY-MM-DD → DD.MM. (Kurzform für Chips). */
function deDateShort(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}.${m}.`;
}

/** Small-Caps-Beschriftung vor einer Kontrollgruppe. */
function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: "0.625rem",
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--text-subtle)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** Entfernbarer Aktiv-Filter-Chip (× am Ende). */
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Filter entfernen: ${label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.375rem",
        padding: "0.25rem 0.625rem",
        fontSize: "0.75rem",
        fontWeight: 500,
        fontFamily: "inherit",
        cursor: "pointer",
        borderRadius: 99,
        whiteSpace: "nowrap",
        background: "var(--surface-150)",
        color: "var(--text-muted)",
        border: "1px solid var(--border)",
        transition: "background var(--transition-fast), color var(--transition-fast)",
      }}
    >
      {label}
      <X size={11} aria-hidden />
    </button>
  );
}

export function AnalyseFilterBar({
  tab,
  rangeKey,
  von,
  bis,
  from,
  to,
  quelle,
  granularity,
  selectedUserIds,
  users,
  canCompare,
  showQuelle,
  selfName,
}: {
  tab: AnalyseTab;
  rangeKey: RangeKey;
  von: string;
  bis: string;
  from: string;
  to: string;
  quelle: QuelleKey;
  granularity: Granularity;
  selectedUserIds: string[];
  users: { user_id: string; username: string }[];
  canCompare: boolean;
  showQuelle: boolean;
  selfName?: string;
}) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [customVon, setCustomVon] = useState(von);
  const [customBis, setCustomBis] = useState(bis);

  function commit(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(sp.toString());
    mutate(params);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  function selectTab(next: AnalyseTab) {
    commit((p) => {
      p.set("tab", next);
      // Quelle ist nur für Setting/Funnel relevant.
      if (next !== "setting" && next !== "funnel") p.delete("quelle");
    });
  }

  function selectRange(next: RangeKey) {
    commit((p) => {
      p.set("range", next);
      if (next !== "custom") {
        p.delete("von");
        p.delete("bis");
      }
    });
  }

  function commitCustom(v: string, b: string) {
    if (!v || !b || v > b) return;
    commit((p) => {
      p.set("range", "custom");
      p.set("von", v);
      p.set("bis", b);
    });
  }

  function resetRange() {
    commit((p) => {
      p.set("range", "m");
      p.delete("von");
      p.delete("bis");
    });
  }

  function selectGranularity(next: Granularity) {
    commit((p) => {
      if (next === "auto") p.delete("g");
      else p.set("g", next);
    });
  }

  function clearUsers() {
    commit((p) => p.delete("users"));
  }

  function toggleUser(id: string) {
    const set = new Set(selectedUserIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    const joined = [...set].join(",");
    commit((p) => {
      if (joined) p.set("users", joined);
      else p.delete("users");
    });
  }

  function selectQuelle(next: QuelleKey) {
    commit((p) => p.set("quelle", next));
  }

  function clearQuelle() {
    commit((p) => p.delete("quelle"));
  }

  const allActive = selectedUserIds.length === 0;
  const nameById = new Map(users.map((u) => [u.user_id, u.username]));
  const quelleActive = showQuelle && quelle !== "alle";
  const hasActiveFilters = rangeKey === "custom" || selectedUserIds.length > 0 || quelleActive;

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 30,
        padding: "0.625rem 0.125rem 0.75rem",
        background: "color-mix(in srgb, var(--surface-0) 86%, transparent)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        borderBottom: "1px solid var(--border)",
        opacity: isPending ? 0.6 : 1,
        transition: "opacity var(--transition-fast)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
        {/* Row 1: Flow-Tabs */}
        <div style={{ display: "flex", gap: "0.25rem", overflowX: "auto" }}>
          {TAB_OPTIONS.map((t) => {
            const active = t.value === tab;
            return (
              <button
                key={t.value}
                type="button"
                aria-pressed={active}
                onClick={() => selectTab(t.value)}
                style={{
                  flexShrink: 0,
                  padding: "0.375rem 0.875rem",
                  fontSize: "0.8125rem",
                  fontWeight: active ? 600 : 500,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  borderRadius: 99,
                  whiteSpace: "nowrap",
                  background: active ? "var(--btn-primary-bg)" : "transparent",
                  color: active ? "var(--btn-primary-fg)" : "var(--text-muted)",
                  border: active ? "1px solid var(--btn-primary-bg)" : "1px solid var(--border)",
                  transition: "background var(--transition-fast), color var(--transition-fast)",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Row 2: Zeitraum · Granularität · Nutzer · Quelle */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem 1.125rem", flexWrap: "wrap" }}>
          {/* Zeitraum */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <GroupLabel>Zeitraum</GroupLabel>
            <Segmented<RangeKey> options={RANGE_OPTIONS} value={rangeKey} onChange={selectRange} size="sm" ariaLabel="Zeitraum" />
            {rangeKey === "custom" && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
                <input
                  type="date"
                  value={customVon}
                  onChange={(e) => {
                    setCustomVon(e.target.value);
                    commitCustom(e.target.value, customBis);
                  }}
                  style={DATE_INPUT_STYLE}
                  aria-label="Von"
                />
                <span style={{ color: "var(--text-subtle)" }}>–</span>
                <input
                  type="date"
                  value={customBis}
                  onChange={(e) => {
                    setCustomBis(e.target.value);
                    commitCustom(customVon, e.target.value);
                  }}
                  style={DATE_INPUT_STYLE}
                  aria-label="Bis"
                />
              </div>
            )}
            <span style={{ fontSize: "0.75rem", color: "var(--text-subtle)", whiteSpace: "nowrap" }}>
              {deDate(from)} → {deDate(to)}
            </span>
          </div>

          {/* Granularität */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
            <GroupLabel>Granularität</GroupLabel>
            <Segmented<Granularity>
              options={GRANULARITY_OPTIONS}
              value={granularity}
              onChange={selectGranularity}
              size="sm"
              ariaLabel="Granularität"
            />
          </div>

          {/* Nutzer */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <GroupLabel>Nutzer</GroupLabel>
            {canCompare ? (
              <div style={{ display: "inline-flex", gap: "0.375rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  aria-pressed={allActive}
                  onClick={clearUsers}
                  style={{
                    padding: "0.3125rem 0.75rem",
                    fontSize: "0.75rem",
                    fontWeight: allActive ? 700 : 500,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    borderRadius: 99,
                    whiteSpace: "nowrap",
                    background: allActive ? "var(--btn-primary-bg)" : "transparent",
                    color: allActive ? "var(--btn-primary-fg)" : "var(--text-muted)",
                    border: allActive ? "1px solid var(--btn-primary-bg)" : "1px solid var(--border)",
                  }}
                >
                  Alle
                </button>
                {users.map((u) => {
                  const selected = selectedUserIds.includes(u.user_id);
                  const c = ownerColor(u.username);
                  return (
                    <button
                      key={u.user_id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleUser(u.user_id)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.375rem",
                        padding: "0.25rem 0.625rem 0.25rem 0.25rem",
                        fontSize: "0.75rem",
                        fontWeight: selected ? 700 : 500,
                        fontFamily: "inherit",
                        cursor: "pointer",
                        borderRadius: 99,
                        whiteSpace: "nowrap",
                        background: selected ? c.bg : "transparent",
                        color: selected ? "var(--text-primary)" : "var(--text-muted)",
                        border: selected ? `2px solid ${c.fg}` : "1px solid var(--border)",
                      }}
                    >
                      <span
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          background: c.bg,
                          color: c.fg,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "0.625rem",
                          fontWeight: 800,
                          flexShrink: 0,
                        }}
                      >
                        {ownerInitials(u.username)}
                      </span>
                      {u.username}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.375rem",
                  padding: "0.3125rem 0.75rem",
                  fontSize: "0.75rem",
                  color: "var(--text-muted)",
                  borderRadius: 99,
                  border: "1px solid var(--border)",
                  whiteSpace: "nowrap",
                }}
              >
                <Lock size={11} />
                {selfName} · Nur eigene Daten
              </div>
            )}
          </div>

          {/* Quelle */}
          {showQuelle && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
              <GroupLabel>Quelle</GroupLabel>
              <Segmented<QuelleKey> options={QUELLE_OPTIONS} value={quelle} onChange={selectQuelle} size="sm" ariaLabel="Quelle" />
            </div>
          )}
        </div>

        {/* Row 3: Aktive Filter (entfernbar) */}
        {hasActiveFilters && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap" }}>
            <GroupLabel>Aktive Filter</GroupLabel>
            {rangeKey === "custom" && (
              <FilterChip label={`${deDateShort(from)}–${deDateShort(to)}`} onRemove={resetRange} />
            )}
            {selectedUserIds.map((id) => (
              <FilterChip key={id} label={nameById.get(id) ?? id} onRemove={() => toggleUser(id)} />
            ))}
            {quelleActive && (
              <FilterChip label={`Quelle: ${QUELLE_LABEL[quelle]}`} onRemove={clearQuelle} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
