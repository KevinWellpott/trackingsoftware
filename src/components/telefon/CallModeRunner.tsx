"use client";

import { deletePhoneLead, setPhoneLeadOutcome, updatePhoneLead, type PhoneLeadInput } from "@/app/actions/phone";
import { convertPhoneLeadToSetting } from "@/app/actions/appointments";
import { AppointmentModal } from "@/components/appointment/AppointmentModal";
import { DateTimeField } from "@/components/ui/DateTimeField";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { berlinInputToIso, formatTermin, isoToBerlinInput } from "@/lib/apptTime";
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
  Trash2,
  Voicemail,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

// Call-Mode: eine Liste Lead für Lead durchtelefonieren. Ein Lead groß im
// Fokus, Tracking-Felder inline editierbar, Outcome-Buttons routen den Lead
// (Rückruf/Nicht erreicht → eigene Routing-Listen, via Server-Action).

type StatusFilter = PhoneLeadStatus | "alle";

const STATUS_STYLE: Record<PhoneLeadStatus, { label: string; color: string; bg: string; border: string }> = {
  aktiv: { label: "Aktiv", color: "var(--text-muted)", bg: "var(--surface-150)", border: "var(--border)" },
  rueckruf: { label: "Rückruf", color: "var(--info-fg)", bg: "var(--info-bg)", border: "rgb(78 128 214 / 0.28)" },
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

/** Feste Zeilenhöhe der Seitenliste (für die Virtualisierung). */
const SIDE_ROW_HEIGHT = 52;

/** Textfelder, die per Blur gespeichert werden (existieren auf PhoneLead + PhoneLeadInput). */
type TextFieldName =
  | "decider_name"
  | "decider_direct_dial"
  | "email"
  | "target_group"
  | "script"
  | "objection_notes"
  | "no_transfer_reason"
  | "no_pitch_reason"
  | "no_appointment_reason"
  | "notes";

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: "0.6875rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-subtle)",
  marginBottom: "0.3rem",
};

/** Label der eingerückten "Warum …?"-Freitextfragen im Frage-Flow. */
const reasonLabel: React.CSSProperties = {
  ...fieldLabel,
  fontWeight: 600,
  textTransform: "none",
  letterSpacing: 0,
  fontSize: "0.75rem",
  color: "var(--text-subtle)",
};

