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
  { value: "manuell", label: "Manuell" },
];

const QUELLE_LABEL: Record<QuelleKey, string> = {
  alle: "Alle",
  linkedin: "LinkedIn",
  telefon: "Telefon",
  manuell: "Manuell",
};

const DATE_INPUT_STYLE = {
  height: "var(--h-control)",
  padding: "0 var(--sp-5)",
  fontSize: "var(--fs-sm)",
  fontFamily: "inherit",
  fontVariantNumeric: "tabular-nums",
  color: "var(--text-primary)",
  background: "var(--surface-1)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--r-md)",
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

/** Eyebrow-Beschriftung vor einer Kontrollgruppe. */
function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <span className="eyebrow eyebrow-muted" style={{ whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

/**
 * Aktiver Filter-Chip (COMPONENTS.md §12): 28px-Pill, Akzent-Tint,
 * Border --border-accent, Text --orange-300, X zum Entfernen.
 * Aktive Filter sind IMMER sichtbar — nie in Menues versteckt.
 */
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Filter entfernen: ${label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        height: 28,
        padding: "0 var(--sp-5)",
        fontSize: "var(--fs-sm)",
        fontWeight: 500,
        fontFamily: "inherit",
        cursor: "pointer",
        borderRadius: "var(--r-full)",
        whiteSpace: "nowrap",
        background: "var(--accent-muted)",
        color: "var(--orange-300)",
        border: "1px solid var(--border-accent)",
        transition: "background var(--transition-fast), border-color var(--transition-fast)",
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
    // Sticky-Toolbar im Glass-Nav-Rezept — eine der drei erlaubten
    // Glasflaechen dieser View (DESIGN.md §4.3).
    <div
      className="glass-nav"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 30,
        margin: "0 calc(var(--sp-9) * -1)",
        padding: "var(--sp-4) var(--sp-9) var(--sp-5)",
        opacity: isPending ? 0.6 : 1,
        transition: "opacity var(--transition-fast)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
        {/* Row 1: Flow-Tabs — Text + Orange-Underline (COMPONENTS.md §10.3) */}
        <div
          style={{
            display: "flex",
            gap: "var(--sp-7)",
            overflowX: "auto",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          {TAB_OPTIONS.map((t) => {
            const active = t.value === tab;
            return (
              <button
                key={t.value}
                type="button"
                aria-pressed={active}
                onClick={() => selectTab(t.value)}
                className="ui-tab"
                data-active={active}
                style={{ flexShrink: 0, whiteSpace: "nowrap" }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Row 2: Zeitraum · Granularität · Nutzer · Quelle */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4) var(--sp-8)", flexWrap: "wrap" }}>
          {/* Zeitraum */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap" }}>
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
                <span style={{ color: "var(--text-muted)" }}>–</span>
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
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
              {deDate(from)} → {deDate(to)}
            </span>
          </div>

          {/* Granularität */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" }}>
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
          <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap" }}>
            <GroupLabel>Nutzer</GroupLabel>
            {canCompare ? (
              <div style={{ display: "inline-flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
                {/* Filter-Chips: inaktiv surface-1, aktiv Akzent-Tint. Die
                    Personen-Chips behalten ihre Owner-Farbe als Rahmen —
                    Identitaet, nicht Status. */}
                <button
                  type="button"
                  aria-pressed={allActive}
                  onClick={clearUsers}
                  style={{
                    height: 28,
                    padding: "0 var(--sp-5)",
                    fontSize: "var(--fs-sm)",
                    fontWeight: 500,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    borderRadius: "var(--r-full)",
                    whiteSpace: "nowrap",
                    background: allActive ? "var(--accent-muted)" : "var(--surface-1)",
                    color: allActive ? "var(--orange-300)" : "var(--text-muted)",
                    border: `1px solid ${allActive ? "var(--border-accent)" : "var(--border-default)"}`,
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
                        gap: "var(--sp-3)",
                        height: 28,
                        padding: "0 var(--sp-5) 0 2px",
                        fontSize: "var(--fs-sm)",
                        fontWeight: 500,
                        fontFamily: "inherit",
                        cursor: "pointer",
                        borderRadius: "var(--r-full)",
                        whiteSpace: "nowrap",
                        background: selected ? c.bg : "var(--surface-1)",
                        color: selected ? "var(--text-primary)" : "var(--text-muted)",
                        border: `1px solid ${selected ? c.fg : "var(--border-default)"}`,
                      }}
                    >
                      <span
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: "var(--r-full)",
                          background: c.bg,
                          color: c.fg,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "var(--fs-2xs)",
                          fontWeight: 600,
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
                  gap: "var(--sp-3)",
                  height: 28,
                  padding: "0 var(--sp-5)",
                  fontSize: "var(--fs-sm)",
                  color: "var(--text-muted)",
                  background: "var(--surface-1)",
                  borderRadius: "var(--r-full)",
                  border: "1px solid var(--border-default)",
                  whiteSpace: "nowrap",
                }}
              >
                <Lock size={12} />
                {selfName} · Nur eigene Daten
              </div>
            )}
          </div>

          {/* Quelle */}
          {showQuelle && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" }}>
              <GroupLabel>Quelle</GroupLabel>
              <Segmented<QuelleKey> options={QUELLE_OPTIONS} value={quelle} onChange={selectQuelle} size="sm" ariaLabel="Quelle" />
            </div>
          )}
        </div>

        {/* Row 3: Aktive Filter (entfernbar) */}
        {hasActiveFilters && (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
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
