"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { setReminderTouchDone, type ReminderTouchWithContext } from "@/app/actions/reminders";
import {
  TOUCH_TYPE_LABELS,
  renderReminderTemplate,
  templateFieldFor,
  type ReminderSettings,
} from "@/lib/reminderCascade";
import { formatTerminParts } from "@/lib/apptTime";
import { Badge } from "@/components/ui/Badge";
import { Segmented } from "@/components/ui/Segmented";
import { AlertTriangle, Check, CheckCircle2, Clock, Copy } from "lucide-react";

// "Meine Erinnerungen heute" — eigenständige, stundengenaue Tagesansicht der
// Bestätigungs-Kaskade. Bewusst KEIN Ausbau des Nachfassen-Boards: andere
// Datenquelle (reminder_touches statt der 4-Quellen-Union), andere
// Granularität (Uhrzeit statt Tag).
//
// KEIN Auto-Versand: die Karte liefert nur den fertigen Text zum Kopieren,
// wie im Nachfassen-Board — ein Mensch schreibt und schickt die Nachricht.

type Props = {
  mine: ReminderTouchWithContext[];
  team: ReminderTouchWithContext[];
  settings: ReminderSettings;
  canTeamView: boolean;
};

const CHANNEL_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  telefon: "Anruf",
  whatsapp: "WhatsApp",
};

type BucketKey = "overdue" | "soon" | "today" | "week";

const BUCKET_LABELS: Record<BucketKey, string> = {
  overdue: "Überfällig",
  soon: "In der nächsten Stunde",
  today: "Heute",
  week: "Diese Woche",
};
const BUCKET_ORDER: readonly BucketKey[] = ["overdue", "soon", "today", "week"];

function bucketOf(dueAtIso: string, nowMs: number): BucketKey {
  const t = new Date(dueAtIso).getTime();
  if (t <= nowMs) return "overdue";
  if (t - nowMs <= 60 * 60_000) return "soon";
  const todayEnd = new Date(nowMs);
  todayEnd.setHours(23, 59, 59, 999);
  if (t <= todayEnd.getTime()) return "today";
  return "week";
}

function TouchRow({
  touch,
  settings,
  onToggled,
}: {
  touch: ReminderTouchWithContext;
  settings: ReminderSettings;
  onToggled: (id: string, done: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const done = Boolean(touch.done_at);

  // Live gegen die AKTUELLE Vorlage gerendert, nie gegen einen zum
  // Erzeugungszeitpunkt eingefrorenen Text — eine spätere Vorlagen-Änderung
  // wirkt sich damit auch auf schon erzeugte, noch offene Touches aus.
  const templateField = templateFieldFor(touch.entity_type, touch.touch_type);
  const text = renderReminderTemplate(settings[templateField], {
    leadName: touch.lead_name,
    company: touch.company,
    appointmentAtIso: touch.appointment_at,
  });
  const parts = formatTerminParts(touch.appointment_at);
  const href = touch.entity_type === "setting" ? `/setting/${touch.entity_id}` : `/closing/${touch.entity_id}`;

  function toggleDone() {
    const next = !done;
    startTransition(async () => {
      await setReminderTouchDone(touch.id, next);
      onToggled(touch.id, next);
    });
  }

  async function copyText() {
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
    <div
      className="card"
      style={{
        padding: "var(--sp-5) var(--sp-6)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-4)",
        opacity: isPending ? 0.6 : done ? 0.55 : 1,
        transition: "opacity 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-4)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "var(--fs-base)", fontWeight: 600, color: "var(--text-primary)" }}>
            {touch.lead_name ?? "Unbenannter Lead"}
          </div>
          {touch.company && (
            <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{touch.company}</div>
          )}
        </div>
        <div style={{ display: "flex", gap: "var(--sp-2)", flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Badge tone="neutral">{TOUCH_TYPE_LABELS[touch.touch_type]}</Badge>
          <Badge tone={touch.channel ? "info" : "warning"}>
            {touch.channel ? (CHANNEL_LABELS[touch.channel] ?? touch.channel) : "Kanal frei wählen"}
          </Badge>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-3)",
          fontSize: "var(--fs-sm)",
          color: "var(--text-secondary)",
        }}
      >
        <Clock size={12} style={{ flexShrink: 0 }} />
        {parts ? `Termin ${parts.date}, ${parts.time} Uhr` : "Termin —"}
        {touch.assigned_username && (
          <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: "var(--fs-xs)" }}>
            {touch.assigned_username}
          </span>
        )}
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
        <p
          style={{
            margin: 0,
            paddingRight: "1.75rem",
            fontSize: "var(--fs-sm)",
            lineHeight: 1.5,
            color: "var(--text-secondary)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {text}
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
            width: 24,
            height: 24,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: copied ? "var(--success-fg)" : "var(--text-muted)",
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)" }}>
        <a href={href} style={{ fontSize: "var(--fs-xs)", color: "var(--orange-300)", textDecoration: "none" }}>
          {touch.entity_type === "setting" ? "Zum Setting →" : "Zum Closing →"}
        </a>
        {/* Einzige Ueberschneidung mit /nachfassen: derselbe Nachfass-Kontakt
            steht dort zusaetzlich als Tages-Eintrag (Closing-Sektion). */}
        {touch.entity_type === "closing_followup" && (
          <a href="/nachfassen" style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", textDecoration: "none" }}>
            Auch in Nachfassen →
          </a>
        )}
        <label
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            fontSize: "var(--fs-sm)",
            color: "var(--text-secondary)",
            cursor: isPending ? "default" : "pointer",
          }}
        >
          <input type="checkbox" checked={done} disabled={isPending} onChange={toggleDone} />
          Erledigt
        </label>
      </div>
    </div>
  );
}

