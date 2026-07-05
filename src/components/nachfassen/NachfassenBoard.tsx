"use client";

import { advanceLinkedInFollowUp, markLinkedInAnswered, type NachfassenTask } from "@/app/actions/nachfassen";
import {
  ArrowUpRight,
  AtSign,
  Bell,
  Check,
  CheckCheck,
  Copy,
  Handshake,
  MessageCircle,
  Phone,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

// Nachfassen-Board (Client): Union-Tasklist aus LinkedIn-FUs, Telefon-Rückrufen
// und Closing-Nachfassen. Kernwert: fertiger Text zum Kopieren — KEIN Auto-Versand.

type Props = { tasks: NachfassenTask[] };

type ChannelFilter = "alle" | NachfassenTask["source"];

const CHANNEL_META: Record<
  NachfassenTask["source"],
  { label: string; icon: React.ReactNode; color: string; bg: string; border: string }
> = {
  linkedin: {
    label: "LinkedIn",
    icon: <AtSign size={10} />,
    color: "var(--color-info-text)",
    bg: "var(--color-info-bg)",
    border: "var(--color-info-border)",
  },
  telefon: {
    label: "Telefon",
    icon: <Phone size={10} />,
    color: "var(--color-warning-text)",
    bg: "var(--color-warning-bg)",
    border: "var(--color-warning-border)",
  },
  closing: {
    label: "Closing",
    icon: <Handshake size={10} />,
    color: "var(--color-success-text)",
    bg: "var(--color-success-bg)",
    border: "var(--color-success-border)",
  },
};

const FILTERS: { value: ChannelFilter; label: string }[] = [
  { value: "alle", label: "Alle" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "telefon", label: "Telefon" },
  { value: "closing", label: "Closing" },
];

/** Fällig-Zeitpunkt de-DE (Europe/Berlin). Datum-only-Strings ohne Uhrzeit formatieren. */
function formatDue(iso: string): string {
  const dateOnly = !iso.includes("T");
  const d = new Date(dateOnly ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const datePart = new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(d);
  if (dateOnly) return datePart;
  const timePart = new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(d);
  return `${datePart}, ${timePart} Uhr`;
}

function isOverdue(iso: string): boolean {
  const dateOnly = !iso.includes("T");
  if (dateOnly) {
    // Datum-only: überfällig, wenn der Tag (Europe/Berlin) vor heute liegt
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
    return iso < today;
  }
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}

function dueSortKey(t: NachfassenTask): number {
  if (!t.due_at) return Number.MAX_SAFE_INTEGER;
  const d = new Date(t.due_at.includes("T") ? t.due_at : `${t.due_at}T00:00:00`);
  return Number.isNaN(d.getTime()) ? Number.MAX_SAFE_INTEGER : d.getTime();
}

const linkBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.3rem",
  padding: "0.35rem 0.75rem",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface-50)",
  color: "var(--text-secondary)",
  fontSize: "0.75rem",
  fontWeight: 700,
  textDecoration: "none",
  cursor: "pointer",
  transition: "all 0.1s",
};

