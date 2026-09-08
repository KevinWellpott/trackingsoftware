"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  setReminderTouchDone,
  type ReminderInbox,
  type ReminderTouchWithContext,
  type TouchOutcome,
} from "@/app/actions/reminders";
import { setAssignee, type AssigneeEntity } from "@/app/actions/assignees";
import {
  TEMPLATE_META,
  TEMPLATE_SOURCE_LABELS,
  renderResolved,
  type TemplateBundle,
} from "@/lib/messageTemplates";
import { CASCADE_KIND_LABELS, type CascadeKind } from "@/lib/cascadeEngine";
import type { ReminderEntityType, TouchChannel } from "@/lib/reminderCascade";
import { berlinDateISO, formatTerminParts } from "@/lib/apptTime";
import { Badge, StageBadge, type StageKey } from "@/components/ui/Badge";
import { Segmented } from "@/components/ui/Segmented";
import { Select, type SelectOption } from "@/components/ui/Select";
import { ownerColor } from "@/lib/ownerColor";
import {
  AlertTriangle,
  ArrowUpRight,
  AtSign,
  Check,
  CheckCheck,
  CheckCircle2,
  Circle,
  Clock,
  Copy,
  Database,
  MessageCircle,
  Phone,
  Undo2,
  UserCog,
} from "lucide-react";

// "Meine Erinnerungen" — eine Karte je TERMIN, nicht je Kaskadenstufe.
//
// Der Auftraggeber hat entschieden, dass die Kaskade NICHT abbricht, wenn ein
// Lead antwortet: Stufe 3 ("wollte dir noch den Link durchschicken") gilt auch
// nach einer Zusage. Damit entsteht ein reines MENGENPROBLEM — drei Termine mit
// je drei Stufen standen hier vorher als neun Karten. Gelöst wird es
// ausschließlich in der Darstellung:
//
//   · eine Karte je Termin, die Stufen als Zeitleiste darin,
//   · erledigte Stufen eingeklappt (mit Zeitpunkt und Person),
//   · genau EINE Stufe aufgeklappt: die nächste offene, mit fertigem Text,
//   · künftige Stufen als ruhige Zeile mit ihrer Fälligkeit,
//   · eine Sammelaktion, die die ganze Kaskade in einem Rutsch abhakt.
//
// KEIN Auto-Versand: die Karte liefert den fertigen Text zum Kopieren, ein
// Mensch schreibt und schickt — wie im Nachfassen-Board.

/* ------------------------------------------------------------------ *
 * Konstanten & Beschriftungen
 * ------------------------------------------------------------------ */

/**
 * Weiche Warnung, wenn derselbe Lead vor weniger als so vielen Tagen schon
 * kontaktiert wurde. Bewusst eine Code-Konstante und KEINE Organisations-
 * einstellung: eine konfigurierbare Sperre verschöbe Fälligkeiten und
 * kollidierte mit "Erinnerung 3, eine Stunde vorher".
 *
 * Die Vor-Termin-Kaskade (`touch_kind === 'cascade'`) ist ausgenommen — drei
 * Kontakte in drei Tagen sind dort gewollt und die Warnung wäre nur Rauschen.
 */
const CONTACT_GAP_WARN_DAYS = 3;

const CHANNEL_META: Record<TouchChannel, { label: string; icon: React.ReactNode }> = {
  linkedin: { label: "LinkedIn", icon: <AtSign size={11} /> },
  telefon: { label: "Anruf", icon: <Phone size={11} /> },
  whatsapp: { label: "WhatsApp", icon: <MessageCircle size={11} /> },
};

const ENTITY_META: Record<
  ReminderEntityType,
  { label: string; stage: StageKey; assignee: AssigneeEntity; href: (id: string) => string; linkLabel: string }
> = {
  setting: {
    label: "Erstgespräch",
    stage: "setting",
    assignee: "setting_call",
    href: (id) => `/setting/${id}`,
    linkLabel: "Zum Setting",
  },
  closing: {
    label: "Closing",
    stage: "closing",
    assignee: "closing_call",
    href: (id) => `/closing/${id}`,
    linkLabel: "Zum Closing",
  },
  // Der vereinbarte Nachfass-Kontakt ist ein eigener "Termin" mit eigener
  // Kaskade, hängt aber an derselben Closing-Zeile — daher dieselbe Route.
  closing_followup: {
    label: "Nachfass-Kontakt",
    stage: "nachfassen",
    assignee: "closing_call",
    href: (id) => `/closing/${id}`,
    linkLabel: "Zum Closing",
  },
};

const OUTCOME_LABELS: Record<TouchOutcome, string> = {
  antwort: "Antwort erhalten",
  keine_antwort: "Keine Antwort",
  bestaetigt: "Bestätigt",
  abgesagt: "Abgesagt",
  verschoben: "Verschoben",
};

/** Die drei Ergebnisse, die beim Abhaken zur Wahl stehen. */
const OUTCOME_CHOICES: readonly TouchOutcome[] = ["antwort", "keine_antwort", "bestaetigt"];

