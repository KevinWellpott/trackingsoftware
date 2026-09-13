"use client";

import { useEffect, useState, useTransition } from "react";
import { CalendarClock, CalendarX2, Repeat, UserX } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { DateTimeField } from "@/components/ui/DateTimeField";
import { Badge } from "@/components/ui/Badge";
import { isoToBerlinInput } from "@/lib/apptTime";
import {
  cancelAppointment,
  postponeAppointment,
  setNoShowResolution,
  type AppointmentEntity,
  type CancelOutlook,
  type CancelReasonCode,
  type NoShowResolution,
} from "@/app/actions/settingCalls";
import { getPipelineSettings } from "@/app/actions/pipelineSettings";
import {
  CANCEL_OUTLOOK_HINTS,
  CANCEL_OUTLOOK_LABELS,
  CANCEL_REASON_LABELS,
  CANCEL_REASON_ORDER,
  NO_SHOW_RESOLUTION_HINTS,
  NO_SHOW_RESOLUTION_LABELS,
  NO_SHOW_RESOLUTION_ORDER,
  type AppointmentLifecycle,
} from "@/components/termine/lifecycleMeta";
import { ChoiceGroup, ChoiceHint, FIELD_INPUT, FIELD_LABEL, ModalError, modalButton } from "@/components/termine/lifecycleUi";

// Die Termin-Ereignisse, die im Konzept ZWISCHEN den Kästen stehen: verschoben,
// abgesagt, No-Show-Ausgang. Eine Leiste für beide Editoren — `setting_calls`
// und `closing_calls` tragen seit Migration 0032 dieselben Spalten, und die
// Actions dahinter sind ohnehin schon gemeinsam.
//
// Was hier NICHT passiert: Statuswechsel. Absagen und Verschieben rühren
// `status`/`show_status` bewusst nicht an — 0032 hat dafür eigene Spalten
// bekommen, damit ein abgesagter Termin über `show_status is null` aus dem
// Show-Quoten-Nenner fällt, statt als No-Show zu zählen.

type Props = {
  entityType: AppointmentEntity;
  id: string;
  /** Aktueller Termin als ISO — Vorbelegung des Verschiebe-Dialogs. */
  appointmentAt: string | null;
  showStatus: "show" | "no_show" | null;
  lifecycle: Partial<AppointmentLifecycle>;
  disabled?: boolean;
  /** Der Editor weiß, was danach neu zu laden ist (Kaskade, Seite, Speicher-Haken). */
  onChanged: () => void;
  /**
   * Nur Setting: „Ersatztermin" ist dort ein frischer Anlauf (`rescheduleSetting`,
   * Status zurück auf offen, Kaskade komplett neu — Entscheidung E9) und lebt
   * deshalb weiter im Editor. Fehlt der Rückruf, führt der Ausgang „Ersatztermin"
   * in den Verschiebe-Dialog.
   */
  onErsatztermin?: () => void;
};

type DialogKind = "postpone" | "cancel" | "noshow" | null;