function TouchGrid({
  touches,
  settings,
  onToggled,
}: {
  touches: ReminderTouchWithContext[];
  settings: ReminderSettings;
  onToggled: (id: string, done: boolean) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "var(--sp-5)" }}>
      {touches.map((t) => (
        <TouchRow key={t.id} touch={t} settings={settings} onToggled={onToggled} />
      ))}
    </div>
  );
}

export function ErinnerungenBoard({ mine, team, settings, canTeamView }: Props) {
  const [view, setView] = useState<"mine" | "team">("mine");
  // Optimistischer Lokal-State fürs Häkchen — der Server-Wert kommt erst nach
  // dem nächsten vollen Reload zurück, bis dahin soll die Karte sofort reagieren.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  // "Jetzt" fuer die Bucket-Einteilung: Muster CalendarTimeGrid — ein
  // direkter Date.now()-Aufruf im Render-Koerper ist eine unreine Funktion
  // (react-hooks/purity); stattdessen minuetlich per Effekt nachfuehren.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const source = view === "team" ? team : mine;
  const touches = useMemo(
    () => source.map((t) => (t.id in overrides ? { ...t, done_at: overrides[t.id] ? new Date().toISOString() : null } : t)),
    [source, overrides],
  );

  const handleToggled = (id: string, done: boolean) => setOverrides((prev) => ({ ...prev, [id]: done }));

  const open = touches.filter((t) => !t.done_at);
  const done = touches.filter((t) => t.done_at);

  const buckets = new Map<BucketKey, ReminderTouchWithContext[]>();
  for (const key of BUCKET_ORDER) buckets.set(key, []);
  // Vor dem ersten Effekt-Tick (nowMs noch null) bleiben alle Buckets leer —
  // das ist ein Wimpernschlag bei Erstanzeige, kein Leerzustand-Flackern,
  // da die Karten selbst erst mit den Buckets zusammen erscheinen.
  if (nowMs != null) {
    for (const t of open) buckets.get(bucketOf(t.due_at, nowMs))!.push(t);
    for (const list of buckets.values()) list.sort((a, b) => a.due_at.localeCompare(b.due_at));
  }

  const overdueCount = buckets.get("overdue")!.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-7)" }}>
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
            <AlertTriangle size={14} /> {overdueCount} überfällig
          </span>
        )}
        {canTeamView && (
          <Segmented
            ariaLabel="Ansicht"
            value={view}
            onChange={setView}
            options={[
              { value: "mine", label: "Meine Erinnerungen" },
              { value: "team", label: "Team" },
            ]}
          />
        )}
      </div>

      {open.length === 0 ? (
        <div className="card fade-up dot-grid">
          <div className="empty-state">
            <CheckCircle2 size={24} aria-hidden style={{ color: "var(--success-fg)" }} />
            <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: "var(--text-primary)" }}>
              Nichts offen
            </div>
            <p style={{ maxWidth: 380 }}>
              Sobald ein Setting-, Closing- oder Nachfass-Termin bevorsteht, erscheint hier die fällige
              Bestätigungs-Erinnerung.
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
                <span className="count-pill">{buckets.get(key)!.length}</span>
              </div>
              <TouchGrid touches={buckets.get(key)!} settings={settings} onToggled={handleToggled} />
            </section>
          ))}
        </div>
      )}

      {done.length > 0 && (
        <details>
          <summary
            className="collapse-summary"
            style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", cursor: "pointer", userSelect: "none" }}
          >
            <span className="eyebrow eyebrow-muted">Bereits erledigt ({done.length})</span>
          </summary>
          <div style={{ marginTop: "var(--sp-5)" }}>
            <TouchGrid touches={done} settings={settings} onToggled={handleToggled} />
          </div>
        </details>
      )}
    </div>
  );
}
