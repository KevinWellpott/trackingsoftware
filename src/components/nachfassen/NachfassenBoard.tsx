"use client";

import { advanceLinkedInFollowUp, markLinkedInAnswered, type NachfassenTask } from "@/app/actions/nachfassen";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import {
  AlertTriangle,
  ArrowUpRight,
  AtSign,
  CalendarClock,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock,
  Copy,
  Handshake,
  History,
  Phone,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

// Nachfassen-Board (Client): Union-Tasklist aus LinkedIn-FUs, Telefon-Rückrufen
// und Closing-Nachfassen. Kernwert: fertiger Text zum Kopieren — KEIN Auto-Versand.
// Layout: Summary-Chips → Kanal-Tabs → FU-Schnellauswahl → einklappbare Sektionen
// mit kompaktem Karten-Grid.

type Props = {
  tasks: NachfassenTask[];
  /** Anzahl ausgeblendeter älterer LinkedIn-Leads (Pitch > 7 Tage). */
  hiddenOlder: number;
  /** true, wenn ?alle=1 aktiv ist und auch ältere Leads geladen wurden. */
  showingAll: boolean;
};

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
  setting: {
    label: "Setting",
    icon: <ClipboardCheck size={10} />,
    color: "var(--brand-500)",
    bg: "var(--brand-50)",
    border: "var(--brand-200)",
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
  { value: "setting", label: "Setting" },
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

/** Kurzformat (dd.MM.yyyy) für Sektions-Meta. */
function formatDueShort(iso: string): string {
  const dateOnly = !iso.includes("T");
  const d = new Date(dateOnly ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(d);
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
  padding: "0.3rem 0.625rem",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface-50)",
  color: "var(--text-secondary)",
  fontSize: "0.6875rem",
  fontWeight: 700,
  textDecoration: "none",
  cursor: "pointer",
  transition: "all 0.1s",
};

/* ── Summary-Chip: kompakte Kennzahl-Pille oberhalb der Tabs ── */
function StatChip({
  icon,
  label,
  value,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  danger?: boolean;
}) {
  const hot = danger && value > 0;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        padding: "0.3rem 0.65rem",
        background: hot ? "var(--color-error-bg)" : "var(--surface-100)",
        border: `1px solid ${hot ? "var(--color-error-border)" : "var(--border)"}`,
        borderRadius: "var(--radius-md)",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          color: hot ? "var(--color-error-text)" : "var(--text-subtle)",
        }}
      >
        {icon}
      </span>
      <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: hot ? "var(--color-error-text)" : "var(--text-muted)" }}>
        {label}
      </span>
      <span
        style={{
          fontSize: "0.8125rem",
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color: hot ? "var(--color-error-text)" : "var(--text-primary)",
        }}
      >
        {value}
      </span>
    </span>
  );
}

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
      // Immer den VOLLEN Text kopieren — unabhängig vom 3-Zeilen-Clamp der Anzeige
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
        border: "1px solid var(--border)",
        borderLeft: overdue ? "3px solid var(--color-error-text)" : "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "0.75rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        minWidth: 0,
        opacity: isPending ? 0.55 : 1,
        transition: "opacity 0.15s, border-color 0.15s",
      }}
    >
      {/* ── Kopfzeile: Lead + Firma + Kanal-Badge ── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "0.875rem",
              fontWeight: 650,
              letterSpacing: "-0.01em",
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {task.lead_name ?? "Unbenannter Lead"}
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
        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {task.owner_name && (
            <span
              style={{
                fontSize: "0.625rem",
                fontWeight: 700,
                color: "var(--text-muted)",
                background: "var(--surface-150)",
                border: "1px solid var(--border)",
                borderRadius: 99,
                padding: "0.1rem 0.4rem",
              }}
            >
              {task.owner_name}
            </span>
          )}
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
              padding: "0.1rem 0.4rem",
            }}
          >
            {meta.icon} {meta.label}
          </span>
        </div>
      </div>

      {/* ── Fälligkeit ── */}
      {task.due_at && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.3rem",
            fontSize: "0.6875rem",
            fontWeight: 700,
            color: overdue ? "var(--color-error-text)" : "var(--text-secondary)",
          }}
        >
          {overdue ? <AlertTriangle size={11} style={{ flexShrink: 0 }} /> : <Clock size={11} style={{ flexShrink: 0 }} />}
          {overdue ? `überfällig seit ${formatDue(task.due_at)}` : `fällig ${formatDue(task.due_at)}`}
        </span>
      )}

      {/* ── Vorbereiteter Text (auf 3 Zeilen gekürzt), Kopieren als Ghost-Icon-Button ── */}
      <div
        style={{
          position: "relative",
          background: "var(--surface-50)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          padding: "0.5rem 0.625rem",
        }}
      >
        <p
          style={{
            margin: 0,
            paddingRight: "1.75rem",
            fontSize: "0.75rem",
            lineHeight: 1.5,
            color: "var(--text-secondary)",
            userSelect: "text",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
          }}
        >
          {task.prepared_text}
        </p>
        <button
          type="button"
          onClick={copyText}
          aria-label={copied ? "Text kopiert" : "Text kopieren"}
          title={copied ? "Kopiert" : "Text kopieren"}
          style={{
            position: "absolute",
            top: "0.3rem",
            right: "0.3rem",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            padding: 0,
            borderRadius: "var(--radius-xs)",
            border: `1px solid ${copied ? "var(--color-success-border)" : "transparent"}`,
            background: copied ? "var(--color-success-bg)" : "transparent",
            color: copied ? "var(--color-success-text)" : "var(--text-muted)",
            cursor: "pointer",
            transition: "all 0.1s",
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>

      {/* ── Aktionen je Kanal ── */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap", marginTop: "auto" }}>
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
                padding: "0.3rem 0.625rem",
                borderRadius: "var(--radius-sm)",
                border: "none",
                background: "var(--btn-primary-bg)",
                color: "var(--btn-primary-fg)",
                fontSize: "0.6875rem",
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

        {task.source === "setting" && (
          <Link href={`/setting/${task.entity_id}`} style={linkBtnStyle}>
            <ClipboardCheck size={12} /> Zum Setting
          </Link>
        )}

        {task.source === "closing" && (
          <Link href={`/closing/${task.entity_id}`} style={linkBtnStyle}>
            <Handshake size={12} /> Zum Closing
          </Link>
        )}

        {error && (
          <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--color-error-text)" }}>{error}</span>
        )}
      </div>
    </div>
  );
}

