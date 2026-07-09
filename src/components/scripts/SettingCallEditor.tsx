"use client";

import {
  createClosingFromSetting,
  rescheduleSetting,
  setSettingOutcome,
  updateSettingCall,
  type SettingCallPatch,
} from "@/app/actions/settingCalls";
import { AssigneeMultiSelect } from "@/components/assignees/AssigneeMultiSelect";
import { ScriptRunner } from "@/components/scripts/ScriptRunner";
import { Modal } from "@/components/ui/Modal";
import { addDaysISO, localDateISO } from "@/lib/dates";
import { SETTING_BLOCKS } from "@/lib/scripts";
import type { SettingCall, SettingStatus } from "@/lib/types";
import { ArrowRight, CalendarClock, Check, FileText, MessageSquareQuote, UserX, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

// Setting-Call-Editor: Script-Runner + Zusatznotizen links, strukturierte
// Qualifikationsfelder + Zuweisungen rechts (sticky). Alles speichert
// automatisch (Blur bzw. Klick) via updateSettingCall.
//
// Das Ergebnis (Nicht erschienen / Qualifiziert / Unqualifiziert / Dead) läuft
// dagegen über setSettingOutcome — es leitet den Show-Status ab und setzt die
// Wiedervorlage, statt beides getrennt pflegen zu lassen.

type UserOption = { user_id: string; username: string };

type Props = {
  call: SettingCall;
  assignees: UserOption[];
  users: UserOption[];
  sourceNotes?: { label: string; text: string }[];
};

/** Ergebnisse mit Wiedervorlage — beide öffnen denselben Nachfass-Dialog. */
type FollowUpOutcome = "no_show" | "unqualifiziert";

/** Default-Wiedervorlage: No-Show morgen erneut anfassen, Unqualifizierte in einer Woche. */
const FOLLOW_UP_DEFAULT_DAYS: Record<FollowUpOutcome, number> = { no_show: 1, unqualifiziert: 7 };

const FOLLOW_UP_COPY: Record<FollowUpOutcome, { title: string; subtitle: string; submit: string }> = {
  no_show: {
    title: "Nicht erschienen",
    subtitle: "Wann soll der Lead erneut angefasst werden?",
    submit: "Als No-Show speichern",
  },
  unqualifiziert: {
    title: "Unqualifiziert",
    subtitle: "Wann soll nachgefasst werden — oder gar nicht?",
    submit: "Als unqualifiziert speichern",
  },
};

const STATUS_META: Record<SettingStatus, { label: string; color: string; bg: string; border: string }> = {
  offen: { label: "Offen", color: "var(--text-muted)", bg: "var(--surface-150)", border: "var(--border)" },
  no_show: {
    label: "Nicht erschienen",
    color: "var(--color-error-text)",
    bg: "var(--color-error-bg)",
    border: "var(--color-error-border)",
  },
  qualifiziert: {
    label: "Qualifiziert",
    color: "var(--color-success-text)",
    bg: "var(--color-success-bg)",
    border: "var(--color-success-border)",
  },
  closing_gelegt: {
    label: "Closing gelegt",
    color: "var(--color-info-text)",
    bg: "var(--color-info-bg)",
    border: "var(--color-info-border)",
  },
  unqualifiziert: {
    label: "Unqualifiziert",
    color: "var(--color-warning-text)",
    bg: "var(--color-warning-bg)",
    border: "var(--color-warning-border)",
  },
  dead: { label: "Dead", color: "var(--color-error-text)", bg: "var(--color-error-bg)", border: "var(--color-error-border)" },
};

/** Ergebnis-Button in der Aktionsleiste; aktiv = getönt in der Statusfarbe. */
function outcomeButton(active: boolean, meta: { color: string; bg: string; border: string }): React.CSSProperties {
  return {
    padding: "0.4rem 0.75rem",
    borderRadius: "var(--radius-sm)",
    border: `1px solid ${active ? meta.border : "var(--border)"}`,
    background: active ? meta.bg : "var(--surface-50)",
    color: active ? meta.color : "var(--text-muted)",
    fontSize: "0.75rem",
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.1s",
  };
}

function modalButton(kind: "primary" | "ghost", accent?: { bg: string; fg: string; border: string }): React.CSSProperties {
  if (kind === "primary") {
    return {
      flex: 1,
      padding: "0.5rem 0.875rem",
      borderRadius: "var(--radius-sm)",
      border: `1px solid ${accent?.border ?? "transparent"}`,
      background: accent?.bg ?? "var(--btn-primary-bg)",
      color: accent?.fg ?? "var(--btn-primary-fg)",
      fontSize: "0.8125rem",
      fontWeight: 800,
      cursor: "pointer",
      transition: "all 0.1s",
    };
  }
  return {
    padding: "0.5rem 0.875rem",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border)",
    background: "var(--surface-50)",
    color: "var(--text-muted)",
    fontSize: "0.8125rem",
    fontWeight: 700,
    cursor: "pointer",
  };
}

