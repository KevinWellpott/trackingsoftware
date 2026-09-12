"use client";

import {
  recycleContactedUndoable,
  recycleRespondedUndoable,
  undoNachfassenTask,
  type NachfassenActionResult,
  type NachfassenUndo,
  type RecycleTask,
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
// Dieselbe Farbe wie in der Termin- und der LinkedIn-Liste: „da muss jemand
// ran" heißt in dieser App Gold, und zwar überall (DESIGN.md §3.6, COMPONENTS
// §4.5). Vorher war Überfällig hier ROT — dieselbe Aussage in zwei Farben, und
// Rot heißt sonst „verloren/nicht erschienen": ausgerechnet auf einer Karte,
// die fragt, ob der Lead noch einen Versuch wert ist.
import { DRAN_TONE } from "@/lib/dranRegel";
import { isOverdue } from "@/lib/dueState";
import type { RecycleOrigin } from "@/lib/recycleCadence";
import type { DossierEntityKind } from "@/lib/leadDossier";
import { LeadDossierSheet } from "@/components/lead/LeadDossierSheet";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  AlertTriangle,
  AtSign,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Database,
  FileText,
  Handshake,
  Phone,
  RefreshCw,
  Undo2,
  UserX,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

// Das Board von /nachfassen nach dem Rückbau: EINE Liste, EINE Quelle.
//
// Die Seite trug bis hierher vier Sektionen (Telefon-Rückruf, Setting- und
// Closing-Wiedervorlage, Recycling), darüber eine Filterreihe mit fünf
// Kanal-Pillen und einem Überfällig-Schalter, und auf jeder Karte einen aus dem
// Vorlagen-Katalog gerenderten Text zum Kopieren. Drei der vier Quellen sind in
// die Terminliste gewandert (Begründung in actions/nachfassen.ts) — und mit
// ihnen alles, was nur wegen der Vielfalt existierte:
//
//  · Die KANAL-FILTERREIHE. Fünf Pillen über einer Liste mit einer Quelle
//    filtern nichts; die Zahl daneben stünde eine Zeile über derselben Zahl.
//  · Die einklappbaren SEKTIONEN. Eine Sektion, die alles enthält, ist keine.
//  · Der ÜBERFÄLLIG-SCHALTER. Die Liste steht ohnehin nach Fälligkeit sortiert,
//    das Älteste oben — und ein Filter, der die letzte Karte wegnehmen kann,
//    braucht dafür einen Ausweg, der wieder eine Bedienung ist.
//  · Der KOPIERTEXT samt Vorlagen-Herkunft. „Es ist vollkommen egal, WIE
//    jemand kontaktiert wird" — die Karte sagt WER dran ist und WARUM, nicht
//    was zu schreiben ist.
//  · Die KONTAKTFREQUENZ-WARNUNG. Sie las erledigte Kaskaden-Touches; die
//    Kaskade hat keine Oberfläche mehr, und der eigene letzte Versuch war
//    ausdrücklich ausgeschlossen. Was von ihr bleibt, steht als schlichte
//    Angabe auf der Karte: wann zuletzt versucht wurde.
//
// Was NICHT gefallen ist, weil es mit dem Überbau nichts zu tun hatte: der
// Rückweg nach einem Fehlklick, der rote Kasten bei fehlendem Schema und die
// Rückfrage vor dem endgültigen Sperren.
//
// SPÄTER GEFALLEN: die Hinweiszeile über die verborgenen Altlasten samt ihrem
// Schalter. Sie war die Bedingung, unter der ein Altersschnitt überhaupt
// vertretbar war — Zahl, Grenze und Ausweg in einer Zeile. Der Schnitt selbst
// ist gestrichen („ohne Ausnahme, ohne Intervall-Logik", actions/nachfassen.ts),
// und eine Zeile, die nichts mehr versteckt, erklärt nur noch sich selbst.

type Props = {
  tasks: RecycleTask[];
  /** false = Recycling-Schema fehlt (Migration 0033). NICHT „nichts fällig". */
  recyclingAvailable: boolean;
};

/**
 * Herkunft für den Rückweg der Detailseite.
 *
 * Ohne sie führt der „Zurück"-Link dort nach /termine — wer aus dem Board kam,
 * landete im Kalender.
 */
const FROM_NACHFASSEN = "?from=nachfassen";

/* ── Die vier Ursprünge ───────────────────────────────────────────────
   Wortgleich zu /ablage (`ENTITY_META`, AblageBoard.tsx): Termine haben eine
   Detailseite, LinkedIn-Kontakte und Telefon-Leads nicht — deren Verweis führt
   auf ihre LISTE. Zwei Boards, die dieselben vier Zeilenarten zeigen, dürfen
   sie nicht verschieden benennen.

   KEINE Kanalfarbe: Der Ursprung steht als WORT und als Symbol im Badge. Farbe
   bleibt auf dieser Seite der Dringlichkeit vorbehalten (Überfällig-Kante und
   Überfällig-Hinweis) — das ist das „höchstens EIN farbiges Element pro Zeile"
   aus dem Badge-Budget.                                                     */
const ORIGIN_META: Record<
  RecycleOrigin,
  {
    label: string;
    icon: React.ReactNode;
    dossier: DossierEntityKind;
    /** null = kein Ziel auflösbar (Lead ohne Liste) — der Verweis entfällt dann. */
    href: (task: RecycleTask) => string | null;
    linkLabel: string;
  }
> = {
  linkedin: {
    label: "LinkedIn-Kontakt",
    icon: <AtSign size={12} />,
    dossier: "contact",
    href: (t) => (t.list_id ? `/lists/${t.list_id}` : null),
    linkLabel: "Zur Liste",
  },
  telefon: {
    label: "Telefon-Lead",
    icon: <Phone size={12} />,
    dossier: "phone_lead",
    href: (t) => (t.list_id ? `/telefon/${t.list_id}` : null),
    linkLabel: "Anrufen",
  },
  setting: {
    label: "Setting",
    icon: <ClipboardCheck size={12} />,
    dossier: "setting",
    href: (t) => `/setting/${t.entity_id}${FROM_NACHFASSEN}`,
    linkLabel: "Zum Setting",
  },
  closing: {
    label: "Closing",
    icon: <Handshake size={12} />,
    dossier: "closing",
    href: (t) => `/closing/${t.entity_id}${FROM_NACHFASSEN}`,
    linkLabel: "Zum Closing",
  },
};

/**
 * Fällig-Datum de-DE (Europe/Berlin), ohne Uhrzeit.
 *
 * `next_recycle_at` ist eine `date`-Spalte: Recycling läuft in Wochen und
 * Monaten (docs §6). Eine Uhrzeit, die niemand verabredet hat, wäre keine
 * Angabe, sondern eine Behauptung — bei einem gecasteten Tagesdatum stünde dort
 * immer „02:00 Uhr".
 */
function formatDay(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(d);
}

/** Kompaktes Datum für den letzten Versuch: "07.09.2026". */
function formatShort(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(d);
}

function dueSortKey(t: RecycleTask): number {
  if (!t.due_at) return Number.MAX_SAFE_INTEGER;
  const d = new Date(t.due_at.includes("T") ? t.due_at : `${t.due_at}T00:00:00`);
  return Number.isNaN(d.getTime()) ? Number.MAX_SAFE_INTEGER : d.getTime();
}

/* ── Der Knopf-Stapel: drei Ebenen statt einer umbrechenden Reihe ───────
   Die Knöpfe stehen untereinander, jeder über die volle Kartenbreite. Auf 300
   Pixel Kartenbreite bräche eine Reihe ohnehin um — und WO sie umbricht,
   entschiede die Länge der Beschriftungen; dieselbe Karte sähe auf jedem
   Bildschirm anders aus, und ein Ziel von 28 Pixeln Höhe und wechselnder
   Breite trifft man auf dem Touchgerät schlecht.

     1. AKTIONEN — vollbreit, gestapelt. GENAU EIN gefüllter Knopf je Karte;
        die Markenfüllung bleibt dem einen CTA je VIEW vorbehalten und steht
        deshalb in keiner Karte dieses Rasters (COMPONENTS.md §2.1).
     2. Hairline, dann die WEGE — Ghost-Pillen in EINER Zeile. Sie schreiben
        nichts, sie führen nur woandershin.
     3. Hairline, dann „ENDGÜLTIG RAUS" allein, rechts, in Inhaltsbreite.

   Zur dritten Ebene: Diese Aktion ist unwiderruflich (es gibt kein Entsperren
   in der Oberfläche). Abgesetzt wird über POSITION, TRENNLINIE, BREITE und
   AUSRICHTUNG — nicht über eine neue Farbe.                                */
const actionStackStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: "var(--sp-4)",
  marginTop: "auto",
};

