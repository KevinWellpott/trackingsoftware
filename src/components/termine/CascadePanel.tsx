"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getAppointmentCascade,
  type AppointmentCascadeTouch,
  type AppointmentCascadeView,
} from "@/app/actions/appointmentCascade";
import { CASCADE_KIND_LABELS, shiftBerlinMinutes, type CascadeKind, type CascadeStep } from "@/lib/cascadeEngine";
import { TEMPLATE_META, TEMPLATE_SOURCE_LABELS, renderResolved, type TemplateKey } from "@/lib/messageTemplates";
import type { TouchChannel } from "@/lib/reminderCascade";
import { formatTerminParts } from "@/lib/apptTime";
import { Badge } from "@/components/ui/Badge";
import { SECTION_BODY, SECTION_HEAD, SECTION_META, SECTION_TITLE } from "@/components/settings/settingsStyles";
import {
  AlertTriangle,
  AtSign,
  BellRing,
  Check,
  ChevronRight,
  Circle,
  Clock,
  Copy,
  Database,
  MessageCircle,
  MinusCircle,
  Phone,
} from "lucide-react";

// Die Erinnerungs-Kaskade DIESES Termins, im Termin-Layout selbst.
//
// Bisher lebten die Erinnerungen ausschließlich auf /erinnerungen. Wer den
// Termin öffnete, sah weder, welche Nachricht als nächste rausgehen muss, noch
// über welchen Kanal — genau das verlangt die Ausarbeitung an beiden Stellen
// wörtlich („muss im Layout klar ersichtlich sein + die Nachricht + der
// Leadkanal").
//
// Zwei Dinge unterscheiden dieses Panel von der Karte auf /erinnerungen:
//
//  1. Es zeigt ALLE Stufen des Termins, auch die eines Kollegen und auch die in
//     drei Wochen — /erinnerungen filtert auf die eigene Person und ein Fenster.
//  2. Es zeigt die ENTFALLENEN Stufen mit Begründung. Ohne sie ist ein Panel
//     mit zwei statt drei Stufen von einem Fehler nicht zu unterscheiden, und
//     genau dieser Verdacht kostet Vertrauen in alle anderen Zahlen.
//
// Beides zusammen ergab allerdings eine sehr lange Karte: jede Stufe mit
// ausgeschriebenem Text, dazu die erledigten und die entfallenen. Auf einem
// Termin mit Vorgeschichte ging darin die eine Frage unter, wegen der man das
// Panel öffnet — was muss ich als Nächstes rausschicken? Deshalb gilt hier
// dieselbe Staffelung wie auf /erinnerungen:
//
//   · genau EINE Stufe ausgeklappt: die nächste fällige (bzw. überfällige),
//   · kommende Stufen als Einzeiler, Text erst beim Aufklappen,
//   · Erledigtes und Entfallenes zusammen hinter einer geschlossenen Zeile.
//
// Kein Auto-Versand: fertiger Text, Kopier-Knopf, fertig — wie im
// Nachfassen-Board und auf /erinnerungen. Abgehakt wird weiterhin dort, weil
// das Häkchen zur Tagesarbeit gehört und nicht ins Gesprächsprotokoll.

const CHANNEL_META: Record<TouchChannel, { label: string; icon: React.ReactNode }> = {
  linkedin: { label: "LinkedIn", icon: <AtSign size={11} /> },
  telefon: { label: "Anruf", icon: <Phone size={11} /> },
  whatsapp: { label: "WhatsApp", icon: <MessageCircle size={11} /> },
};

/** "Do 17.07., 14:00" — dieselbe Schreibweise wie auf /erinnerungen. */
function whenLabel(iso: string | null): string {
  const parts = formatTerminParts(iso);
  return parts ? `${parts.date}, ${parts.time}` : "—";
}

/**
 * "3 Tage" / "1 Stunde" — dieselbe Umrechnung wie `humanOffset` in
 * cascadeEngine.ts. Die Funktion dort ist modul-intern und gehört auch dorthin:
 * sie beschriftet die Begründung eines übersprungenen Plans, hier beschriftet
 * sie eine Stufe im Panel. Beide reden über Minuten, keiner über den anderen.
 */
function offsetLabel(minutes: number): string {
  if (minutes === 0) return "sofort";
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return d === 1 ? "1 Tag" : `${d} Tage`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? "1 Stunde" : `${h} Stunden`;
  }
  return `${minutes} Minuten`;
}

/* ------------------------------------------------------------------ *
 * Zeilen-Modell
 * ------------------------------------------------------------------ */

type StepRow =
  | { key: string; kind: "touch"; touch: AppointmentCascadeTouch }
  // `neverPlanned` trennt zwei Dinge, die sich am Text nicht auseinanderhalten
  // lassen: „es gab diese Stufe und sie wurde abgeräumt" gegen „es hat sie an
  // diesem Termin nie gegeben". Die Antwort kommt aus dem Zweig, der den Grund
  // ermittelt (`skipReason`) — sie am fertigen Satz zu erraten hieße, die
  // Unterscheidung beim nächsten Umformulieren zu verlieren.
  | { key: string; kind: "skipped"; label: string; reason: string; neverPlanned: boolean };

