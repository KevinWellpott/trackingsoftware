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
  | { key: string; kind: "skipped"; label: string; reason: string };

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
      rows.push({
        key: `skip-${scheduledKind}-${step.step_no}`,
        kind: "skipped",
        label: TEMPLATE_META[step.template_key]?.label ?? `Stufe ${step.step_no}`,
        reason: superseded
          ? supersededReason(scheduledKind, view, superseded)
          : skipReason(step, view.appointmentAt, nowMs, view.cancelledAt),
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
      })),
      sortKey: `2:${kind}`,
    });
  }

  groups.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return groups;
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
 */
function supersededReason(kind: CascadeKind, view: AppointmentCascadeView, touch: AppointmentCascadeTouch): string {
  if (touch.done_at) return `Erledigt ${whenLabel(touch.done_at)} — die Stufe steht nur noch in der Historie.`;
  if (view.cancelledAt) return "Entwertet — der Termin ist abgesagt.";
  if ((kind === "no_show_setting" || kind === "no_show_closing") && view.showStatus !== "no_show") {
    return "Entwertet — der Termin gilt inzwischen als stattgefunden. Die Nachfrage nach dem Nicht-Erscheinen ginge sonst real raus.";
  }
  if (view.status && view.status !== "offen") {
    return "Entwertet — das Ergebnis des Termins steht fest; diese Stufe geht nicht mehr raus.";
  }
  return "Entwertet — eine spätere Änderung am Termin hat diese Stufe abgeräumt.";
}

