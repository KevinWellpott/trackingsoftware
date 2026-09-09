"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarClock, Phone, RotateCcw, Video } from "lucide-react";
import { reviveDropout, type ReviveMeetingKind } from "@/app/actions/revive";
import type { DropoutRow } from "@/app/actions/dropout";
import { Button } from "@/components/ui/Button";
import { DateTimeField } from "@/components/ui/DateTimeField";
import { Modal } from "@/components/ui/Modal";
import { Segmented } from "@/components/ui/Segmented";

// „Zurückholen" (Entscheidung K10) — die Anlagestrecke für den zweiten Anlauf.
//
// Der Dialog fragt genau das, was der Vorgänger NICHT liefern kann: den neuen
// Termin. Alles andere — Name, Firma, Herkunft, Zuständigkeit, Kontaktweg —
// erbt die Server-Action von der alten Zeile; hier stehen dafür nur die
// Übersteuerungen.
//
// Zwei Phasen in EINEM Modal, weil die Zeile nach dem Zurückholen aus der
// Ansicht „Ersatztermin offen" verschwindet (die RPC filtert dort auf
// `revived_at is null`): Stünde die Bestätigung in der Karte, wäre sie mit
// genau der Karte weg, die sie erklärt. Der Verweis auf den neuen Termin bleibt
// deshalb im Modal stehen, bis der Nutzer es schließt — erst dann wird die
// Liste neu geladen.

type KindChoice = "erben" | "link" | "telefon";

const KIND_OPTIONS = [
  { value: "erben" as const, label: "Wie bisher" },
  { value: "link" as const, label: "Link" },
  { value: "telefon" as const, label: "Telefon" },
];

const labelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-3)",
  fontSize: "var(--fs-xs)",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "var(--ls-eyebrow)",
  color: "var(--text-muted)",
  marginBottom: "var(--sp-3)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--surface-2)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--r-sm)",
  padding: "var(--sp-4) var(--sp-5)",
  fontSize: "var(--fs-sm)",
  color: "var(--text-primary)",
  fontFamily: "inherit",
  outline: "none",
};

export function ReviveDialog({
  open,
  onClose,
  row,
}: {
  open: boolean;
  /** Wird erst nach dem Schließen aufgerufen — der Aufrufer lädt dann neu. */
  onClose: (created: boolean) => void;
  row: DropoutRow;
}) {
  const [appointmentAt, setAppointmentAt] = useState("");
  const [kind, setKind] = useState<KindChoice>("erben");
  const [contact, setContact] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Beim Öffnen zurücksetzen (Render-Phase-Update statt setState-im-Effect —
  // Muster ManualAppointmentModal).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setAppointmentAt("");
      setKind("erben");
      setContact("");
      setError(null);
      setCreatedId(null);
    }
  }

  function close() {
    onClose(Boolean(createdId));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!appointmentAt.trim()) {
      setError("Bitte einen Termin für den neuen Anlauf angeben.");
      return;
    }
    setError(null);
    const meetingKind: ReviveMeetingKind = kind === "erben" ? null : kind;
    startTransition(async () => {
      const res = await reviveDropout(row.entity_type, row.entity_id, {
        appointmentAt: appointmentAt.trim(),
        meetingKind,
        meetLink: kind === "link" ? contact.trim() || null : null,
        phone: kind === "telefon" ? contact.trim() || null : null,
      });
      if (res.error || !res.settingCallId) {
        setError(res.error ?? "Neuer Termin konnte nicht angelegt werden.");
        return;
      }
      setCreatedId(res.settingCallId);
    });
  }

  const leadLabel = row.lead_name?.trim() || "Unbenannter Lead";

  return (
    <Modal
      open={open}
      onClose={close}
      title={createdId ? "Zurückgeholt" : "Zurückholen"}
      subtitle={createdId ? undefined : `${leadLabel} bekommt einen neuen Anlauf`}
      width={430}
    >
      {createdId ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
          <p style={{ margin: 0, fontSize: "var(--fs-sm)", lineHeight: "var(--lh-base)", color: "var(--text-secondary)" }}>
            Der neue Termin ist angelegt und hat seine eigene Erinnerungs-Kaskade. Der alte Vorgang bleibt
            unverändert stehen — er hält die Zahlen seines Zeitraums fest.
          </p>
          <Link
            href={`/setting/${createdId}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--sp-3)",
              fontSize: "var(--fs-sm)",
              fontWeight: 500,
              color: "var(--orange-300)",
              textDecoration: "none",
            }}
          >
            Zum neuen Erstgespräch <ArrowUpRight size={13} />
          </Link>
          <Button type="button" variant="secondary" onClick={close} fullWidth>
            Schließen
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
          {/* Der eine Satz, der erklärt, warum hier nichts „wiederbelebt" wird. */}
          <p
            style={{
              margin: 0,
              fontSize: "var(--fs-xs)",
              lineHeight: "var(--lh-base)",
              color: "var(--text-subtle)",
            }}
          >
            Es entsteht ein <strong style={{ color: "var(--text-secondary)" }}>neues Erstgespräch</strong>; die alte
            Zeile bleibt terminal. Ein zurückgedrehter Vorgang veränderte rückwirkend die Quoten eines bereits
            abgeschlossenen Zeitraums. Name, Firma, Herkunft und Zuständigkeit werden übernommen, die
            Qualifizierung nicht — die ist neu zu führen.
          </p>

          <div>
            <label htmlFor="revive-at" style={labelStyle}>
              <CalendarClock size={13} /> Neuer Termin *
            </label>
            <DateTimeField id="revive-at" value={appointmentAt} onChange={setAppointmentAt} ariaLabel="Neuer Termin" />
          </div>

          <div>
            <span style={labelStyle}>
              <Video size={13} /> Termin-Art
            </span>
            <Segmented<KindChoice>
              options={KIND_OPTIONS}
              value={kind}
              onChange={setKind}
              ariaLabel="Termin-Art"
              fullWidth
            />
            {kind === "erben" && (
              <p style={{ margin: "var(--sp-3) 0 0", fontSize: "var(--fs-2xs)", color: "var(--text-subtle)" }}>
                Link bzw. Rufnummer des Vorgängers werden übernommen. Hat er keine, meldet sich das Formular.
              </p>
            )}
          </div>

          {kind !== "erben" && (
            <div>
              <label htmlFor="revive-contact" style={labelStyle}>
                {kind === "telefon" ? (
                  <>
                    <Phone size={13} /> Telefonnummer
                  </>
                ) : (
                  <>
                    <Video size={13} /> Termin-Link
                  </>
                )}
              </label>
              <input
                id="revive-contact"
                type={kind === "telefon" ? "tel" : "url"}
                placeholder={kind === "telefon" ? "+49 … (leer = wie beim Vorgänger)" : "https://… (leer = wie beim Vorgänger)"}
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                style={inputStyle}
              />
            </div>
          )}

          {error && (
            <div
              style={{
                fontSize: "var(--fs-sm)",
                color: "var(--danger-fg)",
                background: "var(--danger-bg)",
                border: "1px solid rgb(214 90 82 / 0.28)",
                borderRadius: "var(--r-sm)",
                padding: "var(--sp-4) var(--sp-5)",
              }}
            >
              {error}
            </div>
          )}

          <Button type="submit" variant="primary" loading={isPending} icon={<RotateCcw size={14} />} fullWidth>
            Neuen Termin anlegen
          </Button>
        </form>
      )}
    </Modal>
  );
}
