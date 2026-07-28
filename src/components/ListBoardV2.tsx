"use client";

import {
  createContact,
  deleteContact as deleteContactAction,
  setContactBlocked,
  updateContact,
  type ContactInput,
} from "@/app/actions/contacts";
import { clearContactAppointment, convertContactToSetting } from "@/app/actions/appointments";
import { AppointmentModal } from "@/components/appointment/AppointmentModal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { DatePicker, formatDateDe } from "@/components/ui/DatePicker";
import { Segmented } from "@/components/ui/Segmented";
import { Select, type SelectOption } from "@/components/ui/Select";
import type { ListContact } from "@/lib/types";
import { CATEGORY_CONFIG, SELECTABLE_CATEGORIES, categoryStyle, type AnswerCategory, type SelectableCategory } from "@/lib/categories";
import { addDaysISO, localDateISO } from "@/lib/dates";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Ban, Calendar, CheckCircle, ExternalLink, Search, Trash2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { useIsMobile } from "@/lib/useIsMobile";

// ─── Layout-Konstanten ────────────────────────────────────────────────────────
// Gemeinsames Grid für Header + Zeilen, damit die Spalten exakt fluchten.
const GRID_COLS =
  "112px minmax(150px, 1.4fr) 66px 74px 74px 150px minmax(150px, 1.4fr) minmax(120px, 1fr) 68px";
const ROW_HEIGHT = 36;
const MIN_WIDTH = 1008;

type BoardView = "alle" | "heiss" | "nachfassen" | "ohne_termin";

/** Stufen-Unterauswahl der Nachfassen-Ansicht. null = alle Stufen. */
type FuFilter = 1 | 2 | 3 | null;

// Segmented arbeitet auf Strings — hier die Brücke zum numerischen Filter.
type FuSegment = "alle" | "1" | "2" | "3";

type ToastState = { message: string; undo?: () => void };

const cell: React.CSSProperties = {
  padding: "0 12px",
  fontSize: "var(--fs-sm)",
  display: "flex",
  alignItems: "center",
  minWidth: 0,
  height: "100%",
  boxSizing: "border-box",
};

const cellText: React.CSSProperties = {
  cursor: "text",
  display: "block",
  width: "100%",
  minHeight: 20,
  padding: "2px 4px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const editInput: React.CSSProperties = {
  width: "100%",
  background: "var(--accent-muted)",
  border: "1px solid var(--orange-500)",
  borderRadius: "var(--r-sm)",
  padding: "3px 7px",
  fontSize: "var(--fs-sm)",
  color: "var(--text-primary)",
  outline: "none",
  boxSizing: "border-box",
};

// Optionslisten der Neu-Zeile — konstant, damit sie nicht bei jedem Tastendruck
// neu entstehen.
const FU_OPTIONS: SelectOption[] = [
  { value: "", label: "—", color: "var(--text-muted)" },
  { value: "1", label: "FU1" },
  { value: "2", label: "FU2" },
  { value: "3", label: "FU3" },
];

const NEW_ROW_CATEGORY_OPTIONS: SelectOption[] = [
  { value: "", label: "—", color: "var(--text-muted)" },
  ...SELECTABLE_CATEGORIES.map((cat) => ({ value: cat, label: cat, color: categoryStyle(cat)?.color })),
];

// Offene Chance = Kategorie "Positiv", aber noch KEIN Termin. Der Tab ist eine
// Arbeitsliste, kein Archiv: wer schon terminiert ist, lebt im Kalender und
// würde hier nur die echten Chancen zuscrollen.
function isHotLead(c: ListContact): boolean {
  return c.answer_category === "Positiv" && c.appointment_set !== true;
}

// Fälliges Follow-up — identische Bedingung wie die Kachel "Offene Follow-ups"
// und der nachfassen_tasks-RPC, damit sich die Zahlen nie widersprechen.
function isDueFollowUp(c: ListContact, today: string): boolean {
  return (
    c.next_follow_up_at != null &&
    c.next_follow_up_at <= today &&
    c.answered !== true &&
    c.appointment_set !== true &&
    c.follow_up_number !== 3 &&
    c.blocked_at == null
  );
}

/**
 * Welche FU-Stufe als Nächstes ansteht (1–3), sonst null.
 *
 * `follow_up_number` ist die zuletzt GESENDETE Stufe — ausstehend ist also die
 * darauf folgende. Spiegelt `next_fu_number` aus dem nachfassen_tasks-RPC;
 * beide Ansichten müssen denselben Kontakt unter derselben Stufe zeigen.
 */
function nextFuNumber(c: ListContact): 1 | 2 | 3 | null {
  const next = (c.follow_up_number ?? 0) + 1;
  return next === 1 || next === 2 || next === 3 ? next : null;
}

// Geantwortet, aber noch kein Termin gebucht.
function isAnsweredWithoutAppointment(c: ListContact): boolean {
  return c.answered === true && c.appointment_set !== true;
}

/** Nächste FU-Fälligkeit nach einem "erledigt"-Klick — Spiegel der
 *  Server-Logik (calcNextFollowUp, anchor="today"). */
function nextDueAfterAdvance(newFU: number): string | null {
  if (newFU >= 3) return null;
  return addDaysISO(localDateISO(), newFU === 1 ? 5 : 7);
}

/** Fälligkeit ab Pitch-Datum — Spiegel von calcNextFollowUp(anchor="pitch"),
 *  greift beim Zurückstufen (Server rechnet dann ebenfalls pitch-verankert). */
function dueFromPitch(pitchedAt: string | null, fu: 1 | 2 | 3 | null): string | null {
  if (!pitchedAt || fu === 3) return null;
  const days = fu == null ? 3 : fu === 1 ? 5 : 7;
  return addDaysISO(pitchedAt, days);
}

// ─── Inline text cell ─────────────────────────────────────────────────────────
function InlineText({
  value, onSave, placeholder, bold,
}: {
  value: string; onSave: (v: string) => void;
  placeholder?: string; bold?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);

  if (editing) {
    return (
      <input
        autoFocus
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { setEditing(false); onSave(local); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { setEditing(false); onSave(local); }
          if (e.key === "Escape") { setEditing(false); setLocal(value); }
        }}
        style={{ ...editInput, fontWeight: bold ? 700 : 400 }}
      />
    );
  }

  return (
    <span
      className="lbv2-editable"
      onClick={() => { setLocal(value); setEditing(true); }}
      style={{ ...cellText, fontWeight: bold ? 700 : 400, color: value ? "var(--text-secondary)" : "var(--text-subtle)" }}
      title="Klicken zum Bearbeiten"
    >
      {value || (placeholder ?? "—")}
    </span>
  );
}

// ─── FU-Chip: Klick stuft hoch, Rechtsklick zurück ───────────────────────────
// FU-Stufen sind eine Eskalation, kein Status — und kein Markenorange.
// Neutral → Gold → Rot spiegelt die steigende Dringlichkeit der Kadenz.
const FU_COLORS: Record<number, string> = {
  1: "var(--text-secondary)",
  2: "var(--warning-fg)",
  3: "var(--danger-fg)",
};

