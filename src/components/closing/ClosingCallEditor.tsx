"use client";

import { deleteClosingCall, setClosingOutcome, updateClosingCall, type ClosingCallPatch } from "@/app/actions/closingCalls";
import { AssigneeMultiSelect } from "@/components/assignees/AssigneeMultiSelect";
import { DangerZone } from "@/components/ui/DangerZone";
import { ScriptRunner } from "@/components/scripts/ScriptRunner";
import { Modal } from "@/components/ui/Modal";
// Alias: diese Datei hat ein eigenes, privates <Toggle> fuer die Modal-Felder.
import { Toggle as UiToggle } from "@/components/ui/Toggle";
import { SettingMirror, type SettingContext } from "@/components/closing/SettingMirror";
import { berlinInputToIso, isoToBerlinInput } from "@/lib/apptTime";
import { CLOSING_BLOCKS } from "@/lib/scripts";
import type { ClosingCall } from "@/lib/types";
import { CalendarClock, Check, ChevronRight, FileText, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

// Closing-Call-Editor. Ganz oben die zugeklappten Call-Details, darunter
// je nach Umschalter eines von zwei Layouts:
//
//   Setting eingeblendet (Standard, wenn ein Setting verknüpft ist)
//     Reihe 1: Closing-Script | Setting-Spiegel — gleich breit, gleich hoch
//     Reihe 2: Zuweisung | Zusatznotizen — ebenfalls auf gleicher Höhe
//
//   Setting ausgeblendet
//     Script links, Zuweisung + Zusatznotizen rechts
//
// Gleiche Höhe kommt aus dem Grid-Default "stretch" plus height:100% auf den
// Karten selbst — ohne beides bleiben sie auf Inhaltshöhe stehen.
//
// Terminal-Ergebnisse (Gewonnen / Verloren / Nachfassen) laufen über Modals →
// setClosingOutcome. Alles andere speichert automatisch (Blur bzw. Klick).

type UserOption = { user_id: string; username: string };

type Props = {
  call: ClosingCall;
  assignees: UserOption[];
  users: UserOption[];
  settingContext: SettingContext | null;
};

// Meta-Angaben neben dem Ergebnis (Deal-Volumen, Wiedervorlage, Grund).
const metaText: React.CSSProperties = {
  fontSize: "var(--fs-sm)",
  color: "var(--text-secondary)",
};

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

// Termin-Konvertierung läuft zentral über apptTime (Berlin, nicht Browser-Zone).
const isoToLocalInput = isoToBerlinInput;
const localInputToIso = berlinInputToIso;

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
              borderRadius: "var(--r-full)",
              border: `1px solid ${active ? border : "var(--border)"}`,
              background: active ? bg : "var(--surface-50)",
              color: active ? color : "var(--text-muted)",
              fontSize: "0.75rem",
              fontWeight: 600,
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
        borderRadius: "var(--r-full)",
        border: `1px solid ${value ? "var(--color-success-border)" : "var(--border)"}`,
        background: value ? "var(--color-success-bg)" : "var(--surface-50)",
        color: value ? "var(--color-success-text)" : "var(--text-muted)",
        fontSize: "0.75rem",
        fontWeight: 600,
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
      minHeight: "var(--h-control-lg)",
      padding: "0 var(--sp-7)",
      borderRadius: "var(--r-full)",
      border: "1px solid transparent",
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

  // Setting-Spiegel: an, sobald ein Setting verknüpft ist — genau dafür
  // existiert die Ansicht. Ohne Setting gibt es den Umschalter gar nicht.
  const [settingOpen, setSettingOpen] = useState(Boolean(settingContext));

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

  const currentDealVolume = call.deal_volume == null ? null : Number(call.deal_volume);
  const followUpLabel = formatDateTime(call.follow_up_due);

  // Die drei terminalen Ergebnisse. Jedes oeffnet seinen Erfassungs-Dialog —
  // auch das bereits gesetzte, damit man Deal-Volumen oder Grund nachtragen kann.
  // Farben stecken in den .outcome-btn-Regeln (globals.css §6.6b);
  // hier steht nur, welcher Ton zu welchem Ergebnis gehoert.
  const outcomes = [
    { key: "gewonnen" as const, label: "Gewonnen", tone: "won", open: () => setWonOpen(true) },
    { key: "verloren" as const, label: "Verloren", tone: "lost", open: () => setLostOpen(true) },
    { key: "nachfassen" as const, label: "Nachfassen", tone: "follow", open: () => setFollowOpen(true) },
  ];

  // Die vier Inhaltsbloecke einmal binden — die beiden Layouts ordnen sie nur
  // um, statt dasselbe JSX zweimal zu pflegen.
  const scriptCard = (
    // height 100% laesst die Karte die Zeilenhoehe des Grids ausfuellen —
    // ohne das bleibt sie auf Inhaltshoehe und die Zeile wirkt ausgefranst.
    <div
      style={{
        height: "100%",
        background: "var(--surface-100)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: "1.5rem 1.5rem 1.75rem",
      }}
    >
      <ScriptRunner
        blocks={CLOSING_BLOCKS}
        initial={call.script_answers ?? {}}
        onSave={(answers) => updateClosingCall(call.id, { script_answers: answers })}
      />
    </div>
  );

  const notesCard = (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--surface-100)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: "1.25rem 1.5rem 1.5rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
        <FileText size={15} style={{ color: "var(--brand-500)" }} />
        <span style={{ fontSize: "1rem", fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text-primary)" }}>
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
  );

  const assignCard = (
    <div
      style={{
        height: "100%",
        background: "var(--surface-100)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: "1rem 1.125rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.625rem" }}>
        <Users size={14} style={{ color: "var(--text-subtle)" }} />
        <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary)" }}>Zuweisung</span>
      </div>
      <AssigneeMultiSelect entityType="closing_call" entityId={call.id} users={users} initial={assignees} />
    </div>
  );

  // Call-Details sitzen ganz oben und sind zugeklappt: waehrend des Gespraechs
  // braucht man sie selten, sie sollen dem Script keine Hoehe wegnehmen.
  const detailsCard = (
    <details className="card">
      <summary
        className="collapse-summary"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-4)",
          padding: "var(--sp-5) var(--sp-7)",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <ChevronRight size={14} className="collapse-chevron" style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <CalendarClock size={14} style={{ color: "var(--orange-500)", flexShrink: 0 }} />
        <span className="eyebrow">Call-Details</span>
        <span
          className="tnum"
          style={{ marginLeft: "auto", fontSize: "var(--fs-xs)", color: "var(--text-muted)", whiteSpace: "nowrap" }}
        >
          Termin · Meet-Link · Show · Einwände
        </span>
      </summary>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.875rem",
          padding: "0 var(--sp-7) var(--sp-7)",
        }}
      >
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
    </details>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* ── Ergebnis ──
          Das hier ist EIN Entscheid mit drei Antworten, keine drei Aktionen.
          Deshalb eine Gruppe statt drei freistehender, vollflaechig getoenter
          Buttons: still, solange nichts feststeht — und sobald ein Ergebnis
          gesetzt ist, traegt genau ein Segment den Outcome-Ton. Damit zeigt
          die Gruppe den Status selbst und die frueher danebenstehende
          Status-Pille ist ersatzlos entfallen.
          Aufteilung: links Label + Kontext, rechts die Aktionen. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-5)",
          flexWrap: "wrap",
          background: "var(--surface-100)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--sp-5) var(--sp-7)",
        }}
      >
        {/* Links: worum es geht + Kontext zum gesetzten Ergebnis. */}
        <span className="eyebrow eyebrow-muted">Ergebnis</span>

        {status === "gewonnen" && currentDealVolume != null && !Number.isNaN(currentDealVolume) && (
          <span className="tnum" style={metaText}>
            {formatEur(currentDealVolume)}
            {call.payment_type ? ` · ${call.payment_type}` : ""}
          </span>
        )}
        {status === "nachfassen" && followUpLabel && (
          <span className="tnum" style={metaText}>
            Wiedervorlage {followUpLabel}
          </span>
        )}
        {status === "verloren" && call.lost_reason?.trim() && (
          <span
            style={{ ...metaText, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            title={call.lost_reason}
          >
            {call.lost_reason}
          </span>
        )}

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

        {/* Rechts: die Aktionen. Bewusst NICHT an isPending gekoppelt — die
            Buttons oeffnen nur einen Dialog. Vorher waren sie waehrend jedes
            Autosaves deaktiviert und wirkten dadurch tot. Das Absenden im
            Dialog sperrt weiterhin. */}
        <div
          role="group"
          aria-label="Ergebnis des Closings"
          style={{ display: "flex", gap: "var(--sp-4)", flexWrap: "wrap", marginLeft: "auto" }}
        >
          {outcomes.map((o) => {
            const active = status === o.key;
            return (
              <button
                key={o.key}
                type="button"
                className="outcome-btn"
                data-tone={o.tone}
                data-active={active}
                aria-pressed={active}
                onClick={() => {
                  setModalError(null);
                  o.open();
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
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

      {/* ── Call-Details: ganz oben, zugeklappt ── */}
      {detailsCard}

      {/* ── Umschalter: Setting neben dem Script ── */}
      {settingContext && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
          <UiToggle checked={settingOpen} onChange={setSettingOpen} label="Setting einblenden" />
          {/* Der Schalter traegt den Namen bereits als aria-label — der
              sichtbare Text waere sonst eine zweite Ansage. */}
          <span aria-hidden style={{ fontSize: "var(--fs-sm)", color: "var(--text-secondary)" }}>
            Setting einblenden
          </span>
        </div>
      )}

      {settingOpen && settingContext ? (
        <>
          {/* Reihe 1: Closing-Script | Setting-Spiegel — gleich breit UND
              gleich hoch. Der Grid-Default "stretch" zieht beide Karten auf
              die Hoehe der laengeren; darum steht hier bewusst kein
              alignItems. auto-fit + minmax bricht unter ~900px von selbst um. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
              gap: "1.25rem",
            }}
          >
            {scriptCard}
            <div
              style={{
                height: "100%",
                background: "var(--surface-100)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                padding: "1.5rem 1.5rem 1.75rem",
              }}
            >
              <SettingMirror setting={settingContext} />
            </div>
          </div>

          {/* Reihe 2: Zuweisung · Zusatznotizen, ebenfalls auf gleicher Hoehe */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "1.25rem",
            }}
          >
            {assignCard}
            {notesCard}
          </div>
        </>
      ) : (
        /* Ohne Setting-Spiegel: Script links, Zuweisung + Notizen rechts. */
        <div style={{ display: "flex", gap: "1.25rem", alignItems: "stretch", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 520px", minWidth: 0 }}>{scriptCard}</div>
          <div style={{ flex: "1 1 300px", maxWidth: 400, display: "flex", flexDirection: "column", gap: "1rem" }}>
            {assignCard}
            {notesCard}
          </div>
        </div>
      )}

      {/* ── Danger-Zone: Eintrag löschen ── */}
      <DangerZone
        title="Closing-Call löschen"
        description="Entfernt dieses Gespräch samt Script-Antworten, Notizen und Deal-Daten. Das zugehörige Setting geht zurück auf „Offen“."
        confirmTitle="Closing-Call löschen?"
        confirmMessage="Das Gespräch wird endgültig gelöscht — Script-Antworten, Notizen und erfasste Deal-Daten inklusive. Das verknüpfte Setting steht danach wieder auf „Offen“ und kann erneut ein Closing erzeugen."
        onDelete={() => deleteClosingCall(call.id)}
        redirectTo="/termine"
      />

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