/* Wege: die Ghost-Behandlung an einem <Link>/<a>/<button>. `.ui-btn` liefert
   Form, Press und den Touch-Bump; die Ghost-Füllung (also: keine) steht als
   Inline-Stil daneben, weil `data-variant` an Next' <Link> kein zulässiges
   Attribut ist. */
const jumpStyle: React.CSSProperties = {
  minHeight: 28,
  padding: "0 var(--sp-5)",
  background: "transparent",
  border: "1px solid transparent",
  color: "var(--text-muted)",
  fontSize: "var(--fs-sm)",
  fontWeight: 500,
  textDecoration: "none",
};

/** Die Wege-Zeile — durch eine Hairline von den Aktionen darüber getrennt. */
const jumpRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "var(--sp-3)",
  paddingTop: "var(--sp-4)",
  borderTop: "1px solid var(--border-subtle)",
};

/** Die letzte Ebene: eine zweite Hairline, dann der eine unwiderrufliche Knopf. */
const dangerRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  paddingTop: "var(--sp-4)",
  borderTop: "1px solid var(--border-subtle)",
};

/* ── Erledigt, aber noch zurücknehmbar ────────────────────────────────
   Die Karte verschwand einmal in dem Moment, in dem eine Aktion durchlief —
   die Knöpfe liegen wenige Pixel nebeneinander, und ein Fehlgriff verbrannte
   einen von standardmäßig zwei erlaubten Versuchen.

   Deshalb bleibt sie kurz gedimmt stehen und trägt einen Ghost-Knopf. Der
   Zustand liegt am BOARD, nicht an der Karte: Der Server liefert die erledigte
   Aufgabe nach dem Refresh nicht mehr — ohne den Merge unten wäre die Karte
   samt Rückweg im selben Augenblick weg. */
