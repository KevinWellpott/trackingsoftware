"use client";

import {
  pushFollowUpDue,
  pushPhoneCallback,
  recycleContactedUndoable,
  recycleRespondedUndoable,
  undoNachfassenTask,
  type NachfassenActionResult,
  type NachfassenTask,
  type NachfassenUndo,
} from "@/app/actions/nachfassen";
import { excludeFromRecycle } from "@/app/actions/recycle";
// Bewusst `dropoutReasonLabel` statt der Recycling-Map: `schedule_recycle()`
// stempelt bei einem Erstgespraech den DISQUALIFIKATIONS-Code in
// `recycle_reason_code`, und von dessen acht Werten kennt die Recycling-Map nur
// vier — ausgerechnet „Kein Budget" und „Falscher Zeitpunkt" standen als
// „Unbekannt" auf der Karte, also die beiden Gruende, bei denen ein zweiter
// Anlauf am meisten Sinn ergibt. `dropoutReasonLabel` deckt alle vier
// Grund-Familien ab (und zeigt einen unbekannten Code roh, statt ihn still zu
// verbuchen) — dieselbe Funktion, mit der die Ablage denselben Code beschriftet.
import { dropoutReasonLabel } from "@/lib/dropoutLists";
import { TEMPLATE_SOURCE_LABELS } from "@/lib/messageTemplates";
import { contactAgeDays, lastContactLabel } from "@/lib/contactGap";
import { isOverdue, type DueGranularity } from "@/lib/dueState";
import { staleParts, staleTotal, type StaleCounts } from "@/lib/staleTasks";
import { isoToBerlinInput } from "@/lib/apptTime";
import { addDaysISO, localDateISO } from "@/lib/dates";
import { SETTING_STATUS_LABEL } from "@/lib/settingLabels";
import type { DossierEntityKind } from "@/lib/leadDossier";
import { LeadDossierSheet } from "@/components/lead/LeadDossierSheet";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { DateTimeField } from "@/components/ui/DateTimeField";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock,
  Copy,
  Database,
  FileText,
  Handshake,
  History,
  Phone,
  RefreshCw,
  Undo2,
  UserX,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

// Nachfassen-Board (Client): Union-Tasklist aus VIER Quellen — Telefon-Rückruf,
// Erstgespräch-Wiedervorlage, Closing-Wiedervorlage und Recycling. Kernwert:
// fertiger Text zum Kopieren — KEIN Auto-Versand.
// Layout: EINE Filterreihe → einklappbare Sektionen mit kompaktem Karten-Grid.
//
// LinkedIn steht hier nicht mehr (Begründung in actions/nachfassen.ts): Die
// Follow-up-Kadenz gehört an die Liste, wo auch Pitch-Text und FU-Sequenz
// liegen. Mit ihr sind die FU-Schnellauswahl und die vier FU-Sektionen
// entfallen — geblieben ist EINE Filterreihe.
//
// Die frühere Summary-Chip-Reihe darüber ist weg: Fünf ihrer sechs Zahlen
// standen vierzig Pixel über denselben Zahlen in den Filter-Pillen — und
// „Closing" fehlte ausgerechnet in der oberen Reihe. Wer sie als Tagesüberblick
// las, übersah seine Closing-Wiedervorlagen systematisch. Die eine Zahl, die es
// dort exklusiv gab („Überfällig"), ist als Filter-Pille in die verbleibende
// Reihe gewandert und schränkt jetzt zusätzlich ein, statt nur zu zählen.
//
// Die Texte kommen aus dem Vorlagen-Katalog; ihre Herkunft steht im `title` des
// Kopier-Knopfs statt als Badge auf jeder Karte — sie entscheidet im
// Arbeitsfluss nichts und interessiert genau einmal, wenn ein Text falsch
// aussieht.

type Props = {
  tasks: NachfassenTask[];
  /** Ausgeblendete Altlasten je Quelle (Grenzen: lib/staleTasks.ts). */
  hiddenStale: StaleCounts;
  /** true, wenn ?alle=1 aktiv ist und auch die Altlasten geladen wurden. */
  showingAll: boolean;
  /** false = Recycling-Schema fehlt (Migration 0033). NICHT „nichts fällig". */
  recyclingAvailable: boolean;
  /**
   * false = die Union-RPC hat nicht geantwortet; drei der vier Quellen fehlen.
   * NICHT „nichts fällig" — dann darf der grüne Leerzustand nicht erscheinen.
   */
  tasksAvailable: boolean;
};

type ChannelFilter = "alle" | NachfassenTask["source"];

// Kanalfarben kommen aus der Pipeline-Palette (DESIGN.md §3.6) und nicht aus
// den Semantik-Tokens: ein Kanal ist eine Kategorie, kein Status. Sie
// erscheinen ausschliesslich als Dot/Icon + Tint, nie als Flaechenfarbe.
const CHANNEL_META: Record<
  NachfassenTask["source"],
  { label: string; icon: React.ReactNode; color: string; bg: string; border: string }