type CascadeGroup = { cascadeKind: CascadeKind; rows: StepRow[]; sortKey: string };

function stepLabelOf(templateKey: TemplateKey, touchKind: string, stepNo: number): string {
  if (touchKind === "sofort") return "Sofort-Bestätigung";
  return TEMPLATE_META[templateKey]?.label ?? `Stufe ${stepNo}`;
}

/**
 * Die geplante Vor-Termin-Kaskade dieses Termin-Typs. Nur für sie gibt es
 * „entfallene" Stufen: Ereignis-Ketten (No-Show, kein Abschluss, Kickoff)
 * beginnen mit dem Ereignis und können gar nicht zu spät kommen.
 */
function scheduledKindFor(entityType: "setting" | "closing"): CascadeKind {
  return entityType === "closing" ? "closing_msg" : "setting_msg";
}

function buildGroups(
  view: AppointmentCascadeView,
  entityType: "setting" | "closing",
  nowMs: number,
): CascadeGroup[] {
  const scheduledKind = scheduledKindFor(entityType);
  // Hat dieser Termin JE eine Zeile der geplanten Kaskade getragen? Das
  // unterscheidet „die Stufe kam zeitlich nicht mehr hin" von „für diesen
  // Termin ist nie eine Kaskade angelegt worden" (siehe skipReason). Auch ein
  // ganz kurzfristig gebuchter Termin trägt eine Zeile: passt keine Stufe mehr,
  // legt `planScheduledCascade` den sofort fälligen Touch auf step_no 0.
  const everPlanned =
    view.touches.some((t) => t.cascade_kind === scheduledKind) ||
    view.supersededTouches.some((t) => t.cascade_kind === scheduledKind);
  const byKind = new Map<CascadeKind, AppointmentCascadeTouch[]>();
  for (const t of view.touches) {
    const list = byKind.get(t.cascade_kind);
    if (list) list.push(t);
    else byKind.set(t.cascade_kind, [t]);
  }

  // ── Entwertete Stufen, deren Kaskade KEINE gültige Zeile mehr hat. Eine
  //    Kaskade, die entwertet und sofort neu erzeugt wurde (Umterminieren),
  //    steht damit nur einmal da — als die gültige, die sie ist. Je Stufe
  //    bleibt eine Zeile: mehrfaches Entwerten derselben Stufe ist die
  //    Vorgeschichte, nicht drei verschiedene Nachrichten.
  const supersededOnly = new Map<CascadeKind, AppointmentCascadeTouch[]>();
  for (const t of view.supersededTouches) {
    if (byKind.has(t.cascade_kind)) continue;
    const list = supersededOnly.get(t.cascade_kind);
    if (!list) supersededOnly.set(t.cascade_kind, [t]);
    else if (!list.some((x) => x.step_no === t.step_no)) list.push(t);
  }

  const groups: CascadeGroup[] = [];

  // ── Die geplante Kaskade: entlang der KONFIGURATION, nicht entlang der
  //    vorhandenen Zeilen. Nur so fällt auf, dass eine Stufe fehlt.
  const planned = view.steps
    .filter((s) => s.cascade_kind === scheduledKind && s.enabled && s.anchor === "before_appointment")
    .sort((a, b) => a.step_no - b.step_no);
  const scheduledTouches = byKind.get(scheduledKind) ?? [];
  byKind.delete(scheduledKind);

  if (planned.length > 0 || scheduledTouches.length > 0) {
    // Wurde die geplante Kaskade entwertet, ist der zeitliche Rückschluss aus
    // `skipReason` hier falsch: Die Stufen waren geplant, sie sind abgeräumt
    // worden. Der Grund kommt deshalb je Stufe aus der entwerteten Zeile.
    const supersededHere = supersededOnly.get(scheduledKind) ?? null;
    supersededOnly.delete(scheduledKind);
    const rows: StepRow[] = [];
    // Der Sofort-Touch (step_no 0) steht vor den geplanten Stufen: er entsteht
    // genau dann, wenn keine einzige mehr passte, und ist sofort fällig.
    for (const t of scheduledTouches.filter((t) => t.touch_kind === "sofort")) {
      rows.push({ key: t.id, kind: "touch", touch: t });
    }
    for (const step of planned) {
      const touch = scheduledTouches.find((t) => t.touch_kind !== "sofort" && t.step_no === step.step_no);
      if (touch) {
        rows.push({ key: touch.id, kind: "touch", touch });
        continue;
      }
      // Nur eine Stufe, für die es wirklich eine entwertete Zeile gibt, wird als
      // entwertet begründet. Eine, die es nie gab, bleibt beim zeitlichen Grund
      // — sonst behauptete das Panel eine Nachricht, die nie geplant war.
      const superseded = supersededHere?.find((t) => t.step_no === step.step_no) ?? null;
      // Eine entwertete Zeile beweist, dass es die Stufe gab — sie kann nie ein
      // Bestandstermin-Fall sein, egal was `everPlanned` sagt.
      const skip = superseded
        ? { reason: supersededReason(scheduledKind, view, superseded), neverPlanned: false }
        : skipReason(step, view.appointmentAt, nowMs, view.cancelledAt, everPlanned);
      rows.push({
        key: `skip-${scheduledKind}-${step.step_no}`,
        kind: "skipped",
        label: TEMPLATE_META[step.template_key]?.label ?? `Stufe ${step.step_no}`,
        reason: skip.reason,
        neverPlanned: skip.neverPlanned,
      });
    }
    groups.push({ cascadeKind: scheduledKind, rows, sortKey: "0" });
  }

  for (const [kind, list] of byKind) {
    groups.push({
      cascadeKind: kind,
      rows: list
        .slice()
        .sort((a, b) => a.due_at.localeCompare(b.due_at) || a.step_no - b.step_no)
        .map((t) => ({ key: t.id, kind: "touch" as const, touch: t })),
      sortKey: `1:${list[0]?.due_at ?? ""}`,
    });
  }

  // ── Ganz entwertete Kaskaden zuletzt: sie beschreiben, was NICHT mehr
  //    ansteht, und dürfen den offenen Stufen nicht die Aufmerksamkeit nehmen.
  for (const [kind, list] of supersededOnly) {
    groups.push({
      cascadeKind: kind,
      rows: list.map((t) => ({
        key: `sup-${t.id}`,
        kind: "skipped" as const,
        label: stepLabelOf(t.template_key, t.touch_kind, t.step_no),
        reason: supersededReason(kind, view, t),
        neverPlanned: false,
      })),
      sortKey: `2:${kind}`,
    });
  }

  groups.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return groups;
}

