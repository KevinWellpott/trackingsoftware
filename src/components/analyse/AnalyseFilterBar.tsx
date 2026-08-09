"use client";

import {
  Fragment,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, Lock, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { AnchoredPopover, useAnchor } from "@/components/ui/AnchoredPopover";
import { DatePicker } from "@/components/ui/DatePicker";
import { Segmented } from "@/components/ui/Segmented";
import { Select } from "@/components/ui/Select";
import { channelLabel, FILTERABLE_CHANNEL_KEYS } from "@/lib/channels";
import { ownerColor, ownerInitials, type OwnerColor } from "@/lib/ownerColor";
import type { AnalyseTab, FunnelModus, Granularity, QuelleKey, RangeKey, ReifeKey } from "@/lib/analyse";

// Sticky Kopf des Analyse-Bereichs — zwei Ebenen statt einer Wand:
//
//   IMMER SICHTBAR  Flow-Tabs · Ausschnitts-Zusammenfassung · Schalter „Filter"
//   AUFKLAPPBAR     die eigentlichen Kontrollen, gruppiert und beschriftet
//
// Warum: Vorher standen Tab-Reihe, Zeitraum-Presets, Datumsanzeige,
// Granularität, Nutzer-Chips, tab-abhängig Quelle/Kohorte/Listen/Zählweise UND
// eine Chipzeile „Aktive Filter" dauerhaft übereinander. Vor der ersten Zahl
// stand ein Formular. Im Ruhezustand interessiert aber nur EINE Frage: „Welchen
// Ausschnitt sehe ich gerade?" — die beantwortet jetzt ein Satz.
//
// Der Aufklapp-Zustand gehört NICHT in die URL: er verändert keine Zahl,
// sondern nur die Ansicht. Stünde er in der URL, wäre er Teil jedes geteilten
// Links und jedes Zurück-Schritts. Er liegt deshalb im localStorage (siehe
// OPEN_KEY) — das überlebt den Tabwechsel ebenso wie das Verlassen der Seite.
//
// Schreibt weiterhin nur die geänderten Keys in die URL (Mechanik wie
// PeriodSwitcher).

const TAB_OPTIONS: { value: AnalyseTab; label: string }[] = [
  { value: "uebersicht", label: "Übersicht" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "telefon", label: "Telefon" },
  { value: "setting", label: "Setting" },
  { value: "closing", label: "Closing" },
  { value: "funnel", label: "Funnel" },
];

const REIFE_OPTIONS: { value: ReifeKey; label: string }[] = [
  { value: "alle", label: "Alle Pitches" },
  { value: "reif", label: "Sequenz durchlaufen" },
];

const MODUS_OPTIONS: { value: FunnelModus; label: string }[] = [
  { value: "kohorte", label: "Kohorte" },
  { value: "periode", label: "Periode" },
];

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: "w", label: "Diese Woche" },
  { value: "m", label: "Dieser Monat" },
  { value: "30", label: "30 Tage" },
  { value: "q", label: "Quartal" },
  { value: "j", label: "Jahr" },
  { value: "custom", label: "Eigener" },
];

/** Langform für die Zusammenfassung — dort steht kein Segment daneben, das den Bezug klärt. */
const RANGE_LABEL: Record<Exclude<RangeKey, "custom">, string> = {
  w: "Diese Woche",
  m: "Dieser Monat",
  30: "Letzte 30 Tage",
  q: "Dieses Quartal",
  j: "Dieses Jahr",
};

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "tag", label: "Tag" },
  { value: "woche", label: "Woche" },
  { value: "monat", label: "Monat" },
];

/**
 * Quellen-Auswahl aus der Kanal-Registry statt aus einer eigenen Literal-Liste.
 *
 * Vorher standen hier LinkedIn/Telefon/Manuell hartkodiert — seit dem
 * Kanal-Umbau kann man Termine aber auch mit Quelle „Social Media", „Ads" oder
 * „Sonstige" buchen, und danach ließ sich schlicht nicht filtern. Jetzt hängt
 * die Liste am `filterable`-Flag in src/lib/channels.ts, aus dem auch
 * `QuelleKey` und die Validierung in `parseAnalyseParams` abgeleitet sind: ein
 * weiterer Kanal ist dort ein Flag, hier nichts.
 *
 * Mit sieben Einträgen ist das kein Segmented mehr (das wäre breiter als der
 * halbe Kopf) — ein Select trägt die Liste, ohne zu wachsen.
 */