/** Kleine erklärende Zeile unter einem Feld (warum es so zählt / warum gesperrt). */
const fieldHint: React.CSSProperties = {
  marginTop: "0.35rem",
  fontSize: "0.6875rem",
  color: "var(--text-subtle)",
  lineHeight: 1.4,
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
        fontWeight: 600,
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
    <div className="ui-segmented" style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(active ? null : o.value)}
            style={{
              padding: "0.3rem 0.625rem",
              borderRadius: "var(--r-full)",
              border: `1px solid ${active ? activeColor : "var(--border)"}`,
              background: active ? "var(--brand-50)" : "var(--surface-50)",
              color: active ? activeColor : "var(--text-muted)",
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

function Toggle({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="ui-toggle"
      disabled={disabled}
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
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
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

/**
 * Lokal kontrolliertes Textfeld: tippt in eigenem State (keine Recomputes der
 * Lead-Liste pro Tastendruck) und committet erst on-Blur nach außen. Ändert
 * sich der externe Wert (Lead-Wechsel via key, oder Rollback nach Save-Fehler),
 * wird der Draft zurückgesetzt.
 */
function DraftField({
  value,
  onCommit,
  placeholder,
  type = "text",
  textarea = false,
  rows,
  style,
}: {
  value: string | null;
  onCommit: (raw: string) => void;
  placeholder?: string;
  type?: string;
  textarea?: boolean;
  rows?: number;
  style?: React.CSSProperties;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setDraft(value ?? "");
  }
  if (textarea) {
    return (
      <textarea
        value={draft}
        rows={rows}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
        placeholder={placeholder}
        style={style ?? fieldInput}
      />
    );
  }
  return (
    <input
      type={type}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      placeholder={placeholder}
      style={style ?? fieldInput}
    />
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
  const { confirm, dialog } = useConfirm();

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

  // ── Virtualisierte Seitenliste ──
  const sideListRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => sideListRef.current,
    estimateSize: () => SIDE_ROW_HEIGHT,
    overscan: 10,
  });

  // Aktiven Lead beim Weiter/Zurück-Navigieren in der Seitenliste sichtbar halten.
  const activeId = current?.id ?? null;
  useEffect(() => {
    if (!activeId || filtered.length === 0) return;
    rowVirtualizer.scrollToIndex(currentIndex, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  function setField(id: string, patch: Partial<PhoneLead>) {
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  /**
   * Optimistisch in die Overrides schreiben + speichern. Schlägt der Save fehl,
   * werden die betroffenen Felder auf den vorherigen Wert zurückgerollt, damit
   * die UI nie Ungespeichertes als gespeichert anzeigt.
   */
  function setAndSave(id: string, uiPatch: Partial<PhoneLead>, savePatch: Partial<PhoneLeadInput>) {
    const lead = merged.find((l) => l.id === id);
    const prevPatch: Partial<PhoneLead> = {};
    if (lead) {
      for (const k of Object.keys(uiPatch) as (keyof PhoneLead)[]) {
        (prevPatch as Record<string, unknown>)[k] = lead[k];
      }
    }
    setField(id, uiPatch);
    startTransition(async () => {
      const res = await updatePhoneLead(id, list.id, savePatch);
      if (res.error) {
        setError(res.error);
        if (lead) setField(id, prevPatch);
      } else {
        setError(null);
      }
    });
  }

  /** Blur-Commit eines Textfelds: Override setzen + getrimmt speichern. */
  function commitText(id: string, field: TextFieldName, raw: string) {
    setAndSave(
      id,
      { [field]: raw } as Partial<PhoneLead>,
      { [field]: raw.trim() || null } as Partial<PhoneLeadInput>,
    );
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
      // callback_at hält in der DB echtes UTC; der Dialog liefert Berlin-Wandzeit.
      // Der optimistische Override muss dieselbe Einheit tragen wie die Serverzeile,
      // sonst zeigt formatTermin() den Rückruf bis zum nächsten Refresh verschoben an.
      // attemptNo kommt aus dem Anruf-Log — fehlt es (fail-soft), bleibt der
      // bisherige Zähler stehen, statt eine Zahl zu erfinden.
      setField(id, {
        status: outcome,
        ...(callbackAtVal ? { callback_at: berlinInputToIso(callbackAtVal) } : {}),
        ...(res.attemptNo != null ? { call_attempt: res.attemptNo } : {}),
      });
      setCallbackOpen(false);
      setCallbackAt("");
      advance();
      router.refresh();
    });
  }

  /** Aktuellen Lead nach Bestätigung endgültig löschen, dann weiterspringen. */
  async function handleDeleteLead() {
    if (!current) return;
    const ok = await confirm({
      title: "Lead löschen?",
      message: `"${current.company ?? current.phone ?? "Lead"}" endgültig löschen? Das kann nicht rückgängig gemacht werden.`,
      confirmLabel: "Löschen",
      destructive: true,
    });
    if (!ok) return;
    const id = current.id;
    startTransition(async () => {
      const res = await deletePhoneLead(id, list.id);
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
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
        <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.25rem" }}>
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
    fontWeight: 600,
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
                  borderRadius: "var(--r-full)",
                  border: `1px solid ${active ? accent : "var(--border)"}`,
                  background: active ? (f.value === "alle" ? "var(--brand-50)" : STATUS_STYLE[f.value].bg) : "var(--surface-100)",
                  color: active ? accent : "var(--text-muted)",
                  fontSize: "0.75rem",
                  fontWeight: 600,
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
                borderRadius: "var(--r-full)",
                padding: "0.3rem 0.5rem",
                fontSize: "0.75rem",
                fontWeight: 600,
                color: currentIndex <= 0 ? "var(--text-subtle)" : "var(--text-secondary)",
                cursor: currentIndex <= 0 ? "default" : "pointer",
                opacity: currentIndex <= 0 ? 0.55 : 1,
              }}
            >
              <ChevronLeft size={13} /> Zurück
            </button>
            <span style={{ flex: 1, textAlign: "center", fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary)" }}>
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
                borderRadius: "var(--r-full)",
                padding: "0.3rem 0.5rem",
                fontSize: "0.75rem",
                fontWeight: 600,
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
              <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.25rem" }}>
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
                      fontWeight: 600,
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
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                  <StatusPill status={current.status} />
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    onClick={handleDeleteLead}
                    icon={<Trash2 size={13} />}
                    style={{ color: "var(--color-error-text)", minHeight: 0, padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                  >
                    Lead löschen
                  </Button>
                </div>
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
                      fontWeight: 600,
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
                      fontWeight: 600,
                      color: "var(--brand-500)",
                    }}
                  >
                    <CalendarClock size={12} /> Rückruf: {formatTermin(current.callback_at)}
                  </span>
                )}
              </div>

              {/* ── Frage-Flow (vertikal, eine Frage pro Zeile) ── */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.875rem",
                  marginBottom: "1rem",
                  paddingBottom: "1rem",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                {/* 1. Gatekeeper */}
                <div>
                  <label style={fieldLabel}>Gatekeeper erreicht?</label>
                  <Segmented
                    value={current.gatekeeper_reached}
                    options={[
                      { value: "ja", label: "Ja" },
                      { value: "nein", label: "Nein" },
                      { value: "direkt", label: "Direkt" },
                    ]}
                    onChange={(v) => {
                      setAndSave(current.id, { gatekeeper_reached: v }, { gatekeeper_reached: v });
                    }}
                  />
                </div>
                {/* 2. Warum nicht durchgestellt? */}
                <div style={{ paddingLeft: "0.875rem", borderLeft: "2px solid var(--border)" }}>
                  <label style={reasonLabel}>Warum nicht durchgestellt?</label>
                  <DraftField
                    key={current.id}
                    textarea
                    rows={2}
                    value={current.no_transfer_reason}
                    onCommit={(raw) => commitText(current.id, "no_transfer_reason", raw)}
                    placeholder="Grund, falls nicht durchgestellt…"
                    style={{ ...fieldInput, resize: "vertical", minHeight: 44 }}
                  />
                </div>

                {/* 3. Entscheider erreicht? — bis Migration 0028 lag hier EIN
                    Schalter mit der Beschriftung „Entscheider gepitcht?", der
                    auf decider_reached schrieb. Deshalb waren „Entscheider
                    erreicht" und „Pitch kam durch" in jeder Auswertung
                    zwangsläufig dieselbe Zahl. */}
                <div>
                  <label style={fieldLabel}>Entscheider erreicht?</label>
                  <Toggle
                    value={current.decider_reached === true}
                    onChange={(v) => {
                      // Kein Entscheider am Apparat ⇒ es kann auch kein Pitch
                      // durchgekommen sein. Wird der Schalter zurückgenommen,
                      // fällt der Pitch mit — sonst bliebe eine unmögliche
                      // Kombination stehen, die niemand mehr nachträglich sieht.
                      if (v) {
                        setAndSave(current.id, { decider_reached: true }, { decider_reached: true });
                      } else {
                        setAndSave(
                          current.id,
                          { decider_reached: false, pitch_delivered: false },
                          { decider_reached: false, pitch_delivered: false },
                        );
                      }
                    }}
                    label={current.decider_reached === true ? "Ja" : "Nein"}
                  />
                </div>
                {/* 3b. Pitch gekommen? — nur sinnvoll, wenn der Entscheider dran war. */}
                <div style={{ paddingLeft: "0.875rem", borderLeft: "2px solid var(--border)" }}>
                  <label style={reasonLabel}>Pitch gekommen?</label>
                  <Toggle
                    value={current.pitch_delivered === true}
                    disabled={current.decider_reached !== true}
                    onChange={(v) => {
                      setAndSave(current.id, { pitch_delivered: v }, { pitch_delivered: v });
                    }}
                    label={current.pitch_delivered === true ? "Ja" : "Nein"}
                  />
                  {current.decider_reached !== true && (
                    <p style={fieldHint}>Erst aktiv, wenn der Entscheider erreicht wurde.</p>
                  )}
                </div>
                {/* 4. Warum kein Pitch? */}
                <div style={{ paddingLeft: "0.875rem", borderLeft: "2px solid var(--border)" }}>
                  <label style={reasonLabel}>Warum kein Pitch?</label>
                  <DraftField
                    key={current.id}
                    textarea
                    rows={2}
                    value={current.no_pitch_reason}
                    onCommit={(raw) => commitText(current.id, "no_pitch_reason", raw)}
                    placeholder="Grund, falls kein Pitch…"
                    style={{ ...fieldInput, resize: "vertical", minHeight: 44 }}
                  />
                </div>

                {/* 5. Termin? */}
                <div>
                  <label style={fieldLabel}>Termin?</label>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => setApptOpen(true)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.35rem",
                        padding: "0.3rem 0.875rem",
                        borderRadius: "var(--r-full)",
                        border: "1px solid var(--color-success-border)",
                        background: "var(--color-success-bg)",
                        color: "var(--color-success-text)",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        cursor: isPending ? "default" : "pointer",
                        opacity: isPending ? 0.6 : 1,
                        transition: "all 0.1s",
                      }}
                    >
                      <Calendar size={12} /> Ja
                    </button>
                    <span
                      style={{
                        padding: "0.3rem 0.875rem",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border)",
                        background: "var(--surface-50)",
                        color: "var(--text-muted)",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                      }}
                    >
                      Nein
                    </span>
                    {(current.status === "termin" || current.appointment_set) && (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.3rem",
                          fontSize: "0.6875rem",
                          fontWeight: 600,
                          color: "var(--color-success-text)",
                          background: "var(--color-success-bg)",
                          border: "1px solid var(--color-success-border)",
                          borderRadius: 99,
                          padding: "0.15rem 0.55rem",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <Calendar size={11} /> Termin gebucht
                        {current.appointment_at ? ` · ${formatTermin(current.appointment_at)}` : ""}
                      </span>
                    )}
                  </div>
                </div>
                {/* 6. Warum kein Termin? */}
                <div style={{ paddingLeft: "0.875rem", borderLeft: "2px solid var(--border)" }}>
                  <label style={reasonLabel}>Warum kein Termin?</label>
                  <DraftField
                    key={current.id}
                    textarea
                    rows={2}
                    value={current.no_appointment_reason}
                    onCommit={(raw) => commitText(current.id, "no_appointment_reason", raw)}
                    placeholder="Grund, falls kein Termin…"
                    style={{ ...fieldInput, resize: "vertical", minHeight: 44 }}
                  />
                </div>
              </div>

              {/* ── Weitere Tracking-Felder ── */}
              <div className="call-fields-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem 1rem", marginBottom: "1rem" }}>
                {/* Anzeige statt Eingabe: Der Versuchszähler wurde bis
                    Migration 0028 von Hand gesetzt — mitten im Telefonat, mit
                    entsprechender Verlässlichkeit. Jetzt zählt das Anruf-Log
                    (phone_call_attempts) mit, sobald unten ein Ergebnis fällt;
                    hier steht nur noch, der wievielte Anruf gerade läuft. Der
                    Bedienfluss verliert dadurch einen Klick. */}
                <div>
                  <label style={fieldLabel}>Anruf-Versuch</label>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.4rem",
                      padding: "0.3rem 0.625rem",
                      borderRadius: "var(--r-full)",
                      border: "1px solid var(--border)",
                      background: "var(--surface-50)",
                      color: "var(--text-secondary)",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                    }}
                  >
                    <Phone size={12} style={{ opacity: 0.7 }} />
                    {(current.call_attempt ?? 0) + 1}. Anruf
                  </span>
                  <p style={fieldHint}>Zählt automatisch, sobald du unten ein Ergebnis wählst.</p>
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
                      setAndSave(current.id, { answer_sentiment: v }, { answer_sentiment: v });
                    }}
                  />
                </div>
                <div>
                  <label style={fieldLabel}>Mailbox</label>
                  <Toggle
                    value={current.mailbox === true}
                    onChange={(v) => {
                      setAndSave(current.id, { mailbox: v }, { mailbox: v });
                    }}
                    label="Mailbox"
                  />
                </div>
                <div>
                  <label style={fieldLabel}>Ansprechpartner (Entscheider)</label>
                  <DraftField
                    key={current.id}
                    value={current.decider_name}
                    onCommit={(raw) => commitText(current.id, "decider_name", raw)}
                    placeholder="Name…"
                  />
                </div>
                <div>
                  <label style={fieldLabel}>E-Mail</label>
                  <DraftField
                    key={current.id}
                    type="email"
                    value={current.email}
                    onCommit={(raw) => commitText(current.id, "email", raw)}
                    placeholder="mail@firma.de"
                  />
                </div>
                <div>
                  <label style={fieldLabel}>Durchwahl Entscheider</label>
                  <DraftField
                    key={current.id}
                    value={current.decider_direct_dial}
                    onCommit={(raw) => commitText(current.id, "decider_direct_dial", raw)}
                    placeholder="+49…"
                  />
                </div>
                <div>
                  <label style={fieldLabel}>Zielgruppe</label>
                  <DraftField
                    key={current.id}
                    value={current.target_group}
                    onCommit={(raw) => commitText(current.id, "target_group", raw)}
                    placeholder="z. B. Handwerk"
                  />
                </div>
                <div>
                  <label style={fieldLabel}>Skript</label>
                  <DraftField
                    key={current.id}
                    value={current.script}
                    onCommit={(raw) => commitText(current.id, "script", raw)}
                    placeholder="Verwendetes Skript…"
                  />
                </div>
                <div>
                  <label style={fieldLabel}>Einwände</label>
                  <DraftField
                    key={current.id}
                    value={current.objection_notes}
                    onCommit={(raw) => commitText(current.id, "objection_notes", raw)}
                    placeholder="z. B. kein Budget…"
                  />
                </div>

                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={fieldLabel}>Notizen</label>
                  <DraftField
                    key={current.id}
                    textarea
                    rows={2}
                    value={current.notes}
                    onCommit={(raw) => commitText(current.id, "notes", raw)}
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
                    // callback_at ist echtes UTC mit Offset und Sekunden — das
                    // Eingabefeld erwartet Berlin-Wandzeit ("2026-08-09T10:00").
                    setCallbackAt(isoToBerlinInput(current.callback_at));
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
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Toter Lead?",
                      message: `"${current.company ?? current.phone ?? "Lead"}" wirklich als toten Lead markieren?`,
                      confirmLabel: "Als tot markieren",
                      destructive: true,
                    });
                    if (ok) applyOutcome("dead");
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
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--text-subtle)",
            }}
          >
            Leads ({filtered.length})
          </div>
          <div ref={sideListRef} style={{ maxHeight: 560, overflowY: "auto" }}>
            <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
              {rowVirtualizer.getVirtualItems().map((vi) => {
                const l = filtered[vi.index];
                if (!l) return null;
                const active = current?.id === l.id;
                const s = STATUS_STYLE[l.status];
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setCurrentId(l.id)}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: vi.size,
                      transform: `translateY(${vi.start}px)`,
                      boxSizing: "border-box",
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
                      {vi.index + 1}
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
            </div>
            {filtered.length === 0 && (
              <p style={{ fontSize: "0.8125rem", color: "var(--text-subtle)", textAlign: "center", padding: "1.25rem 0.75rem" }}>
                Keine Treffer.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Termin-Modal ──
          defaultAppointmentAt: `appointment_at` ist echtes UTC. Roh
          durchgereicht ("2026-08-09T08:00:00+00:00") liest das Eingabefeld den
          Wert als Berliner Wandzeit und schiebt den Termin beim Speichern um
          den UTC-Offset — deshalb über isoToBerlinInput (docs §6). */}
      {current && (
        <AppointmentModal
          open={apptOpen}
          onClose={() => setApptOpen(false)}
          leadName={current.company ?? current.decider_name ?? undefined}
          defaultMeetLink={current.meet_link ?? undefined}
          defaultAppointmentAt={isoToBerlinInput(current.appointment_at) || undefined}
          onSubmit={({ meetLink, meetingKind, appointmentAt }) =>
            convertPhoneLeadToSetting({ phoneLeadId: current.id, listId: list.id, meetLink, meetingKind, appointmentAt })
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
            <DateTimeField
              id="callback-at"
              value={callbackAt}
              onChange={setCallbackAt}
              ariaLabel="Rückruf"
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
              background: "var(--grad-cta)",
              color: "var(--text-on-accent)",
              boxShadow: "var(--shadow-btn-primary)",
              border: "none",
              borderRadius: "var(--r-full)",
              padding: "0.5625rem 1.125rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: !callbackAt || isPending ? "default" : "pointer",
              opacity: !callbackAt || isPending ? 0.5 : 1,
            }}
          >
            {isPending ? "Speichern…" : "Rückruf speichern"}
          </button>
        </div>
      </Modal>

      {/* ── Bestätigungsdialog (Toter Lead / Lead löschen) ── */}
      {dialog}
    </div>
  );
}
