"use client";

import { updateContact } from "@/app/actions/contacts";
import type { ContactWithStage } from "@/lib/types";
import { CheckCircle, CircleDollarSign, Search, XCircle } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

type ContactListInfo = {
  id: string;
  name: string;
  owner_name: string | null;
};

export type CrmContact = ContactWithStage & {
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
  background: "rgb(24 98 184 / 0.06)",
  border: "1px solid rgb(24 98 184 / 0.45)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-primary)",
  padding: "0.375rem 0.5rem",
  fontSize: "0.8125rem",
  outline: "none",
  boxSizing: "border-box",
};

function InlineTextarea({
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
        rows={3}
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
        style={{ ...inputStyle, resize: "vertical", minHeight: 70 }}
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
        minHeight: 44,
        textAlign: "left",
        background: "transparent",
        border: "none",
        color: value ? "var(--text-secondary)" : "var(--text-subtle)",
        cursor: "text",
        padding: 0,
        font: "inherit",
        whiteSpace: "pre-wrap",
      }}
    >
      {value || placeholder}
    </button>
  );
}

function StatusPill({ contact }: { contact: CrmContact }) {
  if (contact.deal_closed) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", color: "var(--color-success-text)", background: "rgb(4 184 0 / 0.08)", border: "1px solid rgb(4 184 0 / 0.25)", borderRadius: 999, padding: "0.25rem 0.55rem", fontSize: "0.75rem", fontWeight: 800 }}>
        <CheckCircle size={12} /> Gewonnen
      </span>
    );
  }
  if (contact.deal_lost_reason) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", color: "var(--color-error-text)", background: "rgb(184 19 0 / 0.06)", border: "1px solid rgb(184 19 0 / 0.25)", borderRadius: 999, padding: "0.25rem 0.55rem", fontSize: "0.75rem", fontWeight: 800 }}>
        <XCircle size={12} /> Verloren
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", color: "var(--text-muted)", background: "var(--surface-150)", border: "1px solid var(--border)", borderRadius: 999, padding: "0.25rem 0.55rem", fontSize: "0.75rem", fontWeight: 800 }}>
      <CircleDollarSign size={12} /> Offen
    </span>
  );
}

function CrmRow({ contact }: { contact: CrmContact }) {
  const [vals, setVals] = useState({
    meeting_notes: contact.meeting_notes ?? "",
    next_follow_up_at: contact.next_follow_up_at ?? "",
    deal_closed: contact.deal_closed === true,
    deal_lost_reason: contact.deal_lost_reason ?? "",
  });
  const [isPending, startTransition] = useTransition();

  const previewContact = { ...contact, deal_closed: vals.deal_closed, deal_lost_reason: vals.deal_lost_reason };

  function save(patch: Partial<typeof vals>) {
    const next = { ...vals, ...patch };
    setVals(next);
    const payload: Parameters<typeof updateContact>[2] = {};
    if (patch.meeting_notes !== undefined) payload.meeting_notes = patch.meeting_notes || null;
    if (patch.next_follow_up_at !== undefined) payload.next_follow_up_at = patch.next_follow_up_at || null;
    if (patch.deal_closed !== undefined) payload.deal_closed = patch.deal_closed;
    if (patch.deal_lost_reason !== undefined) payload.deal_lost_reason = patch.deal_lost_reason || null;
    startTransition(async () => {
      await updateContact(contact.id, contact.list_id, payload);
    });
  }

  return (
    <tr style={{ opacity: isPending ? 0.6 : 1 }}>
      <td style={{ ...td, minWidth: 210 }}>
        <div style={{ color: "var(--text-primary)", fontWeight: 800 }}>{contact.name}</div>
        <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginTop: 2 }}>{contact.company || "Keine Firma"}</div>
        <div style={{ color: "var(--text-subtle)", fontSize: "0.75rem", marginTop: 2 }}>{contact.lists?.name ?? "Liste"}</div>
      </td>
      <td style={{ ...td, minWidth: 270 }}>
        <InlineTextarea value={vals.meeting_notes} placeholder="Meeting Notizen eintragen..." onSave={(v) => save({ meeting_notes: v })} />
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
        <button
          type="button"
          onClick={() => save({ deal_closed: !vals.deal_closed, deal_lost_reason: !vals.deal_closed ? "" : vals.deal_lost_reason })}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
            borderRadius: 999,
            border: `1px solid ${vals.deal_closed ? "rgb(4 184 0 / 0.30)" : "var(--border)"}`,
            background: vals.deal_closed ? "rgb(4 184 0 / 0.08)" : "transparent",
            color: vals.deal_closed ? "var(--color-success-text)" : "var(--text-subtle)",
            padding: "0.35rem 0.65rem",
            fontSize: "0.75rem",
            fontWeight: 800,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {vals.deal_closed ? "Abgeschlossen" : "Offen"}
        </button>
      </td>
      <td style={{ ...td, minWidth: 250 }}>
        <InlineTextarea value={vals.deal_lost_reason} placeholder="Warum hat es nicht geklappt?" onSave={(v) => save({ deal_lost_reason: v, deal_closed: false })} />
      </td>
      <td style={td}>
        <StatusPill contact={previewContact} />
      </td>
    </tr>
  );
}