/** "2026-07-14" → "14.07.2026" */
function formatDueDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

/** ISO-Timestamp → Wert für <input type="datetime-local"> (lokale Zeit, ohne Zone). */
function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: "0.6875rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-subtle)",
  marginBottom: "0.35rem",
};

const fieldInput: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--surface-50)",
  border: "1px solid var(--border-bright)",
  borderRadius: "var(--radius-sm)",
  padding: "0.45rem 0.625rem",
  fontSize: "0.8125rem",
  color: "var(--text-primary)",
  outline: "none",
  fontFamily: "inherit",
};

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | null;
  options: { value: T; label: string; color?: string; bg?: string; border?: string }[];
  onChange: (v: T | null) => void;
}) {
  return (
    <div className="ui-segmented" style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
      {options.map((o) => {
        const active = value === o.value;
        const color = o.color ?? "var(--brand-500)";
        const bg = o.bg ?? "var(--brand-50)";
        const border = o.border ?? "var(--brand-200)";
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(active ? null : o.value)}
            style={{
              padding: "0.3rem 0.625rem",
              borderRadius: "var(--radius-sm)",
              border: `1px solid ${active ? border : "var(--border)"}`,
              background: active ? bg : "var(--surface-50)",
              color: active ? color : "var(--text-muted)",
              fontSize: "0.75rem",
              fontWeight: 700,
              cursor: "pointer",
              transition: "all 0.1s",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      className="ui-toggle"
      onClick={() => onChange(!value)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        padding: "0.3rem 0.625rem",
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${value ? "var(--color-success-border)" : "var(--border)"}`,
        background: value ? "var(--color-success-bg)" : "var(--surface-50)",
        color: value ? "var(--color-success-text)" : "var(--text-muted)",
        fontSize: "0.75rem",
        fontWeight: 700,
        cursor: "pointer",
        transition: "all 0.1s",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: value ? "var(--color-success-text)" : "var(--text-subtle)",
          flexShrink: 0,
        }}
      />
      {label}
    </button>
  );
}

function Scale10({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="ui-scale10" style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
        const active = value === n;
        const inRange = value != null && n <= value;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(active ? null : n)}
            style={{
              width: 26,
              height: 26,
              borderRadius: "var(--radius-xs)",
              border: `1px solid ${inRange ? "var(--brand-200)" : "var(--border)"}`,
              background: inRange ? "var(--brand-50)" : "var(--surface-50)",
              color: active ? "var(--brand-500)" : inRange ? "var(--brand-400)" : "var(--text-subtle)",
              fontSize: "0.6875rem",
              fontWeight: active ? 800 : 600,
              cursor: "pointer",
              transition: "all 0.1s",
              padding: 0,
            }}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

export function SettingCallEditor({ call, assignees, users, sourceNotes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [savedTick, setSavedTick] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Strukturierte Felder (lokaler State, Autosave)
  const [status, setStatus] = useState<SettingStatus>(call.status);
  const [followUpDue, setFollowUpDue] = useState<string | null>(call.follow_up_due);
  const [budget, setBudget] = useState<"ja" | "nein" | "unklar" | null>(call.has_budget_8k);
  const [soleDecider, setSoleDecider] = useState<boolean>(Boolean(call.sole_decider));
  const [canDecideNow, setCanDecideNow] = useState<boolean>(Boolean(call.can_decide_now));
  const [clearNeed, setClearNeed] = useState<boolean>(Boolean(call.clear_need));
  const [istPain, setIstPain] = useState<number | null>(call.ist_pain == null ? null : Number(call.ist_pain));
  const [warmth, setWarmth] = useState<number | null>(call.warmth == null ? null : Number(call.warmth));
  const [branche, setBranche] = useState<SettingCall["branche"]>(call.branche);
  const [offerType, setOfferType] = useState(call.offer_type ?? "");
  const [sollZiel, setSollZiel] = useState(call.soll_ziel ?? "");
  const [objectionsHandled, setObjectionsHandled] = useState(call.objections_handled ?? "");
  const [objectionsOpen, setObjectionsOpen] = useState(call.objections_open ?? "");
  const [recordingLink, setRecordingLink] = useState(call.recording_link ?? "");
  const [notes, setNotes] = useState(call.notes ?? "");
  const [closingDone, setClosingDone] = useState(call.status === "closing_gelegt");
  // Id des angelegten Closings (nach createClosingFromSetting bekannt; bei
  // bereits "closing_gelegt" auf Mount unbekannt → wird beim Klick idempotent
  // über createClosingFromSetting aufgelöst).
  const [closingId, setClosingId] = useState<string | null>(null);
  const lastSavedNotesRef = useRef(call.notes ?? "");

  // Nachfass-Dialog (No-Show / Unqualifiziert) + Neuterminierung nach No-Show
  const [followUpModal, setFollowUpModal] = useState<FollowUpOutcome | null>(null);
  const [followUpDate, setFollowUpDate] = useState("");
  const [skipFollowUp, setSkipFollowUp] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleAt, setRescheduleAt] = useState(toDatetimeLocal(call.appointment_at));
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  function flashSaved() {
    setSavedTick(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSavedTick(false), 2200);
  }

  function save(patch: SettingCallPatch, opts?: { refresh?: boolean }) {
    startTransition(async () => {
      const res = await updateSettingCall(call.id, patch);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setError(null);
      flashSaved();
      if (opts?.refresh) router.refresh();
    });
  }

  function openFollowUpModal(outcome: FollowUpOutcome) {
    setModalError(null);
    setSkipFollowUp(false);
    setFollowUpDate(followUpDue ?? addDaysISO(localDateISO(), FOLLOW_UP_DEFAULT_DAYS[outcome]));
    setFollowUpModal(outcome);
  }

  function submitFollowUpOutcome(outcome: FollowUpOutcome) {
    if (!skipFollowUp && !followUpDate) {
      setModalError("Bitte ein Datum wählen oder „Kein Nachfassen“ ankreuzen.");
      return;
    }
    const due = skipFollowUp ? null : followUpDate;
    startTransition(async () => {
      const res = await setSettingOutcome({ settingId: call.id, outcome, followUpDue: due });
      if (res?.error) {
        setModalError(res.error);
        return;
      }
      setStatus(outcome);
      setFollowUpDue(due);
      setFollowUpModal(null);
      setError(null);
      flashSaved();
      router.refresh();
    });
  }

  function handleDead() {
    startTransition(async () => {
      const res = await setSettingOutcome({ settingId: call.id, outcome: "dead" });
      if (res?.error) {
        setError(res.error);
        return;
      }
      setStatus("dead");
      setFollowUpDue(null);
      setError(null);
      flashSaved();
      router.refresh();
    });
  }

  // Neuer Termin nach No-Show: derselbe Datensatz, Status zurück auf "offen".
  // no_show_count bleibt serverseitig stehen, damit die Show-Quote ehrlich bleibt.
  function handleReschedule() {
    if (!rescheduleAt) {
      setModalError("Bitte einen neuen Termin angeben.");
      return;
    }
    startTransition(async () => {
      const res = await rescheduleSetting(call.id, rescheduleAt);
      if (res?.error) {
        setModalError(res.error);
        return;
      }
      setStatus("offen");
      setFollowUpDue(null);
      setRescheduleOpen(false);
      setError(null);
      flashSaved();
      router.refresh();
    });
  }

  function handleCreateClosing() {
    startTransition(async () => {
      const res = await createClosingFromSetting(call.id);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setError(null);
      setClosingDone(true);
      setStatus("closing_gelegt");
      setFollowUpDue(null);
      if (res.closingId) setClosingId(res.closingId);
      flashSaved();
      router.refresh();
    });
  }

  // "Zum Closing →": Id bekannt → direkt navigieren; sonst idempotent über
  // createClosingFromSetting auflösen (liefert die bestehende Closing-Id).
  function handleGoToClosing() {
    if (closingId) {
      router.push(`/closing/${closingId}`);
      return;
    }
    startTransition(async () => {
      const res = await createClosingFromSetting(call.id);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setError(null);
      setClosingDone(true);
      setStatus("closing_gelegt");
      if (res.closingId) {
        setClosingId(res.closingId);
        router.push(`/closing/${res.closingId}`);
      }
    });
  }

  const statusMeta = STATUS_META[status];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* ── Status-Aktionsleiste ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          flexWrap: "wrap",
          background: "var(--surface-100)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: "0.75rem 1rem",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            fontSize: "0.75rem",
            fontWeight: 800,
            color: statusMeta.color,
            background: statusMeta.bg,
            border: `1px solid ${statusMeta.border}`,
            borderRadius: 99,
            padding: "0.2rem 0.75rem",
          }}
        >
          {statusMeta.label}
        </span>

        <span style={{ flex: 1 }} />

        {savedTick && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.25rem",
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "var(--color-success-text)",
            }}
          >
            <Check size={12} strokeWidth={3} /> Gespeichert
          </span>
        )}

        <button
          type="button"
          onClick={() => openFollowUpModal("no_show")}
          disabled={isPending}
          style={outcomeButton(status === "no_show", STATUS_META.no_show)}
        >
          Nicht erschienen
        </button>
        <button
          type="button"
          onClick={() => openFollowUpModal("unqualifiziert")}
          disabled={isPending}
          style={outcomeButton(status === "unqualifiziert", STATUS_META.unqualifiziert)}
        >
          Unqualifiziert
        </button>
        <button
          type="button"
          onClick={handleDead}
          disabled={isPending}
          style={outcomeButton(status === "dead", STATUS_META.dead)}
        >
          Dead
        </button>

        {closingDone ? (
          <>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.375rem",
                padding: "0.4rem 0.875rem",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-success-border)",
                background: "var(--color-success-bg)",
                color: "var(--color-success-text)",
                fontSize: "0.75rem",
                fontWeight: 800,
              }}
            >
              <Check size={13} strokeWidth={3} /> Closing angelegt
            </span>
            <button
              type="button"
              onClick={handleGoToClosing}
              disabled={isPending}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.375rem",
                padding: "0.4rem 0.875rem",
                borderRadius: "var(--radius-sm)",
                border: "1px solid transparent",
                background: "var(--btn-primary-bg)",
                color: "var(--btn-primary-fg)",
                fontSize: "0.75rem",
                fontWeight: 800,
                cursor: "pointer",
                opacity: isPending ? 0.7 : 1,
                transition: "all 0.1s",
              }}
            >
              Zum Closing <ArrowRight size={13} strokeWidth={2.5} />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handleCreateClosing}
            disabled={isPending}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.375rem",
              padding: "0.4rem 0.875rem",
              borderRadius: "var(--radius-sm)",
              border: "1px solid transparent",
              background: "var(--btn-primary-bg)",
              color: "var(--btn-primary-fg)",
              fontSize: "0.75rem",
              fontWeight: 800,
              cursor: "pointer",
              opacity: isPending ? 0.7 : 1,
              transition: "all 0.1s",
            }}
          >
            Qualifiziert <ArrowRight size={13} strokeWidth={2.5} /> Closing
          </button>
        )}
      </div>

      {/* ── No-Show: Wiedervorlage + Neuterminierung ── */}
      {status === "no_show" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            flexWrap: "wrap",
            background: "var(--color-error-bg)",
            border: "1px solid var(--color-error-border)",
            borderRadius: "var(--radius-lg)",
            padding: "0.75rem 1rem",
          }}
        >
          <UserX size={16} style={{ color: "var(--color-error-text)", flexShrink: 0 }} />
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <div style={{ fontSize: "0.8125rem", fontWeight: 800, color: "var(--color-error-text)" }}>
              Lead ist nicht erschienen
              {call.no_show_count > 1 && ` · ${call.no_show_count}× No-Show`}
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {followUpDue
                ? `Nachfassen am ${formatDueDate(followUpDue)} — steht im Nachfassen-Board.`
                : "Kein Nachfassen gesetzt."}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setModalError(null);
              setRescheduleOpen(true);
            }}
            disabled={isPending}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.375rem",
              padding: "0.4rem 0.875rem",
              borderRadius: "var(--radius-sm)",
              border: "1px solid transparent",
              background: "var(--btn-primary-bg)",
              color: "var(--btn-primary-fg)",
              fontSize: "0.75rem",
              fontWeight: 800,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <CalendarClock size={13} /> Neuen Termin setzen
          </button>
        </div>
      )}

      {/* ── Unqualifiziert mit Wiedervorlage ── */}
      {status === "unqualifiziert" && followUpDue && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            background: "var(--color-warning-bg)",
            border: "1px solid var(--color-warning-border)",
            borderRadius: "var(--radius-lg)",
            padding: "0.625rem 1rem",
            fontSize: "0.8125rem",
            fontWeight: 600,
            color: "var(--color-warning-text)",
          }}
        >
          <CalendarClock size={14} style={{ flexShrink: 0 }} />
          Nachfassen am {formatDueDate(followUpDue)} — steht im Nachfassen-Board.
        </div>
      )}

      {error && (
        <div
          style={{
            background: "var(--color-error-bg)",
            border: "1px solid var(--color-error-border)",
            color: "var(--color-error-text)",
            borderRadius: "var(--radius-md)",
            padding: "0.625rem 0.875rem",
            fontSize: "0.8125rem",
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      {/* ── Zwei Spalten: Script links, Qualifikation rechts ── */}
      <div style={{ display: "flex", gap: "1.25rem", alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* ── Hauptspalte: Script-Runner + Zusatznotizen ── */}
        <div style={{ flex: "1 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div
            style={{
              background: "var(--surface-100)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              padding: "1.5rem 1.5rem 1.75rem",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <ScriptRunner
              blocks={SETTING_BLOCKS}
              initial={call.script_answers ?? {}}
              onSave={(answers) => updateSettingCall(call.id, { script_answers: answers })}
            />
          </div>

          {/* ── Zusatznotizen (bewusst prominent & großzügig) ── */}
          <div
            style={{
              background: "var(--surface-100)",
              border: "1px solid var(--border-bright)",
              borderRadius: "var(--radius-lg)",
              padding: "1.25rem 1.5rem 1.5rem",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
              <FileText size={15} style={{ color: "var(--brand-500)" }} />
              <span style={{ fontSize: "1rem", fontWeight: 800, letterSpacing: "-0.01em", color: "var(--text-primary)" }}>
                Zusatznotizen
              </span>
            </div>
            <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", margin: "0 0 0.625rem" }}>
              Alles, was nicht ins Script passt — frei notieren.
            </p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => {
                if (notes !== lastSavedNotesRef.current) {
                  lastSavedNotesRef.current = notes;
                  save({ notes: notes || null });
                }
              }}
              placeholder="Freie Notizen zum Call…"
              rows={8}
              style={{
                width: "100%",
                boxSizing: "border-box",
                minHeight: 180,
                resize: "vertical",
                background: "var(--surface-50)",
                border: "1px solid var(--border-bright)",
                borderRadius: "var(--radius-md)",
                padding: "0.875rem 1rem",
                fontSize: "0.9375rem",
                lineHeight: 1.6,
                color: "var(--text-primary)",
                outline: "none",
                fontFamily: "inherit",
              }}
            />
          </div>
        </div>

        {/* ── Sidebar: Zuweisung + Qualifikation (sticky) ── */}
        <div
          style={{
            flex: "1 1 300px",
            maxWidth: 400,
            position: "sticky",
            top: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
          }}
        >
          {/* Zuweisung */}
          <div
            style={{
              background: "var(--surface-100)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              padding: "1rem 1.125rem",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.625rem" }}>
              <Users size={14} style={{ color: "var(--text-subtle)" }} />
              <span style={{ fontSize: "0.8125rem", fontWeight: 800, color: "var(--text-primary)" }}>Zuweisung</span>
            </div>
            <AssigneeMultiSelect entityType="setting_call" entityId={call.id} users={users} initial={assignees} />
          </div>

          {/* Qualifikation */}
          <div
            style={{
              background: "var(--surface-100)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              padding: "1rem 1.125rem",
              boxShadow: "var(--shadow-sm)",
              display: "flex",
              flexDirection: "column",
              gap: "0.875rem",
            }}
          >
            <span style={{ fontSize: "0.8125rem", fontWeight: 800, color: "var(--text-primary)" }}>Qualifikation</span>

            {/* Show-Status wird aus dem Ergebnis abgeleitet, nicht mehr hier gepflegt. */}

            <div>
              <span style={fieldLabel}>Budget (8k+)</span>
              <Segmented
                value={budget}
                options={[
                  {
                    value: "ja",
                    label: "Ja",
                    color: "var(--color-success-text)",
                    bg: "var(--color-success-bg)",
                    border: "var(--color-success-border)",
                  },
                  {
                    value: "nein",
                    label: "Nein",
                    color: "var(--color-error-text)",
                    bg: "var(--color-error-bg)",
                    border: "var(--color-error-border)",
                  },
                  {
                    value: "unklar",
                    label: "Unklar",
                    color: "var(--color-warning-text)",
                    bg: "var(--color-warning-bg)",
                    border: "var(--color-warning-border)",
                  },
                ]}
                onChange={(v) => {
                  setBudget(v);
                  save({ has_budget_8k: v });
                }}
              />
            </div>

            <div>
              <span style={fieldLabel}>Entscheidung</span>
              <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
                <Toggle
                  value={soleDecider}
                  onChange={(v) => {
                    setSoleDecider(v);
                    save({ sole_decider: v });
                  }}
                  label="Alleiniger Entscheider"
                />
                <Toggle
                  value={canDecideNow}
                  onChange={(v) => {
                    setCanDecideNow(v);
                    save({ can_decide_now: v });
                  }}
                  label="Kann jetzt entscheiden"
                />
                <Toggle
                  value={clearNeed}
                  onChange={(v) => {
                    setClearNeed(v);
                    save({ clear_need: v });
                  }}
                  label="Klarer Bedarf"
                />
              </div>
            </div>

            <div>
              <span style={fieldLabel}>Branche</span>
              <Segmented
                value={branche}
                options={[
                  { value: "agentur", label: "Agentur" },
                  { value: "coach", label: "Coach" },
                  { value: "consultant", label: "Consultant" },
                  { value: "sonstiges", label: "Sonstiges" },
                ]}
                onChange={(v) => {
                  setBranche(v);
                  save({ branche: v });
                }}
              />
            </div>

            <div>
              <span style={fieldLabel}>Angebot / Offer</span>
              <input
                type="text"
                value={offerType}
                onChange={(e) => setOfferType(e.target.value)}
                onBlur={() => save({ offer_type: offerType || null })}
                placeholder="z. B. SEO-Retainer, Funnel-Build…"
                style={fieldInput}
              />
            </div>

            <div>
              <span style={fieldLabel}>Ist-Pain (1–10)</span>
              <Scale10
                value={istPain}
                onChange={(v) => {
                  setIstPain(v);
                  save({ ist_pain: v });
                }}
              />
            </div>

            <div>
              <span style={fieldLabel}>Wärme (1–10)</span>
              <Scale10
                value={warmth}
                onChange={(v) => {
                  setWarmth(v);
                  save({ warmth: v });
                }}
              />
            </div>

            <div>
              <span style={fieldLabel}>Soll-Ziel</span>
              <input
                type="text"
                value={sollZiel}
                onChange={(e) => setSollZiel(e.target.value)}
                onBlur={() => save({ soll_ziel: sollZiel || null })}
                placeholder="Wo will er hin?"
                style={fieldInput}
              />
            </div>

            <div>
              <span style={fieldLabel}>Einwände behandelt</span>
              <textarea
                value={objectionsHandled}
                onChange={(e) => setObjectionsHandled(e.target.value)}
                onBlur={() => save({ objections_handled: objectionsHandled || null })}
                placeholder="Welche Einwände kamen — und wie behandelt?"
                rows={3}
                style={{ ...fieldInput, resize: "vertical", lineHeight: 1.5 }}
              />
            </div>

            <div>
              <span style={fieldLabel}>Einwände offen</span>
              <textarea
                value={objectionsOpen}
                onChange={(e) => setObjectionsOpen(e.target.value)}
                onBlur={() => save({ objections_open: objectionsOpen || null })}
                placeholder="Was ist noch nicht ausgeräumt?"
                rows={3}
                style={{ ...fieldInput, resize: "vertical", lineHeight: 1.5 }}
              />
            </div>

            <div>
              <span style={fieldLabel}>Aufzeichnung (Link)</span>
              <input
                type="url"
                value={recordingLink}
                onChange={(e) => setRecordingLink(e.target.value)}
                onBlur={() => save({ recording_link: recordingLink || null })}
                placeholder="https://…"
                style={fieldInput}
              />
            </div>
          </div>

          {/* Kontext aus der Quelle (read-only) */}
          {sourceNotes && sourceNotes.length > 0 && (
            <div
              style={{
                background: "var(--color-info-bg)",
                border: "1px solid var(--color-info-border)",
                borderRadius: "var(--radius-lg)",
                padding: "1rem 1.125rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.625rem" }}>
                <MessageSquareQuote size={14} style={{ color: "var(--color-info-text)" }} />
                <span style={{ fontSize: "0.8125rem", fontWeight: 800, color: "var(--color-info-text)" }}>
                  Aus {call.source_type === "telefon" ? "Telefon" : "LinkedIn"}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {sourceNotes.map((n) => (
                  <div key={n.label}>
                    <span style={{ ...fieldLabel, marginBottom: "0.2rem" }}>{n.label}</span>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "0.8125rem",
                        lineHeight: 1.55,
                        color: "var(--text-secondary)",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {n.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Modal: Ergebnis mit Wiedervorlage (No-Show / Unqualifiziert) ── */}
      <Modal
        open={followUpModal != null}
        onClose={() => setFollowUpModal(null)}
        title={followUpModal ? FOLLOW_UP_COPY[followUpModal].title : ""}
        subtitle={followUpModal ? FOLLOW_UP_COPY[followUpModal].subtitle : undefined}
      >
        {followUpModal && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
            <div>
              <span style={fieldLabel}>Nachfassen am</span>
              <input
                type="date"
                value={followUpDate}
                disabled={skipFollowUp}
                onChange={(e) => setFollowUpDate(e.target.value)}
                style={{ ...fieldInput, opacity: skipFollowUp ? 0.5 : 1 }}
              />
            </div>

            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                fontSize: "0.8125rem",
                fontWeight: 600,
                color: "var(--text-secondary)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={skipFollowUp}
                onChange={(e) => setSkipFollowUp(e.target.checked)}
                style={{ cursor: "pointer" }}
              />
              Kein Nachfassen
            </label>

            {modalError && (
              <div
                style={{
                  background: "var(--color-error-bg)",
                  border: "1px solid var(--color-error-border)",
                  color: "var(--color-error-text)",
                  borderRadius: "var(--radius-sm)",
                  padding: "0.5rem 0.75rem",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                }}
              >
                {modalError}
              </div>
            )}

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
              <button
                type="button"
                disabled={isPending}
                onClick={() => submitFollowUpOutcome(followUpModal)}
                style={{
                  ...modalButton("primary", {
                    bg: STATUS_META[followUpModal].bg,
                    fg: STATUS_META[followUpModal].color,
                    border: STATUS_META[followUpModal].border,
                  }),
                  opacity: isPending ? 0.6 : 1,
                }}
              >
                {FOLLOW_UP_COPY[followUpModal].submit}
              </button>
              <button type="button" onClick={() => setFollowUpModal(null)} style={modalButton("ghost")}>
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Modal: Neuen Termin nach No-Show setzen ── */}
      <Modal
        open={rescheduleOpen}
        onClose={() => setRescheduleOpen(false)}
        title="Neuen Termin setzen"
        subtitle="Der Call geht zurück auf „Offen“. Der No-Show bleibt in der Auswertung erhalten."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          <div>
            <span style={fieldLabel}>Neuer Termin *</span>
            <input
              type="datetime-local"
              value={rescheduleAt}
              onChange={(e) => setRescheduleAt(e.target.value)}
              style={fieldInput}
            />
          </div>

          {modalError && (
            <div
              style={{
                background: "var(--color-error-bg)",
                border: "1px solid var(--color-error-border)",
                color: "var(--color-error-text)",
                borderRadius: "var(--radius-sm)",
                padding: "0.5rem 0.75rem",
                fontSize: "0.75rem",
                fontWeight: 600,
              }}
            >
              {modalError}
            </div>
          )}

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
            <button
              type="button"
              disabled={isPending || !rescheduleAt}
              onClick={handleReschedule}
              style={{ ...modalButton("primary"), opacity: isPending || !rescheduleAt ? 0.6 : 1 }}
            >
              Termin speichern
            </button>
            <button type="button" onClick={() => setRescheduleOpen(false)} style={modalButton("ghost")}>
              Abbrechen
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
