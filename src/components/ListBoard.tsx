"use client";

import { createContactForm, deleteContactForm, updateContact } from "@/app/actions/contacts";
import type { ContactWithStage, PipelineStage } from "@/lib/types";
import { ANSWER_CATEGORIES, CATEGORY_CONFIG, type AnswerCategory } from "@/lib/categories";
import { Calendar, CheckCircle, Search, Trash2 } from "lucide-react";
import { useRef, useState, useMemo, useTransition } from "react";

// ─── Shared styles ────────────────────────────────────────────────────────────
const td: React.CSSProperties = {
  padding: "0 12px",
  height: 38,
  borderBottom: "1px solid #1c1c1f",
  verticalAlign: "middle",
  fontSize: "0.8125rem",
};

const cellText: React.CSSProperties = {
  cursor: "text",
  display: "block",
  width: "100%",
  minHeight: 20,
  borderRadius: 4,
  padding: "2px 4px",
  transition: "background 0.1s",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const editInput: React.CSSProperties = {
  width: "100%",
  background: "rgba(99,102,241,0.08)",
  border: "1px solid rgba(99,102,241,0.5)",
  borderRadius: 5,
  padding: "3px 7px",
  fontSize: "0.8125rem",
  color: "#fafafa",
  outline: "none",
  boxShadow: "0 0 0 2px rgba(99,102,241,0.15)",
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
  value, onSave, placeholder, bold, maxWidth,
}: {
  value: string; onSave: (v: string) => void;
  placeholder?: string; bold?: boolean; maxWidth?: number;
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
        style={{ ...editInput, fontWeight: bold ? 700 : 400, maxWidth }}
      />
    );
  }

  return (
    <span
      onClick={() => { setLocal(value); setEditing(true); }}
      style={{ ...cellText, fontWeight: bold ? 700 : 400, color: value ? "#e4e4e7" : "#3f3f46", maxWidth }}
      title="Klicken zum Bearbeiten"
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#1c1c1f")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
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
        style={{ ...editInput, width: 120, colorScheme: "dark" }}
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      style={{ ...cellText, color: value ? "#71717a" : "#3f3f46", fontSize: "0.75rem", width: 95 }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#1c1c1f")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
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
        borderColor: value ? "#166534" : "#27272a",
        background: value ? "#052e16" : "transparent",
        color: value ? "#4ade80" : "#3f3f46",
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
function FUSelect({ value, onChange }: { value: 1 | 2 | 3 | null; onChange: (v: 1 | 2 | 3 | null) => void }) {
  const colors: Record<number, string> = { 1: "#7c3aed", 2: "#92400e", 3: "#991b1b" };
  const color = value ? colors[value] : "#3f3f46";
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      {value && (
        <span style={{ position: "absolute", left: 4, pointerEvents: "none", fontSize: "0.6875rem", fontWeight: 800, color, zIndex: 1 }}>
          FU{value}
        </span>
      )}
      {!value && <span style={{ position: "absolute", left: 4, pointerEvents: "none", color: "#3f3f46", fontSize: "0.6875rem" }}>—</span>}
      <select
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "1" ? 1 : v === "2" ? 2 : v === "3" ? 3 : null);
        }}
        style={{ ...compactSelect, paddingLeft: value ? 28 : 18, opacity: 0.01, position: "absolute", inset: 0, width: "100%" }}
        title="Follow-Up Nummer"
      >
        <option value="">—</option>
        <option value="1">FU1</option>
        <option value="2">FU2</option>
        <option value="3">FU3</option>
      </select>
      <span style={{ width: 46, height: 24, display: "block" }} />
    </div>
  );
}

// ─── Category Select ──────────────────────────────────────────────────────────
function CategorySelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const cfg = value ? CATEGORY_CONFIG[value as AnswerCategory] : null;
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      {cfg ? (
        <span style={{ position: "absolute", left: 4, pointerEvents: "none", fontSize: "0.6875rem", fontWeight: 700, color: cfg.color, whiteSpace: "nowrap", zIndex: 1 }}>
          {cfg.emoji} {value}
        </span>
      ) : (
        <span style={{ position: "absolute", left: 4, pointerEvents: "none", color: "#3f3f46", fontSize: "0.6875rem" }}>—</span>
      )}
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        style={{ ...compactSelect, paddingLeft: cfg ? Math.min(value!.length * 6 + 20, 120) : 18, opacity: 0.01, position: "absolute", inset: 0, width: "100%" }}
        title="Kategorie"
      >
        <option value="">—</option>
        {ANSWER_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
      </select>
      <span style={{ width: 130, height: 24, display: "block" }} />
    </div>
  );
}

