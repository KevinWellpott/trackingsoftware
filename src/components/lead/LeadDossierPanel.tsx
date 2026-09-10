"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  AtSign,
  CalendarClock,
  Check,
  CircleHelp,
  Clock,
  Copy,
  Globe,
  Mail,
  MessageCircle,
  Phone,
  Split,
  Users,
} from "lucide-react";
import { Badge, StageBadge, type StageKey } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { InfoPopover } from "@/components/ui/InfoPopover";
import { ownerColor } from "@/lib/ownerColor";
import { formatTerminParts } from "@/lib/apptTime";
import {
  DOSSIER_ENTITY_LABELS,
  dossierEmptyKind,
  dossierPath,
  type DossierChannel,
  type DossierEntityKind,
  type DossierEvent,
  type DossierEventSource,
  type DossierEventTone,
  type DossierLink,
  type LeadDossier,
} from "@/lib/leadDossier";

// Das Lead-Dossier als Panel: eine Karte, die genauso in einer eigenen Route
// wie in einem Seiten-Panel von /nachfassen oder /erinnerungen steht. Sie holt
// nichts nach — alles kommt als Prop, damit sie in beiden Rahmen ohne
// zweiten Datenweg funktioniert.
//
// Die Reihenfolge ist die eines Anrufs, nicht die der Datenbank: Wer spreche
// ich an → wann hatte ich zuletzt Kontakt → worüber erreiche ich ihn → was
// weiß ich über ihn → was ist offen → was war.
//
// Ember Glass: Karten, Abstände und Token wörtlich wie in
// ErinnerungenBoard/AblageBoard; Orange trägt nie Status (DESIGN.md §3.5).

/* ------------------------------------------------------------------ *
 * Beschriftungen & kleine Bausteine
 * ------------------------------------------------------------------ */

const SOURCE_META: Record<DossierEventSource, { label: string; stage: StageKey | null }> = {
  linkedin: { label: "LinkedIn", stage: "linkedin" },
  telefon: { label: "Telefon", stage: "telefon" },
  setting: { label: "Setting", stage: "setting" },
  closing: { label: "Closing", stage: "closing" },
  erinnerung: { label: "Erinnerung", stage: "nachfassen" },
  recycling: { label: "Recycling", stage: null },
};

const TONE_COLOR: Record<DossierEventTone, string> = {
  neutral: "var(--text-muted)",
  info: "var(--info-fg)",
  success: "var(--success-fg)",
  warning: "var(--warning-fg)",
  danger: "var(--danger-fg)",
};

const CHANNEL_ICON: Record<DossierChannel["kind"], React.ReactNode> = {
  linkedin: <AtSign size={12} />,
  email: <Mail size={12} />,
  phone: <Phone size={12} />,
  whatsapp: <MessageCircle size={12} />,
  website: <Globe size={12} />,
};

