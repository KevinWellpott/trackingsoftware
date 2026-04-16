"use client";

import { useTransition, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  createOrganicPost,
  updateOrganicPost,
  deleteOrganicPostForm,
  type OrganicPost,
} from "@/app/actions/organic";

type Props = {
  listId: string;
  ownerName: string | null;
  posts: OrganicPost[];
};

const CONTENT_TYPES = [
  { value: "educational",  label: "Educational",       color: "#6366f1" },
  { value: "motivational", label: "Motivational",      color: "#f59e0b" },
  { value: "entertaining", label: "Entertaining",      color: "#ec4899" },
  { value: "bts",          label: "Behind-the-Scenes", color: "#10b981" },
  { value: "other",        label: "Sonstiges",         color: "#71717a" },
] as const;

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ContentTypeBadge({ value }: { value: OrganicPost["content_type"] }) {
  if (!value) return <span style={{ color: "var(--text-subtle)" }}>—</span>;
  const ct = CONTENT_TYPES.find((c) => c.value === value);
  return (
    <span style={{
      fontSize: "0.6875rem",
      fontWeight: 600,
      padding: "0.1rem 0.45rem",
      borderRadius: 99,
      background: (ct?.color ?? "#71717a") + "22",
      color: ct?.color ?? "#71717a",
      whiteSpace: "nowrap",
    }}>
      {ct?.label ?? value}
    </span>
  );
}

// ── Inline Text Cell ───────────────────────────────────────────────────────
function InlineText({
  value,
  onSave,
  placeholder,
  style,
}: {
  value: string | null;
  onSave: (v: string | null) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const ref = useRef<HTMLInputElement>(null);

  function commit() {
    setEditing(false);
    const v = draft.trim() || null;
    if (v !== value) onSave(v);
  }

  if (!editing) {
    return (
      <span
        onClick={() => { setDraft(value ?? ""); setEditing(true); setTimeout(() => ref.current?.focus(), 20); }}
        style={{
          display: "block",
          minWidth: 60,
          cursor: "text",
          color: value ? "var(--text-primary)" : "var(--text-subtle)",
          ...style,
        }}
        title="Klicken zum Bearbeiten"
      >
        {value || placeholder || "—"}
      </span>
    );
  }
  return (
    <input
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditing(false); setDraft(value ?? ""); } }}
      style={{
        background: "var(--surface-150)",
        border: "1px solid var(--brand-500)",
        borderRadius: 4,
        padding: "0.1875rem 0.375rem",
        fontSize: "0.8125rem",
        color: "var(--text-primary)",
        outline: "none",
        width: "100%",
        ...style,
      }}
    />
  );
}

// ── Inline Date Cell ───────────────────────────────────────────────────────
function InlineDate({ value, onSave }: { value: string | null; onSave: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  function commit() {
    setEditing(false);
    const v = draft.trim() || null;
    if (v !== value) onSave(v);
  }

  if (!editing) {
    return (
      <span onClick={() => { setDraft(value ?? ""); setEditing(true); setTimeout(() => ref.current?.focus(), 20); }}
        style={{ cursor: "pointer", color: value ? "var(--text-primary)" : "var(--text-subtle)" }}
        title="Datum bearbeiten"
      >
        {value || "—"}
      </span>
    );
  }
  return (
    <input
      ref={ref}
      type="date"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      style={{ background: "var(--surface-150)", border: "1px solid var(--brand-500)", borderRadius: 4, padding: "0.125rem 0.25rem", fontSize: "0.8125rem", color: "var(--text-primary)", outline: "none" }}
    />
  );
}

// ── Inline Number Cell ─────────────────────────────────────────────────────
function InlineNumber({ value, onSave, placeholder }: { value: number | null; onSave: (v: number | null) => void; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  const ref = useRef<HTMLInputElement>(null);

  function commit() {
    setEditing(false);
    const n = draft.trim() === "" ? null : Number(draft);
    const v = n != null && Number.isFinite(n) ? n : null;
    if (v !== value) onSave(v);
  }

  if (!editing) {
    return (
      <span
        onClick={() => { setDraft(value != null ? String(value) : ""); setEditing(true); setTimeout(() => ref.current?.focus(), 20); }}
        style={{ cursor: "pointer", color: value != null ? "var(--text-primary)" : "var(--text-subtle)" }}
        title="Klicken zum Bearbeiten"
      >
        {value != null ? value.toLocaleString() : (placeholder || "—")}
      </span>
    );
  }
  return (
    <input
      ref={ref}
      type="number"
      min="0"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      style={{ background: "var(--surface-150)", border: "1px solid var(--brand-500)", borderRadius: 4, padding: "0.125rem 0.25rem", fontSize: "0.8125rem", color: "var(--text-primary)", outline: "none", width: 80 }}
    />
  );
}

// ── Inline Toggle ──────────────────────────────────────────────────────────
function InlineToggle({ value, onSave, label }: { value: boolean | null; onSave: (v: boolean | null) => void; label?: string }) {
  const [, startT] = useTransition();
  function toggle() {
    startT(async () => {
      const next = value === true ? null : true;
      onSave(next);
    });
  }
  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        fontSize: "1rem",
        lineHeight: 1,
        padding: "0.125rem",
      }}
    >
      {value === true ? "✅" : "○"}
    </button>
  );
}