const FU_BG: Record<number, string> = {
  1: "var(--surface-3)",
  2: "var(--warning-bg)",
  3: "var(--danger-bg)",
};

/**
 * Farbe des FU-Chips. **Fälligkeit schlägt Stufe.**
 *
 * Vorher färbte allein die Stufe, und die Fälligkeit trug nur einen 1px-Rand.
 * Weil die Fläche bei „noch nichts gesendet" transparent ist, sah nur dieser
 * eine Fall golden aus — ab FU1 übermalte die Stufenfarbe (grau/gold/rot) das
 * Signal. Jetzt heißt Gold ausnahmslos „du bist dran", die Stufe bleibt als
 * Text lesbar.
 */
function fuTone(value: 1 | 2 | 3 | null, due: boolean): { bg: string; fg: string; border: string } {
  if (due) return { bg: "var(--warning-bg)", fg: "var(--warning-fg)", border: "var(--warning)" };
  if (value) return { bg: FU_BG[value], fg: FU_COLORS[value], border: FU_COLORS[value] };
  return { bg: "transparent", fg: "var(--text-subtle)", border: "var(--border)" };
}

function FUChip({
  value, blocked, due, dueAt, onAdvance, onStepBack,
}: {
  value: 1 | 2 | 3 | null;
  blocked: boolean;
  /** Wiedervorlage ist erreicht → sichtbarer Punkt am Chip. */
  due: boolean;
  dueAt: string | null;
  onAdvance: () => void;
  onStepBack: () => void;
}) {
  const atMax = value === 3;
  const title = blocked
    ? "Blockiert — keine Follow-ups"
    : atMax
      ? "FU3 erreicht · Rechtsklick: Stufe zurück"
      : `${due ? `Fällig seit ${formatDateDe(dueAt, { short: true })} · ` : dueAt ? `Fällig am ${formatDateDe(dueAt, { short: true })} · ` : ""}Klick: FU${(value ?? 0) + 1} erledigt · Rechtsklick: Stufe zurück`;
  const tone = fuTone(value, due);
  return (
    <button
      type="button"
      disabled={blocked}
      onClick={() => { if (!atMax) onAdvance(); }}
      onContextMenu={(e) => { e.preventDefault(); onStepBack(); }}
      title={title}
      className={due ? "fu-due" : undefined}
      style={{
        padding: "2px 9px",
        borderRadius: "var(--r-full)",
        border: "1px solid",
        borderColor: tone.border,
        background: tone.bg,
        color: tone.fg,
        fontSize: "var(--fs-xs)",
        fontWeight: 600,
        cursor: blocked ? "default" : "pointer",
        whiteSpace: "nowrap",
        transition: "all 0.12s",
        minWidth: 40,
        justifyContent: "center",
        alignItems: "center",
        gap: 4,
        display: "inline-flex",
        opacity: blocked ? 0.5 : 1,
      }}
    >
      {value ? `FU${value}` : "—"}
      {due && (
        <span
          aria-hidden
          style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--color-warning-text)", flexShrink: 0 }}
        />
      )}
    </button>
  );
}

// ─── Toggle (Ja / —) ─────────────────────────────────────────────────────────
function InlineToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      style={{
        padding: "2px 9px",
        borderRadius: "var(--r-full)",
        border: "1px solid",
        borderColor: value ? "var(--color-success-border)" : "var(--border)",
        background: value ? "var(--color-success-bg)" : "transparent",
        color: value ? "var(--color-success-text)" : "var(--text-subtle)",
        fontSize: "var(--fs-xs)",
        fontWeight: 600,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        whiteSpace: "nowrap",
        transition: "all 0.12s",
        minWidth: 36,
        justifyContent: "center",
      }}
    >
      {value ? <><CheckCircle size={9} /> Ja</> : "—"}
    </button>
  );
}

// ─── Category Select ──────────────────────────────────────────────────────────
// Neu wählbar: nur Positiv/Neutral/Negativ. Legacy-Werte aus Bestandsdaten
// werden weiterhin angezeigt (als zusätzliche Option, solange gesetzt).
function CategorySelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const isLegacy = Boolean(value) && !SELECTABLE_CATEGORIES.includes(value as SelectableCategory);
  const options: SelectOption[] = [
    { value: "", label: "—", color: "var(--text-muted)" },
    ...SELECTABLE_CATEGORIES.map((cat) => ({ value: cat, label: cat, color: categoryStyle(cat)?.color })),
    // Bestandsdaten koennen Alt-Kategorien tragen; die bleiben waehlbar,
    // solange sie gesetzt sind, tauchen aber nicht neu in der Liste auf.
    ...(isLegacy ? [{ value: value as string, label: `${value} (Alt)`, color: categoryStyle(value)?.color }] : []),
  ];
  return (
    <Select
      value={value ?? ""}
      onChange={(v) => onChange(v || null)}
      options={options}
      variant="cell"
      title="Kategorie"
      ariaLabel="Kategorie"
      triggerStyle={{ width: 126 }}
      width={150}
    />
  );
}

// ─── Gemeinsamer Edit-State (Desktop-Zeile + Mobile-Karte) ────────────────────
// vals ist bewusst lokal (optimistisch): die Zeile zeigt sofort den neuen Wert,
// der Server-Sync läuft im Hintergrund; onEdited stößt den debounced Refresh an.
function useContactEdit(c: ListContact, listId: string, onEdited?: () => void) {
  const [vals, setVals] = useState({
    name: c.name,
    pitched_at: c.pitched_at ?? "",
    follow_up_number: c.follow_up_number as 1 | 2 | 3 | null,
    answered: c.answered === true,
    answer_category: c.answer_category ?? (null as string | null),
    answer_text: c.answer_text ?? "",
    notes: c.notes ?? "",
  });
  const [isPending, startTransition] = useTransition();

  // extra: Payload-Felder, die nicht Teil von vals sind (z. B. explizites
  // next_follow_up_at im Undo-Pfad — überstimmt die Server-Autoberechnung).
  function save(patch: Partial<typeof vals>, extra?: Partial<ContactInput>) {
    const next = { ...vals, ...patch };
    setVals(next);
    startTransition(async () => {
      await updateContact(c.id, listId, {
        name: next.name,
        pitched_at: next.pitched_at || null,
        follow_up_number: next.follow_up_number,
        answered: next.answered || null,
        answer_category: next.answer_category,
        answer_text: next.answer_text || null,
        notes: next.notes || null,
        ...extra,
      });
      onEdited?.();
    });
  }

  return { vals, save, isPending };
}

