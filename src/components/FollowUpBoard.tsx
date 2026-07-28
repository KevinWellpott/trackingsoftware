"use client";

import { updateContact } from "@/app/actions/contacts";
import type { ContactWithStage } from "@/lib/types";
import { Calendar, CheckCircle, Clock, Search } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

type ContactListInfo = {
  id: string;
  name: string;
  owner_name: string | null;
};

export type FollowUpContact = ContactWithStage & {
  lists: ContactListInfo | null;
};

const td: React.CSSProperties = {
  padding: "0.625rem 0.75rem",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "top",
  fontSize: "0.8125rem",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--color-info-bg)",
  border: "1px solid color-mix(in srgb, var(--brand-500) 45%, transparent)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-primary)",
  padding: "0.375rem 0.5rem",
  fontSize: "0.8125rem",
  outline: "none",
  boxSizing: "border-box",
};

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(y, m - 1, d);
  next.setDate(next.getDate() + days);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
}

function InlineText({
  value,
  placeholder,
  onSave,
}: {
  value: string;
  placeholder: string;
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);

  if (editing) {
    return (
      <textarea
        autoFocus
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onSave(local);
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            setEditing(false);
            onSave(local);
          }
          if (e.key === "Escape") {
            setEditing(false);
            setLocal(value);
          }
        }}
        rows={2}
        style={{ ...inputStyle, resize: "vertical", minHeight: 58 }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setLocal(value);
        setEditing(true);
      }}
      style={{
        width: "100%",
        minHeight: 34,
        textAlign: "left",
        background: "transparent",
        border: "none",
        color: value ? "var(--text-secondary)" : "var(--text-subtle)",
        cursor: "text",
        padding: "0.125rem 0",
        font: "inherit",
        whiteSpace: "pre-wrap",
      }}
    >
      {value || placeholder}
    </button>
  );
}

function ToggleButton({
  value,
  label,
  onChange,
}: {
  value: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.375rem",
        borderRadius: 999,
        border: `1px solid ${value ? "var(--color-success-border)" : "var(--border)"}`,
        background: value ? "var(--color-success-bg)" : "transparent",
        color: value ? "var(--color-success-text)" : "var(--text-subtle)",
        padding: "0.35rem 0.65rem",
        fontSize: "0.75rem",
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {value && <CheckCircle size={12} />}
      {label}
    </button>
  );
}

function FollowUpRow({ contact }: { contact: FollowUpContact }) {
  const [vals, setVals] = useState({
    next_follow_up_at: contact.next_follow_up_at ?? "",
    follow_up_number: contact.follow_up_number as 1 | 2 | 3 | null,
    answered: contact.answered === true,
    appointment_set: contact.appointment_set === true,
    answer_text: contact.answer_text ?? "",
    notes: contact.notes ?? "",
  });
  const [isPending, startTransition] = useTransition();

  function save(patch: Partial<typeof vals>) {
    const next = { ...vals, ...patch };
    setVals(next);
    const payload: Parameters<typeof updateContact>[2] = {};
    if (patch.next_follow_up_at !== undefined) payload.next_follow_up_at = patch.next_follow_up_at || null;
    if (patch.follow_up_number !== undefined) payload.follow_up_number = patch.follow_up_number;
    if (patch.answered !== undefined) payload.answered = patch.answered;
    if (patch.appointment_set !== undefined) payload.appointment_set = patch.appointment_set;
    if (patch.answer_text !== undefined) payload.answer_text = patch.answer_text || null;
    if (patch.notes !== undefined) payload.notes = patch.notes || null;
    startTransition(async () => {
      await updateContact(contact.id, contact.list_id, payload);
    });
  }

  return (
    <tr style={{ opacity: isPending ? 0.6 : 1 }}>
      <td style={td}>
        <div style={{ color: "var(--text-primary)", fontWeight: 600 }}>{contact.name}</div>
        <div style={{ color: "var(--text-subtle)", fontSize: "0.75rem", marginTop: 2 }}>
          {contact.company || "Keine Firma"} · {contact.lists?.name ?? "Liste"}
        </div>
      </td>
      <td style={td}>
        <input
          type="date"
          value={vals.next_follow_up_at}
          onChange={(e) => save({ next_follow_up_at: e.target.value })}
          style={{ ...inputStyle, width: 142 }}
        />
      </td>
      <td style={td}>
        <select
          value={vals.follow_up_number ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            save({ follow_up_number: v === "1" ? 1 : v === "2" ? 2 : v === "3" ? 3 : null });
          }}
          style={{ ...inputStyle, width: 90 }}
        >
          <option value="">FU offen</option>
          <option value="1">FU1</option>
          <option value="2">FU2</option>
          <option value="3">FU3</option>
        </select>
      </td>
      <td style={td}>
        <ToggleButton value={vals.answered} label={vals.answered ? "Antwort" : "Offen"} onChange={(v) => save({ answered: v })} />
      </td>
      <td style={td}>
        <ToggleButton value={vals.appointment_set} label={vals.appointment_set ? "Termin" : "Kein Termin"} onChange={(v) => save({ appointment_set: v })} />
      </td>
      <td style={{ ...td, minWidth: 220 }}>
        <InlineText value={vals.answer_text} placeholder="Antwort eintragen..." onSave={(v) => save({ answer_text: v })} />
      </td>
      <td style={{ ...td, minWidth: 220 }}>
        <InlineText value={vals.notes} placeholder="Notiz eintragen..." onSave={(v) => save({ notes: v })} />
      </td>
    </tr>
  );
}

