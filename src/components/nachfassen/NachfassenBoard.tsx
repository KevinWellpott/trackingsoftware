"use client";

import { advanceLinkedInFollowUp, markLinkedInAnswered, type NachfassenTask } from "@/app/actions/nachfassen";
import { excludeFromRecycle, markRecycleContacted, markRecycleResponded } from "@/app/actions/recycle";
import { RECYCLE_REASON_LABELS } from "@/lib/recycleCadence";
import { TEMPLATE_SOURCE_LABELS } from "@/lib/messageTemplates";
import { contactAgeDays, lastContactLabel } from "@/lib/contactGap";
import { isOverdue, type DueGranularity } from "@/lib/dueState";
import type { DossierEntityKind } from "@/lib/leadDossier";
import { LeadDossierSheet } from "@/components/lead/LeadDossierSheet";
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
  Database,
  Handshake,
  History,
  Phone,
  RefreshCw,
  Users,
  UserX,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

// Nachfassen-Board (Client): Union-Tasklist aus fünf Quellen — LinkedIn-Follow-up,
// Telefon-Rückruf, Erstgespräch-Wiedervorlage, Closing-Wiedervorlage und
// Recycling. Kernwert: fertiger Text zum Kopieren — KEIN Auto-Versand.
// Layout: Summary-Chips → Kanal-Tabs → FU-Schnellauswahl → einklappbare Sektionen
// mit kompaktem Karten-Grid.
//
// Die Texte kommen aus dem Vorlagen-Katalog und tragen ihre Herkunft als Badge
// (Liste / persönlich / Organisation / Auslieferung) — eine wirkende Vorlage
// kann damit nicht mehr unsichtbar sein.

type Props = {
  tasks: NachfassenTask[];
  /** Anzahl ausgeblendeter älterer LinkedIn-Leads (Pitch > 7 Tage). */
  hiddenOlder: number;
  /** true, wenn ?alle=1 aktiv ist und auch ältere Leads geladen wurden. */
  showingAll: boolean;
  /** false = Recycling-Schema fehlt (Migration 0033). NICHT „nichts fällig". */
  recyclingAvailable: boolean;
};

type ChannelFilter = "alle" | NachfassenTask["source"];

// Kanalfarben kommen aus der Pipeline-Palette (DESIGN.md §3.6) und nicht aus
// den Semantik-Tokens: ein Kanal ist eine Kategorie, kein Status. Sie
// erscheinen ausschliesslich als Dot/Icon + Tint, nie als Flaechenfarbe.
const CHANNEL_META: Record<
  NachfassenTask["source"],
  { label: string; icon: React.ReactNode; color: string; bg: string; border: string }
> = {
  linkedin: {
    label: "LinkedIn",
    icon: <AtSign size={11} />,
    color: "var(--stage-linkedin)",
    bg: "rgb(13 148 136 / 0.10)",
    border: "rgb(13 148 136 / 0.28)",
  },
  telefon: {
    label: "Telefon",
    icon: <Phone size={11} />,
    color: "var(--stage-telefon)",
    bg: "rgb(78 128 214 / 0.10)",
    border: "rgb(78 128 214 / 0.28)",
  },
  setting: {
    label: "Setting",
    icon: <ClipboardCheck size={11} />,
    color: "var(--stage-setting)",
    bg: "rgb(139 92 246 / 0.10)",
    border: "rgb(139 92 246 / 0.28)",
  },
  closing: {
    label: "Closing",
    icon: <Handshake size={11} />,
    color: "var(--stage-closing)",
    bg: "rgb(63 163 111 / 0.10)",
    border: "rgb(63 163 111 / 0.28)",
  },
  // Recycling ist kein Kanal wie die anderen vier — es sammelt terminal
  // negative Leads aus ALLEN vier Ursprüngen (§ Konzept-Diskussion, Migration
  // 0032). Eigene, bewusst neutrale Farbe statt einer der vier Kanalfarben,
  // damit die Karte nicht wie ein fünfter Akquise-Kanal aussieht.
  recycling: {
    label: "Recycling",
    icon: <RefreshCw size={11} />,
    color: "var(--text-muted)",
    bg: "var(--surface-3)",
    border: "var(--border-default)",
  },
};