type TouchEntry = { cascadeKind: CascadeKind; touch: AppointmentCascadeTouch };

/**
 * Der Zustand einer Zeile im Rückblick — DREIWERTIG, nicht zweiwertig.
 *
 * Vorher stand hier ein `done: boolean`, und darin steckte der teuerste Fehler
 * des ersten Tages: Was nie geplant war, fiel damit zwangsläufig in denselben
 * Topf wie das Entfallene. Für die 223 Termine, die vor der Kaskade angelegt
 * wurden, schrieb das Panel deshalb „Es steht keine Erinnerung mehr aus. Was
 * war, steht unten." über eine Liste von Stufen, die es nie gegeben hat — drei
 * Behauptungen in einem Satz, alle drei falsch.
 *
 * `entfallen` und `nie_geplant` sehen im Ergebnis gleich aus (die Nachricht geht
 * nicht raus) und sind fachlich das Gegenteil voneinander: Entfallen heißt, wir
 * hatten etwas vor und haben es abgeräumt. Nie geplant heißt, wir hatten hier
 * nie etwas vor — und dann ist auch die Frage eine andere („was kann ich tun,
 * damit doch eine entsteht?").
 */
type HistoryEntryKind = "done" | "entfallen" | "nie_geplant";
type HistoryEntry = {
  key: string;
  cascadeKind: CascadeKind;
  label: string;
  reason: string;
  kind: HistoryEntryKind;
};

/**
 * Die Gruppen in zwei Stapel zerlegen: was noch aussteht und was schon
 * entschieden ist.
 *
 * Die Kaskaden-Grenze fällt dabei bewusst weg. Sie beschreibt die HERKUNFT
 * einer Stufe; die Frage am offenen Termin ist aber „was geht als Nächstes
 * raus?", und die kennt keine Herkunft. Welche Kaskade eine Zeile trägt, steht
 * weiterhin an ihr — aber nur, wenn der Termin überhaupt mehr als eine hat.
 */
function splitRows(groups: CascadeGroup[]): { pending: TouchEntry[]; history: HistoryEntry[] } {
  const pending: TouchEntry[] = [];
  const history: HistoryEntry[] = [];

  for (const g of groups) {
    for (const row of g.rows) {
      if (row.kind === "skipped") {
        history.push({
          key: row.key,
          cascadeKind: g.cascadeKind,
          label: row.label,
          reason: row.reason,
          kind: row.neverPlanned ? "nie_geplant" : "entfallen",
        });
      } else if (row.touch.done_at) {
        history.push({
          key: row.key,
          cascadeKind: g.cascadeKind,
          label: stepLabelOf(row.touch.template_key, row.touch.touch_kind, row.touch.step_no),
          reason: `Erledigt ${whenLabel(row.touch.done_at)}.`,
          kind: "done",
        });
      } else {
        pending.push({ cascadeKind: g.cascadeKind, touch: row.touch });
      }
    }
  }

  pending.sort((a, b) => a.touch.due_at.localeCompare(b.touch.due_at) || a.touch.step_no - b.touch.step_no);
  return { pending, history };
}

