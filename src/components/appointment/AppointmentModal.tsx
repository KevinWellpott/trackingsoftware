"use client";

import { Modal } from "@/components/ui/Modal";
import { CalendarClock, Video } from "lucide-react";
import { useState, useTransition } from "react";

// Generischer Termin-Dialog: erzwingt Meet-Link + Zeitpunkt und delegiert das
// Speichern an den Aufrufer (LinkedIn-Listen heute, Phone-Tracking später).
export function AppointmentModal({
  open,
  onClose,
  leadName,
  defaultMeetLink,
  defaultAppointmentAt,
  onSubmit,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  leadName?: string;
  defaultMeetLink?: string;
  defaultAppointmentAt?: string;
  onSubmit: (meetLink: string, appointmentAt: string) => Promise<{ error?: string }>;
  onSaved?: () => void;
}) {
  const [meetLink, setMeetLink] = useState(defaultMeetLink ?? "");
  const [appointmentAt, setAppointmentAt] = useState(defaultAppointmentAt ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Beim Öffnen mit den Defaults des jeweiligen Leads neu initialisieren
  // (Render-Phase-Update statt setState-im-Effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setMeetLink(defaultMeetLink ?? "");
      setAppointmentAt(defaultAppointmentAt ?? "");
      setError(null);
    }
  }

  const labelStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "0.375rem",
    fontSize: "0.75rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    marginBottom: "0.375rem",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    background: "var(--surface-50)",
    border: "1px solid var(--border-bright)",
    borderRadius: "var(--radius-sm)",
    padding: "0.5rem 0.75rem",
    fontSize: "0.875rem",
    color: "var(--text-primary)",
    outline: "none",
  };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const link = meetLink.trim();
    const at = appointmentAt.trim();
    if (!at || !link) {
      setError("Bitte Termin und Google-Meet-Link ausfüllen.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await onSubmit(link, at);
      if (res?.error) {
        setError(res.error);
        return;
      }
      onSaved?.();
      onClose();
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Termin einbuchen" subtitle={leadName} width={440}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div>
          <label htmlFor="appt-at" style={labelStyle}>
            <CalendarClock size={13} /> Termin
          </label>
          <input
            id="appt-at"
            type="datetime-local"
            required
            value={appointmentAt}
            onChange={(e) => setAppointmentAt(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label htmlFor="appt-link" style={labelStyle}>
            <Video size={13} /> Google-Meet-Link
          </label>
          <input
            id="appt-link"
            type="url"
            required
            placeholder="https://meet.google.com/…"
            value={meetLink}
            onChange={(e) => setMeetLink(e.target.value)}
            style={inputStyle}
          />
        </div>

        <p style={{ fontSize: "0.75rem", color: "var(--text-subtle)", margin: 0, lineHeight: 1.5 }}>
          Pflicht — daraus wird automatisch ein Setting-Eintrag erstellt.
        </p>

        {error && (
          <div
            style={{
              fontSize: "0.8125rem",
              color: "var(--color-error-text)",
              background: "var(--color-error-bg)",
              border: "1px solid var(--color-error-border)",
              borderRadius: "var(--radius-sm)",
              padding: "0.5rem 0.75rem",
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isPending}
          style={{
            background: "var(--btn-primary-bg)",
            color: "var(--btn-primary-fg)",
            border: "none",
            borderRadius: "var(--radius-md)",
            padding: "0.5625rem 1.125rem",
            fontSize: "0.875rem",
            fontWeight: 600,
            cursor: isPending ? "default" : "pointer",
            opacity: isPending ? 0.6 : 1,
            transition: "opacity 0.15s",
          }}
        >
          {isPending ? "Speichern…" : "Termin speichern"}
        </button>
      </form>
    </Modal>
  );
}
