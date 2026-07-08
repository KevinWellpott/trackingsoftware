"use client";

import { createManualSetting } from "@/app/actions/appointments";
import { Modal } from "@/components/ui/Modal";
import { Building2, CalendarClock, Tag, User, Video } from "lucide-react";
import { useState, useTransition } from "react";

// Termin manuell buchen — für Leads, die NICHT in einer LinkedIn-DM- oder
// Telefon-Liste stehen (Social Selling, alte Kontakte, WhatsApp-Nachfass).
// Erfasst zusätzlich Name (Pflicht) + Firma, da kein Kontakt-Snapshot existiert.
export function ManualAppointmentModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [leadName, setLeadName] = useState("");
  const [company, setCompany] = useState("");
  const [sourceDetail, setSourceDetail] = useState("");
  const [meetLink, setMeetLink] = useState("");
  const [appointmentAt, setAppointmentAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Beim Öffnen zurücksetzen (Render-Phase-Update statt setState-im-Effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setLeadName("");
      setCompany("");
      setSourceDetail("");
      setMeetLink("");
      setAppointmentAt("");
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
    const name = leadName.trim();
    const link = meetLink.trim();
    const at = appointmentAt.trim();
    if (!name || !at || !link) {
      setError("Bitte Name, Termin und Google-Meet-Link ausfüllen.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createManualSetting({
        leadName: name,
        company: company.trim() || null,
        sourceDetail: sourceDetail.trim() || null,
        meetLink: link,
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
    <Modal open={open} onClose={onClose} title="Termin manuell buchen" subtitle="Ohne Liste — z. B. Social Selling oder alter Kontakt" width={440}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div>
          <label htmlFor="man-name" style={labelStyle}>
            <User size={13} /> Name
          </label>
          <input
            id="man-name"
            type="text"
            required
            placeholder="Vor- und Nachname"
            value={leadName}
            onChange={(e) => setLeadName(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label htmlFor="man-company" style={labelStyle}>
            <Building2 size={13} /> Firma <span style={{ textTransform: "none", fontWeight: 600, color: "var(--text-subtle)" }}>(optional)</span>
          </label>
          <input
            id="man-company"
            type="text"
            placeholder="Firmenname"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label htmlFor="man-source" style={labelStyle}>
            <Tag size={13} /> Quelle <span style={{ textTransform: "none", fontWeight: 600, color: "var(--text-subtle)" }}>(optional)</span>
          </label>
          <input
            id="man-source"
            type="text"
            placeholder="z. B. Social Selling, alter Kontakt, WhatsApp, Empfehlung…"
            value={sourceDetail}
            onChange={(e) => setSourceDetail(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label htmlFor="man-at" style={labelStyle}>
            <CalendarClock size={13} /> Termin
          </label>
          <input
            id="man-at"
            type="datetime-local"
            required
            value={appointmentAt}
            onChange={(e) => setAppointmentAt(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label htmlFor="man-link" style={labelStyle}>
            <Video size={13} /> Google-Meet-Link
          </label>
          <input
            id="man-link"
            type="url"
            required
            placeholder="https://meet.google.com/…"
            value={meetLink}
            onChange={(e) => setMeetLink(e.target.value)}
            style={inputStyle}
          />
        </div>

        <p style={{ fontSize: "0.75rem", color: "var(--text-subtle)", margin: 0, lineHeight: 1.5 }}>
          Wird als Setting-Eintrag mit Quelle „Manuell“ angelegt.
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