const FILTERS: { value: ChannelFilter; label: string }[] = [
  { value: "alle", label: "Alle" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "telefon", label: "Telefon" },
  { value: "setting", label: "Setting" },
  { value: "closing", label: "Closing" },
  { value: "recycling", label: "Recycling" },
];

/** Kompaktes Datum für den Kontaktfrequenz-Hinweis: "07.09., 14:30". */
function formatContactMoment(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(d);
}

/**
 * Zeitkörnung je Quelle. Vier der fünf sind Tages-Aufgaben; nur der
 * Telefon-Rückruf trägt eine mit dem Lead VERABREDETE Uhrzeit (`callback_at`).
 *
 * Das steht hier und nicht am Datentyp, weil `nachfassen_tasks` die
 * Tages-Spalten nach `timestamptz` castet: Aus dem 06.09. wird Mitternacht
 * UTC, in Berlin 02:00. Nach dem Datentyp gelesen wäre jedes Follow-up ab
 * zwei Uhr morgens „überfällig" — und weil die RPC nur Fälliges liefert,
 * schlicht alles (lib/dueState.ts).
 */
const DUE_GRANULARITY: Record<NachfassenTask["source"], DueGranularity> = {
  linkedin: "day",
  telefon: "moment",
  setting: "day",
  closing: "day",
  recycling: "day",
};

