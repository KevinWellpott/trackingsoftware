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
  Handshake,
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
  dropoutReasonLabel,
  listFeedsRecycling,
  type DropoutEntity,
  type DropoutListKey,
} from "@/lib/dropoutLists";
import type { DossierEntityKind } from "@/lib/leadDossier";
import { LeadDossierSheet } from "@/components/lead/LeadDossierSheet";
import { Badge, StageBadge, type StageKey } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ownerColor } from "@/lib/ownerColor";

// Ablage-Board: eine Karte je ausgeschiedenem Vorgang.
//
// Die Karte beantwortet genau die vier Fragen, die man an einem Aktenschrank
// stellt — wer war das, warum liegt er hier, seit wann, und was passiert als
// Nächstes. Der Grund steht deshalb doppelt: als Code (zählbar, gleich
// beschriftet wie überall sonst) UND als Freitext daneben, wenn es einen gibt.
//
// Zwei Aktionen, mehr nicht:
//   · „Recycling vorziehen" setzt die Wiedervorlage auf heute — der Vorgang
//     erscheint dann in der Recycling-Sektion von /nachfassen. Ist das nicht
//     möglich, steht der Grund am ausgeschalteten Knopf statt einer
//     Fehlermeldung nach dem Klick (recycleBlockedReason, lib/dropoutLists.ts).
//   · „Endgültig sperren" schreibt das dauerhafte Kontaktverbot — die einzige
//     Aktion hier, die etwas wegnimmt, deshalb mit Rückfrage.
//
// „Zurückholen" (Entscheidung K10) steht bewusst als ausgeschalteter Knopf da:
// ein zurückgeholter Lead wird ein NEUER Vorgang mit eigener Anlagestrecke.
// Eine halb funktionierende Fassung, die nur den alten Termin wiederbelebt,
// wäre schlimmer als keine.

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
    /** null = kein Ziel auflösbar (Lead ohne Liste) — der Knopf bleibt dann aus. */
    href: (row: DropoutRow) => string | null;
    linkLabel: string;
    /** Anker des Lead-Dossiers — `entity_id` ist immer die Ursprungszeile. */
    dossier: DossierEntityKind;
  }
