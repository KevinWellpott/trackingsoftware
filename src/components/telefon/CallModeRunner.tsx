"use client";

import { setPhoneLeadOutcome, updatePhoneLead, type PhoneLeadInput } from "@/app/actions/phone";
import { convertPhoneLeadToSetting } from "@/app/actions/appointments";
import { AppointmentModal } from "@/components/appointment/AppointmentModal";
import { Modal } from "@/components/ui/Modal";
import type { PhoneLead, PhoneLeadStatus, PhoneList } from "@/lib/types";
import {
  Calendar,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Globe,
  Phone,
  PhoneMissed,
  PhoneOff,
  Search,
  Voicemail,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

// Call-Mode: eine Liste Lead für Lead durchtelefonieren. Ein Lead groß im
// Fokus, Tracking-Felder inline editierbar, Outcome-Buttons routen den Lead
// (Rückruf/Nicht erreicht → eigene Routing-Listen, via Server-Action).

type StatusFilter = PhoneLeadStatus | "alle";

const STATUS_STYLE: Record<PhoneLeadStatus, { label: string; color: string; bg: string; border: string }> = {
  aktiv: { label: "Aktiv", color: "var(--text-muted)", bg: "var(--surface-150)", border: "var(--border)" },
  rueckruf: { label: "Rückruf", color: "var(--brand-500)", bg: "var(--brand-50)", border: "var(--brand-200)" },
  nicht_erreicht: {
    label: "Nicht erreicht",
    color: "var(--color-warning-text)",
    bg: "var(--color-warning-bg)",
    border: "var(--color-warning-border)",
  },
  termin: {
    label: "Termin",
    color: "var(--color-success-text)",
    bg: "var(--color-success-bg)",
    border: "var(--color-success-border)",
  },
  dead: { label: "Dead", color: "var(--color-error-text)", bg: "var(--color-error-bg)", border: "var(--color-error-border)" },
};

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "alle", label: "Alle" },
  { value: "aktiv", label: "Aktiv" },
  { value: "rueckruf", label: "Rückruf" },
  { value: "nicht_erreicht", label: "Nicht erreicht" },
  { value: "termin", label: "Termin" },
  { value: "dead", label: "Dead" },
];

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: "0.6875rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-subtle)",
  marginBottom: "0.3rem",
};

const fieldInput: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--surface-50)",
  border: "1px solid var(--border-bright)",
  borderRadius: "var(--radius-sm)",
  padding: "0.4rem 0.625rem",
  fontSize: "0.8125rem",
  color: "var(--text-primary)",
  outline: "none",
};