/** Fällig-Zeitpunkt de-DE (Europe/Berlin). Tages-Aufgaben ohne Uhrzeit. */
function formatDue(iso: string, granularity: DueGranularity): string {
  // Eine Uhrzeit, die niemand verabredet hat, ist keine Angabe, sondern eine
  // Behauptung — bei Tages-Aufgaben stünde dort immer „02:00 Uhr".
  const dateOnly = granularity === "day" || !iso.includes("T");
  const d = new Date(iso.includes("T") ? iso : `${iso}T00:00:00`);
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

function dueSortKey(t: NachfassenTask): number {
  if (!t.due_at) return Number.MAX_SAFE_INTEGER;
  const d = new Date(t.due_at.includes("T") ? t.due_at : `${t.due_at}T00:00:00`);
  return Number.isNaN(d.getTime()) ? Number.MAX_SAFE_INTEGER : d.getTime();
}

/**
 * Welche Akte gehört zu dieser Aufgabe?
 *
 * Die fünf Quellen tragen in `entity_id` je eine andere Tabelle. Beim Recycling
 * steht die Tabelle nicht in `source` (das sagt nur „Recycling"), sondern in
 * `recycle_origin` — dieselbe Fallunterscheidung, die auch die Aktionsknöpfe
 * darunter treffen.
 */
function dossierTargetOf(task: NachfassenTask): DossierEntityKind | null {
  const origin = task.source === "recycling" ? task.recycle_origin : task.source;
  if (origin === "linkedin") return "contact";
  if (origin === "telefon") return "phone_lead";
  if (origin === "setting") return "setting";
  if (origin === "closing") return "closing";
  return null;
}

const linkBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--sp-3)",
  height: 28,
  padding: "0 var(--sp-5)",
  borderRadius: "var(--r-sm)",
  border: "1px solid var(--border-default)",
  background: "var(--surface-1)",
  color: "var(--text-secondary)",
  fontSize: "var(--fs-sm)",
  fontWeight: 500,
  textDecoration: "none",
  cursor: "pointer",
  transition: "background var(--transition-fast), border-color var(--transition-fast)",
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
        gap: "var(--sp-4)",
        height: 30,
        padding: "0 var(--sp-6)",
        background: hot ? "var(--warning-bg)" : "var(--surface-2)",
        border: `1px solid ${hot ? "rgb(209 162 79 / 0.28)" : "var(--border-default)"}`,
        borderRadius: "var(--r-full)",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          color: hot ? "var(--warning-fg)" : "var(--text-muted)",
        }}
      >
        {icon}
      </span>
      <span style={{ fontSize: "var(--fs-xs)", fontWeight: 500, color: hot ? "var(--warning-fg)" : "var(--text-muted)" }}>
        {label}
      </span>
      <span
        style={{
          fontSize: "var(--fs-base)",
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          color: hot ? "var(--warning-fg)" : "var(--text-primary)",
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
  const [dossierOpen, setDossierOpen] = useState(false);

  const meta = CHANNEL_META[task.source];
  const granularity = DUE_GRANULARITY[task.source];
  const overdue = isOverdue(task.due_at, granularity);
  const dossierKind = dossierTargetOf(task);

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

  // Gemeinsamer Runner für alle "Klick löst Server-Action aus, Karte
  // verschwindet danach"-Buttons (LinkedIn UND Recycling).
  const runAction = (promise: Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await promise;
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
                fontWeight: 600,
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
              fontWeight: 600,
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
          {/* Grund + Versuchszähler — nur bei Recycling: der Kanal-Badge sagt
              hier nur "Recycling", nicht mehr WARUM der Lead hier gelandet ist. */}
          {task.source === "recycling" && (
            <span
              style={{
                fontSize: "0.625rem",
                fontWeight: 600,
                color: "var(--text-muted)",
                background: "var(--surface-150)",
                border: "1px solid var(--border)",
                borderRadius: 99,
                padding: "0.1rem 0.4rem",
              }}
            >
              {(task.recycle_reason && RECYCLE_REASON_LABELS[task.recycle_reason]) || "Unbekannt"}
              {typeof task.recycle_attempt === "number" && task.recycle_attempt > 0
                ? ` · Versuch ${task.recycle_attempt + 1}`
                : ""}
            </span>
          )}
        </div>
      </div>

      {/* ── Fälligkeit + Herkunft des Textes ── */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap" }}>
        {task.due_at && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
              fontSize: "0.6875rem",
              fontWeight: 600,
              color: overdue ? "var(--color-error-text)" : "var(--text-secondary)",
            }}
          >
            {overdue ? (
              <AlertTriangle size={11} style={{ flexShrink: 0 }} />
            ) : (
              <Clock size={11} style={{ flexShrink: 0 }} />
            )}
            {overdue
              ? `überfällig seit ${formatDue(task.due_at, granularity)}`
              : `fällig ${formatDue(task.due_at, granularity)}`}
          </span>
        )}
        <Badge
          tone="neutral"
          style={{ marginLeft: "auto", height: 18, fontSize: "var(--fs-2xs)" }}
          title="Herkunft des Textes"
        >
          {TEMPLATE_SOURCE_LABELS[task.text_source]}
        </Badge>
      </div>

      {/* ── Weiche Kontaktfrequenz-Warnung (Entscheidung K3) ──────────────
          Hinweis, keine Sperre: die Aufgabe bleibt vollständig bedienbar.
          Der Abstand steht als ZAHL da und nicht als „kürzlich": Ob man
          trotzdem schreibt, entscheidet sich an „vorgestern" anders als an
          „heute früh" — dieselbe Beschriftung wie im Dossier
          (lastContactLabel), damit beide Seiten dieselbe Zahl gleich nennen.
          Was die Karte sieht, ist dabei WENIGER als das Dossier (nur erledigte
          Erinnerungen und Recycling-Versuche); der Verweis daneben führt zur
          vollständigen Akte.                                               */}
      {task.recent_contact_at && (
        <span
          title="Aus den erledigten Erinnerungen und Recycling-Versuchen dieser Organisation. Pitches, Anwahlen und geführte Termine stehen im Dossier — dort kann der letzte Kontakt jünger sein."
          style={{
            display: "inline-flex",
            alignItems: "flex-start",
            gap: "0.3rem",
            fontSize: "0.6875rem",
            fontWeight: 500,
            color: "var(--warning-fg)",
          }}
        >
          <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 2 }} />
          Zuletzt kontaktiert {lastContactLabel(contactAgeDays(task.recent_contact_at))} (
          {formatContactMoment(task.recent_contact_at)}) — bewusst kein Stopp, nur ein Hinweis.
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
              onClick={() => runAction(advanceLinkedInFollowUp(task.entity_id))}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.3rem",
                padding: "0.3rem 0.625rem",
                borderRadius: "var(--r-full)",
                border: "none",
                background: "var(--grad-cta)",
                color: "var(--text-on-accent)",
                boxShadow: "var(--shadow-btn-primary)",
                fontSize: "0.6875rem",
                fontWeight: 600,
                cursor: isPending ? "default" : "pointer",
                transition: "all 0.1s",
              }}
            >
              <CheckCheck size={12} /> Erledigt → nächste Stufe
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => runAction(markLinkedInAnswered(task.entity_id))}
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
                style={{ ...linkBtnStyle, color: "var(--orange-300)", borderColor: "var(--border-accent)", background: "var(--accent-muted)" }}
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

        {task.source === "recycling" && task.recycle_origin && (
          <>
            {task.recycle_origin === "linkedin" && task.list_id && (
              <Link href={`/lists/${task.list_id}`} style={linkBtnStyle}>
                Zur Liste <ArrowUpRight size={12} />
              </Link>
            )}
            {task.recycle_origin === "telefon" && task.list_id && (
              <Link href={`/telefon/${task.list_id}`} style={linkBtnStyle}>
                <Phone size={12} /> Zum Call-Mode
              </Link>
            )}
            {task.recycle_origin === "setting" && (
              <Link href={`/setting/${task.entity_id}`} style={linkBtnStyle}>
                <ClipboardCheck size={12} /> Zum Setting
              </Link>
            )}
            {task.recycle_origin === "closing" && (
              <Link href={`/closing/${task.entity_id}`} style={linkBtnStyle}>
                <Handshake size={12} /> Zum Closing
              </Link>
            )}
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                // Der Grund kommt seit Migration 0033 aus der Ursprungszeile,
                // nicht mehr vom Client — sonst liesse sich per direktem POST
                // jede beliebige Wartezeit ausloesen (actions/recycle.ts).
                runAction(markRecycleContacted(task.recycle_origin!, task.entity_id))
              }
              style={{
                ...linkBtnStyle,
                cursor: isPending ? "default" : "pointer",
              }}
              title="Kontaktiert, noch kein Ergebnis — nächster Versuch nach Kadenz"
            >
              <RefreshCw size={12} /> Nochmal versucht
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => runAction(markRecycleResponded(task.recycle_origin!, task.entity_id))}
              style={{
                ...linkBtnStyle,
                color: "var(--color-success-text)",
                background: "var(--color-success-bg)",
                borderColor: "var(--color-success-border)",
                cursor: isPending ? "default" : "pointer",
              }}
              title="Lead ist wieder im Spiel — Recycling stoppen"
            >
              <Check size={12} /> Reagiert
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => runAction(excludeFromRecycle(task.recycle_origin!, task.entity_id))}
              style={{
                ...linkBtnStyle,
                color: "var(--text-muted)",
                cursor: isPending ? "default" : "pointer",
              }}
              title="Dauerhaft ausschließen — kein weiterer Recycling-Versuch"
            >
              <UserX size={12} /> Endgültig raus
            </button>
          </>
        )}

        {/* Gesprächsvorbereitung, deshalb VOR dem Anruf und ohne die
            Arbeitsliste zu verlassen: das Dossier öffnet als Overlay und lädt
            erst beim Öffnen (acht Abfragen je Karte im Voraus wären der Preis
            für etwas, das man je Sitzung einmal liest). Neben den
            Sprung-Knöpfen, weil es dieselbe Frage beantwortet — wo komme ich
            an diesen Lead heran —, nur ohne wegzunavigieren. */}
        {dossierKind && (
          <button
            type="button"
            onClick={() => setDossierOpen(true)}
            style={{ ...linkBtnStyle, cursor: "pointer" }}
            title="Alles zu diesem Lead — Verlauf, Kanäle, Notizen"
          >
            <Users size={12} /> Dossier
          </button>
        )}

        {error && (
          <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--color-error-text)" }}>{error}</span>
        )}
      </div>

      {dossierKind && (
        <LeadDossierSheet
          open={dossierOpen}
          onClose={() => setDossierOpen(false)}
          kind={dossierKind}
          id={task.entity_id}
        />
      )}
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