/**
 * Warum eine Kaskade keine gültige Stufe mehr hat — im Klartext, aus demselben
 * Grund wie bei `skipReason`: Eine Kaskade, die nach einem Ergebnis wortlos
 * verschwindet, ist von einem Fehler nicht zu unterscheiden.
 *
 * Einen Grund schreibt `superseded_at` NICHT mit, und eine Spalte dafür wäre
 * eine zweite Wahrheit neben `status`/`show_status` — abgeleitet wird deshalb
 * aus dem Zustand des Termins. Wo der Zustand nichts hergibt, sagt der Text
 * genau das und behauptet keinen Anlass, den niemand geprüft hat.
 *
 * Die Reihenfolge trägt zweimal: Eine bereits ERLEDIGTE Stufe ging real raus —
 * ihr „geht nicht mehr raus" wäre schlicht falsch, deshalb steht sie ganz vorn.
 * Und der No-Show-Fall steht VOR dem Ergebnis-Fall, weil ein korrigierter
 * Show-Status den Status der Zeile („no_show") stehen lässt — die Kette wäre
 * sonst mit dem Ergebnis begründet, das sie gerade widerlegt.
 *
 * Alle Sätze beginnen mit „Entfällt" — dasselbe Wort wie bei den nie
 * angelegten Stufen. Vorher stand hier „Entwertet", die wörtliche Übersetzung
 * des internen `superseded`, direkt neben einem „Entfällt": zwei Wörter für
 * dasselbe Ergebnis (die Nachricht geht nicht raus), und der Leser sucht nach
 * einem Unterschied, den es nicht gibt. Was sie unterscheidet, steht ohnehin im
 * Satz dahinter.
 */
function supersededReason(kind: CascadeKind, view: AppointmentCascadeView, touch: AppointmentCascadeTouch): string {
  if (touch.done_at) return `Erledigt ${whenLabel(touch.done_at)} — die Stufe steht nur noch in der Historie.`;
  if (view.cancelledAt) return "Entfällt — der Termin ist abgesagt.";
  if ((kind === "no_show_setting" || kind === "no_show_closing") && view.showStatus !== "no_show") {
    return "Entfällt — der Termin gilt inzwischen als stattgefunden. Die Nachfrage nach dem Nicht-Erscheinen ginge sonst real raus.";
  }
  if (view.status && view.status !== "offen") {
    return "Entfällt — das Ergebnis des Termins steht fest; diese Stufe geht nicht mehr raus.";
  }
  return "Entfällt — eine spätere Änderung am Termin hat diese Stufe abgeräumt.";
}

/**
 * Was ein übersprungener Plan ist: der Grund im Klartext UND die Antwort auf
 * die eine Frage, die der Grund nicht mehr hergibt — hat es diese Stufe je
 * gegeben? Beides zusammen, damit die Zusammenfassung die Unterscheidung nicht
 * am Satz nachbauen muss.
 */
type SkipInfo = { reason: string; neverPlanned: boolean };

/**
 * Warum eine konfigurierte Stufe keine Zeile hat — im Klartext.
 *
 * Vier Fälle, die man auseinanderhalten muss:
 *  1. Der Termin ist abgesagt — die Stufen sind bewusst abgeräumt.
 *  2. Er hat gar keinen Zeitpunkt — dann gibt es nichts zu terminieren.
 *  3. Für diesen Termin hat es NIE eine Kaskade gegeben.
 *  4. Die Stufe passte zeitlich nicht mehr (der Normalfall bei kurzfristigen
 *     Terminen, kein Fehler).
 *
 * Der Absage-Fall MUSS zuerst kommen: Ein in fünf Tagen abgesagter Termin fiel
 * sonst in den Zukunft-Zweig und riet direkt unter dem Absage-Banner, man solle
 * ihn verschieben — etwas, das `postponeAppointment` bei einem abgesagten
 * Termin ausdrücklich abweist.
 *
 * Fall 3 stand vorher nicht da, und das war am Tag der Einführung der teuerste
 * Fehler des Panels: Unter JEDEM bestehenden Zukunftstermin — für den es nie
 * eine Kaskade gab und nie geben konnte — behauptete der Rückfalltext eine
 * Zeitknappheit („beim Planen lagen weniger als 3 Tage bis zum Termin"), die
 * es nie gegeben hat. Wer nachrechnete, kam nicht hin und misstraute danach
 * jeder anderen Begründung im Panel. `everPlanned` beantwortet das aus den
 * Daten statt aus einem geratenen Einführungsdatum: Hat der Termin nie eine
 * Zeile der geplanten Kaskade getragen — auch keine entwertete, auch nicht den
 * Sofort-Touch —, dann ist nie eine angelegt worden.
 *
 * Bewusst NICHT über `planScheduledCascade` gerechnet: dessen `skipped` misst
 * gegen JETZT, nicht gegen den Planungszeitpunkt — bei einem Termin von gestern
 * wäre danach jede Stufe „entfallen", auch die längst verschickte.
 */
function skipReason(
  step: CascadeStep,
  appointmentAt: string | null,
  nowMs: number,
  cancelledAt: string | null,
  everPlanned: boolean,
): SkipInfo {
  if (cancelledAt) return { reason: "Entfällt — der Termin ist abgesagt.", neverPlanned: false };
  if (!appointmentAt) return { reason: "Entfällt — der Termin hat keinen Zeitpunkt.", neverPlanned: false };
  // Kurz und ohne Rat: Die Erklärung („stammt aus der Zeit davor") und der Weg
  // zu einer Kaskade stehen EINMAL in der Zusammenfassung des Panels statt
  // dreimal untereinander in der Aufklappung — und nur dort ist bekannt, ob der
  // Termin überhaupt noch bevorsteht. Einem längst geführten Gespräch zum
  // Verschieben zu raten, brächte nur eine sofort fällige Terminbestätigung für
  // einen Termin, der schon gelaufen ist.
  if (!everPlanned) {
    return { reason: "Nie geplant — diese Stufe hat es an diesem Termin nie gegeben.", neverPlanned: true };
  }
  const due = shiftBerlinMinutes(appointmentAt, -step.offset_minutes);
  if (due && new Date(due).getTime() > nowMs) {
    return {
      reason:
        "Nicht geplant — diese Stufe fehlt, obwohl ihre Fälligkeit noch bevorsteht. Termin verschieben erzeugt die Erinnerungen neu.",
      neverPlanned: false,
    };
  }
  return {
    reason: `Entfällt — beim Planen lagen weniger als ${offsetLabel(step.offset_minutes)} bis zum Termin.`,
    neverPlanned: false,
  };
}