const UNDO_WINDOW_MS = 9000;

type DoneEntry = {
  /** Die Aufgabe, wie sie war — der Server liefert sie nach dem Refresh nicht mehr. */
  task: RecycleTask;
  /** null = diese Aktion ist nicht sauber umkehrbar; dann gibt es keinen Knopf. */
  undo: NachfassenUndo | null;
  label: string;
  /** Marke des Fensters — siehe `doneToken` im Board. */
  token: number;
};

type DoneApi = {
  entries: Record<string, DoneEntry>;
  mark: (task: RecycleTask, undo: NachfassenUndo | null, label: string) => void;
  /** Rückgängig hat geklappt — Karte kehrt in den normalen Zustand zurück. */
  restore: (task: RecycleTask) => void;
};

/** Derselbe Schlüssel wie im Grid — eine Aufgabe ist Ursprung + Zeile. */
function taskKey(t: RecycleTask): string {
  return `${t.origin}-${t.entity_id}`;
}

/* ── Fehlermeldungen: was auf einer Vertriebs-Karte stehen darf ────────
   Die Server-Actions liefern zwei sehr verschiedene Sorten Text: eigene, für
   Menschen geschriebene Sätze („Nicht angemeldet.") — und alles, was Postgres
   durchreicht, etwa `new row violates row-level security policy for table
   "contacts"`. Das Zweite ist hier keine Information, sondern Rauschen: Es sagt
   nicht, was zu tun ist.
   Bekanntes geht deshalb wörtlich durch, alles andere wird zu EINEM Satz mit
   Handlungsanweisung. Die Rohmeldung bleibt im `title` für den, der sie
   braucht.                                                                */