/**
 * Warum eine konfigurierte Stufe keine Zeile hat — im Klartext.
 *
 * Drei verschiedene Fälle, die man auseinanderhalten muss: Der Termin ist
 * abgesagt (dann sind die Stufen bewusst entwertet), die Stufe passte zeitlich
 * nicht mehr (der Normalfall bei kurzfristigen Terminen, kein Fehler), oder es
 * wurde für diesen Termin überhaupt nie eine Kaskade erzeugt (dann ist etwas
 * schiefgegangen). Unterschieden wird am Absage-Zeitpunkt und danach an der
 * Fälligkeit: läge sie noch in der Zukunft, müsste die Zeile da sein.
 *
 * Der Absage-Fall MUSS zuerst kommen: Ein in fünf Tagen abgesagter Termin fiel
 * sonst in den Zukunft-Zweig und riet direkt unter dem Absage-Banner „Termin
 * speichern oder verschieben erzeugt die Kaskade neu" — ein Rat, den
 * `postponeAppointment` bei einem abgesagten Termin ausdrücklich abweist.
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
): string {
  if (cancelledAt) return "Entwertet — der Termin ist abgesagt.";
  if (!appointmentAt) return "Entfällt — der Termin hat keinen Zeitpunkt.";
  const due = shiftBerlinMinutes(appointmentAt, -step.offset_minutes);
  if (due && new Date(due).getTime() > nowMs) {
    return "Nicht geplant — für diesen Termin wurde noch keine Erinnerung angelegt. Termin speichern oder verschieben erzeugt die Kaskade neu.";
  }
  return `Entfällt — beim Planen lagen weniger als ${offsetLabel(step.offset_minutes)} bis zum Termin.`;
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

function TouchRow({
  touch,
  view,
  nowMs,
}: {
  touch: AppointmentCascadeTouch;
  view: AppointmentCascadeView;
  nowMs: number;
}) {
  const done = Boolean(touch.done_at);
  const overdue = !done && new Date(touch.due_at).getTime() <= nowMs;

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)", opacity: done ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap" }}>
        {done ? (
          <Check size={12} style={{ flexShrink: 0, color: "var(--success-fg)" }} />
        ) : overdue ? (
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
            color: done ? "var(--text-muted)" : overdue ? "var(--danger-fg)" : "var(--text-secondary)",
          }}
        >
          {done
            ? `erledigt ${whenLabel(touch.done_at)}`
            : overdue
              ? `überfällig seit ${whenLabel(touch.due_at)}`
              : `fällig ${whenLabel(touch.due_at)}`}
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
          label={stepLabelOf(touch.template_key, touch.touch_kind, touch.step_no)}
        />
      </div>
    </div>
  );
}

/** Eine Stufe, die es nicht gibt — mit dem Grund daneben. */
function SkippedRow({ label, reason }: { label: string; reason: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-4)" }}>
      <MinusCircle size={12} style={{ flexShrink: 0, marginTop: 2, color: "var(--text-disabled)" }} />
      <div style={{ minWidth: 0 }}>
        <span style={{ fontSize: "var(--fs-sm)", fontWeight: 500, color: "var(--text-muted)" }}>{label}</span>
        <p style={{ margin: "2px 0 0", fontSize: "var(--fs-xs)", color: "var(--text-subtle)", lineHeight: "var(--lh-snug)" }}>
          {reason}
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

  const header = (
    <div style={SECTION_HEAD}>
      <BellRing size={16} color="var(--text-muted)" />
      <span style={SECTION_TITLE}>Erinnerungs-Kaskade</span>
      <span style={{ ...SECTION_META, marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}>
        {view && (
          <Badge tone={view.channel ? "info" : "warning"} title="Über welchen Kanal die Nachricht rausgeht">
            {view.channel ? (
              <>
                {CHANNEL_META[view.channel].icon} {CHANNEL_META[view.channel].label}
              </>
            ) : (
              "Kanal frei wählen"
            )}
          </Badge>
        )}
      </span>
    </div>
  );

  if (failed) {
    return (
      <div className="card">
        {header}
        <div style={SECTION_BODY}>
          <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--danger-fg)" }}>
            Die Kaskade konnte nicht geladen werden.
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
            Die Kaskaden-Tabellen fehlen in der Datenbank — die Migration ist noch nicht eingespielt. Das ist
            ausdrücklich <strong>nicht</strong> dasselbe wie &bdquo;nichts geplant&ldquo;: Für diesen Termin
            entsteht derzeit gar keine Erinnerung, und es geht keine Bestätigung raus.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      {header}
      <div style={SECTION_BODY}>
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
            <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-secondary)" }}>
              Der Termin ist abgesagt — es gibt nichts mehr zu bestätigen. Offene Stufen wurden entwertet; ein
              Ersatztermin wird als neuer Termin angelegt und bringt seine eigene Kaskade mit.
            </p>
          </div>
        )}

        {groups.length === 0 ? (
          <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-muted)", maxWidth: "62ch" }}>
            {view.steps.length === 0
              ? "Für diese Organisation ist noch keine Kaskade konfiguriert — es entstehen deshalb keine Erinnerungen."
              : "Für diesen Termin steht keine Erinnerung an."}
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.cascadeKind} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
              <div className="eyebrow eyebrow-muted" style={{ fontSize: "var(--fs-2xs)" }}>
                {CASCADE_KIND_LABELS[g.cascadeKind]}
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--sp-6)",
                  paddingLeft: "var(--sp-6)",
                  borderLeft: "2px solid var(--border-subtle)",
                }}
              >
                {g.rows.map((row) =>
                  row.kind === "touch" ? (
                    <TouchRow key={row.key} touch={row.touch} view={view} nowMs={nowMs} />
                  ) : (
                    <SkippedRow key={row.key} label={row.label} reason={row.reason} />
                  ),
                )}
              </div>
            </div>
          ))
        )}

        <p style={{ margin: 0, fontSize: "var(--fs-xs)", color: "var(--text-subtle)", lineHeight: "var(--lh-snug)" }}>
          <Clock size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
          Nichts geht automatisch raus: Text kopieren, über den genannten Kanal schicken, unter
          &bdquo;Erinnerungen&ldquo; abhaken.
        </p>
      </div>
    </div>
  );
}