/* ------------------------------------------------------------------ *
 * Bausteine
 * ------------------------------------------------------------------ */

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Kopieren kann in unsicheren Kontexten fehlschlagen — der Text steht
      // trotzdem sichtbar da und lässt sich markieren.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Text kopiert" : `${label} kopieren`}
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
  );
}

type Rendered = { body: string; subject: string | null; source: keyof typeof TEMPLATE_SOURCE_LABELS };

/** Kopfzeile einer Stufe: Zustand, Name, Fälligkeit, Herkunft des Textes. */
function TouchHead({
  touch,
  rendered,
  overdue,
  cascadeLabel,
}: {
  touch: AppointmentCascadeTouch;
  rendered: Rendered;
  overdue: boolean;
  /** Nur gesetzt, wenn an diesem Termin mehr als eine Kaskade hängt. */
  cascadeLabel: string | null;
}) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap", flex: 1, minWidth: 0 }}>
      {overdue ? (
        <AlertTriangle size={12} style={{ flexShrink: 0, color: "var(--danger-fg)" }} />
      ) : (
        <Circle size={10} style={{ flexShrink: 0, color: "var(--text-disabled)" }} />
      )}
      <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text-primary)" }}>
        {stepLabelOf(touch.template_key, touch.touch_kind, touch.step_no)}
      </span>
      <span
        className="tnum"
        style={{
          fontSize: "var(--fs-xs)",
          fontWeight: 500,
          color: overdue ? "var(--danger-fg)" : "var(--text-secondary)",
        }}
      >
        {overdue ? `überfällig seit ${whenLabel(touch.due_at)}` : `fällig ${whenLabel(touch.due_at)}`}
      </span>
      <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}>
        {cascadeLabel && (
          <Badge tone="neutral" style={{ height: 18, fontSize: "var(--fs-2xs)" }} title="Zu welcher Abfolge die Stufe gehört">
            {cascadeLabel}
          </Badge>
        )}
        {touch.requires_no_response && (
          <Badge tone="neutral" style={{ height: 18, fontSize: "var(--fs-2xs)" }}>
            nur ohne Antwort
          </Badge>
        )}
        <Badge tone="neutral" style={{ height: 18, fontSize: "var(--fs-2xs)" }} title="Herkunft des Textes">
          {TEMPLATE_SOURCE_LABELS[rendered.source]}
        </Badge>
      </span>
    </span>
  );
}

/** Der fertige Text samt Kopier-Knopf. */
function TouchBody({ rendered, label }: { rendered: Rendered; label: string }) {
  return (
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
      <CopyButton
        text={rendered.subject ? `${rendered.subject}\n\n${rendered.body}` : rendered.body}
        label={label}
      />
    </div>
  );
}

/**
 * Eine offene Stufe. `expanded` steht genau EINMAL im Panel — bei der nächsten
 * fälligen. Alle anderen sind ihre eigene Kopfzeile und geben den Text erst auf
 * Klick her: Drei ausgeschriebene Nachrichten untereinander beantworten die
 * Frage „was jetzt?" nicht besser als eine, sie machen sie nur schwerer
 * auffindbar.
 */
function TouchRow({
  touch,
  view,
  nowMs,
  cascadeLabel,
  expanded,
}: {
  touch: AppointmentCascadeTouch;
  view: AppointmentCascadeView;
  nowMs: number;
  cascadeLabel: string | null;
  expanded: boolean;
}) {
  const overdue = new Date(touch.due_at).getTime() <= nowMs;
  const label = stepLabelOf(touch.template_key, touch.touch_kind, touch.step_no);

  // Gegen die Vorlagen der ZUSTÄNDIGEN Person gerendert und live — eine später
  // geänderte Vorlage wirkt damit auch auf schon erzeugte, offene Stufen.
  const rendered = renderResolved(touch.template_key, view.bundle, {
    leadName: view.leadName,
    company: view.company,
    appointmentAtIso: touch.appointment_at,
    link: view.meetLink,
    kanal: view.channel ? CHANNEL_META[view.channel].label : null,
    absender: view.assignedUsername,
  });
  const head = <TouchHead touch={touch} rendered={rendered} overdue={overdue} cascadeLabel={cascadeLabel} />;

  if (expanded) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
        {head}
        <TouchBody rendered={rendered} label={label} />
      </div>
    );
  }

  return (
    <details>
      {/* `group-summary` statt `collapse-summary`: Letzteres ist das
          Karten-Rezept mit Hover-Fläche und Trennlinie (globals.css §6.10) und
          machte aus jeder Stufe eine eigene Karte in der Karte. */}
      <summary className="group-summary" style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
        <ChevronRight size={11} className="group-chevron" />
        {head}
      </summary>
      <div style={{ marginTop: "var(--sp-4)" }}>
        <TouchBody rendered={rendered} label={label} />
      </div>
    </details>
  );
}

