import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Calendar, CalendarCheck, CalendarDays, CalendarX, DoorOpen, FileText, Filter, Inbox,
  MessageSquare, Phone, PhoneCall, PhoneForwarded, PhoneOff, PieChart, Repeat, Smile, Target,
  TrendingUp, UserCheck, Users, Voicemail, XCircle,
} from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { loadPhoneLeads, phoneLeadDay, type AnalysePhoneLead } from "@/lib/analyseData";
import {
  CALL_KIND_LABELS,
  loadCallAttempts,
  summarizeAttemptsByKind,
} from "@/lib/phoneAttemptsData";
import {
  NUM, SENTIMENT_META, WEEKDAY_LABELS, buildBuckets, bucketOf, ownerKey, pct, weekdayIndex,
  type Granularity,
} from "@/lib/analyse";
import { VIZ_NEUTRAL } from "@/lib/viz";
import { InfoPopover } from "@/components/ui/InfoPopover";
import { AnalyseSection, MigrationHint } from "@/components/analyse/AnalyseSection";
import { ComparisonTable, type ComparisonRow } from "@/components/analyse/ComparisonTable";
import { CumulativeProgressChart } from "@/components/analyse/CumulativeProgressChart";
import { FunnelStrip } from "@/components/analyse/FunnelStrip";
import {
  Footnote, MetricTable, ShareBar, type MetricColumn, type MetricRow,
} from "@/components/analyse/AnalyseTables";
import { PhoneSeriesChart } from "@/components/analyse/AnalyseCharts";
import { DistBars, DonutChart, KpiHero, QuoteColumns, WeekdayBars, KpiRow } from "@/components/analyse/AnalyseViz";

// Telefon-Flow: Calls → Gatekeeper → Entscheider → Pitch → Termine, aus
// rpc_phone_day_metrics (benötigt Migration 0013), plus Vorperioden-Deltas.
//
// Die Lead-Ebene (zweiter Teil) beantwortet die Fragen, die die Tages-RPC nicht
// kennt: Wie oft muss man anrufen? Wie kommt man am Gatekeeper vorbei? Wie
// klingen die Gespräche? Welches Skript und welche Branche konvertieren?
//
// Drei Zählebenen, die nicht verwechselt werden dürfen:
//   RPC-Ebene      Leads mit Erstkontakt im Zeitraum ("Calls")
//   Lead-Ebene     Zustand eines Leads heute (call_attempt, Gatekeeper, …)
//   Ereignis-Ebene Anwahlen aus phone_call_attempts (Migration 0028) — die
//                  einzige Ebene, auf der derselbe Lead dreimal zählt, und
//                  damit die einzige, die "nachfassen oder neu scrapen?"
//                  beantworten kann. Startet bei null, siehe Fußnote dort.
//
// RPC- und Lead-Ebene beschreiben dieselbe KOHORTE: Beide schneiden auf
// `coalesce(first_call_at, created_at::date) between from and to` zu (SQL:
// rpc_phone_day_metrics, JS: phoneLeadDay). Nur deshalb dürfen Zähler von der
// Lead-Ebene (Mailbox, Pitch) über einen Nenner von der RPC-Ebene (Calls)
// gerechnet werden.

type Member = { user_id: string; username: string };

type PhoneDayRow = {
  owner_name: string | null;
  day: string;
  calls: number | string | null;
  gatekeeper_reached: number | string | null;
  decider_reached: number | string | null;
  appointments: number | string | null;
  callbacks: number | string | null;
  dead: number | string | null;
};

/**
 * Kennzahlen einer Person im Zeitraum.
 *
 * `calls`–`dead` kommen aus der RPC, `pitch` und `mailbox` von der Lead-Ebene
 * (die RPC kennt beide Spalten nicht). Beide Quellen zählen dieselbe Kohorte —
 * siehe Kopfkommentar.
 */
type Totals = {
  calls: number;
  gatekeeper: number;
  decider: number;
  pitch: number;
  appts: number;
  callbacks: number;
  dead: number;
  mailbox: number;
};

const ZERO = (): Totals => ({
  calls: 0, gatekeeper: 0, decider: 0, pitch: 0, appts: 0, callbacks: 0, dead: 0, mailbox: 0,
});
const OHNE = "Ohne Zuordnung";
const INT_FMT = new Intl.NumberFormat("de-DE");

/**
 * Mindest-Fallzahl je Testarm (A/B-Sektionen).
 *
 * Ohne Untergrenze gewinnt jede Liste mit drei Leads und einem Zufallstermin
 * den Vergleich mit 33 % Terminquote. 20 ist kein Signifikanztest, aber die
 * Grenze, ab der ein einzelner Termin die Quote nicht mehr verdoppelt.
 */
const MIN_AB_CALLS = 20;

/** Kalendertag eines UTC-Zeitstempels als "09.08.2026" — für die Log-Fußnote. */
const DAY_FMT = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Berlin",
});