> = {
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
  // Recycling ist kein Kanal wie die anderen drei — es sammelt terminal
  // negative Leads aus ALLEN vier Ursprungstabellen, LinkedIn eingeschlossen
  // (§ Konzept-Diskussion, Migration 0033). Eigene, bewusst neutrale Farbe
  // statt einer Kanalfarbe, damit die Karte nicht wie ein weiterer
  // Akquise-Kanal aussieht.
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
 * Zeitkörnung je Quelle. Drei der vier sind Tages-Aufgaben; nur der
 * Telefon-Rückruf trägt eine mit dem Lead VERABREDETE Uhrzeit (`callback_at`).
 *
 * Das steht hier und nicht am Datentyp, weil `nachfassen_tasks` die
 * Tages-Spalten nach `timestamptz` castet: Aus dem 06.09. wird Mitternacht
 * UTC, in Berlin 02:00. Nach dem Datentyp gelesen wäre jede Wiedervorlage ab
 * zwei Uhr morgens „überfällig" — und weil die RPC nur Fälliges liefert,
 * schlicht alles (lib/dueState.ts).
 */
const DUE_GRANULARITY: Record<NachfassenTask["source"], DueGranularity> = {
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
 * Die vier Quellen tragen in `entity_id` je eine andere Tabelle. Beim Recycling
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

/* ── Die vier Gewichte der Knopfreihe ──────────────────────────────────
   Vorher trug fast alles DIESELBE Pille: „Nochmal versucht" (schreibt in die
   Datenbank und verbrennt einen von zwei erlaubten Versuchen) sah aus wie „Zur
   Liste" (öffnet eine Seite), und „Endgültig raus" (sperrt den Lead für immer)
   unterschied sich davon nur durch eine graue Schriftfarbe. Auf einer Karte mit
   fünf gleich aussehenden Pillen gibt es keine Hierarchie — man liest jede
   einzeln, dreißigmal am Vormittag.

   Die vier Stufen sind die Varianten aus components/ui/Button.tsx (DESIGN.md
   §3.8), nur als Inline-Stil, weil die Karte ihre eigene 28-px-Zeile fährt:

     primaryBtnStyle → GENAU EINER je Karte: der erwartete nächste Schritt.
     linkBtnStyle    → sekundäre Aktion, die ebenfalls schreibt (getönt).
     navBtnStyle     → führt woandershin oder schlägt nach; schreibt NICHTS.
     dangerBtnStyle  → der eine unwiderrufliche Knopf.

   Damit ist auf einen Blick unterscheidbar, was etwas TUT und was nur FÜHRT —
   und der gefährlichste Knopf sieht als einziger gefährlich aus.            */
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

/* Navigieren und Nachschlagen: dieselbe Pille ohne Fläche und ohne Rand —
   genau die Ghost-Behandlung, die „Rückgängig" und „Abbrechen" auf dieser
   Karte schon tragen. Sie treten damit hinter die Aktionen zurück, statt mit
   ihnen um dieselbe Aufmerksamkeit zu konkurrieren. */
const navBtnStyle: React.CSSProperties = {
  ...linkBtnStyle,
  background: "transparent",
  borderColor: "transparent",
  color: "var(--text-muted)",
};

/* „Endgültig raus": die Danger-Variante (transparent + roter Rand). Kein
   gefüllter roter Knopf — das wäre der auffälligste Knopf der Karte, und der
   gehört dem erwarteten Schritt, nicht dem, den man fast nie will. Sichtbar
   ANDERS muss er trotzdem sein: Es gibt kein Entsperren in der Oberfläche. */
const dangerBtnStyle: React.CSSProperties = {
  ...linkBtnStyle,
  background: "transparent",
  borderColor: "rgb(214 90 82 / 0.40)",
  color: "var(--danger-fg)",
};

/* Der eine CTA einer Karte — GENAU EINER je Quelle, das ist die Regel:
   Telefon „Rückruf verschieben", Setting/Closing „Erledigt → +7 Tage",
   Recycling „Nochmal versucht". Er steht einmal hier statt viermal inline;
   vier Kopien derselben Pille laufen sonst auseinander. */
const primaryBtnStyle: React.CSSProperties = {
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
  cursor: "pointer",
  transition: "all 0.1s",
};

/* Grund-/Anlass-Badge in der Kopfzeile. Recycling und Erstgespräch benutzen
   bewusst DENSELBEN Baustein: Beide beantworten dieselbe Frage („warum liegt
   diese Karte hier?"), und zwei verschiedene Optiken dafür wären eine
   Unterscheidung ohne Unterschied. */
const reasonBadgeStyle: React.CSSProperties = {
  fontSize: "0.625rem",
  fontWeight: 600,
  color: "var(--text-muted)",
  background: "var(--surface-150)",
  border: "1px solid var(--border)",
  borderRadius: 99,
  padding: "0.1rem 0.4rem",
};

/* ── Erledigt, aber noch zurücknehmbar ────────────────────────────────
   Die Karte verschwand bisher in dem Moment, in dem eine Aktion durchlief —
   die Knöpfe liegen wenige Pixel nebeneinander, und ein Fehlgriff verschob
   eine Wiedervorlage oder verbrannte einen von zwei erlaubten
   Recycling-Versuchen. Auf /erinnerungen kann derselbe Nutzer längst jede
   Stufe einzeln zurücknehmen.

   Deshalb bleibt sie kurz gedimmt stehen und trägt einen Ghost-Knopf. Der
   Zustand liegt am BOARD, nicht an der Karte: `router.refresh()` läuft sofort
   (die Zähler in der Seitenleiste sollen stimmen), und danach liefert der
   Server die erledigte Aufgabe nicht mehr — ohne diesen Merge wäre die Karte
   samt Rückweg im selben Augenblick weg. */
const UNDO_WINDOW_MS = 9000;

type DoneEntry = {
  /** Die Aufgabe, wie sie war — der Server liefert sie nach dem Refresh nicht mehr. */
  task: NachfassenTask;
  /** null = diese Aktion ist nicht sauber umkehrbar; dann gibt es keinen Knopf. */
  undo: NachfassenUndo | null;
  label: string;
  /** Marke des Fensters — siehe `doneToken` im Board. */
  token: number;
};

type DoneApi = {
  entries: Record<string, DoneEntry>;
  mark: (task: NachfassenTask, undo: NachfassenUndo | null, label: string) => void;
  /** Rückgängig hat geklappt — Karte kehrt in den normalen Zustand zurück. */
  restore: (task: NachfassenTask) => void;
};

/** Derselbe Schlüssel wie im Grid — eine Aufgabe ist Quelle + Zeile. */
function taskKey(t: NachfassenTask): string {
  return `${t.source}-${t.entity_id}`;
}

/**
 * Vorschlag für den verschobenen Rückruf: derselbe Zeitpunkt einen Tag später.
 *
 * Bewusst nur ein VORSCHLAG in einem editierbaren Feld: `callback_at` ist mit
 * dem Lead verabredet (docs §1) — eine Uhrzeit, die die Software sich selbst
 * ausdenkt, wäre keine Angabe, sondern eine Behauptung. Die Tageszeit des
 * bisherigen Termins bleibt deshalb stehen; nur der Tag wandert.
 */
function callbackSuggestion(dueAt: string | null): string {
  const current = dueAt ? isoToBerlinInput(dueAt) : "";
  const day = current.slice(0, 10) || localDateISO();
  const time = current.slice(11, 16) || "09:00";
  return `${addDaysISO(day, 1)}T${time}`;
}

/**
 * Herkunft für den Rückweg der Detailseite.
 *
 * Ohne sie führt der „Zurück"-Link dort nach /termine — wer aus dem Board kam,
 * landete im Kalender, und das Board wurde beim Zurücknavigieren komplett neu
 * aufgebaut (Kanalfilter, Sektionszustand, Scrollposition weg).
 */
const FROM_NACHFASSEN = "?from=nachfassen";

/* ── Fehlermeldungen: was auf einer Vertriebs-Karte stehen darf ────────
   Die Server-Actions liefern zwei sehr verschiedene Sorten Text: eigene, für
   Menschen geschriebene Sätze („Nicht angemeldet.") — und alles, was Postgres
   durchreicht, etwa `new row violates row-level security policy for table
   "contacts"`. Das Zweite ist hier keine Information, sondern Rauschen: Es sagt
   nicht, was zu tun ist, und stand bisher als kleiner roter Text neben einer
   Karte, die aussah, als sei nichts passiert.
   Bekanntes geht deshalb wörtlich durch, alles andere wird zu EINEM Satz mit
   Handlungsanweisung. Die Rohmeldung bleibt im `title` für den, der sie
   braucht.                                                                */
const KNOWN_ERROR_MESSAGES: ReadonlySet<string> = new Set([
  "Nicht angemeldet.",
  "Nicht gefunden.",
  "Kontakt nicht gefunden.",
  "Kopieren fehlgeschlagen — Text bitte manuell markieren.",
  // Die beiden neuen Abhak-Aktionen schreiben über die Actions der
  // Detailseiten bzw. prüfen selbst — ihre Absagen sind Klartext und sollen
  // nicht unter „bitte erneut versuchen" verschwinden: „Keine Berechtigung"
  // wird durch einen zweiten Versuch nicht besser.
  "Keine Berechtigung.",
  "Bitte Datum und Uhrzeit für den Rückruf angeben.",
]);

const GENERIC_ERROR_MESSAGE = "Konnte nicht gespeichert werden — bitte erneut versuchen.";

function friendlyError(raw: string): string {
  const text = raw.trim();
  if (KNOWN_ERROR_MESSAGES.has(text)) return text;
  // Der Recycling-Hinweis wird in actions/recycle.ts zusammengesetzt und ist
  // bewusst länger als eine Zeile — er erklärt eine fehlende Migration und
  // gehört zu den Klartext-Meldungen, nicht zu den durchgereichten.
  if (text.startsWith("Recycling ist gerade nicht verfügbar")) return text;
  return GENERIC_ERROR_MESSAGE;
}

function TaskCard({ task, done }: { task: NachfassenTask; done: DoneApi }) {
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dossierOpen, setDossierOpen] = useState(false);
  // Offenes Verschiebe-Feld des Telefon-Rückrufs (Berlin-Wandzeit wie
  // <input type="datetime-local">); null = zu.
  const [callbackDraft, setCallbackDraft] = useState<string | null>(null);
  // Der Text steht standardmäßig auf drei Zeilen gekürzt. Aufklappbar, weil man
  // sonst blind kopiert: Ob ein {name}-Platzhalter wirklich ersetzt wurde,
  // sieht man erst am ganzen Text — und genau das ist die Sorge vor dem Senden.
  const [textOpen, setTextOpen] = useState(false);
  const { confirm, dialog } = useConfirm();

  const meta = CHANNEL_META[task.source];
  const granularity = DUE_GRANULARITY[task.source];
  const overdue = isOverdue(task.due_at, granularity);
  const dossierKind = dossierTargetOf(task);
  // Grober Schnitt statt echter Zeilenmessung: Ob der 3-Zeilen-Clamp greift,
  // weiß nur der Browser nach dem Layout. Ein Knopf, der bei einem
  // Zweizeiler nichts tut, ist schlimmer als einer, der bei einem
  // Grenzfall fehlt — deshalb bewusst konservativ.
  const textIsLong = task.prepared_text.length > 150 || task.prepared_text.split("\n").length > 3;
  const doneEntry = done.entries[taskKey(task)] ?? null;

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

  // Gemeinsamer Runner für alle "Klick löst Server-Action aus, Karte ist
  // danach erledigt"-Buttons. `label` steht anschließend auf der gedimmten
  // Karte: „Erledigt" allein sagt bei fünf verschiedenen Aktionen zu wenig,
  // um einen Fehlgriff zu erkennen — und genau dafür ist das Fenster da.
  const runAction = (promise: Promise<NachfassenActionResult>, label: string) => {
    setError(null);
    startTransition(async () => {
      const res = await promise;
      if (res.error) {
        setError(res.error);
        return;
      }
      setCallbackDraft(null);
      done.mark(task, res.undo ?? null, label);
    });
  };

  const undoNow = () => {
    if (!doneEntry?.undo) return;
    const token = doneEntry.undo;
    setError(null);
    startTransition(async () => {
      const res = await undoNachfassenTask(token);
      if (res.error) {
        setError(res.error);
        return;
      }
      done.restore(task);
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
        // Erledigt sieht aus wie „gerade in Arbeit" — dieselbe Abblendung, die
        // es hier schon gab. Die Karte ist dann fertig, aber noch da.
        opacity: isPending || doneEntry ? 0.55 : 1,
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
        {/* Der Besitzer-Badge ist ersatzlos weg: Das Board ist immer
            personenbezogen (die Server-Action filtert auf den eingeloggten
            Nutzer bzw. die aktive Datensicht), also konnte dort nur der eigene
            Name stehen — oder gar nichts, wenn die Quelle keinen mitliefert.
            Auf der halben Kartenmenge derselbe Name, den die Kopfzeile ohnehin
            trägt, auf der anderen Hälfte eine Lücke. */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
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
            <span style={reasonBadgeStyle}>
              {dropoutReasonLabel(task.recycle_reason ?? null)}
              {typeof task.recycle_attempt === "number" && task.recycle_attempt > 0
                ? ` · Versuch ${task.recycle_attempt + 1}`
                : ""}
            </span>
          )}
          {/* Anlass — nur beim Erstgespräch. Die Sektion vereint `no_show` und
              `unqualifiziert`: zwei völlig verschiedene Anlässe mit derselben
              Vorlage. Ohne diesen Badge musste man jede Karte einzeln öffnen,
              um zu wissen, was man überhaupt schreiben soll — bei
              „Unqualifiziert" steht deshalb auch der Grund dabei, denn davon
              hängt ab, ob der Text „passt es zeitlich jetzt besser?" oder
              „hat sich beim Budget etwas getan?" heißt. */}
          {task.source === "setting" && task.setting_status && (
            <span style={reasonBadgeStyle}>
              {SETTING_STATUS_LABEL[task.setting_status]}
              {task.setting_status === "unqualifiziert" && task.setting_disqualify_reason
                ? ` · ${dropoutReasonLabel(task.setting_disqualify_reason)}`
                : ""}
            </span>
          )}
        </div>
      </div>

      {/* ── Fälligkeit ──────────────────────────────────────────────────
          Die Herkunft des Textes stand hier als eigener Badge („Auslieferungs-
          text", „Deine Vorlage" …). Sie ist eine Auskunft über die Vorrangkette
          des Vorlagen-Katalogs und entscheidet im Arbeitsfluss nichts — sie
          interessiert genau einmal, wenn ein Text falsch aussieht. Dafür steht
          sie jetzt im `title` des Kopier-Knopfs, also dort, wo man sie sucht. */}
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
          {formatContactMoment(task.recent_contact_at)})
        </span>
      )}

      {/* ── Vorbereiteter Text: 3 Zeilen Vorschau, aufklappbar ────────────
          Der Clamp war hart und ohne Ausweg — man kopierte den Rest blind und
          konnte vor dem Absenden nicht prüfen, ob er stimmt. Bei Texten mit
          Namens-Platzhaltern ist genau das die Sorge.
          Bewusst ein Umschalter statt des details/collapse-summary-Bausteins:
          Der Vorschautext soll auch zugeklappt sichtbar bleiben, details
          versteckt seinen Inhalt aber vollständig — und den Clamp per CSS an
          details[open] zu hängen ginge nur in globals.css. */}
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
            ...(textOpen
              ? {}
              : {
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical" as const,
                }),
          }}
        >
          {task.prepared_text}
        </p>
        {textIsLong && (
          <button
            type="button"
            onClick={() => setTextOpen((v) => !v)}
            aria-expanded={textOpen}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.25rem",
              marginTop: "0.25rem",
              padding: 0,
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              fontSize: "0.6875rem",
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            <ChevronDown
              size={11}
              style={{ transform: textOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }}
            />
            {textOpen ? "Weniger" : "Ganzen Text anzeigen"}
          </button>
        )}
        <button
          type="button"
          onClick={copyText}
          aria-label={copied ? "Text kopiert" : "Text kopieren"}
          title={copied ? "Kopiert" : `Text kopieren — Quelle: ${TEMPLATE_SOURCE_LABELS[task.text_source]}`}
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

      {/* ── Aktionen je Kanal — oder, direkt nach dem Erledigen, der Rückweg ──
          Beides in DERSELBEN Reihe und als Entweder-oder: Eine erledigte
          Aufgabe soll nicht ein zweites Mal erledigt werden können, und die
          Fehlermeldung darunter gibt es weiterhin nur EINMAL (sie gehört zu
          beiden Zuständen — auch ein Rückgängig kann scheitern).
          Kein Rückgängig-Knopf, wenn die Aktion keinen Rückweg mitgeliefert
          hat („Endgültig raus" ist genau dieser Fall und hat es im
          Bestätigungsdialog angekündigt) — lieber gar keiner als einer, der
          einen Zustand rät. */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap", marginTop: "auto" }}>
        {doneEntry && (
          <>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.3rem",
                fontSize: "0.6875rem",
                fontWeight: 600,
                color: "var(--success-fg)",
              }}
            >
              <Check size={12} style={{ flexShrink: 0 }} /> {doneEntry.label}
            </span>
            {doneEntry.undo && (
              <button
                type="button"
                disabled={isPending}
                onClick={undoNow}
                title="Diese Aktion zurücknehmen — die Aufgabe steht danach wieder hier"
                style={{
                  ...linkBtnStyle,
                  background: "transparent",
                  borderColor: "transparent",
                  color: "var(--text-muted)",
                  cursor: isPending ? "default" : "pointer",
                }}
              >
                <Undo2 size={12} /> Rückgängig
              </button>
            )}
          </>
        )}

        {/* Telefon-Rückruf: verschieben statt „+7 Tage".
            `callback_at` ist der einzige Fälligkeitswert dieses Boards mit
            einer MIT DEM LEAD VERABREDETEN Uhrzeit (DUE_GRANULARITY: moment).
            Ein festes Intervall wäre dort fachlich falsch, eine automatisch
            gesetzte Uhrzeit eine Behauptung — deshalb ein Feld mit Vorschlag
            (morgen, gleiche Uhrzeit) statt eines stillen Sprungs. */}
        {!doneEntry && task.source === "telefon" && (
          <>
            {callbackDraft === null ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() => setCallbackDraft(callbackSuggestion(task.due_at))}
                style={{ ...primaryBtnStyle, cursor: isPending ? "default" : "pointer" }}
                title="Neuen Rückruf-Zeitpunkt setzen, ohne die Seite zu verlassen"
              >
                <CalendarClock size={12} /> Rückruf verschieben
              </button>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap", width: "100%" }}>
                <DateTimeField
                  value={callbackDraft}
                  onChange={setCallbackDraft}
                  disabled={isPending}
                  ariaLabel="Neuer Rückruf-Zeitpunkt"
                  style={{ flex: 1, minWidth: 180 }}
                />
                <button
                  type="button"
                  disabled={isPending || !callbackDraft}
                  onClick={() => runAction(pushPhoneCallback(task.entity_id, callbackDraft), "Rückruf verschoben")}
                  style={{ ...primaryBtnStyle, cursor: isPending ? "default" : "pointer" }}
                  title="Neuen Zeitpunkt speichern — die Karte steht dann erst wieder dort"
                >
                  <Check size={12} /> Speichern
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setCallbackDraft(null)}
                  style={navBtnStyle}
                  title="Zeitpunkt unverändert lassen"
                >
                  Abbrechen
                </button>
              </div>
            )}
            {/* Ab hier: Wege, keine Aktionen — deshalb ohne Fläche. */}
            {task.list_id && (
              <Link href={`/telefon/${task.list_id}`} style={navBtnStyle} title="Telefonliste im Call-Modus öffnen">
                <Phone size={12} /> Anrufen
              </Link>
            )}
            {task.phone && (
              /* Die Rufnummer war die einzige orange GEFÜLLTE Pille der Karte
                 und damit auffälliger als der eigentliche Hauptknopf daneben.
                 Sie bleibt anklickbar (tel:) und behält die Akzentfarbe als
                 SCHRIFT — ein Link, kein zweiter CTA. */
              <a
                href={`tel:${task.phone.replace(/[^\d+]/g, "")}`}
                style={{ ...navBtnStyle, color: "var(--orange-300)" }}
                title="Nummer direkt wählen"
              >
                {task.phone}
              </a>
            )}
          </>
        )}

        {/* Setting und Closing tragen ein TAGESDATUM (`follow_up_due`) und
            bekommen deshalb ein festes Intervall: eine Woche, gerechnet ab
            HEUTE — bei einer überfälligen Aufgabe läge sie sonst sofort wieder
            in der Vergangenheit. Der Weg daneben bleibt: wer das Gespräch
            führen will, braucht die Detailseite weiterhin. */}
        {!doneEntry && task.source === "setting" && (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={() => runAction(pushFollowUpDue("setting", task.entity_id), "Wiedervorlage in 7 Tagen")}
              style={{ ...primaryBtnStyle, cursor: isPending ? "default" : "pointer" }}
              title="Kontakt erledigt — Wiedervorlage eine Woche weiter"
            >
              <CheckCheck size={12} /> Erledigt → +7 Tage
            </button>
            <Link
              href={`/setting/${task.entity_id}${FROM_NACHFASSEN}`}
              style={navBtnStyle}
              title="Erstgespräch öffnen — Qualifizierung, Notizen, Ergebnis"
            >
              <ClipboardCheck size={12} /> Zum Setting
            </Link>
          </>
        )}

        {!doneEntry && task.source === "closing" && (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={() => runAction(pushFollowUpDue("closing", task.entity_id), "Wiedervorlage in 7 Tagen")}
              style={{ ...primaryBtnStyle, cursor: isPending ? "default" : "pointer" }}
              title="Kontakt erledigt — Wiedervorlage eine Woche weiter, zur selben Uhrzeit"
            >
              <CheckCheck size={12} /> Erledigt → +7 Tage
            </button>
            <Link
              href={`/closing/${task.entity_id}${FROM_NACHFASSEN}`}
              style={navBtnStyle}
              title="Abschlussgespräch öffnen — Deal, Einwand, Ergebnis"
            >
              <Handshake size={12} /> Zum Closing
            </Link>
          </>
        )}

        {/* Recycling: erst die beiden Aktionen, dann der Weg. Vorher stand der
            Sprung-Link VOR ihnen und sah genauso aus — vier gleiche Pillen ohne
            erkennbaren Hauptknopf. „Nochmal versucht" ist hier der erwartete
            Schritt (Text kopieren, rausschicken, notieren) und trägt deshalb
            als einziges den CTA; „Reagiert" ist die Ausnahme und bleibt die
            getönte Zweitaktion. */}
        {!doneEntry && task.source === "recycling" && task.recycle_origin && (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                // Der Grund kommt seit Migration 0033 aus der Ursprungszeile,
                // nicht mehr vom Client — sonst liesse sich per direktem POST
                // jede beliebige Wartezeit ausloesen (actions/recycle.ts). Die
                // Hülle drumherum liest nur den Stand VOR dem Klick, damit ein
                // Fehlgriff nicht einen von zwei erlaubten Versuchen verbrennt.
                runAction(recycleContactedUndoable(task.recycle_origin!, task.entity_id), "Versuch notiert")
              }
              style={{ ...primaryBtnStyle, cursor: isPending ? "default" : "pointer" }}
              title="Kontaktiert, noch kein Ergebnis — nächster Versuch nach der eingestellten Wartezeit"
            >
              <RefreshCw size={12} /> Nochmal versucht
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                runAction(recycleRespondedUndoable(task.recycle_origin!, task.entity_id), "Als reagiert markiert")
              }
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
            {task.recycle_origin === "linkedin" && task.list_id && (
              <Link href={`/lists/${task.list_id}`} style={navBtnStyle} title="Pitch-Liste dieses Kontakts öffnen">
                Zur Liste <ArrowUpRight size={12} />
              </Link>
            )}
            {task.recycle_origin === "telefon" && task.list_id && (
              <Link href={`/telefon/${task.list_id}`} style={navBtnStyle} title="Telefonliste im Call-Modus öffnen">
                <Phone size={12} /> Anrufen
              </Link>
            )}
            {task.recycle_origin === "setting" && (
              <Link
                href={`/setting/${task.entity_id}${FROM_NACHFASSEN}`}
                style={navBtnStyle}
                title="Erstgespräch öffnen — Qualifizierung, Notizen, Ergebnis"
              >
                <ClipboardCheck size={12} /> Zum Setting
              </Link>
            )}
            {task.recycle_origin === "closing" && (
              <Link
                href={`/closing/${task.entity_id}${FROM_NACHFASSEN}`}
                style={navBtnStyle}
                title="Abschlussgespräch öffnen — Deal, Einwand, Ergebnis"
              >
                <Handshake size={12} /> Zum Closing
              </Link>
            )}
          </>
        )}

        {/* Gesprächsvorbereitung, deshalb VOR dem Anruf und ohne die
            Arbeitsliste zu verlassen: das Dossier öffnet als Overlay und lädt
            erst beim Öffnen (acht Abfragen je Karte im Voraus wären der Preis
            für etwas, das man je Sitzung einmal liest). Neben den
            Sprung-Knöpfen, weil es dieselbe Frage beantwortet — wo komme ich
            an diesen Lead heran —, nur ohne wegzunavigieren. */}
        {!doneEntry && dossierKind && (
          <button
            type="button"
            onClick={() => setDossierOpen(true)}
            style={navBtnStyle}
            title="Alles zu diesem Lead — Verlauf, Kontaktwege, Notizen"
          >
            <FileText size={12} /> Details
          </button>
        )}

        {/* Rohmeldung nur im `title`: Ein durchgereichtes
            „new row violates row-level security policy" sagt dem Vertrieb
            nichts, das er tun könnte.
            Der Span steht VOR „Endgültig raus", nicht dahinter: Dessen
            `marginLeft: auto` schluckt den freien Platz links davon — ein
            Element danach nähme ihm die rechte Kante und schöbe den
            Sperr-Knopf ausgerechnet in dem Moment nach links, in dem gerade
            ein Fehler erschienen ist, also unter den Zeiger, der eben noch
            auf „Nochmal versucht" lag. */}
        {error && (
          <span
            title={friendlyError(error) === error ? undefined : error}
            style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--color-error-text)" }}
          >
            {friendlyError(error)}
          </span>
        )}

        {/* ── „Endgültig raus" ──────────────────────────────────────────
            Steht bewusst am ENDE der Knopfreihe, rechts abgesetzt UND als
            einziger in der Danger-Variante — nicht mehr als dritte von drei
            gleich aussehenden Pillen direkt neben „Reagiert": Ein Fehlgriff auf
            28 Pixel Höhe kostete den Lead für immer — die Oberfläche kennt kein
            Entsperren, und `reviveBlockedReason()` verweigert danach zusätzlich
            jede Rückholung. Drei Dinge tragen das zusammen: die Position, die
            Optik und die Rückfrage, die es ausspricht. */}
        {!doneEntry && task.source === "recycling" && task.recycle_origin && (
          <button
            type="button"
            disabled={isPending}
            onClick={async () => {
              const ok = await confirm({
                title: "Endgültig sperren?",
                message: (
                  <>
                    <strong>{task.lead_name ?? "Dieser Lead"}</strong>
                    {task.company ? ` (${task.company})` : ""} kommt damit auf die Sperrliste: keine Wiedervorlage
                    mehr, und auch kein Zurückholen in den Funnel.
                    <br />
                    <br />
                    <strong>Das lässt sich hier nicht rückgängig machen.</strong> Nur wählen, wenn der Lead
                    ausdrücklich nicht mehr kontaktiert werden will.
                  </>
                ),
                confirmLabel: "Endgültig sperren",
                cancelLabel: "Abbrechen",
                destructive: true,
              });
              // Bewusst OHNE Rückweg: Die Aktion setzt `recycle_excluded_at`
              // und nullt die Wiedervorlage — der Dialog hat gerade
              // ausdrücklich zugesagt, dass sich das hier nicht rückgängig
              // machen lässt, und `reviveBlockedReason()` verweigert danach
              // jede Rückholung. Ein Knopf, der dem widerspricht, wäre
              // schlimmer als keiner.
              if (ok) runAction(excludeFromRecycle(task.recycle_origin!, task.entity_id), "Endgültig gesperrt");
            }}
            style={{
              ...dangerBtnStyle,
              marginLeft: "auto",
              cursor: isPending ? "default" : "pointer",
            }}
            title="Dauerhaft sperren — kein weiterer Kontaktversuch, nicht rückgängig zu machen"
          >
            <UserX size={12} /> Endgültig raus
          </button>
        )}
      </div>

      {dialog}

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
function CardGrid({ tasks, done }: { tasks: NachfassenTask[]; done: DoneApi }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        gap: "0.75rem",
      }}
    >
      {tasks.map((t) => (
        <TaskCard key={taskKey(t)} task={t} done={done} />
      ))}
    </div>
  );
}

