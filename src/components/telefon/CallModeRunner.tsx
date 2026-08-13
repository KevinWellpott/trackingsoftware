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
  User,
  Voicemail,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

// Call-Mode: eine Liste Lead für Lead durchtelefonieren. Ein Lead groß im
// Fokus, Tracking-Felder inline editierbar, Outcome-Buttons routen den Lead
// (Rückruf/Nicht erreicht → eigene Routing-Listen, via Server-Action).

type StatusFilter = PhoneLeadStatus | "alle";

/**
 * Statusfarben tragen ab hier nur noch PUNKTE, keine Flaechen mehr.
 *
 * Vorher hatte jeder Status Fuellung + Rahmen + Textfarbe, und die Ansicht
 * benutzte das gleichzeitig fuer Filter-Chips, Ergebnis-Buttons, Pillen und
 * Listenpunkte — fuenf Semantiktoene, jeder mehrfach vollflaechig. Als
 * 6px-Punkt bleibt dieselbe Information lesbar, ohne dass sie mit dem einen
 * Akzent der Ansicht (der Rufnummer) um Aufmerksamkeit konkurriert.
 */
const STATUS_STYLE: Record<PhoneLeadStatus, { label: string; color: string }> = {
  aktiv: { label: "Aktiv", color: "var(--text-muted)" },
  rueckruf: { label: "Rückruf", color: "var(--info)" },
  nicht_erreicht: { label: "Nicht erreicht", color: "var(--warning)" },
  termin: { label: "Termin", color: "var(--success)" },
  dead: { label: "Dead", color: "var(--danger)" },
};

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "alle", label: "Alle" },
  { value: "aktiv", label: "Aktiv" },
  { value: "rueckruf", label: "Rückruf" },
  { value: "nicht_erreicht", label: "Nicht erreicht" },
  { value: "termin", label: "Termin" },
  { value: "dead", label: "Dead" },
];

/**
 * Tastenkuerzel der Ergebnis-Buttons. Ein Power-Dialer wird im Minutentakt
 * bedient — jeder Griff zur Maus kostet dort mehr als die Eingabe selbst.
 * Bewusst Ziffern statt Anfangsbuchstaben: `t` und `n` liegen auf Deutsch auf
 * „Termin"/„Nicht erreicht" UND auf „Toter Lead"/„Notizen", und ein Kuerzel,
 * das man sich merken muss, ist keins.
 */
const OUTCOME_KEYS = { termin: "1", rueckruf: "2", nicht_erreicht: "3", dead: "4" } as const;

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

/** Der Statuspunkt — das einzige verbliebene Farbsignal je Status. */
function StatusDot({ status, size = 6 }: { status: PhoneLeadStatus; size?: number }) {
  return (
    <span
      title={STATUS_STYLE[status].label}
      style={{
        width: size,
        height: size,
        borderRadius: "var(--r-full)",
        background: STATUS_STYLE[status].color,
        flexShrink: 0,
      }}
    />
  );
}

function StatusPill({ status }: { status: PhoneLeadStatus }) {
  return (
    <span
      className="badge badge-gray"
      style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}
    >
      <StatusDot status={status} />
      {STATUS_STYLE[status].label}
    </span>
  );
}

