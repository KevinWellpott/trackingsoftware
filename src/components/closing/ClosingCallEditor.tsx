"use client";

import { setClosingOutcome, updateClosingCall, type ClosingCallPatch } from "@/app/actions/closingCalls";
import { AssigneeMultiSelect } from "@/components/assignees/AssigneeMultiSelect";
import { ScriptRunner } from "@/components/scripts/ScriptRunner";
import { Modal } from "@/components/ui/Modal";
import { CLOSING_BLOCKS, SETTING_BLOCKS } from "@/lib/scripts";
import type { ClosingCall } from "@/lib/types";
import {
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  MessageSquareQuote,
  ThumbsDown,
  Trophy,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

// Closing-Call-Editor: Script-Runner + Zusatznotizen links, Zuweisung +
// Call-Details + read-only Setting-Kontext rechts (sticky). Terminal-
// Ergebnisse (Gewonnen / Verloren / Nachfassen) laufen über Modals →
// setClosingOutcome. Alles andere speichert automatisch (Blur bzw. Klick).

type UserOption = { user_id: string; username: string };

export type SettingContext = {
  script_answers: Record<string, string> | null;
  notes: string | null;
  ist_pain: number | null;
  warmth: number | null;
  soll_ziel: string | null;
  objections_handled: string | null;
  objections_open: string | null;
  has_budget_8k: "ja" | "nein" | "unklar" | null;
  branche: string | null;
};

type Props = {
  call: ClosingCall;
  assignees: UserOption[];
  users: UserOption[];
  settingContext: SettingContext | null;
};

const STATUS_META: Record<ClosingCall["status"], { label: string; color: string; bg: string; border: string }> = {
  offen: { label: "Offen", color: "var(--text-muted)", bg: "var(--surface-150)", border: "var(--border)" },
  gewonnen: {
    label: "Gewonnen",
    color: "var(--color-success-text)",
    bg: "var(--color-success-bg)",
    border: "var(--color-success-border)",
  },
  verloren: {
    label: "Verloren",
    color: "var(--color-error-text)",
    bg: "var(--color-error-bg)",
    border: "var(--color-error-border)",
  },
  nachfassen: {
    label: "Nachfassen",
    color: "var(--color-warning-text)",
    bg: "var(--color-warning-bg)",
    border: "var(--color-warning-border)",
  },
};

const BRANCHE_LABEL: Record<string, string> = {
  agentur: "Agentur",
  coach: "Coach",
  consultant: "Consultant",
  sonstiges: "Sonstiges",
};

const BUDGET_LABEL: Record<string, string> = { ja: "Ja", nein: "Nein", unklar: "Unklar" };

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

function formatEur(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(d)} Uhr`;
}

/** ISO-Timestamp → Wert für <input type="datetime-local"> (lokale Zeit). */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local-Wert → ISO-Timestamp (oder null bei leer/ungültig). */
function localInputToIso(value: string): string | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

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
    <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
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

function modalButton(kind: "primary" | "ghost", accent?: { bg: string; fg: string }): React.CSSProperties {
  if (kind === "primary") {
    return {
      flex: 1,
      padding: "0.5rem 0.875rem",
      borderRadius: "var(--radius-sm)",
      border: "1px solid transparent",
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
    transition: "all 0.1s",
  };
}

export function ClosingCallEditor({ call, assignees, users, settingContext }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [savedTick, setSavedTick] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Autosave-Felder (lokaler State)
  const [status, setStatus] = useState<ClosingCall["status"]>(call.status);
  const [callAt, setCallAt] = useState(isoToLocalInput(call.call_at));
  const [meetLink, setMeetLink] = useState(call.meet_link ?? "");
  const [showStatus, setShowStatus] = useState<"show" | "no_show" | null>(call.show_status);
  const [recordingLink, setRecordingLink] = useState(call.recording_link ?? "");
  const [objectionsHandled, setObjectionsHandled] = useState(call.objections_handled ?? "");
  const [objectionsOpen, setObjectionsOpen] = useState(call.objections_open ?? "");
  const [notes, setNotes] = useState(call.notes ?? "");
  const lastSavedNotesRef = useRef(call.notes ?? "");

  // Terminal-Modals
  const [wonOpen, setWonOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [followOpen, setFollowOpen] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Modal-Formularfelder
  const [dealVolume, setDealVolume] = useState(call.deal_volume == null ? "" : String(Number(call.deal_volume)));
  const [paymentType, setPaymentType] = useState(call.payment_type ?? "Einmal");
  const [contractStart, setContractStart] = useState(call.contract_start ? call.contract_start.slice(0, 10) : "");
  const [signatureReceived, setSignatureReceived] = useState<boolean>(Boolean(call.signature_received));
  const [lostReason, setLostReason] = useState(call.lost_reason ?? "");
  const [followUpDue, setFollowUpDue] = useState("");

  // Setting-Kontext: Script-Antworten ein-/ausklappbar
  const [settingScriptOpen, setSettingScriptOpen] = useState(false);

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

  function save(patch: ClosingCallPatch, opts?: { refresh?: boolean }) {
    startTransition(async () => {
      const res = await updateClosingCall(call.id, patch);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setError(null);
      flashSaved();
      if (opts?.refresh) router.refresh();
    });
  }

  function submitOutcome(
    outcome: "gewonnen" | "verloren" | "nachfassen",
    extra: Partial<Parameters<typeof setClosingOutcome>[0]>,
    close: () => void,
  ) {
    startTransition(async () => {
      const res = await setClosingOutcome({ closingId: call.id, outcome, ...extra });
      if (res?.error) {
        setModalError(res.error);
        return;
      }
      setModalError(null);
      setError(null);
      setStatus(outcome);
      close();
      flashSaved();
      router.refresh();
    });
  }

  const statusMeta = STATUS_META[status];
  const currentDealVolume = call.deal_volume == null ? null : Number(call.deal_volume);
  const followUpLabel = formatDateTime(call.follow_up_due);

  // Setting-Kontext aufbereiten
  const settingFacts: { label: string; value: string }[] = [];
  if (settingContext) {
    if (settingContext.has_budget_8k) {
      settingFacts.push({ label: "Budget (8k+)", value: BUDGET_LABEL[settingContext.has_budget_8k] ?? settingContext.has_budget_8k });
    }
    if (settingContext.branche) {
      settingFacts.push({ label: "Branche", value: BRANCHE_LABEL[settingContext.branche] ?? settingContext.branche });
    }
    if (settingContext.ist_pain != null) settingFacts.push({ label: "Ist-Pain", value: `${Number(settingContext.ist_pain)} / 10` });
    if (settingContext.warmth != null) settingFacts.push({ label: "Wärme", value: `${Number(settingContext.warmth)} / 10` });
    if (settingContext.soll_ziel?.trim()) settingFacts.push({ label: "Soll-Ziel", value: settingContext.soll_ziel });
  }
  const settingScriptEntries = settingContext?.script_answers
    ? SETTING_BLOCKS.map((b) => ({ label: b.label, value: settingContext.script_answers?.[b.key] ?? "" })).filter(
        (e) => e.value.trim().length > 0,
      )
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* ── Ergebnis-Aktionsleiste (terminal) ── */}
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

        {status === "gewonnen" && currentDealVolume != null && !Number.isNaN(currentDealVolume) && (
          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--color-success-text)" }}>
            {formatEur(currentDealVolume)}
            {call.payment_type ? ` · ${call.payment_type}` : ""}
          </span>
        )}
        {status === "nachfassen" && followUpLabel && (
          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--color-warning-text)" }}>
            Wiedervorlage: {followUpLabel}
          </span>
        )}
        {status === "verloren" && call.lost_reason?.trim() && (
          <span
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "var(--color-error-text)",
              maxWidth: 320,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={call.lost_reason}
          >
            Grund: {call.lost_reason}
          </span>
        )}

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
          onClick={() => {
            setModalError(null);
            setWonOpen(true);
          }}
          disabled={isPending}
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
            cursor: "pointer",
            transition: "all 0.1s",
            opacity: isPending ? 0.7 : 1,
          }}
        >
          <Trophy size={13} /> Gewonnen
        </button>
        <button
          type="button"
          onClick={() => {
            setModalError(null);
            setLostOpen(true);
          }}
          disabled={isPending}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
            padding: "0.4rem 0.875rem",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-error-border)",
            background: "var(--color-error-bg)",
            color: "var(--color-error-text)",
            fontSize: "0.75rem",
            fontWeight: 800,
            cursor: "pointer",
            transition: "all 0.1s",
            opacity: isPending ? 0.7 : 1,
          }}
        >
          <ThumbsDown size={13} /> Verloren
        </button>
        <button
          type="button"
          onClick={() => {
            setModalError(null);
            setFollowOpen(true);
          }}
          disabled={isPending}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
            padding: "0.4rem 0.875rem",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-warning-border)",
            background: "var(--color-warning-bg)",
            color: "var(--color-warning-text)",
            fontSize: "0.75rem",
            fontWeight: 800,
            cursor: "pointer",
            transition: "all 0.1s",
            opacity: isPending ? 0.7 : 1,
          }}
        >
          <CalendarClock size={13} /> Nachfassen
        </button>
      </div>

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

      {/* ── Zwei Spalten: Script links, Details + Setting-Kontext rechts ── */}
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
              blocks={CLOSING_BLOCKS}
              initial={call.script_answers ?? {}}
              onSave={(answers) => updateClosingCall(call.id, { script_answers: answers })}
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

        {/* ── Sidebar: Zuweisung + Call-Details + Setting-Kontext (sticky) ── */}
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
            <AssigneeMultiSelect entityType="closing_call" entityId={call.id} users={users} initial={assignees} />
          </div>

          {/* Call-Details */}
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
            <span style={{ fontSize: "0.8125rem", fontWeight: 800, color: "var(--text-primary)" }}>Call-Details</span>

            <div>
              <span style={fieldLabel}>Termin</span>
              <input
                type="datetime-local"
                value={callAt}
                onChange={(e) => setCallAt(e.target.value)}
                onBlur={() => {
                  if (callAt === isoToLocalInput(call.call_at)) return;
                  save({ call_at: localInputToIso(callAt) }, { refresh: true });
                }}
                style={fieldInput}
              />
            </div>

            <div>
              <span style={fieldLabel}>Google-Meet-Link</span>
              <input
                type="url"
                value={meetLink}
                onChange={(e) => setMeetLink(e.target.value)}
                onBlur={() => {
                  if (meetLink === (call.meet_link ?? "")) return;
                  save({ meet_link: meetLink.trim() || null }, { refresh: true });
                }}
                placeholder="https://meet.google.com/…"
                style={fieldInput}
              />
            </div>

            <div>
              <span style={fieldLabel}>Show-Status</span>
              <Segmented
                value={showStatus}
                options={[
                  {
                    value: "show",
                    label: "Show",
                    color: "var(--color-success-text)",
                    bg: "var(--color-success-bg)",
                    border: "var(--color-success-border)",
                  },
                  {
                    value: "no_show",
                    label: "No-Show",
                    color: "var(--color-error-text)",
                    bg: "var(--color-error-bg)",
                    border: "var(--color-error-border)",
                  },
                ]}
                onChange={(v) => {
                  setShowStatus(v);
                  save({ show_status: v });
                }}
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
          </div>

          {/* Setting-Kontext (read-only) */}
          {settingContext && (
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
                  Aus dem Setting
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {/* Kernfakten als Definition-List */}
                {settingFacts.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                    {settingFacts.map((f) => (
                      <div key={f.label} style={{ display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
                        <span
                          style={{
                            fontSize: "0.6875rem",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            color: "var(--text-subtle)",
                            flexShrink: 0,
                            minWidth: 92,
                          }}
                        >
                          {f.label}
                        </span>
                        <span
                          style={{
                            fontSize: "0.8125rem",
                            fontWeight: 600,
                            color: "var(--text-secondary)",
                            wordBreak: "break-word",
                          }}
                        >
                          {f.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {settingContext.objections_handled?.trim() && (
                  <div>
                    <span style={{ ...fieldLabel, marginBottom: "0.2rem" }}>Einwände behandelt</span>
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
                      {settingContext.objections_handled}
                    </p>
                  </div>
                )}

                {settingContext.objections_open?.trim() && (
                  <div>
                    <span style={{ ...fieldLabel, marginBottom: "0.2rem" }}>Einwände offen</span>
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
                      {settingContext.objections_open}
                    </p>
                  </div>
                )}

                {settingContext.notes?.trim() && (
                  <div>
                    <span style={{ ...fieldLabel, marginBottom: "0.2rem" }}>Notizen des Setters</span>
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
                      {settingContext.notes}
                    </p>
                  </div>
                )}

                {/* Script-Antworten (einklappbar) */}
                {settingScriptEntries.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setSettingScriptOpen((v) => !v)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.3rem",
                        padding: 0,
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "0.75rem",
                        fontWeight: 800,
                        color: "var(--color-info-text)",
                      }}
                    >
                      {settingScriptOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      Script-Antworten ({settingScriptEntries.length})
                    </button>
                    {settingScriptOpen && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem", marginTop: "0.5rem" }}>
                        {settingScriptEntries.map((e) => (
                          <div key={e.label}>
                            <span style={{ ...fieldLabel, marginBottom: "0.2rem" }}>{e.label}</span>
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
                              {e.value}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {settingFacts.length === 0 &&
                  settingScriptEntries.length === 0 &&
                  !settingContext.notes?.trim() &&
                  !settingContext.objections_handled?.trim() &&
                  !settingContext.objections_open?.trim() && (
                    <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                      Der Setter hat keine Angaben hinterlassen.
                    </p>
                  )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Modal: Gewonnen ── */}
      <Modal
        open={wonOpen}
        onClose={() => setWonOpen(false)}
        title="Deal gewonnen"
        subtitle="Deal-Daten erfassen — der Abschluss erscheint danach im CRM."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          <div>
            <span style={fieldLabel}>Deal-Volumen (EUR)</span>
            <input
              type="number"
              min={0}
              step={100}
              value={dealVolume}
              onChange={(e) => setDealVolume(e.target.value)}
              placeholder="z. B. 8000"
              style={fieldInput}
            />
          </div>
          <div>
            <span style={fieldLabel}>Zahlungsart</span>
            <Segmented
              value={paymentType || null}
              options={[
                { value: "Einmal", label: "Einmal" },
                { value: "Raten", label: "Raten" },
              ]}
              onChange={(v) => setPaymentType(v ?? "")}
            />
          </div>
          <div>
            <span style={fieldLabel}>Vertragsstart</span>
            <input
              type="date"
              value={contractStart}
              onChange={(e) => setContractStart(e.target.value)}
              style={fieldInput}
            />
          </div>
          <div>
            <span style={fieldLabel}>Unterschrift</span>
            <Toggle value={signatureReceived} onChange={setSignatureReceived} label="Unterschrift erhalten" />
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
              disabled={isPending}
              onClick={() => {
                const vol = dealVolume.trim() === "" ? null : Number(dealVolume);
                submitOutcome(
                  "gewonnen",
                  {
                    dealVolume: vol != null && !Number.isNaN(vol) ? vol : null,
                    paymentType: paymentType || null,
                    contractStart: contractStart || null,
                    signatureReceived,
                  },
                  () => setWonOpen(false),
                );
              }}
              style={{
                ...modalButton("primary", { bg: "var(--color-success-bg)", fg: "var(--color-success-text)" }),
                border: "1px solid var(--color-success-border)",
                opacity: isPending ? 0.7 : 1,
              }}
            >
              Als gewonnen markieren
            </button>
            <button type="button" onClick={() => setWonOpen(false)} style={modalButton("ghost")}>
              Abbrechen
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Modal: Verloren ── */}
      <Modal
        open={lostOpen}
        onClose={() => setLostOpen(false)}
        title="Deal verloren"
        subtitle="Bitte den Verlustgrund festhalten."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          <div>
            <span style={fieldLabel}>Verlustgrund *</span>
            <textarea
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              placeholder="Warum ist der Deal verloren gegangen?"
              rows={4}
              style={{ ...fieldInput, resize: "vertical", lineHeight: 1.5 }}
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
              disabled={isPending || !lostReason.trim()}
              onClick={() =>
                submitOutcome("verloren", { lostReason: lostReason.trim() }, () => setLostOpen(false))
              }
              style={{
                ...modalButton("primary", { bg: "var(--color-error-bg)", fg: "var(--color-error-text)" }),
                border: "1px solid var(--color-error-border)",
                opacity: isPending || !lostReason.trim() ? 0.6 : 1,
                cursor: isPending || !lostReason.trim() ? "default" : "pointer",
              }}
            >
              Als verloren markieren
            </button>
            <button type="button" onClick={() => setLostOpen(false)} style={modalButton("ghost")}>
              Abbrechen
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Modal: Nachfassen ── */}
      <Modal
        open={followOpen}
        onClose={() => setFollowOpen(false)}
        title="Nachfassen"
        subtitle="Wann soll der Lead wieder angefasst werden?"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          <div>
            <span style={fieldLabel}>Wiedervorlage am *</span>
            <input
              type="datetime-local"
              value={followUpDue}
              onChange={(e) => setFollowUpDue(e.target.value)}
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
              disabled={isPending || !followUpDue}
              onClick={() => {
                const d = new Date(followUpDue);
                submitOutcome(
                  "nachfassen",
                  { followUpDue: Number.isNaN(d.getTime()) ? followUpDue : d.toISOString() },
                  () => setFollowOpen(false),
                );
              }}
              style={{
                ...modalButton("primary", { bg: "var(--color-warning-bg)", fg: "var(--color-warning-text)" }),
                border: "1px solid var(--color-warning-border)",
                opacity: isPending || !followUpDue ? 0.6 : 1,
                cursor: isPending || !followUpDue ? "default" : "pointer",
              }}
            >
              Wiedervorlage setzen
            </button>
            <button type="button" onClick={() => setFollowOpen(false)} style={modalButton("ghost")}>
              Abbrechen
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
