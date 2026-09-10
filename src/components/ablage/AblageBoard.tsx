"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  AtSign,
  Ban,
  CalendarClock,
  ChevronsRight,
  ClipboardCheck,
  Database,
  FileText,
  Handshake,
  History,
  Inbox,
  Lock,
  Phone,
  RotateCcw,
  Users,
} from "lucide-react";
import { excludeFromRecycle } from "@/app/actions/recycle";
import { pullRecycleForward, type DropoutRow } from "@/app/actions/dropout";
import {
  dropoutListMeta,
  dropoutReasonBadge,
  lineageCounterSummary,
  listAllowsRevive,
  listFeedsRecycling,
  type DropoutEntity,
  type DropoutListKey,
} from "@/lib/dropoutLists";
import type { DossierEntityKind } from "@/lib/leadDossier";
import { LeadDossierSheet } from "@/components/lead/LeadDossierSheet";
import { ReviveDialog } from "@/components/ablage/ReviveDialog";
import { Badge, StageBadge, type StageKey } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { InfoPopover } from "@/components/ui/InfoPopover";
import { ownerColor } from "@/lib/ownerColor";

// Ablage-Board: eine Karte je ausgeschiedenem Vorgang.
//
// Die Karte beantwortet genau die vier Fragen, die man an einem Aktenschrank
// stellt — wer war das, warum liegt er hier, seit wann, und was passiert als
// Nächstes. Der Grund steht deshalb doppelt: als Code (zählbar, gleich
// beschriftet wie überall sonst) UND als Freitext daneben, wenn es einen gibt.
//
// Drei Aktionen, mehr nicht — und jede nur dort, wo sie auch geht:
//   · „Jetzt wieder anschreiben" setzt die Wiedervorlage auf heute; der Vorgang
//     erscheint dann in der Recycling-Sektion von /nachfassen.
//   · „Endgültig sperren" schreibt das dauerhafte Kontaktverbot — die einzige
//     Aktion hier, die etwas wegnimmt, deshalb mit Rückfrage.
//   · „Neuen Termin ansetzen" (Entscheidung K10) legt einen NEUEN
//     Erstgesprächs-Termin an; der alte Vorgang bleibt abgeschlossen und bekommt
//     nur `revived_at`.
//
// Was nicht geht, wird WEGGELASSEN statt ausgegraut (recycleBlockedReason /
// reviveBlockedReason, lib/dropoutLists.ts). Ein toter Knopf auf jeder von
// zwanzig Karten ist zwanzigmal dieselbe Absage; der Grund steht einmal — am
// Fuß des Boards, wenn er für die ganze Liste gilt (listFeedsRecycling /
// listAllowsRevive), sonst als Satz unter den Aktionen der betroffenen Karte.
// Das gilt für JEDEN Knopf der Karte, auch für den Verweis auf Liste bzw.
// Termin: Eine Ausnahme daneben wäre nicht eine mildere Regel, sondern eine
// zweite — und die Karte hätte wieder beide.
//
// Genau EIN Knopf trägt seinen Grund weder unten noch im Fuß: „Endgültig
// sperren" fehlt, wenn die Zeile schon gesperrt ist — und das sagt der Badge
// „Gesperrt" oben bereits. Ein zweiter Satz darunter wiederholte ihn nur.
//
// Die Kette bleibt in beide Richtungen sichtbar: Eine Karte, die selbst aus
// einer Rückholung entstanden ist, zeigt die Zähler ihrer VORGÄNGERZEILE —
// sonst sähe ein Lead, der über Absagen und Rückholungen fünfmal verschoben
// hat, hier wie ein unbeschriebenes Blatt aus (der neue Vorgang startet
// bewusst bei `reschedule_count = 0`, Entscheidung E9 gegen E6). Umgekehrt
// führt eine zurückgeholte Zeile zu ihrem Nachfolger.