// ── Content Type Select ────────────────────────────────────────────────────
function ContentTypeSelect({
  value,
  onSave,
}: {
  value: OrganicPost["content_type"];
  onSave: (v: OrganicPost["content_type"]) => void;
}) {
  const [open, setOpen] = useState(false);
  const color = CONTENT_TYPES.find((c) => c.value === value)?.color ?? "#71717a";

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        <ContentTypeBadge value={value} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 100,
            background: "var(--surface-100)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "0.25rem",
            minWidth: 160,
            boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
          }}
        >
          <button
            type="button"
            onClick={() => { onSave(null); setOpen(false); }}
            style={{ display: "block", width: "100%", padding: "0.3rem 0.5rem", background: "none", border: "none", cursor: "pointer", color: "var(--text-subtle)", fontSize: "0.8125rem", textAlign: "left", borderRadius: 4 }}
          >
            — Kein Typ
          </button>
          {CONTENT_TYPES.map((ct) => (
            <button
              key={ct.value}
              type="button"
              onClick={() => { onSave(ct.value); setOpen(false); }}
              style={{ display: "block", width: "100%", padding: "0.3rem 0.5rem", background: value === ct.value ? ct.color + "22" : "none", border: "none", cursor: "pointer", color: ct.color, fontSize: "0.8125rem", fontWeight: 600, textAlign: "left", borderRadius: 4 }}
            >
              {ct.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Single post row ────────────────────────────────────────────────────────
function PostRow({ post, listId }: { post: OrganicPost; listId: string }) {
  const [, startT] = useTransition();

  function save(patch: Parameters<typeof updateOrganicPost>[2]) {
    startT(async () => {
      await updateOrganicPost(post.id, listId, patch);
    });
  }

  return (
    <tr style={{ borderBottom: "1px solid var(--border)" }}>
      <td style={td}><InlineDate value={post.posted_at} onSave={(v) => save({ posted_at: v ?? undefined })} /></td>
      <td style={{ ...td, maxWidth: 220 }}>
        <InlineText value={post.hook_text} onSave={(v) => save({ hook_text: v })} placeholder="Hook (erster Satz)…" />
      </td>
      <td style={{ ...td, maxWidth: 150 }}>
        <InlineText value={post.topic} onSave={(v) => save({ topic: v })} placeholder="Thema…" />
      </td>
      <td style={td}>
        <ContentTypeSelect value={post.content_type} onSave={(v) => save({ content_type: v })} />
      </td>
      <td style={{ ...td, textAlign: "right" }}>
        <InlineNumber value={post.insta_impressions} onSave={(v) => save({ insta_impressions: v })} placeholder="—" />
      </td>
      <td style={{ ...td, textAlign: "right" }}>
        <InlineNumber value={post.tiktok_impressions} onSave={(v) => save({ tiktok_impressions: v })} placeholder="—" />
      </td>
      <td style={{ ...td, textAlign: "center" }}>
        <InlineToggle value={post.generated_cta} onSave={(v) => save({ generated_cta: v })} label="Hat Video Anfragen gebracht?" />
      </td>
      <td style={{ ...td, textAlign: "center" }}>
        <InlineToggle value={post.stories_done} onSave={(v) => save({ stories_done: v })} label="3 Stories erledigt?" />
      </td>
      <td style={{ ...td, maxWidth: 140 }}>
        <InlineText value={post.notes} onSave={(v) => save({ notes: v })} placeholder="Notizen…" />
      </td>
      <td style={{ ...td, textAlign: "center" }}>
        <form action={deleteOrganicPostForm}>
          <input type="hidden" name="post_id" value={post.id} />
          <input type="hidden" name="list_id" value={listId} />
          <button
            type="submit"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-subtle)", padding: "0.125rem", opacity: 0.4, transition: "opacity 0.15s" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "1")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "0.4")}
            title="Post löschen"
          >
            <Trash2 size={13} />
          </button>
        </form>
      </td>
    </tr>
  );
}

const td: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  verticalAlign: "middle",
  fontSize: "0.8125rem",
  color: "var(--text-primary)",
};

// ── New post row ───────────────────────────────────────────────────────────
function NewRow({ listId, ownerName }: { listId: string; ownerName: string | null }) {
  const [pending, startT] = useTransition();
  const [date, setDate] = useState(localToday());
  const [hook, setHook] = useState("");
  const [topic, setTopic] = useState("");
  const [ctype, setCtype] = useState<OrganicPost["content_type"]>(null);
  const [insta, setInsta] = useState("");
  const [tiktok, setTiktok] = useState("");
  const [cta, setCta] = useState<boolean | null>(null);
  const [stories, setStories] = useState<boolean | null>(null);
  const hookRef = useRef<HTMLInputElement>(null);

  function reset() {
    setHook(""); setTopic(""); setCtype(null); setInsta(""); setTiktok(""); setCta(null); setStories(null); setDate(localToday());
  }

  function submit() {
    startT(async () => {
      await createOrganicPost({
        list_id:            listId,
        owner_name:         ownerName,
        posted_at:          date || localToday(),
        hook_text:          hook.trim() || null,
        topic:              topic.trim() || null,
        content_type:       ctype,
        insta_impressions:  insta ? Number(insta) : null,
        tiktok_impressions: tiktok ? Number(tiktok) : null,
        generated_cta:      cta,
        stories_done:       stories,
      });
      reset();
      setTimeout(() => hookRef.current?.focus(), 50);
    });
  }

  const inputStyle: React.CSSProperties = {
    background: "var(--surface-100)",
    border: "1px solid var(--border-bright)",
    borderRadius: 4,
    padding: "0.25rem 0.375rem",
    fontSize: "0.8125rem",
    color: "var(--text-primary)",
    outline: "none",
    width: "100%",
  };

  return (
    <tr style={{ background: "rgba(99,102,241,0.04)", borderBottom: "1px solid var(--border)" }}>
      <td style={td}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, width: 120 }} />
      </td>
      <td style={{ ...td, maxWidth: 220 }}>
        <input ref={hookRef} value={hook} onChange={(e) => setHook(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Hook (erster Satz)…" style={inputStyle} />
      </td>
      <td style={{ ...td, maxWidth: 150 }}>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Thema…" style={inputStyle} />
      </td>
      <td style={td}>
        <select
          value={ctype ?? ""}
          onChange={(e) => setCtype((e.target.value || null) as OrganicPost["content_type"])}
          style={{ ...inputStyle, width: "auto" }}
        >
          <option value="">— Typ</option>
          {CONTENT_TYPES.map((ct) => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
        </select>
      </td>
      <td style={{ ...td, textAlign: "right" }}>
        <input type="number" min="0" value={insta} onChange={(e) => setInsta(e.target.value)} placeholder="0" style={{ ...inputStyle, width: 72, textAlign: "right" }} />
      </td>
      <td style={{ ...td, textAlign: "right" }}>
        <input type="number" min="0" value={tiktok} onChange={(e) => setTiktok(e.target.value)} placeholder="0" style={{ ...inputStyle, width: 72, textAlign: "right" }} />
      </td>
      <td style={{ ...td, textAlign: "center" }}>
        <button type="button" onClick={() => setCta((v) => (v === true ? null : true))} title="CTA" style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1rem" }}>
          {cta === true ? "✅" : "○"}
        </button>
      </td>
      <td style={{ ...td, textAlign: "center" }}>
        <button type="button" onClick={() => setStories((v) => (v === true ? null : true))} title="Stories" style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1rem" }}>
          {stories === true ? "✅" : "○"}
        </button>
      </td>
      <td style={td} />
      <td style={{ ...td, textAlign: "center" }}>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          style={{
            background: "var(--brand-500)",
            color: "white",
            border: "none",
            borderRadius: 6,
            padding: "0.25rem 0.625rem",
            fontSize: "0.75rem",
            fontWeight: 700,
            cursor: "pointer",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? "…" : "+ Post"}
        </button>
      </td>
    </tr>
  );
}

// ── Stats row ──────────────────────────────────────────────────────────────
function StatsRow({ posts }: { posts: OrganicPost[] }) {
  const instaData  = posts.filter((p) => p.insta_impressions  != null).map((p) => p.insta_impressions!);
  const tiktokData = posts.filter((p) => p.tiktok_impressions != null).map((p) => p.tiktok_impressions!);
  const avgI = instaData.length  ? Math.round(instaData.reduce((a, b)  => a + b, 0) / instaData.length)  : 0;
  const avgT = tiktokData.length ? Math.round(tiktokData.reduce((a, b) => a + b, 0) / tiktokData.length) : 0;
  const ctaCount     = posts.filter((p) => p.generated_cta).length;
  const storiesCount = posts.filter((p) => p.stories_done).length;

  return (
    <tr style={{ background: "var(--surface-100)", borderTop: "2px solid var(--border)" }}>
      <td colSpan={4} style={{ ...td, fontWeight: 700, color: "var(--text-secondary)", fontSize: "0.75rem" }}>
        {posts.length} Posts gesamt
      </td>
      <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "#e879f9" }}>Ø {avgI.toLocaleString()}</td>
      <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "#38bdf8" }}>Ø {avgT.toLocaleString()}</td>
      <td style={{ ...td, textAlign: "center", fontWeight: 700, color: "#34d399" }}>{ctaCount} CTAs</td>
      <td style={{ ...td, textAlign: "center", fontWeight: 700, color: "#f59e0b" }}>{storiesCount} Stories ✓</td>
      <td colSpan={2} />
    </tr>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export function OrganicBoard({ listId, ownerName, posts }: Props) {
  const thStyle: React.CSSProperties = {
    padding: "0.5rem 0.75rem",
    textAlign: "left",
    fontSize: "0.6875rem",
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-subtle)",
    whiteSpace: "nowrap",
    borderBottom: "1px solid var(--border)",
  };

  return (
    <div style={{ border: "1px solid #1c1c1f", borderRadius: 12, background: "#09090b", overflow: "clip" }}>
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" as never }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem", tableLayout: "auto", minWidth: 780 }}>
          <thead>
            <tr style={{ background: "var(--surface-100)" }}>
              <th style={{ ...thStyle, minWidth: 110 }}>Datum</th>
              <th style={{ ...thStyle, minWidth: 180 }}>Hook</th>
              <th style={{ ...thStyle, minWidth: 120 }}>Thema</th>
              <th style={thStyle}>Typ</th>
              <th style={{ ...thStyle, textAlign: "right" }}>📸 Insta</th>
              <th style={{ ...thStyle, textAlign: "right" }}>🎵 TikTok</th>
              <th style={{ ...thStyle, textAlign: "center" }}>CTA</th>
              <th style={{ ...thStyle, textAlign: "center" }}>Stories</th>
              <th style={thStyle}>Notizen</th>
              <th style={{ ...thStyle, textAlign: "center", width: 32 }} />
            </tr>
          </thead>
          <tbody>
            {posts.map((p) => (
              <PostRow key={p.id} post={p} listId={listId} />
            ))}
            <NewRow listId={listId} ownerName={ownerName} />
            {posts.length > 0 && <StatsRow posts={posts} />}
          </tbody>
        </table>
      </div>
    </div>
  );
}