// ─── Contact Row ──────────────────────────────────────────────────────────────
function ContactRow({ c, listId }: { c: ContactWithStage; listId: string; stages: PipelineStage[] }) {
  const [vals, setVals] = useState({
    name: c.name,
    pitched_at: c.pitched_at ?? "",
    follow_up_number: c.follow_up_number as 1 | 2 | 3 | null,
    answered: c.answered === true,
    appointment_set: c.appointment_set === true,
    answer_category: c.answer_category ?? null as string | null,
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
        appointment_set: next.appointment_set || null,
        answer_category: next.answer_category,
        answer_text: next.answer_text || null,
        notes: next.notes || null,
      });
    });
  }

  return (
    <tr
      style={{ opacity: isPending ? 0.6 : 1, transition: "opacity 0.15s" }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#101014")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "")}
    >
      {/* Datum */}
      <td style={{ ...td, width: 108 }}>
        <InlineDate value={vals.pitched_at} onSave={(v) => save({ pitched_at: v ?? "" })} />
      </td>

      {/* Name */}
      <td style={{ ...td, minWidth: 140, maxWidth: 220 }}>
        <InlineText
          value={vals.name}
          bold
          onSave={(v) => v.trim() && save({ name: v.trim() })}
          placeholder="Name…"
          maxWidth={200}
        />
      </td>

      {/* FU */}
      <td style={{ ...td, width: 60 }}>
        <FUSelect value={vals.follow_up_number} onChange={(v) => save({ follow_up_number: v })} />
      </td>

      {/* Antwort */}
      <td style={{ ...td, width: 68 }}>
        <InlineToggle value={vals.answered} onChange={(v) => save({ answered: v })} />
      </td>

      {/* Termin */}
      <td style={{ ...td, width: 68 }}>
        <InlineToggle value={vals.appointment_set} onChange={(v) => save({ appointment_set: v })} />
      </td>

      {/* Kategorie */}
      <td style={{ ...td, width: 140 }}>
        <CategorySelect value={vals.answer_category} onChange={(v) => save({ answer_category: v })} />
      </td>

      {/* Was war die Antwort */}
      <td style={{ ...td, minWidth: 160, maxWidth: 260 }}>
        <InlineText
          value={vals.answer_text}
          onSave={(v) => save({ answer_text: v })}
          placeholder="Antwort…"
          maxWidth={240}
        />
      </td>

      {/* Notizen */}
      <td style={{ ...td, minWidth: 120, maxWidth: 200 }}>
        <InlineText
          value={vals.notes}
          onSave={(v) => save({ notes: v })}
          placeholder="Notizen…"
          maxWidth={180}
        />
      </td>

      {/* Delete */}
      <td style={{ ...td, width: 36 }}>
        <form action={deleteContactForm} style={{ display: "inline" }}>
          <input type="hidden" name="contact_id" value={c.id} />
          <input type="hidden" name="list_id" value={listId} />
          <button
            type="submit"
            onClick={(e) => { if (!confirm(`"${c.name}" löschen?`)) e.preventDefault(); }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#3f3f46", padding: "3px 4px", borderRadius: 4, display: "flex", alignItems: "center", opacity: 0.6, transition: "all 0.1s" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#f87171"; (e.currentTarget as HTMLElement).style.opacity = "1"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#3f3f46"; (e.currentTarget as HTMLElement).style.opacity = "0.6"; }}
            title="Löschen"
          >
            <Trash2 size={12} />
          </button>
        </form>
      </td>
    </tr>
  );
}

// ─── New entry row ────────────────────────────────────────────────────────────
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function NewRow({ listId }: { listId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const today = localToday();
  const nameRef = useRef<HTMLInputElement>(null);

  return (
    <tr style={{ background: "#0a0a0d" }}>
      <td style={{ ...td, borderBottom: "none" }}>
        <input form="new-row-form" name="pitched_at" type="date" defaultValue={today}
          style={{ ...editInput, width: 108, colorScheme: "dark", fontSize: "0.75rem" }} tabIndex={1} />
      </td>
      <td style={{ ...td, minWidth: 140, borderBottom: "none" }}>
        <input
          ref={nameRef}
          form="new-row-form"
          name="name"
          placeholder="+ Name eingeben…"
          required
          style={{ ...editInput, fontWeight: 600, color: "#818cf8", minWidth: 160 }}
          tabIndex={2}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); formRef.current?.requestSubmit(); } }}
        />
      </td>
      <td style={{ ...td, borderBottom: "none" }}>
        <select form="new-row-form" name="follow_up_number" defaultValue="" style={{ ...editInput, width: 64, fontSize: "0.75rem" }} tabIndex={3}>
          <option value="">—</option>
          <option value="1">FU1</option>
          <option value="2">FU2</option>
          <option value="3">FU3</option>
        </select>
      </td>
      <td style={{ ...td, borderBottom: "none" }} colSpan={2}>
        <span style={{ fontSize: "0.6875rem", color: "#27272a" }}>Antwort/Termin nach Anlegen</span>
      </td>
      <td style={{ ...td, borderBottom: "none" }}>
        <select form="new-row-form" name="answer_category" defaultValue="" style={{ ...editInput, fontSize: "0.75rem", maxWidth: 130 }} tabIndex={4}>
          <option value="">—</option>
          {ANSWER_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
        </select>
      </td>
      <td style={{ ...td, borderBottom: "none" }}>
        <input form="new-row-form" name="answer_text" placeholder="Antwort…" style={{ ...editInput, minWidth: 120 }} tabIndex={5}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); formRef.current?.requestSubmit(); } }} />
      </td>
      <td style={{ ...td, borderBottom: "none" }}>
        <input form="new-row-form" name="notes" placeholder="Notizen…" style={{ ...editInput, minWidth: 100 }} tabIndex={6}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); formRef.current?.requestSubmit(); } }} />
      </td>
      <td style={{ ...td, borderBottom: "none" }}>
        <button form="new-row-form" type="submit" tabIndex={7}
          style={{ background: "#6366f1", color: "white", border: "none", borderRadius: 5, cursor: "pointer", fontWeight: 700, fontSize: "0.75rem", padding: "3px 8px", display: "flex", alignItems: "center" }}>
          ✓
        </button>
      </td>
      <td style={{ display: "none" }}>
        <form id="new-row-form" ref={formRef} action={createContactForm}>
          <input type="hidden" name="list_id" value={listId} />
        </form>
      </td>
    </tr>
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
  const pct = (n: number) => total === 0 ? "0%" : `${Math.round((n / total) * 100)}%`;

  const catCounts: Record<string, number> = {};
  for (const c of contacts) if (c.answer_category) catCounts[c.answer_category] = (catCounts[c.answer_category] ?? 0) + 1;
  const topCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];

  const stat: React.CSSProperties = { fontSize: "0.75rem", fontWeight: 700, padding: "6px 12px", borderTop: "2px solid #27272a", background: "#0d0d10", color: "#52525b" };

  return (
    <tr>
      <td style={stat} />
      <td style={{ ...stat, color: "#71717a" }}>Gesamt: {total}</td>
      <td style={stat}>
        <span style={{ color: fu1 ? "#7c3aed" : "#27272a" }}>{fu1}</span>
        <span style={{ color: "#27272a", margin: "0 2px" }}>/</span>
        <span style={{ color: fu2 ? "#92400e" : "#27272a" }}>{fu2}</span>
        <span style={{ color: "#27272a", margin: "0 2px" }}>/</span>
        <span style={{ color: fu3 ? "#991b1b" : "#27272a" }}>{fu3}</span>
      </td>
      <td style={{ ...stat, color: answered > 0 ? "#4ade80" : "#27272a" }}>{pct(answered)}</td>
      <td style={{ ...stat, color: appt > 0 ? "#a78bfa" : "#27272a" }}>{pct(appt)}</td>
      <td style={{ ...stat, color: topCat ? (CATEGORY_CONFIG[topCat[0] as AnswerCategory]?.color ?? "#52525b") : "#27272a" }}>
        {topCat ? `${topCat[0]} (${topCat[1]}×)` : "—"}
      </td>
      <td colSpan={3} style={{ ...stat, color: "#27272a" }}>
        {answered}/{total} Antworten · {appt}/{total} Termine
      </td>
    </tr>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export function ListBoard({ listId, stages, contacts }: {
  listId: string; stages: PipelineStage[]; contacts: ContactWithStage[];
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      [c.name, c.notes, c.answer_text, c.answer_category]
        .filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [contacts, search]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
        <div style={{ position: "relative", flex: "1 1 240px", maxWidth: 280 }}>
          <Search size={13} style={{ position: "absolute", left: "0.5rem", top: "50%", transform: "translateY(-50%)", color: "#3f3f46", pointerEvents: "none" }} />
          <input
            type="search"
            placeholder="Suchen…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", background: "#0d0d10", border: "1px solid #1c1c1f", borderRadius: 8, padding: "0.35rem 0.75rem 0.35rem 1.875rem", fontSize: "0.8125rem", color: "#a1a1aa", outline: "none", boxSizing: "border-box" }}
          />
        </div>
        {search && <span style={{ fontSize: "0.75rem", color: "#52525b" }}>{filtered.length}/{contacts.length}</span>}
        <div style={{ marginLeft: "auto", fontSize: "0.6875rem", color: "#27272a" }}>Klicken zum Bearbeiten · Enter zum Speichern</div>
      </div>

      {/* Table */}
      <div style={{ border: "1px solid #1c1c1f", borderRadius: 12, overflow: "hidden", background: "#09090b" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem", tableLayout: "auto" }}>
            <thead>
              <tr style={{ background: "#0d0d10", borderBottom: "1px solid #1c1c1f" }}>
                {["Datum", "Name", "FU", "Antwort", "Termin", "Kategorie", "Was war die Antwort?", "Notizen", ""].map((h, i) => (
                  <th key={i} style={{ padding: "7px 12px", textAlign: "left", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#3f3f46", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <ContactRow key={c.id} c={c} listId={listId} stages={stages} />
              ))}
              {!search && <NewRow listId={listId} />}
            </tbody>
            {contacts.length > 0 && (
              <tfoot><StatsRow contacts={contacts} /></tfoot>
            )}
          </table>
        </div>
      </div>

      {contacts.length === 0 && !search && (
        <p style={{ textAlign: "center", color: "#27272a", fontSize: "0.8125rem", marginTop: "0.375rem" }}>
          Name eingeben und Enter drücken — fertig.
        </p>
      )}
    </div>
  );
}
