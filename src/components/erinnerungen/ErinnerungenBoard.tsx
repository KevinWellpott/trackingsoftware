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
import { contactAgeDays, isWithinContactGap, lastContactLabel } from "@/lib/contactGap";
import type { DossierEntityKind } from "@/lib/leadDossier";
import { LeadDossierSheet } from "@/components/lead/LeadDossierSheet";
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
  ChevronRight,
  Circle,
  Clock,
  Copy,
  Database,
  MessageCircle,
  Phone,
  Undo2,
  UserCog,
  Users,
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
//   · erledigte Stufen als eine Zeile (mit Zeitpunkt und Person),
//   · genau EINE Stufe aufgeklappt: die nächste offene, mit fertigem Text,
//   · alles Künftige hinter EINER Zeile („2 weitere Stufen, nächste Do …") —
//     im 360-px-Raster war die Karte sonst je nach Vorgeschichte doppelt so
//     hoch wie ihre Nachbarin,
//   · eine Sammelaktion, die alle offenen Stufen in einem Rutsch abhakt.
//
// KEIN Auto-Versand: die Karte liefert den fertigen Text zum Kopieren, ein
// Mensch schreibt und schickt — wie im Nachfassen-Board.

/* ------------------------------------------------------------------ *
 * Konstanten & Beschriftungen
 * ------------------------------------------------------------------ */

// Die Warnschwelle (CONTACT_GAP_WARN_DAYS) steht in `lib/contactGap.ts` —
// dieselbe Zahl gilt im Nachfassen-Board. Die Vor-Termin-Kaskade
// (`touch_kind === 'cascade'`) ist hier ausgenommen: drei Kontakte in drei
// Tagen sind dort gewollt, und die Warnung wäre nur Rauschen.

const CHANNEL_META: Record<TouchChannel, { label: string; icon: React.ReactNode }> = {
  linkedin: { label: "LinkedIn", icon: <AtSign size={11} /> },
  telefon: { label: "Anruf", icon: <Phone size={11} /> },
  whatsapp: { label: "WhatsApp", icon: <MessageCircle size={11} /> },
};

const ENTITY_META: Record<
  ReminderEntityType,
  {
    label: string;
    stage: StageKey;
    assignee: AssigneeEntity;
    href: (id: string) => string;
    linkLabel: string;
    /** Anker des Lead-Dossiers — `entity_id` ist die Termin-Zeile selbst. */
    dossier: DossierEntityKind;
  }