/** Kompaktes Karten-Grid: so viele 300px-Karten pro Zeile wie Platz ist. */
function CardGrid({ tasks }: { tasks: NachfassenTask[] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        gap: "0.75rem",
      }}
    >
      {tasks.map((t) => (
        <TaskCard key={`${t.source}-${t.entity_id}`} task={t} />
      ))}
    </div>
  );
}

type Section = { key: string; label: string; tasks: NachfassenTask[] };

/* ── Optik je Sektion: getönte Icon-Kachel + Badge-Ton ── */
const SECTION_META: Record<
  string,
  { icon: React.ReactNode; bg: string; color: string; tone: BadgeTone }
> = {
  "fu-1": { icon: <AtSign size={12} />, bg: "var(--brand-50)", color: "var(--brand-600)", tone: "brand" },
  "fu-2": { icon: <AtSign size={12} />, bg: "var(--color-info-bg)", color: "var(--color-info-text)", tone: "info" },
  "fu-3": { icon: <AtSign size={12} />, bg: "var(--color-warning-bg)", color: "var(--color-warning-text)", tone: "warning" },
  "fu-weitere": { icon: <AtSign size={12} />, bg: "var(--surface-150)", color: "var(--text-muted)", tone: "neutral" },
  telefon: { icon: <Phone size={12} />, bg: "var(--brand-50)", color: "var(--brand-600)", tone: "brand" },
  setting: { icon: <ClipboardCheck size={12} />, bg: "var(--brand-50)", color: "var(--brand-600)", tone: "brand" },
  closing: { icon: <Handshake size={12} />, bg: "var(--color-success-bg)", color: "var(--color-success-text)", tone: "success" },
};

