"use client";

import { useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Lock, X } from "lucide-react";
import { DatePicker } from "@/components/ui/DatePicker";
import { Segmented } from "@/components/ui/Segmented";
import { ownerColor, ownerInitials } from "@/lib/ownerColor";
import type { AnalyseTab, Granularity, QuelleKey, RangeKey, ReifeKey } from "@/lib/analyse";

// Sticky Client-Filterleiste des Analyse-Bereichs: Flow-Tabs, Zeitraum (Presets
// + eigener Bereich), Granularität, Nutzer-Vergleich, optionale Quelle und eine
// entfernbare Aktiv-Filter-Chipzeile. Schreibt nur die geänderten Keys in die
// URL (Mechanik wie PeriodSwitcher).

const TAB_OPTIONS: { value: AnalyseTab; label: string }[] = [
  { value: "uebersicht", label: "Übersicht" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "followup", label: "Follow-ups" },
  { value: "listen", label: "Listen" },
  { value: "telefon", label: "Telefon" },
  { value: "setting", label: "Setting" },
  { value: "closing", label: "Closing" },
  { value: "funnel", label: "Funnel" },
];

const REIFE_OPTIONS: { value: ReifeKey; label: string }[] = [
  { value: "alle", label: "Alle Pitches" },
  { value: "reif", label: "Sequenz durchlaufen" },
];

const MIN_DMS_OPTIONS: { value: string; label: string }[] = [
  { value: "0", label: "Alle" },
  { value: "10", label: "≥ 10" },
  { value: "25", label: "≥ 25" },
  { value: "50", label: "≥ 50" },
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
  reife,
  minDms,
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
  reife: ReifeKey;
  minDms: number;
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

  function selectReife(next: ReifeKey) {
    commit((p) => {
      if (next === "alle") p.delete("reife");
      else p.set("reife", next);
    });
  }

  function selectMinDms(next: string) {
    commit((p) => {
      // 10 ist der Default in parseAnalyseParams — dann gehört nichts in die URL.
      if (next === "10") p.delete("min");
      else p.set("min", next);
    });
  }

  const allActive = selectedUserIds.length === 0;
  const nameById = new Map(users.map((u) => [u.user_id, u.username]));
  const quelleActive = showQuelle && quelle !== "alle";
  const showReife = tab === "followup";
  const showMinDms = tab === "listen";
  // Kohorten- und Listensichten haben keinen Verlauf, der Funnel bucketet nicht.
  const showGranularity = tab !== "followup" && tab !== "listen" && tab !== "funnel";
  const reifeActive = showReife && reife !== "alle";
  const minDmsActive = showMinDms && minDms !== 10;
  const hasActiveFilters =
    rangeKey === "custom" || selectedUserIds.length > 0 || quelleActive || reifeActive || minDmsActive;

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
      }}
    >
      {/* Nachladen (COMPONENTS.md §14.4): 2px-Linie an der Oberkante, der
          Inhalt darunter bleibt stehen und dimmt nur. Ohne dieses Signal wirkt
          ein Filterklick bei schweren Abfragen wie ein toter Klick. */}
      {isPending && <span className="route-progress" aria-hidden />}
      <div
        aria-busy={isPending}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-5)",
          opacity: isPending ? 0.6 : 1,
          transition: "opacity var(--transition-fast)",
        }}
      >
        {/* Row 1: Flow-Tabs — Text + Orange-Underline (COMPONENTS.md §10.3) */}
        <div className="tab-scroller">
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
                <DatePicker
                  variant="input"
                  value={customVon || null}
                  onChange={(v) => {
                    setCustomVon(v ?? "");
                    commitCustom(v ?? "", customBis);
                  }}
                  placeholder="Von"
                  shortFormat
                  triggerStyle={DATE_INPUT_STYLE}
                />
                <span style={{ color: "var(--text-muted)" }}>–</span>
                <DatePicker
                  variant="input"
                  value={customBis || null}
                  onChange={(v) => {
                    setCustomBis(v ?? "");
                    commitCustom(customVon, v ?? "");
                  }}
                  placeholder="Bis"
                  shortFormat
                  triggerStyle={DATE_INPUT_STYLE}
                />
              </div>
            )}
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
              {deDate(from)} → {deDate(to)}
            </span>
          </div>

          {/* Granularität — nur dort, wo es auch einen Verlauf gibt. Ein
              Regler, der auf Follow-ups/Listen/Funnel nichts bewegt, ist
              schlimmer als keiner: man dreht daran und misstraut danach der
              ganzen Leiste. */}
          {showGranularity && (
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
          )}

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

          {/* Kohorten-Reife — nur im Follow-up-Bereich sinnvoll: dort verzerren
              frisch gepitchte Kontakte die Stufen-Quoten nach unten. */}
          {showReife && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" }}>
              <GroupLabel>Kohorte</GroupLabel>
              <Segmented<ReifeKey> options={REIFE_OPTIONS} value={reife} onChange={selectReife} size="sm" ariaLabel="Kohorte" />
            </div>
          )}

          {/* Mindestmenge je Liste — unter ~10 DMs ist jede Quote Rauschen. */}
          {showMinDms && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" }}>
              <GroupLabel>Mindest-DMs</GroupLabel>
              <Segmented<string>
                options={MIN_DMS_OPTIONS}
                value={String(minDms)}
                onChange={selectMinDms}
                size="sm"
                ariaLabel="Mindest-DMs"
              />
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
            {reifeActive && <FilterChip label="Nur ausgereifte Pitches" onRemove={() => selectReife("alle")} />}
            {minDmsActive && (
              <FilterChip
                label={minDms === 0 ? "Alle Listen" : `Ab ${minDms} DMs`}
                onRemove={() => selectMinDms("10")}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
