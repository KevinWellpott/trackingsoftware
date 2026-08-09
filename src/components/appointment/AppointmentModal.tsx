"use client";

import type { MeetingKind } from "@/app/actions/appointments";
import { DateTimeField } from "@/components/ui/DateTimeField";
import { Modal } from "@/components/ui/Modal";
import { Segmented } from "@/components/ui/Segmented";
import { CalendarClock, Phone, Video } from "lucide-react";
import { useState, useTransition } from "react";

// Generischer Termin-Dialog für Leads, die schon eine Zeile haben (LinkedIn-
// Liste, Telefon-Liste). Reihenfolge wie vom Auftraggeber vorgegeben:
// 1. Datum · 2. Termin-Art · 3. Link ODER Telefonnummer.
//
// ── Warum die dritte Option „Ohne" weg ist ─────────────────────────────────
// Die Vorgabe lautet „Link ODER Telefon" — und genau daran hängt der Zweck:
// „Damit wenn einer einspringen muss er direkt alle Kontaktinfos hat."
// „Ohne" war die Abkürzung, die diesen Zweck zuverlässig aushebelte: ein
// Termin ohne Link und ohne Nummer ist ein Termin, den niemand übernehmen
// kann. Ein Termin findet entweder in einem Raum statt oder am Telefon —
// eine dritte Möglichkeit gibt es nicht. Bestandszeilen mit
// `meeting_kind is null` bleiben gültig und werden nicht angefasst.

type KindOption = "link" | "telefon";

export type AppointmentPayload = {
  meetLink: string | null;
  /** Nummer bei Termin-Art „Telefon"; sonst null. */
  phone: string | null;
  meetingKind: MeetingKind;
  appointmentAt: string;
};

export function AppointmentModal({
  open,
  onClose,
  leadName,
  defaultMeetLink,
  defaultPhone,
  defaultAppointmentAt,
  onSubmit,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  leadName?: string;
  defaultMeetLink?: string;
  /** Bekannte Rufnummer des Leads — spart das Abtippen. */
  defaultPhone?: string;
  defaultAppointmentAt?: string;
  onSubmit: (payload: AppointmentPayload) => Promise<{ error?: string }>;
  onSaved?: () => void;
}) {
  const [kind, setKind] = useState<KindOption>("link");
  const [meetLink, setMeetLink] = useState(defaultMeetLink ?? "");
  const [phone, setPhone] = useState(defaultPhone ?? "");
  const [appointmentAt, setAppointmentAt] = useState(defaultAppointmentAt ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Beim Öffnen mit den Defaults des jeweiligen Leads neu initialisieren
  // (Render-Phase-Update statt setState-im-Effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setKind("link");
      setMeetLink(defaultMeetLink ?? "");
      setPhone(defaultPhone ?? "");
      setAppointmentAt(defaultAppointmentAt ?? "");
      setError(null);
    }
  }

  const labelStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "0.375rem",
    fontSize: "0.75rem",
    fontWeight: 600,
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
    const nummer = phone.trim();
    const at = appointmentAt.trim();
    if (!at) {
      setError("Bitte Termin-Zeitpunkt ausfüllen.");
      return;
    }
    if (kind === "link" && !link) {
      setError("Bitte Termin-Link eintragen oder Art auf Telefon stellen.");
      return;
    }
    if (kind === "telefon" && !nummer) {
      setError("Bitte die Rufnummer eintragen — ohne sie kann niemand einspringen.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await onSubmit({
        meetLink: kind === "link" ? link : null,
        phone: kind === "telefon" ? nummer : null,
        meetingKind: kind,
        appointmentAt: at,
      });
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
          <DateTimeField
            id="appt-at"
            value={appointmentAt}
            onChange={setAppointmentAt}
            ariaLabel="Termin"
          />
        </div>

        <div>
          <span style={labelStyle}>
            <Video size={13} /> Termin-Art
          </span>
          <Segmented<KindOption>
            options={[
              { value: "link", label: "Link" },
              { value: "telefon", label: "Telefon" },
            ]}
            value={kind}
            onChange={setKind}
            ariaLabel="Termin-Art"
            fullWidth
          />
        </div>

        {kind === "link" ? (
          <div>
            <label htmlFor="appt-link" style={labelStyle}>
              Termin-Link *
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
        ) : (
          <div>
            <label htmlFor="appt-phone" style={labelStyle}>
              <Phone size={13} /> Telefonnummer *
            </label>
            <input
              id="appt-phone"
              type="tel"
              required
              placeholder="+49 …"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={inputStyle}
            />
          </div>
        )}

        <p style={{ fontSize: "0.75rem", color: "var(--text-subtle)", margin: 0, lineHeight: 1.5 }}>
          {kind === "telefon"
            ? "Die Nummer steht danach am Termin — im Kalender, in der Liste und im Setting-Kopf."
            : "Daraus wird automatisch ein Setting-Eintrag erstellt."}
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
            background: "var(--grad-cta)",
            color: "var(--text-on-accent)",
            boxShadow: "var(--shadow-btn-primary)",
            border: "none",
            borderRadius: "var(--r-full)",
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
