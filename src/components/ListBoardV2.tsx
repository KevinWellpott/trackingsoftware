"use client";

import { createContactForm, deleteContactForm, updateContact } from "@/app/actions/contacts";
import { clearContactAppointment, convertContactToSetting } from "@/app/actions/appointments";
import { AppointmentModal } from "@/components/appointment/AppointmentModal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { ContactWithStage, PipelineStage } from "@/lib/types";
import { ANSWER_CATEGORIES, CATEGORY_CONFIG, type AnswerCategory } from "@/lib/categories";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Calendar, CheckCircle, ExternalLink, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useIsMobile } from "@/lib/useIsMobile";

// ─── Layout-Konstanten ────────────────────────────────────────────────────────
// Gemeinsames Grid für Header + Zeilen, damit die Spalten exakt fluchten.
const GRID_COLS =
  "112px minmax(150px, 1.4fr) 66px 74px 74px 150px minmax(150px, 1.4fr) minmax(120px, 1fr) 40px";
const ROW_HEIGHT = 40;
const MIN_WIDTH = 980;

const cell: React.CSSProperties = {
  padding: "0 12px",
  fontSize: "0.8125rem",
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
  background: "var(--color-info-bg)",
  border: "1px solid var(--brand-500)",
  borderRadius: 5,
  padding: "3px 7px",
  fontSize: "0.8125rem",
  color: "var(--text-primary)",
  outline: "none",
  boxSizing: "border-box",
};

const compactSelect: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "inherit",
  fontSize: "0.75rem",
  outline: "none",
  cursor: "pointer",
  appearance: "none",
  WebkitAppearance: "none",
  padding: "2px 4px",
  borderRadius: 4,
  maxWidth: 130,
};

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

// ─── Inline date cell ─────────────────────────────────────────────────────────
function InlineDate({ value, onSave }: { value: string; onSave: (v: string | null) => void }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <input
        autoFocus
        type="date"
        defaultValue={value}
        onBlur={(e) => { setEditing(false); onSave(e.target.value || null); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { setEditing(false); onSave((e.target as HTMLInputElement).value || null); }
          if (e.key === "Escape") setEditing(false);
        }}
        style={{ ...editInput, maxWidth: 104 }}
      />
    );
  }

  return (
    <span
      className="lbv2-editable"
      onClick={() => setEditing(true)}
      style={{ ...cellText, color: value ? "var(--text-muted)" : "var(--text-subtle)", fontSize: "0.75rem" }}
      title="Datum bearbeiten"
    >
      {value || "Datum"}
    </span>
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
        borderRadius: 5,
        border: "1px solid",
        borderColor: value ? "var(--color-success-border)" : "var(--border)",
        background: value ? "var(--color-success-bg)" : "transparent",
        color: value ? "var(--color-success-text)" : "var(--text-subtle)",
        fontSize: "0.6875rem",
        fontWeight: 700,
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

// ─── FU Select ────────────────────────────────────────────────────────────────
const FU_COLORS: Record<number, string> = {
  1: "var(--brand-500)",
  2: "var(--color-warning-text)",
  3: "var(--color-error-text)",
};

function FUSelect({ value, onChange }: { value: 1 | 2 | 3 | null; onChange: (v: 1 | 2 | 3 | null) => void }) {
  const color = value ? FU_COLORS[value] : "var(--text-subtle)";
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      {value ? (
        <span style={{ position: "absolute", left: 4, pointerEvents: "none", fontSize: "0.6875rem", fontWeight: 800, color, zIndex: 1 }}>
          FU{value}
        </span>
      ) : (
        <span style={{ position: "absolute", left: 4, pointerEvents: "none", color: "var(--text-subtle)", fontSize: "0.6875rem" }}>—</span>
      )}
      <select
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "1" ? 1 : v === "2" ? 2 : v === "3" ? 3 : null);
        }}
        style={{ ...compactSelect, opacity: 0.01, position: "absolute", inset: 0, width: "100%" }}
        title="Follow-Up Nummer"
      >
        <option value="">—</option>
        <option value="1">FU1</option>
        <option value="2">FU2</option>
        <option value="3">FU3</option>
      </select>
      <span style={{ width: 42, height: 24, display: "block" }} />
    </div>
  );
}

// ─── Category Select ──────────────────────────────────────────────────────────
function CategorySelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const cfg = value ? CATEGORY_CONFIG[value as AnswerCategory] : null;
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      {cfg ? (
        <span style={{ position: "absolute", left: 4, pointerEvents: "none", fontSize: "0.6875rem", fontWeight: 700, color: cfg.color, whiteSpace: "nowrap", zIndex: 1, maxWidth: 122, overflow: "hidden", textOverflow: "ellipsis" }}>
          {value}
        </span>
      ) : (
        <span style={{ position: "absolute", left: 4, pointerEvents: "none", color: "var(--text-subtle)", fontSize: "0.6875rem" }}>—</span>
      )}
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        style={{ ...compactSelect, opacity: 0.01, position: "absolute", inset: 0, width: "100%" }}
        title="Kategorie"
      >
        <option value="">—</option>
        {ANSWER_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
      </select>
      <span style={{ width: 126, height: 24, display: "block" }} />
    </div>
  );
}

