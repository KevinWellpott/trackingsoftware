"use client";

import { AnchoredPopover, useAnchor } from "@/components/ui/AnchoredPopover";
import { CalendarPopover, formatDateDe } from "@/components/ui/CalendarPopover";
import { localDateISO } from "@/lib/dates";
import { Calendar as CalendarIcon, Clock } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Datum + Uhrzeit im Brand-Design — Ersatz fuer <input type="datetime-local">.
//
// Das Wertformat ist bewusst identisch zum nativen Input ("2026-07-27T10:00",
// Berlin-Wandzeit): alle Aufrufer arbeiten mit isoToBerlinInput/berlinInputToIso
// (src/lib/apptTime.ts) und bleiben dadurch unveraendert.
//
// Die Uhrzeit ist ein echtes Eingabefeld mit Viertelstunden-Vorschlaegen, kein
// reines Dropdown: Termine liegen fast immer auf der Viertelstunde, krumme
// Zeiten muessen aber tippbar bleiben. "9", "930" und "9:30" ergeben alle 09:30.

const DEFAULT_TIME = "09:00";
const TIME_POPOVER_WIDTH = 104;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Freitext → "HH:MM", oder null wenn unlesbar. */
export function normalizeTime(raw: string): string | null {
  const s = raw.trim().replace(/[.,;\s]/g, ":");
  let h: number;
  let min: number;
  const withColon = /^(\d{1,2}):(\d{1,2})$/.exec(s);
  const digits = /^(\d{1,4})$/.exec(s);
  if (withColon) {
    h = Number(withColon[1]);
    min = Number(withColon[2]);
  } else if (digits) {
    const d = digits[1];
    // 3–4 Ziffern sind HHMM ("930" → 09:30), 1–2 Ziffern eine volle Stunde.
    if (d.length >= 3) {
      h = Number(d.slice(0, d.length - 2));
      min = Number(d.slice(-2));
    } else {
      h = Number(d);
      min = 0;
    }
  } else {
    return null;
  }
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

/** Viertelstunden 00:00–23:45. */
const QUARTERS: string[] = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`);

export function DateTimeField({
  value,
  onChange,
  clearable = false,
  disabled = false,
  id,
  ariaLabel,
  style,
}: {
  /** "2026-07-27T10:00" oder "" — wie <input type="datetime-local">. */
  value: string;
  onChange: (value: string) => void;
  clearable?: boolean;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  style?: React.CSSProperties;
}) {
  const date = value.split("T")[0] ?? "";
  const time = (value.split("T")[1] ?? "").slice(0, 5);

  const { anchor: dateAnchor, ref: dateRef, toggle: toggleDate, close: closeDate } = useAnchor();
  const { anchor: timeOpen, ref: timeRef, open: openTime, close: closeTime } = useAnchor();
  const listRef = useRef<HTMLDivElement>(null);
  // Aenderungen von aussen (Reset, Serverantwort) in das Textfeld spiegeln.
  // Das offizielle „State beim Prop-Wechsel anpassen"-Muster: waehrend des
  // Renderns statt im Effekt — sonst rendert das Feld nach jedem Speichern
  // zweimal und die Uhrzeit flackert.
  const [draft, setDraft] = useState(time);
  const [syncedTime, setSyncedTime] = useState(time);
  if (time !== syncedTime) {
    setSyncedTime(time);
    setDraft(time);
  }

  // Beim Oeffnen zur passenden Viertelstunde scrollen.
  useEffect(() => {
    if (!timeOpen) return;
    const target = QUARTERS.find((q) => q >= (time || DEFAULT_TIME)) ?? QUARTERS[0];
    listRef.current?.querySelector<HTMLElement>(`[data-t="${target}"]`)?.scrollIntoView({ block: "center" });
  }, [timeOpen, time]);

  function commit(nextDate: string, nextTime: string) {
    onChange(nextDate && nextTime ? `${nextDate}T${nextTime}` : "");
  }

  function commitTime(raw: string) {
    const n = normalizeTime(raw);
    if (!n) {
      setDraft(time); // unlesbar → letzten gueltigen Wert zuruecksetzen
      return;
    }
    setDraft(n);
    commit(date || localDateISO(), n);
  }

  const visibleQuarters = (() => {
    const q = draft.replace(/\D/g, "");
    if (!q) return QUARTERS;
    const hit = QUARTERS.filter((t) => t.replace(":", "").startsWith(q));
    return hit.length ? hit : QUARTERS;
  })();

  return (
    <div className="field-combo" style={{ opacity: disabled ? 0.55 : 1, ...style }}>
      {/* Datum */}
      <button
        ref={dateRef as React.RefObject<HTMLButtonElement>}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={Boolean(dateAnchor)}
        aria-label={ariaLabel ? `${ariaLabel} — Datum` : "Datum wählen"}
        onClick={toggleDate}
        className="field-combo-part"
        style={{ flex: 1, color: date ? "var(--text-primary)" : "var(--text-muted)" }}
      >
        <CalendarIcon size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
        {date ? formatDateDe(date) : "Datum"}
      </button>

      <span className="field-combo-divider" aria-hidden="true" />

      {/* Uhrzeit */}
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <Clock size={14} style={{ flexShrink: 0, opacity: 0.7, color: "var(--text-muted)", marginLeft: "var(--sp-4)" }} />
        <input
          ref={timeRef as React.RefObject<HTMLInputElement>}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          value={draft}
          placeholder="--:--"
          aria-label={ariaLabel ? `${ariaLabel} — Uhrzeit` : "Uhrzeit"}
          onFocus={openTime}
          onClick={openTime}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commitTime(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTime(draft);
              closeTime();
            } else if (e.key === "Escape") {
              setDraft(time);
              closeTime();
            }
          }}
          className="field-combo-time"
        />
      </div>

      {dateAnchor && (
        <CalendarPopover
          anchor={dateAnchor}
          value={date || null}
          clearable={clearable}
          onPick={(iso) => {
            closeDate();
            commit(iso, time || DEFAULT_TIME);
          }}
          onClear={() => {
            closeDate();
            onChange("");
          }}
          onClose={closeDate}
        />
      )}

      {timeOpen && (
        <AnchoredPopover
          anchor={timeOpen}
          onClose={closeTime}
          label="Uhrzeit wählen"
          role="listbox"
          width={TIME_POPOVER_WIDTH}
          maxHeight={220}
          popoverRef={listRef}
          style={{ padding: "var(--sp-2)" }}
        >
          {visibleQuarters.map((t) => {
            const selected = t === time;
            return (
              <div
                key={t}
                data-t={t}
                role="option"
                aria-selected={selected}
                // onMouseDown statt onClick: das Textfeld verliert sonst zuerst
                // den Fokus, onBlur laeuft und der Klick geht ins Leere.
                onMouseDown={(e) => {
                  e.preventDefault();
                  setDraft(t);
                  commit(date || localDateISO(), t);
                  closeTime();
                }}
                style={{
                  padding: "0.3125rem 0.5rem",
                  borderRadius: "var(--r-sm)",
                  fontSize: "var(--fs-sm)",
                  fontVariantNumeric: "tabular-nums",
                  textAlign: "center",
                  cursor: "pointer",
                  background: selected ? "var(--accent-muted)" : "transparent",
                  color: selected ? "var(--orange-300)" : "var(--text-secondary)",
                  fontWeight: selected ? 600 : 400,
                }}
                className="dp-day"
              >
                {t}
              </div>
            );
          })}
        </AnchoredPopover>
      )}
    </div>
  );
}