> = {
  setting: {
    // EIN Wort für diese Stufe, überall gleich: „Setting". Vorher stand auf
    // derselben Karte der Badge „Erstgespräch" neben dem Knopf „Zum Setting" —
    // zwei Namen für dieselbe Sache, und der Nutzer muss raten, ob sie es sind.
    // „Setting" gewinnt, weil Kalender, Route und Nachfassen-Board es schon so
    // nennen und weil es neben „Closing" ein Paar ergibt.
    label: "Setting",
    stage: "setting",
    assignee: "setting_call",
    href: (id) => `/setting/${id}`,
    linkLabel: "Zum Setting",
    dossier: "setting",
  },
  closing: {
    label: "Closing",
    stage: "closing",
    assignee: "closing_call",
    href: (id) => `/closing/${id}`,
    linkLabel: "Zum Closing",
    dossier: "closing",
  },
  // Der vereinbarte Nachfass-Kontakt ist ein eigener "Termin" mit eigener
  // Kaskade, hängt aber an derselben Closing-Zeile — daher dieselbe Route.
  closing_followup: {
    label: "Nachfass-Kontakt",
    stage: "nachfassen",
    assignee: "closing_call",
    href: (id) => `/closing/${id}`,
    linkLabel: "Zum Closing",
    dossier: "closing",
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

type BucketKey = "overdue" | "soon" | "today" | "week" | "later";

const BUCKET_LABELS: Record<BucketKey, string> = {
  overdue: "Überfällig",
  soon: "In der nächsten Stunde",
  today: "Heute",
  week: "Diese Woche",
  later: "Später",
};
const BUCKET_ORDER: readonly BucketKey[] = ["overdue", "soon", "today", "week", "later"];

const ALL_PERSONS = "__alle__";

/* ------------------------------------------------------------------ *
 * Zeit — ausschließlich über apptTime, nie über die Browser-Zone
 * ------------------------------------------------------------------ */

/**
 * Sonntag DIESER Woche als Berliner Kalendertag ("YYYY-MM-DD").
 *
 * Gerechnet wird auf dem bereits berlinisierten Datum, nicht auf dem
 * Zeitstempel: Sonntag 23:00 Berliner Zeit ist in UTC schon Montag, die Woche
 * endete dann einen Tag zu früh. Die 12:00 im Konstruktor sind der übliche
 * Mittags-Anker — er liegt in jeder Zone am selben Kalendertag, eine 00:00
 * dagegen nicht.
 */
function endOfBerlinWeek(todayIso: string): string {
  const d = new Date(`${todayIso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return todayIso;
  // getUTCDay: 0 = Sonntag. Die Woche endet am Sonntag (ISO-Zählung), heute
  // selbst zählt dazu — an einem Sonntag ist der Abstand deshalb 0.
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Der Korb einer Karte. Die Tagesgrenze kommt aus `berlinDateISO`; ein
 * `setHours(23,59,…)` läge auf einem Rechner außerhalb Europe/Berlin daneben
 * und schöbe Karten in den falschen Korb.
 *
 * WARUM es „Später" gibt: Das Ladefenster reicht bis
 * `pipeline_settings.reminder_horizon_days` — konfigurierbar bis 60 Tage. Ohne
 * eigenen Korb landete ein Touch in fünf Wochen unter „Diese Woche", und die
 * Überschrift behauptete eine Dringlichkeit, die es nicht gibt. Die Alternative
 * wäre eine mitwandernde Beschriftung („Nächste 60 Tage") gewesen — dann stünde
 * der Kontakt von morgen in derselben Kachel wie der in acht Wochen, und die
 * Sortierung, die die Seite ausmacht, wäre nur noch eine Liste.
 */
function bucketOf(dueAtIso: string, nowMs: number): BucketKey {
  const t = new Date(dueAtIso).getTime();
  // Unlesbare Fälligkeit ans Ende statt in „Diese Woche": eine Dringlichkeit,
  // die niemand geprüft hat, wird hier nicht behauptet.
  if (Number.isNaN(t)) return "later";
  if (t <= nowMs) return "overdue";
  if (t - nowMs <= 60 * 60_000) return "soon";
  const today = berlinDateISO(new Date(nowMs).toISOString());
  const day = berlinDateISO(dueAtIso);
  if (day === today) return "today";
  // ISO-Datum: der lexikografische Vergleich IST der chronologische.
  return day <= endOfBerlinWeek(today) ? "week" : "later";
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

/**
 * Fehler einer Server-Action anzeigen, ohne eine Postgres-Meldung durchzureichen.
 *
 * Unsere eigenen Actions antworten in ganzen deutschen Sätzen („Keine
 * Berechtigung.") — die gehören unverändert auf die Karte. Alles andere ist
 * roh durchgereichtes `error.message` aus PostgREST und beginnt klein und
 * englisch („new row violates row-level security policy for table …"): für den
 * Nutzer unlesbar, und schlimmer noch, es klingt nach einem Defekt, wo
 * vielleicht nur ein Recht fehlt. Die Rohmeldung geht deshalb nicht verloren,
 * sondern in den `title` — für den Support erreichbar, für die Karte unsichtbar.
 */
/**
 * Führende Anführungszeichen, die vor dem Satzanfang stehen dürfen.
 *
 * Ein deutscher Satz darf mit einem Zitat beginnen — die Sperre gegen die
 * Zuweisung „Niemand" (src/app/actions/assignees.ts) tut genau das. Ohne dieses
 * Abstreifen fiel ausgerechnet die ausführlichste Begründung durch die
 * Klartext-Prüfung unten und wurde durch den Rat ersetzt, es noch einmal zu
 * versuchen — den einen Rat, der hier garantiert nicht hilft: Die Zuweisung
 * kann gar nicht gelingen, und der Ausweg stand nur noch im `title`.
 */
const ZITAT_PREFIX = /^[„“”"»«›‹‚‘’']+/;

function friendlyError(raw: string): { text: string; title?: string } {
  const text = raw.trim();
  const technical =
    /(violates|constraint|duplicate key|permission denied|row-level security|PGRST|relation |column |syntax error|JWT|null value|failed to)/i;
  // Klartext heißt hier: ein Satz, wie ihn ein Mensch geschrieben hat —
  // Großbuchstabe vorn, Satzzeichen hinten, kein Datenbank-Vokabular.
  const klartext =
    /^[A-ZÄÖÜ]/.test(text.replace(ZITAT_PREFIX, "")) && /[.!?]$/.test(text) && !technical.test(text);
  if (klartext) return { text };
  return {
    text: "Das ließ sich nicht speichern. Bitte noch einmal versuchen — bleibt es dabei, die Seite neu laden.",
    title: text,
  };
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
  if (channel === "whatsapp") return null;

  // Die Kette zur Quellliste ist abgerissen — fast immer, weil sie außerhalb
  // der eigenen Datensicht liegt. Ehrlich benennen statt schweigen: „keine
  // Zeile" hieße hier „nichts zu beachten", und das ist die eine Aussage, die
  // sicher falsch ist.
  if (!sender?.ownerName) {
    if (!sender?.unresolved) return null;
    const wovon =
      sender.kind === "telefon"
        ? "Über welche Telefonnummer angerufen werden muss"
        : sender.kind === "linkedin"
          ? "Über welches LinkedIn-Konto geschrieben werden muss"
          : "Über welches Konto geschrieben werden muss";
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "flex-start",
          gap: "var(--sp-3)",
          fontSize: "var(--fs-xs)",
          color: "var(--text-muted)",
        }}
        title="Die Herkunft dieses Termins liegt außerhalb deiner Datensicht oder die Quellliste trägt keinen Inhaber."
      >
        <UserCog size={12} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>{wovon}, ist hier nicht ermittelbar — vor dem Senden kurz klären.</span>
      </span>
    );
  }

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
  recentContactAt,
  busy,
  onDone,
}: {
  touch: ReminderTouchWithContext;
  bundle: TemplateBundle | undefined;
  channel: TouchChannel | null;
  assignedUsername: string | null;
  overdue: boolean;
  /** Zeitpunkt des letzten Kontakts, wenn er die Warnschwelle unterschreitet. */
  recentContactAt: string | null;
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

      {/* Der Abstand steht als ZAHL da, nicht als „weniger als 3 Tage": Ob man
          trotzdem schreibt, entscheidet sich an „vorgestern" anders als an
          „heute früh". Dieselbe Beschriftung wie im Dossier
          (lastContactLabel) — und derselbe Vorbehalt: Diese Karte kennt nur
          die erledigten Erinnerungen, das Dossier zusätzlich Pitches,
          Anwahlen und geführte Termine. */}
      {recentContactAt && (
        <span
          title="Aus den erledigten Erinnerungen dieses Leads. Pitches, Anwahlen und geführte Termine stehen im Dossier — dort kann der letzte Kontakt jünger sein."
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            fontSize: "var(--fs-xs)",
            color: "var(--warning-fg)",
          }}
        >
          <AlertTriangle size={12} style={{ flexShrink: 0 }} />
          Zuletzt kontaktiert {lastContactLabel(contactAgeDays(recentContactAt))} ({whenLabel(recentContactAt)})
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
  orgBundle,
  sender,
  doneBy,
  nowMs,
  recentContactAt,
  selectable,
  selected,
  onSelect,
}: {
  card: TerminCardModel;
  bundles: Record<string, TemplateBundle>;
  orgBundle: TemplateBundle;
  sender: SenderAccount | undefined;
  doneBy: Record<string, string>;
  nowMs: number;
  recentContactAt: string | null;
  selectable: boolean;
  selected: boolean;
  onSelect: (key: string, next: boolean) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dossierOpen, setDossierOpen] = useState(false);

  const meta = ENTITY_META[card.entityType];
  // Ohne zuständige Person (gelöschtes Konto — die Spalte ist `on delete set
  // null`) gibt es kein Personen-Bundle. Der Rückfall ist der Standard der
  // ORGANISATION, nicht `undefined`: ein fehlendes Bundle ließe
  // `resolveTemplate()` auch an der Org-Ebene durchfallen, und der Kunde läse
  // unseren Auslieferungstext statt seines eigenen.
  const bundle = (card.assignedUserId ? bundles[card.assignedUserId] : undefined) ?? orgBundle;
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

  // Steht derselbe Vorgang zusätzlich als Tages-Eintrag in /nachfassen?
  const crossLink = useMemo<string | null>(() => {
    if (card.entityType === "closing_followup") {
      return "Derselbe Nachfass-Kontakt steht dort als Tages-Eintrag (Closing-Wiedervorlage).";
    }
    if (card.touches.some((t) => t.cascade_kind === "no_show_setting")) {
      return "Der nicht erschienene Termin steht dort als Tages-Eintrag (Setting-Wiedervorlage).";
    }
    return null;
  }, [card.entityType, card.touches]);

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

  const shownError = error ? friendlyError(error) : null;

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
        {/* Gesprächsvorbereitung, deshalb VOR dem Termin und ohne die
            Arbeitsliste zu verlassen: das Dossier öffnet als Overlay und lädt
            erst beim Öffnen. Es steht neben dem Sprung in den Editor, weil es
            dieselbe Frage beantwortet — was weiß ich über diesen Lead —, nur
            ohne wegzunavigieren. */}
        <button
          type="button"
          onClick={() => setDossierOpen(true)}
          style={{ ...ghostBtn, marginLeft: "auto" }}
          title="Alles zu diesem Lead — Verlauf, Kanäle, Notizen"
        >
          <Users size={12} /> Dossier
        </button>
        <Link href={meta.href(card.entityId)} style={ghostBtn}>
          {meta.linkLabel} <ArrowUpRight size={12} />
        </Link>
      </div>

      <LeadDossierSheet
        open={dossierOpen}
        onClose={() => setDossierOpen(false)}
        kind={meta.dossier}
        id={card.entityId}
      />

      <SenderLine sender={sender} channel={card.channel} assignedUsername={card.assignedUsername} />

      {/* ── Zeitleiste der Stufen ──
          Genau EINE Stufe steht offen da: die nächste fällige. Alles Künftige
          liegt hinter einer Zeile — im 360-px-Raster war die Karte sonst je
          nach Vorgeschichte doppelt so hoch wie ihre Nachbarin, und die eine
          Frage („was schicke ich jetzt raus?") ging darin unter. Dieselbe
          Mechanik wie die Sektion „Vollständig erledigt" weiter unten. */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
        {groups.map(([kind, list]) => {
          const doneSteps = list.filter((t) => t.done_at);
          const openSteps = list.filter((t) => !t.done_at);
          const activeHere = active && openSteps.some((t) => t.id === active.id) ? active : null;
          const laterSteps = openSteps.filter((t) => t.id !== activeHere?.id);
          return (
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
                {doneSteps.map((t) => (
                  <DoneStep
                    key={t.id}
                    touch={t}
                    doneByName={doneBy[t.id]}
                    busy={isPending}
                    onUndo={() => undo(t.id)}
                  />
                ))}
                {activeHere && (
                  <ActiveStep
                    key={activeHere.id}
                    touch={activeHere}
                    bundle={bundle}
                    channel={card.channel}
                    assignedUsername={card.assignedUsername}
                    overdue={overdue}
                    recentContactAt={recentContactAt}
                    busy={isPending}
                    onDone={(outcome) => markDone(activeHere.id, outcome)}
                  />
                )}
                {laterSteps.length > 0 && (
                  <details>
                    {/* `group-summary`, nicht `collapse-summary`: Letzteres ist
                        das Karten-Rezept mit Hover-Fläche und Trennlinie und
                        bliese eine Zwischenzeile in der Karte zur eigenen Karte
                        auf (globals.css §6.10). */}
                    <summary
                      className="group-summary"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--sp-3)",
                        userSelect: "none",
                        fontSize: "var(--fs-xs)",
                        color: "var(--text-muted)",
                      }}
                    >
                      <ChevronRight size={11} className="group-chevron" />
                      {laterSteps.length === 1
                        ? `1 weitere Stufe · fällig ${whenLabel(laterSteps[0].due_at)}`
                        : `${laterSteps.length} weitere Stufen · nächste ${whenLabel(laterSteps[0].due_at)}`}
                    </summary>
                    <div
                      style={{
                        marginTop: "var(--sp-4)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "var(--sp-4)",
                      }}
                    >
                      {laterSteps.map((t) => (
                        <PendingStep key={t.id} touch={t} />
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>
          );
        })}
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
            <CheckCheck size={12} /> Alle offenen Stufen abhaken ({card.open.length})
          </button>
        )}
        {/* Überschneidung mit /nachfassen — ZWEI Stellen, nicht mehr die eine
            aus docs §1:
             · der vereinbarte Nachfass-Kontakt eines Closings (`follow_up_due`
               → Tages-Eintrag dort, `follow_up_due_at` → Kaskade hier),
             · die No-Show-Kette eines Erstgesprächs: `setSettingOutcome`
               schreibt beides in einem Zug — `follow_up_due` (+1 Tag) für die
               Wiedervorlage und `createNoShowTouch` für diese Kette.
            Der Verweis statt einer Dublette: WELCHE Wiedervorlage heute fällig
            ist, entscheidet /nachfassen — hier steht nur die Uhrzeit-Spur. */}
        {crossLink && (
          <Link
            href="/nachfassen"
            title={crossLink}
            style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", textDecoration: "none" }}
          >
            Auch in Nachfassen →
          </Link>
        )}
        {shownError && (
          <span
            title={shownError.title}
            style={{ fontSize: "var(--fs-xs)", fontWeight: 500, color: "var(--danger-fg)" }}
          >
            {shownError.text}
          </span>
        )}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ *
 * Board
 * ------------------------------------------------------------------ */

/**
 * Über welches Konto die Nachricht faktisch rausgeht (Owner der Quellliste).
 *
 * `unresolved` trennt „hier gibt es kein Konto" von „hier lässt es sich nicht
 * ermitteln". Der zweite Fall entsteht durch die Zeilensicherheit: Wer nur
 * eigene Daten sieht, kann das Erstgespräch oder die Quellliste hinter einem
 * ihm zugewiesenen Termin verborgen bekommen. Ohne die Unterscheidung fiel die
 * Zeile stumm weg — die Karte behauptete damit, es sei nichts zu beachten,
 * obwohl über das falsche Konto geschrieben zu werden droht.
 */
export type SenderAccount = {
  ownerName: string | null;
  kind: "linkedin" | "telefon" | null;
  unresolved?: boolean;
};

type Props = {
  mine: ReminderInbox;
  /** Nur für Owner mit workspace-weiter Datensicht befüllt, sonst `null`. */
  team: ReminderInbox | null;
  canTeamView: boolean;
  /** Vorlagen je zuständiger Person — in EINER Abfrage geladen (Seite). */
  bundles: Record<string, TemplateBundle>;
  /**
   * Der Standard der Organisation allein — greift für Karten ohne zuständige
   * Person (gelöschtes Konto: `assigned_user_id` ist `on delete set null`).
   * Ohne ihn führe die Vorrangkette dort direkt auf den Auslieferungstext.
   */
  orgBundle: TemplateBundle;
  /** Absender-Konto je `entity_id` — ebenfalls gebündelt geladen. */
  senders: Record<string, SenderAccount>;
  /** touch_id → Name der Person, die abgehakt hat. */
  doneBy: Record<string, string>;
  members: { user_id: string; username: string }[];
};

export function ErinnerungenBoard({
  mine,
  team,
  canTeamView,
  bundles,
  orgBundle,
  senders,
  doneBy,
  members,
}: Props) {
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

  /** Letzter Kontakt zu diesem Lead, sofern er die Warnschwelle unterschreitet. */
  function recentContactOf(card: TerminCardModel): string | null {
    const next = card.open[0];
    // Die Vor-Termin-Kaskade ist ausgenommen: drei Kontakte in drei Tagen sind
    // dort gewollt (siehe CONTACT_GAP_WARN_DAYS in lib/contactGap.ts).
    if (!next || next.touch_kind === "cascade" || nowMs == null) return null;
    const last = lastContact.get(card.leadKey);
    if (!last) return null;
    // Dieselbe Auswertung wie im Nachfassen-Board und dieselbe Körnung wie die
    // Beschriftung darunter — beides in lib/contactGap.ts, nicht hier.
    return isWithinContactGap(last, new Date(nowMs).toISOString()) ? last : null;
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
            {/* Der Leerzustand nennt die Bedingung, die WIRKLICH gilt. Vorher stand
                hier „sobald ein Termin ansteht" — am ersten Tag standen 223 Termine
                an und es erschien keine einzige Karte: Für die Kaskade gibt es
                bewusst keinen Backfill (docs §7), Erinnerungen entstehen erst beim
                Anlegen oder Verschieben eines Termins. Eine Zusage, die die Seite
                nicht hält, kostet mehr Vertrauen als ein leerer Bildschirm. */}
            <p style={{ maxWidth: 380 }}>
              Erinnerungen entstehen, wenn ein Termin angelegt oder verschoben wird — für ältere Termine
              entsteht rückwirkend keine. Danach steht hier eine Karte je Termin.
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
                    orgBundle={orgBundle}
                    sender={senders[card.entityId]}
                    doneBy={doneBy}
                    nowMs={nowMs}
                    recentContactAt={recentContactOf(card)}
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
                orgBundle={orgBundle}
                sender={senders[card.entityId]}
                doneBy={doneBy}
                nowMs={nowMs ?? 0}
                recentContactAt={null}
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
            <span
              title={friendlyError(assignError).title}
              style={{ fontSize: "var(--fs-xs)", fontWeight: 500, color: "var(--danger-fg)" }}
            >
              {friendlyError(assignError).text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
