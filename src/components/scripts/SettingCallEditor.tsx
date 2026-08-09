"use client";

import {
  createClosingFromSetting,
  rescheduleSetting,
  setSettingOutcome,
  updateSettingCall,
  deleteSettingCall,
  type SettingCallPatch,
} from "@/app/actions/settingCalls";
import { AssigneeSelect } from "@/components/assignees/AssigneeSelect";
import { DangerZone } from "@/components/ui/DangerZone";
import { ScriptRunner } from "@/components/scripts/ScriptRunner";
import { Modal } from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { DatePicker } from "@/components/ui/DatePicker";
import { DateTimeField } from "@/components/ui/DateTimeField";
import { berlinInputToIso, isoToBerlinInput } from "@/lib/apptTime";
import { channelLabel } from "@/lib/channels";
import { addDaysISO, localDateISO } from "@/lib/dates";
import { LEGACY_SETTING_BLOCKS, SETTING_BLOCKS, SETTING_GOLD_BLOCKS } from "@/lib/scripts";
import { SETTING_STATUS_LABEL } from "@/lib/settingLabels";
import type { SettingCall, SettingStatus } from "@/lib/types";
import { ArrowRight, CalendarClock, Check, ChevronRight, FileText, MessageSquareQuote, RotateCcw, UserX, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

// Setting-Call-Editor: eine Spalte — Aktionsleiste (Show/No-Show/Unqualifiziert/
// Verlegen/Dead/Closing), Zuweisung, Quell-Kontext, Script-Runner, ganz unten
// Aufzeichnungs-Link + Notizen. Alles speichert automatisch (Blur bzw. Klick)
// via updateSettingCall.
//
// Das Ergebnis (Nicht erschienen / Qualifiziert / Unqualifiziert / Dead) läuft
// dagegen über setSettingOutcome — es leitet den Show-Status ab und setzt die
// Wiedervorlage, statt beides getrennt pflegen zu lassen. "Show" ist die
// Ausnahme: es markiert nur die Anwesenheit (show_status), ohne den Status
// anzufassen — gedacht zum sofortigen Klick beim Call-Start.

type UserOption = { user_id: string; username: string };

type Props = {
  call: SettingCall;
  users: UserOption[];
  /** Nur Admins duerfen umverteilen; alle anderen sehen die Zuordnung fest. */
  canAssign?: boolean;
  /** Name zu call.assigned_user_id — aufgeloest auf der Seite. */
  assignedName?: string | null;
  /** Wer den Termin angelegt hat — Anzeige-Fallback ohne Zuweisung. */
  creatorName?: string | null;
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

// Statusfarben der Aktionsleiste. Die Labels kommen aus der geteilten
// Label-Datei, damit Setting- und Closing-Ansicht nie auseinanderlaufen.
const STATUS_META: Record<SettingStatus, { label: string; color: string; bg: string; border: string }> = {
  offen: { label: SETTING_STATUS_LABEL.offen, color: "var(--text-muted)", bg: "var(--surface-150)", border: "var(--border)" },
  no_show: {
    label: SETTING_STATUS_LABEL.no_show,
    color: "var(--color-error-text)",
    bg: "var(--color-error-bg)",
    border: "var(--color-error-border)",
  },
  qualifiziert: {
    label: SETTING_STATUS_LABEL.qualifiziert,
    color: "var(--color-success-text)",
    bg: "var(--color-success-bg)",
    border: "var(--color-success-border)",
  },
  closing_gelegt: {
    label: SETTING_STATUS_LABEL.closing_gelegt,
    color: "var(--color-info-text)",
    bg: "var(--color-info-bg)",
    border: "var(--color-info-border)",
  },
  unqualifiziert: {
    label: SETTING_STATUS_LABEL.unqualifiziert,
    color: "var(--color-warning-text)",
    bg: "var(--color-warning-bg)",
    border: "var(--color-warning-border)",
  },
  dead: {
    label: SETTING_STATUS_LABEL.dead,
    color: "var(--color-error-text)",
    bg: "var(--color-error-bg)",
    border: "var(--color-error-border)",
  },
};

function modalButton(kind: "primary" | "ghost", accent?: { bg: string; fg: string; border: string }): React.CSSProperties {
  if (kind === "primary") {
    return {
      flex: 1,
      minHeight: "var(--h-control-lg)",
      padding: "0 var(--sp-7)",
      borderRadius: "var(--r-full)",
      border: `1px solid ${accent?.border ?? "transparent"}`,
      background: accent?.bg ?? "var(--grad-cta)",
      color: accent?.fg ?? "var(--text-on-accent)",
      boxShadow: accent ? undefined : "var(--shadow-btn-primary)",
      fontSize: "var(--fs-base)",
      fontFamily: "inherit",
      fontWeight: 600,
      cursor: "pointer",
      transition: "all 0.1s",
    };
  }
  return {
    minHeight: "var(--h-control-lg)",
    padding: "0 var(--sp-7)",
    borderRadius: "var(--r-full)",
    border: "1px solid var(--border-default)",
    background: "var(--surface-2)",
    color: "var(--text-secondary)",
    fontSize: "var(--fs-base)",
    fontFamily: "inherit",
    fontWeight: 500,
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

// Termin-Konvertierung läuft zentral über apptTime (Berlin, nicht Browser-Zone).
const toDatetimeLocal = isoToBerlinInput;

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: "0.6875rem",
  fontWeight: 600,
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

export function SettingCallEditor({
  call,
  users,
  canAssign = false,
  assignedName = null,
  creatorName = null,
  sourceNotes,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [savedTick, setSavedTick] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { confirm, dialog } = useConfirm();

  // Strukturierte Felder (lokaler State, Autosave)
  const [status, setStatus] = useState<SettingStatus>(call.status);
  const [showStatus, setShowStatus] = useState<"show" | "no_show" | null>(call.show_status);
  const [followUpDue, setFollowUpDue] = useState<string | null>(call.follow_up_due);
  const [recordingLink, setRecordingLink] = useState(call.recording_link ?? "");
  const [notes, setNotes] = useState(call.notes ?? "");
  const [closingDone, setClosingDone] = useState(call.status === "closing_gelegt");
  // Id des angelegten Closings (nach createClosingFromSetting bekannt; bei
  // bereits "closing_gelegt" auf Mount unbekannt → wird beim Klick idempotent
  // über createClosingFromSetting aufgelöst).
  const [closingId, setClosingId] = useState<string | null>(null);
  const lastSavedNotesRef = useRef(call.notes ?? "");

  // Nachfass-Dialog (No-Show / Unqualifiziert) + Neuterminierung
  const [followUpModal, setFollowUpModal] = useState<FollowUpOutcome | null>(null);
  const [followUpDate, setFollowUpDate] = useState("");
  const [skipFollowUp, setSkipFollowUp] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleAt, setRescheduleAt] = useState(toDatetimeLocal(call.appointment_at));
  const [modalError, setModalError] = useState<string | null>(null);
  // Closing-Termin: Pflichtangabe beim Anlegen — ohne ihn taucht das Closing
  // weder im Kalender noch in der Wochenplanung auf.
  const [closingModalOpen, setClosingModalOpen] = useState(false);
  const [closingAt, setClosingAt] = useState(toDatetimeLocal(call.closing_at));

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

  // Anwesenheit ist ein Schalter, kein Dialog: man traegt sie beim Call-Start
  // ein und will sie korrigieren koennen, ohne durch ein Modal zu muessen.
  //
  // "Nicht erschienen" setzt deshalb direkt Status + Wiedervorlage (morgen)
  // und zaehlt den No-Show hoch — sonst faellt der Lead aus dem Nachfassen-
  // Board. Zurueck auf "Show" nimmt Status und Wiedervorlage wieder weg;
  // no_show_count bleibt bewusst stehen, das ist Historie fuer die Show-Quote.
  function handleMarkShow() {
    setShowStatus("show");
    if (status === "no_show") {
      setStatus("offen");
      setFollowUpDue(null);
      save({ show_status: "show", status: "offen", follow_up_due: null }, { refresh: true });
    } else {
      save({ show_status: "show" });
    }
  }

  // Alles zuruecksetzen, was das ERGEBNIS beschreibt — Script-Antworten,
  // Notizen, Aufzeichnung und Termin bleiben stehen. Das ist Arbeit, kein
  // Ergebnis, und wer sich beim Ausgang vertippt hat will die nicht verlieren.
  //
  // no_show_count geht bewusst MIT auf 0: der Reset ist die Korrektur eines
  // Fehleintrags, ein Phantom-No-Show wuerde sonst dauerhaft die Show-Quote
  // in /analyse verfaelschen.
  async function handleReset() {
    const ok = await confirm({
      title: "Ergebnis zurücksetzen?",
      message:
        "Anwesenheit, Status und Wiedervorlage werden geleert, der Call steht wieder auf „Offen“. Script-Antworten, Notizen und der Termin bleiben erhalten.",
      confirmLabel: "Zurücksetzen",
      destructive: true,
    });
    if (!ok) return;
    setStatus("offen");
    setShowStatus(null);
    setFollowUpDue(null);
    save({ status: "offen", show_status: null, follow_up_due: null, no_show_count: 0 }, { refresh: true });
  }

  function handleMarkNoShow() {
    const due = addDaysISO(localDateISO(), FOLLOW_UP_DEFAULT_DAYS.no_show);
    startTransition(async () => {
      const res = await setSettingOutcome({ settingId: call.id, outcome: "no_show", followUpDue: due });
      if (res?.error) {
        setError(res.error);
        return;
      }
      setStatus("no_show");
      setShowStatus("no_show");
      setFollowUpDue(due);
      setError(null);
      flashSaved();
      router.refresh();
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
      setShowStatus(outcome === "no_show" ? "no_show" : "show");
      setFollowUpDue(due);
      setFollowUpModal(null);
      setError(null);
      flashSaved();
      router.refresh();
    });
  }

  // Termin verlegen: derselbe Datensatz, Status zurück auf "offen".
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
      setShowStatus(null);
      setFollowUpDue(null);
      setRescheduleOpen(false);
      setError(null);
      flashSaved();
      router.refresh();
    });
  }

  function openClosingModal() {
    setModalError(null);
    setClosingModalOpen(true);
  }

  /** Legt das Closing an — nur aus dem Modal heraus, also immer mit Termin. */
  function handleCreateClosing() {
    const iso = berlinInputToIso(closingAt);
    if (!iso) {
      setModalError("Bitte einen Termin für das Closing angeben.");
      return;
    }
    startTransition(async () => {
      const res = await createClosingFromSetting(call.id, iso);
      if (res?.error) {
        setModalError(res.error);
        return;
      }
      setModalError(null);
      setError(null);
      setClosingModalOpen(false);
      setClosingDone(true);
      setStatus("closing_gelegt");
      setShowStatus("show");
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
      if (res?.needsDate) {
        // Status sagt „closing_gelegt", es gibt aber keins — dann hier anlegen.
        openClosingModal();
        return;
      }
      if (res?.error) {
        setError(res.error);
        return;
      }
      setError(null);
      setClosingDone(true);
      setStatus("closing_gelegt");
      setShowStatus("show");
      if (res.closingId) {
        setClosingId(res.closingId);
        router.push(`/closing/${res.closingId}`);
      }
    });
  }

  const statusMeta = STATUS_META[status];

  // Antworten auf Bloecke, die es im aktuellen Skript nicht mehr gibt.
  const legacyAnswers = LEGACY_SETTING_BLOCKS.map((b) => ({
    key: b.key,
    label: b.label,
    value: (call.script_answers?.[b.key] ?? "").trim(),
  })).filter((e) => e.value.length > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* ── Aktionsleiste ── */}
      <div
        className="card"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-5)",
          flexWrap: "wrap",
          padding: "var(--sp-5) var(--sp-7)",
        }}
      >
        {/* Links: Anwesenheit als frei umschaltbarer Selektor. */}
        <span className="eyebrow eyebrow-muted">Anwesenheit</span>
        <div className="show-group" role="group" aria-label="Anwesenheit">
          <button
            type="button"
            className="show-seg"
            data-tone="show"
            data-active={showStatus === "show"}
            aria-pressed={showStatus === "show"}
            onClick={handleMarkShow}
            disabled={isPending}
          >
            Erschienen
          </button>
          <button
            type="button"
            className="show-seg"
            data-tone="noshow"
            data-active={showStatus === "no_show"}
            aria-pressed={showStatus === "no_show"}
            onClick={handleMarkNoShow}
            disabled={isPending}
          >
            Nicht erschienen
          </button>
        </div>

        <span className="badge" style={{ color: statusMeta.color, backgroundColor: statusMeta.bg, border: `1px solid ${statusMeta.border}` }}>
          {statusMeta.label}
        </span>

        {/* Korrektur-Ausgang, bewusst leise: er steht neben dem Status, nicht
            bei den Aktionen. Bei angelegtem Closing gesperrt — sonst haenge
            das Closing an einem Setting, das wieder auf „Offen“ steht. */}
        <button
          type="button"
          className="ui-btn"
          data-variant="ghost"
          onClick={handleReset}
          disabled={isPending || status === "closing_gelegt"}
          title={
            status === "closing_gelegt"
              ? "Nicht möglich, solange ein Closing an diesem Setting hängt"
              : "Ergebnis zurücksetzen"
          }
          style={{ minHeight: 28, padding: "0 var(--sp-5)", fontSize: "var(--fs-sm)" }}
        >
          <RotateCcw size={13} /> Zurücksetzen
        </button>

        <span style={{ flex: 1 }} />

        {savedTick && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--sp-2)",
              fontSize: "var(--fs-xs)",
              color: "var(--success-fg)",
            }}
          >
            <Check size={12} /> Gespeichert
          </span>
        )}

        {/* Rechts: die drei Aktionen. Closing anlegen ist der eine CTA. */}
        <button
          type="button"
          className="outcome-btn"
          data-tone="lost"
          data-active={status === "unqualifiziert"}
          onClick={() => openFollowUpModal("unqualifiziert")}
          disabled={isPending}
        >
          Unqualifiziert
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setModalError(null);
            setRescheduleOpen(true);
          }}
          disabled={isPending || status === "closing_gelegt"}
          style={{ height: "var(--h-control-lg)" }}
        >
          <CalendarClock size={15} /> Verlegen
        </button>

        {closingDone ? (
          <>
            <span className="badge badge-green">
              <Check size={12} /> Closing angelegt
            </span>
            <button type="button" className="btn-primary" onClick={handleGoToClosing} disabled={isPending}>
              Zum Closing <ArrowRight size={15} />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={openClosingModal}
            disabled={isPending}
            className="btn-primary"
          >
            Closing anlegen <ArrowRight size={15} />
          </button>
        )}
      </div>

      {/* ── No-Show: Wiedervorlage ── */}
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
            <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--color-error-text)" }}>
              Lead ist nicht erschienen
              {call.no_show_count > 1 && ` · ${call.no_show_count}× No-Show`}
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {followUpDue
                ? `Nachfassen am ${formatDueDate(followUpDue)} — steht im Nachfassen-Board.`
                : "Kein Nachfassen gesetzt."}
            </div>
          </div>
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

      {/* ── Zuweisung ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
          background: "var(--surface-100)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: "0.875rem 1.125rem",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
          <Users size={14} style={{ color: "var(--text-subtle)" }} />
          <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary)" }}>Zuweisung</span>
        </div>
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          {/* Umverteilen ist Admin-Sache. Alle anderen sehen fest, wem der
              Termin gehoert — sonst zeigt die Zeile schlicht nichts. */}
          {canAssign ? (
            <AssigneeSelect
              entityType="setting_call"
              entityId={call.id}
              users={users}
              value={call.assigned_user_id}
            />
          ) : (
            <span style={{ fontSize: "var(--fs-base)", color: "var(--text-secondary)" }}>
              {assignedName ?? creatorName ?? "—"}
            </span>
          )}
        </div>
      </div>

      {/* ── Kontext aus der Quelle ──
          Die frühere blaue Karte ist weg (Vorgabe: „Antwort aus LinkedIn auch
          raus"). Die LinkedIn-Antwort des Leads wird gar nicht mehr geladen —
          sie stand doppelt: einmal hier und einmal in der Listenzeile, aus der
          der Termin entstand.

          Was bleibt, sind Notizen und Einwände aus dem TELEFON-Lead: die
          stehen sonst nirgends und wären für den, der den Call übernimmt, ein
          echter Verlust. Sie liegen deshalb still und eingeklappt hier statt
          in einer Karte, die durch ihre Farbe wichtiger wirkte als das
          Gespräch selbst. */}
      {sourceNotes && sourceNotes.length > 0 && (
        <details
          style={{
            background: "var(--surface-100)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: "0.75rem 1.125rem",
          }}
        >
          <summary
            className="collapse-summary"
            style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", cursor: "pointer", userSelect: "none" }}
          >
            <ChevronRight size={13} className="collapse-chevron" style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            <MessageSquareQuote size={14} style={{ color: "var(--text-muted)" }} />
            <span className="eyebrow eyebrow-muted">
              Kontext aus {channelLabel(call.source_type, "der Quelle")} ({sourceNotes.length})
            </span>
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.75rem" }}>
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
        </details>
      )}

      {/* ── Gesprächsgerüst ──
          Nur noch Überschriften (mode="outline"). Hinweistexte und Notizfelder
          je Block sind entfallen; vorhandene Antworten stehen weiter in
          `script_answers` und lassen sich am jeweiligen Block aufklappen. */}
      <div
        style={{
          background: "var(--surface-100)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: "1.5rem 1.5rem 1.75rem",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div className="eyebrow eyebrow-muted" style={{ marginBottom: "var(--sp-6)" }}>
          Gesprächsverlauf
        </div>
        <ScriptRunner
          mode="outline"
          blocks={SETTING_BLOCKS}
          highlight={{ title: "Gold Standards", blocks: SETTING_GOLD_BLOCKS }}
          initial={call.script_answers ?? {}}
          onSave={(answers) => updateSettingCall(call.id, { script_answers: answers })}
        />

        {/* Antworten aus fruheren Skript-Versionen (Gap, Konsequenz).
            Sie stehen weiter in script_answers und wuerden sonst still
            verschwinden — deshalb read-only ausgewiesen, eingeklappt. */}
        {legacyAnswers.length > 0 && (
          <details style={{ marginTop: "var(--sp-8)", borderTop: "1px solid var(--border-subtle)", paddingTop: "var(--sp-6)" }}>
            <summary
              className="collapse-summary"
              style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", cursor: "pointer", userSelect: "none" }}
            >
              <ChevronRight size={13} className="collapse-chevron" style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <span className="eyebrow eyebrow-muted">
                Aus früherer Skript-Version ({legacyAnswers.length})
              </span>
            </summary>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)", marginTop: "var(--sp-6)" }}>
              {legacyAnswers.map((e) => (
                <div key={e.key}>
                  <span
                    style={{
                      display: "block",
                      fontSize: "var(--fs-sm)",
                      fontWeight: 500,
                      color: "var(--text-secondary)",
                      marginBottom: "var(--sp-3)",
                    }}
                  >
                    {e.label}
                  </span>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "var(--fs-base)",
                      lineHeight: "var(--lh-base)",
                      color: "var(--text-muted)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {e.value}
                  </p>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* ── Aufzeichnung + Notizen (ganz unten) ── */}
      <div
        style={{
          background: "var(--surface-100)",
          border: "1px solid var(--border-bright)",
          borderRadius: "var(--radius-lg)",
          padding: "1.25rem 1.5rem 1.5rem",
          boxShadow: "var(--shadow-sm)",
          display: "flex",
          flexDirection: "column",
          gap: "1.25rem",
        }}
      >
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

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
            <FileText size={15} style={{ color: "var(--brand-500)" }} />
            <span style={{ fontSize: "1rem", fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text-primary)" }}>
              Notizen
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

      {/* ── Danger-Zone: Eintrag löschen ── */}
      <DangerZone
        title="Setting-Call löschen"
        description="Entfernt diesen Termin samt Script-Antworten und Notizen. Der Quell-Lead wird wieder auf „kein Termin“ zurückgesetzt."
        confirmTitle="Setting-Call löschen?"
        confirmMessage={
          closingDone
            ? "Das Gespräch wird endgültig gelöscht. Das daraus entstandene Closing bleibt bestehen, verliert aber seinen Bezug zu diesem Setting. Der Quell-Lead gilt wieder als „ohne Termin“."
            : "Das Gespräch wird endgültig gelöscht — Script-Antworten und Notizen inklusive. Der Quell-Lead gilt danach wieder als „ohne Termin“."
        }
        onDelete={() => deleteSettingCall(call.id)}
        redirectTo="/termine"
      />

      {dialog}

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
              <div style={{ opacity: skipFollowUp ? 0.5 : 1, pointerEvents: skipFollowUp ? "none" : undefined }}>
                <DatePicker
                  variant="input"
                  value={followUpDate || null}
                  onChange={(v) => setFollowUpDate(v ?? "")}
                  placeholder="Datum wählen"
                />
              </div>
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

      {/* ── Modal: Closing-Termin (Pflicht) ── */}
      <Modal
        open={closingModalOpen}
        onClose={() => setClosingModalOpen(false)}
        title="Closing anlegen"
        subtitle="Wann findet das Abschlussgespräch statt? Ohne Termin taucht das Closing im Kalender nicht auf."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          <div>
            <span style={fieldLabel}>Closing-Termin *</span>
            <DateTimeField value={closingAt} onChange={setClosingAt} ariaLabel="Closing-Termin" />
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
              disabled={isPending || !closingAt}
              onClick={handleCreateClosing}
              style={{ ...modalButton("primary"), opacity: isPending || !closingAt ? 0.6 : 1 }}
            >
              Closing anlegen
            </button>
            <button type="button" onClick={() => setClosingModalOpen(false)} style={modalButton("ghost")}>
              Abbrechen
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Modal: Termin verlegen ── */}
      <Modal
        open={rescheduleOpen}
        onClose={() => setRescheduleOpen(false)}
        title="Termin verlegen"
        subtitle="Der Call geht zurück auf „Offen“. Ein vorheriger No-Show bleibt in der Auswertung erhalten."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          <div>
            <span style={fieldLabel}>Neuer Termin *</span>
            <DateTimeField value={rescheduleAt} onChange={setRescheduleAt} ariaLabel="Neuer Termin" />
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