const QUELLE_OPTIONS: { value: QuelleKey; label: string }[] = [
  { value: "alle", label: "Alle Quellen" },
  ...FILTERABLE_CHANNEL_KEYS.map((key) => ({ value: key, label: channelLabel(key) })),
];

// ── Aufklapp-Zustand als externer Store ──────────────────────
// Er gehört nicht in die URL (er ändert keine Zahl, nur die Ansicht) und soll
// trotzdem den Tabwechsel UND einen Reload überleben. `useSyncExternalStore`
// ist der von React dafür vorgesehene Weg: Der Server-Snapshot rendert
// zugeklappt, danach zieht React den echten Wert nach — ohne Hydration-Konflikt
// und ohne das `useEffect`+`setState`-Paar, das eine zweite Render-Runde
// auslöst.
const OPEN_KEY = "analyse:filter-open";
const OPEN_EVENT = "analyse:filter-open-change";

/** Fallback, wenn localStorage blockiert ist (Private Mode) — dann eben nur für diese Sitzung. */
let openFallback = false;

function subscribeOpen(onChange: () => void) {
  // "storage" deckt andere Tabs ab, das eigene Event diesen hier.
  window.addEventListener("storage", onChange);
  window.addEventListener(OPEN_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(OPEN_EVENT, onChange);
  };
}

function readOpen(): boolean {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    if (raw !== null) return raw === "1";
  } catch {
    /* ignore */
  }
  return openFallback;
}