export function CrmBoard({ contacts }: { contacts: CrmContact[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "open" | "won" | "lost">("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((contact) => {
      const matchesStatus =
        status === "all" ||
        (status === "open" && !contact.deal_closed && !contact.deal_lost_reason) ||
        (status === "won" && contact.deal_closed) ||
        (status === "lost" && !contact.deal_closed && Boolean(contact.deal_lost_reason));
      if (!matchesStatus) return false;
      if (!q) return true;
      return [contact.name, contact.company, contact.lists?.name, contact.meeting_notes, contact.deal_lost_reason]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [contacts, search, status]);

  const won = contacts.filter((contact) => contact.deal_closed).length;
  const lost = contacts.filter((contact) => !contact.deal_closed && contact.deal_lost_reason).length;
  const open = contacts.length - won - lost;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "0.75rem" }}>
        {[
          { label: "CRM-Kontakte", value: contacts.length, color: "var(--text-primary)" },
          { label: "Offen", value: open, color: "var(--brand-500)" },
          { label: "Gewonnen", value: won, color: "var(--color-success-text)" },
          { label: "Verloren", value: lost, color: "var(--color-error-text)" },
        ].map((stat) => (
          <div key={stat.label} style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1rem", boxShadow: "var(--shadow-sm)" }}>
            <div style={{ color: "var(--text-subtle)", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{stat.label}</div>
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
            placeholder="CRM suchen..."
            style={{ ...inputStyle, paddingLeft: "2rem", background: "var(--surface-100)", borderColor: "var(--border)" }}
          />
        </div>
        {[
          ["all", "Alle"],
          ["open", "Offen"],
          ["won", "Gewonnen"],
          ["lost", "Verloren"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatus(value as "all" | "open" | "won" | "lost")}
            style={{
              border: `1px solid ${status === value ? "var(--brand-500)" : "var(--border)"}`,
              background: status === value ? "rgb(24 98 184 / 0.10)" : "transparent",
              color: status === value ? "var(--brand-500)" : "var(--text-subtle)",
              borderRadius: 999,
              padding: "0.4rem 0.75rem",
              fontSize: "0.75rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--surface-100)", boxShadow: "var(--shadow-sm)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 1180, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--surface-50)" }}>
                {["Kontakt", "Meeting Notizen", "Wann Follow Up", "Deal abgeschlossen", "Warum nicht geklappt", "Status"].map((head) => (
                  <th key={head} style={{ padding: "0.625rem 0.75rem", textAlign: "left", color: "var(--text-subtle)", fontSize: "0.6875rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((contact) => <CrmRow key={contact.id} contact={contact} />)}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-subtle)", fontSize: "0.875rem" }}>
            Keine CRM-Kontakte für diese Auswahl.
          </div>
        )}
      </div>
    </div>
  );
}