type Section = { key: string; label: string; tasks: NachfassenTask[] };

/* ── Optik je Sektion ──────────────────────────────────────────────────
   Die Icon-Kachel traegt die KANAL-Farbe (Identitaet), der Badge-Ton die
   DRINGLICHKEIT. Vorher war beides Orange — vier Sektionen im Akzent haben
   das Budget der ganzen Seite aufgebraucht.                               */
const SECTION_META: Record<
  string,
  { icon: React.ReactNode; bg: string; color: string; tone: BadgeTone }
> = {
  telefon: { icon: <Phone size={12} />, bg: "rgb(78 128 214 / 0.10)", color: "var(--stage-telefon)", tone: "info" },
  setting: { icon: <ClipboardCheck size={12} />, bg: "rgb(139 92 246 / 0.10)", color: "var(--stage-setting)", tone: "neutral" },
  closing: { icon: <Handshake size={12} />, bg: "var(--success-bg)", color: "var(--success-fg)", tone: "success" },
  recycling: { icon: <RefreshCw size={12} />, bg: "var(--surface-3)", color: "var(--text-muted)", tone: "neutral" },
};

/**
 * Die Sektionen, deren Vorgänge zusätzlich in /erinnerungen stehen — und was
 * dort konkret liegt. Nur diese beiden: Telefon-Rückrufe und Recycling
 * erzeugen keine Kaskade (das Recycling eines verlorenen Closings folgt Wochen
 * NACH dessen „Kein Abschluss"-Kette; ein Verweis zeigte dort auf lauter
 * erledigte Stufen). Das gilt unverändert — es sind genau die beiden
 * Überschneidungen aus docs §1, und keine davon hing an LinkedIn.
 */