function StatusPill({ status }: { status: PhoneLeadStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: "0.6875rem",
        fontWeight: 700,
        color: s.color,
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: 99,
        padding: "0.1rem 0.5rem",
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  activeColor = "var(--brand-500)",
}: {
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (v: T | null) => void;
  activeColor?: string;
}) {
  return (
    <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(active ? null : o.value)}
            style={{
              padding: "0.3rem 0.625rem",
              borderRadius: "var(--radius-sm)",
              border: `1px solid ${active ? activeColor : "var(--border)"}`,
              background: active ? "var(--brand-50)" : "var(--surface-50)",
              color: active ? activeColor : "var(--text-muted)",
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

export function CallModeRunner({ list, leads }: { list: PhoneList; leads: PhoneLead[] }) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<Record<string, Partial<PhoneLead>>>({});
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("alle");
  const [search, setSearch] = useState("");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apptOpen, setApptOpen] = useState(false);
  const [callbackOpen, setCallbackOpen] = useState(false);
  const [callbackAt, setCallbackAt] = useState("");
  const [isPending, startTransition] = useTransition();

  const merged = useMemo(
    () => leads.map((l) => ({ ...l, ...(overrides[l.id] ?? {}) })),
    [leads, overrides],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      alle: merged.length,
      aktiv: 0,
      rueckruf: 0,
      nicht_erreicht: 0,
      termin: 0,
      dead: 0,
    };
    for (const l of merged) counts[l.status] += 1;
    return counts;
  }, [merged]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return merged.filter(
      (l) =>
        (statusFilter === "alle" || l.status === statusFilter) &&
        (!q ||
          (l.company ?? "").toLowerCase().includes(q) ||
          (l.phone ?? "").toLowerCase().includes(q) ||
          (l.decider_name ?? "").toLowerCase().includes(q)),
    );
  }, [merged, statusFilter, search]);

  const idxRaw = currentId ? filtered.findIndex((l) => l.id === currentId) : -1;
  const currentIndex = idxRaw >= 0 ? idxRaw : 0;
  const current = filtered.length > 0 ? filtered[currentIndex] : null;

  function goto(i: number) {
    const t = filtered[i];
    if (t) setCurrentId(t.id);
  }

  // ← / → Navigation (nicht während Tippen in Feldern)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement | null)?.isContentEditable) return;
      if (e.key === "ArrowLeft") goto(currentIndex - 1);
      if (e.key === "ArrowRight") goto(currentIndex + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, filtered]);

  function setField(id: string, patch: Partial<PhoneLead>) {
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function saveField(id: string, patch: Partial<PhoneLeadInput>) {
    startTransition(async () => {
      const res = await updatePhoneLead(id, list.id, patch);
      if (res.error) setError(res.error);
      else setError(null);
    });
  }

  /** Nach einem Outcome zum nächsten Lead springen. */
  function advance() {
    const next = filtered[currentIndex + 1];
    setCurrentId(next ? next.id : (filtered[0]?.id ?? null));
  }

  function applyOutcome(outcome: "rueckruf" | "nicht_erreicht" | "dead", callbackAtVal?: string) {
    if (!current) return;
    const id = current.id;
    startTransition(async () => {
      const res = await setPhoneLeadOutcome({
        leadId: id,
        listId: list.id,
        outcome,
        callbackAt: callbackAtVal ?? null,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      setField(id, { status: outcome, ...(callbackAtVal ? { callback_at: callbackAtVal } : {}) });
      setCallbackOpen(false);
      setCallbackAt("");
      advance();
      router.refresh();
    });
  }

  if (leads.length === 0) {
    return (
      <div
        style={{
          background: "var(--surface-100)",
          border: "1px dashed var(--border-bright)",
          borderRadius: "var(--radius-lg)",
          padding: "3rem 1.5rem",
          textAlign: "center",
        }}
      >
        <Phone size={26} style={{ color: "var(--text-subtle)", marginBottom: "0.625rem" }} />
        <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.25rem" }}>
          Keine Leads in dieser Liste
        </div>
        <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", margin: 0 }}>
          Importiere eine CSV auf der Telefon-Übersicht — die Leads landen dann hier im Call-Mode.
        </p>
      </div>
    );
  }

  const outcomeBtnBase: React.CSSProperties = {
    flex: 1,
    minWidth: 130,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.4rem",
    padding: "0.625rem 0.875rem",
    borderRadius: "var(--radius-md)",
    fontSize: "0.8125rem",
    fontWeight: 800,
    cursor: isPending ? "default" : "pointer",
    opacity: isPending ? 0.6 : 1,
    transition: "all 0.1s",
  };

  return (
    <div>
      {/* ── Toolbar: Filter + Suche + Position ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.625rem",
          flexWrap: "wrap",
          marginBottom: "1rem",
        }}
      >
        <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
          {FILTERS.map((f) => {
            const active = statusFilter === f.value;
            const accent = f.value === "alle" ? "var(--brand-500)" : STATUS_STYLE[f.value].color;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatusFilter(f.value)}
                style={{
                  padding: "0.3rem 0.625rem",
                  borderRadius: 99,
                  border: `1px solid ${active ? accent : "var(--border)"}`,
                  background: active ? (f.value === "alle" ? "var(--brand-50)" : STATUS_STYLE[f.value].bg) : "var(--surface-100)",
                  color: active ? accent : "var(--text-muted)",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  transition: "all 0.1s",
                }}
              >
                {f.label} <span style={{ opacity: 0.65 }}>{statusCounts[f.value]}</span>
              </button>
            );
          })}
        </div>

        <div style={{ position: "relative", marginLeft: "auto", minWidth: 200 }}>
          <Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-subtle)" }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Firma / Telefon suchen…"
            style={{ ...fieldInput, paddingLeft: "1.75rem", background: "var(--surface-100)" }}
          />
        </div>
      </div>

      {error && (
        <div
          style={{
            fontSize: "0.8125rem",
            color: "var(--color-error-text)",
            background: "var(--color-error-bg)",
            border: "1px solid var(--color-error-border)",
            borderRadius: "var(--radius-sm)",
            padding: "0.5rem 0.75rem",
            marginBottom: "0.875rem",
          }}
        >
          {error}
        </div>
      )}

      <div className="call-mode-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(220px, 1fr)", gap: "1rem", alignItems: "start" }}>
        {/* ══ Call-Mode Card ══ */}
        <div
          style={{
            background: "var(--surface-100)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-sm)",
            overflow: "hidden",
          }}
        >
          {/* Position bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.625rem 1rem",
              borderBottom: "1px solid var(--border)",
              background: "var(--surface-150)",
            }}
          >
            <button
              type="button"
              onClick={() => goto(currentIndex - 1)}
              disabled={currentIndex <= 0}
              aria-label="Vorheriger Lead"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.25rem",
                background: "var(--surface-100)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                padding: "0.3rem 0.5rem",
                fontSize: "0.75rem",
                fontWeight: 700,
                color: currentIndex <= 0 ? "var(--text-subtle)" : "var(--text-secondary)",
                cursor: currentIndex <= 0 ? "default" : "pointer",
                opacity: currentIndex <= 0 ? 0.55 : 1,
              }}
            >
              <ChevronLeft size={13} /> Zurück
            </button>
            <span style={{ flex: 1, textAlign: "center", fontSize: "0.8125rem", fontWeight: 800, color: "var(--text-primary)" }}>
              Lead {filtered.length === 0 ? 0 : currentIndex + 1} / {filtered.length}
              <span style={{ fontWeight: 500, color: "var(--text-subtle)", marginLeft: 8, fontSize: "0.6875rem" }}>← / →</span>
            </span>
            <button
              type="button"
              onClick={() => goto(currentIndex + 1)}
              disabled={currentIndex >= filtered.length - 1}
              aria-label="Nächster Lead"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.25rem",
                background: "var(--surface-100)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                padding: "0.3rem 0.5rem",
                fontSize: "0.75rem",
                fontWeight: 700,
                color: currentIndex >= filtered.length - 1 ? "var(--text-subtle)" : "var(--text-secondary)",
                cursor: currentIndex >= filtered.length - 1 ? "default" : "pointer",
                opacity: currentIndex >= filtered.length - 1 ? 0.55 : 1,
              }}
            >
              Weiter <ChevronRight size={13} />
            </button>
          </div>

          {!current ? (
            <div style={{ padding: "2.5rem 1.5rem", textAlign: "center" }}>
              <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.25rem" }}>
                Keine Leads für diesen Filter
              </div>
              <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", margin: 0 }}>
                Filter oder Suche anpassen, um weitere Leads zu sehen.
              </p>
            </div>
          ) : (
            <div style={{ padding: "1.25rem 1.5rem" }}>
              {/* Lead head: Firma + Status */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", marginBottom: "0.875rem" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h2
                    style={{
                      fontSize: "1.5rem",
                      fontWeight: 800,
                      letterSpacing: "-0.03em",
                      color: "var(--text-primary)",
                      margin: 0,
                      lineHeight: 1.2,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {current.company || "Unbekannte Firma"}
                  </h2>
                  {current.website && (
                    <a
                      href={current.website.startsWith("http") ? current.website : `https://${current.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.3rem",
                        fontSize: "0.8125rem",
                        color: "var(--brand-500)",
                        textDecoration: "none",
                        marginTop: "0.25rem",
                        maxWidth: "100%",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <Globe size={12} style={{ flexShrink: 0 }} /> {current.website}
                    </a>
                  )}
                </div>
                <StatusPill status={current.status} />
              </div>

              {/* Telefonnummer groß (click-to-call) */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  flexWrap: "wrap",
                  background: "var(--surface-50)",
                  border: "1px solid var(--border-bright)",
                  borderRadius: "var(--radius-md)",
                  padding: "0.875rem 1.125rem",
                  marginBottom: "1rem",
                }}
              >
                {current.phone ? (
                  <a
                    href={`tel:${current.phone.replace(/[^\d+]/g, "")}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.625rem",
                      fontSize: "1.375rem",
                      fontWeight: 800,
                      letterSpacing: "-0.01em",
                      color: "var(--brand-500)",
                      textDecoration: "none",
                    }}
                  >
                    <Phone size={19} /> {current.phone}
                  </a>
                ) : (
                  <span style={{ fontSize: "0.875rem", color: "var(--text-subtle)" }}>Keine Telefonnummer</span>
                )}
                {current.callback_at && current.status === "rueckruf" && (
                  <span
                    style={{
                      marginLeft: "auto",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.3rem",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      color: "var(--brand-500)",
                    }}
                  >
                    <CalendarClock size={12} /> Rückruf: {current.callback_at.replace("T", " · ").slice(0, 18)}
                  </span>
                )}
              </div>

              {/* Ansprechpartner + Tracking-Felder */}
              <div className="call-fields-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem 1rem", marginBottom: "1rem" }}>
                <div>
                  <label style={fieldLabel}>Ansprechpartner (Entscheider)</label>
                  <input
                    type="text"
                    value={current.decider_name ?? ""}
                    onChange={(e) => setField(current.id, { decider_name: e.target.value })}
                    onBlur={(e) => saveField(current.id, { decider_name: e.target.value.trim() || null })}
                    placeholder="Name…"
                    style={fieldInput}
                  />
                </div>
                <div>
                  <label style={fieldLabel}>Durchwahl Entscheider</label>
                  <input
                    type="text"
                    value={current.decider_direct_dial ?? ""}
                    onChange={(e) => setField(current.id, { decider_direct_dial: e.target.value })}
                    onBlur={(e) => saveField(current.id, { decider_direct_dial: e.target.value.trim() || null })}
                    placeholder="+49…"
                    style={fieldInput}
                  />
                </div>
                <div>
                  <label style={fieldLabel}>E-Mail</label>
                  <input
                    type="email"
                    value={current.email ?? ""}
                    onChange={(e) => setField(current.id, { email: e.target.value })}
                    onBlur={(e) => saveField(current.id, { email: e.target.value.trim() || null })}
                    placeholder="mail@firma.de"
                    style={fieldInput}
                  />
                </div>
                <div>
                  <label style={fieldLabel}>Zielgruppe</label>
                  <input
                    type="text"
                    value={current.target_group ?? ""}
                    onChange={(e) => setField(current.id, { target_group: e.target.value })}
                    onBlur={(e) => saveField(current.id, { target_group: e.target.value.trim() || null })}
                    placeholder="z. B. Handwerk"
                    style={fieldInput}
                  />
                </div>

                <div>
                  <label style={fieldLabel}>Anruf-Versuch</label>
                  <Segmented
                    value={current.call_attempt != null ? (String(current.call_attempt) as "1" | "2" | "3") : null}
                    options={[
                      { value: "1", label: "1" },
                      { value: "2", label: "2" },
                      { value: "3", label: "3" },
                    ]}
                    onChange={(v) => {
                      const n = v ? Number(v) : null;
                      setField(current.id, { call_attempt: n });
                      saveField(current.id, { call_attempt: n });
                    }}
                  />
                </div>
                <div>
                  <label style={fieldLabel}>Gatekeeper erreicht</label>
                  <Segmented
                    value={current.gatekeeper_reached}
                    options={[
                      { value: "ja", label: "Ja" },
                      { value: "nein", label: "Nein" },
                      { value: "direkt", label: "Direkt" },
                    ]}
                    onChange={(v) => {
                      setField(current.id, { gatekeeper_reached: v });
                      saveField(current.id, { gatekeeper_reached: v });
                    }}
                  />
                </div>
                <div>
                  <label style={fieldLabel}>Reaktion</label>
                  <Segmented
                    value={current.answer_sentiment}
                    options={[
                      { value: "positiv", label: "Positiv" },
                      { value: "neutral", label: "Neutral" },
                      { value: "negativ", label: "Negativ" },
                    ]}
                    onChange={(v) => {
                      setField(current.id, { answer_sentiment: v });
                      saveField(current.id, { answer_sentiment: v });
                    }}
                  />
                </div>
                <div>
                  <label style={fieldLabel}>Status-Flags</label>
                  <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
                    <Toggle
                      value={current.decider_reached === true}
                      onChange={(v) => {
                        setField(current.id, { decider_reached: v });
                        saveField(current.id, { decider_reached: v });
                      }}
                      label="Entscheider erreicht"
                    />
                    <Toggle
                      value={current.mailbox === true}
                      onChange={(v) => {
                        setField(current.id, { mailbox: v });
                        saveField(current.id, { mailbox: v });
                      }}
                      label="Mailbox"
                    />
                  </div>
                </div>

                <div>
                  <label style={fieldLabel}>Skript</label>
                  <input
                    type="text"
                    value={current.script ?? ""}
                    onChange={(e) => setField(current.id, { script: e.target.value })}
                    onBlur={(e) => saveField(current.id, { script: e.target.value.trim() || null })}
                    placeholder="Verwendetes Skript…"
                    style={fieldInput}
                  />
                </div>
                <div>
                  <label style={fieldLabel}>Einwände</label>
                  <input
                    type="text"
                    value={current.objection_notes ?? ""}
                    onChange={(e) => setField(current.id, { objection_notes: e.target.value })}
                    onBlur={(e) => saveField(current.id, { objection_notes: e.target.value.trim() || null })}
                    placeholder="z. B. kein Budget…"
                    style={fieldInput}
                  />
                </div>

                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={fieldLabel}>Notizen</label>
                  <textarea
                    value={current.notes ?? ""}
                    rows={2}
                    onChange={(e) => setField(current.id, { notes: e.target.value })}
                    onBlur={(e) => saveField(current.id, { notes: e.target.value.trim() || null })}
                    placeholder="Gesprächsnotizen…"
                    style={{ ...fieldInput, resize: "vertical", minHeight: 52 }}
                  />
                </div>
              </div>

              {/* ── Outcome-Buttons ── */}
              <div
                style={{
                  borderTop: "1px solid var(--border)",
                  paddingTop: "1rem",
                  display: "flex",
                  gap: "0.5rem",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setApptOpen(true)}
                  style={{
                    ...outcomeBtnBase,
                    background: "var(--color-success-bg)",
                    border: "1px solid var(--color-success-border)",
                    color: "var(--color-success-text)",
                  }}
                >
                  <Calendar size={14} /> Termin
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    setCallbackAt(current.callback_at ?? "");
                    setCallbackOpen(true);
                  }}
                  style={{
                    ...outcomeBtnBase,
                    background: "var(--brand-50)",
                    border: "1px solid var(--brand-200)",
                    color: "var(--brand-500)",
                  }}
                >
                  <PhoneMissed size={14} /> Rückruf
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => applyOutcome("nicht_erreicht")}
                  style={{
                    ...outcomeBtnBase,
                    background: "var(--color-warning-bg)",
                    border: "1px solid var(--color-warning-border)",
                    color: "var(--color-warning-text)",
                  }}
                >
                  <Voicemail size={14} /> Nicht erreicht
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    if (window.confirm(`"${current.company ?? current.phone ?? "Lead"}" wirklich als toten Lead markieren?`)) {
                      applyOutcome("dead");
                    }
                  }}
                  style={{
                    ...outcomeBtnBase,
                    background: "var(--color-error-bg)",
                    border: "1px solid var(--color-error-border)",
                    color: "var(--color-error-text)",
                  }}
                >
                  <PhoneOff size={14} /> Toter Lead
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ══ Lead-Liste (Seite) ══ */}
        <div
          style={{
            background: "var(--surface-100)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "0.625rem 0.875rem",
              borderBottom: "1px solid var(--border)",
              fontSize: "0.6875rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--text-subtle)",
            }}
          >
            Leads ({filtered.length})
          </div>
          <div style={{ maxHeight: 560, overflowY: "auto" }}>
            {filtered.map((l, i) => {
              const active = current?.id === l.id;
              const s = STATUS_STYLE[l.status];
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setCurrentId(l.id)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.5rem 0.875rem",
                    background: active ? "var(--brand-50)" : "transparent",
                    border: "none",
                    borderBottom: "1px solid var(--border)",
                    borderLeft: active ? "3px solid var(--brand-500)" : "3px solid transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.1s",
                  }}
                >
                  <span style={{ fontSize: "0.6875rem", color: "var(--text-subtle)", width: 22, flexShrink: 0, fontWeight: 600 }}>
                    {i + 1}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: "0.8125rem",
                        fontWeight: active ? 800 : 600,
                        color: "var(--text-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {l.company || l.phone || "—"}
                    </span>
                    <span style={{ display: "block", fontSize: "0.6875rem", color: "var(--text-subtle)" }}>
                      {l.phone ?? "keine Nummer"}
                    </span>
                  </span>
                  <span
                    title={s.label}
                    style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0 }}
                  />
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p style={{ fontSize: "0.8125rem", color: "var(--text-subtle)", textAlign: "center", padding: "1.25rem 0.75rem" }}>
                Keine Treffer.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Termin-Modal ── */}
      {current && (
        <AppointmentModal
          open={apptOpen}
          onClose={() => setApptOpen(false)}
          leadName={current.company ?? current.decider_name ?? undefined}
          defaultMeetLink={current.meet_link ?? undefined}
          defaultAppointmentAt={current.appointment_at ?? undefined}
          onSubmit={(meetLink, appointmentAt) =>
            convertPhoneLeadToSetting({ phoneLeadId: current.id, listId: list.id, meetLink, appointmentAt })
          }
          onSaved={() => {
            setField(current.id, { status: "termin", appointment_set: true });
            advance();
            router.refresh();
          }}
        />
      )}

      {/* ── Rückruf-Modal ── */}
      <Modal
        open={callbackOpen}
        onClose={() => setCallbackOpen(false)}
        title="Rückruf vereinbaren"
        subtitle={current?.company ?? undefined}
        width={380}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          <div>
            <label htmlFor="callback-at" style={fieldLabel}>
              Datum + Uhrzeit
            </label>
            <input
              id="callback-at"
              type="datetime-local"
              value={callbackAt}
              onChange={(e) => setCallbackAt(e.target.value)}
              style={{ ...fieldInput, padding: "0.5rem 0.75rem", fontSize: "0.875rem" }}
            />
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--text-subtle)", margin: 0, lineHeight: 1.5 }}>
            Der Lead wandert automatisch in die Rückruf-Liste des Inhabers.
          </p>
          <button
            type="button"
            disabled={!callbackAt || isPending}
            onClick={() => applyOutcome("rueckruf", callbackAt)}
            style={{
              background: "var(--btn-primary-bg)",
              color: "var(--btn-primary-fg)",
              border: "none",
              borderRadius: "var(--radius-md)",
              padding: "0.5625rem 1.125rem",
              fontSize: "0.875rem",
              fontWeight: 700,
              cursor: !callbackAt || isPending ? "default" : "pointer",
              opacity: !callbackAt || isPending ? 0.5 : 1,
            }}
          >
            {isPending ? "Speichern…" : "Rückruf speichern"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