type BucketKey = "overdue" | "soon" | "today" | "week";

const BUCKET_LABELS: Record<BucketKey, string> = {
  overdue: "Überfällig",
  soon: "In der nächsten Stunde",
  today: "Heute",
  week: "Diese Woche",
};
const BUCKET_ORDER: readonly BucketKey[] = ["overdue", "soon", "today", "week"];

const ALL_PERSONS = "__alle__";

/* ------------------------------------------------------------------ *
 * Zeit — ausschließlich über apptTime, nie über die Browser-Zone
 * ------------------------------------------------------------------ */

/**
 * Der Tageskorb einer Karte. Die Tagesgrenze kommt aus `berlinDateISO`; ein
 * `setHours(23,59,…)` läge auf einem Rechner außerhalb Europe/Berlin daneben
 * und schöbe Karten in den falschen Korb.
 */
function bucketOf(dueAtIso: string, nowMs: number): BucketKey {
  const t = new Date(dueAtIso).getTime();
  if (Number.isNaN(t)) return "week";
  if (t <= nowMs) return "overdue";
  if (t - nowMs <= 60 * 60_000) return "soon";
  if (berlinDateISO(dueAtIso) === berlinDateISO(new Date(nowMs).toISOString())) return "today";
  return "week";
}

/** "Do 17.07., 14:00" — Datum und Uhrzeit in einer Zeile. */
function whenLabel(iso: string | null): string {
  const parts = formatTerminParts(iso);
  return parts ? `${parts.date}, ${parts.time}` : "—";
}

/* ------------------------------------------------------------------ *
 * Karten-Modell
 * ------------------------------------------------------------------ */

type TerminCardModel = {
  key: string;
  entityType: ReminderEntityType;
  entityId: string;
  leadName: string | null;
  company: string | null;
  appointmentAt: string;
  channel: TouchChannel | null;
  assignedUserId: string | null;
  assignedUsername: string | null;
  meetLink: string | null;
  /** Alle Touches dieses Termins, nach Fälligkeit sortiert. */
  touches: ReminderTouchWithContext[];
  open: ReminderTouchWithContext[];
  /** Früheste offene Fälligkeit — danach wird einsortiert und sortiert. */
  nextDueAt: string | null;
  /** Identität des Leads über Termine hinweg (für die Kontaktfrequenz). */
  leadKey: string;
};

function leadKeyOf(t: ReminderTouchWithContext): string {
  const name = (t.lead_name ?? "").trim().toLowerCase();
  const company = (t.company ?? "").trim().toLowerCase();
  // Ohne Namen und Firma gibt es keine belastbare Lead-Identität — dann bleibt
  // die Zeile für sich, statt mit allen anderen Namenlosen zu verschmelzen.
  return name || company ? `${name}|${company}` : `entity:${t.entity_id}`;
}

/**
 * Touches zu Terminkarten bündeln.
 *
 * Der Schlüssel trägt den `entity_type` mit: `closing` und `closing_followup`
 * teilen sich dieselbe `closing_call_id`, sind aber zwei verschiedene Termine
 * (das Abschlussgespräch und der vereinbarte Rückkontakt danach).
 */
function buildCards(touches: ReminderTouchWithContext[]): TerminCardModel[] {
  const byKey = new Map<string, ReminderTouchWithContext[]>();
  for (const t of touches) {
    const key = `${t.entity_type}:${t.entity_id}`;
    const list = byKey.get(key);
    if (list) list.push(t);
    else byKey.set(key, [t]);
  }

  const cards: TerminCardModel[] = [];
  for (const [key, list] of byKey) {
    list.sort((a, b) => a.due_at.localeCompare(b.due_at) || a.step_no - b.step_no);
    // Kopfdaten vom zuletzt geplanten Touch: wurde ein Termin verschoben,
    // trägt die jüngste Stufe den gültigen Zeitpunkt und Kanal.
    const head = list[list.length - 1];
    const open = list.filter((t) => !t.done_at);
    cards.push({
      key,
      entityType: head.entity_type,
      entityId: head.entity_id,
      leadName: head.lead_name,
      company: head.company,
      appointmentAt: head.appointment_at,
      channel: head.channel,
      assignedUserId: head.assigned_user_id,
      assignedUsername: head.assigned_username,
      meetLink: head.meet_link,
      touches: list,
      open,
      nextDueAt: open[0]?.due_at ?? null,
      leadKey: leadKeyOf(head),
    });
  }

  // Sortiert nach der frühesten OFFENEN Fälligkeit, nicht nach dem Termin —
  // sonst rutschte eine überfällige Stufe unter einen späteren Termin.
  cards.sort((a, b) => (a.nextDueAt ?? "9999").localeCompare(b.nextDueAt ?? "9999"));
  return cards;
}

/**
 * Letzter erledigter Kontakt je Lead — Grundlage der Kontaktfrequenz-Warnung.
 * Gerechnet über ALLE sichtbaren Touches, damit ein Setting-Kontakt von gestern
 * auch auf der Closing-Karte desselben Leads warnt.
 */