/**
 * Auswahl aus wenigen Werten. Aktiv = eine Surface-Stufe heller plus kraeftige
 * Hairline — dieselbe Sprache wie `.show-seg` und `.dialer-filter`. Vorher war
 * aktiv in Markenorange gefuellt; damit trug der Akzent hier Status, was das
 * System ausdruecklich ausschliesst.
 */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (v: T | null) => void;
}) {
  return (
    <div className="show-group ui-segmented">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="show-seg"
          data-active={value === o.value ? "true" : undefined}
          onClick={() => onChange(value === o.value ? null : o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Ja/Nein als Selektor statt als eingefaerbter Schalter — derselbe Baustein wie
 * `Segmented`, damit im Frage-Flow nicht zwei Bedienmuster nebeneinander stehen.
 *
 * `value` ist bewusst `boolean | null`: NULL heisst „noch nicht erfasst" und
 * ist im Telefon-Modell der Normalfall (docs §7). Beide Segmente bleiben dann
 * unmarkiert. Ein voreingestelltes „Nein" waere eine erfundene Antwort — und
 * genau die Sorte Zahl, die spaeter als Fakt in der Auswertung landet.
 */
function Toggle({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
  /** Beschriftung des Ja-Segments; ohne Angabe schlicht „Ja". */
  label?: string;
  disabled?: boolean;
}) {
  return (
    <div className="show-group ui-segmented" style={{ opacity: disabled ? 0.5 : 1 }}>
      <button
        type="button"
        className="show-seg"
        data-tone="show"
        data-active={value === true ? "true" : undefined}
        disabled={disabled}
        onClick={() => onChange(true)}
      >
        {label ?? "Ja"}
      </button>
      <button
        type="button"
        className="show-seg"
        data-active={value === false ? "true" : undefined}
        disabled={disabled}
        onClick={() => onChange(false)}
      >
        Nein
      </button>
    </div>
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
        className="input"
        value={draft}
        rows={rows}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
        placeholder={placeholder}
        style={{ resize: "vertical", lineHeight: "var(--lh-base)", ...style }}
      />
    );
  }
  return (
    <input
      className="input"
      type={type}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      placeholder={placeholder}
      style={style}
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

  // Tastatur: ← / → navigiert, 1–4 setzen das Ergebnis. Beides greift nicht,
  // während in einem Feld getippt wird oder ein Dialog offen steht — sonst
  // löste die „4" in einer Telefonnummer einen toten Lead aus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement | null)?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (apptOpen || callbackOpen) return;
      if (e.key === "ArrowLeft") return goto(currentIndex - 1);
      if (e.key === "ArrowRight") return goto(currentIndex + 1);
      if (!current || isPending) return;
      if (e.key === OUTCOME_KEYS.termin) {
        e.preventDefault();
        setApptOpen(true);
      } else if (e.key === OUTCOME_KEYS.rueckruf) {
        e.preventDefault();
        openCallback();
      } else if (e.key === OUTCOME_KEYS.nicht_erreicht) {
        e.preventDefault();
        applyOutcome("nicht_erreicht");
      } else if (e.key === OUTCOME_KEYS.dead) {
        e.preventDefault();
        void confirmDead();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, filtered, current, isPending, apptOpen, callbackOpen]);

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

  /**
   * Rückruf-Dialog öffnen. `callback_at` ist echtes UTC mit Offset und
   * Sekunden — das Eingabefeld erwartet Berlin-Wandzeit ("2026-08-09T10:00").
   * Bewusst als Funktion statt inline im Button: Tastatur und Klick müssen
   * denselben Weg nehmen, sonst driften sie beim nächsten Umbau auseinander.
   */
  function openCallback() {
    if (!current) return;
    setCallbackAt(isoToBerlinInput(current.callback_at));
    setCallbackOpen(true);
  }

  /** „Toter Lead" — immer mit Rückfrage, auch per Tastenkürzel. */
  async function confirmDead() {
    if (!current) return;
    const ok = await confirm({
      title: "Toter Lead?",
      message: `„${current.company ?? current.phone ?? "Lead"}" wirklich als toten Lead markieren?`,
      confirmLabel: "Als tot markieren",
      destructive: true,
    });
    if (ok) applyOutcome("dead");
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
      <div className="card dot-grid">
        <div className="empty-state">
          <Phone size={24} />
          <div style={{ fontSize: "var(--fs-md)", fontWeight: "var(--fw-medium)", color: "var(--text-primary)" }}>
            Keine Leads in dieser Liste
          </div>
          <p style={{ fontSize: "var(--fs-base)", color: "var(--text-muted)", margin: 0 }}>
            Importiere eine CSV auf der Telefon-Übersicht — die Leads landen dann hier im Call-Mode.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* ── Toolbar: Filter + Suche ── */}
      <div className="dialer-bar">
        <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className="dialer-filter"
              data-active={statusFilter === f.value ? "true" : undefined}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.value !== "alle" && (
                <span className="dialer-filter-dot" style={{ background: STATUS_STYLE[f.value].color }} />
              )}
              {f.label}
              <span className="dialer-filter-count">{statusCounts[f.value]}</span>
            </button>
          ))}
        </div>

        <div style={{ position: "relative", marginLeft: "auto", minWidth: 220 }}>
          <Search
            size={13}
            style={{
              position: "absolute",
              left: "var(--sp-5)",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-muted)",
              pointerEvents: "none",
            }}
          />
          <input
            className="input"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Firma / Telefon suchen…"
            style={{ paddingLeft: "var(--sp-9)" }}
          />
        </div>
      </div>

      {error && (
        <div
          style={{
            fontSize: "var(--fs-sm)",
            color: "var(--danger-fg)",
            background: "var(--danger-bg)",
            border: "1px solid var(--color-error-border)",
            borderRadius: "var(--r-sm)",
            padding: "var(--sp-4) var(--sp-6)",
            marginBottom: "var(--sp-6)",
          }}
        >
          {error}
        </div>
      )}

      <div
        className="call-mode-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(220px, 1fr)",
          gap: "var(--sp-6)",
          alignItems: "start",
        }}
      >
        {/* ══ Call-Mode Card ══ */}
        <div className="card" style={{ overflow: "hidden" }}>
          {/* Position bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-4)",
              padding: "var(--sp-4) var(--sp-6)",
              borderBottom: "1px solid var(--border-default)",
              background: "var(--surface-1)",
            }}
          >
            <button
              type="button"
              className="dialer-nav"
              onClick={() => goto(currentIndex - 1)}
              disabled={currentIndex <= 0}
              aria-label="Vorheriger Lead"
            >
              <ChevronLeft size={13} /> Zurück
            </button>
            <span
              className="tnum"
              style={{
                flex: 1,
                textAlign: "center",
                fontSize: "var(--fs-sm)",
                fontWeight: "var(--fw-medium)",
                color: "var(--text-secondary)",
              }}
            >
              Lead {filtered.length === 0 ? 0 : currentIndex + 1} / {filtered.length}
              <span style={{ marginLeft: "var(--sp-4)", color: "var(--text-muted)" }}>
                <span className="dialer-kbd">←</span> <span className="dialer-kbd">→</span>
              </span>
            </span>
            <button
              type="button"
              className="dialer-nav"
              onClick={() => goto(currentIndex + 1)}
              disabled={currentIndex >= filtered.length - 1}
              aria-label="Nächster Lead"
            >
              Weiter <ChevronRight size={13} />
            </button>
          </div>

          {!current ? (
            <div className="empty-state">
              <Search size={22} />
              <div style={{ fontSize: "var(--fs-md)", fontWeight: "var(--fw-medium)", color: "var(--text-primary)" }}>
                Keine Leads für diesen Filter
              </div>
              <p style={{ fontSize: "var(--fs-base)", color: "var(--text-muted)", margin: 0 }}>
                Filter oder Suche anpassen, um weitere Leads zu sehen.
              </p>
            </div>
          ) : (
            <div style={{ padding: "var(--sp-7) var(--sp-8)" }}>
              {/* Lead head: Firma + Status */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-5)", marginBottom: "var(--sp-6)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h2
                    style={{
                      fontSize: "var(--fs-xl)",
                      fontWeight: "var(--fw-semibold)",
                      letterSpacing: "var(--ls-display)",
                      color: "var(--text-primary)",
                      margin: 0,
                      lineHeight: "var(--lh-tight)",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {current.company || "Unbekannte Firma"}
                  </h2>
                  {/* Sekundäre Kontaktzeile: Ansprechpartner + Website. Beide
                      neutral — der Akzent bleibt der Rufnummer vorbehalten. */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--sp-5)",
                      flexWrap: "wrap",
                      marginTop: "var(--sp-3)",
                      fontSize: "var(--fs-sm)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {current.decider_name && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}>
                        <User size={12} /> {current.decider_name}
                      </span>
                    )}
                    {current.website && (
                      <a
                        href={current.website.startsWith("http") ? current.website : `https://${current.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "var(--sp-3)",
                          color: "var(--text-muted)",
                          textDecoration: "none",
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
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexShrink: 0 }}>
                  <StatusPill status={current.status} />
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    onClick={handleDeleteLead}
                    icon={<Trash2 size={13} />}
                    aria-label="Lead löschen"
                    style={{ color: "var(--text-muted)", minHeight: 0, padding: "var(--sp-2) var(--sp-4)" }}
                  />
                </div>
              </div>

              {/* Telefonnummer — die einzige Handlung, die den Bildschirm
                  verlässt, und deshalb der einzige Akzent dieser Ansicht. */}
              <div className="dialer-call" style={{ marginBottom: "var(--sp-7)" }}>
                {current.phone ? (
                  <a className="dialer-call-link" href={`tel:${current.phone.replace(/[^\d+]/g, "")}`}>
                    <Phone size={18} /> {current.phone}
                  </a>
                ) : (
                  <span className="dialer-call-empty">Keine Telefonnummer</span>
                )}
                <div
                  style={{
                    marginLeft: "auto",
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--sp-5)",
                    fontSize: "var(--fs-xs)",
                    color: "var(--text-muted)",
                  }}
                >
                  {current.decider_direct_dial && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}>
                      Durchwahl <span className="tnum" style={{ color: "var(--text-secondary)" }}>{current.decider_direct_dial}</span>
                    </span>
                  )}
                  <span className="tnum">{(current.call_attempt ?? 0) + 1}. Anruf</span>
                  {current.callback_at && current.status === "rueckruf" && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}>
                      <CalendarClock size={12} /> {formatTermin(current.callback_at)}
                    </span>
                  )}
                </div>
              </div>

              {/* ── Frage-Flow (vertikal, eine Frage pro Zeile) ──
                  Alle Felder bleiben sichtbar und beschreibbar, auch die
                  „Warum …?"-Zeilen. Sie bedingt einzublenden hiesse, dass ein
                  Grund, den jemand schon eingetragen hat, beim naechsten
                  Antwortwechsel verschwindet — im Setting-Skript war genau das
                  der Fehler. Ruhig wird die Sektion ueber Hierarchie
                  (Rail statt Kasten, Sublabel statt Eyebrow), nicht ueber
                  weniger Eingabemoeglichkeiten. */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--sp-6)",
                  marginBottom: "var(--sp-7)",
                  paddingBottom: "var(--sp-7)",
                  borderBottom: "1px solid var(--border-default)",
                }}
              >
                <span className="eyebrow eyebrow-muted">Gesprächsverlauf</span>
                {/* 1. Gatekeeper */}
                <div>
                  <label className="dialer-label">Gatekeeper erreicht?</label>
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
                <div className="dialer-sub">
                  <label className="dialer-sublabel">Warum nicht durchgestellt?</label>
                  <DraftField
                    key={current.id}
                    textarea
                    rows={2}
                    value={current.no_transfer_reason}
                    onCommit={(raw) => commitText(current.id, "no_transfer_reason", raw)}
                    placeholder="Grund, falls nicht durchgestellt…"
                    style={{ minHeight: 44 }}
                  />
                </div>

                {/* 3. Entscheider erreicht? — bis Migration 0028 lag hier EIN
                    Schalter mit der Beschriftung „Entscheider gepitcht?", der
                    auf decider_reached schrieb. Deshalb waren „Entscheider
                    erreicht" und „Pitch kam durch" in jeder Auswertung
                    zwangsläufig dieselbe Zahl. */}
                <div>
                  <label className="dialer-label">Entscheider erreicht?</label>
                  <Toggle
                    value={current.decider_reached}
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
                  />
                </div>
                {/* 3b. Pitch gekommen? — nur sinnvoll, wenn der Entscheider dran war. */}
                <div className="dialer-sub">
                  <label className="dialer-sublabel">Pitch gekommen?</label>
                  <Toggle
                    value={current.pitch_delivered}
                    disabled={current.decider_reached !== true}
                    onChange={(v) => {
                      setAndSave(current.id, { pitch_delivered: v }, { pitch_delivered: v });
                    }}
                  />
                  {current.decider_reached !== true && (
                    <p className="dialer-hint">Erst aktiv, wenn der Entscheider erreicht wurde.</p>
                  )}
                </div>
                {/* 4. Warum kein Pitch? */}
                <div className="dialer-sub">
                  <label className="dialer-sublabel">Warum kein Pitch?</label>
                  <DraftField
                    key={current.id}
                    textarea
                    rows={2}
                    value={current.no_pitch_reason}
                    onCommit={(raw) => commitText(current.id, "no_pitch_reason", raw)}
                    placeholder="Grund, falls kein Pitch…"
                    style={{ minHeight: 44 }}
                  />
                </div>

                {/* 5. Termin? */}
                <div>
                  <label className="dialer-label">Termin?</label>
                  {/* Vorher standen hier ein grüner „Ja"-Button und ein
                      grauer „Nein"-Chip nebeneinander — letzterer sah aus wie
                      ein Schalter, war aber totes Markup. „Kein Termin" ist
                      kein Klick, sondern der Normalfall; die Buchung ist die
                      einzige Handlung und steht deshalb allein. */}
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap" }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={isPending}
                      onClick={() => setApptOpen(true)}
                      icon={<Calendar size={12} />}
                    >
                      Termin buchen
                    </Button>
                    {(current.status === "termin" || current.appointment_set) && (
                      <span className="badge badge-green" style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}>
                        <Calendar size={11} /> Gebucht
                        {current.appointment_at ? ` · ${formatTermin(current.appointment_at)}` : ""}
                      </span>
                    )}
                  </div>
                </div>
                {/* 6. Warum kein Termin? */}
                <div className="dialer-sub">
                  <label className="dialer-sublabel">Warum kein Termin?</label>
                  <DraftField
                    key={current.id}
                    textarea
                    rows={2}
                    value={current.no_appointment_reason}
                    onCommit={(raw) => commitText(current.id, "no_appointment_reason", raw)}
                    placeholder="Grund, falls kein Termin…"
                    style={{ minHeight: 44 }}
                  />
                </div>
              </div>

              {/* ── Weitere Tracking-Felder ──
                  Der Versuchszähler stand hier bis eben als eigenes Feld mit
                  Erklärzeile. Er ist eine reine Anzeige (das Anruf-Log zählt
                  ihn seit Migration 0028 selbst) und gehört an die Rufnummer,
                  nicht ins Eingaberaster: Dort oben beantwortet er „der
                  wievielte Anruf ist das", bevor jemand wählt. */}
              <span className="eyebrow eyebrow-muted" style={{ display: "block", marginBottom: "var(--sp-5)" }}>
                Kontaktdaten &amp; Notizen
              </span>
              <div
                className="call-fields-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "var(--sp-6) var(--sp-7)",
                  marginBottom: "var(--sp-7)",
                }}
              >
                <div>
                  <label className="dialer-label">Reaktion</label>
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
                  <label className="dialer-label">Mailbox</label>
                  <Toggle
                    value={current.mailbox}
                    onChange={(v) => {
                      setAndSave(current.id, { mailbox: v }, { mailbox: v });
                    }}
                  />
                </div>
                <div>
                  <label className="dialer-label">Ansprechpartner (Entscheider)</label>
                  <DraftField
                    key={current.id}
                    value={current.decider_name}
                    onCommit={(raw) => commitText(current.id, "decider_name", raw)}
                    placeholder="Name…"
                  />
                </div>
                <div>
                  <label className="dialer-label">E-Mail</label>
                  <DraftField
                    key={current.id}
                    type="email"
                    value={current.email}
                    onCommit={(raw) => commitText(current.id, "email", raw)}
                    placeholder="mail@firma.de"
                  />
                </div>
                <div>
                  <label className="dialer-label">Durchwahl Entscheider</label>
                  <DraftField
                    key={current.id}
                    value={current.decider_direct_dial}
                    onCommit={(raw) => commitText(current.id, "decider_direct_dial", raw)}
                    placeholder="+49…"
                  />
                </div>
                <div>
                  <label className="dialer-label">Zielgruppe</label>
                  <DraftField
                    key={current.id}
                    value={current.target_group}
                    onCommit={(raw) => commitText(current.id, "target_group", raw)}
                    placeholder="z. B. Handwerk"
                  />
                </div>
                <div>
                  <label className="dialer-label">Skript</label>
                  <DraftField
                    key={current.id}
                    value={current.script}
                    onCommit={(raw) => commitText(current.id, "script", raw)}
                    placeholder="Verwendetes Skript…"
                  />
                </div>
                <div>
                  <label className="dialer-label">Einwände</label>
                  <DraftField
                    key={current.id}
                    value={current.objection_notes}
                    onCommit={(raw) => commitText(current.id, "objection_notes", raw)}
                    placeholder="z. B. kein Budget…"
                  />
                </div>

                <div style={{ gridColumn: "1 / -1" }}>
                  <label className="dialer-label">Notizen</label>
                  <DraftField
                    key={current.id}
                    textarea
                    rows={2}
                    value={current.notes}
                    onCommit={(raw) => commitText(current.id, "notes", raw)}
                    placeholder="Gesprächsnotizen…"
                    style={{ minHeight: 52 }}
                  />
                </div>
              </div>

              {/* ── Ergebnis des Anrufs ──
                  Vier vollflächig eingefärbte Buttons standen hier bisher
                  nebeneinander — grün, Markenorange, gold, rot. Das war nicht
                  nur laut, sondern doppelt regelwidrig: Markenorange trug
                  Status („Rückruf"), und vier gleich laute Flächen sagen dem
                  Auge, dass alle vier gleich wahrscheinlich sind. Sind sie
                  nicht — „Termin" ist das Ergebnis, auf das der Anruf zielt.
                  Es trägt als einziges eine Fläche, der Rest ist Surface mit
                  Semantik-Punkt. */}
              <div
                style={{
                  borderTop: "1px solid var(--border-default)",
                  paddingTop: "var(--sp-7)",
                }}
              >
                <span className="eyebrow eyebrow-muted" style={{ display: "block", marginBottom: "var(--sp-5)" }}>
                  Ergebnis des Anrufs
                </span>
                <div style={{ display: "flex", gap: "var(--sp-4)", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="dialer-outcome"
                    data-tone="won"
                    disabled={isPending}
                    onClick={() => setApptOpen(true)}
                  >
                    <Calendar size={14} /> Termin
                    <span className="dialer-kbd">{OUTCOME_KEYS.termin}</span>
                  </button>
                  <button type="button" className="dialer-outcome" disabled={isPending} onClick={openCallback}>
                    <span className="dialer-outcome-dot" style={{ background: STATUS_STYLE.rueckruf.color }} />
                    <PhoneMissed size={14} /> Rückruf
                    <span className="dialer-kbd">{OUTCOME_KEYS.rueckruf}</span>
                  </button>
                  <button
                    type="button"
                    className="dialer-outcome"
                    disabled={isPending}
                    onClick={() => applyOutcome("nicht_erreicht")}
                  >
                    <span className="dialer-outcome-dot" style={{ background: STATUS_STYLE.nicht_erreicht.color }} />
                    <Voicemail size={14} /> Nicht erreicht
                    <span className="dialer-kbd">{OUTCOME_KEYS.nicht_erreicht}</span>
                  </button>
                  <button type="button" className="dialer-outcome" disabled={isPending} onClick={confirmDead}>
                    <span className="dialer-outcome-dot" style={{ background: STATUS_STYLE.dead.color }} />
                    <PhoneOff size={14} /> Toter Lead
                    <span className="dialer-kbd">{OUTCOME_KEYS.dead}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ══ Lead-Liste (Seite) ══ */}
        <div className="card" style={{ overflow: "hidden" }}>
          <div
            className="eyebrow eyebrow-muted"
            style={{
              padding: "var(--sp-5) var(--sp-6)",
              borderBottom: "1px solid var(--border-default)",
              background: "var(--surface-1)",
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
                return (
                  <button
                    key={l.id}
                    type="button"
                    className="dialer-row"
                    data-active={active ? "true" : undefined}
                    onClick={() => setCurrentId(l.id)}
                    style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}
                  >
                    <span
                      className="tnum"
                      style={{ fontSize: "var(--fs-2xs)", color: "var(--text-muted)", width: 22, flexShrink: 0 }}
                    >
                      {vi.index + 1}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: "var(--fs-sm)",
                          fontWeight: active ? "var(--fw-semibold)" : "var(--fw-regular)",
                          color: active ? "var(--text-primary)" : "var(--text-secondary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {l.company || l.phone || "—"}
                      </span>
                      <span className="tnum" style={{ display: "block", fontSize: "var(--fs-2xs)", color: "var(--text-muted)" }}>
                        {l.phone ?? "keine Nummer"}
                      </span>
                    </span>
                    <StatusDot status={l.status} size={7} />
                  </button>
                );
              })}
            </div>
            {filtered.length === 0 && (
              <p style={{ fontSize: "var(--fs-base)", color: "var(--text-muted)", textAlign: "center", padding: "var(--sp-7) var(--sp-5)" }}>
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
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
          <div>
            <label htmlFor="callback-at" className="dialer-label">
              Datum + Uhrzeit
            </label>
            <DateTimeField
              id="callback-at"
              value={callbackAt}
              onChange={setCallbackAt}
              ariaLabel="Rückruf"
            />
          </div>
          <p className="dialer-hint" style={{ margin: 0 }}>
            Der Lead wandert automatisch in die Rückruf-Liste des Inhabers.
          </p>
          <Button
            variant="primary"
            disabled={!callbackAt}
            loading={isPending}
            onClick={() => applyOutcome("rueckruf", callbackAt)}
          >
            Rückruf speichern
          </Button>
        </div>
      </Modal>

      {/* ── Bestätigungsdialog (Toter Lead / Lead löschen) ── */}
      {dialog}
    </div>
  );
}