// FU-Advance/-StepBack inkl. Undo-Info — geteilt von Zeile und Karte.
// dueAt spiegelt die Server-Berechnung lokal mit: der Fällig-Punkt stimmt
// dadurch sofort nach dem Klick, ohne auf den Hintergrund-Refresh zu warten,
// und liefert gleichzeitig den exakten Undo-Wert.
function useFollowUpActions(
  c: ListContact,
  vals: { follow_up_number: 1 | 2 | 3 | null; pitched_at: string },
  save: (patch: { follow_up_number: 1 | 2 | 3 | null }, extra?: Partial<ContactInput>) => void,
  onToast: (t: ToastState) => void,
) {
  const [dueAt, setDueAt] = useState<string | null>(c.next_follow_up_at);

  const advance = () => {
    const prevFU = vals.follow_up_number ?? null;
    const next = (prevFU ?? 0) + 1;
    if (next > 3) return;
    const prevDue = dueAt;
    save({ follow_up_number: next as 1 | 2 | 3 });
    setDueAt(nextDueAfterAdvance(next));
    onToast({
      message: `${c.name}: FU${next} gesetzt`,
      undo: () => {
        setDueAt(prevDue);
        save({ follow_up_number: prevFU }, { next_follow_up_at: prevDue });
      },
    });
  };

  const stepBack = () => {
    const cur = vals.follow_up_number ?? null;
    if (cur == null) return;
    const to = cur === 1 ? null : ((cur - 1) as 1 | 2);
    // Kein explizites next_follow_up_at → Server berechnet pitch-verankert neu.
    save({ follow_up_number: to });
    setDueAt(dueFromPitch(vals.pitched_at || null, to));
  };

  return { advance, stepBack, dueAt };
}

// ─── Contact Row (memo, absolut positioniert im Virtual-Container) ───────────
const ContactRow = memo(function ContactRow({
  c, listId, start, today, onOpenAppointment, onClearAppointment, onDeleteContact, onToggleBlocked, onToast, onEdited,
}: {
  c: ListContact;
  listId: string;
  start: number;
  today: string;
  onOpenAppointment: (c: ListContact) => void;
  onClearAppointment: (c: ListContact) => void;
  onDeleteContact: (c: ListContact) => void;
  onToggleBlocked: (c: ListContact, currentlyBlocked: boolean) => Promise<boolean>;
  onToast: (t: ToastState) => void;
  onEdited: () => void;
}) {
  const { vals, save, isPending } = useContactEdit(c, listId, onEdited);
  const [blocked, setBlocked] = useState(c.blocked_at != null);
  const { advance, stepBack, dueAt } = useFollowUpActions(c, vals, save, onToast);

  const hasAppointment = c.appointment_set === true;
  const fuDue =
    !blocked && !vals.answered && !hasAppointment &&
    vals.follow_up_number !== 3 && dueAt != null && dueAt <= today;
  // Optimistische Zeile (Server-ID steht noch aus): nicht interaktiv.
  const isTemp = c.id.startsWith("temp-");

  return (
    <div
      className="lbv2-row"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: ROW_HEIGHT,
        transform: `translateY(${start}px)`,
        display: "grid",
        gridTemplateColumns: GRID_COLS,
        alignItems: "center",
        borderBottom: "1px solid var(--border)",
        boxSizing: "border-box",
        opacity: isPending || isTemp ? 0.6 : blocked ? 0.55 : 1,
        pointerEvents: isTemp ? "none" : undefined,
        transition: "opacity 0.15s",
      }}
    >
      {/* Datum */}
      <div style={cell}>
        <DatePicker
          value={vals.pitched_at || null}
          onChange={(v) => save({ pitched_at: v ?? "" })}
          placeholder="Datum"
        />
      </div>

      {/* Name (+ LinkedIn-Link, Blockiert-Marker) */}
      <div style={{ ...cell, gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <InlineText
            value={vals.name}
            bold
            onSave={(v) => v.trim() && save({ name: v.trim() })}
            placeholder="Name…"
          />
        </div>
        {blocked && (
          <span
            title="Lead hat dich blockiert"
            style={{
              fontSize: "0.5625rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--color-error-text)",
              background: "var(--color-error-bg)",
              border: "1px solid var(--color-error-border)",
              borderRadius: 99,
              padding: "1px 6px",
              flexShrink: 0,
            }}
          >
            Blockiert
          </span>
        )}
        {c.linkedin_url && (
          <a
            href={c.linkedin_url}
            target="_blank"
            rel="noopener noreferrer"
            title="LinkedIn-Profil öffnen"
            style={{ color: "var(--brand-500)", display: "inline-flex", flexShrink: 0 }}
          >
            <ExternalLink size={12} />
          </a>
        )}
      </div>

      {/* FU — Klick stuft hoch, Rechtsklick zurück, Undo via Toast */}
      <div style={cell}>
        <FUChip
          value={vals.follow_up_number}
          blocked={blocked}
          due={fuDue}
          dueAt={dueAt}
          onAdvance={advance}
          onStepBack={stepBack}
        />
      </div>

      {/* Antwort */}
      <div style={cell}>
        <InlineToggle value={vals.answered} onChange={(v) => save({ answered: v })} />
      </div>

      {/* Termin — Spezial-Flow: schreibt NICHT direkt appointment_set */}
      <div style={cell}>
        <button
          type="button"
          disabled={blocked && !hasAppointment}
          onClick={() => (hasAppointment ? onClearAppointment(c) : onOpenAppointment(c))}
          title={blocked && !hasAppointment ? "Blockiert" : hasAppointment ? "Termin entfernen" : "Termin einbuchen"}
          style={{
            padding: "2px 9px",
            borderRadius: "var(--r-full)",
            border: "1px solid",
            borderColor: hasAppointment ? "var(--color-success-border)" : "var(--border)",
            background: hasAppointment ? "var(--color-success-bg)" : "transparent",
            color: hasAppointment ? "var(--color-success-text)" : "var(--text-subtle)",
            fontSize: "var(--fs-xs)",
            fontWeight: 600,
            cursor: blocked && !hasAppointment ? "default" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            whiteSpace: "nowrap",
            transition: "all 0.12s",
            minWidth: 36,
            justifyContent: "center",
            opacity: blocked && !hasAppointment ? 0.5 : 1,
          }}
        >
          {hasAppointment ? <><Calendar size={9} /> Ja</> : "—"}
        </button>
      </div>

      {/* Kategorie */}
      <div style={cell}>
        <CategorySelect value={vals.answer_category} onChange={(v) => save({ answer_category: v })} />
      </div>

      {/* Was war die Antwort */}
      <div style={cell}>
        <InlineText value={vals.answer_text} onSave={(v) => save({ answer_text: v })} placeholder="Antwort…" />
      </div>

      {/* Notizen */}
      <div style={cell}>
        <InlineText value={vals.notes} onSave={(v) => save({ notes: v })} placeholder="Notizen…" />
      </div>

      {/* Blockiert-Toggle + Delete */}
      <div style={{ ...cell, gap: 2, justifyContent: "flex-end" }}>
        <button
          type="button"
          className="lbv2-block"
          onClick={async () => {
            const toggled = await onToggleBlocked(c, blocked);
            if (toggled) setBlocked(!blocked);
          }}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "3px 4px",
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
            ...(blocked ? { color: "var(--color-error-text)", opacity: 1 } : null),
          }}
          title={blocked ? "Blockierung aufheben" : "Lead hat mich blockiert"}
        >
          <Ban size={12} />
        </button>
        <button
          type="button"
          className="lbv2-del"
          onClick={() => onDeleteContact(c)}
          style={{ background: "none", border: "none", cursor: "pointer", padding: "3px 4px", borderRadius: 4, display: "flex", alignItems: "center" }}
          title="Löschen"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
});