/** "2026-08-09" → "09.08." — kompakte Zeitraum-Beschriftung für den Fortschritts-Chart. */
function shortDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}.${m}.`;
}

/**
 * Status-Reihenfolge, Labels und Token-Farben der Outcome-Verteilung.
 * Bewusst SEMANTIK-Töne statt der kategorialen Viz-Palette: die Segmente sind
 * Zustände, und Markenorange trägt niemals Status (DESIGN.md §3.5). Grün heißt
 * in der ganzen App „gewonnen/erreicht", Gold „dranbleiben", Rot „tot".
 */
const STATUS_META: { key: string; label: string; color: string }[] = [
  { key: "aktiv", label: "Aktiv", color: VIZ_NEUTRAL },
  { key: "rueckruf", label: "Rückruf", color: "var(--info)" },
  { key: "nicht_erreicht", label: "Nicht erreicht", color: "var(--warning)" },
  { key: "termin", label: "Termin", color: "var(--success)" },
  { key: "dead", label: "Dead", color: "var(--danger)" },
];

const GATEKEEPER_LABELS: Record<string, string> = {
  direkt: "Direkt zum Entscheider",
  ja: "Gatekeeper durchgestellt",
  nein: "Gatekeeper blockte",
  ohne: "Ohne Angabe",
};

/** Prozentuale Veränderung vs. Vorperiode; Vorwert 0 → null (kein Delta). */
function deltaPct(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

/** Differenz zweier Quoten in Prozentpunkten; eine Seite null → null. */
function deltaPP(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null) return null;
  return cur - prev;
}

/**
 * „Am Gatekeeper vorbei" — durchgestellt ODER direkt beim Entscheider gelandet.
 * Exakt die Definition aus `rpc_phone_day_metrics`
 * (`gatekeeper_reached in ('ja','direkt')`); hier für die Lead-Ebene gespiegelt,
 * damit A/B-Sektion und KPI-Reihe nicht auseinanderlaufen.
 */
function passedGatekeeper(l: AnalysePhoneLead): boolean {
  return l.gatekeeper_reached === "ja" || l.gatekeeper_reached === "direkt";
}

/**
 * Freitext-Gründe zu DistBars-Items: trimmen, leere überspringen,
 * case-insensitiv deduplizieren (erste Schreibweise gewinnt), absteigend sortiert.
 */
function reasonItems(rows: AnalysePhoneLead[], field: keyof AnalysePhoneLead): { label: string; value: number }[] {
  const counts = new Map<string, { label: string; value: number }>();
  for (const r of rows) {
    const trimmed = ((r[field] as string | null) ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.value += 1;
    else counts.set(key, { label: trimmed, value: 1 });
  }
  return [...counts.values()].sort((a, b) => b.value - a.value);
}

/** Stagger-Wrapper für Sektionen (KpiHero animiert sich selbst). */
function Fade({ i, children }: { i: number; children: ReactNode }) {
  return (
    <div className="fade-up" style={{ display: "grid", animationDelay: `${i * 60}ms` }}>
      {children}
    </div>
  );
}

// ── Bausteine für die Info-Popover ───────────────────────────
// Die Erklärtexte standen früher als <Footnote> unter jeder Sektion. Fachlich
// unverzichtbar (Nenner, Kohorten, Datenlücken), beim täglichen Lesen aber im
// Weg — sie hängen jetzt am `info`-Prop der Sektion bzw. der Blocküberschrift.
//
// Alle drei Helfer sind bewusst lokal: `AnalyseSection`, `AnalyseTables` und
// `InfoPopover` sind fertig und werden nicht angefasst. (`Fade` oben ist aus
// demselben Grund schon länger in mehreren Tabs dupliziert.)

/**
 * Absätze im Popover. Grid mit Gap statt <p>-Rändern: Ränder des ersten und
 * letzten Absatzes addierten sich sonst auf das Padding des Popovers.
 */
function InfoBody({ children }: { children: ReactNode }) {
  return <div style={{ display: "grid", gap: "var(--sp-4)" }}>{children}</div>;
}

/**
 * Hervorhebung im Fließtext. Eigenes <strong>, weil der Browser-Default 700
 * wiegt — über der Obergrenze des Design-Systems (max. 600).
 */
function B({ children }: { children: ReactNode }) {
  return <strong style={{ fontWeight: 600 }}>{children}</strong>;
}

/**
 * Überschrift für einen Kachelblock OHNE eigene Karte.
 *
 * `AnalyseSection` ist eine Card — KPI-Kacheln darin wären Karten in einer
 * Karte. Die Kachelreihe hat damit aber auch keinen Sektionskopf, an dem ein
 * Info-Icon sitzen könnte; die Überschrift ist der einzige Anker, an dem der
 * Erklärtext nicht dauerhaft unter den Kacheln steht. Typografie identisch zum
 * Sektionskopf.
 */
function BlockHeading({
  title,
  meta,
  icon: Icon,
  info,
}: {
  title: string;
  meta?: string;
  icon?: LucideIcon;
  info?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: "var(--sp-3) var(--sp-4)",
        flexWrap: "wrap",
        marginTop: "var(--sp-4)",
      }}
    >
      {Icon && <Icon size={16} color="var(--text-muted)" style={{ flexShrink: 0, alignSelf: "center" }} />}
      <span
        style={{
          fontSize: "var(--fs-md)",
          fontWeight: 600,
          letterSpacing: "var(--ls-tight)",
          color: "var(--text-primary)",
        }}
      >
        {title}
      </span>
      {info && (
        <span style={{ display: "inline-flex", alignSelf: "center" }}>
          <InfoPopover label={`${title}: Erklärung`}>{info}</InfoPopover>
        </span>
      )}
      {meta && (
        <span className="eyebrow eyebrow-muted" style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>
          {meta}
        </span>
      )}
    </div>
  );
}

/** Leerzustand nach COMPONENTS.md §14.1 — Icon, ein Satz, ein Hinweis. */
function TableEmpty({ text, hint }: { text: string; hint?: string }) {
  return (
    <div
      style={{
        padding: "var(--sp-9) 0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--sp-3)",
        textAlign: "center",
      }}
    >
      <Inbox size={20} color="var(--text-muted)" aria-hidden />
      <span style={{ fontSize: "var(--fs-base)", color: "var(--text-secondary)" }}>{text}</span>
      {hint && <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{hint}</span>}
    </div>
  );
}

type LeadCell = { n: number; decider: number; appts: number; dead: number };
const ZERO_LEAD = (): LeadCell => ({ n: 0, decider: 0, appts: 0, dead: 0 });

// ── A/B-Vergleich: Skript-Arme und Zielgruppen ───────────────
// Beide Sektionen sind derselbe Schnitt über dieselbe Kohorte, nur mit einer
// anderen Gruppierungsachse. Deshalb eine gemeinsame Zelle, eine gemeinsame
// Gruppierung und eine gemeinsame Tabelle — sonst driften die Definitionen
// auseinander, sobald eine der beiden angefasst wird.

type AbCell = { key: string; label: string; calls: number; gatekeeper: number; decider: number; appts: number };

/**
 * Leads nach einer Freitext-Achse gruppieren.
 *
 * Normalisierung: trimmen, Mehrfach-Leerzeichen einkochen, case-insensitiv
 * deduplizieren (erste Schreibweise gewinnt). Ohne das stünden „Handwerk",
 * „handwerk " und „Hand  werk" als drei Arme mit je zu kleiner Fallzahl in der
 * Tabelle — und der Vergleich wäre wertlos.
 *
 * Leads ohne Wert landen NICHT in einer Sammelzeile: „Ohne Angabe" wäre am
 * Anfang der größte Balken und würde den eigentlichen Vergleich erdrücken. Sie
 * werden gezählt und in der Fußnote benannt — das ist zugleich die To-do-Liste.
 */
function groupLeads(
  rows: AnalysePhoneLead[],
  keyOf: (l: AnalysePhoneLead) => string | null | undefined,
): { cells: AbCell[]; unlabeled: number } {
  const map = new Map<string, AbCell>();
  let unlabeled = 0;
  for (const l of rows) {
    const label = (keyOf(l) ?? "").trim().replace(/\s+/g, " ");
    if (!label) {
      unlabeled += 1;
      continue;
    }
    const key = label.toLowerCase();
    let cell = map.get(key);
    if (!cell) {
      cell = { key, label, calls: 0, gatekeeper: 0, decider: 0, appts: 0 };
      map.set(key, cell);
    }
    // `calls` wie in der RPC: nur Leads mit echtem Erstkontakt. Nie angerufene
    // Leads blähen sonst den Nenner auf und drücken jede Quote des Arms.
    if (l.first_call_at) cell.calls += 1;
    if (passedGatekeeper(l)) cell.gatekeeper += 1;
    if (l.decider_reached === true) cell.decider += 1;
    if (l.appointment_set === true) cell.appts += 1;
  }
  return { cells: [...map.values()], unlabeled };
}

const AB_COLUMNS: MetricColumn[] = [
  { key: "calls", label: "Calls", format: "int" },
  { key: "gkRate", label: "GK-Quote", format: "pct" },
  { key: "deciderRate", label: "Entscheider", format: "pct" },
  { key: "apptRate", label: "Terminquote", format: "pct", emphasis: true },
];

/**
 * Erklärtext der A/B-Sektionen fürs Info-Popover.
 *
 * Liegt hier und nicht in `AbTable`, weil er am Sektionskopf hängt, nicht am
 * Tabellenfuß — `AbTable` steht bereits im Sektions-Körper.
 */
function abInfo({
  unlabeled,
  axisHint,
}: {
  unlabeled: number;
  /** Wo die Achse gepflegt wird. */
  axisHint: string;
}): ReactNode {
  return (
    <InfoBody>
      <span>
        Verglichen werden nur Arme mit mindestens {MIN_AB_CALLS} Calls — sonst gewinnt jede Liste mit drei Leads
        und einem Zufallstermin.
      </span>
      {unlabeled > 0 && (
        <span>
          {INT_FMT.format(unlabeled)} Leads im Zeitraum haben keine Angabe und zählen hier nicht mit — {axisHint}
        </span>
      )}
    </InfoBody>
  );
}

function AbTable({
  cells,
  emptyHint,
  axisLabel,
}: {
  cells: AbCell[];
  /** Überschrift der ersten Spalte („Skript-Arm" / „Branche"). */
  axisLabel: string;
  emptyHint: string;
}) {
  const eligible = cells.filter((c) => c.calls >= MIN_AB_CALLS);
  const hidden = cells.length - eligible.length;
  const totalCalls = cells.reduce((s, c) => s + c.calls, 0);

  const rows: MetricRow[] = eligible
    // Sortiert nach der Leitkennzahl, nicht nach Volumen: Die Frage lautet
    // „welcher Arm konvertiert besser", nicht „welcher ist größer". Durch die
    // Mindestmenge oben kann `apptRate` hier nicht null sein.
    .sort((a, b) => b.appts / b.calls - a.appts / a.calls)
    .map((c) => ({
      key: c.key,
      label: c.label,
      share: totalCalls === 0 ? null : c.calls / totalCalls,
      values: {
        calls: c.calls,
        gkRate: pct(c.gatekeeper, c.calls),
        deciderRate: pct(c.decider, c.calls),
        apptRate: pct(c.appts, c.calls),
      },
    }));

  return (
    <>
      <MetricTable
        label={axisLabel}
        columns={AB_COLUMNS}
        rows={rows}
        minWidth={460}
        emptyHint={emptyHint}
      />
      {/* Bleibt als Fußnote: Der Sektionskopf nennt die Zahl ALLER Arme, die
          Tabelle zeigt nur die über der Mindestmenge. Ohne diese Zeile läse
          sich die Differenz als Fehler. Erscheint nur, wenn sie zutrifft. */}
      {hidden > 0 && (
        <Footnote>
          {INT_FMT.format(hidden)} {hidden === 1 ? "Arm" : "Arme"} unter {MIN_AB_CALLS} Calls{" "}
          {hidden === 1 ? "ist" : "sind"} ausgeblendet.
        </Footnote>
      )}
    </>
  );
}

export async function TelefonTab({
  access,
  from,
  to,
  prevFrom,
  prevTo,
  granularity,
  selectedMembers,
  canCompare,
  allSelected,
}: {
  access: AccessContext;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  granularity: Granularity;
  selectedMembers: Member[];
  canCompare: boolean;
  allSelected: boolean;
}) {
  const supabase = await createClient();
  const eff = canCompare ? null : access.user.id;

  const [res, prevRes, leadsRaw, attemptData] = await Promise.all([
    supabase.rpc("rpc_phone_day_metrics", {
      p_workspace_id: access.workspace_id,
      p_from: from,
      p_to: to,
      p_effective_user_id: eff,
    }),
    supabase.rpc("rpc_phone_day_metrics", {
      p_workspace_id: access.workspace_id,
      p_from: prevFrom,
      p_to: prevTo,
      p_effective_user_id: eff,
    }),
    loadPhoneLeads(supabase, access, canCompare),
    loadCallAttempts(supabase, access, canCompare, from, to),
  ]);

  if (res.error) {
    return <MigrationHint>Telefon-Analyse benötigt die neueste Datenbank-Migration (0013).</MigrationHint>;
  }

  const rows = (res.data ?? []) as PhoneDayRow[];
  const prevRows: PhoneDayRow[] = prevRes.error ? [] : ((prevRes.data ?? []) as PhoneDayRow[]);
  const buckets = buildBuckets(from, to, granularity);

  const nameByKey = new Map<string, string>();
  for (const m of selectedMembers) nameByKey.set(ownerKey(m.username), m.username);
  const nameById = new Map(selectedMembers.map((m) => [m.user_id, m.username]));

  // Personen-Zuordnung wie in rpc_phone_day_metrics: Gruppierung über
  // owner_name, Ersteller nur als Fallback ohne Namen. `null` = gehört keinem
  // ausgewählten Mitglied und fliegt raus.
  const displayNameFor = (ownerName: string | null | undefined, createdBy: string | null): string | null => {
    if (ownerName && ownerName.trim()) return nameByKey.get(ownerKey(ownerName)) ?? (allSelected ? OHNE : null);
    const byId = nameById.get(createdBy ?? "");
    if (byId) return byId;
    return allSelected ? OHNE : null;
  };
  const ownerOf = (l: AnalysePhoneLead): string | null =>
    displayNameFor(l.phone_lists?.owner_name, l.created_by_user_id);

  /** Lead-Kohorte eines Fensters — derselbe Zuschnitt wie in der RPC. */
  const cohort = (windowFrom: string, windowTo: string): AnalysePhoneLead[] =>
    leadsRaw.filter((r) => {
      const day = phoneLeadDay(r);
      if (day < windowFrom || day > windowTo) return false;
      return ownerOf(r) !== null;
    });

  const leads = cohort(from, to);
  const prevLeads = cohort(prevFrom, prevTo);

  // Anwahlen aus dem Ereignis-Log. `owner_name` liegt dort als Snapshot vor —
  // der Lead wandert bei Rückruf/Nicht-erreicht in eine Routing-Liste, ein Join
  // über die aktuelle Liste würde die Historie umschreiben.
  const attempts = attemptData.rows.filter(
    (r) => displayNameFor(r.owner_name, r.created_by_user_id) !== null,
  );
  const attemptKinds = summarizeAttemptsByKind(attempts);
  const attemptTotal = attemptKinds.reduce(
    (acc, k) => ({
      calls: acc.calls + k.calls,
      appointments: acc.appointments + k.appointments,
      mailbox: acc.mailbox + k.mailbox,
    }),
    { calls: 0, appointments: 0, mailbox: 0 },
  );

  // Zeilen nur, wenn überhaupt etwas protokolliert ist: drei Nullzeilen sähen
  // aus wie ein gemessenes Ergebnis, der Leerzustand erklärt dagegen, warum.
  const attemptRows: MetricRow[] =
    attemptTotal.calls === 0
      ? []
      : attemptKinds.map((k) => ({
          key: k.kind,
          label: CALL_KIND_LABELS[k.kind],
          share: k.calls / attemptTotal.calls,
          values: {
            calls: k.calls,
            apptRate: pct(k.appointments, k.calls),
            mailboxRate: pct(k.mailbox, k.calls),
          },
        }));

  // ── Aggregation je Anzeigename (Summen + Buckets) ────────────
  const totals = new Map<string, Totals>();
  const perUser: Record<string, Record<string, { calls: number; gatekeeper: number; decider: number; appts: number }>> = {};
  const ensure = (name: string) => {
    if (!totals.has(name)) totals.set(name, ZERO());
    if (!perUser[name]) perUser[name] = {};
  };
  for (const m of selectedMembers) ensure(m.username);

  const weekday = WEEKDAY_LABELS.map((label) => ({ label, calls: 0, appts: 0 }));
  // Zuwächse je Bucket für den Fortschritts-Chart (kumuliert wird dort).
  const byBucket = {
    calls: {} as Record<string, number>,
    gatekeeper: {} as Record<string, number>,
    decider: {} as Record<string, number>,
    appts: {} as Record<string, number>,
  };

  for (const r of rows) {
    const key = ownerKey(r.owner_name);
    let name = nameByKey.get(key);
    if (!name) {
      if (!allSelected) continue;
      name = OHNE;
    }
    ensure(name);
    const t = totals.get(name)!;
    const calls = NUM(r.calls);
    const gatekeeper = NUM(r.gatekeeper_reached);
    const decider = NUM(r.decider_reached);
    const appts = NUM(r.appointments);
    t.calls += calls;
    t.gatekeeper += gatekeeper;
    t.decider += decider;
    t.appts += appts;
    t.callbacks += NUM(r.callbacks);
    t.dead += NUM(r.dead);
    const bk = bucketOf(r.day, from, to, granularity);
    const b = perUser[name][bk] ?? { calls: 0, gatekeeper: 0, decider: 0, appts: 0 };
    b.calls += calls;
    b.gatekeeper += gatekeeper;
    b.decider += decider;
    b.appts += appts;
    perUser[name][bk] = b;

    byBucket.calls[bk] = (byBucket.calls[bk] ?? 0) + calls;
    byBucket.gatekeeper[bk] = (byBucket.gatekeeper[bk] ?? 0) + gatekeeper;
    byBucket.decider[bk] = (byBucket.decider[bk] ?? 0) + decider;
    byBucket.appts[bk] = (byBucket.appts[bk] ?? 0) + appts;

    const wd = weekday[weekdayIndex(r.day)];
    wd.calls += calls;
    wd.appts += appts;
  }

  // ── Lead-Ebene: was die RPC nicht kennt (Pitch, Mailbox) ─────
  // Beide gehören in dieselbe Totals-Zeile wie die RPC-Werte: Nenner aller
  // daraus gerechneten Quoten sind die Calls DERSELBEN Kohorte.
  for (const l of leads) {
    const name = ownerOf(l);
    if (!name) continue;
    ensure(name);
    const t = totals.get(name)!;
    if (l.pitch_delivered === true) t.pitch += 1;
    if (l.mailbox === true) t.mailbox += 1;
  }

  // ── Personen ohne jede Aktivität ausblenden ──────────────────
  // Nicht jedes Teammitglied telefoniert. Eine Nullzeile liest sich aber wie
  // ein gemessenes Ergebnis („hat nichts geschafft") statt wie „macht diesen
  // Kanal nicht". Eine harte Namensliste wäre beim nächsten Personalwechsel
  // falsch — die Aktivität selbst ist das Kriterium, das mitwächst.
  const hasActivity = (t: Totals): boolean =>
    t.calls > 0 || t.gatekeeper > 0 || t.decider > 0 || t.pitch > 0 ||
    t.appts > 0 || t.callbacks > 0 || t.dead > 0 || t.mailbox > 0;

  const allNames = [...selectedMembers.map((m) => m.username), OHNE];
  const names = allNames.filter((n) => {
    const t = totals.get(n);
    return t !== undefined && hasActivity(t);
  });
  const hiddenMembers = selectedMembers.length - names.filter((n) => n !== OHNE).length;

  const sum = ZERO();
  for (const name of names) {
    const t = totals.get(name)!;
    sum.calls += t.calls;
    sum.gatekeeper += t.gatekeeper;
    sum.decider += t.decider;
    sum.pitch += t.pitch;
    sum.appts += t.appts;
    sum.callbacks += t.callbacks;
    sum.dead += t.dead;
    sum.mailbox += t.mailbox;
  }

  // Serien-Chart nur mit den sichtbaren Personen — eine flache Nulllinie mit
  // Legendeneintrag ist genauso irreführend wie die Nullzeile in der Tabelle.
  const perUserVisible: Record<string, Record<string, { calls: number; decider: number; appts: number }>> = {};
  for (const name of names) perUserVisible[name] = perUser[name] ?? {};

  // ── Vorperiode (gleiche Mitglieder-Eingrenzung) ──────────────
  const prevSum = { calls: 0, gatekeeper: 0, decider: 0, appts: 0, callbacks: 0, pitch: 0, mailbox: 0 };
  for (const r of prevRows) {
    if (!nameByKey.has(ownerKey(r.owner_name)) && !allSelected) continue;
    prevSum.calls += NUM(r.calls);
    prevSum.gatekeeper += NUM(r.gatekeeper_reached);
    prevSum.decider += NUM(r.decider_reached);
    prevSum.appts += NUM(r.appointments);
    prevSum.callbacks += NUM(r.callbacks);
  }
  for (const l of prevLeads) {
    if (l.pitch_delivered === true) prevSum.pitch += 1;
    if (l.mailbox === true) prevSum.mailbox += 1;
  }

  // ── KPI-Reihe: die zehn Kennzahlen des Telefon-Funnels ───────
  // Alle Quoten teilen durch die Calls DESSELBEN Zeitraums, außer den beiden
  // Anschluss-Terminquoten, die zeigen, was aus einer bereits erreichten Stufe
  // noch wird. Zusammen beantworten sie „wo verliere ich?" — eine schlechte
  // Terminquote auf Calls bei guter Terminquote auf Entscheider heißt: das
  // Problem sitzt vor dem Gespräch, nicht darin.
  const mailboxRate = pct(sum.mailbox, sum.calls);
  const gkRate = pct(sum.gatekeeper, sum.calls);
  const deciderRate = pct(sum.decider, sum.calls);
  const pitchRate = pct(sum.pitch, sum.calls);
  const apptRate = pct(sum.appts, sum.calls);
  const apptOnGk = pct(sum.appts, sum.gatekeeper);
  const apptOnDecider = pct(sum.appts, sum.decider);
  const callbackRate = pct(sum.callbacks, sum.calls);

  const prevMailboxRate = pct(prevSum.mailbox, prevSum.calls);
  const prevGkRate = pct(prevSum.gatekeeper, prevSum.calls);
  const prevDeciderRate = pct(prevSum.decider, prevSum.calls);
  const prevPitchRate = pct(prevSum.pitch, prevSum.calls);
  const prevApptRate = pct(prevSum.appts, prevSum.calls);
  const prevApptOnGk = pct(prevSum.appts, prevSum.gatekeeper);
  const prevApptOnDecider = pct(prevSum.appts, prevSum.decider);
  const prevCallbackRate = pct(prevSum.callbacks, prevSum.calls);

  const callsSpark = buckets.map((b) => byBucket.calls[b.key] ?? 0);

  // ── Lead-Ebene: Versuche, Gatekeeper, Stimmung ───────────────
  const attemptCells = [ZERO_LEAD(), ZERO_LEAD(), ZERO_LEAD()];
  let attemptUnknown = 0;
  const gatekeeperCells = new Map<string, LeadCell>();
  const sentiment = { positiv: 0, neutral: 0, negativ: 0, offen: 0 };
  const statusCounts = new Map<string, number>();

  for (const l of leads) {
    const attempt = Number(l.call_attempt);
    if (attempt >= 1 && attempt <= 3) {
      const cell = attemptCells[attempt - 1];
      cell.n += 1;
      if (l.decider_reached === true) cell.decider += 1;
      if (l.appointment_set === true) cell.appts += 1;
      if (l.status === "dead") cell.dead += 1;
    } else {
      attemptUnknown += 1;
    }

    const gk = (l.gatekeeper_reached ?? "").trim() || "ohne";
    let gkCell = gatekeeperCells.get(gk);
    if (!gkCell) {
      gkCell = ZERO_LEAD();
      gatekeeperCells.set(gk, gkCell);
    }
    gkCell.n += 1;
    if (l.decider_reached === true) gkCell.decider += 1;
    if (l.appointment_set === true) gkCell.appts += 1;
    if (l.status === "dead") gkCell.dead += 1;

    if (l.answer_sentiment) sentiment[l.answer_sentiment] += 1;
    else if (l.decider_reached === true) sentiment.offen += 1;

    const s = l.status ?? "";
    statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1);
  }

  const outcomeData = STATUS_META.map((m) => ({
    name: m.label,
    value: statusCounts.get(m.key) ?? 0,
    color: m.color,
  })).filter((d) => d.value > 0);
  const outcomeTotal = outcomeData.reduce((s, d) => s + d.value, 0);

  const gatekeeperRows: MetricRow[] = ["direkt", "ja", "nein", "ohne"]
    .map((key) => ({ key, cell: gatekeeperCells.get(key) }))
    .filter((e): e is { key: string; cell: LeadCell } => Boolean(e.cell && e.cell.n > 0))
    .map(({ key, cell }) => ({
      key,
      label: GATEKEEPER_LABELS[key],
      share: leads.length === 0 ? null : cell.n / leads.length,
      values: {
        n: cell.n,
        deciderRate: pct(cell.decider, cell.n),
        appts: cell.appts,
        apptRate: pct(cell.appts, cell.n),
        deadRate: pct(cell.dead, cell.n),
      },
    }));

  // ── A/B: Skript-Arme und Zielgruppen ─────────────────────────
  // Skript-Achse ist der Wert AM LEAD (Migration 0030), nicht der an der Liste.
  //
  // Warum das der Unterschied zwischen einem tragfähigen und einem
  // schmeichelnden Test ist: Ein Lead wandert bei „Rückruf" und „Nicht
  // erreicht" physisch in die Routing-Liste des Owners (setPhoneLeadOutcome),
  // und die trägt kein Label. Über die Liste gruppiert fielen damit ausgerechnet
  // die schlechten Ausgänge aus ihrem Arm, während Termine und tote Leads in der
  // Akquise-Liste blieben — jeder Arm sähe besser aus als er ist, und weil die
  // Abwanderung je Skript unterschiedlich stark ausfällt, wären die Arme auch
  // untereinander nicht mehr vergleichbar.
  // Der Listenwert bleibt als Rückfall für Bestandsleads, die vor 0030
  // importiert wurden und ihre Liste nie verlassen haben.
  const scriptAb = groupLeads(leads, (l) => l.script_label ?? l.phone_lists?.script_label);
  // Branchen-Achse: der Wert am Lead ist maßgeblich (beim Import gestempelt und
  // damit umzugsfest), die Liste liefert den Default für alles ohne eigenen Wert.
  const groupAb = groupLeads(leads, (l) => l.target_group ?? l.phone_lists?.target_group);

  // ── Gründe ───────────────────────────────────────────────────
  const noTransfer = reasonItems(leads, "no_transfer_reason");
  const noPitch = reasonItems(leads, "no_pitch_reason");
  const noAppointment = reasonItems(leads, "no_appointment_reason");

  // ── Vergleichstabelle ────────────────────────────────────────
  const tableRows: ComparisonRow[] = names.map((name) => {
    const t = totals.get(name)!;
    return {
      name,
      values: {
        calls: t.calls,
        gatekeeper: t.gatekeeper,
        gkRate: pct(t.gatekeeper, t.calls),
        decider: t.decider,
        deciderRate: pct(t.decider, t.calls),
        pitch: t.pitch,
        appts: t.appts,
        apptRate: pct(t.appts, t.calls),
        callbacks: t.callbacks,
        dead: t.dead,
      },
    };
  });

  const average = {
    calls: sum.calls,
    gatekeeper: sum.gatekeeper,
    gkRate,
    decider: sum.decider,
    deciderRate,
    pitch: sum.pitch,
    appts: sum.appts,
    apptRate,
    callbacks: sum.callbacks,
    dead: sum.dead,
  };

  const rangeLabel = `${shortDay(from)} – ${shortDay(to)}`;

  return (
    <>
      {/* ══ 1 · KPI-Hero-Reihe (die zehn Kennzahlen) ══
          Die Überschrift trägt das Info-Icon: Eine Kachelreihe hat keine
          Karte und damit keinen Sektionskopf, an dem eines sitzen könnte. */}
      <BlockHeading
        title="Kennzahlen"
        icon={Phone}
        info={
          <InfoBody>
            <span>
              <B>Calls</B> = Leads mit Erstkontakt im Zeitraum (<code>first_call_at</code>). Die Sektion
              &bdquo;Nachfassen oder neue Leads?&ldquo; zählt dagegen einzelne Anwahlen — denselben Lead also
              mehrfach.
            </span>
            <span>
              Alle Quoten sind <B>Kohorten-Quoten</B>: Nenner sind die Calls des Zeitraums, Zähler der heutige Stand
              genau dieser Leads. Ein Termin, der erst nächste Woche zustande kommt, zählt rückwirkend auf die Woche
              des Erstkontakts.
            </span>
            <span>
              <B>Gatekeeper</B> fasst &bdquo;durchgestellt&ldquo; und &bdquo;direkt zum Entscheider&ldquo; zusammen.{" "}
              <B>Rückruf-Quote</B> ist der Anteil der Leads auf &bdquo;ruf dann und dann nochmal an&ldquo;.{" "}
              <B>Pitch-Quote</B> stammt aus <code>pitch_delivered</code> (Migration 0028) — Bestandszeilen wurden
              aus &bdquo;Entscheider erreicht&ldquo; übernommen, die beiden Quoten spreizen sich deshalb erst mit
              neu erfassten Anrufen.
            </span>
          </InfoBody>
        }
      />
      <KpiRow>
        <KpiHero
          label="Calls"
          value={sum.calls}
          delta={deltaPct(sum.calls, prevSum.calls)}
          spark={callsSpark}
          icon={<Phone size={15} />}
          index={0}
        />
        <KpiHero
          label="Mailbox-Quote"
          value={mailboxRate}
          format="pct"
          delta={deltaPP(mailboxRate, prevMailboxRate)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<Voicemail size={15} />}
          index={1}
        />
        <KpiHero
          label="Gatekeeper-Quote"
          value={gkRate}
          format="pct"
          delta={deltaPP(gkRate, prevGkRate)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<DoorOpen size={15} />}
          index={2}
        />
        <KpiHero
          label="Entscheider-Quote"
          value={deciderRate}
          format="pct"
          delta={deltaPP(deciderRate, prevDeciderRate)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<UserCheck size={15} />}
          index={3}
        />
        <KpiHero
          label="Pitch-Quote"
          value={pitchRate}
          format="pct"
          delta={deltaPP(pitchRate, prevPitchRate)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<MessageSquare size={15} />}
          index={4}
        />
        {/* Die drei Terminquoten tragen bewusst dasselbe Icon: Sie messen alle
            Termine, nur auf verschiedenen Basen — das Label sagt, auf welcher. */}
        <KpiHero
          label="TQ auf Calls"
          value={apptRate}
          format="pct"
          delta={deltaPP(apptRate, prevApptRate)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<CalendarCheck size={15} />}
          index={5}
        />
        <KpiHero
          label="TQ auf Gatekeeper"
          value={apptOnGk}
          format="pct"
          delta={deltaPP(apptOnGk, prevApptOnGk)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<CalendarCheck size={15} />}
          index={6}
        />
        <KpiHero
          label="TQ auf Entscheider"
          value={apptOnDecider}
          format="pct"
          delta={deltaPP(apptOnDecider, prevApptOnDecider)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<CalendarCheck size={15} />}
          index={7}
        />
        <KpiHero
          label="Rückruf-Quote"
          value={callbackRate}
          format="pct"
          delta={deltaPP(callbackRate, prevCallbackRate)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<PhoneForwarded size={15} />}
          index={8}
        />
        <KpiHero
          label="Termine"
          value={sum.appts}
          delta={deltaPct(sum.appts, prevSum.appts)}
          icon={<Calendar size={15} />}
          index={9}
        />
      </KpiRow>

      {/* ══ 2 · Vergleich ══
          Bleibt offen: die zentrale Vergleichstabelle des Tabs. */}
      <Fade i={5}>
        <AnalyseSection
          title="Vergleich"
          icon={Filter}
          meta="Calls · Gatekeeper · Entscheider · Termine"
          collapsible
          info={
            <InfoBody>
              <span>
                Nur &bdquo;Calls&ldquo; ist zeitraumgefiltert (<code>first_call_at</code> im Fenster) — Gatekeeper,
                Entscheider, Pitch, Termine und Dead sind der aktuelle Stand derselben Leads. Die Quoten sind damit
                Kohorten-Quoten, keine Tageswerte.
              </span>
              {hiddenMembers > 0 && (
                <span>
                  {INT_FMT.format(hiddenMembers)} {hiddenMembers === 1 ? "Person" : "Personen"} ohne
                  Telefon-Aktivität im Zeitraum {hiddenMembers === 1 ? "ist" : "sind"} ausgeblendet.
                </span>
              )}
            </InfoBody>
          }
        >
          {tableRows.length === 0 ? (
            <TableEmpty
              text="In diesem Zeitraum hat niemand aus der Auswahl telefoniert."
              hint="Wähle einen größeren Zeitraum oder mehr Personen."
            />
          ) : (
            <ComparisonTable
              columns={[
                { key: "calls", label: "Calls", format: "int" },
                { key: "gatekeeper", label: "Gatekeeper", format: "int" },
                { key: "gkRate", label: "GK-Quote", format: "pct", deltaVsAvg: true },
                { key: "decider", label: "Entscheider", format: "int" },
                { key: "deciderRate", label: "Entscheider-Quote", format: "pct", deltaVsAvg: true },
                { key: "pitch", label: "Pitch", format: "int" },
                { key: "appts", label: "Termine", format: "int" },
                { key: "apptRate", label: "Terminquote", format: "pct", deltaVsAvg: true },
                { key: "callbacks", label: "Rückrufe", format: "int" },
                { key: "dead", label: "Dead", format: "int" },
              ]}
              rows={tableRows}
              average={average}
              averageLabel="Gesamt"
            />
          )}
        </AnalyseSection>
      </Fade>

      {/* ══ 3 · Verlauf + Outcome-Verteilung ══
          Beide starten zu und teilen sich denselben Startzustand: In einem
          zweispaltigen Raster stünde eine zugeklappte Karte neben einer
          offenen sonst als hohe, leere Fläche da. `alignItems: start` hält das
          auch nach dem Aufklappen einer der beiden Karten so — ohne die
          Vorgabe würde die zugeklappte auf die Höhe der offenen gestreckt.
          Beide zeigen die Form der Zahlen, nicht die Zahlen selbst. */}
      <div className="analyse-row" style={{ alignItems: "start" }}>
        <Fade i={6}>
          <AnalyseSection title="Verlauf" icon={TrendingUp} meta={`${from} – ${to}`} collapsible defaultOpen={false}>
            <PhoneSeriesChart buckets={buckets} perUser={perUserVisible} />
          </AnalyseSection>
        </Fade>
        <Fade i={7}>
          <AnalyseSection
            title="Outcome-Verteilung"
            icon={PieChart}
            meta={`${INT_FMT.format(outcomeTotal)} Leads`}
            collapsible
            defaultOpen={false}
          >
            <DonutChart data={outcomeData} centerLabel={INT_FMT.format(outcomeTotal)} centerSub="Leads" />
          </AnalyseSection>
        </Fade>
      </div>

      {/* ══ 4 · Fortschritt (kumuliert) ══
          Der Verlauf darüber zeigt Tageszacken je Person; hier steigt eine
          Kurve über den Zeitraum. Ein Einbruch liest sich als Abflachung viel
          schneller als in einer zappelnden Tagesreihe.
          Startet zu: Die Endstände aller vier Serien stehen in der
          Kachelreihe ganz oben. */}
      <Fade i={8}>
        <AnalyseSection title="Fortschritt" icon={Target} meta="kumuliert" collapsible defaultOpen={false}>
          <CumulativeProgressChart
            buckets={buckets}
            series={[
              { key: "calls", label: "Calls", kind: "count", values: byBucket.calls, defaultOn: true },
              { key: "gatekeeper", label: "Gatekeeper", kind: "count", values: byBucket.gatekeeper },
              { key: "decider", label: "Entscheider", kind: "count", values: byBucket.decider },
              { key: "appts", label: "Termine", kind: "count", values: byBucket.appts, defaultOn: true },
            ]}
            rangeLabel={rangeLabel}
            note="Jeder Lead zählt am Tag seines Erstkontakts — Gatekeeper, Entscheider und Termine also dort, nicht am Tag des Ereignisses."
          />
        </AnalyseSection>
      </Fade>

      {/* ══ 5 · A/B-Test: Skript-Arme und Zielgruppen ══
          Zwei Achsen desselben Tests: WAS gesagt wurde und WEM. Beide brauchen
          gepflegte Labels — ohne sie bleiben die Tabellen leer, und genau das
          sagt der Leerzustand.
          Beide starten zu (gleicher Startzustand wegen des zweispaltigen
          Rasters, s. o.): Ein A/B-Vergleich ist eine gezielte Frage, keine
          Tageszahl. */}
      <div className="analyse-row" style={{ alignItems: "start" }}>
        <Fade i={9}>
          <AnalyseSection
            title="Welches Skript konvertiert?"
            icon={FileText}
            meta={scriptAb.cells.length === 1 ? "1 Arm" : `${INT_FMT.format(scriptAb.cells.length)} Arme`}
            collapsible
            defaultOpen={false}
            info={abInfo({
              unlabeled: scriptAb.unlabeled,
              axisHint:
                "das Skript-Label steht an der Telefonliste. Leads, die als „Rückruf“ oder „Nicht erreicht“ in eine Routing-Liste gewandert sind, tragen keines mehr; der Vergleich fällt dadurch etwas freundlicher aus als die Realität.",
            })}
          >
            <AbTable
              cells={scriptAb.cells}
              axisLabel="Skript-Arm"
              emptyHint="Noch kein Skript-Arm mit genug Calls. Trag das Skript-Label an der Telefonliste ein — dasselbe Label in mehreren Listen ergibt einen Testarm."
            />
          </AnalyseSection>
        </Fade>
        <Fade i={10}>
          <AnalyseSection
            title="Welche Branche konvertiert?"
            icon={Users}
            meta={groupAb.cells.length === 1 ? "1 Zielgruppe" : `${INT_FMT.format(groupAb.cells.length)} Zielgruppen`}
            collapsible
            defaultOpen={false}
            info={abInfo({
              unlabeled: groupAb.unlabeled,
              axisHint: "die Branche wird beim CSV-Import gesetzt.",
            })}
          >
            <AbTable
              cells={groupAb.cells}
              axisLabel="Branche"
              emptyHint="Noch keine Branche mit genug Calls. Beim CSV-Import lässt sich die Branche für die ganze Datei setzen; bestehende Listen bekommen sie auf der Listen-Seite unter „Skript und A/B-Test“."
            />
          </AnalyseSection>
        </Fade>
      </div>

      {/* ══ 6 · Anwahlen aus dem Ereignis-Log ══
          Die Sektion, die „nochmal anrufen oder neue Leads scrapen?"
          beantwortet: Terminquote des Erstanrufs gegen die der Folge- und
          Rückrufe. Anders als alles darunter zählt sie ANRUFE, nicht Leads. */}
      <Fade i={11}>
        <AnalyseSection
          title="Nachfassen oder neue Leads?"
          icon={PhoneCall}
          meta={`${INT_FMT.format(attemptTotal.calls)} Anwahlen`}
          collapsible
          defaultOpen={false}
          info={
            <span>
              Eine <B>Anwahl</B> ist ein Ergebnis-Klick im Call-Modus, kein Lead — dreimal derselbe Lead sind hier
              drei Zeilen. Für die Zeit vor dem Log bleibt die lead-basierte Auswertung &bdquo;Wie oft musst du
              anrufen?&ldquo; darunter der einzige Blick.
            </span>
          }
        >
          <MetricTable
            label="Anruf-Typ"
            columns={[
              { key: "calls", label: "Anwahlen", format: "int" },
              { key: "apptRate", label: "Terminquote", format: "pct", emphasis: true },
              { key: "mailboxRate", label: "Mailbox-Anteil", format: "pct" },
            ]}
            rows={attemptRows}
            total={
              attemptTotal.calls === 0
                ? undefined
                : {
                    calls: attemptTotal.calls,
                    apptRate: pct(attemptTotal.appointments, attemptTotal.calls),
                    mailboxRate: pct(attemptTotal.mailbox, attemptTotal.calls),
                  }
            }
            minWidth={480}
            emptyHint={
              attemptData.available
                ? "In diesem Zeitraum wurde keine Anwahl protokolliert."
                : "Das Anruf-Log steht noch nicht bereit — Migration 0028 im SQL-Editor ausführen."
            }
          />
          {/* Bleibt als Fußnote: Sie qualifiziert die Zahlen selbst. Das Log
              (Migration 0028) startet ohne Backfill — eine leere Tabelle für
              einen älteren Zeitraum ist ein Datenloch, kein Ergebnis. Hinter
              einem Icon versteckt hielte man die 0 für gemessen. */}
          <Footnote>
            Das Anruf-Log (<code>phone_call_attempts</code>) startet ohne Backfill:{" "}
            {attemptData.firstCalledAt
              ? `erste protokollierte Anwahl am ${DAY_FMT.format(new Date(attemptData.firstCalledAt))}.`
              : "bisher wurde keine Anwahl protokolliert."}{" "}
            Zeiträume davor sind deshalb leer — nicht ausgefallen.
          </Footnote>
        </AnalyseSection>
      </Fade>

      {/* ══ 7 · Anruf-Versuche (Lead-Ebene, Zeit vor dem Log) ══ */}
      <Fade i={12}>
        <AnalyseSection
          title="Wie oft musst du anrufen?"
          icon={Repeat}
          meta={attemptUnknown > 0 ? `${INT_FMT.format(attemptUnknown)} ohne Versuchszähler` : "Leads nach erreichtem Versuch"}
          collapsible
          defaultOpen={false}
          info={
            <span>
              <code>call_attempt</code> ist der zuletzt gezählte Versuch eines Leads, nicht ein Ereignis-Log. Die
              Spalte &bdquo;3. Versuch&ldquo; enthält also Leads, bei denen dreimal angerufen wurde — bricht die
              Terminquote dort ein, lohnt der dritte Anruf nicht mehr.
            </span>
          }
        >
          <QuoteColumns
            perDay={[1, 2, 3].map((n, i) => ({
              label: `${n}. Versuch`,
              n: attemptCells[i].n,
              quote: pct(attemptCells[i].appts, attemptCells[i].n),
            }))}
            quoteLabel="Terminquote"
          />
        </AnalyseSection>
      </Fade>

      {/* ══ 8 · Gatekeeper + Stimmung ══
          Beide starten zu (gleicher Startzustand wegen des zweispaltigen
          Rasters, s. o.): Verteilungen über den bereits laufenden Funnel. */}
      <div className="analyse-row" data-split="wide-left" style={{ alignItems: "start" }}>
        <Fade i={13}>
          <AnalyseSection
            title="Der Weg zum Entscheider"
            icon={DoorOpen}
            meta={`${INT_FMT.format(leads.length)} Leads`}
            collapsible
            defaultOpen={false}
          >
            <MetricTable
              label="Gatekeeper"
              columns={[
                { key: "n", label: "Leads", format: "int" },
                { key: "deciderRate", label: "Entscheider", format: "pct", emphasis: true },
                { key: "appts", label: "Termine", format: "int" },
                { key: "apptRate", label: "Terminquote", format: "pct" },
                { key: "deadRate", label: "Dead", format: "pct" },
              ]}
              rows={gatekeeperRows}
              minWidth={520}
              emptyHint="Keine Gatekeeper-Angaben im Zeitraum."
            />
          </AnalyseSection>
        </Fade>
        <Fade i={14}>
          <AnalyseSection
            title="Stimmung im Gespräch"
            icon={Smile}
            meta="answer_sentiment"
            collapsible
            defaultOpen={false}
            info={
              <span>
                Gezählt werden Leads mit erreichtem Entscheider — nur dort gibt es überhaupt ein Gespräch zu
                bewerten.
              </span>
            }
          >
            <ShareBar
              segments={[
                ...SENTIMENT_META.map((m) => ({ label: m.label, value: sentiment[m.key], color: m.color })),
                { label: "Ohne Angabe", value: sentiment.offen, color: VIZ_NEUTRAL },
              ]}
              height={14}
            />
          </AnalyseSection>
        </Fade>
      </div>

      {/* ══ 9 · Gründe ══
          Drei Freitext-Verteilungen, alle zu: reine Ursachenforschung, und in
          drei Spalten nebeneinander sonst der längste Block der Seite. */}
      <div className="analyse-row" data-split="auto" style={{ alignItems: "start" }}>
        <Fade i={15}>
          <AnalyseSection title="Warum nicht durchgestellt?" icon={PhoneOff} collapsible defaultOpen={false}>
            <DistBars items={noTransfer} max={8} />
          </AnalyseSection>
        </Fade>
        <Fade i={16}>
          <AnalyseSection title="Warum kein Pitch?" icon={XCircle} collapsible defaultOpen={false}>
            <DistBars items={noPitch} max={8} />
          </AnalyseSection>
        </Fade>
        <Fade i={17}>
          <AnalyseSection title="Warum kein Termin?" icon={CalendarX} collapsible defaultOpen={false}>
            <DistBars items={noAppointment} max={8} />
          </AnalyseSection>
        </Fade>
      </div>

      {/* ══ 10 · Wochentag-Analyse ══
          Startet zu: Nebenauswertung („wann anrufen?"), kein Tageswert. */}
      <Fade i={18}>
        <AnalyseSection
          title="Wochentag-Analyse"
          icon={CalendarDays}
          meta="Calls je Wochentag"
          collapsible
          defaultOpen={false}
        >
          <WeekdayBars
            perDay={weekday.map((d) => ({ label: d.label, n: d.calls, quote: pct(d.appts, d.calls) }))}
            quoteLabel="Terminquote"
          />
        </AnalyseSection>
      </Fade>

      {/* ══ 11 · Funnel ══
          Startet zu: Dieselben fünf Stufen stehen als Kacheln und als Spalten
          der Vergleichstabelle oben — hier nur zusätzlich als Form je Person. */}
      <Fade i={19}>
        <AnalyseSection title="Funnel" icon={Phone} collapsible defaultOpen={false}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <FunnelStrip
              label="Gesamt"
              highlight
              stages={[
                { label: "Calls", value: sum.calls },
                { label: "Gatekeeper", value: sum.gatekeeper },
                { label: "Entscheider", value: sum.decider },
                { label: "Pitch", value: sum.pitch },
                { label: "Termine", value: sum.appts },
              ]}
            />
            {names.map((name) => {
              const t = totals.get(name)!;
              return (
                <FunnelStrip
                  key={name}
                  label={name}
                  stages={[
                    { label: "Calls", value: t.calls },
                    { label: "Gatekeeper", value: t.gatekeeper },
                    { label: "Entscheider", value: t.decider },
                    { label: "Pitch", value: t.pitch },
                    { label: "Termine", value: t.appts },
                  ]}
                />
              );
            })}
          </div>
        </AnalyseSection>
      </Fade>
    </>
  );
}