function TaskCard({ task }: { task: NachfassenTask }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = CHANNEL_META[task.source];
  const overdue = task.due_at ? isOverdue(task.due_at) : false;

  if (hidden) return null;

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(task.prepared_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Kopieren fehlgeschlagen — Text bitte manuell markieren.");
    }
  };

  const runLinkedInAction = (action: (id: string) => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await action(task.entity_id);
      if (res.error) {
        setError(res.error);
        return;
      }
      setHidden(true);
      router.refresh();
    });
  };

  return (
    <div
      style={{
        background: "var(--surface-100)",
        border: `1px solid ${overdue ? "var(--color-error-border)" : "var(--border)"}`,
        borderRadius: "var(--radius-md)",
        padding: "0.875rem 1.125rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        opacity: isPending ? 0.55 : 1,
        transition: "opacity 0.15s, border-color 0.15s",
      }}
    >
      {/* ── Kopfzeile: Lead + Badge + Owner + Fälligkeit ── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.875rem", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.2rem" }}>
            <span
              style={{
                fontSize: "0.9375rem",
                fontWeight: 800,
                letterSpacing: "-0.01em",
                color: "var(--text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {task.lead_name ?? "Unbenannter Lead"}
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
                fontSize: "0.625rem",
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: meta.color,
                background: meta.bg,
                border: `1px solid ${meta.border}`,
                borderRadius: 99,
                padding: "0.1rem 0.45rem",
                flexShrink: 0,
              }}
            >
              {meta.icon} {meta.label}
              {task.source === "linkedin" && task.next_fu_number != null && ` · FU${task.next_fu_number}`}
            </span>
            {task.owner_name && (
              <span
                style={{
                  fontSize: "0.625rem",
                  fontWeight: 700,
                  color: "var(--text-muted)",
                  background: "var(--surface-150)",
                  border: "1px solid var(--border)",
                  borderRadius: 99,
                  padding: "0.1rem 0.45rem",
                  flexShrink: 0,
                }}
              >
                {task.owner_name}
              </span>
            )}
          </div>
          {task.company && (
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {task.company}
            </div>
          )}
        </div>

        {task.due_at && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              fontSize: "0.75rem",
              fontWeight: 700,
              color: overdue ? "var(--color-error-text)" : "var(--text-secondary)",
              flexShrink: 0,
            }}
          >
            <Bell size={12} />
            {overdue ? `überfällig seit ${formatDue(task.due_at)}` : `fällig ${formatDue(task.due_at)}`}
          </span>
        )}
      </div>

      {/* ── Vorbereiteter Text zum Kopieren ── */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "0.625rem",
          background: "var(--surface-50)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          padding: "0.625rem 0.75rem",
        }}
      >
        <MessageCircle size={13} style={{ color: "var(--text-subtle)", flexShrink: 0, marginTop: 2 }} />
        <p
          style={{
            flex: 1,
            margin: 0,
            fontSize: "0.8125rem",
            lineHeight: 1.5,
            color: "var(--text-secondary)",
            userSelect: "text",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {task.prepared_text}
        </p>
        <button
          type="button"
          onClick={copyText}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.3rem",
            padding: "0.3rem 0.625rem",
            borderRadius: "var(--radius-sm)",
            border: `1px solid ${copied ? "var(--color-success-border)" : "var(--border)"}`,
            background: copied ? "var(--color-success-bg)" : "var(--surface-100)",
            color: copied ? "var(--color-success-text)" : "var(--text-secondary)",
            fontSize: "0.6875rem",
            fontWeight: 700,
            cursor: "pointer",
            flexShrink: 0,
            whiteSpace: "nowrap",
            transition: "all 0.1s",
          }}
        >
          {copied ? (
            <>
              <Check size={11} /> Kopiert ✓
            </>
          ) : (
            <>
              <Copy size={11} /> Text kopieren
            </>
          )}
        </button>
      </div>

      {/* ── Aktionen je Kanal ── */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        {task.source === "linkedin" && (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={() => runLinkedInAction(advanceLinkedInFollowUp)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.3rem",
                padding: "0.35rem 0.75rem",
                borderRadius: "var(--radius-sm)",
                border: "none",
                background: "var(--btn-primary-bg)",
                color: "var(--btn-primary-fg)",
                fontSize: "0.75rem",
                fontWeight: 700,
                cursor: isPending ? "default" : "pointer",
                transition: "all 0.1s",
              }}
            >
              <CheckCheck size={12} /> Erledigt → nächste Stufe
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => runLinkedInAction(markLinkedInAnswered)}
              style={{
                ...linkBtnStyle,
                color: "var(--color-success-text)",
                background: "var(--color-success-bg)",
                borderColor: "var(--color-success-border)",
                cursor: isPending ? "default" : "pointer",
              }}
            >
              <Check size={12} /> Beantwortet
            </button>
            {task.list_id && (
              <Link href={`/lists/${task.list_id}`} style={linkBtnStyle}>
                Zur Liste <ArrowUpRight size={12} />
              </Link>
            )}
          </>
        )}

        {task.source === "telefon" && (
          <>
            {task.list_id && (
              <Link href={`/telefon/${task.list_id}`} style={linkBtnStyle}>
                <Phone size={12} /> Zum Call-Mode
              </Link>
            )}
            {task.phone && (
              <a
                href={`tel:${task.phone.replace(/[^\d+]/g, "")}`}
                style={{ ...linkBtnStyle, color: "var(--brand-500)", borderColor: "var(--border-bright)" }}
              >
                {task.phone}
              </a>
            )}
          </>
        )}

        {task.source === "closing" && (
          <Link href={`/closing/${task.entity_id}`} style={linkBtnStyle}>
            <Handshake size={12} /> Zum Closing
          </Link>
        )}

        {error && (
          <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-error-text)" }}>{error}</span>
        )}
      </div>
    </div>
  );
}

export function NachfassenBoard({ tasks }: Props) {
  const [filter, setFilter] = useState<ChannelFilter>("alle");

  // Überfällige zuerst, danach aufsteigend nach Fälligkeit
  const sorted = useMemo(() => [...tasks].sort((a, b) => dueSortKey(a) - dueSortKey(b)), [tasks]);

  const counts = useMemo(() => {
    const c: Record<ChannelFilter, number> = { alle: tasks.length, linkedin: 0, telefon: 0, closing: 0 };
    for (const t of tasks) c[t.source] += 1;
    return c;
  }, [tasks]);

  const visible = useMemo(
    () => (filter === "alle" ? sorted : sorted.filter((t) => t.source === filter)),
    [sorted, filter],
  );

  return (
    <div>
      {/* ── Kanal-Filter ── */}
      <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        {FILTERS.map((f) => {
          const active = filter === f.value;
          const meta = f.value !== "alle" ? CHANNEL_META[f.value] : null;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                padding: "0.3rem 0.625rem",
                borderRadius: 99,
                border: `1px solid ${active ? (meta?.border ?? "var(--border-bright)") : "var(--border)"}`,
                background: active ? (meta?.bg ?? "var(--surface-150)") : "var(--surface-50)",
                color: active ? (meta?.color ?? "var(--text-primary)") : "var(--text-muted)",
                fontSize: "0.75rem",
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.1s",
              }}
            >
              {f.label}
              <span
                style={{
                  fontSize: "0.625rem",
                  fontWeight: 800,
                  background: "var(--surface-200)",
                  color: "var(--text-muted)",
                  borderRadius: 99,
                  padding: "0.05rem 0.35rem",
                }}
              >
                {counts[f.value]}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Karten / Leerzustand ── */}
      {visible.length === 0 ? (
        <div
          style={{
            background: "var(--surface-100)",
            border: "1px dashed var(--border-bright)",
            borderRadius: "var(--radius-lg)",
            padding: "3rem 1.5rem",
            textAlign: "center",
          }}
        >
          <Bell size={26} style={{ color: "var(--text-subtle)", marginBottom: "0.625rem" }} />
          <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.25rem" }}>
            Keine fälligen Nachfass-Aufgaben 🎉
          </div>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", margin: 0 }}>
            Sobald LinkedIn-Follow-ups, Telefon-Rückrufe oder Closing-Nachfassen fällig werden, erscheinen sie hier.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
          {visible.map((t) => (
            <TaskCard key={`${t.source}-${t.entity_id}`} task={t} />
          ))}
        </div>
      )}
    </div>
  );
}