export function AppointmentLifecycleBar({
  entityType,
  id,
  appointmentAt,
  showStatus,
  lifecycle,
  disabled = false,
  onChanged,
  onErsatztermin,
}: Props) {
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Verschieben
  const [newAt, setNewAt] = useState("");
  const [byLead, setByLead] = useState<"lead" | "intern" | null>(null);
  const [limitWarn, setLimitWarn] = useState<{ count: number; max: number } | null>(null);

  // Absagen
  const [cancelCode, setCancelCode] = useState<CancelReasonCode | null>(null);
  const [cancelText, setCancelText] = useState("");
  const [outlook, setOutlook] = useState<CancelOutlook | null>(null);

  // No-Show-Ausgang
  const [resolution, setResolution] = useState<NoShowResolution | null>(lifecycle.no_show_resolution ?? null);

  // Das Kontingent steht in der Organisations-Konfiguration und wird erst beim
  // Öffnen geholt: eine Zahl, die nur im Verschiebe-Dialog vorkommt, muss nicht
  // bei jedem Aufruf der Detailseite mitgeladen werden.
  const [maxReschedules, setMaxReschedules] = useState<number | null>(null);
  useEffect(() => {
    if (dialog !== "postpone" || maxReschedules != null) return;
    let alive = true;
    getPipelineSettings()
      .then((res) => {
        if (alive) setMaxReschedules(res.settings.max_reschedules);
      })
      .catch(() => {
        // Ohne die Zahl bleibt der Hinweis vor dem Absenden weg; die Warnung
        // nach dem Verschieben bringt ihr Kontingent selbst mit.
      });
    return () => {
      alive = false;
    };
  }, [dialog, maxReschedules]);

  const cancelled = Boolean(lifecycle.cancelled_at);
  const count = lifecycle.reschedule_count ?? 0;

  function openPostpone() {
    setError(null);
    setLimitWarn(null);
    setByLead(null);
    setNewAt(isoToBerlinInput(appointmentAt));
    setDialog("postpone");
  }

  function openCancel(preset?: CancelOutlook) {
    setError(null);
    setCancelCode(null);
    setCancelText("");
    setOutlook(preset ?? null);
    setDialog("cancel");
  }

  function openNoShow() {
    setError(null);
    setResolution(lifecycle.no_show_resolution ?? null);
    setDialog("noshow");
  }

  function submitPostpone() {
    if (!newAt) {
      setError("Bitte einen neuen Zeitpunkt angeben.");
      return;
    }
    if (byLead === null) {
      setError("Bitte angeben, wer verschoben hat — nur Verschiebungen des Leads zählen.");
      return;
    }
    startTransition(async () => {
      const res = await postponeAppointment(entityType, id, newAt, byLead === "lead");
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      onChanged();
      // Die Warnung kommt NACH dem Verschieben — sie sperrt nichts (E6), sie
      // verlangt eine bewusste Kenntnisnahme. Deshalb bleibt der Dialog offen
      // und wechselt seinen Inhalt, statt sich zu schließen.
      if (res.warn === "limit" && res.count != null && res.max != null) {
        setLimitWarn({ count: res.count, max: res.max });
        return;
      }
      setDialog(null);
    });
  }

  function submitCancel() {
    if (!cancelCode) {
      setError("Ohne Grund keine Absage — bitte einen Grund auswählen.");
      return;
    }
    if (!outlook) {
      setError("Bitte angeben, ob ein Ersatztermin folgt.");
      return;
    }
    startTransition(async () => {
      const res = await cancelAppointment(entityType, id, {
        reasonCode: cancelCode,
        reasonText: cancelText.trim() || null,
        outlook,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      setDialog(null);
      onChanged();
    });
  }

  function submitNoShow() {
    if (!resolution) {
      setError("Bitte einen Ausgang auswählen.");
      return;
    }
    startTransition(async () => {
      const res = await setNoShowResolution(entityType, id, resolution);
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      onChanged();
      // „Ersatztermin" ist erst die halbe Angabe — der Termin selbst fehlt noch.
      if (resolution === "ersatztermin") {
        setDialog(null);
        if (onErsatztermin) onErsatztermin();
        else openPostpone();
        return;
      }
      setDialog(null);
    });
  }

  const barButton = { minHeight: 28, padding: "0 var(--sp-5)", fontSize: "var(--fs-sm)" } as const;

  return (
    <>
      <button
        type="button"
        className="ui-btn"
        data-variant="ghost"
        onClick={openPostpone}
        disabled={disabled || isPending || cancelled}
        title={
          cancelled
            ? "Der Termin ist abgesagt — ein Ersatztermin wird als neuer Termin angelegt."
            : "Termin auf einen anderen Zeitpunkt legen. Liegt er in der Zukunft, gilt der Lead als versorgt und trägt in der Terminliste den Status „Termin steht“."
        }
        style={barButton}
      >
        <CalendarClock size={13} /> Verschieben
        {count > 0 && (
          <span className="tnum" style={{ marginLeft: 4, color: "var(--text-subtle)" }}>
            {count}×
          </span>
        )}
      </button>

      <button
        type="button"
        className="ui-btn"
        data-variant="ghost"
        onClick={() => openCancel()}
        disabled={disabled || isPending}
        title={cancelled ? "Absage-Grund korrigieren" : "Termin absagen — mit Grund und Ausblick."}
        style={barButton}
      >
        <CalendarX2 size={13} /> {cancelled ? "Absage ändern" : "Absagen"}
      </button>

      {showStatus === "no_show" && (
        <button
          type="button"
          className="ui-btn"
          data-variant="ghost"
          onClick={openNoShow}
          disabled={disabled || isPending}
          title="Wie ist der No-Show ausgegangen?"
          style={barButton}
        >
          <UserX size={13} /> No-Show-Ausgang
          {lifecycle.no_show_resolution && (
            <span style={{ marginLeft: 4, color: "var(--text-subtle)" }}>
              {NO_SHOW_RESOLUTION_LABELS[lifecycle.no_show_resolution]}
            </span>
          )}
        </button>
      )}

      {/* ── Dialog: Verschieben ── */}
      <Modal
        open={dialog === "postpone"}
        onClose={() => setDialog(null)}
        title={limitWarn ? "Termin verschoben — bitte lesen" : "Termin verschieben"}
        subtitle={
          limitWarn
            ? undefined
            : "Status und Ergebnis bleiben, nur der Zeitpunkt wandert. In der Terminliste trägt der Lead danach den Status „Termin steht“, solange der neue Zeitpunkt nicht vorbei ist."
        }
      >
        {limitWarn ? (
          // Kenntnisnahme statt Sperre: blockiert wird nie (Entscheidung E6),
          // aber der Vorschlag „auf die Ablage setzen" steht direkt daneben.
          <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
            <div
              style={{
                background: "var(--color-warning-bg)",
                border: "1px solid var(--color-warning-border)",
                borderRadius: "var(--radius-sm)",
                padding: "0.625rem 0.875rem",
                fontSize: "0.8125rem",
                lineHeight: 1.5,
                color: "var(--color-warning-text)",
              }}
            >
              Dieser Lead hat den Termin jetzt <strong>{limitWarn.count}×</strong> verschoben — erlaubt sind{" "}
              {limitWarn.max}. Der neue Termin steht; erfahrungsgemäß folgt hier eher die nächste Verschiebung
              als ein Gespräch.
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                onClick={() => {
                  setLimitWarn(null);
                  setDialog(null);
                }}
                style={modalButton("primary", {
                  bg: "var(--color-warning-bg)",
                  fg: "var(--color-warning-text)",
                  border: "var(--color-warning-border)",
                })}
              >
                Verstanden
              </button>
              <button
                type="button"
                onClick={() => {
                  setLimitWarn(null);
                  openCancel("ohne_aussicht");
                }}
                style={modalButton("ghost")}
              >
                Stattdessen ablegen
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
            <div>
              <span style={FIELD_LABEL}>Neuer Zeitpunkt *</span>
              <DateTimeField value={newAt} onChange={setNewAt} ariaLabel="Neuer Zeitpunkt" />
            </div>

            <div>
              <span style={FIELD_LABEL}>Wer hat verschoben? *</span>
              {/* Der Zähler misst die Verbindlichkeit des LEADS. Zählte die
                  eigene Umplanung mit, träfe die Warnung die Falschen. */}
              <ChoiceGroup
                value={byLead}
                options={[
                  { value: "lead", label: "Der Lead" },
                  { value: "intern", label: "Wir intern" },
                ]}
                onChange={setByLead}
                ariaLabel="Wer hat verschoben"
              />
              <ChoiceHint>
                {byLead === "lead"
                  ? `Zählt mit — dieser Lead käme damit auf ${count + 1}${maxReschedules != null ? ` von ${maxReschedules}` : ""}.`
                  : byLead === "intern"
                    ? "Zählt nicht — der Zähler beschreibt den Lead, nicht die eigene Planung."
                    : `Bisher ${count}${maxReschedules != null ? ` von ${maxReschedules}` : ""} Verschiebungen durch den Lead.`}
              </ChoiceHint>
            </div>

            <ModalError message={error} />

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
              <button
                type="button"
                disabled={isPending || !newAt || byLead === null}
                onClick={submitPostpone}
                style={{
                  ...modalButton("primary"),
                  opacity: isPending || !newAt || byLead === null ? 0.6 : 1,
                  cursor: isPending || !newAt || byLead === null ? "default" : "pointer",
                }}
              >
                Termin verschieben
              </button>
              <button type="button" onClick={() => setDialog(null)} style={modalButton("ghost")}>
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Dialog: Absagen ── */}
      <Modal
        open={dialog === "cancel"}
        onClose={() => setDialog(null)}
        title="Termin absagen"
        subtitle="Der Grund ist Pflicht — ohne ihn ist später nicht mehr zu unterscheiden, warum ein Termin nicht stattfand."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          <div>
            <span style={FIELD_LABEL}>Grund der Absage *</span>
            <ChoiceGroup
              value={cancelCode}
              options={CANCEL_REASON_ORDER.map((c) => ({ value: c, label: CANCEL_REASON_LABELS[c] }))}
              onChange={setCancelCode}
              ariaLabel="Grund der Absage"
              tone="error"
            />
          </div>

          <div>
            <span style={FIELD_LABEL}>Notiz (optional)</span>
            <textarea
              value={cancelText}
              onChange={(e) => setCancelText(e.target.value)}
              placeholder="Kontext, den die Kategorie nicht trägt"
              rows={2}
              style={{ ...FIELD_INPUT, resize: "vertical", lineHeight: 1.5 }}
            />
          </div>

          <div>
            <span style={FIELD_LABEL}>Wie geht es weiter? *</span>
            {/* Die Gabelung entscheidet, in WELCHER Ablage der Termin landet —
                beide Zweige haben eine eigene Ansicht, keiner fällt heraus. */}
            <ChoiceGroup
              value={outlook}
              options={(["ohne_aussicht", "neuer_termin"] as const).map((o) => ({
                value: o,
                label: CANCEL_OUTLOOK_LABELS[o],
              }))}
              onChange={setOutlook}
              ariaLabel="Aussicht auf einen neuen Termin"
              tone="warning"
            />
            {outlook && <ChoiceHint>{CANCEL_OUTLOOK_HINTS[outlook]}</ChoiceHint>}
          </div>

          <ModalError message={error} />

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
            <button
              type="button"
              disabled={isPending || !cancelCode || !outlook}
              onClick={submitCancel}
              style={{
                ...modalButton("primary", {
                  bg: "var(--color-error-bg)",
                  fg: "var(--color-error-text)",
                  border: "var(--color-error-border)",
                }),
                opacity: isPending || !cancelCode || !outlook ? 0.6 : 1,
                cursor: isPending || !cancelCode || !outlook ? "default" : "pointer",
              }}
            >
              Termin absagen
            </button>
            <button type="button" onClick={() => setDialog(null)} style={modalButton("ghost")}>
              Abbrechen
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Dialog: No-Show-Ausgang ── */}
      <Modal
        open={dialog === "noshow"}
        onClose={() => setDialog(null)}
        title="Wie ist der No-Show ausgegangen?"
        subtitle="Erst diese Angabe trennt „hat sich nie gemeldet“ von „noch nicht nachgefasst“."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          <div>
            <span style={FIELD_LABEL}>Ausgang *</span>
            <ChoiceGroup
              value={resolution}
              options={NO_SHOW_RESOLUTION_ORDER.map((r) => ({ value: r, label: NO_SHOW_RESOLUTION_LABELS[r] }))}
              onChange={setResolution}
              ariaLabel="Ausgang des No-Shows"
              tone="warning"
            />
            {resolution && <ChoiceHint>{NO_SHOW_RESOLUTION_HINTS[resolution]}</ChoiceHint>}
          </div>

          <ModalError message={error} />

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
            <button
              type="button"
              disabled={isPending || !resolution}
              onClick={submitNoShow}
              style={{
                ...modalButton("primary", {
                  bg: "var(--color-warning-bg)",
                  fg: "var(--color-warning-text)",
                  border: "var(--color-warning-border)",
                }),
                opacity: isPending || !resolution ? 0.6 : 1,
                cursor: isPending || !resolution ? "default" : "pointer",
              }}
            >
              Ausgang speichern
            </button>
            <button type="button" onClick={() => setDialog(null)} style={modalButton("ghost")}>
              Abbrechen
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/**
 * Der Zustand nach einer Absage — als eigene Zeile im Termin-Layout, nicht als
 * Statusfarbe: `status` bleibt bei einer Absage bewusst unangetastet (0032), die
 * Aktionsleiste könnte den Zustand also gar nicht zeigen.
 */
export function CancelledBanner({ lifecycle }: { lifecycle: Partial<AppointmentLifecycle> }) {
  if (!lifecycle.cancelled_at) return null;
  const reason = lifecycle.cancel_reason_code ? CANCEL_REASON_LABELS[lifecycle.cancel_reason_code] : "Ohne Grund";
  const outlook = lifecycle.cancel_outlook;

  return (
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
      <CalendarX2 size={16} style={{ color: "var(--color-error-text)", flexShrink: 0 }} />
      <div style={{ flex: "1 1 240px", minWidth: 0 }}>
        <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--color-error-text)" }}>
          Termin abgesagt · {reason}
          {lifecycle.cancel_reason?.trim() ? ` · ${lifecycle.cancel_reason.trim()}` : ""}
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          {outlook
            ? CANCEL_OUTLOOK_HINTS[outlook]
            : "Ohne Angabe, wie es weitergeht — bitte die Absage nachtragen."}
        </div>
      </div>
      {outlook && (
        <Badge tone={outlook === "ohne_aussicht" ? "error" : "warning"}>{CANCEL_OUTLOOK_LABELS[outlook]}</Badge>
      )}
    </div>
  );
}

/** Kleiner Hinweis in der Aktionsleiste, sobald der Lead schon verschoben hat. */
export function RescheduleHint({ lifecycle }: { lifecycle: Partial<AppointmentLifecycle> }) {
  const count = lifecycle.reschedule_count ?? 0;
  if (count === 0) return null;
  return (
    <span
      className="tnum"
      style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)", fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}
      title="Verschiebungen durch den Lead — eigene Umplanungen zählen nicht mit."
    >
      <Repeat size={12} /> {count}× vom Lead verschoben
    </span>
  );
}