/* ── Optik je Sektion ──────────────────────────────────────────────────
   Die Icon-Kachel traegt die KANAL-Farbe (Identitaet), der Badge-Ton die
   DRINGLICHKEIT. Vorher war beides Orange — vier Sektionen im Akzent haben
   das Budget der ganzen Seite aufgebraucht. FU3 ist die letzte Stufe der
   Kadenz und deshalb der einzige FU-Abschnitt in Warning-Gold.            */
const SECTION_META: Record<
  string,
  { icon: React.ReactNode; bg: string; color: string; tone: BadgeTone }
> = {
  "fu-1": { icon: <AtSign size={12} />, bg: "rgb(13 148 136 / 0.10)", color: "var(--stage-linkedin)", tone: "neutral" },
  "fu-2": { icon: <AtSign size={12} />, bg: "rgb(13 148 136 / 0.10)", color: "var(--stage-linkedin)", tone: "neutral" },
  "fu-3": { icon: <AtSign size={12} />, bg: "var(--warning-bg)", color: "var(--warning-fg)", tone: "warning" },
  "fu-weitere": { icon: <AtSign size={12} />, bg: "var(--surface-3)", color: "var(--text-muted)", tone: "neutral" },
  telefon: { icon: <Phone size={12} />, bg: "rgb(78 128 214 / 0.10)", color: "var(--stage-telefon)", tone: "info" },
  setting: { icon: <ClipboardCheck size={12} />, bg: "rgb(139 92 246 / 0.10)", color: "var(--stage-setting)", tone: "neutral" },
  closing: { icon: <Handshake size={12} />, bg: "var(--success-bg)", color: "var(--success-fg)", tone: "success" },
  recycling: { icon: <RefreshCw size={12} />, bg: "var(--surface-3)", color: "var(--text-muted)", tone: "neutral" },
};