// Vier Ursprünge. Termine haben eine eigene Detailseite, LinkedIn-Kontakte und
// Telefon-Leads nicht — deren Verweis führt auf ihre LISTE, wortgleich zum
// Nachfassen-Board („Zur Liste" / „Zum Call-Mode"). Deshalb nimmt `href` die
// ganze Zeile und nicht nur die id: Die `list_id` liefert erst die RPC mit.
const ENTITY_META: Record<
  DropoutEntity,
  {
    label: string;
    stage: StageKey;
    icon: React.ReactNode;
    /** null = kein Ziel auflösbar (Lead ohne Liste) — der Verweis entfällt dann. */
    href: (row: DropoutRow) => string | null;
    linkLabel: string;
    /** Anker des Lead-Dossiers — `entity_id` ist immer die Ursprungszeile. */
    dossier: DossierEntityKind;
  }
> = {
  setting: {
    label: "Setting",
    stage: "setting",
    icon: <ClipboardCheck size={12} />,
    href: (row) => `/setting/${row.entity_id}`,
    linkLabel: "Zum Setting",
    dossier: "setting",
  },
  closing: {
    label: "Closing",
    stage: "closing",
    icon: <Handshake size={12} />,
    href: (row) => `/closing/${row.entity_id}`,
    linkLabel: "Zum Closing",
    dossier: "closing",
  },
  linkedin: {
    label: "LinkedIn-Kontakt",
    stage: "linkedin",
    icon: <AtSign size={12} />,
    href: (row) => (row.list_id ? `/lists/${row.list_id}` : null),
    linkLabel: "Zur Liste",
    dossier: "contact",
  },
  telefon: {
    label: "Telefon-Lead",
    stage: "telefon",
    icon: <Phone size={12} />,
    href: (row) => (row.list_id ? `/telefon/${row.list_id}` : null),
    linkLabel: "Zur Liste",
    dossier: "phone_lead",
  },
};

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

/** Datum de-DE (Europe/Berlin). Verträgt Datum-only (`next_recycle_at`) und
    Zeitstempel (`dropped_at`) — beide kommen in derselben Karte vor. */