function lastContactByLead(touches: ReminderTouchWithContext[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of touches) {
    if (!t.done_at) continue;
    const key = leadKeyOf(t);
    const current = out.get(key);
    if (!current || t.done_at > current) out.set(key, t.done_at);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Bausteine
 * ------------------------------------------------------------------ */

/** Beschriftung einer Stufe. Der Snapshot am Touch ist maßgeblich (§ reminders.ts). */
function stepLabel(touch: ReminderTouchWithContext): string {
  if (touch.touch_kind === "sofort") return "Sofort-Bestätigung";
  return TEMPLATE_META[touch.template_key]?.label ?? `Stufe ${touch.step_no}`;
}

function PersonPill({ name }: { name: string }) {
  const color = ownerColor(name);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        height: 22,
        padding: "0 var(--sp-4)",
        borderRadius: "var(--r-full)",
        background: "var(--surface-3)",
        border: "1px solid var(--border-default)",
        fontSize: "var(--fs-xs)",
        fontWeight: 500,
        color: "var(--text-secondary)",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "var(--r-full)", background: color.fg, flexShrink: 0 }} />
      {name}
    </span>
  );
}

const ghostBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--sp-3)",
  height: 26,
  padding: "0 var(--sp-5)",
  borderRadius: "var(--r-full)",
  border: "1px solid var(--border-default)",
  background: "var(--surface-1)",
  color: "var(--text-secondary)",
  fontSize: "var(--fs-xs)",
  fontWeight: 500,
  fontFamily: "inherit",
  textDecoration: "none",
  cursor: "pointer",
  transition: "background var(--transition-fast), border-color var(--transition-fast)",
};

/**
 * Absender-Konto: über welches Konto die Nachricht faktisch rausgehen muss.
 * Der Kanal sagt WORÜBER, diese Zeile sagt VON WEM AUS — bei LinkedIn ist das
 * der Owner der Quellliste und nicht zwingend die zuständige Person.
 */
function SenderLine({
  sender,
  channel,
  assignedUsername,
}: {
  sender: SenderAccount | undefined;
  channel: TouchChannel | null;
  assignedUsername: string | null;
}) {
  // WhatsApp läuft über die persönliche Nummer des Entscheiders und hat kein
  // Listen-Konto; Quellen ohne Vorlaufkanal (Ads, Social, Sonstige) auch nicht.
  if (!sender?.ownerName || channel === "whatsapp") return null;

  const via = sender.kind === "telefon" ? "die Telefonnummer" : "das LinkedIn-Konto";
  const mismatch = Boolean(assignedUsername) && assignedUsername !== sender.ownerName;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--sp-3)",
          fontSize: "var(--fs-xs)",
          color: "var(--text-muted)",
        }}
      >
        <UserCog size={12} style={{ flexShrink: 0 }} />
        Senden über {via} von <strong style={{ color: "var(--text-secondary)" }}>{sender.ownerName}</strong>
      </span>
      {mismatch && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "flex-start",
            gap: "var(--sp-3)",
            fontSize: "var(--fs-xs)",
            fontWeight: 500,
            color: "var(--warning-fg)",
          }}
        >
          <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
          Zuständig ist {assignedUsername} — geschrieben werden muss über das Konto von {sender.ownerName}.
        </span>
      )}
    </div>
  );
}

/** Erledigte Stufe: eine Zeile, mehr nicht — plus die Möglichkeit zurückzunehmen. */
function DoneStep({
  touch,
  doneByName,
  busy,
  onUndo,
}: {
  touch: ReminderTouchWithContext;
  doneByName?: string;
  busy: boolean;
  onUndo: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", minHeight: 24 }}>
      <Check size={12} style={{ flexShrink: 0, color: "var(--success-fg)" }} />
      <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", textDecoration: "line-through" }}>
        {stepLabel(touch)}
      </span>
      {touch.outcome && (
        <Badge tone={touch.outcome === "antwort" ? "success" : "neutral"} style={{ height: 18, fontSize: "var(--fs-2xs)" }}>
          {OUTCOME_LABELS[touch.outcome]}
        </Badge>
      )}
      <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
        <span style={{ fontSize: "var(--fs-2xs)", color: "var(--text-subtle)", whiteSpace: "nowrap" }}>
          {whenLabel(touch.done_at)}
          {doneByName ? ` · ${doneByName}` : ""}
        </span>
        <button
          type="button"
          onClick={onUndo}
          disabled={busy}
          title="Erledigt zurücknehmen"
          aria-label={`${stepLabel(touch)} zurücknehmen`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            border: "none",
            background: "transparent",
            color: "var(--text-subtle)",
            cursor: busy ? "default" : "pointer",
          }}
        >
          <Undo2 size={12} />
        </button>
      </span>
    </div>
  );
}