/**
 * Die Sektionen, deren Vorgänge zusätzlich in /erinnerungen stehen — und was
 * dort konkret liegt. Nur diese beiden: LinkedIn-Follow-ups, Telefon-Rückrufe
 * und Recycling erzeugen keine Kaskade (das Recycling eines verlorenen
 * Closings folgt Wochen NACH dessen „Kein Abschluss"-Kette; ein Verweis
 * zeigte dort auf lauter erledigte Stufen).
 */
const SECTION_CROSSLINK: Record<string, string | undefined> = {
  closing: "Stundengenaue Bestätigungs-Erinnerungen zu diesen Kontakten",
  setting: "No-Show-Kette zu den nicht erschienenen Terminen",
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
        <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap" }}>
          {section.label}
        </span>
        <Badge tone={meta.tone} style={{ fontSize: "0.6875rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
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
      {/* Ueberschneidung mit /erinnerungen — Hinweis statt Duplizierung der
          Logik: WELCHE Karte konkret eine offene Kaskade hat, weiss nur
          /erinnerungen. Seit dem Nachfassen-Umbau sind es ZWEI Stellen, nicht
          mehr die eine aus docs §1:
           · Closing im Status 'nachfassen' → bis zu 3 stundengenaue
             Bestaetigungs-Touches vor dem vereinbarten Kontakt.
           · Setting im Status 'no_show' → die No-Show-Kette
             (setSettingOutcome → createNoShowTouch). Die Sektion traegt
             daneben die Unqualifizierten, die dort NICHTS haben — deshalb
             steht der Verweis an der Sektion und nicht auf jeder Karte: die
             RPC liefert den Status nicht mit. */}
      {!collapsed && SECTION_CROSSLINK[section.key] && (
        <div style={{ margin: "0 0 0.625rem 1.75rem" }}>
          <Link
            href="/erinnerungen"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.6875rem", color: "var(--orange-300)", textDecoration: "none" }}
          >
            <Clock size={11} /> {SECTION_CROSSLINK[section.key]} → Erinnerungen
          </Link>
        </div>
      )}
      {!collapsed && (
        <div id={gridId}>
          <CardGrid tasks={section.tasks} />
        </div>
      )}
    </section>
  );
}

/* ── Fehlendes Schema: NICHT der grüne Leerzustand ────────────────────
   Anders als auf /erinnerungen und in /ablage fällt hier nicht die ganze
   Seite aus — vier der fünf Quellen hängen an einer älteren Migration und
   arbeiten weiter. Der Hinweis steht deshalb neben den Aufgaben und sagt
   ausdrücklich, WELCHER Teil fehlt.                                      */
function RecyclingUnavailable() {
  return (
    <div
      className="card"
      style={{
        padding: "var(--sp-6) var(--sp-7)",
        marginBottom: "var(--sp-6)",
        display: "flex",
        gap: "var(--sp-5)",
        alignItems: "flex-start",
        background: "var(--danger-bg)",
        borderColor: "rgb(214 90 82 / 0.28)",
      }}
    >
      <Database size={18} style={{ flexShrink: 0, marginTop: 2, color: "var(--danger-fg)" }} />
      <div>
        <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: "var(--danger-fg)" }}>
          Recycling ist nicht verfügbar
        </div>
        <p style={{ margin: "var(--sp-3) 0 0", fontSize: "var(--fs-sm)", color: "var(--text-secondary)", maxWidth: "62ch" }}>
          Die Funktion <code>recycle_tasks</code> fehlt in der Datenbank — die Migration ist noch nicht eingespielt.
          Das ist ausdrücklich <strong>nicht</strong> dasselbe wie &bdquo;kein Lead ist wieder dran&ldquo;: Verlorene
          Closings und tote Leads werden gerade gar nicht wiedervorgelegt. Die vier übrigen Quellen unten sind davon
          nicht betroffen. Ein Administrator spielt die Migration im Supabase-SQL-Editor ein.
        </p>
      </div>
    </div>
  );
}