const KNOWN_ERROR_MESSAGES: ReadonlySet<string> = new Set([
  "Nicht angemeldet.",
  "Nicht gefunden.",
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

function TaskCard({ task, done }: { task: RecycleTask; done: DoneApi }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dossierOpen, setDossierOpen] = useState(false);
  const { confirm, dialog } = useConfirm();

  const meta = ORIGIN_META[task.origin];
  // `next_recycle_at` ist ein Tagesdatum: Überfällig wird es erst am FOLGETAG
  // (lib/dueState.ts). Gecastet stünde es auf 02:00 Berliner Zeit, und nach dem
  // Datentyp gelesen wäre jede Wiedervorlage ab zwei Uhr morgens überfällig.
  const overdue = isOverdue(task.due_at, "day");
  const jumpHref = meta.href(task);
  const doneEntry = done.entries[taskKey(task)] ?? null;

  // Gemeinsamer Runner für alle "Klick löst Server-Action aus, Karte ist
  // danach erledigt"-Buttons. `label` steht anschließend auf der gedimmten
  // Karte: „Erledigt" allein sagt bei drei verschiedenen Aktionen zu wenig,
  // um einen Fehlgriff zu erkennen — und genau dafür ist das Fenster da.
  const runAction = (promise: Promise<NachfassenActionResult>, label: string) => {
    setError(null);
    startTransition(async () => {
      const res = await promise;
      if (res.error) {
        setError(res.error);
        return;
      }
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
        // 2px-Rail als Inset statt einer 3px-Kante: Das System kennt genau
        // eine Rail-Breite (DESIGN.md §12, COMPONENTS §13.4), und als
        // `box-shadow` verschiebt sie die Karte nicht um einen Pixel gegenüber
        // ihren nicht überfälligen Nachbarn. Wortgleich das Rezept, mit dem
        // Termin- und LinkedIn-Liste ihr Gold setzen.
        boxShadow: overdue ? `inset 2px 0 0 ${DRAN_TONE.border}` : undefined,
        borderRadius: "var(--radius-md)",
        padding: "var(--sp-5)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-4)",
        minWidth: 0,
        // Erledigt sieht aus wie „gerade in Arbeit" — dieselbe Abblendung. Die
        // Karte ist dann fertig, aber noch da.
        opacity: isPending || doneEntry ? 0.55 : 1,
        transition: "opacity 0.15s, border-color 0.15s",
      }}
    >
      {/* ── Kopfzeile: Lead + Firma + Ursprung + Grund ── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-4)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 600, nicht 650: Geladen sind 400/500/600 (app/layout.tsx), und
              „nie 700" ist eine Systemregel (DESIGN.md §6.2). 650 war die
              einzige Fundstelle im ganzen Repo — im Fallback-Stack hätte sie
              synthetischen Fettdruck erzeugt. Größen und Abstände kommen aus
              den Tokens, nicht aus rem-Literalen (§6.3, §8). */}
          <div
            style={{
              fontSize: "var(--fs-base)",
              fontWeight: 600,
              letterSpacing: "var(--ls-tight)",
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
                fontSize: "var(--fs-xs)",
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
          {/* Beide Badges laufen über denselben neutralen Ton — Ursprung, Grund
              und Versuchszähler sind Kategorien, keine Zustände. Unterschieden
              werden sie durch Wort und Symbol, nicht durch Farbe. */}
          <Badge tone="neutral">
            {meta.icon} {meta.label}
          </Badge>
          {/* Der Grund ist die eigentliche Auskunft der Karte: Ob ein zweiter
              Anlauf lohnt, hängt daran, ob damals der Zeitpunkt, das Budget
              oder der Entscheider im Weg stand. Der Versuchszähler steht
              daneben, weil der zweite Anlauf anders klingt als der erste. */}
          <Badge tone="neutral">
            {dropoutReasonLabel(task.reason)}
            {task.attempt > 0 ? ` · Versuch ${task.attempt + 1}` : ""}
          </Badge>
        </div>
      </div>

      {/* ── Fälligkeit ── */}
      {task.due_at && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            fontSize: "var(--fs-2xs)",
            fontWeight: 600,
            color: overdue ? DRAN_TONE.fg : "var(--text-secondary)",
          }}
        >
          {overdue ? (
            <AlertTriangle size={11} style={{ flexShrink: 0 }} />
          ) : (
            <Clock size={11} style={{ flexShrink: 0 }} />
          )}
          {overdue ? `überfällig seit ${formatDay(task.due_at)}` : `fällig ${formatDay(task.due_at)}`}
        </span>
      )}

      {/* ── Letzter Versuch ──────────────────────────────────────────────
          Eine Angabe, keine Warnung: Auf dieser Kadenz ist „vor zwei Monaten
          zuletzt versucht" der Normalfall und kein Grund, zu zögern. Sie steht
          hier, weil sie den Ton des nächsten Kontakts entscheidet — und weil
          sie ohne Nachschlag mitkommt (`recycle_last_contacted_at` steht in
          der Zeile). Fehlt sie, war dies der erste Anlauf; dann steht bewusst
          nichts da statt „noch nie".                                        */}
      {task.last_contacted_at && (
        <span style={{ fontSize: "var(--fs-2xs)", color: "var(--text-muted)" }}>
          Zuletzt versucht {formatShort(task.last_contacted_at)}
        </span>
      )}

      {/* ── Aktionen, Wege, und ganz zuletzt der unwiderrufliche Knopf ──────
          Ein Entweder-oder zum Rückweg: Eine erledigte Aufgabe soll nicht ein
          zweites Mal erledigt werden können, und die Fehlermeldung gibt es nach
          wie vor nur EINMAL — sie gehört zu beiden Zuständen, auch ein
          Rückgängig kann scheitern. */}
      <div style={actionStackStyle}>
        {doneEntry && (
          <>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--sp-3)",
                fontSize: "var(--fs-sm)",
                fontWeight: 600,
                color: "var(--success-fg)",
              }}
            >
              <Check size={13} style={{ flexShrink: 0 }} /> {doneEntry.label}
            </span>
            {/* Auf der gedimmten Karte ist der Rückweg die einzige verbliebene
                Handlung — deshalb vollbreit und nicht als Ghost-Text am Rand.
                Ein Primär-Knopf ist er trotzdem nicht: Zurücknehmen ist die
                Ausnahme, nicht der erwartete Schritt. */}
            {doneEntry.undo && (
              <Button
                variant="secondary"
                fullWidth
                disabled={isPending}
                onClick={undoNow}
                icon={<Undo2 size={14} />}
                title="Diese Aktion zurücknehmen — die Aufgabe steht danach wieder hier"
              >
                Rückgängig
              </Button>
            )}
          </>
        )}

        {/* Die beiden schreibenden Aktionen, gestapelt.
            „Nochmal versucht" ist der erwartete Schritt und trägt deshalb als
            einziges eine FLÄCHE; „Reagiert" ist die Ausnahme und bleibt
            darunter — als Danger-Pendant eine reine Hairline in der
            Erfolgsfarbe: zwei gefüllte Knöpfe übereinander hätten keinen
            Hauptknopf mehr.

            ── WARUM SEKUNDÄR UND NICHT PRIMÄR ──────────────────────────────
            Die Karten stehen in einem `auto-fill`-Raster; bei zwölf Aufgaben
            standen zwölf Signature-Pills auf dem Schirm. Die Regel zählt aber
            je VIEW, nicht je Karte (COMPONENTS.md §2.1: „genau einer pro View
            · nie in Tabellenzeilen oder Listen"; DESIGN.md §5.1: „Bekommt
            jeder Button einen farbigen Verlauf, schreit alles gleich laut und
            der CTA verschwindet in der Menge"). Die Hierarchie INNERHALB der
            Karte trägt weiterhin der Unterschied Fläche/Hairline und die
            Stapelreihenfolge — der Surface-Verlauf ist dieselbe Form und
            dasselbe Licht, nur nicht dieselbe Lautstärke. */}
        {!doneEntry && (
          <>
            <Button
              variant="secondary"
              fullWidth
              disabled={isPending}
              onClick={() =>
                // Der Grund kommt seit Migration 0033 aus der Ursprungszeile,
                // nicht mehr vom Client — sonst liesse sich per direktem POST
                // jede beliebige Wartezeit ausloesen (actions/recycle.ts). Die
                // Hülle drumherum liest nur den Stand VOR dem Klick, damit ein
                // Fehlgriff nicht einen von zwei erlaubten Versuchen verbrennt.
                runAction(recycleContactedUndoable(task.origin, task.entity_id), "Versuch notiert")
              }
              icon={<RefreshCw size={14} />}
              title="Kontaktiert, noch kein Ergebnis — nächster Versuch nach der eingestellten Wartezeit"
            >
              Nochmal versucht
            </Button>
            <Button
              variant="success"
              fullWidth
              disabled={isPending}
              onClick={() => runAction(recycleRespondedUndoable(task.origin, task.entity_id), "Als reagiert markiert")}
              icon={<Check size={14} />}
              title="Lead ist wieder im Spiel — Recycling stoppen"
            >
              Reagiert
            </Button>
          </>
        )}

        {/* Rohmeldung nur im `title`. Der Platz ist bewusst DIREKT unter den
            Aktionen und damit vor der Wege-Zeile: Gescheitert ist einer der
            Knöpfe darüber, nicht ein Sprung-Link — und vor „Endgültig raus"
            muss er ohnehin stehen, weil dieser Knopf sonst in dem Moment nach
            unten rutscht, in dem gerade ein Fehler erschienen ist. */}
        {error && (
          <span
            title={friendlyError(error) === error ? undefined : error}
            style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--color-error-text)" }}
          >
            {friendlyError(error)}
          </span>
        )}

        {/* ── Ebene 2: die Wege ────────────────────────────────────────
            Hairline statt eigener Fläche — Struktur kommt in diesem System aus
            1px-Linien, nicht aus Kästen. Sie stehen in EINER Zeile und nicht
            im Stapel: Vollbreite Knöpfe würden behaupten, sie seien
            Arbeitsschritte; sie führen aber nur woandershin.

            Das Dossier steht bewusst dabei — Gesprächsvorbereitung, deshalb
            VOR dem Anruf und ohne die Arbeitsliste zu verlassen. Es öffnet als
            Overlay und lädt erst beim Öffnen; acht Abfragen je Karte im Voraus
            wären der Preis für etwas, das man je Sitzung einmal liest. */}
        {!doneEntry && (
          <div style={jumpRowStyle}>
            {jumpHref && (
              <Link href={jumpHref} className="ui-btn" style={jumpStyle} title={`${meta.label} öffnen`}>
                {meta.icon} {meta.linkLabel}
              </Link>
            )}
            {task.phone && (
              /* Die Rufnummer bleibt anklickbar (tel:) und behält die
                 Akzentfarbe als SCHRIFT — ein Link, kein zweiter CTA. */
              <a
                href={`tel:${task.phone.replace(/[^\d+]/g, "")}`}
                className="ui-btn"
                style={{ ...jumpStyle, color: "var(--orange-300)" }}
                title="Nummer direkt wählen"
              >
                {task.phone}
              </a>
            )}
            <button
              type="button"
              onClick={() => setDossierOpen(true)}
              className="ui-btn"
              style={jumpStyle}
              title="Alles zu diesem Lead — Verlauf, Kontaktwege, Notizen"
            >
              <FileText size={13} /> Details
            </button>
          </div>
        )}

        {/* ── Ebene 3: „Endgültig raus" ────────────────────────────────
            Vier Dinge setzen ihn ab, keins davon ist eine neue Farbe: Er steht
            ganz unten und ALLEIN, hinter einer zweiten Hairline, in
            Inhaltsbreite statt über die volle Karte, und rechtsbündig — die
            gestapelten Aktionen darüber beginnen alle an der linken Kante.
            Dazu die Danger-Hairline und die Rückfrage, die er ausspricht: Ein
            Fehlgriff kostete den Lead für immer, die Oberfläche kennt kein
            Entsperren, und `reviveBlockedReason()` verweigert danach
            zusätzlich jede Rückholung. */}
        {!doneEntry && (
          <div style={dangerRowStyle}>
            <Button
              variant="danger"
              size="sm"
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
                // machen lässt. Ein Knopf, der dem widerspricht, wäre
                // schlimmer als keiner.
                if (ok) runAction(excludeFromRecycle(task.origin, task.entity_id), "Endgültig gesperrt");
              }}
              icon={<UserX size={13} />}
              title="Dauerhaft sperren — kein weiterer Kontaktversuch, nicht rückgängig zu machen"
            >
              Endgültig raus
            </Button>
          </div>
        )}
      </div>

      {dialog}

      <LeadDossierSheet
        open={dossierOpen}
        onClose={() => setDossierOpen(false)}
        kind={meta.dossier}
        id={task.entity_id}
      />
    </div>
  );
}