/** Künftige Stufe: ruhig, aber mit ihrer Fälligkeit — das fehlte bisher ganz. */
function PendingStep({ touch }: { touch: ReminderTouchWithContext }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", minHeight: 24 }}>
      <Circle size={10} style={{ flexShrink: 0, color: "var(--text-disabled)" }} />
      <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{stepLabel(touch)}</span>
      {touch.requires_no_response && (
        <span style={{ fontSize: "var(--fs-2xs)", color: "var(--text-subtle)" }}>nur ohne Antwort</span>
      )}
      <span
        style={{
          marginLeft: "auto",
          fontSize: "var(--fs-2xs)",
          color: "var(--text-subtle)",
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        fällig {whenLabel(touch.due_at)}
      </span>
    </div>
  );
}

/** Die eine aufgeklappte Stufe: fertiger Text, Kopier-Knopf, Ergebnis-Knöpfe. */
function ActiveStep({
  touch,
  bundle,
  channel,
  assignedUsername,
  overdue,
  recentlyContacted,
  busy,
  onDone,
}: {
  touch: ReminderTouchWithContext;
  bundle: TemplateBundle | undefined;
  channel: TouchChannel | null;
  assignedUsername: string | null;
  overdue: boolean;
  recentlyContacted: boolean;
  busy: boolean;
  onDone: (outcome: TouchOutcome) => void;
}) {
  const [copied, setCopied] = useState(false);

  // Gegen die Vorlagen der ZUSTÄNDIGEN Person gerendert, nicht gegen die des
  // Betrachters — und live, damit eine spätere Textänderung auch auf schon
  // erzeugte, noch offene Stufen wirkt.
  const rendered = renderResolved(touch.template_key, bundle, {
    leadName: touch.lead_name,
    company: touch.company,
    appointmentAtIso: touch.appointment_at,
    link: touch.meet_link,
    kanal: channel ? CHANNEL_META[channel].label : null,
    absender: assignedUsername,
  });

  async function copyText() {
    try {
      await navigator.clipboard.writeText(rendered.subject ? `${rendered.subject}\n\n${rendered.body}` : rendered.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Kopieren kann in unsicheren Kontexten fehlschlagen — der Text steht
      // trotzdem sichtbar da und lässt sich markieren.
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap" }}>
        {overdue ? (
          <AlertTriangle size={12} style={{ flexShrink: 0, color: "var(--danger-fg)" }} />
        ) : (
          <Clock size={12} style={{ flexShrink: 0, color: "var(--orange-300)" }} />
        )}
        <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text-primary)" }}>
          {stepLabel(touch)}
        </span>
        <span
          style={{
            fontSize: "var(--fs-xs)",
            fontWeight: 500,
            color: overdue ? "var(--danger-fg)" : "var(--text-secondary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {overdue ? `überfällig seit ${whenLabel(touch.due_at)}` : `fällig ${whenLabel(touch.due_at)}`}
        </span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}>
          {touch.requires_no_response && (
            <Badge tone="neutral" style={{ height: 18, fontSize: "var(--fs-2xs)" }}>
              nur ohne Antwort
            </Badge>
          )}
          <Badge tone="neutral" style={{ height: 18, fontSize: "var(--fs-2xs)" }} title="Herkunft des Textes">
            {TEMPLATE_SOURCE_LABELS[rendered.source]}
          </Badge>
        </span>
      </div>

      {recentlyContacted && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            fontSize: "var(--fs-xs)",
            color: "var(--warning-fg)",
          }}
        >
          <AlertTriangle size={12} style={{ flexShrink: 0 }} />
          Kürzlich schon kontaktiert (weniger als {CONTACT_GAP_WARN_DAYS} Tage) — bewusst kein Stopp, nur ein Hinweis.
        </span>
      )}

      <div
        style={{
          position: "relative",
          background: "var(--surface-1)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--r-sm)",
          padding: "var(--sp-4) var(--sp-5)",
        }}
      >
        {rendered.subject && (
          <p
            style={{
              margin: "0 0 var(--sp-3)",
              paddingRight: "1.75rem",
              fontSize: "var(--fs-xs)",
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            {rendered.subject}
          </p>
        )}
        <p
          style={{
            margin: 0,
            paddingRight: rendered.subject ? 0 : "1.75rem",
            fontSize: "var(--fs-sm)",
            lineHeight: 1.5,
            color: "var(--text-secondary)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            userSelect: "text",
          }}
        >
          {rendered.body}
        </p>
        <button
          type="button"
          onClick={copyText}
          aria-label={copied ? "Text kopiert" : "Text kopieren"}
          title={copied ? "Kopiert" : "Text kopieren"}
          style={{
            position: "absolute",
            top: "var(--sp-3)",
            right: "var(--sp-3)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            padding: 0,
            borderRadius: "var(--r-xs)",
            border: `1px solid ${copied ? "rgb(63 179 127 / 0.28)" : "transparent"}`,
            background: copied ? "var(--success-bg)" : "transparent",
            color: copied ? "var(--success-fg)" : "var(--text-muted)",
            cursor: "pointer",
            transition: "background var(--transition-fast), border-color var(--transition-fast)",
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>

      {/* Ergebnis statt bloßem Häkchen: "Antwort erhalten" beendet die
          Folgestufen, die auf ausbleibende Antwort warten
          (setReminderTouchDone → requires_no_response). Ohne diese Angabe
          füllte sich die Seite mit Karteileichen. */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
        {OUTCOME_CHOICES.map((outcome) => {
          const isAnswer = outcome === "antwort";
          return (
            <button
              key={outcome}
              type="button"
              disabled={busy}
              onClick={() => onDone(outcome)}
              title={
                isAnswer
                  ? "Erledigt — der Lead hat geantwortet. Beendet die Folgestufen, die auf eine Antwort warten."
                  : "Erledigt — mit diesem Ergebnis festhalten."
              }
              style={{
                ...ghostBtn,
                color: isAnswer ? "var(--success-fg)" : "var(--text-secondary)",
                background: isAnswer ? "var(--success-bg)" : "var(--surface-1)",
                borderColor: isAnswer ? "rgb(63 179 127 / 0.28)" : "var(--border-default)",
                cursor: busy ? "default" : "pointer",
              }}
            >
              {isAnswer ? <Check size={12} /> : <Circle size={10} />} {OUTCOME_LABELS[outcome]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Terminkarte
 * ------------------------------------------------------------------ */

function TerminCard({
  card,
  bundles,
  sender,
  doneBy,
  nowMs,
  recentlyContacted,
  selectable,
  selected,
  onSelect,
}: {
  card: TerminCardModel;
  bundles: Record<string, TemplateBundle>;
  sender: SenderAccount | undefined;
  doneBy: Record<string, string>;
  nowMs: number;
  recentlyContacted: boolean;
  selectable: boolean;
  selected: boolean;
  onSelect: (key: string, next: boolean) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const meta = ENTITY_META[card.entityType];
  const bundle = card.assignedUserId ? bundles[card.assignedUserId] : undefined;
  const active = card.open[0] ?? null;
  const appt = formatTerminParts(card.appointmentAt);
  const overdue = Boolean(active) && new Date(active!.due_at).getTime() <= nowMs;

  // Mehrere Kaskaden können an einem Termin hängen (Vor-Termin-Kaskade und
  // z. B. die No-Show-Kette). Ihre Stufen laufen unabhängig — deshalb bekommt
  // jede ihren eigenen Abschnitt, sobald es mehr als eine gibt.
  const groups = useMemo(() => {
    const map = new Map<CascadeKind, ReminderTouchWithContext[]>();
    for (const t of card.touches) {
      const list = map.get(t.cascade_kind);
      if (list) list.push(t);
      else map.set(t.cascade_kind, [t]);
    }
    return [...map.entries()];
  }, [card.touches]);

  function run(work: () => Promise<{ error?: string } | void>) {
    setError(null);
    startTransition(async () => {
      const res = await work();
      if (res && "error" in res && res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  const markDone = (touchId: string, outcome: TouchOutcome | null) =>
    run(() => setReminderTouchDone(touchId, true, outcome));

  const undo = (touchId: string) => run(() => setReminderTouchDone(touchId, false, null));

  /**
   * Sammelaktion: alle noch offenen Stufen dieses Termins abhaken. Der Fall
   * "Lead hat auf Stufe 1 zugesagt" — der Nutzer erledigt die Kaskade, statt
   * sie abzuwarten. Kein Bestätigungs-Zwischenschritt: jede Stufe ist über
   * dieselbe Karte einzeln zurücknehmbar.
   */
  const doneAll = () =>
    run(async () => {
      const results = await Promise.all(card.open.map((t) => setReminderTouchDone(t.id, true, "bestaetigt")));
      const failed = results.find((r) => r?.error);
      return failed ?? undefined;
    });

  return (
    <article
      className="card"
      style={{
        padding: "var(--sp-5) var(--sp-6)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-5)",
        borderLeft: overdue ? "3px solid var(--danger-fg)" : undefined,
        opacity: isPending ? 0.6 : 1,
        transition: "opacity var(--transition-fast)",
      }}
    >
      {/* ── Kopf: Lead, Firma, Typ, Kanal, Zuständigkeit ── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-4)" }}>
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(card.key, e.target.checked)}
            aria-label={`${card.leadName ?? "Unbenannter Lead"} auswählen`}
            style={{ marginTop: 3, cursor: "pointer", flexShrink: 0 }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "var(--fs-base)",
              fontWeight: 600,
              letterSpacing: "var(--ls-display)",
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {card.leadName ?? "Unbenannter Lead"}
          </div>
          {card.company && (
            <div
              style={{
                fontSize: "var(--fs-xs)",
                color: "var(--text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {card.company}
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            flexShrink: 0,
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <StageBadge stage={meta.stage}>{meta.label}</StageBadge>
          <Badge tone={card.channel ? "info" : "warning"}>
            {card.channel ? (
              <>
                {CHANNEL_META[card.channel].icon} {CHANNEL_META[card.channel].label}
              </>
            ) : (
              "Kanal frei wählen"
            )}
          </Badge>
          {card.assignedUsername && <PersonPill name={card.assignedUsername} />}
        </div>
      </div>

      {/* ── Termin selbst + Verweis in den Editor ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-4)",
          flexWrap: "wrap",
          fontSize: "var(--fs-sm)",
          color: "var(--text-secondary)",
        }}
      >
        <Clock size={12} style={{ flexShrink: 0, color: "var(--text-muted)" }} />
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {appt ? `${appt.date}, ${appt.time} Uhr` : "Termin —"}
        </span>
        <Link href={meta.href(card.entityId)} style={{ ...ghostBtn, marginLeft: "auto" }}>
          {meta.linkLabel} <ArrowUpRight size={12} />
        </Link>
      </div>

      <SenderLine sender={sender} channel={card.channel} assignedUsername={card.assignedUsername} />

      {/* ── Zeitleiste der Stufen ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
        {groups.map(([kind, list]) => (
          <div key={kind} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
            {groups.length > 1 && (
              <div className="eyebrow eyebrow-muted" style={{ fontSize: "var(--fs-2xs)" }}>
                {CASCADE_KIND_LABELS[kind]}
              </div>
            )}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--sp-4)",
                paddingLeft: "var(--sp-6)",
                borderLeft: "2px solid var(--border-subtle)",
              }}
            >
              {list.map((t) =>
                t.done_at ? (
                  <DoneStep
                    key={t.id}
                    touch={t}
                    doneByName={doneBy[t.id]}
                    busy={isPending}
                    onUndo={() => undo(t.id)}
                  />
                ) : active && t.id === active.id ? (
                  <ActiveStep
                    key={t.id}
                    touch={t}
                    bundle={bundle}
                    channel={card.channel}
                    assignedUsername={card.assignedUsername}
                    overdue={overdue}
                    recentlyContacted={recentlyContacted}
                    busy={isPending}
                    onDone={(outcome) => markDone(t.id, outcome)}
                  />
                ) : (
                  <PendingStep key={t.id} touch={t} />
                ),
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Fuß: Sammelaktion, Querverweis, Fehler ── */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap" }}>
        {card.open.length > 1 && (
          <button
            type="button"
            disabled={isPending}
            onClick={doneAll}
            title={`Alle ${card.open.length} offenen Stufen dieses Termins als erledigt eintragen`}
            style={{ ...ghostBtn, cursor: isPending ? "default" : "pointer" }}
          >
            <CheckCheck size={12} /> Ganze Kaskade abhaken ({card.open.length})
          </button>
        )}
        {/* Einzige echte Überschneidung mit /nachfassen: derselbe Nachfass-
            Kontakt steht dort zusätzlich als Tages-Eintrag. */}
        {card.entityType === "closing_followup" && (
          <Link
            href="/nachfassen"
            style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", textDecoration: "none" }}
          >
            Auch in Nachfassen →
          </Link>
        )}
        {error && (
          <span style={{ fontSize: "var(--fs-xs)", fontWeight: 500, color: "var(--danger-fg)" }}>{error}</span>
        )}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ *
 * Board
 * ------------------------------------------------------------------ */

/** Über welches Konto die Nachricht faktisch rausgeht (Owner der Quellliste). */
export type SenderAccount = { ownerName: string | null; kind: "linkedin" | "telefon" | null };

type Props = {
  mine: ReminderInbox;
  /** Nur für Owner mit workspace-weiter Datensicht befüllt, sonst `null`. */
  team: ReminderInbox | null;
  canTeamView: boolean;
  /** Vorlagen je zuständiger Person — in EINER Abfrage geladen (Seite). */
  bundles: Record<string, TemplateBundle>;
  /** Absender-Konto je `entity_id` — ebenfalls gebündelt geladen. */
  senders: Record<string, SenderAccount>;
  /** touch_id → Name der Person, die abgehakt hat. */
  doneBy: Record<string, string>;
  members: { user_id: string; username: string }[];
};

export function ErinnerungenBoard({ mine, team, canTeamView, bundles, senders, doneBy, members }: Props) {
  const router = useRouter();
  const [view, setView] = useState<"mine" | "team">("mine");
  const [person, setPerson] = useState<string>(ALL_PERSONS);
  const [selected, setSelected] = useState<string[]>([]);
  const [assignTo, setAssignTo] = useState<string>("");
  const [assignError, setAssignError] = useState<string | null>(null);
  const [isAssigning, startAssign] = useTransition();

  // "Jetzt" für die Korb-Einteilung: Muster CalendarTimeGrid — ein direkter
  // Date.now()-Aufruf im Render-Körper ist eine unreine Funktion
  // (react-hooks/purity), stattdessen minütlich per Effekt nachführen.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const inbox = view === "team" && team ? team : mine;

  const cards = useMemo(() => buildCards(inbox.touches), [inbox.touches]);
  const lastContact = useMemo(() => lastContactByLead(inbox.touches), [inbox.touches]);

  // Personenfilter: nur die Zuständigen, die im aktuellen Fenster überhaupt
  // vorkommen — eine Liste mit Namen ohne Karten filtert ins Leere.
  const personOptions = useMemo<SelectOption[]>(() => {
    const seen = new Map<string, string>();
    for (const c of cards) {
      if (c.assignedUserId) seen.set(c.assignedUserId, c.assignedUsername ?? c.assignedUserId);
    }
    return [
      { value: ALL_PERSONS, label: `Alle Personen (${cards.length})` },
      ...[...seen.entries()]
        .sort((a, b) => a[1].localeCompare(b[1], "de"))
        .map(([id, name]) => ({ value: id, label: name, color: ownerColor(name).fg })),
    ];
  }, [cards]);

  const visible = useMemo(
    () => (view === "team" && person !== ALL_PERSONS ? cards.filter((c) => c.assignedUserId === person) : cards),
    [cards, view, person],
  );

  const openCards = visible.filter((c) => c.open.length > 0);
  const doneCards = visible.filter((c) => c.open.length === 0);

  const buckets = new Map<BucketKey, TerminCardModel[]>();
  for (const key of BUCKET_ORDER) buckets.set(key, []);
  // Vor dem ersten Effekt-Tick (nowMs noch null) bleiben die Körbe leer — ein
  // Wimpernschlag bei Erstanzeige, kein Flackern zwischen Zuständen, weil in
  // diesem Fenster auch der Leerzustand unterdrückt wird.
  if (nowMs != null) {
    for (const c of openCards) buckets.get(bucketOf(c.nextDueAt!, nowMs))!.push(c);
  }
  const overdueCount = buckets.get("overdue")!.length;

  const selectable = view === "team" && canTeamView;
  const selectedCards = selectable ? visible.filter((c) => selected.includes(c.key)) : [];

  function resetSelection() {
    setSelected([]);
    setAssignError(null);
  }

  function toggleCard(key: string, next: boolean) {
    setSelected((prev) => (next ? [...new Set([...prev, key])] : prev.filter((k) => k !== key)));
  }

  function recentlyContacted(card: TerminCardModel): boolean {
    const next = card.open[0];
    // Die Vor-Termin-Kaskade ist ausgenommen: drei Kontakte in drei Tagen sind
    // dort gewollt (siehe CONTACT_GAP_WARN_DAYS).
    if (!next || next.touch_kind === "cascade" || nowMs == null) return false;
    const last = lastContact.get(card.leadKey);
    if (!last) return false;
    return nowMs - new Date(last).getTime() < CONTACT_GAP_WARN_DAYS * 86_400_000;
  }

  /**
   * Umzuweisen über die bestehende Action — `setAssignee` prüft selbst
   * `role='owner' && data_scope='workspace'`. Ein Closing-Gespräch und sein
   * Nachfass-Kontakt hängen an derselben Zeile: doppelt zugewiesen würde die
   * zweite Anfrage nur dasselbe schreiben, deshalb vorher entdoppeln.
   */
  function applyAssignment() {
    if (selectedCards.length === 0) return;
    setAssignError(null);
    const targets = new Map<string, { entity: AssigneeEntity; id: string }>();
    for (const c of selectedCards) {
      const entity = ENTITY_META[c.entityType].assignee;
      targets.set(`${entity}:${c.entityId}`, { entity, id: c.entityId });
    }
    startAssign(async () => {
      const results = await Promise.all(
        [...targets.values()].map((t) => setAssignee(t.entity, t.id, assignTo === "" ? null : assignTo)),
      );
      const failed = results.find((r) => r?.error);
      if (failed?.error) {
        setAssignError(failed.error);
        return;
      }
      resetSelection();
      router.refresh();
    });
  }

  /* ── Fehlendes Schema: NICHT der grüne Leerzustand ── */
  if (!inbox.available) {
    return (
      <div
        className="card"
        style={{
          padding: "var(--sp-7) var(--sp-8)",
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
            Erinnerungen sind nicht verfügbar
          </div>
          <p style={{ margin: "var(--sp-3) 0 0", fontSize: "var(--fs-sm)", color: "var(--text-secondary)", maxWidth: "62ch" }}>
            Die Kaskaden-Tabellen fehlen in der Datenbank — die Migration ist noch nicht eingespielt. Das ist
            ausdrücklich <strong>nicht</strong> dasselbe wie &bdquo;nichts f&auml;llig&ldquo;: Es entstehen derzeit gar keine
            Erinnerungen, und keine Terminbestätigung geht raus. Ein Administrator spielt die Migration im
            Supabase-SQL-Editor ein.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-7)" }}>
      {/* ── Kopfleiste: Dringlichkeit, Ansicht, Personenfilter ── */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)", flexWrap: "wrap" }}>
        {overdueCount > 0 && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--sp-3)",
              fontSize: "var(--fs-sm)",
              fontWeight: 600,
              color: "var(--danger-fg)",
            }}
          >
            <AlertTriangle size={14} /> {overdueCount} {overdueCount === 1 ? "Termin" : "Termine"} überfällig
          </span>
        )}
        <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
          {openCards.length} {openCards.length === 1 ? "offener Termin" : "offene Termine"} · Fenster{" "}
          {inbox.horizonDays} Tage
        </span>
        {canTeamView && team && (
          <Segmented
            ariaLabel="Ansicht"
            value={view}
            onChange={(v) => {
              setView(v);
              setPerson(ALL_PERSONS);
              resetSelection();
            }}
            options={[
              { value: "mine", label: "Meine Erinnerungen" },
              { value: "team", label: "Team" },
            ]}
          />
        )}
        {selectable && personOptions.length > 1 && (
          <div style={{ minWidth: 200 }}>
            <Select
              value={person}
              onChange={(v) => {
                setPerson(v);
                resetSelection();
              }}
              options={personOptions}
              ariaLabel="Zuständige Person"
              id="erinnerungen-person"
            />
          </div>
        )}
      </div>

      {/* ── Körbe ── */}
      {nowMs == null ? null : openCards.length === 0 ? (
        <div className="card fade-up dot-grid">
          <div className="empty-state">
            <CheckCircle2 size={24} aria-hidden style={{ color: "var(--success-fg)" }} />
            <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: "var(--text-primary)" }}>Nichts offen</div>
            <p style={{ maxWidth: 380 }}>
              Sobald ein Setting-, Closing- oder Nachfass-Termin ansteht — oder eine Kette nach No-Show oder
              ausgebliebenem Abschluss läuft —, erscheint hier eine Karte je Termin.
            </p>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
          {BUCKET_ORDER.filter((key) => buckets.get(key)!.length > 0).map((key) => (
            <section key={key}>
              <div
                className="eyebrow eyebrow-muted"
                style={{ marginBottom: "var(--sp-5)", display: "flex", alignItems: "center", gap: "var(--sp-3)" }}
              >
                {BUCKET_LABELS[key]}
                <span className="count-pill" data-tone={key === "overdue" ? "overdue" : undefined}>
                  {buckets.get(key)!.length}
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
                  gap: "var(--sp-5)",
                }}
              >
                {buckets.get(key)!.map((card) => (
                  <TerminCard
                    key={card.key}
                    card={card}
                    bundles={bundles}
                    sender={senders[card.entityId]}
                    doneBy={doneBy}
                    nowMs={nowMs}
                    recentlyContacted={recentlyContacted(card)}
                    selectable={selectable}
                    selected={selected.includes(card.key)}
                    onSelect={toggleCard}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ── Bereits erledigt ── */}
      {doneCards.length > 0 && (
        <details>
          <summary
            className="collapse-summary"
            style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", cursor: "pointer", userSelect: "none" }}
          >
            <span className="eyebrow eyebrow-muted">Vollständig erledigt ({doneCards.length})</span>
          </summary>
          <div
            style={{
              marginTop: "var(--sp-5)",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
              gap: "var(--sp-5)",
            }}
          >
            {doneCards.map((card) => (
              <TerminCard
                key={card.key}
                card={card}
                bundles={bundles}
                sender={senders[card.entityId]}
                doneBy={doneBy}
                nowMs={nowMs ?? 0}
                recentlyContacted={false}
                selectable={selectable}
                selected={selected.includes(card.key)}
                onSelect={toggleCard}
              />
            ))}
          </div>
        </details>
      )}

      {/* ── Aktionsleiste der Mehrfachauswahl (Urlaubsfall ohne Vertretungsfeld) ── */}
      {selectable && selectedCards.length > 0 && (
        <div
          className="card"
          style={{
            position: "sticky",
            bottom: "var(--sp-6)",
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-5)",
            flexWrap: "wrap",
            padding: "var(--sp-5) var(--sp-6)",
            background: "var(--surface-4)",
            boxShadow: "var(--shadow-overlay)",
          }}
        >
          <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text-primary)" }}>
            {selectedCards.length} {selectedCards.length === 1 ? "Termin" : "Termine"} ausgewählt
          </span>
          <div style={{ minWidth: 200 }}>
            <Select
              value={assignTo}
              onChange={setAssignTo}
              options={[
                { value: "", label: "Niemand" },
                ...members.map((m) => ({
                  value: m.user_id,
                  label: m.username,
                  color: ownerColor(m.username).fg,
                })),
              ]}
              ariaLabel="Zuweisen an"
              placeholder="Zuweisen an …"
              id="erinnerungen-zuweisen"
              disabled={isAssigning}
            />
          </div>
          <button
            type="button"
            className="btn-secondary"
            disabled={isAssigning}
            onClick={applyAssignment}
            title="Die zuständige Person der ausgewählten Termine ändern. Offene Erinnerungen ziehen mit; bereits erledigte bleiben als Historie bei der bisherigen Person."
          >
            <UserCog size={13} /> Zuweisen
          </button>
          <button type="button" style={ghostBtn} onClick={resetSelection} disabled={isAssigning}>
            Auswahl aufheben
          </button>
          {assignError && (
            <span style={{ fontSize: "var(--fs-xs)", fontWeight: 500, color: "var(--danger-fg)" }}>{assignError}</span>
          )}
        </div>
      )}
    </div>
  );
}