// ─── New entry row ────────────────────────────────────────────────────────────
export type NewContactInput = {
  name: string;
  pitched_at: string;
  follow_up_number: 1 | 2 | 3 | null;
  answer_category: string | null;
  answer_text: string | null;
  notes: string | null;
};

function NewRow({ onCreate }: { onCreate: (input: NewContactInput) => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [date, setDate] = useState(localDateISO());
  const [name, setName] = useState("");
  const [fu, setFu] = useState<"" | "1" | "2" | "3">("");
  const [category, setCategory] = useState("");
  const [answerText, setAnswerText] = useState("");
  const [notes, setNotes] = useState("");

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate({
      name: trimmed,
      pitched_at: date,
      follow_up_number: fu === "" ? null : (Number(fu) as 1 | 2 | 3),
      answer_category: category || null,
      answer_text: answerText.trim() || null,
      notes: notes.trim() || null,
    });
    // Datum bleibt stehen (Rapid-Add am selben Tag), Rest wird geleert.
    setName("");
    setFu("");
    setCategory("");
    setAnswerText("");
    setNotes("");
  }

  const submitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
  };

  return (
    <form
      ref={formRef}
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      style={{
        display: "grid",
        gridTemplateColumns: GRID_COLS,
        alignItems: "center",
        minHeight: ROW_HEIGHT + 4,
        background: "var(--brand-50)",
        borderBottom: "1px solid var(--border-bright)",
        boxSizing: "border-box",
      }}
    >
      <div style={cell}>
        <DatePicker value={date} onChange={(v) => setDate(v ?? localDateISO())} />
      </div>
      <div style={cell}>
        <input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="+ Neuen Pitch-Kontakt hinzufügen…"
          required
          style={{ ...editInput, fontWeight: 600, color: "var(--brand-500)" }}
          tabIndex={2}
          onKeyDown={submitOnEnter}
        />
      </div>
      <div style={cell}>
        <Select
          value={fu}
          onChange={(v) => setFu(v as typeof fu)}
          options={FU_OPTIONS}
          variant="cell"
          ariaLabel="Follow-up-Stufe"
          triggerStyle={{ ...editInput, fontSize: "0.75rem", padding: "3px 4px" }}
          width={96}
        />
      </div>
      <div style={{ ...cell, gridColumn: "span 2" }}>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          Antwort/Termin nach Anlegen
        </span>
      </div>
      <div style={cell}>
        <Select
          value={category}
          onChange={setCategory}
          options={NEW_ROW_CATEGORY_OPTIONS}
          variant="cell"
          ariaLabel="Kategorie"
          triggerStyle={{ ...editInput, fontSize: "0.75rem" }}
          width={150}
        />
      </div>
      <div style={cell}>
        <input value={answerText} onChange={(e) => setAnswerText(e.target.value)} placeholder="Antwort…" style={editInput} tabIndex={5} onKeyDown={submitOnEnter} />
      </div>
      <div style={cell}>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notizen…" style={editInput} tabIndex={6} onKeyDown={submitOnEnter} />
      </div>
      <div style={cell}>
        <button
          type="submit"
          tabIndex={7}
          title="Hinzufügen"
          style={{
            background: "var(--grad-cta)",
            color: "var(--text-on-accent)",
            boxShadow: "var(--shadow-btn-primary)",
            border: "none",
            borderRadius: "var(--r-full)",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "0.75rem",
            padding: "3px 8px",
            display: "flex",
            alignItems: "center",
          }}
        >
          ✓
        </button>
      </div>
    </form>
  );
}

// ─── Stats footer ─────────────────────────────────────────────────────────────
function StatsRow({ contacts }: { contacts: ListContact[] }) {
  const total = contacts.length;
  const answered = contacts.filter((c) => c.answered === true).length;
  const appt = contacts.filter((c) => c.appointment_set === true).length;
  const fu1 = contacts.filter((c) => c.follow_up_number === 1).length;
  const fu2 = contacts.filter((c) => c.follow_up_number === 2).length;
  const fu3 = contacts.filter((c) => c.follow_up_number === 3).length;
  const pct = (n: number) => (total === 0 ? "0%" : `${Math.round((n / total) * 1000) / 10}%`);

  const catCounts: Record<string, number> = {};
  for (const c of contacts) if (c.answer_category) catCounts[c.answer_category] = (catCounts[c.answer_category] ?? 0) + 1;
  const topCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];

  const stat: React.CSSProperties = {
    ...cell,
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
    overflow: "hidden",
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: GRID_COLS,
        alignItems: "center",
        minHeight: 34,
        borderTop: "2px solid var(--border-bright)",
        background: "var(--surface-50)",
        boxSizing: "border-box",
      }}
    >
      <div style={stat} />
      <div style={{ ...stat, color: "var(--text-muted)" }}>Gesamt: {total}</div>
      <div style={stat}>
        <span style={{ color: fu1 ? "var(--brand-500)" : "var(--text-subtle)" }}>{fu1}</span>
        <span style={{ margin: "0 2px" }}>/</span>
        <span style={{ color: fu2 ? "var(--color-warning-text)" : "var(--text-subtle)" }}>{fu2}</span>
        <span style={{ margin: "0 2px" }}>/</span>
        <span style={{ color: fu3 ? "var(--color-error-text)" : "var(--text-subtle)" }}>{fu3}</span>
      </div>
      <div style={{ ...stat, color: answered > 0 ? "var(--color-success-text)" : "var(--text-subtle)" }}>{pct(answered)}</div>
      <div style={{ ...stat, color: appt > 0 ? "var(--brand-500)" : "var(--text-subtle)" }}>{pct(appt)}</div>
      <div style={{ ...stat, color: topCat ? (CATEGORY_CONFIG[topCat[0] as AnswerCategory]?.color ?? "var(--text-subtle)") : "var(--text-subtle)" }}>
        {topCat ? `${topCat[0]} (${topCat[1]}×)` : "—"}
      </div>
      <div style={{ ...stat, gridColumn: "span 3" }}>
        {answered}/{total} Antworten · {appt}/{total} Termine
      </div>
    </div>
  );
}

// ─── Mobile (<768px): gestapelte Karten statt Grid-Zeilen ─────────────────────
const cardLabel: React.CSSProperties = {
  fontSize: "0.625rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-muted)",
  width: 68,
  flexShrink: 0,
};

// 1rem (16px) verhindert iOS-Auto-Zoom beim Fokussieren.
const mobileControl: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 40,
  background: "var(--surface-50)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "0.375rem 0.625rem",
  fontSize: "1rem",
  color: "var(--text-primary)",
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

function mobileChip(on: boolean): React.CSSProperties {
  return {
    flex: 1,
    minHeight: 40,
    padding: "0.375rem 0.75rem",
    borderRadius: "var(--radius-sm)",
    border: "1px solid",
    borderColor: on ? "var(--color-success-border)" : "var(--border)",
    background: on ? "var(--color-success-bg)" : "var(--surface-50)",
    color: on ? "var(--color-success-text)" : "var(--text-subtle)",
    fontSize: "var(--fs-sm)",
    fontWeight: 600,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    whiteSpace: "nowrap",
    transition: "all 0.12s",
  };
}