// ─── Gemeinsamer Edit-State (Desktop-Zeile + Mobile-Karte) ────────────────────
function useContactEdit(c: ContactWithStage, listId: string) {
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

  function save(patch: Partial<typeof vals>) {
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
      });
    });
  }

  return { vals, save, isPending };
}

// ─── Contact Row (memo, absolut positioniert im Virtual-Container) ───────────
const ContactRow = memo(function ContactRow({
  c, listId, start, onOpenAppointment, onClearAppointment, onDeleteContact,
}: {
  c: ContactWithStage;
  listId: string;
  start: number;
  onOpenAppointment: (c: ContactWithStage) => void;
  onClearAppointment: (c: ContactWithStage) => void;
  onDeleteContact: (c: ContactWithStage) => void;
}) {
  const { vals, save, isPending } = useContactEdit(c, listId);

  const hasAppointment = c.appointment_set === true;

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
        opacity: isPending ? 0.6 : 1,
        transition: "opacity 0.15s",
      }}
    >
      {/* Datum */}
      <div style={cell}>
        <InlineDate value={vals.pitched_at} onSave={(v) => save({ pitched_at: v ?? "" })} />
      </div>

      {/* Name (+ LinkedIn-Link) */}
      <div style={{ ...cell, gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <InlineText
            value={vals.name}
            bold
            onSave={(v) => v.trim() && save({ name: v.trim() })}
            placeholder="Name…"
          />
        </div>
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

      {/* FU */}
      <div style={cell}>
        <FUSelect value={vals.follow_up_number} onChange={(v) => save({ follow_up_number: v })} />
      </div>

      {/* Antwort */}
      <div style={cell}>
        <InlineToggle value={vals.answered} onChange={(v) => save({ answered: v })} />
      </div>

      {/* Termin — Spezial-Flow: schreibt NICHT direkt appointment_set */}
      <div style={cell}>
        <button
          type="button"
          onClick={() => (hasAppointment ? onClearAppointment(c) : onOpenAppointment(c))}
          title={hasAppointment ? "Termin entfernen" : "Termin einbuchen"}
          style={{
            padding: "2px 9px",
            borderRadius: 5,
            border: "1px solid",
            borderColor: hasAppointment ? "var(--color-success-border)" : "var(--border)",
            background: hasAppointment ? "var(--color-success-bg)" : "transparent",
            color: hasAppointment ? "var(--color-success-text)" : "var(--text-subtle)",
            fontSize: "0.6875rem",
            fontWeight: 700,
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

      {/* Delete */}
      <div style={cell}>
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
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function NewRow({ listId }: { listId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const today = localToday();

  const submitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); formRef.current?.requestSubmit(); }
  };

  return (
    <form
      ref={formRef}
      action={createContactForm}
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
      <input type="hidden" name="list_id" value={listId} />
      <div style={cell}>
        <input name="pitched_at" type="date" defaultValue={today} style={{ ...editInput, fontSize: "0.75rem" }} tabIndex={1} />
      </div>
      <div style={cell}>
        <input
          name="name"
          placeholder="+ Neuen Pitch-Kontakt hinzufügen…"
          required
          style={{ ...editInput, fontWeight: 600, color: "var(--brand-500)" }}
          tabIndex={2}
          onKeyDown={submitOnEnter}
        />
      </div>
      <div style={cell}>
        <select name="follow_up_number" defaultValue="" style={{ ...editInput, fontSize: "0.75rem", padding: "3px 2px" }} tabIndex={3}>
          <option value="">—</option>
          <option value="1">FU1</option>
          <option value="2">FU2</option>
          <option value="3">FU3</option>
        </select>
      </div>
      <div style={{ ...cell, gridColumn: "span 2" }}>
        <span style={{ fontSize: "0.6875rem", color: "var(--text-subtle)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          Antwort/Termin nach Anlegen
        </span>
      </div>
      <div style={cell}>
        <select name="answer_category" defaultValue="" style={{ ...editInput, fontSize: "0.75rem" }} tabIndex={4}>
          <option value="">—</option>
          {ANSWER_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
        </select>
      </div>
      <div style={cell}>
        <input name="answer_text" placeholder="Antwort…" style={editInput} tabIndex={5} onKeyDown={submitOnEnter} />
      </div>
      <div style={cell}>
        <input name="notes" placeholder="Notizen…" style={editInput} tabIndex={6} onKeyDown={submitOnEnter} />
      </div>
      <div style={cell}>
        <button
          type="submit"
          tabIndex={7}
          title="Hinzufügen"
          style={{
            background: "var(--btn-primary-bg)",
            color: "var(--btn-primary-fg)",
            border: "none",
            borderRadius: 5,
            cursor: "pointer",
            fontWeight: 700,
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
function StatsRow({ contacts }: { contacts: ContactWithStage[] }) {
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
    fontWeight: 700,
    color: "var(--text-subtle)",
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
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-subtle)",
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
    fontSize: "0.8125rem",
    fontWeight: 700,
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
            fontSize: "0.8125rem",
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
  c, listId, start, index, measureRef, onOpenAppointment, onClearAppointment, onDeleteContact,
}: {
  c: ContactWithStage;
  listId: string;
  start: number;
  index: number;
  measureRef: (node: Element | null) => void;
  onOpenAppointment: (c: ContactWithStage) => void;
  onClearAppointment: (c: ContactWithStage) => void;
  onDeleteContact: (c: ContactWithStage) => void;
}) {
  const { vals, save, isPending } = useContactEdit(c, listId);
  const hasAppointment = c.appointment_set === true;

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
          opacity: isPending ? 0.6 : 1,
          transition: "opacity 0.15s",
        }}
      >
        {/* Kopf: Name + LinkedIn + Löschen (oben rechts) */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.25rem" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <CardEditText
              value={vals.name}
              bold
              onSave={(v) => v.trim() && save({ name: v.trim() })}
              placeholder="Name…"
            />
          </div>
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
            className="lbv2-del"
            onClick={() => onDeleteContact(c)}
            style={{ background: "none", border: "none", cursor: "pointer", minWidth: 40, minHeight: 40, borderRadius: "var(--radius-sm)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
            title="Löschen"
          >
            <Trash2 size={16} />
          </button>
        </div>

        {/* Datum */}
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={cardLabel}>Datum</span>
          <input
            type="date"
            value={vals.pitched_at}
            onChange={(e) => save({ pitched_at: e.target.value })}
            style={mobileControl}
          />
        </label>

        {/* FU */}
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={cardLabel}>FU</span>
          <select
            value={vals.follow_up_number ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              save({ follow_up_number: v === "1" ? 1 : v === "2" ? 2 : v === "3" ? 3 : null });
            }}
            style={{ ...mobileControl, color: vals.follow_up_number ? FU_COLORS[vals.follow_up_number] : "var(--text-subtle)", fontWeight: vals.follow_up_number ? 800 : 400 }}
            title="Follow-Up Nummer"
          >
            <option value="">—</option>
            <option value="1">FU1</option>
            <option value="2">FU2</option>
            <option value="3">FU3</option>
          </select>
        </label>

        {/* Kategorie */}
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={cardLabel}>Kategorie</span>
          <select
            value={vals.answer_category ?? ""}
            onChange={(e) => save({ answer_category: e.target.value || null })}
            style={{
              ...mobileControl,
              color: vals.answer_category
                ? (CATEGORY_CONFIG[vals.answer_category as AnswerCategory]?.color ?? "var(--text-primary)")
                : "var(--text-subtle)",
              fontWeight: vals.answer_category ? 700 : 400,
            }}
            title="Kategorie"
          >
            <option value="">—</option>
            {ANSWER_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
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
            onClick={() => (hasAppointment ? onClearAppointment(c) : onOpenAppointment(c))}
            title={hasAppointment ? "Termin entfernen" : "Termin einbuchen"}
            style={mobileChip(hasAppointment)}
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
function MobileNewCard({ listId }: { listId: string }) {
  return (
    <form
      action={createContactForm}
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
      <input type="hidden" name="list_id" value={listId} />
      <input
        name="name"
        required
        placeholder="+ Neuen Pitch-Kontakt hinzufügen…"
        style={{ ...editInput, minHeight: 44, fontSize: "1rem", fontWeight: 600, color: "var(--brand-500)" }}
      />
      <input
        name="pitched_at"
        type="date"
        defaultValue={localToday()}
        style={{ ...editInput, minHeight: 44, fontSize: "1rem" }}
      />
      <button
        type="submit"
        style={{
          width: "100%",
          minHeight: 44,
          background: "var(--btn-primary-bg)",
          color: "var(--btn-primary-fg)",
          border: "none",
          borderRadius: "var(--radius-md)",
          fontWeight: 700,
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
function MobileStatsCard({ contacts }: { contacts: ContactWithStage[] }) {
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
          <span style={{ color: "var(--text-subtle)", fontWeight: 600 }}>{label}</span>
          <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export function ListBoardV2({ listId, contacts }: {
  listId: string; stages: PipelineStage[]; contacts: ContactWithStage[];
}) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState("");
  const [apptContact, setApptContact] = useState<ContactWithStage | null>(null);
  const [, startTransition] = useTransition();
  const { confirm, dialog } = useConfirm();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      [c.name, c.notes, c.answer_text, c.answer_category]
        .filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [contacts, search]);

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

  const openAppointment = useCallback((c: ContactWithStage) => setApptContact(c), []);
  const clearAppointment = useCallback(async (c: ContactWithStage) => {
    const ok = await confirm({
      title: "Termin entfernen?",
      message: `Der eingebuchte Termin für "${c.name}" wird entfernt.`,
      confirmLabel: "Entfernen",
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      await clearContactAppointment({ contactId: c.id, listId });
      router.refresh();
    });
  }, [confirm, listId, router]);

  const deleteContact = useCallback(async (c: ContactWithStage) => {
    const ok = await confirm({
      title: "Kontakt löschen?",
      message: `"${c.name}" löschen?`,
      confirmLabel: "Löschen",
      destructive: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("contact_id", c.id);
    fd.set("list_id", listId);
    startTransition(async () => {
      await deleteContactForm(fd);
    });
  }, [confirm, listId]);

  const headerCell: React.CSSProperties = {
    ...cell,
    fontSize: "0.6875rem",
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-subtle)",
    whiteSpace: "nowrap",
    overflow: "hidden",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
        <div style={{ position: "relative", flex: "1 1 240px", maxWidth: isMobile ? "100%" : 280 }}>
          <Search size={13} style={{ position: "absolute", left: "0.5rem", top: "50%", transform: "translateY(-50%)", color: "var(--text-subtle)", pointerEvents: "none" }} />
          <input
            type="search"
            placeholder="Suchen…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              background: "var(--surface-100)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              padding: "0.35rem 0.75rem 0.35rem 1.875rem",
              fontSize: "0.8125rem",
              color: "var(--text-secondary)",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>
        {search && <span style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>{filtered.length}/{contacts.length}</span>}
        <div className="hide-on-mobile" style={{ marginLeft: "auto", fontSize: "0.6875rem", color: "var(--text-subtle)" }}>
          Klicken zum Bearbeiten · Enter zum Speichern
        </div>
      </div>

      {/* Board */}
      {isMobile ? (
        /* Mobile: gestapelte, virtualisierte Karten */
        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
          {!search && <MobileNewCard listId={listId} />}

          <div ref={parentRef} style={{ maxHeight: "62vh", overflowY: "auto", WebkitOverflowScrolling: "touch" as never }}>
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const c = filtered[vi.index];
                return (
                  <MobileContactCard
                    key={c.id}
                    c={c}
                    listId={listId}
                    start={vi.start}
                    index={vi.index}
                    measureRef={virtualizer.measureElement}
                    onOpenAppointment={openAppointment}
                    onClearAppointment={clearAppointment}
                    onDeleteContact={deleteContact}
                  />
                );
              })}
            </div>
          </div>

          {contacts.length > 0 && <MobileStatsCard contacts={filtered} />}
        </div>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--surface-100)", boxShadow: "var(--shadow-sm)", overflow: "clip" }}>
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
                  height: 34,
                  background: "var(--surface-50)",
                  borderBottom: "1px solid var(--border)",
                  boxSizing: "border-box",
                }}
              >
                {["Datum", "Name", "FU", "Antwort", "Termin", "Kategorie", "Was war die Antwort?", "Notizen", ""].map((h, i) => (
                  <div key={i} style={headerCell}>{h}</div>
                ))}
              </div>

              {/* Quick-add row */}
              {!search && <NewRow listId={listId} />}

              {/* Virtualized rows */}
              <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                {virtualizer.getVirtualItems().map((vi) => {
                  const c = filtered[vi.index];
                  return (
                    <ContactRow
                      key={c.id}
                      c={c}
                      listId={listId}
                      start={vi.start}
                      onOpenAppointment={openAppointment}
                      onClearAppointment={clearAppointment}
                      onDeleteContact={deleteContact}
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

      {contacts.length === 0 && !search && (
        <p style={{ textAlign: "center", color: "var(--text-subtle)", fontSize: "0.8125rem", marginTop: "0.375rem" }}>
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
        onSubmit={async (meetLink, appointmentAt) => {
          if (!apptContact) return { error: "Kein Kontakt ausgewählt." };
          return convertContactToSetting({ contactId: apptContact.id, listId, meetLink, appointmentAt });
        }}
        onSaved={() => router.refresh()}
      />

      {/* Themen-konformer Bestätigungsdialog (Löschen / Termin entfernen) */}
      {dialog}
    </div>
  );
}