/* ── Eine Quelle liefert nicht: NICHT der grüne Leerzustand ────────────
   Der rote Kasten sagt ausdrücklich, dass ein fehlendes Schema nicht „nichts zu
   tun" bedeutet. Er ist auf dieser Seite der einzige verbliebene Ausfall-Fall —
   mit dem Union-Zweig ist sein Zwilling entfallen.                          */
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

export function NachfassenBoard({ tasks, recyclingAvailable }: Props) {
  /* ── Erledigte Karten mit offenem Rückweg ───────────────────────────
     Sie liegen HIER und nicht in der Karte: Der Server liefert die erledigte
     Aufgabe nach dem Refresh nicht mehr — die Karte würde im selben Moment
     ausgehängt und mit ihr der Rückweg. Der Merge unten hält sie für die Dauer
     des Fensters am Leben.

     `router.refresh()` läuft trotzdem sofort — und muss es: Ohne ihn bliebe
     der Prop `tasks` auf dem Stand von vor der Aktion, und nach Ablauf des
     Fensters käme dieselbe Karte als normale, wieder anklickbare Aufgabe
     zurück. Der Zähler in der Seitenleiste stimmt damit ebenfalls sofort.  */
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
   * kennt. Ein Eintrag, den der Server WEITERHIN liefert, wird nicht
   * verdoppelt — der frische Stand gewinnt.
   */
  const withDone = useMemo(() => {
    const entries = Object.values(doneMap);
    if (entries.length === 0) return tasks;
    const known = new Set(tasks.map(taskKey));
    return [...tasks, ...entries.filter((e) => !known.has(taskKey(e.task))).map((e) => e.task)];
  }, [tasks, doneMap]);

  // Das Älteste zuerst — die Liste wird von oben nach unten abgearbeitet.
  const sorted = useMemo(() => [...withDone].sort((a, b) => dueSortKey(a) - dueSortKey(b)), [withDone]);

  return (
    <div>
      {/* EIN Satzbau für „das Schema fehlt", überall gleich: Zustand · was es
          NICHT heißt · was zu tun ist. Dieselben drei Teile stehen in der
          Ablage und in den Einstellungen; die Migrationsnummer steht hinten,
          weil sie nur dem weiterhilft, den man laut Satz drei holen soll. */}
      {!recyclingAvailable && (
        <UnavailableNotice title="Recycling ist nicht verfügbar">
          Verlorene Closings und tote Leads werden gerade <strong>nicht</strong> wiedervorgelegt — der Datenbank fehlt
          dafür noch ein Stück. Das ist ausdrücklich nicht dasselbe wie &bdquo;kein Lead ist wieder dran&ldquo;. Bitte
          einem Administrator Bescheid geben (Migration 0033).
        </UnavailableNotice>
      )}

      {/* HIER STAND DIE HINWEISZEILE über die verborgenen Altlasten — die Zahl,
          die Grenze und der Schalter, der sie zurückholte. Sie war die
          Bedingung, unter der der Altlasten-Schnitt vertretbar war; der Schnitt
          ist gefallen, also gibt es nichts mehr zu nennen. Diese Liste versteckt
          NICHTS: Was die RPC als fällig liefert, steht hier. */}

      {/* ── Karten / Leerzustand ──────────────────────────────────────────
          Der grüne Leerzustand ist eine BEHAUPTUNG und darf deshalb nur fallen,
          wenn die Seite ihre Quelle auch wirklich gefragt hat. Ohne Schema
          trägt der rote Kasten oben die Aussage. */}
      {sorted.length === 0 ? (
        !recyclingAvailable ? null : (
          <div className="card fade-up dot-grid">
            <div className="empty-state">
              <CheckCircle2 size={24} aria-hidden style={{ color: "var(--success-fg)" }} />
              <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: "var(--text-primary)" }}>
                Kein Lead wartet auf einen zweiten Anlauf
              </div>
              <p style={{ maxWidth: 380 }}>
                Hier erscheinen verlorene Closings, tote Telefon- und Erstgespräch-Leads und LinkedIn-Kontakte ohne
                Antwort — sobald ihre Wartezeit abgelaufen ist.
              </p>
            </div>
          </div>
        )
      ) : (
        /* Kompaktes Karten-Grid: so viele 300px-Karten pro Zeile wie Platz ist. */
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: "0.75rem",
          }}
        >
          {sorted.map((t) => (
            <TaskCard key={taskKey(t)} task={t} done={doneApi} />
          ))}
        </div>
      )}
    </div>
  );
}