// Tap-to-edit Einzeiler (Name) — großes Touch-Target.
function CardEditText({
  value, onSave, placeholder, bold,
}: {
  value: string; onSave: (v: string) => void; placeholder?: string; bold?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);

  if (editing) {
    return (
      <input
        autoFocus
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { setEditing(false); onSave(local); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { setEditing(false); onSave(local); }
          if (e.key === "Escape") { setEditing(false); setLocal(value); }
        }}
        style={{ ...editInput, minHeight: 40, fontSize: "1rem", fontWeight: bold ? 700 : 400 }}
      />
    );
  }

  return (
    <span
      className="lbv2-editable"
      onClick={() => { setLocal(value); setEditing(true); }}
      style={{
        display: "flex",
        alignItems: "center",
        minHeight: 40,
        padding: "0.25rem 0.375rem",
        fontSize: "0.9375rem",
        fontWeight: bold ? 700 : 400,
        color: value ? "var(--text-primary)" : "var(--text-subtle)",
        cursor: "text",
        wordBreak: "break-word",
      }}
      title="Tippen zum Bearbeiten"
    >
      {value || (placeholder ?? "—")}
    </span>
  );
}

// Tap-to-edit Mehrzeiler (Antwort-Text / Notizen) als Textarea.
function CardEditArea({
  label, value, onSave, placeholder,
}: {
  label: string; value: string; onSave: (v: string) => void; placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <span style={{ ...cardLabel, width: "auto" }}>{label}</span>
      {editing ? (
        <textarea
          autoFocus
          value={local}
          rows={3}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => { setEditing(false); onSave(local); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setEditing(false); setLocal(value); }
          }}
          style={{ ...editInput, minHeight: 72, fontSize: "1rem", resize: "vertical", fontFamily: "inherit", lineHeight: 1.4 }}
        />
      ) : (
        <div
          className="lbv2-editable"
          onClick={() => { setLocal(value); setEditing(true); }}
          style={{
            minHeight: 40,
            padding: "0.5rem 0.375rem",
            fontSize: "var(--fs-sm)",
            color: value ? "var(--text-secondary)" : "var(--text-subtle)",
            cursor: "text",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            boxSizing: "border-box",
          }}
          title="Tippen zum Bearbeiten"
        >
          {value || (placeholder ?? "—")}
        </div>
      )}
    </div>
  );
}