/** Eine erledigte, entfallene oder nie geplante Stufe — eine Zeile plus Begründung. */
function HistoryRow({ entry, cascadeLabel }: { entry: HistoryEntry; cascadeLabel: string | null }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-4)" }}>
      {entry.kind === "done" ? (
        <Check size={12} style={{ flexShrink: 0, marginTop: 2, color: "var(--success-fg)" }} />
      ) : (
        <MinusCircle size={12} style={{ flexShrink: 0, marginTop: 2, color: "var(--text-disabled)" }} />
      )}
      <div style={{ minWidth: 0 }}>
        <span style={{ fontSize: "var(--fs-sm)", fontWeight: 500, color: "var(--text-muted)" }}>{entry.label}</span>
        {cascadeLabel && (
          <span style={{ marginLeft: "var(--sp-3)", fontSize: "var(--fs-2xs)", color: "var(--text-subtle)" }}>
            {cascadeLabel}
          </span>
        )}
        <p style={{ margin: "2px 0 0", fontSize: "var(--fs-xs)", color: "var(--text-subtle)", lineHeight: "var(--lh-snug)" }}>
          {entry.reason}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Panel
 * ------------------------------------------------------------------ */

export function CascadePanel({
  entityType,
  entityId,
  reloadToken = 0,
}: {
  entityType: "setting" | "closing";
  entityId: string;
  /** Hochzählen, sobald sich am Termin etwas geändert hat — der Editor kennt den Zeitpunkt. */
  reloadToken?: number;
}) {
  const [view, setView] = useState<AppointmentCascadeView | null>(null);
  const [failed, setFailed] = useState(false);

  // "Jetzt" für überfällig/kommt-noch: Muster ErinnerungenBoard — ein direkter
  // Date.now()-Aufruf im Render-Körper ist eine unreine Funktion.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    getAppointmentCascade(entityType, entityId)
      .then((res) => {
        if (!alive) return;
        setView(res);
        setFailed(false);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [entityType, entityId, reloadToken]);

  const groups = useMemo(
    () => (view && nowMs != null ? buildGroups(view, entityType, nowMs) : []),
    [view, entityType, nowMs],
  );

  const { pending, history } = useMemo(() => splitRows(groups), [groups]);
  // Der Bestandstermin: Es steht nichts aus, und es war auch nie etwas. Genau
  // diese Lage trifft am ersten Tag nach dem Deploy JEDEN vorhandenen Termin —
  // für die Kaskade gibt es bewusst keinen Backfill (docs §7).
  const nieGeplant = history.filter((e) => e.kind === "nie_geplant").length;
  const nurNieGeplant = history.length > 0 && nieGeplant === history.length;
  // Ob der Rat „verschieben" überhaupt einer ist: Bei einem Termin, der schon
  // gelaufen ist, entstünde daraus nur eine sofort fällige Terminbestätigung
  // für ein Gespräch, das längst geführt wurde.
  // `Date.parse("")` ist NaN und jeder Vergleich damit `false` — ein Termin ohne
  // Zeitpunkt steht also nicht bevor, ganz ohne zweite Abfrage.
  const terminAhead = Date.parse(view?.appointmentAt ?? "") > (nowMs ?? 0);
  // Die Kaskade wird nur benannt, wenn der Termin mehr als eine trägt. Bei
  // einer einzigen wäre der Badge an jeder Zeile dieselbe Auskunft — also keine.
  const multiCascade = new Set(groups.map((g) => g.cascadeKind)).size > 1;
  const cascadeLabelOf = (kind: CascadeKind) => (multiCascade ? CASCADE_KIND_LABELS[kind] : null);

  /* ── Der zugeklappte Kopf muss die Karte ersetzen ──
     Die Karte startet zu (siehe unten), und eine Aufklappung, die nur
     „Erinnerungen" sagt, zwingt zum Öffnen — gewonnen wäre damit nichts. Der
     Kopf trägt deshalb genau die beiden Angaben, wegen derer man das Panel
     überhaupt aufmacht: wie viel steht noch offen, und wann ist das Nächste
     fällig. Überfälliges bekommt zusätzlich Farbe und Zeichen; sonst müsste
     man die Uhrzeit im Kopf selbst gegen „jetzt" rechnen, und genau das ist
     die Frage, die die Karte beantworten soll. */
  const overdueCount =
    nowMs == null ? 0 : pending.filter((e) => new Date(e.touch.due_at).getTime() <= nowMs).length;
  // `pending` ist nach Fälligkeit aufsteigend sortiert (splitRows) — die erste
  // Zeile ist damit zugleich die nächste fällige UND die älteste überfällige.
  const nextDue = pending[0]?.touch.due_at ?? null;
  const summaryText =
    pending.length === 0
      ? "Keine offene Erinnerung"
      : overdueCount > 0
        ? `${pending.length} offen · ${overdueCount} überfällig seit ${whenLabel(nextDue)}`
        : `${pending.length} offen · nächste ${whenLabel(nextDue)}`;

  const channelBadge = view ? (
    <Badge tone={view.channel ? "info" : "warning"} title="Über welchen Kanal die Nachricht rausgeht">
      {view.channel ? (
        <>
          {CHANNEL_META[view.channel].icon} {CHANNEL_META[view.channel].label}
        </>
      ) : (
        "Kanal frei wählen"
      )}
    </Badge>
  ) : null;

  /**
   * Die Titelzeile — in beiden Bauformen dieselbe. Zugeklappt wird nur der
   * Normalfall: Ein Ladefehler und eine fehlende Migration hinter einem Pfeil
   * zu verstecken hieße, die Auskunft zu verstecken, um derentwillen die Karte
   * in diesem Zustand überhaupt noch da ist.
   */
  const header = (
    <div style={SECTION_HEAD}>
      <BellRing size={16} color="var(--text-muted)" />
      <span style={SECTION_TITLE}>Erinnerungen</span>
      <span style={{ ...SECTION_META, marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}>
        {channelBadge}
      </span>
    </div>
  );

  if (failed) {
    return (
      <div className="card">
        {header}
        <div style={SECTION_BODY}>
          <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--danger-fg)" }}>
            Die Erinnerungen konnten nicht geladen werden.
          </p>
        </div>
      </div>
    );
  }

  if (!view || nowMs == null) {
    return (
      <div className="card">
        {header}
        <div style={SECTION_BODY}>
          <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>Wird geladen …</p>
        </div>
      </div>
    );
  }

  /* ── Fehlendes Schema ist NICHT „nichts geplant" ── */
  if (!view.available) {
    return (
      <div className="card">
        {header}
        <div style={{ ...SECTION_BODY, flexDirection: "row", gap: "var(--sp-5)", alignItems: "flex-start" }}>
          <Database size={18} style={{ flexShrink: 0, marginTop: 2, color: "var(--danger-fg)" }} />
          <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-secondary)", maxWidth: "62ch" }}>
            Die Tabellen für die Erinnerungen fehlen in der Datenbank — die Migration ist noch nicht eingespielt. Das ist
            ausdrücklich <strong>nicht</strong> dasselbe wie &bdquo;nichts geplant&ldquo;: Für diesen Termin
            entsteht derzeit gar keine Erinnerung, und es geht keine Bestätigung raus.
          </p>
        </div>
      </div>
    );
  }

  /* ── Zugeklappt startet die Karte ──
     Auf einem Termin mit Vorgeschichte ist sie sehr lang, und die Detailseite
     dient dem Gespräch, nicht der Erinnerungsverwaltung. Gebaut mit dem
     Karten-Rezept aus globals.css §6.10 (`collapse-summary` + `collapse-chevron`)
     — dasselbe, mit dem die „Call-Details" im Closing-Editor zuklappen; ein
     zweiter Aufklapp-Mechanismus auf derselben Seite sähe aus wie ein anderes
     Bedienelement. Der Zustand ist bewusst nicht persistent: Was zu startet,
     startet beim nächsten Aufruf wieder zu. */
  return (
    <details className="card">
      <summary
        className="collapse-summary"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-4)",
          flexWrap: "wrap",
          padding: "var(--sp-6) var(--sp-8)",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <ChevronRight size={13} className="collapse-chevron" style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <BellRing size={16} color="var(--text-muted)" style={{ flexShrink: 0 }} />
        <span style={SECTION_TITLE}>Erinnerungen</span>
        <span
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          {overdueCount > 0 && <AlertTriangle size={12} style={{ flexShrink: 0, color: "var(--danger-fg)" }} />}
          <span
            className="tnum"
            style={{ ...SECTION_META, color: overdueCount > 0 ? "var(--danger-fg)" : undefined }}
          >
            {summaryText}
          </span>
          {channelBadge}
        </span>
      </summary>
      {/* Oben ohne Polster: die geöffnete `collapse-summary` bringt ihre eigene
          Trennlinie samt Abstand mit (§6.10). */}
      <div style={{ ...SECTION_BODY, padding: "0 var(--sp-8) var(--sp-7)" }}>
        {view.cancelledAt && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "var(--sp-4)",
              background: "var(--warning-bg)",
              border: "1px solid rgb(209 162 79 / 0.28)",
              borderRadius: "var(--r-sm)",
              padding: "var(--sp-4) var(--sp-5)",
            }}
          >
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2, color: "var(--warning-fg)" }} />
            {/* „entfallen" ist hier kein Synonym-Wechsel, sondern dasselbe Wort, das die Zeilen
                direkt darunter tragen (supersededReason/skipReason). Zwei Wörter für denselben
                Vorgang lesen sich im selben Panel wie zwei verschiedene Vorgänge. */}
            <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-secondary)" }}>
              Der Termin ist abgesagt — es gibt nichts mehr zu bestätigen. Offene Stufen sind entfallen; ein
              Ersatztermin wird als neuer Termin angelegt und bringt seine eigenen Erinnerungen mit.
            </p>
          </div>
        )}

        {groups.length === 0 ? (
          <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-muted)", maxWidth: "62ch" }}>
            {view.steps.length === 0
              ? "Für diese Organisation ist noch keine Abfolge von Erinnerungen konfiguriert — es entsteht deshalb keine."
              : "Für diesen Termin steht keine Erinnerung an."}
          </p>
        ) : (
          <>
            {/* ── Die eine Frage: was geht als Nächstes raus? ── */}
            {pending.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--sp-5)",
                  paddingLeft: "var(--sp-6)",
                  borderLeft: "2px solid var(--border-subtle)",
                }}
              >
                {pending.map((entry, i) => (
                  <TouchRow
                    key={entry.touch.id}
                    touch={entry.touch}
                    view={view}
                    nowMs={nowMs}
                    cascadeLabel={cascadeLabelOf(entry.cascadeKind)}
                    expanded={i === 0}
                  />
                ))}
              </div>
            )}

            {/* Zwei Lagen, die im Ergebnis gleich aussehen (es geht nichts mehr raus)
                und fachlich das Gegenteil voneinander sind. Der Satz muss sie trennen,
                sonst behauptet er beim Bestandstermin eine Vorgeschichte, die es nie
                gab — und schickt den Leser in eine Aufklappung, in der nichts steht,
                was je geplant war. Den Weg zurück nennt er nur, wenn er einer ist:
                „Verschieben" ist der EINZIGE Pfad, der für Erstgespräch und Closing
                gleichermaßen eine Kaskade neu anlegt (`postponeAppointment` ruft für
                beide Termin-Arten `generate*Cascade`); ein Speichern des Zeitpunkts
                gibt es beim Erstgespräch gar nicht. Und bei einem Termin, der schon
                gelaufen ist, brächte das Verschieben nur eine sofort fällige
                Bestätigung für ein längst geführtes Gespräch — deshalb `terminAhead`. */}
            {pending.length === 0 && history.length > 0 && (
              <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-muted)", maxWidth: "62ch" }}>
                {nurNieGeplant
                  ? terminAhead
                    ? "Für diesen Termin wurde nie eine Erinnerung geplant — Erinnerungen entstehen beim Anlegen oder Verschieben eines Termins, für ältere entsteht rückwirkend keine. Sobald er einmal verschoben wird, entstehen seine Erinnerungen."
                    : "Für diesen Termin wurde nie eine Erinnerung geplant — Erinnerungen entstehen beim Anlegen oder Verschieben eines Termins, für ältere entsteht rückwirkend keine. Das Gespräch liegt bereits hinter uns; ein Verschieben brächte jetzt nur eine Bestätigung für einen Termin, der längst gelaufen ist."
                  : "Es steht keine Erinnerung mehr aus. Was war, steht unten."}
              </p>
            )}

            {/* ── Historie: erledigt und entfallen in EINEM zugeklappten Block.
                 Sie muss auffindbar bleiben (ein Panel mit zwei statt drei
                 Stufen wäre sonst von einem Fehler nicht zu unterscheiden),
                 darf der offenen Stufe darüber aber nicht die Aufmerksamkeit
                 nehmen. ── */}
            {history.length > 0 && (
              <details>
                <summary
                  className="group-summary"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--sp-3)",
                    fontSize: "var(--fs-xs)",
                    color: "var(--text-muted)",
                  }}
                >
                  <ChevronRight size={11} className="group-chevron" />
                  {/* Die Beschriftung ist das Versprechen über den Inhalt: Wer
                      „Erledigt & entfallen" aufklappt und darin lauter Stufen findet,
                      die es nie gab, hält das Panel für kaputt. */}
                  {nurNieGeplant
                    ? `Nie geplant (${history.length})`
                    : `Erledigt & entfallen (${history.length})`}
                </summary>
                <div
                  style={{
                    marginTop: "var(--sp-4)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--sp-4)",
                    paddingLeft: "var(--sp-6)",
                    borderLeft: "2px solid var(--border-subtle)",
                  }}
                >
                  {history.map((entry) => (
                    <HistoryRow key={entry.key} entry={entry} cascadeLabel={cascadeLabelOf(entry.cascadeKind)} />
                  ))}
                </div>
              </details>
            )}
          </>
        )}

        {/* Die Anleitung braucht einen EIGENEN Riegel, nicht den der Stufenliste
            darüber: Sie erklärt, was mit einem Text zu tun ist — unter einem
            Bestandstermin stand sie über einer Karte, in der nirgends ein Text
            steht. Ein Arbeitsschritt, den man nicht ausführen kann, liest sich wie
            ein fehlendes Stück Oberfläche. */}
        {pending.length > 0 && (
          <p style={{ margin: 0, fontSize: "var(--fs-xs)", color: "var(--text-subtle)", lineHeight: "var(--lh-snug)" }}>
            <Clock size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
            Nichts geht automatisch raus: Text kopieren, über den genannten Kanal schicken, unter
            &bdquo;Erinnerungen&ldquo; abhaken.
          </p>
        )}
      </div>
    </details>
  );
}