export function NachfassenBoard({ tasks, hiddenOlder, showingAll, recyclingAvailable }: Props) {
  const [filter, setFilter] = useState<ChannelFilter>("alle");
  // FU-Schnellauswahl: null = alle FU-Stufen, 1–3 = nur diese Sektion anzeigen
  const [fuFilter, setFuFilter] = useState<number | null>(null);
  // Eingeklappte Sektionen (Standard: alle offen)
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});

  const toggleSection = (key: string) => setCollapsedMap((prev) => ({ ...prev, [key]: !prev[key] }));

  // Überfällige zuerst, danach aufsteigend nach Fälligkeit
  const sorted = useMemo(() => [...tasks].sort((a, b) => dueSortKey(a) - dueSortKey(b)), [tasks]);

  const counts = useMemo(() => {
    const c: Record<ChannelFilter, number> = {
      alle: tasks.length,
      linkedin: 0,
      telefon: 0,
      setting: 0,
      closing: 0,
      recycling: 0,
    };
    for (const t of tasks) c[t.source] += 1;
    return c;
  }, [tasks]);

  const overdueCount = useMemo(
    () => tasks.reduce((n, t) => (isOverdue(t.due_at, DUE_GRANULARITY[t.source]) ? n + 1 : n), 0),
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
    // EINE Recycling-Sektion für alle vier Ursprünge (§ Konzept-Diskussion) —
    // bewusst nicht nach Ursprung aufgesplittet, die Origin-Badge auf der
    // Karte zeigt das je Zeile.
    if (fuFilter == null && (filter === "alle" || filter === "recycling")) {
      const group = sorted.filter((t) => t.source === "recycling");
      if (group.length > 0) s.push({ key: "recycling", label: "Recycling", tasks: group });
    }
    return s;
  }, [sorted, filter, fuFilter]);

  const showFuPills = counts.linkedin > 0 && (filter === "alle" || filter === "linkedin");

  // Ein Filter auf eine Quelle, die gerade gar nicht liefern KANN, führt in
  // einen Leerzustand, der wie „nichts fällig" aussieht — genau die
  // Verwechslung, die der Hinweis oben ausräumt.
  const visibleFilters = recyclingAvailable ? FILTERS : FILTERS.filter((f) => f.value !== "recycling");

  return (
    <div>
      {!recyclingAvailable && <RecyclingUnavailable />}

      {/* ── Summary-Strip: kompakte Kennzahlen aus den Tasks ── */}
      <div style={{ display: "flex", gap: "var(--sp-4)", flexWrap: "wrap", marginBottom: "var(--sp-7)" }}>
        <StatChip icon={<CalendarClock size={12} />} label="Fällig gesamt" value={counts.alle} />
        <StatChip icon={<AlertTriangle size={12} />} label="Überfällig" value={overdueCount} danger />
        <StatChip icon={<AtSign size={12} />} label="Follow-ups" value={counts.linkedin} />
        <StatChip icon={<Phone size={12} />} label="Rückrufe" value={counts.telefon} />
        <StatChip icon={<ClipboardCheck size={12} />} label="Setting" value={counts.setting} />
        {/* Ohne Schema wäre die 0 eine Behauptung über die Daten, die niemand
            geprüft hat — die Kachel entfällt, der Hinweis oben trägt die Aussage. */}
        {recyclingAvailable && <StatChip icon={<RefreshCw size={12} />} label="Recycling" value={counts.recycling} />}
      </div>

      {/* ── Kanal-Filter ── */}
      <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap", marginBottom: "var(--sp-5)" }}>
        {visibleFilters.map((f) => {
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
                gap: "var(--sp-3)",
                height: 28,
                padding: "0 var(--sp-4) 0 var(--sp-5)",
                borderRadius: "var(--r-full)",
                border: `1px solid ${active ? (meta?.border ?? "var(--border-accent)") : "var(--border-default)"}`,
                background: active ? (meta?.bg ?? "var(--accent-muted)") : "var(--surface-1)",
                color: active ? (meta?.color ?? "var(--orange-300)") : "var(--text-muted)",
                fontSize: "var(--fs-sm)",
                fontWeight: 500,
                fontFamily: "inherit",
                cursor: "pointer",
                transition: "background var(--transition-fast), border-color var(--transition-fast)",
              }}
            >
              {f.label}
              <span className="count-pill">{counts[f.value]}</span>
            </button>
          );
        })}
      </div>

      {/* ── FU-Schnellauswahl: nur die gewählte FU-Sektion anzeigen ── */}
      {showFuPills && (
        <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap", marginBottom: "var(--sp-5)" }}>
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
                    height: 26,
                    padding: "0 var(--sp-5)",
                    borderRadius: "var(--r-full)",
                    border: `1px solid ${active ? "var(--orange-500)" : "var(--border-default)"}`,
                    background: active ? "var(--orange-500)" : "var(--surface-1)",
                    color: active ? "#0a0a0b" : "var(--text-muted)",
                    fontSize: "var(--fs-xs)",
                    fontWeight: active ? 600 : 500,
                    fontFamily: "inherit",
                    fontVariantNumeric: "tabular-nums",
                    cursor: "pointer",
                    transition: "background var(--transition-fast), color var(--transition-fast)",
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
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap", fontSize: "var(--fs-xs)", color: "var(--text-muted)", marginBottom: "var(--sp-7)" }}>
          <History size={12} style={{ flexShrink: 0 }} />
          <span>Alle Leads werden angezeigt</span>
          <Link href="?" style={{ color: "var(--orange-300)", fontWeight: 500, textDecoration: "none" }}>
            Nur letzte 7 Tage
          </Link>
        </div>
      ) : hiddenOlder > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap", fontSize: "var(--fs-xs)", color: "var(--text-muted)", marginBottom: "var(--sp-7)" }}>
          <History size={12} style={{ flexShrink: 0 }} />
          <span>
            {hiddenOlder} {hiddenOlder === 1 ? "älterer Lead" : "ältere Leads"} (Pitch &gt; 7 Tage) ausgeblendet
          </span>
          <Link href="?alle=1" style={{ color: "var(--orange-300)", fontWeight: 500, textDecoration: "none" }}>
            Ältere anzeigen
          </Link>
        </div>
      ) : (
        <div style={{ marginBottom: "1rem" }} />
      )}

      {/* ── Sektionen / Leerzustand ── */}
      {sections.length === 0 ? (
        <div className="card fade-up dot-grid">
          <div className="empty-state">
            <CheckCircle2 size={24} aria-hidden style={{ color: "var(--success-fg)" }} />
            <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: "var(--text-primary)" }}>
              Alles nachgefasst
            </div>
            <p style={{ maxWidth: 380 }}>
              Sobald LinkedIn-Follow-ups, Telefon-Rückrufe, Setting-/Closing-Nachfassen oder ein Recycling-Versuch
              fällig werden, erscheinen sie hier.
            </p>
          </div>
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