// Volle Kontakt-Karte (dynamisch gemessen via virtualizer.measureElement).
const MobileContactCard = memo(function MobileContactCard({
  c, listId, start, index, today, measureRef, onOpenAppointment, onClearAppointment, onDeleteContact, onToggleBlocked, onToast, onEdited,
}: {
  c: ListContact;
  listId: string;
  start: number;
  index: number;
  today: string;
  measureRef: (node: Element | null) => void;
  onOpenAppointment: (c: ListContact) => void;
  onClearAppointment: (c: ListContact) => void;
  onDeleteContact: (c: ListContact) => void;
  onToggleBlocked: (c: ListContact, currentlyBlocked: boolean) => Promise<boolean>;
  onToast: (t: ToastState) => void;
  onEdited: () => void;
}) {
  const { vals, save, isPending } = useContactEdit(c, listId, onEdited);
  const [blocked, setBlocked] = useState(c.blocked_at != null);
  const { advance, stepBack, dueAt } = useFollowUpActions(c, vals, save, onToast);
  const hasAppointment = c.appointment_set === true;
  const isTemp = c.id.startsWith("temp-");
  const fuDue =
    !blocked && !vals.answered && !hasAppointment &&
    vals.follow_up_number !== 3 && dueAt != null && dueAt <= today;

  return (
    <div
      ref={measureRef}
      data-index={index}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        transform: `translateY(${start}px)`,
        paddingBottom: "0.625rem",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          background: "var(--surface-100)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-sm)",
          padding: "0.875rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          opacity: isPending || isTemp ? 0.6 : blocked ? 0.6 : 1,
          pointerEvents: isTemp ? "none" : undefined,
          transition: "opacity 0.15s",
        }}
      >
        {/* Kopf: Name + Blockiert + LinkedIn + Aktionen (oben rechts) */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.25rem" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <CardEditText
              value={vals.name}
              bold
              onSave={(v) => v.trim() && save({ name: v.trim() })}
              placeholder="Name…"
            />
          </div>
          {blocked && (
            <span
              style={{
                alignSelf: "center",
                fontSize: "0.625rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--color-error-text)",
                background: "var(--color-error-bg)",
                border: "1px solid var(--color-error-border)",
                borderRadius: 99,
                padding: "2px 8px",
                flexShrink: 0,
              }}
            >
              Blockiert
            </span>
          )}
          {c.linkedin_url && (
            <a
              href={c.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              title="LinkedIn-Profil öffnen"
              style={{ color: "var(--brand-500)", display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 40, minHeight: 40, flexShrink: 0 }}
            >
              <ExternalLink size={16} />
            </a>
          )}
          <button
            type="button"
            className="lbv2-block"
            onClick={async () => {
              const toggled = await onToggleBlocked(c, blocked);
              if (toggled) setBlocked(!blocked);
            }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              minWidth: 40,
              minHeight: 40,
              borderRadius: "var(--r-full)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              ...(blocked ? { color: "var(--color-error-text)", opacity: 1 } : null),
            }}
            title={blocked ? "Blockierung aufheben" : "Lead hat mich blockiert"}
          >
            <Ban size={16} />
          </button>
          <button
            type="button"
            className="lbv2-del"
            onClick={() => onDeleteContact(c)}
            style={{ background: "none", border: "none", cursor: "pointer", minWidth: 40, minHeight: 40, borderRadius: "var(--r-full)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
            title="Löschen"
          >
            <Trash2 size={16} />
          </button>
        </div>

        {/* Datum */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={cardLabel}>Datum</span>
          <DatePicker
            value={vals.pitched_at || null}
            onChange={(v) => save({ pitched_at: v ?? "" })}
            variant="input"
            placeholder="Datum wählen"
          />
        </div>

        {/* FU — Chip stuft hoch (Klick), lange Liste im Griff via Undo-Toast */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={cardLabel}>FU</span>
          <button
            type="button"
            disabled={blocked}
            onClick={() => { if (vals.follow_up_number !== 3) advance(); }}
            onContextMenu={(e) => { e.preventDefault(); stepBack(); }}
            className={fuDue ? "fu-due" : undefined}
            style={{
              ...mobileControl,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: blocked ? "default" : "pointer",
              // Gleiche Regel wie am Desktop-Chip: faellig schlaegt Stufe.
              color: fuDue ? "var(--warning-fg)" : vals.follow_up_number ? FU_COLORS[vals.follow_up_number] : "var(--text-subtle)",
              fontWeight: fuDue || vals.follow_up_number ? 800 : 400,
              background: fuDue ? "var(--warning-bg)" : vals.follow_up_number ? FU_BG[vals.follow_up_number] : "var(--surface-50)",
              borderColor: fuDue ? "var(--warning)" : undefined,
              opacity: blocked ? 0.5 : 1,
            }}
            title={blocked ? "Blockiert — keine Follow-ups" : "Tippen: nächstes Follow-up erledigt"}
          >
            {vals.follow_up_number ? `FU${vals.follow_up_number}` : "FU starten"}
            {fuDue && (
              <span style={{ marginLeft: 6, fontSize: "0.75rem", fontWeight: 600, color: "var(--warning-fg)" }}>
                · fällig
              </span>
            )}
          </button>
        </div>

        {/* Kategorie */}
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={cardLabel}>Kategorie</span>
          <select
            value={vals.answer_category ?? ""}
            onChange={(e) => save({ answer_category: e.target.value || null })}
            style={{
              ...mobileControl,
              color: vals.answer_category
                ? (categoryStyle(vals.answer_category)?.color ?? "var(--text-primary)")
                : "var(--text-subtle)",
              fontWeight: vals.answer_category ? 700 : 400,
            }}
            title="Kategorie"
          >
            <option value="">—</option>
            {SELECTABLE_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            {vals.answer_category && !SELECTABLE_CATEGORIES.includes(vals.answer_category as SelectableCategory) && (
              <option value={vals.answer_category}>{vals.answer_category} (Alt)</option>
            )}
          </select>
        </label>

        {/* Antwort-Toggle + Termin (gleicher Modal-/Clear-Flow wie Desktop) */}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            onClick={() => save({ answered: !vals.answered })}
            style={mobileChip(vals.answered)}
          >
            {vals.answered ? <><CheckCircle size={13} /> Antwort: Ja</> : "Antwort: —"}
          </button>
          <button
            type="button"
            disabled={blocked && !hasAppointment}
            onClick={() => (hasAppointment ? onClearAppointment(c) : onOpenAppointment(c))}
            title={blocked && !hasAppointment ? "Blockiert" : hasAppointment ? "Termin entfernen" : "Termin einbuchen"}
            style={{ ...mobileChip(hasAppointment), opacity: blocked && !hasAppointment ? 0.5 : 1 }}
          >
            {hasAppointment ? <><Calendar size={13} /> Termin: Ja</> : "Termin: —"}
          </button>
        </div>

        {/* Antwort-Text + Notizen */}
        <CardEditArea label="Antwort" value={vals.answer_text} onSave={(v) => save({ answer_text: v })} placeholder="Antwort…" />
        <CardEditArea label="Notizen" value={vals.notes} onSave={(v) => save({ notes: v })} placeholder="Notizen…" />
      </div>
    </div>
  );
});

// Kompaktes Anlege-Formular als Karte (Name + Datum + Submit).
function MobileNewCard({ onCreate }: { onCreate: (input: NewContactInput) => void }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(localDateISO());

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate({
      name: trimmed,
      pitched_at: date,
      follow_up_number: null,
      answer_category: null,
      answer_text: null,
      notes: null,
    });
    setName("");
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      style={{
        background: "var(--brand-50)",
        border: "1px solid var(--border-bright)",
        borderRadius: "var(--radius-lg)",
        padding: "0.875rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        boxSizing: "border-box",
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        placeholder="+ Neuen Pitch-Kontakt hinzufügen…"
        style={{ ...editInput, minHeight: 44, fontSize: "1rem", fontWeight: 600, color: "var(--brand-500)" }}
      />
      <DatePicker value={date} onChange={(v) => setDate(v ?? localDateISO())} variant="input" />
      <button
        type="submit"
        style={{
          width: "100%",
          minHeight: 44,
          background: "var(--grad-cta)",
          color: "var(--text-on-accent)",
          boxShadow: "var(--shadow-btn-primary)",
          border: "none",
          borderRadius: "var(--r-full)",
          fontWeight: 600,
          fontSize: "0.875rem",
          cursor: "pointer",
        }}
      >
        Hinzufügen
      </button>
    </form>
  );
}

// Kleine Zusammenfassungs-Karte (gleiche Werte wie Desktop-Footer).
function MobileStatsCard({ contacts }: { contacts: ListContact[] }) {
  const total = contacts.length;
  const answered = contacts.filter((c) => c.answered === true).length;
  const appt = contacts.filter((c) => c.appointment_set === true).length;
  const fu1 = contacts.filter((c) => c.follow_up_number === 1).length;
  const fu2 = contacts.filter((c) => c.follow_up_number === 2).length;
  const fu3 = contacts.filter((c) => c.follow_up_number === 3).length;
  const days = new Set(contacts.map((c) => c.pitched_at).filter(Boolean)).size;
  const perDay = days > 0 ? Math.round((total / days) * 10) / 10 : 0;
  const pct = (n: number) => (total === 0 ? "0%" : `${Math.round((n / total) * 1000) / 10}%`);

  const rows: [string, string][] = [
    ["Σ Gesamt", String(total)],
    ["ø / Tag", days > 0 ? perDay.toLocaleString("de-DE") : "—"],
    ["FU1 / FU2 / FU3", `${fu1} / ${fu2} / ${fu3}`],
    ["Antworten", `${answered} (${pct(answered)})`],
    ["Termine", `${appt} (${pct(appt)})`],
  ];

  return (
    <div
      style={{
        background: "var(--surface-50)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: "0.875rem 1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.375rem",
      }}
    >
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "0.8125rem" }}>
          <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>{label}</span>
          <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
type OptimisticAction =
  | { type: "add"; contact: ListContact }
  | { type: "remove"; id: string };

export function ListBoardV2({ listId, contacts }: {
  /**
   * Die Liste, in die neue Kontakte gehen. `null` in Smart Views: dort stammen
   * die Kontakte aus mehreren Listen, es gaebe also kein eindeutiges Ziel —
   * die Neu-Zeile entfaellt. Bearbeiten, Termin und Loeschen laufen dagegen
   * ueber `contact.list_id` und funktionieren dort unveraendert.
   */
  listId: string | null; contacts: ListContact[];
}) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<BoardView>("alle");
  // Unterauswahl der Nachfassen-Ansicht: null = alle Stufen.
  const [fuFilter, setFuFilter] = useState<FuFilter>(null);
  const [apptContact, setApptContact] = useState<ListContact | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const { confirm, dialog } = useConfirm();

  // Optimistisches UI: neue/gelöschte Einträge erscheinen bzw. verschwinden
  // sofort; router.refresh() im selben Transition-Scope holt die Server-Wahrheit.
  const [optContacts, applyOptimistic] = useOptimistic(
    contacts,
    (cur: ListContact[], action: OptimisticAction) =>
      action.type === "add" ? [action.contact, ...cur] : cur.filter((c) => c.id !== action.id),
  );

  // Inline-Edits ändern nur die Zeile (lokaler State) — Stats/Charts holen sich
  // die Server-Wahrheit kurz danach im Hintergrund (debounced, nicht blockierend).
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 2500);
  }, [router]);
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);

  // Undo-Toast (FU-Fehlklick-Schutz) — 6 s sichtbar.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  const showToast = useCallback((t: ToastState) => setToast(t), []);

  const today = localDateISO();

  // Ein Durchlauf für alle Zähler — counts läuft bei jeder Sucheingabe neu,
  // und die Liste kann mehrere tausend Zeilen haben.
  const counts = useMemo(() => {
    let heiss = 0;
    let nachfassen = 0;
    let ohne_termin = 0;
    const fu: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
    for (const c of optContacts) {
      if (isHotLead(c)) heiss++;
      if (isAnsweredWithoutAppointment(c)) ohne_termin++;
      if (isDueFollowUp(c, today)) {
        nachfassen++;
        const n = nextFuNumber(c);
        if (n != null) fu[n]++;
      }
    }
    // Invariante: fu[1] + fu[2] + fu[3] === nachfassen.
    return { alle: optContacts.length, heiss, nachfassen, ohne_termin, fu };
  }, [optContacts, today]);

  const filtered = useMemo(() => {
    let base = optContacts;
    if (view === "heiss") base = base.filter(isHotLead);
    else if (view === "nachfassen") {
      // Arbeits-Queue: am längsten überfällig zuerst.
      base = base
        .filter((c) => isDueFollowUp(c, today) && (fuFilter == null || nextFuNumber(c) === fuFilter))
        .slice()
        .sort((a, b) => (a.next_follow_up_at ?? "").localeCompare(b.next_follow_up_at ?? ""));
    } else if (view === "ohne_termin") base = base.filter(isAnsweredWithoutAppointment);
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((c) =>
      [c.name, c.notes, c.answer_text, c.answer_category]
        .filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [optContacts, search, view, fuFilter, today]);

  const parentRef = useRef<HTMLDivElement>(null);
  // Mobile: dynamische Karten-Höhen (measureElement), Desktop: fixe Zeilenhöhe.
  const virtualizer = useVirtualizer(
    isMobile
      ? {
          count: filtered.length,
          getScrollElement: () => parentRef.current,
          estimateSize: () => 180,
          overscan: 6,
        }
      : {
          count: filtered.length,
          getScrollElement: () => parentRef.current,
          estimateSize: () => ROW_HEIGHT,
          overscan: 12,
        }
  );

  // Beim Moduswechsel (Breakpoint überschritten) gecachte Messungen verwerfen,
  // sonst positioniert der Virtualizer mit Höhen aus dem anderen Layout.
  useEffect(() => {
    virtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  const createOptimistic = useCallback((input: NewContactInput) => {
    if (!listId) return; // ohne Zielliste gibt es keine Neu-Zeile
    const temp: ListContact = {
      id: `temp-${crypto.randomUUID()}`,
      list_id: listId,
      name: input.name,
      notes: input.notes,
      pitched_at: input.pitched_at,
      follow_up_number: input.follow_up_number,
      answered: null,
      answer_category: input.answer_category,
      answer_text: input.answer_text,
      appointment_set: null,
      appointment_at: null,
      meet_link: null,
      linkedin_url: null,
      next_follow_up_at: null,
      blocked_at: null,
      created_at: new Date().toISOString(),
    };
    setActionError(null);
    startTransition(async () => {
      applyOptimistic({ type: "add", contact: temp });
      const res = await createContact({
        list_id: listId,
        name: input.name,
        pitched_at: input.pitched_at,
        follow_up_number: input.follow_up_number,
        answer_category: input.answer_category,
        answer_text: input.answer_text,
        notes: input.notes,
      });
      if (res?.error) {
        setActionError(res.error);
        return;
      }
      router.refresh();
    });
  }, [applyOptimistic, listId, router]);

  const openAppointment = useCallback((c: ListContact) => setApptContact(c), []);
  const clearAppointment = useCallback(async (c: ListContact) => {
    const ok = await confirm({
      title: "Termin entfernen?",
      message: `Der eingebuchte Termin für "${c.name}" wird entfernt.`,
      confirmLabel: "Entfernen",
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      await clearContactAppointment({ contactId: c.id, listId: c.list_id });
      router.refresh();
    });
  }, [confirm, router]);

  const deleteContact = useCallback(async (c: ListContact) => {
    const ok = await confirm({
      title: "Kontakt löschen?",
      message: `"${c.name}" löschen?`,
      confirmLabel: "Löschen",
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      applyOptimistic({ type: "remove", id: c.id });
      const res = await deleteContactAction(c.id, c.list_id);
      if (res?.error) {
        setActionError(res.error);
        return;
      }
      router.refresh();
    });
  }, [applyOptimistic, confirm, router]);

  const toggleBlocked = useCallback(async (c: ListContact, currentlyBlocked: boolean) => {
    const ok = await confirm({
      title: currentlyBlocked ? "Blockierung aufheben?" : "Als blockiert markieren?",
      message: currentlyBlocked
        ? `"${c.name}" wieder in den Follow-up-Flow aufnehmen? Die Fälligkeit wird neu berechnet.`
        : `"${c.name}" hat dich auf LinkedIn blockiert? Der Kontakt fliegt damit aus dem Follow-up-Tracking und den Erinnerungen.`,
      confirmLabel: currentlyBlocked ? "Aufheben" : "Als blockiert markieren",
      destructive: !currentlyBlocked,
    });
    if (!ok) return false;
    const res = await setContactBlocked(c.id, c.list_id, !currentlyBlocked);
    if (res?.error) {
      setActionError(res.error);
      return false;
    }
    scheduleRefresh();
    return true;
  }, [confirm, scheduleRefresh]);

  const headerCell: React.CSSProperties = {
    ...cell,
    fontSize: "var(--fs-xs)",
    fontWeight: 500,
    letterSpacing: "var(--ls-eyebrow)",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
    overflow: "hidden",
  };

  const showNewEntry = !search && view === "alle";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 200px", maxWidth: isMobile ? "100%" : 240 }}>
          <Search size={14} style={{ position: "absolute", left: "var(--sp-5)", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none", zIndex: 1 }} />
          <input
            type="search"
            placeholder="Suchen…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ui-input"
            style={{ paddingLeft: "var(--sp-10)" }}
          />
        </div>
        {/* 4 Tabs passen auf schmalen Screens nicht nebeneinander → horizontal scrollbar */}
        <div style={{ overflowX: "auto", maxWidth: "100%", flexShrink: 1 }}>
          <Segmented<BoardView>
            options={[
              { value: "alle", label: `Alle ${counts.alle}` },
              { value: "heiss", label: `Positiv ${counts.heiss}` },
              { value: "nachfassen", label: `Nachfassen ${counts.nachfassen}` },
              { value: "ohne_termin", label: `Ohne Termin ${counts.ohne_termin}` },
            ]}
            value={view}
            onChange={(v) => {
              setView(v);
              // Stufenfilter zuruecksetzen, sobald Nachfassen verlassen wird —
              // sonst kommt man spaeter mit unsichtbar aktivem Filter zurueck.
              if (v !== "nachfassen") setFuFilter(null);
            }}
            ariaLabel="Ansicht"
          />
        </div>
        {search && (
          <span className="tnum" style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
            {filtered.length}/{counts.alle}
          </span>
        )}
        <div className="hide-on-mobile" style={{ marginLeft: "auto", fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
          Klicken zum Bearbeiten · Enter zum Speichern
        </div>
      </div>

      {/* Stufen-Unterauswahl — nur in der Nachfassen-Ansicht. Alle drei Stufen
          bleiben sichtbar, auch bei 0, damit die Leiste beim Abarbeiten nicht
          springt. */}
      {view === "nachfassen" && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap" }}>
          <span className="eyebrow eyebrow-muted">Stufe</span>
          <div style={{ overflowX: "auto", maxWidth: "100%" }}>
            <Segmented<FuSegment>
              options={[
                { value: "alle", label: `Alle FU ${counts.nachfassen}` },
                { value: "1", label: `FU 1 · ${counts.fu[1]}` },
                { value: "2", label: `FU 2 · ${counts.fu[2]}` },
                { value: "3", label: `FU 3 · ${counts.fu[3]}` },
              ]}
              value={fuFilter == null ? "alle" : (String(fuFilter) as FuSegment)}
              onChange={(v) => setFuFilter(v === "alle" ? null : (Number(v) as 1 | 2 | 3))}
              ariaLabel="Follow-up-Stufe"
            />
          </div>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          style={{
            fontSize: "var(--fs-base)",
            color: "var(--danger-fg)",
            background: "var(--danger-bg)",
            borderLeft: "2px solid var(--danger)",
            borderRadius: "var(--r-sm)",
            padding: "var(--sp-4) var(--sp-6)",
          }}
        >
          {actionError}
        </div>
      )}

      {/* Board */}
      {isMobile ? (
        /* Mobile: gestapelte, virtualisierte Karten */
        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
          {showNewEntry && listId && <MobileNewCard onCreate={createOptimistic} />}

          <div ref={parentRef} style={{ maxHeight: "62vh", overflowY: "auto", WebkitOverflowScrolling: "touch" as never }}>
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const c = filtered[vi.index];
                return (
                  <MobileContactCard
                    key={c.id}
                    c={c}
                    listId={c.list_id}
                    start={vi.start}
                    index={vi.index}
                    today={today}
                    measureRef={virtualizer.measureElement}
                    onOpenAppointment={openAppointment}
                    onClearAppointment={clearAppointment}
                    onDeleteContact={deleteContact}
                    onToggleBlocked={toggleBlocked}
                    onToast={showToast}
                    onEdited={scheduleRefresh}
                  />
                );
              })}
            </div>
          </div>

          {contacts.length > 0 && <MobileStatsCard contacts={filtered} />}
        </div>
      ) : (
        <div style={{ border: "1px solid var(--border-default)", borderRadius: "var(--r-lg)", background: "var(--surface-2)", overflow: "clip" }}>
          <div ref={parentRef} style={{ maxHeight: "62vh", overflowY: "auto", overflowX: "auto", WebkitOverflowScrolling: "touch" as never }}>
            <div style={{ minWidth: MIN_WIDTH }}>
              {/* Sticky header */}
              <div
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 3,
                  display: "grid",
                  gridTemplateColumns: GRID_COLS,
                  alignItems: "center",
                  height: "var(--h-row)",
                  borderBottom: "1px solid var(--border-default)",
                  boxSizing: "border-box",
                }}
                className="glass-nav"
              >
                {["Datum", "Name", "FU", "Antwort", "Termin", "Kategorie", "Was war die Antwort?", "Notizen", ""].map((h, i) => (
                  <div key={i} style={headerCell}>{h}</div>
                ))}
              </div>

              {/* Quick-add row */}
              {showNewEntry && listId && <NewRow onCreate={createOptimistic} />}

              {/* Virtualized rows */}
              <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                {virtualizer.getVirtualItems().map((vi) => {
                  const c = filtered[vi.index];
                  return (
                    <ContactRow
                      key={c.id}
                      c={c}
                      listId={c.list_id}
                      start={vi.start}
                      today={today}
                      onOpenAppointment={openAppointment}
                      onClearAppointment={clearAppointment}
                      onDeleteContact={deleteContact}
                      onToggleBlocked={toggleBlocked}
                      onToast={showToast}
                      onEdited={scheduleRefresh}
                    />
                  );
                })}
              </div>

              {/* Stats */}
              {contacts.length > 0 && <StatsRow contacts={filtered} />}
            </div>
          </div>
        </div>
      )}

      {filtered.length === 0 && (view !== "alle" || search) && (
        <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "var(--fs-sm)", marginTop: "0.375rem" }}>
          {search ? "Keine Treffer." :
           view === "heiss" ? "Keine offenen positiven Leads — alle haben schon einen Termin." :
           view === "nachfassen"
             ? fuFilter != null
               ? `Kein FU ${fuFilter} fällig.`
               : "Kein Follow-up fällig — alles abgearbeitet." :
           view === "ohne_termin" ? "Alle beantworteten Kontakte haben einen Termin." : "Keine Treffer."}
        </p>
      )}

      {contacts.length === 0 && !search && view === "alle" && (
        <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "var(--fs-sm)", marginTop: "0.375rem" }}>
          Name eingeben und Enter drücken — fertig.
        </p>
      )}

      {/* Ein einziges Termin-Modal, gesteuert über den ausgewählten Kontakt */}
      <AppointmentModal
        open={apptContact !== null}
        onClose={() => setApptContact(null)}
        leadName={apptContact?.name}
        defaultMeetLink={apptContact?.meet_link ?? undefined}
        defaultAppointmentAt={apptContact?.appointment_at?.slice(0, 16) ?? undefined}
        onSubmit={async ({ meetLink, meetingKind, appointmentAt }) => {
          if (!apptContact) return { error: "Kein Kontakt ausgewählt." };
          return convertContactToSetting({ contactId: apptContact.id, listId: apptContact.list_id, meetLink, meetingKind, appointmentAt });
        }}
        onSaved={() => router.refresh()}
      />

      {/* Undo-Toast (FU-Fehlklick-Schutz) */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 22,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 120,
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            background: "var(--surface-100)",
            border: "1px solid var(--border-bright)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-lg)",
            padding: "0.5rem 0.875rem",
            fontSize: "var(--fs-sm)",
            color: "var(--text-primary)",
            whiteSpace: "nowrap",
            animation: "fade-up 0.15s ease both",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: "60vw" }}>{toast.message}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => { toast.undo?.(); setToast(null); }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                border: "1px solid var(--brand-200)",
                background: "var(--brand-50)",
                color: "var(--brand-500)",
                borderRadius: "var(--r-full)",
                padding: "0.25rem 0.625rem",
                fontSize: "0.75rem",
                fontWeight: 600,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <Undo2 size={12} /> Rückgängig
            </button>
          )}
        </div>
      )}

      {/* Themen-konformer Bestätigungsdialog (Löschen / Termin entfernen / Blockieren) */}
      {dialog}
    </div>
  );
}