function writeOpen(next: boolean): void {
  openFallback = next;
  try {
    localStorage.setItem(OPEN_KEY, next ? "1" : "0");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** Auf dem Server gibt es kein localStorage — dort ist zugeklappt der Default. */
function serverOpen(): boolean {
  return false;
}

/** Einheitliche Control-Höhe der Leiste (Filter-Größe „sm", COMPONENTS.md §2.6). */
const CONTROL_H = 28;

const DATE_INPUT_STYLE = {
  height: CONTROL_H,
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

/** YYYY-MM-DD → DD.MM. (Kurzform für die Zusammenfassung). */
function deDateShort(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}.${m}.`;
}

/** Eyebrow-Beschriftung über einer Kontrollgruppe. */
function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <span className="eyebrow eyebrow-muted" style={{ whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

/**
 * Beschriftete Kontrollgruppe im aufgeklappten Bereich: Label ÜBER dem Control.
 * Nebeneinander (wie vorher) kostet pro Gruppe die Breite des Labels und macht
 * jede Zeile ungleich hoch — untereinander stehen alle Controls auf einer
 * Grundlinie und die Gruppen brechen sauber um.
 */
function Group({
  label,
  children,
  minWidth = 176,
}: {
  label: string;
  children: ReactNode;
  /**
   * Untergrenze der Gruppe. Zahl = Mindestbreite für Controls, die mitwachsen
   * (Popover-Trigger, Select). `"auto"` für Segmented-Controls: die können
   * nicht schrumpfen, ohne aus ihrem Kasten zu laufen — sie brauchen
   * min-content als Untergrenze.
   */
  minWidth?: number | "auto";
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth }}>
      <GroupLabel>{label}</GroupLabel>
      {children}
    </div>
  );
}

/** Auswählbare Pitch-Liste im Listen-Filter (nur LinkedIn-Tab). */
export type ListFilterOption = {
  id: string;
  name: string;
  /** Besitzer-Name; nur sichtbar, wenn überhaupt verglichen werden darf. */
  owner: string | null;
  archived: boolean;
};

/** Eintrag im Mehrfach-Auswahl-Popover (Nutzer wie Listen). */
type PickerOption = {
  id: string;
  label: string;
  /** Zweite Zeile: Besitzer, „archiviert" … */
  hint?: string | null;
  /** Initialen-Avatar in Owner-Farbe — Identität, kein Status (nur Nutzer). */
  avatar?: { initials: string; color: OwnerColor } | null;
};

const PICKER_WIDTH = 280;
const PICKER_MAX_HEIGHT = 320;
/** Ab so vielen Einträgen bekommt das Popover ein Suchfeld. */
const PICKER_SEARCH_FROM = 8;

/**
 * Mehrfachauswahl als EIN Knopf mit Popover — für Nutzer UND Listen.
 *
 * Beide waren vorher Chip-Reihen bzw. Sonderlocken: Ein Team hat schnell 30
 * Pitch-Listen und mehr als vier Mitglieder; als Chips gerendert schob allein
 * die Nutzerauswahl den Tab aus dem Bild, und die Leiste wurde bei jedem neuen
 * Kollegen höher. Der Knopf trägt den Zustand („Alle Nutzer" / Name / „3
 * Nutzer"), die Auswahl liegt im Popover — die aktive Auswahl bleibt trotzdem
 * sichtbar, nämlich in der Zusammenfassung oben (COMPONENTS.md §12: aktive
 * Filter nie verstecken).
 */
function MultiPicker({
  options,
  selectedIds,
  allLabel,
  unit,
  ariaLabel,
  onToggle,
  onClear,
}: {
  options: PickerOption[];
  selectedIds: string[];
  /** Beschriftung ohne Auswahl, z. B. „Alle Nutzer". */
  allLabel: string;
  /** Zähl-Einheit ab zwei Treffern, z. B. „Nutzer". */
  unit: string;
  ariaLabel: string;
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const { anchor, ref, toggle, close } = useAnchor();
  const [query, setQuery] = useState("");
  const isOpen = Boolean(anchor);
  const selected = new Set(selectedIds);
  const active = selectedIds.length > 0;
  const searchable = options.length >= PICKER_SEARCH_FROM;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.hint ?? "").toLowerCase().includes(q),
    );
  }, [options, query]);

  const label =
    selectedIds.length === 0
      ? allLabel
      : selectedIds.length === 1
        ? (options.find((o) => o.id === selectedIds[0])?.label ?? `1 ${unit}`)
        : `${selectedIds.length} ${unit}`;

  return (
    <>
      {/* .field-trigger liefert Box, Hover und Fokusring; inline nur, was vom
          Zustand abhängt. Border/Background bleiben bewusst unangetastet —
          ein Inline-Style dort schlüge den Hover aus dem Stylesheet. */}
      <button
        ref={ref as React.RefObject<HTMLButtonElement>}
        type="button"
        className="field-trigger"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        onClick={toggle}
        style={{
          minHeight: CONTROL_H,
          justifyContent: "space-between",
          fontSize: "var(--fs-sm)",
          color: active ? "var(--orange-300)" : "var(--text-secondary)",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <ChevronDown
          size={13}
          aria-hidden
          style={{
            flexShrink: 0,
            opacity: 0.7,
            transform: isOpen ? "rotate(180deg)" : undefined,
            transition: "transform var(--dur-2) var(--ease-out)",
          }}
        />
      </button>

      {anchor && (
        <AnchoredPopover
          anchor={anchor}
          onClose={close}
          label={ariaLabel}
          width={PICKER_WIDTH}
          maxHeight={PICKER_MAX_HEIGHT}
          style={{ padding: "var(--sp-4)" }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
            {searchable && (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-3)",
                  height: "var(--h-control)",
                  padding: "0 var(--sp-4)",
                  borderRadius: "var(--r-md)",
                  background: "var(--surface-1)",
                  border: "1px solid var(--border-default)",
                }}
              >
                <Search size={13} color="var(--text-muted)" aria-hidden />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Suchen"
                  aria-label={`${ariaLabel} durchsuchen`}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    fontFamily: "inherit",
                    fontSize: "var(--fs-sm)",
                    color: "var(--text-primary)",
                  }}
                />
              </label>
            )}

            <button
              type="button"
              onClick={onClear}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-3)",
                padding: "var(--sp-3) var(--sp-4)",
                borderRadius: "var(--r-sm)",
                border: "none",
                background: !active ? "var(--accent-muted)" : "transparent",
                color: !active ? "var(--orange-300)" : "var(--text-secondary)",
                fontFamily: "inherit",
                fontSize: "var(--fs-sm)",
                fontWeight: !active ? 600 : 400,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ flex: 1 }}>{allLabel}</span>
              {!active && <Check size={13} aria-hidden />}
            </button>

            {visible.length === 0 ? (
              <span style={{ padding: "var(--sp-4)", fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
                Nichts gefunden.
              </span>
            ) : (
              visible.map((o) => {
                const on = selected.has(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => onToggle(o.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--sp-4)",
                      padding: "var(--sp-3) var(--sp-4)",
                      borderRadius: "var(--r-sm)",
                      border: "none",
                      background: on ? "var(--accent-muted)" : "transparent",
                      color: on ? "var(--orange-300)" : "var(--text-secondary)",
                      fontFamily: "inherit",
                      fontSize: "var(--fs-sm)",
                      fontWeight: on ? 600 : 400,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    {o.avatar && (
                      <span
                        aria-hidden
                        style={{
                          width: 22,
                          height: 22,
                          flexShrink: 0,
                          borderRadius: "var(--r-full)",
                          background: o.avatar.color.bg,
                          color: o.avatar.color.fg,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "var(--fs-2xs)",
                          fontWeight: 600,
                        }}
                      >
                        {o.avatar.initials}
                      </span>
                    )}
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                      <span
                        style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {o.label}
                      </span>
                      {o.hint ? (
                        <span
                          style={{
                            display: "block",
                            fontSize: "var(--fs-2xs)",
                            color: "var(--text-muted)",
                            fontWeight: 400,
                          }}
                        >
                          {o.hint}
                        </span>
                      ) : null}
                    </span>
                    {on && <Check size={13} aria-hidden style={{ flexShrink: 0 }} />}
                  </button>
                );
              })
            )}
          </div>
        </AnchoredPopover>
      )}
    </>
  );
}

/**
 * Ein Baustein der Ausschnitts-Zusammenfassung.
 * `accent` markiert eine Abweichung vom Default — also das, was jemand wissen
 * MUSS, um die Zahlen darunter zu verstehen.
 */
type SummaryPart = { text: string; accent: boolean };

export function AnalyseFilterBar({
  tab,
  rangeKey,
  hasCustomDates,
  from,
  to,
  quelle,
  granularity,
  reife,
  modus,
  selectedUserIds,
  users,
  lists,
  selectedListIds,
  canCompare,
  showQuelle,
  selfName,
}: {
  tab: AnalyseTab;
  rangeKey: RangeKey;
  hasCustomDates: boolean;
  /**
   * Das AUFGELÖSTE Fenster — auch bei „Eigener" ohne Eingabe (dann der
   * laufende Monat). Es beschriftet die Zusammenfassung und belegt zugleich die
   * Datumsfelder vor: ein Klick auf „Eigener" zeigt damit sofort einen
   * sinnvollen Bereich statt zweier leerer Felder.
   */
  from: string;
  to: string;
  quelle: QuelleKey;
  granularity: Granularity;
  reife: ReifeKey;
  modus: FunnelModus;
  selectedUserIds: string[];
  users: { user_id: string; username: string }[];
  /** Sichtbare Pitch-Listen; nur für den LinkedIn-Tab befüllt. */
  lists: ListFilterOption[];
  selectedListIds: string[];
  canCompare: boolean;
  showQuelle: boolean;
  selfName?: string;
}) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const panelId = useId();

  const open = useSyncExternalStore(subscribeOpen, readOpen, serverOpen);

  // Die Datumsfelder folgen dem aufgelösten Fenster. Wechselt es von außen
  // (Preset-Klick, Deep-Link), ziehen sie nach — sonst zeigten sie nach einem
  // Preset-Wechsel noch die Grenzen des alten Fensters. Ableitung während des
  // Renders statt useEffect (React-Doku: „You Might Not Need an Effect").
  const [customVon, setCustomVon] = useState(from);
  const [customBis, setCustomBis] = useState(to);
  const [syncedRange, setSyncedRange] = useState(`${from}|${to}`);
  if (syncedRange !== `${from}|${to}`) {
    setSyncedRange(`${from}|${to}`);
    setCustomVon(from);
    setCustomBis(to);
  }

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
      // Die Zählweise gibt es nur im Funnel.
      if (next !== "funnel") p.delete("modus");
      // Listen-Filter und Kohorten-Schnitt hängen beide am LinkedIn-Tab. Sie in
      // der URL stehen zu lassen, wäre ein unsichtbarer Filter: kein Bedien-
      // element zeigt ihn an, aber beim Zurückwechseln wäre er wieder aktiv.
      if (next !== "linkedin") {
        p.delete("listen");
        p.delete("reife");
      }
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
    // Vertauschte Grenzen NICHT abweisen: `parseAnalyseParams` dreht sie
    // ohnehin um. Ein stiller Abbruch machte stattdessen jede Eingabe wirkungs-
    // los, bei der man das Bis-Datum zuerst nach vorne zieht.
    if (!v || !b) return;
    commit((p) => {
      p.set("range", "custom");
      p.set("von", v);
      p.set("bis", b);
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

  function selectQuelle(next: string) {
    commit((p) => {
      // „alle" ist der Default — dann gehört nichts in die URL.
      if (next === "alle") p.delete("quelle");
      else p.set("quelle", next);
    });
  }

  function selectReife(next: ReifeKey) {
    commit((p) => {
      if (next === "alle") p.delete("reife");
      else p.set("reife", next);
    });
  }

  function toggleList(id: string) {
    const set = new Set(selectedListIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    const joined = [...set].join(",");
    commit((p) => {
      if (joined) p.set("listen", joined);
      else p.delete("listen");
    });
  }

  function clearLists() {
    commit((p) => p.delete("listen"));
  }

  function selectModus(next: FunnelModus) {
    commit((p) => {
      // „kohorte" ist der Default — dann gehört nichts in die URL.
      if (next === "kohorte") p.delete("modus");
      else p.set("modus", next);
    });
  }

  /**
   * Setzt alles zurück, was diese Leiste steuert — den Tab ausdrücklich nicht
   * (man will denselben Tab ohne Filter sehen, nicht auf der Übersicht landen).
   * Ersetzt den früheren Weg, jeden Chip einzeln wegzuklicken.
   */
  function resetAll() {
    commit((p) => {
      for (const key of ["range", "von", "bis", "users", "quelle", "listen", "reife", "modus", "g"]) {
        p.delete(key);
      }
    });
  }

  // ── Welche Filter wirken auf diesem Tab? ────────────────────
  // Kohorten-Schnitt und Listen-Filter wirken nur auf LinkedIn-Kennzahlen, die
  // Zählweise nur im Funnel. Ein Regler, der nichts bewegt, ist schlimmer als
  // keiner: man dreht daran und misstraut danach der ganzen Leiste.
  const showReife = tab === "linkedin";
  const showListen = tab === "linkedin" && lists.length > 0;
  const showModus = tab === "funnel";
  const quelleActive = showQuelle && quelle !== "alle";
  const reifeActive = showReife && reife !== "alle";
  const modusActive = showModus && modus !== "kohorte";
  const activeListIds = showListen ? selectedListIds : [];

  const userOptions: PickerOption[] = users.map((u) => ({
    id: u.user_id,
    label: u.username,
    avatar: { initials: ownerInitials(u.username), color: ownerColor(u.username) },
  }));
  const listOptions: PickerOption[] = lists.map((l) => ({
    id: l.id,
    label: l.name,
    hint:
      [canCompare && l.owner ? l.owner : null, l.archived ? "archiviert" : null].filter(Boolean).join(" · ") ||
      null,
  }));

  // ── Zusammenfassung des aktiven Ausschnitts ─────────────────
  // Der zugeklappte Kopf muss die Frage „welche Daten sehe ich hier?"
  // beantworten. Der Zeitraum steht deshalb IMMER (neutral), jede Abweichung
  // vom Default zusätzlich in Akzentfarbe. Ohne dieses Signal liest jemand 40
  // statt 400 DMs und sucht den Fehler in den Daten statt in der Leiste —
  // COMPONENTS.md §12 („aktive Filter nie verstecken") ist damit erfüllt: die
  // Chipzeile ist nicht verschwunden, sie ist zu einem Satz verdichtet.
  const parts: SummaryPart[] = [];
  parts.push(
    hasCustomDates
      ? { text: `${deDateShort(from)}–${deDateShort(to)}`, accent: true }
      : // „Eigener" ohne Eingabe zeigt den laufenden Monat — dann ist das auch
        // die ehrliche Beschriftung, nicht „Eigener".
        { text: RANGE_LABEL[rangeKey === "custom" ? "m" : rangeKey], accent: false },
  );
  if (!canCompare) {
    // Datensicht „own": kein Filter, sondern eine Grenze — deshalb neutral.
    if (selfName) parts.push({ text: selfName, accent: false });
  } else if (selectedUserIds.length === 1) {
    parts.push({ text: users.find((u) => u.user_id === selectedUserIds[0])?.username ?? "1 Nutzer", accent: true });
  } else if (selectedUserIds.length > 1) {
    parts.push({ text: `${selectedUserIds.length} Nutzer`, accent: true });
  }
  if (quelleActive) parts.push({ text: channelLabel(quelle), accent: true });
  if (activeListIds.length === 1) {
    parts.push({ text: lists.find((l) => l.id === activeListIds[0])?.name ?? "1 Liste", accent: true });
  } else if (activeListIds.length > 1) {
    parts.push({ text: `${activeListIds.length} Listen`, accent: true });
  }
  if (reifeActive) parts.push({ text: "Sequenz durchlaufen", accent: true });
  if (modusActive) parts.push({ text: "Periode", accent: true });
  // Granularität bleibt neutral: sie bucketet dieselben Daten anders, sie
  // schneidet nichts weg — niemand muss sie kennen, um die Summen zu glauben.
  if (granularity !== "auto") {
    parts.push({ text: `je ${GRANULARITY_OPTIONS.find((o) => o.value === granularity)?.label}`, accent: false });
  }

  const activeCount = parts.filter((p) => p.accent).length;

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
        padding: "var(--sp-3) var(--sp-9) var(--sp-4)",
      }}
    >
      {/* Nachladen (COMPONENTS.md §14.4): 2px-Linie an der Oberkante, der
          Inhalt darunter bleibt stehen und dimmt nur. Ohne dieses Signal wirkt
          ein Filterklick bei schweren Abfragen wie ein toter Klick. */}
      {isPending && <span className="route-progress" aria-hidden />}
      <div
        aria-busy={isPending}
        style={{ opacity: isPending ? 0.6 : 1, transition: "opacity var(--transition-fast)" }}
      >
        {/* ── Immer sichtbare Zeile: Tabs · Ausschnitt · Schalter ──
            Die Hairline liegt auf der ZEILE, nicht auf dem Tab-Scroller: so
            läuft sie unter der ganzen Kopfzeile durch und die Tab-Underline
            (::after, bottom -1px) landet exakt darauf. */}
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            flexWrap: "wrap",
            gap: "var(--sp-3) var(--sp-6)",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          {/* Flow-Tabs — Text + Orange-Underline (COMPONENTS.md §10.3).
              minWidth hält auf schmalen Viewports ein paar Tabs sichtbar;
              der Rest scrollt (.tab-scroller), statt dass die Reihe auf
              nichts zusammenfällt, während die Zusammenfassung ihren Platz
              behält. */}
          <div className="tab-scroller" style={{ flex: "1 1 auto", minWidth: 160, border: "none" }}>
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

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-4)",
              flex: "0 1 auto",
              minWidth: 0,
              marginLeft: "auto",
            }}
          >
            {/* Der Ausschnitt in einem Satz. Kürzt bei Platzmangel per
                Ellipse — das Zähl-Badge am Schalter trägt das Signal dann
                allein weiter. */}
            <span
              title={`Zeitraum ${deDate(from)} bis ${deDate(to)}`}
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "var(--fs-sm)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {parts.map((p, i) => (
                <Fragment key={`${i}-${p.text}`}>
                  {i > 0 && <span style={{ color: "var(--text-disabled)" }}> · </span>}
                  <span style={{ color: p.accent ? "var(--orange-300)" : "var(--text-secondary)" }}>{p.text}</span>
                </Fragment>
              ))}
            </span>

            {/* Der eine Klick zurück auf „alles". Ohne ihn müsste man die
                Filter aufklappen und einzeln zurückdrehen — die entfernten
                Chips waren wenigstens einzeln wegklickbar.
                Kein Inline-`background`: sonst schlüge es den Ghost-Hover
                aus dem Stylesheet. */}
            {activeCount > 0 && (
              <button
                type="button"
                className="ui-btn"
                data-variant="ghost"
                onClick={resetAll}
                aria-label="Alle Filter zurücksetzen"
                title="Alle Filter zurücksetzen"
                style={{
                  width: CONTROL_H,
                  height: CONTROL_H,
                  flexShrink: 0,
                  padding: 0,
                  border: "none",
                  color: "var(--text-muted)",
                }}
              >
                <RotateCcw size={14} aria-hidden />
              </button>
            )}

            {/* Der Schalter trägt den Aktiv-Zustand doppelt: als Akzent-Fläche
                und als Zahl. Beides bleibt lesbar, wenn die Zusammenfassung
                links weggekürzt wird — genau dann trägt er das Signal allein.
                Ohne gesetzten Filter bleibt `background` inline leer, damit
                der Ghost-Hover aus dem Stylesheet greift. */}
            <button
              type="button"
              className="ui-btn"
              data-variant="ghost"
              onClick={() => writeOpen(!open)}
              aria-expanded={open}
              aria-controls={panelId}
              style={{
                gap: "var(--sp-3)",
                height: CONTROL_H,
                flexShrink: 0,
                padding: "0 var(--sp-5)",
                fontSize: "var(--fs-sm)",
                whiteSpace: "nowrap",
                background: activeCount > 0 ? "var(--accent-muted)" : undefined,
                color: activeCount > 0 ? "var(--orange-300)" : "var(--text-secondary)",
                border: `1px solid ${activeCount > 0 ? "var(--border-accent)" : "var(--border-default)"}`,
              }}
            >
              <SlidersHorizontal size={13} aria-hidden />
              Filter
              {activeCount > 0 && (
                <span
                  aria-hidden
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 18,
                    height: 18,
                    padding: "0 var(--sp-2)",
                    borderRadius: "var(--r-full)",
                    background: "var(--orange-500)",
                    // Dunkel auf Orange = 7.1:1; weiß wäre nur 2.8:1
                    // (dieselbe Regel wie im Segmented-Control).
                    color: "var(--surface-0)",
                    fontSize: "var(--fs-2xs)",
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {activeCount}
                </span>
              )}
              <ChevronDown
                size={13}
                aria-hidden
                style={{
                  opacity: 0.7,
                  transform: open ? "rotate(180deg)" : undefined,
                  transition: "transform var(--dur-2) var(--ease-out)",
                }}
              />
            </button>
          </div>
        </div>

        {/* ── Aufklappbarer Filterbereich ──────────────────────────
            0fr → 1fr auf einer Grid-Zeile ist der einzige Weg, eine unbekannte
            Höhe ohne JS-Messung zu animieren. `--dur-2` ist unter
            prefers-reduced-motion global 0ms — der Respekt kostet hier also
            keine Extrawurst. `inert` hält die Controls im zugeklappten Zustand
            aus Tab-Reihenfolge und Screenreader heraus. */}
        <div
          style={{
            display: "grid",
            gridTemplateRows: open ? "1fr" : "0fr",
            transition: "grid-template-rows var(--dur-2) var(--ease-out)",
          }}
        >
          <div style={{ overflow: "hidden", minHeight: 0 }}>
            <div
              id={panelId}
              role="group"
              aria-label="Filter"
              inert={!open}
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "flex-start",
                gap: "var(--sp-6) var(--sp-8)",
                paddingTop: "var(--sp-5)",
                // Notbremse für sehr flache Fenster: die Leiste ist sticky und
                // darf nie den halben Bildschirm belegen.
                maxHeight: "min(48vh, 340px)",
                overflowY: "auto",
              }}
            >
              <Group label="Zeitraum" minWidth="auto">
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap" }}>
                  <Segmented<RangeKey>
                    options={RANGE_OPTIONS}
                    value={rangeKey}
                    onChange={selectRange}
                    size="sm"
                    ariaLabel="Zeitraum"
                  />
                  {rangeKey === "custom" && (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}>
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
                  {/* Das aufgelöste Fenster gehört neben die Presets: „Quartal"
                      allein sagt nicht, ob der laufende oder der letzte gemeint ist. */}
                  <span
                    style={{
                      fontSize: "var(--fs-xs)",
                      color: "var(--text-muted)",
                      whiteSpace: "nowrap",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {deDate(from)} → {deDate(to)}
                  </span>
                </div>
              </Group>

              <Group label="Nutzer">
                {canCompare ? (
                  <MultiPicker
                    options={userOptions}
                    selectedIds={selectedUserIds}
                    allLabel="Alle Nutzer"
                    unit="Nutzer"
                    ariaLabel="Nutzer filtern"
                    onToggle={toggleUser}
                    onClear={clearUsers}
                  />
                ) : (
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "var(--sp-3)",
                      height: CONTROL_H,
                      padding: "0 var(--sp-5)",
                      fontSize: "var(--fs-sm)",
                      color: "var(--text-muted)",
                      background: "var(--surface-1)",
                      borderRadius: "var(--r-md)",
                      border: "1px solid var(--border-default)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <Lock size={12} aria-hidden />
                    {selfName} · Nur eigene Daten
                  </div>
                )}
              </Group>

              {showQuelle && (
                <Group label="Quelle">
                  <Select
                    value={quelle}
                    onChange={selectQuelle}
                    options={QUELLE_OPTIONS}
                    ariaLabel="Quelle"
                    width={PICKER_WIDTH}
                    triggerStyle={{
                      minHeight: CONTROL_H,
                      fontSize: "var(--fs-sm)",
                      color: quelleActive ? "var(--orange-300)" : "var(--text-secondary)",
                    }}
                  />
                </Group>
              )}

              {showListen && (
                <Group label="Listen">
                  <MultiPicker
                    options={listOptions}
                    selectedIds={selectedListIds}
                    allLabel="Alle Listen"
                    unit="Listen"
                    ariaLabel="Listen filtern"
                    onToggle={toggleList}
                    onClear={clearLists}
                  />
                </Group>
              )}

              {/* Kohorten-Reife — nur dort, wo die Follow-up-Kaskade steht:
                  frisch gepitchte Kontakte drücken sonst jede späte Stufenquote. */}
              {showReife && (
                <Group label="Kohorte" minWidth="auto">
                  <Segmented<ReifeKey>
                    options={REIFE_OPTIONS}
                    value={reife}
                    onChange={selectReife}
                    size="sm"
                    ariaLabel="Kohorte"
                  />
                </Group>
              )}

              {/* Zählweise — nur im Funnel. „Kohorte" bindet die Closings an die
                  Termine des Zeitraums (echte Durchlaufquoten), „Periode" zählt
                  jede Stufe auf ihrem eigenen Stichtag. */}
              {showModus && (
                <Group label="Zählweise" minWidth="auto">
                  <Segmented<FunnelModus>
                    options={MODUS_OPTIONS}
                    value={modus}
                    onChange={selectModus}
                    size="sm"
                    ariaLabel="Zählweise"
                  />
                </Group>
              )}

              <Group label="Granularität" minWidth="auto">
                <Segmented<Granularity>
                  options={GRANULARITY_OPTIONS}
                  value={granularity}
                  onChange={selectGranularity}
                  size="sm"
                  ariaLabel="Granularität"
                />
              </Group>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