/* ── Einklappbare Sektion: Header (Chevron + Kachel + Titel + Badge + Divider + Meta) ── */
function CollapsibleSection({
  section,
  collapsed,
  onToggle,
}: {
  section: Section;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const meta = SECTION_META[section.key] ?? SECTION_META["fu-weitere"];
  const earliestDue = section.tasks.find((t) => t.due_at)?.due_at ?? null;
  const gridId = `nf-sec-${section.key}`;

  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls={gridId}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          width: "100%",
          margin: 0,
          marginBottom: collapsed ? 0 : "0.625rem",
          padding: "0.25rem 0",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <ChevronDown
          size={14}
          style={{
            flexShrink: 0,
            color: "var(--text-muted)",
            transform: collapsed ? "rotate(-90deg)" : "none",
            transition: "transform 0.15s ease",
          }}
        />
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 20,
            height: 20,
            flexShrink: 0,
            borderRadius: "var(--radius-xs)",
            background: meta.bg,
            color: meta.color,
          }}
        >
          {meta.icon}
        </span>
        <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap" }}>
          {section.label}
        </span>
        <Badge tone={meta.tone} style={{ fontSize: "0.6875rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {section.tasks.length}
        </Badge>
        <span aria-hidden style={{ flex: 1, height: 1, background: "var(--border)" }} />
        {earliestDue && (
          <span
            style={{
              fontSize: "0.6875rem",
              fontWeight: 600,
              color: "var(--text-subtle)",
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            Früheste: {formatDueShort(earliestDue)}
          </span>
        )}
      </button>
      {!collapsed && (
        <div id={gridId}>
          <CardGrid tasks={section.tasks} />
        </div>
      )}
    </section>
  );
}

export function NachfassenBoard({ tasks, hiddenOlder, showingAll }: Props) {
  const [filter, setFilter] = useState<ChannelFilter>("alle");
  // FU-Schnellauswahl: null = alle FU-Stufen, 1–3 = nur diese Sektion anzeigen
  const [fuFilter, setFuFilter] = useState<number | null>(null);
  // Eingeklappte Sektionen (Standard: alle offen)
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});

  const toggleSection = (key: string) => setCollapsedMap((prev) => ({ ...prev, [key]: !prev[key] }));

  // Überfällige zuerst, danach aufsteigend nach Fälligkeit
  const sorted = useMemo(() => [...tasks].sort((a, b) => dueSortKey(a) - dueSortKey(b)), [tasks]);

  const counts = useMemo(() => {
    const c: Record<ChannelFilter, number> = { alle: tasks.length, linkedin: 0, telefon: 0, setting: 0, closing: 0 };
    for (const t of tasks) c[t.source] += 1;
    return c;
  }, [tasks]);

  const overdueCount = useMemo(
    () => tasks.reduce((n, t) => (t.due_at && isOverdue(t.due_at) ? n + 1 : n), 0),
    [tasks],
  );

  // Anzahl LinkedIn-Tasks je FU-Stufe (für die Schnellauswahl-Pills)
  const fuCounts = useMemo(() => {
    const c: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
    for (const t of tasks) {
      if (t.source === "linkedin" && t.next_fu_number != null && c[t.next_fu_number] !== undefined) {
        c[t.next_fu_number] += 1;
      }
    }
    return c;
  }, [tasks]);

  // Sektionen: LinkedIn nach FU-Stufe gruppiert, danach Rückrufe und Closing.
  // Aktive FU-Schnellauswahl blendet alle anderen Sektionen komplett aus.
  // Leere Sektionen werden nicht gerendert.
  const sections = useMemo<Section[]>(() => {
    const s: Section[] = [];
    if (filter === "alle" || filter === "linkedin") {
      const linkedin = sorted.filter((t) => t.source === "linkedin");
      for (const fu of [1, 2, 3]) {
        if (fuFilter != null && fuFilter !== fu) continue;
        const group = linkedin.filter((t) => t.next_fu_number === fu);
        if (group.length > 0) s.push({ key: `fu-${fu}`, label: `Follow-up ${fu}`, tasks: group });
      }
      if (fuFilter == null) {
        const rest = linkedin.filter((t) => t.next_fu_number == null || t.next_fu_number < 1 || t.next_fu_number > 3);
        if (rest.length > 0) s.push({ key: "fu-weitere", label: "Weitere Follow-ups", tasks: rest });
      }
    }
    if (fuFilter == null && (filter === "alle" || filter === "telefon")) {
      const group = sorted.filter((t) => t.source === "telefon");
      if (group.length > 0) s.push({ key: "telefon", label: "Rückrufe", tasks: group });
    }
    if (fuFilter == null && (filter === "alle" || filter === "setting")) {
      const group = sorted.filter((t) => t.source === "setting");
      if (group.length > 0) s.push({ key: "setting", label: "Setting (No-Show & Unqualifiziert)", tasks: group });
    }
    if (fuFilter == null && (filter === "alle" || filter === "closing")) {
      const group = sorted.filter((t) => t.source === "closing");
      if (group.length > 0) s.push({ key: "closing", label: "Closing", tasks: group });
    }
    return s;
  }, [sorted, filter, fuFilter]);

  const showFuPills = counts.linkedin > 0 && (filter === "alle" || filter === "linkedin");

  return (
    <div>
      {/* ── Summary-Strip: kompakte Kennzahlen aus den Tasks ── */}
      <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        <StatChip icon={<CalendarClock size={12} />} label="Fällig gesamt" value={counts.alle} />
        <StatChip icon={<AlertTriangle size={12} />} label="Überfällig" value={overdueCount} danger />
        <StatChip icon={<AtSign size={12} />} label="Follow-ups" value={counts.linkedin} />
        <StatChip icon={<Phone size={12} />} label="Rückrufe" value={counts.telefon} />
        <StatChip icon={<ClipboardCheck size={12} />} label="Setting" value={counts.setting} />
      </div>

      {/* ── Kanal-Filter ── */}
      <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
        {FILTERS.map((f) => {
          const active = filter === f.value;
          const meta = f.value !== "alle" ? CHANNEL_META[f.value] : null;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => {
                setFilter(f.value);
                setFuFilter(null);
              }}
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

      {/* ── FU-Schnellauswahl: nur die gewählte FU-Sektion anzeigen ── */}
      {showFuPills && (
        <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
          {[null, 1, 2, 3]
            .filter((fu) => fu === null || fuCounts[fu] > 0)
            .map((fu) => {
              const active = fuFilter === fu;
              return (
                <button
                  key={fu ?? "alle-fu"}
                  type="button"
                  onClick={() => setFuFilter(fu)}
                  aria-pressed={active}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "0.25rem 0.6rem",
                    borderRadius: 99,
                    border: `1px solid ${active ? "var(--btn-primary-bg)" : "var(--border)"}`,
                    background: active ? "var(--btn-primary-bg)" : "var(--surface-50)",
                    color: active ? "var(--btn-primary-fg)" : "var(--text-muted)",
                    fontSize: "0.6875rem",
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    cursor: "pointer",
                    transition: "all 0.1s",
                  }}
                >
                  {fu === null ? "Alle FU" : `FU ${fu} (${fuCounts[fu]})`}
                </button>
              );
            })}
        </div>
      )}

      {/* ── Hinweis: ältere Leads (Pitch > 7 Tage) ── */}
      {showingAll ? (
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap", fontSize: "0.75rem", color: "var(--text-subtle)", marginBottom: "1rem" }}>
          <History size={12} style={{ flexShrink: 0 }} />
          <span>Alle Leads werden angezeigt</span>
          <Link href="?" style={{ color: "var(--brand-500)", fontWeight: 700, textDecoration: "none" }}>
            Nur letzte 7 Tage
          </Link>
        </div>
      ) : hiddenOlder > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap", fontSize: "0.75rem", color: "var(--text-subtle)", marginBottom: "1rem" }}>
          <History size={12} style={{ flexShrink: 0 }} />
          <span>
            {hiddenOlder} {hiddenOlder === 1 ? "älterer Lead" : "ältere Leads"} (Pitch &gt; 7 Tage) ausgeblendet
          </span>
          <Link href="?alle=1" style={{ color: "var(--brand-500)", fontWeight: 700, textDecoration: "none" }}>
            Ältere anzeigen
          </Link>
        </div>
      ) : (
        <div style={{ marginBottom: "1rem" }} />
      )}

      {/* ── Sektionen / Leerzustand ── */}
      {sections.length === 0 ? (
        <div
          className="fade-up"
          style={{
            background: "var(--surface-100)",
            border: "1px dashed var(--border-bright)",
            borderRadius: "var(--radius-lg)",
            padding: "3rem 1.5rem",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 40,
              height: 40,
              borderRadius: "var(--radius-md)",
              background: "var(--color-success-bg)",
              border: "1px solid var(--color-success-border)",
              color: "var(--color-success-text)",
              marginBottom: "0.75rem",
            }}
          >
            <CheckCircle2 size={20} />
          </span>
          <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.25rem" }}>
            Keine fälligen Nachfass-Aufgaben
          </div>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", margin: 0 }}>
            Sobald LinkedIn-Follow-ups, Telefon-Rückrufe oder Closing-Nachfassen fällig werden, erscheinen sie hier.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {sections.map((section, i) => (
            <div key={section.key} className="fade-up" style={{ animationDelay: `${i * 60}ms` }}>
              <CollapsibleSection
                section={section}
                collapsed={!!collapsedMap[section.key]}
                onToggle={() => toggleSection(section.key)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