const SECTION_CROSSLINK: Record<string, { label: string; title: string } | undefined> = {
  closing: {
    label: "Stundengenaue Bestätigungs-Erinnerungen zu diesen Kontakten, sofern welche bestehen",
    title:
      "Erinnerungen entstehen erst, wenn der Termin angelegt oder verschoben wird — für Vorgänge aus der Zeit davor steht dort nichts.",
  },
  setting: {
    label: "No-Show-Kette zu den nicht erschienenen Terminen, sofern eine Kette läuft",
    title:
      "Die Kette startet in dem Moment, in dem „nicht erschienen“ als Ergebnis eingetragen wird — für früher eingetragene No-Shows steht dort nichts.",
  },
};

/* ── Einklappbare Sektion: Header (Chevron + Kachel + Titel + Badge + Divider + Meta) ── */
function CollapsibleSection({
  section,
  collapsed,
  onToggle,
  done,
}: {
  section: Section;
  collapsed: boolean;
  onToggle: () => void;
  done: DoneApi;
}) {
  const meta = SECTION_META[section.key] ?? SECTION_META["fu-weitere"];
  const crosslink = SECTION_CROSSLINK[section.key];
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
      {!collapsed && crosslink && (
        <div style={{ margin: "0 0 0.625rem 1.75rem" }}>
          <Link
            href="/erinnerungen"
            /* Die Bedingung gehoert an den Link selbst: Wer dort landet und die
               Seite leer vorfindet, haelt sonst die Erinnerungen fuer kaputt statt
               den Vorgang fuer alt. */
            title={crosslink.title}
            style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.6875rem", color: "var(--orange-300)", textDecoration: "none" }}
          >
            <Clock size={11} /> {crosslink.label} → Erinnerungen
          </Link>
        </div>
      )}
      {!collapsed && (
        <div id={gridId}>
          <CardGrid tasks={section.tasks} done={done} />
        </div>
      )}
    </section>
  );
}