/** Route zur Detailseite eines verknüpften Vorgangs — je Art eine andere. */
const ENTITY_HREF: Record<DossierEntityKind, (id: string) => string> = {
  contact: (id) => dossierPath("contact", id),
  phone_lead: (id) => dossierPath("phone_lead", id),
  setting: (id) => `/setting/${id}`,
  closing: (id) => `/closing/${id}`,
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

/** "Do 17.07., 14:00" bzw. "Do 17.07." — Tagesdaten haben keine Uhrzeit. */
function whenLabel(event: Pick<DossierEvent, "at" | "precision">): string {
  if (event.precision === "day") {
    // Mittag, damit die Zonenumrechnung den Tag nicht kippt (docs §6).
    const parts = formatTerminParts(`${event.at}T12:00:00.000Z`);
    return parts ? parts.date : event.at;
  }
  const parts = formatTerminParts(event.at);
  return parts ? `${parts.date}, ${parts.time}` : event.at;
}

function PersonPill({ name, label }: { name: string; label: string }) {
  const color = ownerColor(name);
  return (
    <span
      title={label}
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

function SectionTitle({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="eyebrow eyebrow-muted" style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
      {children}
      {count != null && <span className="count-pill">{count}</span>}
    </div>
  );
}

/** Kopierbarer Kontaktweg — beim Anruf zählt jeder Klick weniger. */
function ChannelRow({ channel }: { channel: DossierChannel }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(channel.value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // In unsicheren Kontexten schlägt das Kopieren fehl — der Wert steht
      // trotzdem markierbar da.
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", minHeight: 26 }}>
      <span style={{ color: "var(--text-muted)", display: "inline-flex", flexShrink: 0 }}>
        {CHANNEL_ICON[channel.kind]}
      </span>
      <span style={{ fontSize: "var(--fs-2xs)", color: "var(--text-subtle)", minWidth: 68, flexShrink: 0 }}>
        {channel.label}
      </span>
      {channel.href ? (
        <a
          href={channel.href}
          target={channel.kind === "linkedin" || channel.kind === "website" ? "_blank" : undefined}
          rel="noreferrer"
          style={{
            fontSize: "var(--fs-sm)",
            color: "var(--text-primary)",
            textDecoration: "none",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {channel.value}
        </a>
      ) : (
        <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-primary)", userSelect: "text" }}>
          {channel.value}
        </span>
      )}
      {channel.note && (
        <span style={{ fontSize: "var(--fs-2xs)", color: "var(--text-subtle)" }}>{channel.note}</span>
      )}
      <button
        type="button"
        onClick={copy}
        title={copied ? "Kopiert" : "Kopieren"}
        aria-label={`${channel.label} kopieren`}
        style={{
          marginLeft: "auto",
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
          flexShrink: 0,
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

/** Eine Zeile der Zeitleiste. */
function EventRow({ event }: { event: DossierEvent }) {
  const meta = SOURCE_META[event.source];
  return (
    <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "flex-start", minHeight: 24 }}>
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: "var(--r-full)",
          background: TONE_COLOR[event.tone],
          flexShrink: 0,
          marginTop: 6,
          // Der Punkt sitzt auf der Leiste, nicht daneben: Einzug der Spalte
          // (--sp-6) plus halbe Linienbreite plus halber Punkt zurück.
          marginLeft: "calc(var(--sp-6) * -1 - 4.5px)",
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-4)", flexWrap: "wrap" }}>
          <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text-primary)" }}>
            {event.title}
          </span>
          <span style={{ fontSize: "var(--fs-2xs)", color: "var(--text-subtle)" }}>{meta.label}</span>
          <span
            style={{
              marginLeft: "auto",
              fontSize: "var(--fs-2xs)",
              color: "var(--text-subtle)",
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {event.estimated && "≈ "}
            {whenLabel(event)}
          </span>
        </div>
        {event.detail && (
          <div
            style={{
              marginTop: 2,
              fontSize: "var(--fs-xs)",
              color: "var(--text-muted)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {event.detail}
          </div>
        )}
      </div>
    </div>
  );
}

function LinkRow({ link }: { link: DossierLink }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap", minHeight: 26 }}>
      <Badge tone={link.confidence === "belegt" ? "neutral" : "warning"} title={link.via}>
        {link.confidence === "belegt" ? link.label : `${link.label} · Vermutung`}
      </Badge>
      <span
        style={{
          fontSize: "var(--fs-sm)",
          color: "var(--text-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {link.summary}
      </span>
      <Link href={ENTITY_HREF[link.kind](link.id)} style={{ ...ghostBtn, marginLeft: "auto" }}>
        Öffnen <ArrowUpRight size={12} />
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Panel
 * ------------------------------------------------------------------ */

export function LeadDossierPanel({ dossier }: { dossier: LeadDossier }) {
  const { lastContact } = dossier;
  const stage = dossier.origin ? SOURCE_META[dossier.origin.source].stage : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      {/* ── Wer ───────────────────────────────────────────────── */}
      <article className="card" style={{ padding: "var(--sp-6)", display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-4)", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: "var(--fs-lg)",
                fontWeight: 600,
                letterSpacing: "var(--ls-display)",
                color: "var(--text-primary)",
              }}
            >
              {dossier.name ?? "Unbenannter Lead"}
            </div>
            <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
              {[dossier.company, dossier.role, dossier.targetGroup].filter(Boolean).join(" · ") || "Ohne Firma"}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {dossier.origin && stage && <StageBadge stage={stage}>{dossier.origin.label}</StageBadge>}
            {dossier.origin && !stage && <Badge tone="neutral">{dossier.origin.label}</Badge>}
            {dossier.assigneeName && <PersonPill name={dossier.assigneeName} label="Zuständig für die Termine" />}
            {dossier.ownerName && dossier.ownerName !== dossier.assigneeName && (
              <PersonPill name={dossier.ownerName} label="Inhaber der Quellliste" />
            )}
          </div>
        </div>

        {dossier.warnings.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
            {dossier.warnings.map((w) => (
              <span
                key={w}
                style={{
                  display: "inline-flex",
                  alignItems: "flex-start",
                  gap: "var(--sp-3)",
                  fontSize: "var(--fs-xs)",
                  fontWeight: 500,
                  color: "var(--danger-fg)",
                }}
              >
                <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                {w}
              </span>
            ))}
          </div>
        )}

        {/* ── Zuletzt kontaktiert: die eine Zahl, die auf den Karten
             von /nachfassen und /erinnerungen bisher fehlt ── */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "var(--sp-4)",
            flexWrap: "wrap",
            padding: "var(--sp-4) var(--sp-5)",
            background: "var(--surface-1)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--r-sm)",
          }}
        >
          <Clock size={13} style={{ color: "var(--text-muted)", flexShrink: 0, alignSelf: "center" }} />
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>Zuletzt kontaktiert</span>
          <span
            style={{
              fontSize: "var(--fs-md)",
              fontWeight: 600,
              color: "var(--text-primary)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {lastContact.estimated && lastContact.at ? "≈ " : ""}
            {lastContact.label}
          </span>
          {lastContact.at && (
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>
              {whenLabel({ at: lastContact.at, precision: lastContact.precision ?? "moment" })}
              {lastContact.source ? ` · ${SOURCE_META[lastContact.source].label}` : ""}
            </span>
          )}
          {(lastContact.caveats.length > 0 || lastContact.estimated) && (
            <InfoPopover label="Wie sicher ist diese Zahl?" width={360}>
              Gezählt wird über <strong>alle</strong> Quellen zusammen: Pitches, Anwahlen, geführte Termine,
              abgehakte Erinnerungen und Recycling-Versuche.{" "}
              {lastContact.estimated
                ? "Der jüngste Kontakt trägt keinen erfassten Zeitpunkt und ist nur eingeordnet — deshalb das ≈."
                : ""}
              {lastContact.caveats.map((c) => (
                <span key={c} style={{ display: "block", marginTop: "var(--sp-3)" }}>
                  {c}
                </span>
              ))}
            </InfoPopover>
          )}
        </div>
      </article>

      {/* ── Kontaktwege ───────────────────────────────────────── */}
      {dossier.channels.length > 0 && (
        <article className="card" style={{ padding: "var(--sp-6)", display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          <SectionTitle>Kontaktwege</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            {dossier.channels.map((c) => (
              <ChannelRow key={`${c.kind}:${c.value}`} channel={c} />
            ))}
          </div>
        </article>
      )}

      {/* ── Steckbrief ────────────────────────────────────────── */}
      {dossier.facts.length > 0 && (
        <article className="card" style={{ padding: "var(--sp-6)", display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          <SectionTitle>Steckbrief</SectionTitle>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
              gap: "var(--sp-4) var(--sp-5)",
            }}
          >
            {dossier.facts.map((f) => (
              <div key={f.label}>
                <div style={{ fontSize: "var(--fs-2xs)", color: "var(--text-subtle)" }}>{f.label}</div>
                <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-primary)" }}>{f.value}</div>
              </div>
            ))}
          </div>
        </article>
      )}

      {/* ── Verknüpfte Vorgänge + Vermutungen ─────────────────── */}
      <article className="card" style={{ padding: "var(--sp-6)", display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap" }}>
          <SectionTitle count={dossier.members.length}>Belegt zusammengehörig</SectionTitle>
          <InfoPopover label="Wie das Dossier zusammengeführt wird" width={400}>
            Zusammengeführt wird nur, was nachweislich zusammengehört: ein Setting, das seinen
            LinkedIn-Kontakt oder seinen Telefon-Lead festhält, und ein Closing, das aus diesem Setting
            entstanden ist. Nur diese Vorgänge speisen Zeitleiste und &bdquo;zuletzt kontaktiert&ldquo;. Ein
            LinkedIn-Kontakt und ein Telefon-Lead derselben Firma sind dagegen nirgends miteinander verbunden —
            sie erscheinen unten als Vermutung und werden bewusst nicht verschmolzen.
          </InfoPopover>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
          {dossier.members.map((m) => (
            <LinkRow key={`${m.kind}:${m.id}`} link={m} />
          ))}
        </div>

        {dossier.suspected.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--sp-4)",
              padding: "var(--sp-4) var(--sp-5)",
              background: "var(--warning-bg)",
              border: "1px solid rgb(209 162 79 / 0.28)",
              borderRadius: "var(--r-sm)",
            }}
          >
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
              <Split size={12} style={{ flexShrink: 0, marginTop: 1 }} />
              {dossier.suspected.length === 1 ? "Ein weiterer Vorgang" : `${dossier.suspected.length} weitere Vorgänge`}{" "}
              mit demselben Firmennamen — <strong>nicht</strong> eingerechnet. Ob es dieselbe Person ist, sagt kein
              Feld; zwei Menschen derselben Firma sind zwei Gesprächspartner.
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
              {dossier.suspected.map((s) => (
                <LinkRow key={`${s.kind}:${s.id}`} link={s} />
              ))}
            </div>
          </div>
        )}
      </article>

      {/* ── Steht an ──────────────────────────────────────────── */}
      {dossier.upcoming.length > 0 && (
        <article className="card" style={{ padding: "var(--sp-6)", display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          <SectionTitle count={dossier.upcoming.length}>
            <CalendarClock size={12} /> Steht an
          </SectionTitle>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--sp-4)",
              paddingLeft: "var(--sp-6)",
              borderLeft: "2px solid var(--border-subtle)",
            }}
          >
            {dossier.upcoming.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </div>
        </article>
      )}

      {/* ── Verlauf ───────────────────────────────────────────── */}
      <article className="card" style={{ padding: "var(--sp-6)", display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap" }}>
          <SectionTitle count={dossier.events.length}>Verlauf</SectionTitle>
          <InfoPopover label="Was die Zeitleiste zeigt — und was nicht" width={400}>
            Neuestes zuerst. Ein <strong>≈</strong> heißt: Der Zeitpunkt ist nicht erfasst und nur eingeordnet — die
            App speichert für LinkedIn-Follow-ups und für Gesprächsausgänge nur den erreichten Stand, kein Ereignis.
            Entwertete Erinnerungen (Planungsreste einer verschobenen Kaskade) stehen bewusst nicht hier, erledigte
            schon.
          </InfoPopover>
        </div>
        {dossier.events.length === 0 ? (
          <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
            Noch nichts passiert — außer dem, was oben unter &bdquo;Steht an&ldquo; steht.
          </p>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--sp-4)",
              paddingLeft: "var(--sp-6)",
              borderLeft: "2px solid var(--border-subtle)",
            }}
          >
            {dossier.events.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </div>
        )}
      </article>

      {/* ── Notizen ───────────────────────────────────────────── */}
      {dossier.notes.length > 0 && (
        <article className="card" style={{ padding: "var(--sp-6)" }}>
          <details>
            <summary
              className="collapse-summary"
              style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", cursor: "pointer", userSelect: "none" }}
            >
              <SectionTitle count={dossier.notes.length}>Notizen &amp; Gesprächsinhalte</SectionTitle>
            </summary>
            <div style={{ marginTop: "var(--sp-5)", display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
              {dossier.notes.map((n) => (
                <div key={n.id}>
                  <div style={{ fontSize: "var(--fs-2xs)", color: "var(--text-subtle)" }}>
                    {n.label} · {SOURCE_META[n.source].label}
                  </div>
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: "var(--fs-sm)",
                      lineHeight: 1.5,
                      color: "var(--text-secondary)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      userSelect: "text",
                    }}
                  >
                    {n.text}
                  </div>
                </div>
              ))}
            </div>
          </details>
        </article>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Leerzustände — zwei verschiedene Sätze, bewusst
 * ------------------------------------------------------------------ */

export function LeadDossierEmpty({
  available,
  error,
  onRetry,
}: {
  available: boolean;
  error?: string;
  /** Fehlt der Handler (eigene Route statt Overlay), entfällt der Knopf — dort
      ist das Neuladen der Seite der zweite Versuch. */
  onRetry?: () => void;
}) {
  const kind = dossierEmptyKind(available, error);
  const alarm = kind !== "not_found";
  return (
    <div
      className="card"
      style={{
        padding: "var(--sp-7) var(--sp-8)",
        display: "flex",
        gap: "var(--sp-5)",
        alignItems: "flex-start",
        background: alarm ? "var(--danger-bg)" : undefined,
        borderColor: alarm ? "rgb(214 90 82 / 0.28)" : undefined,
      }}
    >
      {alarm ? (
        <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2, color: "var(--danger-fg)" }} />
      ) : (
        <CircleHelp size={18} style={{ flexShrink: 0, marginTop: 2, color: "var(--text-muted)" }} />
      )}
      <div>
        <div
          style={{
            fontSize: "var(--fs-md)",
            fontWeight: 600,
            color: alarm ? "var(--danger-fg)" : "var(--text-primary)",
          }}
        >
          {kind === "missing_schema"
            ? "Dossier nicht verfügbar"
            : kind === "load_failed"
              ? "Dossier konnte nicht geladen werden"
              : "Kein Lead unter dieser Adresse"}
        </div>
        <p style={{ margin: "var(--sp-3) 0 0", fontSize: "var(--fs-sm)", color: "var(--text-secondary)", maxWidth: "62ch" }}>
          {kind === "missing_schema"
            ? (error ??
              "Der Datenbank fehlen Spalten, die das Dossier liest — eine Migration ist nicht eingespielt.")
            : kind === "load_failed"
              ? // Der Fehlertext gehört sichtbar hierher: Er ist der einzige
                // Hinweis darauf, dass über den Lead selbst nichts gesagt wurde.
                `${error} Über diesen Lead sagt das nichts — der Abruf ist gescheitert, nicht die Suche.`
              : "Die Zeile gibt es in dieser Organisation nicht (mehr), oder die eingestellte Datensicht zeigt woandershin."}
        </p>
        {kind === "load_failed" && onRetry && (
          <div style={{ marginTop: "var(--sp-5)" }}>
            <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
              Nochmal versuchen
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Kleiner Verweis für Karten anderer Boards — der Einstieg ins Dossier. */
export function LeadDossierLink({
  kind,
  id,
  label = "Dossier",
}: {
  kind: DossierEntityKind;
  id: string;
  label?: string;
}) {
  return (
    <Link href={dossierPath(kind, id)} style={ghostBtn} title={`${DOSSIER_ENTITY_LABELS[kind]} — alles zu diesem Lead`}>
      <Users size={12} /> {label}
    </Link>
  );
}