function formatDay(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(d);
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

/** Eine Tatsache der Karte: Beschriftung oben, Wert darunter. */
function Fact({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "muted" | "accent";
  title?: string;
}) {
  return (
    <div style={{ minWidth: 0 }} title={title}>
      <div
        className="eyebrow eyebrow-muted"
        style={{ fontSize: "var(--fs-2xs)", marginBottom: 2, whiteSpace: "nowrap" }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "var(--fs-xs)",
          fontWeight: 500,
          fontVariantNumeric: "tabular-nums",
          color:
            tone === "accent" ? "var(--orange-300)" : tone === "muted" ? "var(--text-muted)" : "var(--text-secondary)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Karte
 * ------------------------------------------------------------------ */

function DropoutCard({
  row,
  list,
  maxAttempts,
  today,
  confirmBlock,
}: {
  row: DropoutRow;
  list: DropoutListKey;
  maxAttempts: number;
  /** Berliner Kalendertag, vom Server gereicht — der Browser kann in einer
      anderen Zone stehen und schöbe „fällig" um einen Tag. */
  today: string;
  confirmBlock: (row: DropoutRow) => Promise<boolean>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dossierOpen, setDossierOpen] = useState(false);
  const [reviveOpen, setReviveOpen] = useState(false);

  const meta = ENTITY_META[row.entity_type];
  const href = meta.href(row);
  const dueNow = Boolean(row.next_recycle_at && row.next_recycle_at <= today);
  const blocked = row.recycle_blocked;
  // Liegt die Sperre am ZUSTAND dieser Zeile (gesperrt, wiederbelebt, Deckel,
  // Grund ohne Recycling), gehört sie in die Karte. Kann dagegen die ganze
  // Liste kein Recycling speisen, stünde derselbe Satz auf jeder Karte — den
  // trägt dann eine Zeile am Fuß des Boards.
  const rowCouldFeed = listFeedsRecycling(list, row.entity_type);
  // Dasselbe für das Ansetzen eines neuen Termins: In der Sperrliste ist jede
  // Zeile gesperrt, der Grund gilt also für die ganze Ansicht und steht am Fuß.
  const rowCouldRevive = listAllowsRevive(list);
  const predecessor = row.lineage.predecessor;
  const successor = row.lineage.successor;
  // „3× verschoben · 1× nicht erschienen" — leer, wenn der Vorgänger sauber
  // blieb; dann verschweigt die Karte nichts, sondern hat nichts zu melden.
  const predecessorCounters = predecessor
    ? lineageCounterSummary(predecessor.reschedule_count, predecessor.no_show_count)
    : null;

  // Ein weggelassener Knopf braucht seinen Satz, sonst verschwindet mit dem
  // Knopf auch die Absage — und der Nutzer sucht auf der Karte nach etwas, das
  // dort bewusst fehlt. Die Sätze stehen in der Reihenfolge der Aktionszeile.
  // Aufgenommen wird nur, was an DIESER Zeile hängt: Was für die ganze Liste
  // gilt, trägt der Fuß des Boards einmal.
  const hints: string[] = [];
  if (!href) {
    hints.push(
      "Die Liste zu diesem Lead gibt es nicht mehr — deshalb fehlt der Verweis. Der Verlauf steht im Dossier.",
    );
  }
  if (blocked && rowCouldFeed) hints.push(blocked);
  if (row.revive_blocked && rowCouldRevive) hints.push(row.revive_blocked);

  function run(work: () => Promise<{ error?: string } | void>) {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const res = await work();
      if (res && "error" in res && res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function pullForward() {
    run(async () => {
      const res = await pullRecycleForward(row.entity_type, row.entity_id);
      if (!res.error) setNote("Wiedervorlage auf heute gesetzt — steht jetzt in Nachfassen.");
      return res;
    });
  }

  async function block() {
    if (!(await confirmBlock(row))) return;
    run(() => excludeFromRecycle(row.entity_type, row.entity_id));
  }

  return (
    <article
      className="card"
      style={{
        padding: "var(--sp-5) var(--sp-6)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-5)",
        opacity: isPending ? 0.6 : 1,
        transition: "opacity var(--transition-fast)",
      }}
    >
      {/* ── Kopf: Lead, Firma, Art, Zuständigkeit ── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-4)" }}>
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
            {row.lead_name?.trim() || "Unbenannter Lead"}
          </div>
          {row.company && (
            <div
              style={{
                fontSize: "var(--fs-xs)",
                color: "var(--text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {row.company}
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
          {row.owner_name ? (
            <PersonPill name={row.owner_name} />
          ) : (
            <Badge tone="neutral" title="Weder Zuweisung noch Ersteller auflösbar">
              Ohne Zuordnung
            </Badge>
          )}
        </div>
      </div>

      {/* ── Grund: Code (zählbar) und Freitext (Gedächtnis) ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
          <Badge
            tone={row.reason_code ? "neutral" : "warning"}
            title={
              row.reason_code
                ? "Grund als Code — danach wird gezählt"
                : row.reason_hidden
                  ? "Der Vorgang gehört einer anderen Person. Die Sperrliste zeigt ihn org-weit, seinen Grund liest die eingestellte Datensicht aber nicht."
                  : "Für diesen Vorgang ist kein Grund erfasst"
            }
          >
            {dropoutReasonBadge(row.reason_code, row.reason_hidden)}
          </Badge>
          {row.excluded && (
            <Badge tone="error" title="Dauerhaftes Kontaktverbot">
              <Lock size={11} /> Gesperrt
            </Badge>
          )}
          {/* Dasselbe Ereignis wie am Knopf „Neuen Termin ansetzen" — also
              auch dasselbe Wort. Drei Namen für einen Vorgang (wiederbelebt,
              zurückgeholt, neuer Termin) lasen sich auf einer Karte wie drei
              verschiedene Dinge. */}
          {row.revived_at && (
            <Badge tone="success" title={`Am ${formatDay(row.revived_at)} wurde ein neuer Termin angesetzt`}>
              Neuer Termin angesetzt
            </Badge>
          )}
        </div>
        {row.reason_text?.trim() && (
          <p
            style={{
              margin: 0,
              fontSize: "var(--fs-sm)",
              lineHeight: 1.5,
              color: "var(--text-secondary)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {row.reason_text.trim()}
          </p>
        )}
      </div>

      {/* ── Tatsachen: seit wann, Wiedervorlage, Versuche, Verschiebungen ── */}
      <div style={{ display: "flex", gap: "var(--sp-6)", flexWrap: "wrap" }}>
        <Fact
          label="Eingang"
          value={formatDay(row.dropped_at)}
          tone="muted"
          title="Absagedatum, sonst die letzte Änderung der Zeile — ein eigenes „liegt hier seit“ gibt es nicht, weil die Zugehörigkeit zur Liste abgeleitet wird."
        />
        <Fact
          label="Wiedervorlage"
          value={row.next_recycle_at ? formatDay(row.next_recycle_at) : "keine"}
          tone={dueNow ? "accent" : row.next_recycle_at ? undefined : "muted"}
        />
        <Fact
          label="Versuche"
          value={`${row.recycle_attempt_count ?? 0} von ${maxAttempts}`}
          tone={(row.recycle_attempt_count ?? 0) >= maxAttempts ? "muted" : undefined}
        />
        {row.reschedule_count > 0 && (
          <Fact label="Verschoben" value={`${row.reschedule_count}×`} tone="muted" />
        )}
      </div>

      {/* Der zweite Anlauf trägt die Historie des ersten nicht in seinen
          Zählern (frischer Anlauf, E9) — also steht sie hier daneben. Ohne das
          wäre „absagen und zurückholen" ein lautloser Weg an der
          Verschiebe-Obergrenze aus E6 vorbei. */}
      {predecessor && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "var(--sp-3)",
            padding: "var(--sp-4) var(--sp-5)",
            borderRadius: "var(--r-sm)",
            background: "var(--info-bg)",
            border: "1px solid rgb(78 128 214 / 0.28)",
            fontSize: "var(--fs-xs)",
            lineHeight: "var(--lh-base)",
            color: "var(--text-secondary)",
          }}
        >
          <History size={12} style={{ flexShrink: 0, marginTop: 2, color: "var(--info-fg)" }} />
          <span>
            Zweiter Anlauf.{" "}
            {predecessorCounters
              ? `Der Vorgänger stand bei ${predecessorCounters} — die Zähler oben zählen erst ab diesem neuen Termin.`
              : "Die Zähler oben zählen erst ab diesem neuen Termin."}{" "}
            <Link
              href={`/${predecessor.entity}/${predecessor.id}`}
              style={{ color: "var(--info-fg)", textDecoration: "none", whiteSpace: "nowrap" }}
            >
              Zum Vorgänger <ArrowUpRight size={10} />
            </Link>
          </span>
        </div>
      )}

      {successor && (
        <Link
          href={`/setting/${successor.id}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            fontSize: "var(--fs-xs)",
            color: "var(--success-fg)",
            textDecoration: "none",
          }}
        >
          <RotateCcw size={11} /> Neuer Termin angesetzt — zum Setting
          {successor.appointment_at ? ` am ${formatDay(successor.appointment_at)}` : ""}
        </Link>
      )}

      {dueNow && (
        <Link
          href="/nachfassen"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            fontSize: "var(--fs-xs)",
            color: "var(--orange-300)",
            textDecoration: "none",
          }}
        >
          <CalendarClock size={11} /> Wiedervorlage ist fällig — steht in Nachfassen
        </Link>
      )}

      {/* ── Aktionen ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-3)",
          flexWrap: "wrap",
          marginTop: "auto",
        }}
      >
        {/* Dieselbe Regel wie bei den drei Aktionen unten, damit es EINE Regel
            bleibt: Ein LinkedIn-Kontakt oder Telefon-Lead, dessen Liste
            gelöscht wurde, hat kein Ziel — dann entfällt der Verweis, statt als
            toter Knopf dazustehen; sein Grund steht dafür unten bei den
            Hinweisen. Verloren geht dabei nichts: Zum Lead selbst führte er bei
            diesen beiden Ursprüngen ohnehin nie, das tut das Dossier daneben. */}
        {href && (
          <Link href={href} style={ghostBtn}>
            {meta.linkLabel} <ArrowUpRight size={12} />
          </Link>
        )}

        {/* Die Akte zum abgelegten Vorgang. Hier trägt sie mehr als auf den
            Arbeitslisten: Bevor man einen toten Lead vorzieht oder dauerhaft
            sperrt, ist der Verlauf die einzige Grundlage für die Entscheidung —
            und der Verweis daneben führt bei LinkedIn- und Telefon-Zeilen nur
            zur Liste, nicht zum Lead. Der einzige Weg zur Historie einer
            solchen Zeile führt über diesen Knopf.
            Beschriftet ist er „Details" und nicht „Dossier": Das war ein Wort
            aus dem Code, das dem Vertrieb nicht sagte, was passiert. Dieselbe
            Beschriftung tragen die Knöpfe in /nachfassen und /erinnerungen. */}
        <button
          type="button"
          onClick={() => setDossierOpen(true)}
          style={ghostBtn}
          title="Alles zu diesem Lead — Verlauf, Kontaktwege, Notizen"
        >
          <FileText size={12} /> Details
        </button>

        {/* Nicht mögliche Aktionen werden WEGGELASSEN, nicht ausgegraut. In der
            Sperrliste wäre sonst auf jeder einzelnen Karte derselbe tote Knopf
            zu sehen, und der Grund dafür steht ohnehin einmal am Fuß des Boards
            bzw. — wenn er an dieser Zeile hängt — als Satz unter den Aktionen. */}
        {!blocked && (
          <button
            type="button"
            disabled={isPending}
            onClick={pullForward}
            title="Wiedervorlage auf heute setzen — der Vorgang erscheint dann in der Recycling-Sektion von Nachfassen."
            style={{ ...ghostBtn, cursor: isPending ? "default" : "pointer" }}
          >
            <ChevronsRight size={12} /> Jetzt wieder anschreiben
          </button>
        )}

        {/* Ist die Zeile gesperrt, trägt der Badge „Gesperrt" oben die Aussage
            — ein Knopf daneben, der dasselbe noch einmal sagt, ist nur Fläche.
            Eine Sonderregel für die Sperrliste braucht es dafür nicht: Dort ist
            jede Zeile gesperrt, `dropout_lists()` liefert gar keine andere. */}
        {!row.excluded && (
          <button
            type="button"
            disabled={isPending}
            onClick={block}
            title="Dauerhaftes Kontaktverbot: kein Recycling mehr, org-weit sichtbar in der Sperrliste."
            style={{ ...ghostBtn, color: "var(--text-muted)", cursor: isPending ? "default" : "pointer" }}
          >
            <Ban size={12} /> Endgültig sperren
          </button>
        )}

        {/* „Neuen Termin ansetzen" statt „Zurückholen": Der Unterschied zum
            Knopf daneben ist, dass hier wirklich ein Termin im Kalender
            entsteht. Stand er nur im Tooltip, war er auf dem Touchgerät gar
            nicht zu erfahren — und ein Fehlgriff legt einen Termin an, den
            niemand wollte. */}
        {!row.revive_blocked && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setReviveOpen(true)}
            title="Neues Setting für diesen Lead anlegen. Der alte Vorgang bleibt abgeschlossen stehen."
            style={{ ...ghostBtn, cursor: isPending ? "default" : "pointer" }}
          >
            <RotateCcw size={12} /> Neuen Termin ansetzen
          </button>
        )}

        {error && (
          <span style={{ fontSize: "var(--fs-xs)", fontWeight: 500, color: "var(--danger-fg)" }}>{error}</span>
        )}
        {!error && note && (
          <span style={{ fontSize: "var(--fs-xs)", fontWeight: 500, color: "var(--success-fg)" }}>{note}</span>
        )}
      </div>

      {/* Warum ein Knopf fehlt, gehört sichtbar in die Karte und nicht nur in
          einen Tooltip: auf dem Touchgerät gibt es keinen Hover — und einen
          Tooltip an etwas, das gar nicht mehr da ist, gibt es ohnehin nicht. */}
      {hints.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
          {hints.map((hint) => (
            <span
              key={hint}
              style={{
                display: "inline-flex",
                alignItems: "flex-start",
                gap: "var(--sp-3)",
                fontSize: "var(--fs-2xs)",
                color: "var(--text-subtle)",
              }}
            >
              <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 1 }} />
              {hint}
            </span>
          ))}
        </div>
      )}

      <LeadDossierSheet
        open={dossierOpen}
        onClose={() => setDossierOpen(false)}
        kind={meta.dossier}
        id={row.entity_id}
      />

      {/* Erst beim Schließen neu laden: In „Ersatztermin offen" verschwindet
          die Karte durch die Rückholung, und mit ihr der Verweis auf den neuen
          Termin — der steht deshalb im Modal, solange es offen ist. */}
      <ReviveDialog
        open={reviveOpen}
        onClose={(created) => {
          setReviveOpen(false);
          if (created) router.refresh();
        }}
        row={row}
      />
    </article>
  );
}

/* ------------------------------------------------------------------ *
 * Board
 * ------------------------------------------------------------------ */

export function AblageBoard({
  list,
  rows,
  available,
  maxAttempts,
  today,
}: {
  list: DropoutListKey;
  rows: DropoutRow[];
  /** false = Migration 0033 fehlt. NICHT dasselbe wie „Liste ist leer". */
  available: boolean;
  maxAttempts: number;
  today: string;
}) {
  const meta = dropoutListMeta(list);
  const { confirm, dialog } = useConfirm();
  // Speist diese Liste überhaupt einen Zweig von `recycle_tasks`? Wenn nicht,
  // ist „Recycling vorziehen" auf jeder Karte aus demselben Grund aus — der
  // steht dann einmal hier statt sechsmal untereinander.
  const listFeeds = listFeedsRecycling(list, "setting") || listFeedsRecycling(list, "closing");
  // Und dieselbe Frage für den zweiten Knopf: Wo er auf keiner Karte steht,
  // erklärt der Fuß ihn auch nicht — sonst schickt der Text den Nutzer auf die
  // Suche nach einem Knopf, den es in dieser Ansicht bewusst nicht gibt.
  const listRevives = listAllowsRevive(list);

  const confirmBlock = (row: DropoutRow) =>
    confirm({
      title: "Dauerhaft sperren?",
      destructive: true,
      confirmLabel: "Sperren",
      message: (
        <>
          <strong style={{ color: "var(--text-primary)" }}>{row.lead_name?.trim() || "Dieser Lead"}</strong> bekommt
          kein weiteres Recycling und erscheint für <strong style={{ color: "var(--text-primary)" }}>alle</strong> in
          der Sperrliste. Der Vorgang bleibt erhalten — nur die Wiedervorlage entfällt.
        </>
      ),
    });

  /* ── Fehlendes Schema: NICHT der ruhige Leerzustand ── */
  if (!available) {
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
            Die Ablage ist nicht verfügbar
          </div>
          <p
            style={{
              margin: "var(--sp-3) 0 0",
              fontSize: "var(--fs-sm)",
              color: "var(--text-secondary)",
              maxWidth: "62ch",
            }}
          >
            Der Datenbank fehlt die Abfrage, aus der die Ablage entsteht &mdash; Migration 0033 ist noch nicht
            eingespielt. Das ist ausdrücklich <strong>nicht</strong> dasselbe wie &bdquo;die Liste ist leer&ldquo;:
            Es liegen möglicherweise ausgeschiedene Vorgänge da, die hier gerade niemand sieht. Ein Administrator
            spielt die Migration im Supabase-SQL-Editor ein.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      {dialog}

      {/* Die Sperrliste ist die einzige Ansicht ohne Personenfilter — DASS das
          so ist, muss in der Oberfläche stehen und nicht nur im Code: ein
          Kontaktverbot, das nur sein Besitzer sieht, ist keines. WARUM es so
          ist, steht hinter dem Info-Icon; der Absatz stand vorher über jeder
          einzelnen Ansicht der Sperrliste und sagte beim zweiten Lesen nichts
          Neues mehr. Aus dem Kasten wird damit eine Zeile. */}
      {meta.orgWide && (
        <div
          className="card"
          style={{
            padding: "var(--sp-5) var(--sp-6)",
            display: "flex",
            gap: "var(--sp-4)",
            alignItems: "center",
            background: "var(--info-bg)",
            borderColor: "rgb(78 128 214 / 0.28)",
          }}
        >
          <Users size={16} style={{ flexShrink: 0, color: "var(--info-fg)" }} />
          <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--info-fg)" }}>
            Org-weit — unabhängig von der eingestellten Datensicht
          </span>
          <InfoPopover label="Warum die Sperrliste org-weit ist" width={360}>
            Diese Liste zeigt <strong>alle</strong> gesperrten Vorgänge der Organisation, auch die fremder Personen.
            Ein Kontaktverbot, das nur sein Besitzer sieht, ist keines: die nächste Person spräche den Lead sonst
            neu an.
          </InfoPopover>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card fade-up dot-grid">
          <div className="empty-state">
            <Inbox size={24} aria-hidden />
            <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: "var(--text-primary)" }}>
              Nichts abgelegt
            </div>
            <p style={{ maxWidth: 420 }}>{meta.meta} Sobald ein Vorgang so endet, erscheint er hier.</p>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
            gap: "var(--sp-5)",
          }}
        >
          {rows.map((row) => (
            <DropoutCard
              key={`${row.entity_type}:${row.entity_id}`}
              row={row}
              list={list}
              maxAttempts={maxAttempts}
              today={today}
              confirmBlock={confirmBlock}
            />
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--sp-3)",
            fontSize: "var(--fs-xs)",
            color: "var(--text-subtle)",
            lineHeight: "var(--lh-base)",
          }}
        >
          {!listFeeds && (
            <span>
              {/* In der Sperrliste fehlen BEIDE Knöpfe, und zwar aus einem
                  Grund — dann ist es auch ein Satz. */}
              {list === "gesperrt"
                ? "Gesperrte Vorgänge bekommen weder eine Wiedervorlage noch einen neuen Termin — das ist der Zweck der Sperre."
                : "Hier gibt es kein Recycling: Der nächste Schritt ist der Ersatztermin, nicht eine Wiedervorlage in Wochen."}
            </span>
          )}
          {/* Was der Knopf TUT, bleibt stehen — es ist die eine Auskunft, die
              vor dem Klick zählt. Warum er es so tut (Quoten eines
              abgeschlossenen Zeitraums, frische Zähler), steht hinter dem Icon:
              Das erklärt das Verhalten der Software und ändert keine
              Entscheidung an dieser Karte. */}
          {listRevives && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}>
              &bdquo;Neuen Termin ansetzen&ldquo; legt ein <strong>neues Erstgespr&auml;ch</strong> an; der alte
              Vorgang bleibt abgeschlossen stehen.
              <InfoPopover label="Neuen Termin ansetzen: warum der alte Vorgang stehen bleibt" width={360}>
                Ein zurückgedrehter Vorgang veränderte rückwirkend die Quoten eines abgeschlossenen Zeitraums.
                Der neue Termin beginnt deshalb mit leeren Zählern — die des Vorgängers stehen dafür auf seiner
                Karte.
              </InfoPopover>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