> = {
  setting: {
    label: "Erstgespräch",
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

const disabledBtn: React.CSSProperties = {
  ...ghostBtn,
  color: "var(--text-disabled)",
  borderColor: "var(--border-subtle)",
  background: "transparent",
  cursor: "default",
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

  const meta = ENTITY_META[row.entity_type];
  const href = meta.href(row);
  const dueNow = Boolean(row.next_recycle_at && row.next_recycle_at <= today);
  const blocked = row.recycle_blocked;
  // Liegt die Sperre am ZUSTAND dieser Zeile (gesperrt, wiederbelebt, Deckel,
  // Grund ohne Recycling), gehört sie in die Karte. Kann dagegen die ganze
  // Liste kein Recycling speisen, stünde derselbe Satz auf jeder Karte — den
  // trägt dann eine Zeile am Fuß des Boards.
  const rowCouldFeed = listFeedsRecycling(list, row.entity_type);

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
          <Badge tone={row.reason_code ? "neutral" : "warning"} title="Grund als Code — danach wird gezählt">
            {dropoutReasonLabel(row.reason_code)}
          </Badge>
          {row.excluded && (
            <Badge tone="error" title="Dauerhaftes Kontaktverbot">
              <Lock size={11} /> Gesperrt
            </Badge>
          )}
          {row.revived_at && (
            <Badge tone="success" title={`Zurück im Funnel seit ${formatDay(row.revived_at)}`}>
              Wiederbelebt
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
        {href ? (
          <Link href={href} style={ghostBtn}>
            {meta.linkLabel} <ArrowUpRight size={12} />
          </Link>
        ) : (
          <button type="button" disabled style={disabledBtn} title="Der Lead hängt an keiner Liste mehr.">
            {meta.linkLabel} <ArrowUpRight size={12} />
          </button>
        )}

        {/* Die Akte zum abgelegten Vorgang. Hier trägt sie mehr als auf den
            Arbeitslisten: Bevor man einen toten Lead vorzieht oder dauerhaft
            sperrt, ist der Verlauf die einzige Grundlage für die Entscheidung —
            und der Verweis daneben führt bei LinkedIn- und Telefon-Zeilen nur
            zur Liste, nicht zum Lead. Der einzige Weg zur Historie einer
            solchen Zeile führt über das Dossier. */}
        <button
          type="button"
          onClick={() => setDossierOpen(true)}
          style={ghostBtn}
          title="Alles zu diesem Lead — Verlauf, Kanäle, Notizen"
        >
          <Users size={12} /> Dossier
        </button>

        {blocked ? (
          <button type="button" disabled style={disabledBtn} title={blocked}>
            <ChevronsRight size={12} /> Recycling vorziehen
          </button>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={pullForward}
            title="Wiedervorlage auf heute setzen — der Vorgang erscheint dann in der Recycling-Sektion von Nachfassen."
            style={{ ...ghostBtn, cursor: isPending ? "default" : "pointer" }}
          >
            <ChevronsRight size={12} /> Recycling vorziehen
          </button>
        )}

        {row.excluded ? (
          <button type="button" disabled style={disabledBtn} title="Der Vorgang ist bereits dauerhaft gesperrt.">
            <Ban size={12} /> Gesperrt
          </button>
        ) : (
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

        {/* Platzhalter für Entscheidung K10 — bewusst ohne Funktion; der
            Hinweis dazu steht einmal am Fuß des Boards. */}
        <button type="button" disabled style={disabledBtn} title="Noch nicht angeschlossen (Entscheidung K10).">
          <RotateCcw size={12} /> Zurückholen
        </button>

        {error && (
          <span style={{ fontSize: "var(--fs-xs)", fontWeight: 500, color: "var(--danger-fg)" }}>{error}</span>
        )}
        {!error && note && (
          <span style={{ fontSize: "var(--fs-xs)", fontWeight: 500, color: "var(--success-fg)" }}>{note}</span>
        )}
      </div>

      {/* Der Grund gegen das Vorziehen gehört sichtbar in die Karte und nicht
          nur in einen Tooltip: auf dem Touchgerät gibt es keinen Hover. */}
      {blocked && rowCouldFeed && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "flex-start",
            gap: "var(--sp-3)",
            fontSize: "var(--fs-2xs)",
            color: "var(--text-subtle)",
          }}
        >
          <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 1 }} />
          {blocked}
        </span>
      )}

      <LeadDossierSheet
        open={dossierOpen}
        onClose={() => setDossierOpen(false)}
        kind={meta.dossier}
        id={row.entity_id}
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
            Die Funktion <code>dropout_lists</code> fehlt in der Datenbank — die Migration ist noch nicht
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

      {/* Die Sperrliste ist die einzige Ansicht ohne Personenfilter — das muss
          in der Oberfläche stehen, nicht nur im Code: ein Kontaktverbot, das
          nur sein Besitzer sieht, ist keines. */}
      {meta.orgWide && (
        <div
          className="card"
          style={{
            padding: "var(--sp-5) var(--sp-6)",
            display: "flex",
            gap: "var(--sp-5)",
            alignItems: "flex-start",
            background: "var(--info-bg)",
            borderColor: "rgb(78 128 214 / 0.28)",
          }}
        >
          <Users size={16} style={{ flexShrink: 0, marginTop: 2, color: "var(--info-fg)" }} />
          <div>
            <div style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--info-fg)" }}>
              Org-weit — unabhängig von der eingestellten Datensicht
            </div>
            <p
              style={{
                margin: "var(--sp-2) 0 0",
                fontSize: "var(--fs-sm)",
                color: "var(--text-secondary)",
                maxWidth: "68ch",
              }}
            >
              Diese Liste zeigt <strong>alle</strong> gesperrten Vorgänge der Organisation, auch die fremder
              Personen. Ein Kontaktverbot, das nur sein Besitzer sieht, ist keines: die nächste Person spräche den
              Lead sonst neu an.
            </p>
          </div>
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
              {list === "gesperrt"
                ? "Gesperrte Vorgänge bekommen keine Wiedervorlage mehr — das ist der Zweck der Sperre."
                : "Hier gibt es kein Recycling: Der nächste Schritt ist der Ersatztermin, nicht eine Wiedervorlage in Wochen."}
            </span>
          )}
          <span>
            &bdquo;Zur&uuml;ckholen&ldquo; ist noch nicht angeschlossen: Ein zur&uuml;ckgeholter Lead wird ein
            <strong> neuer Vorgang</strong> mit eigener Anlagestrecke, nicht der wiederbelebte alte Termin
            (Entscheidung K10).
          </span>
        </div>
      )}
    </div>
  );
}