/* ── Eine Quelle liefert nicht: NICHT der grüne Leerzustand ────────────
   Der rote Kasten ist der EINE Baustein für „diese Quelle konnte gerade nichts
   sagen" — beide Ausfälle benutzen ihn, damit sie sich nicht unterschiedlich
   anfühlen. Anders als auf /erinnerungen und in /ablage fällt hier nie die
   ganze Seite aus: Die vier Quellen hängen an verschiedenen Migrationen und
   verschiedenen RPCs. Der Kasten sagt deshalb ausdrücklich, WELCHER Teil fehlt
   — und ebenso ausdrücklich, dass das nicht „nichts zu tun" bedeutet.       */
function UnavailableNotice({ title, children }: { title: string; children: React.ReactNode }) {
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
        <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: "var(--danger-fg)" }}>{title}</div>
        <p style={{ margin: "var(--sp-3) 0 0", fontSize: "var(--fs-sm)", color: "var(--text-secondary)", maxWidth: "62ch" }}>
          {children}
        </p>
      </div>
    </div>
  );
}

export function NachfassenBoard({
  tasks,
  hiddenStale,
  showingAll,
  recyclingAvailable,
  tasksAvailable,
}: Props) {
  const [filter, setFilter] = useState<ChannelFilter>("alle");
  // Zusatzfilter „nur Überfälliges" — die einzige Zahl, die es in der
  // gestrichenen Chip-Reihe exklusiv gab. Als reine Kennzahl war sie tot; als
  // Filter macht sie den Vormittag sortierbar.
  const [overdueOnly, setOverdueOnly] = useState(false);
  // Eingeklappte Sektionen (Standard: alle offen)
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});

  const toggleSection = (key: string) => setCollapsedMap((prev) => ({ ...prev, [key]: !prev[key] }));

  /* ── Erledigte Karten mit offenem Rückweg ───────────────────────────
     Sie liegen HIER und nicht in der Karte: `router.refresh()` läuft sofort
     nach jeder Aktion (die Zähler in der Seitenleiste sollen stimmen), und
     danach liefert der Server die erledigte Aufgabe nicht mehr — die Karte
     würde im selben Moment ausgehängt und mit ihr der Rückweg. Der Merge
     unten hält sie für die Dauer des Fensters am Leben.

     Die Zählungen in den Pillen und Sektions-Badges beziehen die gedimmten
     Karten mit ein. Das ist Absicht: Sie stehen sichtbar auf dem Schirm, und
     eine Zahl, die weniger nennt, als man sieht, ist der schlimmere Fehler. */
  const router = useRouter();
  const [doneMap, setDoneMap] = useState<Record<string, DoneEntry>>({});
  // Fortlaufende Marke je Eintrag. Ohne sie räumte der Timer eines
  // zurückgenommenen und danach erneut erledigten Vorgangs die ZWEITE
  // Erledigung vorzeitig weg.
  const doneToken = useRef(0);

  const doneApi = useMemo<DoneApi>(() => {
    const drop = (key: string, token?: number) =>
      setDoneMap((prev) => {
        if (!prev[key] || (token !== undefined && prev[key].token !== token)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    return {
      entries: doneMap,
      mark: (task, undo, label) => {
        const key = taskKey(task);
        const token = ++doneToken.current;
        setDoneMap((prev) => ({ ...prev, [key]: { task, undo, label, token } }));
        router.refresh();
        window.setTimeout(() => drop(key, token), UNDO_WINDOW_MS);
      },
      restore: (task) => {
        drop(taskKey(task));
        router.refresh();
      },
    };
  }, [doneMap, router]);

  /**
   * Aufgabenliste + die gerade erledigten, die der Server schon nicht mehr
   * kennt. Ein Eintrag, den der Server WEITERHIN liefert (etwa weil die Aktion
   * die Fälligkeit nur verschoben hat und der Refresh noch läuft), wird nicht
   * verdoppelt — der frische Stand gewinnt.
   */
  const withDone = useMemo(() => {
    const entries = Object.values(doneMap);
    if (entries.length === 0) return tasks;
    const known = new Set(tasks.map(taskKey));
    return [...tasks, ...entries.filter((e) => !known.has(taskKey(e.task))).map((e) => e.task)];
  }, [tasks, doneMap]);

  // Der Überfällig-Filter schneidet VOR allem anderen: Danach beschreiben die
  // Zahlen in den Kanal-Pillen dieselbe Menge, die unten steht. Zwei Zählweisen
  // nebeneinander waren genau der Fehler der alten Chip-Reihe.
  const base = useMemo(
    () => (overdueOnly ? withDone.filter((t) => isOverdue(t.due_at, DUE_GRANULARITY[t.source])) : withDone),
    [withDone, overdueOnly],
  );

  // Überfällige zuerst, danach aufsteigend nach Fälligkeit
  const sorted = useMemo(() => [...base].sort((a, b) => dueSortKey(a) - dueSortKey(b)), [base]);

  const counts = useMemo(() => {
    const c: Record<ChannelFilter, number> = {
      alle: base.length,
      telefon: 0,
      setting: 0,
      closing: 0,
      recycling: 0,
    };
    for (const t of base) c[t.source] += 1;
    return c;
  }, [base]);

  // Immer über ALLE Aufgaben — die Pille sagt, wie viel es zu holen gäbe, auch
  // wenn gerade nach Kanal gefiltert wird.
  const overdueCount = useMemo(
    () => withDone.reduce((n, t) => (isOverdue(t.due_at, DUE_GRANULARITY[t.source]) ? n + 1 : n), 0),
    [withDone],
  );

  // Ausgeblendete Altlasten — die eine Zahl, die diese Seite versteckt. Sie
  // wird eine Bildschirmhöhe weiter unten sichtbar genannt, samt Ausweg.
  const staleHidden = staleTotal(hiddenStale);

  // Sektionen: Rückrufe ZUERST, dann Setting, Closing, Recycling. Leere
  // Sektionen werden nicht gerendert.
  //
  // WARUM der Rückruf oben steht: Er ist die einzige Aufgabe des Boards mit
  // einer MIT DEM LEAD VERABREDETEN Uhrzeit (`DUE_GRANULARITY: moment`, docs
  // §1). Alle anderen haben den ganzen Tag Zeit. Unter bis zu vier
  // LinkedIn-Sektionen rief man um 11:30 zurück, was für 09:00 zugesagt war —
  // die sind zwar weg, die Begründung für die Reihenfolge bleibt.
  const sections = useMemo<Section[]>(() => {
    const s: Section[] = [];
    if (filter === "alle" || filter === "telefon") {
      const group = sorted.filter((t) => t.source === "telefon");
      if (group.length > 0) s.push({ key: "telefon", label: "Rückrufe", tasks: group });
    }
    if (filter === "alle" || filter === "setting") {
      const group = sorted.filter((t) => t.source === "setting");
      if (group.length > 0) s.push({ key: "setting", label: "Setting (No-Show & Unqualifiziert)", tasks: group });
    }
    if (filter === "alle" || filter === "closing") {
      const group = sorted.filter((t) => t.source === "closing");
      if (group.length > 0) s.push({ key: "closing", label: "Closing", tasks: group });
    }
    // EINE Recycling-Sektion für alle vier Ursprünge (§ Konzept-Diskussion) —
    // bewusst nicht nach Ursprung aufgesplittet, die Origin-Badge auf der
    // Karte zeigt das je Zeile.
    if (filter === "alle" || filter === "recycling") {
      const group = sorted.filter((t) => t.source === "recycling");
      if (group.length > 0) s.push({ key: "recycling", label: "Recycling", tasks: group });
    }
    return s;
  }, [sorted, filter]);

  // Eine Auswahl ist aktiv — dann heißt „nichts sichtbar" nicht „nichts zu tun".
  const filterActive = filter !== "alle" || overdueOnly;

  // Ein Filter auf eine Quelle, die gerade gar nicht liefern KANN, führt in
  // einen Leerzustand, der wie „nichts fällig" aussieht — genau die
  // Verwechslung, die der Hinweis oben ausräumt. Fällt die Union-RPC aus,
  // betrifft das ihre vier Quellen; das Recycling hängt an einer eigenen.
  const visibleFilters = FILTERS.filter((f) => {
    if (f.value === "alle") return true;
    if (f.value === "recycling") return recyclingAvailable;
    return tasksAvailable;
  });

  return (
    <div>
      {!tasksAvailable && (
        <UnavailableNotice title="Die Aufgabenliste konnte nicht geladen werden">
          Rückrufe und die Wiedervorlagen aus Setting und Closing fehlen gerade — die Datenbank hat auf die
          Abfrage nicht geantwortet. Das heißt ausdrücklich <strong>nicht</strong>, dass heute nichts zu tun ist.
          Bitte die Seite neu laden. Bleibt es dabei, einem Administrator Bescheid geben; bis dahin stehen die
          fälligen Kontakte in den Telefonlisten und auf den Terminseiten.
        </UnavailableNotice>
      )}
      {!recyclingAvailable && (
        <UnavailableNotice title="Recycling ist nicht verfügbar">
          Verlorene Closings und tote Leads werden gerade <strong>nicht</strong> wiedervorgelegt — der Datenbank fehlt
          dafür noch ein Stück. Das ist ausdrücklich nicht dasselbe wie &bdquo;kein Lead ist wieder dran&ldquo;. Die
          übrigen Quellen unten sind davon nicht betroffen. Bitte einem Administrator Bescheid geben.
        </UnavailableNotice>
      )}

      {/* ── EINE Filterreihe: Kanäle + der Überfällig-Schalter ──────────
          Die Zahlen standen bis hierher doppelt auf dem Schirm — einmal als
          Chip-Reihe, vierzig Pixel darunter noch einmal als Zähler in genau
          diesen Pillen. Geblieben ist die untere Reihe, weil sie außer der
          Zahl auch etwas TUT.                                             */}
      <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap", marginBottom: "var(--sp-5)" }}>
        {visibleFilters.map((f) => {
          const active = filter === f.value;
          const meta = f.value !== "alle" ? CHANNEL_META[f.value] : null;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => {
                // Bewusst NUR die Kanal-Achse: „Alle" meint alle Quellen,
                // nicht „alle Filter aus". Der Überfällig-Schalter bleibt
                // stehen und muss dort abgeschaltet werden, wo er sichtbar ist.
                setFilter(f.value);
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

        {/* Der Überfällig-Schalter: kein Kanal, sondern ein Zusatzfilter über
            alle Sektionen — deshalb rechts abgesetzt. Er erscheint nur, wenn
            es tatsächlich Überfälliges gibt; sonst wäre er ein Knopf, der die
            Liste garantiert leerräumt.
            Solange er AKTIV ist, bleibt er dagegen immer stehen — auch bei
            Zähler 0. Sonst ist er eine Sackgasse: Wer die letzte überfällige
            Aufgabe abarbeitet, verliert nach dem `router.refresh()` die
            einzige Bedienung, die `overdueOnly` wieder löst (die Kanal-Pillen
            fassen nur die Quellen-Achse an) — das Board bliebe leer, und
            der Grund dafür wäre nirgends mehr sichtbar. Ein aktiver Filter
            muss zu sehen und abschaltbar sein, gerade wenn er nichts mehr
            durchlässt. Farben sind die der früheren Überfällig-Kachel
            (Warning-Tokens), damit „rot heißt überfällig" auf der Seite eine
            Bedeutung behält.                                              */}
        {(overdueCount > 0 || overdueOnly) && (
          <button
            type="button"
            onClick={() => setOverdueOnly((v) => !v)}
            aria-pressed={overdueOnly}
            title="Nur Aufgaben zeigen, deren Termin bereits vorbei ist"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--sp-3)",
              height: 28,
              marginLeft: "auto",
              padding: "0 var(--sp-4) 0 var(--sp-5)",
              borderRadius: "var(--r-full)",
              border: `1px solid ${overdueOnly ? "rgb(209 162 79 / 0.28)" : "var(--border-default)"}`,
              background: overdueOnly ? "var(--warning-bg)" : "var(--surface-1)",
              color: overdueOnly ? "var(--warning-fg)" : "var(--text-muted)",
              fontSize: "var(--fs-sm)",
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: "pointer",
              transition: "background var(--transition-fast), border-color var(--transition-fast)",
            }}
          >
            <AlertTriangle size={12} style={{ flexShrink: 0 }} />
            Nur überfällig
            <span className="count-pill">{overdueCount}</span>
          </button>
        )}
      </div>

      {/* ── Hinweiszeile: was diese Seite ausblendet ────────────────
          GENAU EINE Sache wird hier versteckt, und sie wird genannt: Aufgaben,
          deren Fälligkeit so lange vorbei ist, dass sie niemand mehr abarbeitet
          (Grenzen je Quelle in lib/staleTasks.ts). Die Zahl steht sichtbar da,
          die Aufschlüsselung sagt WELCHE Grenze gegriffen hat, und der Schalter
          daneben holt alles zurück.

          Die früheren zwei Zeilen — „ältere Leads (Pitch > 7 Tage)" und „Zugriff
          auf den Kontakt fehlt" — sind mit dem LinkedIn-Zweig entfallen. Beide
          beurteilten einen Kontakt, den die Seite nicht mehr zeigt.          */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", marginBottom: "var(--sp-7)" }}>
        {showingAll ? (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap", fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
            <History size={12} style={{ flexShrink: 0 }} />
            <span>Auch Altlasten werden angezeigt — längst überfällige Aufgaben stehen mit in der Liste</span>
            <Link href="?" style={{ color: "var(--orange-300)", fontWeight: 500, textDecoration: "none" }}>
              Nur aktuelle Aufgaben
            </Link>
          </div>
        ) : staleHidden > 0 ? (
          <div
            title="Die Grenze hängt an der Kadenz der Quelle: ein Rückruf ist auf die Uhrzeit verabredet, eine Wiedervorlage läuft in Wochenschritten, ein Recycling-Versuch in Monaten."
            style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap", fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}
          >
            <History size={12} style={{ flexShrink: 0 }} />
            <span>
              {staleHidden} {staleHidden === 1 ? "lange überfällige Aufgabe" : "lange überfällige Aufgaben"} ausgeblendet
              {" — "}
              {staleParts(hiddenStale).join(", ")}
            </span>
            <Link href="?alle=1" style={{ color: "var(--orange-300)", fontWeight: 500, textDecoration: "none" }}>
              Trotzdem anzeigen
            </Link>
          </div>
        ) : null}
      </div>

      {/* ── Sektionen / Leerzustand ──────────────────────────────────────
          Der grüne Leerzustand ist eine BEHAUPTUNG („alles nachgefasst") und
          darf deshalb nur fallen, wenn die Seite ihre Quellen auch wirklich
          gefragt hat. Ohne die Union-RPC trägt der rote Kasten oben die
          Aussage; bei aktiver Auswahl heißt leer nur „in dieser Auswahl". */}
      {sections.length === 0 ? (
        !tasksAvailable ? null : filterActive ? (
          <div className="card fade-up dot-grid">
            <div className="empty-state">
              <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: "var(--text-primary)" }}>
                Keine Aufgaben in dieser Auswahl
              </div>
              {/* Bewusst nicht mehr nur &bdquo;Alle&ldquo;: Die Kanal-Pille
                  löst den Überfällig-Schalter nicht mit, und ein Ratschlag,
                  der die Liste nicht zurückbringt, macht den Leerzustand zur
                  Sackgasse. */}
              <p style={{ maxWidth: 380 }}>
                Die Filter oben schränken die Liste ein — auch &bdquo;Nur überfällig&ldquo;. Nimm sie zurück, dann
                siehst du wieder alles, was heute fällig ist.
              </p>
            </div>
          </div>
        ) : (
          <div className="card fade-up dot-grid">
            <div className="empty-state">
              <CheckCircle2 size={24} aria-hidden style={{ color: "var(--success-fg)" }} />
              <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: "var(--text-primary)" }}>
                Alles nachgefasst
              </div>
              <p style={{ maxWidth: 380 }}>
                Sobald ein Telefon-Rückruf, eine Wiedervorlage aus Setting oder Closing oder ein Recycling-Versuch
                fällig werden, erscheinen sie hier.
              </p>
            </div>
          </div>
        )
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {sections.map((section, i) => (
            <div key={section.key} className="fade-up" style={{ animationDelay: `${i * 60}ms` }}>
              <CollapsibleSection
                section={section}
                collapsed={!!collapsedMap[section.key]}
                onToggle={() => toggleSection(section.key)}
                done={doneApi}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
