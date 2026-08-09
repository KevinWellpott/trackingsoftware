"use client";

import { createManualSetting } from "@/app/actions/appointments";
import { DateTimeField } from "@/components/ui/DateTimeField";
import { Modal } from "@/components/ui/Modal";
import { Segmented } from "@/components/ui/Segmented";
import { Select } from "@/components/ui/Select";
import { SELECTABLE_CHANNELS, type SelectableChannelKey } from "@/lib/channels";
import { Building2, CalendarClock, Phone, Tag, User, Video } from "lucide-react";
import { useState, useTransition } from "react";

// Termin manuell buchen — für Leads, die NICHT in einer LinkedIn-DM- oder
// Telefon-Liste stehen. Feldreihenfolge exakt nach Auftraggeber-Vorgabe:
// 1. Name · 2. Firma (optional) · 3. Quelle (Pflicht-Dropdown) · 4. Datum ·
// 5. Termin-Art mit Link ODER Nummer.
//
// ── „Manuell" ist keine Quelle mehr ────────────────────────────────────────
// Bis Migration 0029 landete jeder hier gebuchte Termin auf
// `source_type='manuell'` — im Funnel inzwischen die umsatzstärkste Zeile und
// vollkommen aussagelos. „Manuell" beschreibt den ERFASSUNGSWEG, nicht die
// Herkunft; die echte Herkunft stand als Freitext daneben und wurde von keiner
// Auswertung gelesen. Jetzt entscheidet der Nutzer aus genau fünf Kanälen
// (Registry: src/lib/channels.ts). Bestandszeilen bleiben gültig und heißen
// im UI „Manuell (ohne Angabe)".

type KindOption = "link" | "telefon";

/** Beim Anlegen wählbare Quellen — kommt aus dem `selectable`-Flag der Registry. */
const SOURCE_OPTIONS = SELECTABLE_CHANNELS.map((c) => ({
  value: c.key,
  label: c.label,
  color: c.color,
}));

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
  const [sourceType, setSourceType] = useState<SelectableChannelKey | "">("");
  const [sourceDetail, setSourceDetail] = useState("");
  const [kind, setKind] = useState<KindOption>("link");
  const [meetLink, setMeetLink] = useState("");
  const [phone, setPhone] = useState("");
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
      setSourceType("");
      setSourceDetail("");
      setKind("link");
      setMeetLink("");
      setPhone("");
      setAppointmentAt("");
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
    const name = leadName.trim();
    const link = meetLink.trim();
    const nummer = phone.trim();
    const at = appointmentAt.trim();
    if (!name || !at) {
      setError("Bitte Name und Termin ausfüllen.");
      return;
    }
    if (!sourceType) {
      setError("Bitte eine Quelle wählen.");
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
      const res = await createManualSetting({
        leadName: name,
        company: company.trim() || null,
        sourceType,
        sourceDetail: sourceDetail.trim() || null,
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
    <Modal open={open} onClose={onClose} title="Termin manuell buchen" subtitle="Ohne Liste — z. B. Social Selling oder alter Kontakt" width={440}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div>
          <label htmlFor="man-name" style={labelStyle}>
            <User size={13} /> Name *
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
          <span style={labelStyle}>
            <Tag size={13} /> Quelle *
          </span>
          <Select
            id="man-source"
            value={sourceType}
            onChange={(v) => setSourceType(v as SelectableChannelKey)}
            options={SOURCE_OPTIONS}
            placeholder="Woher kommt der Termin?"
            ariaLabel="Quelle"
          />
        </div>

        {/* Freitext NUR bei „Sonstige": dort sagt die Kategorie allein nichts,
            und genau das ist der Fall, für den `source_detail` gedacht ist.
            Bei LinkedIn/Telefon/Ads/Social Media wäre er eine zweite,
            unausgewertete Wahrheit neben der Kategorie. */}
        {sourceType === "sonstige" && (
          <div>
            <label htmlFor="man-source-detail" style={labelStyle}>
              Detail <span style={{ textTransform: "none", fontWeight: 600, color: "var(--text-subtle)" }}>(optional)</span>
            </label>
            <input
              id="man-source-detail"
              type="text"
              placeholder="z. B. Empfehlung von …, alter Kontakt, Messe"
              value={sourceDetail}
              onChange={(e) => setSourceDetail(e.target.value)}
              style={inputStyle}
            />
          </div>
        )}

        <div>
          <label htmlFor="man-at" style={labelStyle}>
            <CalendarClock size={13} /> Termin *
          </label>
          <DateTimeField
            id="man-at"
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
            <label htmlFor="man-link" style={labelStyle}>
              Termin-Link *
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
        ) : (
          <div>
            <label htmlFor="man-phone" style={labelStyle}>
              <Phone size={13} /> Telefonnummer *
            </label>
            <input
              id="man-phone"
              type="tel"
              required
              placeholder="+49 …"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={inputStyle}
            />
          </div>
        )}

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