export function FollowUpBoard({ contacts }: { contacts: FollowUpContact[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "overdue" | "today" | "week">("all");
  const today = localToday();
  const weekEnd = addDays(today, 7);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((contact) => {
      const date = contact.next_follow_up_at ?? "";
      const matchesFilter =
        filter === "all" ||
        (filter === "overdue" && date < today) ||
        (filter === "today" && date === today) ||
        (filter === "week" && date >= today && date <= weekEnd);
      if (!matchesFilter) return false;
      if (!q) return true;
      return [contact.name, contact.company, contact.lists?.name, contact.answer_text, contact.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [contacts, filter, search, today, weekEnd]);

  const overdue = contacts.filter((contact) => (contact.next_follow_up_at ?? "") < today).length;
  const dueToday = contacts.filter((contact) => contact.next_follow_up_at === today).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "0.75rem" }}>
        {[
          { label: "Offene Follow-ups", value: contacts.length, color: "var(--brand-500)", icon: <Clock size={15} /> },
          { label: "Überfällig", value: overdue, color: overdue ? "var(--color-error-text)" : "var(--color-success-text)", icon: <Calendar size={15} /> },
          { label: "Heute", value: dueToday, color: dueToday ? "var(--color-warning-text)" : "var(--text-subtle)", icon: <CheckCircle size={15} /> },
        ].map((stat) => (
          <div key={stat.label} style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1rem", boxShadow: "var(--shadow-sm)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", color: "var(--text-subtle)", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {stat.icon}
              {stat.label}
            </div>
            <div style={{ color: stat.color, fontSize: "1.6rem", fontWeight: 900, lineHeight: 1.2 }}>{stat.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 240px", maxWidth: 320 }}>
          <Search size={14} style={{ position: "absolute", left: "0.625rem", top: "50%", transform: "translateY(-50%)", color: "var(--text-subtle)" }} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Follow-ups suchen..."
            style={{ ...inputStyle, paddingLeft: "2rem", background: "var(--surface-100)", borderColor: "var(--border)" }}
          />
        </div>
        {[
          ["all", "Alle"],
          ["overdue", "Überfällig"],
          ["today", "Heute"],
          ["week", "Diese Woche"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value as "all" | "overdue" | "today" | "week")}
            style={{
              border: `1px solid ${filter === value ? "var(--brand-500)" : "var(--border)"}`,
              background: filter === value ? "var(--color-info-bg)" : "transparent",
              color: filter === value ? "var(--brand-500)" : "var(--text-subtle)",
              borderRadius: 999,
              padding: "0.4rem 0.75rem",
              fontSize: "0.75rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--surface-100)", boxShadow: "var(--shadow-sm)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 1120, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--surface-50)" }}>
                {["Kontakt", "Wann Follow Up", "Stufe", "Antwort", "Termin", "Antworttext", "Notizen"].map((head) => (
                  <th key={head} style={{ padding: "0.625rem 0.75rem", textAlign: "left", color: "var(--text-subtle)", fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((contact) => <FollowUpRow key={contact.id} contact={contact} />)}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-subtle)", fontSize: "0.875rem" }}>
            Keine offenen Follow-ups für diese Auswahl.
          </div>
        )}
      </div>
    </div>
  );
}
