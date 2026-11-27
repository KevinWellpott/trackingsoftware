import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Calendar, CalendarCheck, CalendarClock, FileText, Filter,
  Inbox, Phone, PhoneCall, PhoneForwarded, Repeat,
  Target, UserCheck, Users,
} from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { rpcAll } from "@/lib/supabase/fetchAll";
import { loadPhoneLeads, phoneLeadDay, type AnalysePhoneLead } from "@/lib/analyseData";
import {
  CALL_KIND_LABELS,
  loadCallAttempts,
  summarizeAttemptsByKind,
} from "@/lib/phoneAttemptsData";
import { NUM, buildBuckets, bucketOf, ownerKey, pct, type Granularity } from "@/lib/analyse";
import { berlinDateISO } from "@/lib/apptTime";
import { InfoPopover } from "@/components/ui/InfoPopover";
import { AnalyseSection, MigrationHint } from "@/components/analyse/AnalyseSection";
import { ComparisonTable, type ComparisonRow } from "@/components/analyse/ComparisonTable";
import { CumulativeProgressChart } from "@/components/analyse/CumulativeProgressChart";
import { FunnelStrip } from "@/components/analyse/FunnelStrip";
import {
  Footnote, MetricTable, type MetricColumn, type MetricRow,
} from "@/components/analyse/AnalyseTables";
import { KpiHero, QuoteColumns } from "@/components/analyse/AnalyseViz";

// Telefon-Flow: Anwahlen → Erstkontakte → Entscheider → Termine.
// Gatekeeper, Pitch, Mailbox und die Abbruch-Gründe stehen hier nicht mehr:
// Seit dem Call-Modus-Umbau (22.09.) werden sie nicht oder kaum erfasst, ihre
// Quoten lasen sich wie Ergebnisse (bis 710 %), Entscheidungen E2/N4 vom
// 26.11. Der Entscheider wird seither aus dem Ergebnis abgeleitet (N5). Quellen: rpc_phone_day_metrics (benötigt Migration 0013), das
// Anruf-Log aus Migration 0028 und die Lead-Ebene, plus Vorperioden-Deltas.
//
// Drei Zählebenen, die nicht verwechselt werden dürfen — und die deshalb je
// ein eigenes Wort haben, das nirgends sonst im Tab vorkommt:
//   Ereignis-Ebene "ANWAHLEN"      — einzelne Wählversuche aus
//                  phone_call_attempts. Die einzige Ebene, auf der derselbe
//                  Lead dreimal zählt, und damit die einzige, die „nachfassen
//                  oder neu scrapen?" beantworten kann. Startet bei null,
//                  siehe Leitkachel und Fußnote dort.
//   RPC-Ebene      "ERSTKONTAKTE"  — Firmen mit erstem Anruf im Zeitraum
//                  (first_call_at). Wer 40-mal wählt und dabei 12 neue Firmen
//                  erreicht, hat 40 Anwahlen und 12 Erstkontakte. Bis zum
//                  Umbau hieß diese Stufe „Calls" — ein Wort, das jeder als
//                  Wählversuch las, während es Firmen zählte.
//   Lead-Ebene     Zustand eines Leads heute (call_attempt, Gatekeeper …).
//                  Heißt in der UI „Leads" bzw. „Versuch".
//
// RPC- und Lead-Ebene beschreiben dieselbe KOHORTE: Beide schneiden auf
// `coalesce(first_call_at, created_at::date) between from and to` zu (SQL:
// rpc_phone_day_metrics, JS: phoneLeadDay). Die Lead-Ebene zählt dabei nur
// ANGERUFENE Leads (`first_call_at` gesetzt) — nie angerufene Importzeilen
// standen sonst zu Tausenden unter „Ohne Angabe" (Live-Test 26.11., P2-1).

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
 * Kennzahlen einer Person im Zeitraum, alle aus der RPC.
 *
 * `calls` heißt so, weil die RPC-Spalte so heißt; in der UI ist das
 * durchgehend „Erstkontakte" (Firmen mit erstem Anruf), NIE „Anwahlen".
 */
type Totals = {
  calls: number;
  decider: number;
  appts: number;
  callbacks: number;
  dead: number;
};

const ZERO = (): Totals => ({ calls: 0, decider: 0, appts: 0, callbacks: 0, dead: 0 });

/**
 * Untergrenze für den Nenner einer angezeigten Quote (Live-Test 26.11., N13).
 * Darunter oder bei Zähler > Nenner steht „—": 3 von 5 sind keine 60 %, und
 * eine Quote über 100 % ist immer ein Erfassungsfehler, nie ein Ergebnis.
 */
const MIN_QUOTE_BASE = 20;

function quote(num: number, den: number): number | null {
  if (den < MIN_QUOTE_BASE || num > den) return null;
  return pct(num, den);
}
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

/** Kalendertag eines UTC-Zeitstempels als "09.08.2026" — für die Log-Hinweise. */
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

/**
 * Ein beschrifteter Kachelblock.
 *
 * Warum überhaupt Blöcke: Elf Kennzahlen in einem durchlaufenden Raster liest
 * niemand mehr — man SUCHT darin. Drei benannte Gruppen (Volumen ·
 * Durchkommen · Terminquoten) machen aus der Suche ein Nachschlagen, und jeder
 * Block trägt seinen eigenen Erklärtext statt eines Sammel-Popovers.
 *
 * Warum `cols` explizit statt `KpiRow`: Dort wird die Spaltenzahl aus der
 * Kachelzahl geraten und für drei Kacheln auf vier gesetzt — die vierte Zelle
 * bliebe leer. Hier ist die Blockgröße bekannt. Klasse und Umbruchregeln
 * (`.kpi-row`, globals.css §6.12b) bleiben unverändert dieselben.
 */
function KpiBlock({
  title,
  icon,
  info,
  cols,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  info?: ReactNode;
  cols: 3 | 4;
  children: ReactNode;
}) {
  return (
    <>
      <BlockHeading title={title} icon={icon} info={info} />
      <div className="kpi-row" data-cols={cols}>
        {children}
      </div>
    </>
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

type AbCell = { key: string; label: string; calls: number; decider: number; appts: number };

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
      cell = { key, label, calls: 0, decider: 0, appts: 0 };
      map.set(key, cell);
    }
    // `calls` wie in der RPC: nur Leads mit echtem Erstkontakt. Nie angerufene
    // Leads blähen sonst den Nenner auf und drücken jede Quote des Arms.
    if (l.first_call_at) cell.calls += 1;
    if (l.decider_reached === true) cell.decider += 1;
    if (l.appointment_set === true) cell.appts += 1;
  }
  return { cells: [...map.values()], unlabeled };
}

const AB_COLUMNS: MetricColumn[] = [
  { key: "calls", label: "Erstkontakte", format: "int" },
  { key: "deciderRate", label: "Entscheider-Quote", format: "pct" },
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
        Verglichen werden nur Arme mit mindestens {MIN_AB_CALLS} Erstkontakten — sonst gewinnt jede Liste mit drei
        Leads und einem Zufallstermin.
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
        minWidth={520}
        emptyHint={emptyHint}
      />
      {/* Bleibt als Fußnote: Der Sektionskopf nennt die Zahl ALLER Arme, die
          Tabelle zeigt nur die über der Mindestmenge. Ohne diese Zeile läse
          sich die Differenz als Fehler. Erscheint nur, wenn sie zutrifft. */}
      {hidden > 0 && (
        <Footnote>
          {INT_FMT.format(hidden)} {hidden === 1 ? "Arm" : "Arme"} unter {MIN_AB_CALLS} Erstkontakten{" "}
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
    rpcAll(supabase, "rpc_phone_day_metrics", {
      p_workspace_id: access.workspace_id,
      p_from: from,
      p_to: to,
      p_effective_user_id: eff,
    }),
    rpcAll(supabase, "rpc_phone_day_metrics", {
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
      if (!r.first_call_at) return false;
      const day = phoneLeadDay(r);
      if (day < windowFrom || day > windowTo) return false;
      return ownerOf(r) !== null;
    });

  const leads = cohort(from, to);

  // ── Ereignis-Ebene: Anwahlen aus dem Anruf-Log ───────────────
  // `owner_name` liegt dort als Snapshot vor — der Lead wandert bei
  // Rückruf/Nicht-erreicht in eine Routing-Liste, ein Join über die aktuelle
  // Liste würde die Historie umschreiben.
  const attempts = attemptData.rows.filter(
    (r) => displayNameFor(r.owner_name, r.created_by_user_id) !== null,
  );
  const attemptKinds = summarizeAttemptsByKind(attempts);
  const attemptTotal = attemptKinds.reduce(
    (acc, k) => ({
      calls: acc.calls + k.calls,
      appointments: acc.appointments + k.appointments,
    }),
    { calls: 0, appointments: 0 },
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
          },
        }));

  // Anwahlen je Bucket — die Sparkline der Leitkachel. Berlin-Kalendertag wie
  // überall sonst im Tab (docs §6), sonst rutschen Abendanrufe in den
  // Nachbar-Bucket.
  const attemptByBucket: Record<string, number> = {};
  for (const a of attempts) {
    const bk = bucketOf(berlinDateISO(a.called_at), from, to, granularity);
    attemptByBucket[bk] = (attemptByBucket[bk] ?? 0) + 1;
  }
  const attemptSpark = buckets.map((b) => attemptByBucket[b.key] ?? 0);

  // ── Ehrlichkeit der Leitkachel ───────────────────────────────
  // Das Anruf-Log (Migration 0028) startet ohne Backfill. Für ein Fenster, das
  // komplett davor liegt, ist es LEGITIM leer — eine „0" auf der größten Zahl
  // der Seite läse sich dagegen als „es wurde nicht telefoniert" und würde
  // ausgerechnet die Leitzahl zur Falschaussage machen. Deshalb dort `null`
  // (die Kachel zeigt „—") plus eine Zeile, die den Grund nennt. Die Fußnote
  // in „Nachfassen oder neue Leads?" bleibt zusätzlich bestehen: Sie
  // qualifiziert die aufgeschlüsselten Zahlen, diese Zeile die Leitzahl.
  const logStartDay = attemptData.firstCalledAt ? berlinDateISO(attemptData.firstCalledAt) : null;
  const logStartLabel = attemptData.firstCalledAt
    ? DAY_FMT.format(new Date(attemptData.firstCalledAt))
    : null;
  const logCovers = attemptData.available && logStartDay !== null && logStartDay <= to;
  const attemptValue = logCovers ? attemptTotal.calls : null;
  const attemptNote = !attemptData.available
    ? "Anruf-Log noch nicht eingerichtet"
    : logStartDay === null
      ? "bisher keine Anwahl protokolliert"
      : !logCovers
        ? `Anruf-Log startet erst am ${logStartLabel}`
        : logStartDay > from
          ? `protokolliert erst ab ${logStartLabel}`
          : "Ereignisse aus dem Anruf-Log";

  // ── Aggregation je Anzeigename (Summen + Buckets) ────────────
  const totals = new Map<string, Totals>();
  const ensure = (name: string) => {
    if (!totals.has(name)) totals.set(name, ZERO());
  };
  for (const m of selectedMembers) ensure(m.username);

  // Zuwächse je Bucket für den Fortschritts-Chart (kumuliert wird dort).
  const byBucket = {
    calls: {} as Record<string, number>,
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
    const decider = NUM(r.decider_reached);
    const appts = NUM(r.appointments);
    t.calls += calls;
    t.decider += decider;
    t.appts += appts;
    t.callbacks += NUM(r.callbacks);
    t.dead += NUM(r.dead);

    const bk = bucketOf(r.day, from, to, granularity);
    byBucket.calls[bk] = (byBucket.calls[bk] ?? 0) + calls;
    byBucket.decider[bk] = (byBucket.decider[bk] ?? 0) + decider;
    byBucket.appts[bk] = (byBucket.appts[bk] ?? 0) + appts;
  }

  // ── Personen ohne jede Aktivität ausblenden ──────────────────
  // Nicht jedes Teammitglied telefoniert. Eine Nullzeile liest sich aber wie
  // ein gemessenes Ergebnis („hat nichts geschafft") statt wie „macht diesen
  // Kanal nicht". Eine harte Namensliste wäre beim nächsten Personalwechsel
  // falsch — die Aktivität selbst ist das Kriterium, das mitwächst.
  const hasActivity = (t: Totals): boolean =>
    t.calls > 0 || t.decider > 0 || t.appts > 0 || t.callbacks > 0 || t.dead > 0;

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
    sum.decider += t.decider;
    sum.appts += t.appts;
    sum.callbacks += t.callbacks;
    sum.dead += t.dead;
  }

  // ── Vorperiode (gleiche Mitglieder-Eingrenzung) ──────────────
  const prevSum = { calls: 0, decider: 0, appts: 0, callbacks: 0 };
  for (const r of prevRows) {
    if (!nameByKey.has(ownerKey(r.owner_name)) && !allSelected) continue;
    prevSum.calls += NUM(r.calls);
    prevSum.decider += NUM(r.decider_reached);
    prevSum.appts += NUM(r.appointments);
    prevSum.callbacks += NUM(r.callbacks);
  }

  // ── KPI-Reihe ─────────────────────────────────────────────
  // Alle Quoten teilen durch die Erstkontakte DESSELBEN Zeitraums, außer der
  // Terminquote ab Entscheider, die zeigt, was aus einem Gespräch wird. Eine
  // schlechte Terminquote bei guter Terminquote ab Entscheider heißt: das
  // Problem sitzt vor dem Gespräch, nicht darin.
  const deciderRate = quote(sum.decider, sum.calls);
  const apptRate = quote(sum.appts, sum.calls);
  const apptOnDecider = quote(sum.appts, sum.decider);
  const callbackRate = quote(sum.callbacks, sum.calls);

  const prevDeciderRate = quote(prevSum.decider, prevSum.calls);
  const prevApptRate = quote(prevSum.appts, prevSum.calls);
  const prevApptOnDecider = quote(prevSum.appts, prevSum.decider);
  const prevCallbackRate = quote(prevSum.callbacks, prevSum.calls);

  const callsSpark = buckets.map((b) => byBucket.calls[b.key] ?? 0);

  // ── Lead-Ebene: Versuche ────────────────────────────────────
  const attemptCells = [ZERO_LEAD(), ZERO_LEAD(), ZERO_LEAD()];
  let attemptUnknown = 0;

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
  }

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

  // ── Vergleichstabelle ────────────────────────────────────────
  const tableRows: ComparisonRow[] = names.map((name) => {
    const t = totals.get(name)!;
    return {
      name,
      values: {
        calls: t.calls,
        decider: t.decider,
        deciderRate: quote(t.decider, t.calls),
        appts: t.appts,
        apptRate: quote(t.appts, t.calls),
        callbacks: t.callbacks,
        dead: t.dead,
      },
    };
  });

  const average = {
    calls: sum.calls,
    decider: sum.decider,
    deciderRate,
    appts: sum.appts,
    apptRate,
    callbacks: sum.callbacks,
    dead: sum.dead,
  };

  const rangeLabel = `${shortDay(from)} – ${shortDay(to)}`;

  return (
    <>
      {/* ══ 1 · Kennzahlen in drei Blöcken ══
          Volumen (was ist passiert) · Durchkommen (wie weit kam ich) ·
          Terminquoten (was wurde daraus). Jede Blocküberschrift trägt ihr
          eigenes Info-Icon: Eine Kachelreihe hat keine Karte und damit keinen
          Sektionskopf, an dem eines sitzen könnte. */}
      <KpiBlock
        title="Volumen"
        icon={Phone}
        cols={3}
        info={
          <InfoBody>
            <span>
              <B>Anwahlen</B> sind einzelne Wählversuche aus dem Anruf-Log (<code>phone_call_attempts</code>) —
              derselbe Lead zählt dort mehrfach. <B>Erstkontakte</B> sind Firmen mit erstem Anruf im Zeitraum
              (<code>first_call_at</code>). Wer 40-mal wählt und dabei 12 neue Firmen erreicht, hat 40 Anwahlen und
              12 Erstkontakte.
            </span>
            <span>
              Das Anruf-Log startet ohne Backfill. Für Zeiträume davor steht auf der Anwahl-Kachel bewusst
              &bdquo;—&ldquo; statt einer 0: leer heißt hier &bdquo;gab es damals noch nicht&ldquo;, nicht
              &bdquo;niemand hat telefoniert&ldquo;.
            </span>
            <span>
              <B>Termine aus Erstkontakten</B> sind gebuchte Termine derselben Erstkontakt-Kohorte — auch wenn der
              Termin erst später zustande kam. Die Zahl unterscheidet sich deshalb von &bdquo;Termine gelegt&ldquo; (Stichtag
              Buchung) und von den Terminen, die im Zeitraum stattfinden (Übersicht).
            </span>
          </InfoBody>
        }
      >
        {/* Leitzahl des Tabs (einzige Kachel mit `lead`): Anwahlen sind das,
            was man morgens steuert — Erstkontakte und Termine sind, was dabei
            herauskommt. Genau diese Zahl war bis zum Umbau Meta-Text auf einer
            zugeklappten Karte weit unten.
            `delta` bewusst null: Für die Vorperiode werden keine Anwahlen
            geladen, und ein Vergleich über den Log-Start hinweg wäre ein
            Einbruch, den es nie gab. Die Zeile daneben sagt stattdessen, worauf
            die Zahl beruht. */}
        <KpiHero
          label="Anwahlen"
          value={attemptValue}
          lead
          delta={null}
          deltaLabel={attemptNote}
          spark={attemptValue === null ? undefined : attemptSpark}
          icon={<PhoneCall size={15} />}
          index={0}
        />
        <KpiHero
          label="Erstkontakte"
          value={sum.calls}
          delta={deltaPct(sum.calls, prevSum.calls)}
          spark={callsSpark}
          icon={<Phone size={15} />}
          index={1}
        />
        <KpiHero
          label="Termine aus Erstkontakten"
          value={sum.appts}
          delta={deltaPct(sum.appts, prevSum.appts)}
          icon={<Calendar size={15} />}
          index={2}
        />
      </KpiBlock>

      <KpiBlock
        title="Quoten"
        icon={CalendarCheck}
        cols={4}
        info={
          <InfoBody>
            <span>
              Alle Quoten sind <B>Kohorten-Quoten</B>: Nenner sind die Erstkontakte des Zeitraums, Zähler der heutige
              Stand genau dieser Leads. Ein Termin, der erst nächste Woche zustande kommt, zählt rückwirkend auf die
              Woche des Erstkontakts.
            </span>
            <span>
              <B>Entscheider</B> heißt: Der Entscheider war am Apparat. Ein Termin oder ein &bdquo;Kein Termin&ldquo; setzt das
              voraus und zählt deshalb immer mit, auch wenn der Schalter im Call-Modus nicht gesetzt wurde.
            </span>
            <span>
              Eine schwache Terminquote bei starker Terminquote ab Entscheider heißt: Das Problem sitzt <B>vor</B> dem
              Gespräch, nicht darin. Unter {MIN_QUOTE_BASE} im Nenner oder bei einem Zähler über dem Nenner steht
              &bdquo;—&ldquo;.
            </span>
          </InfoBody>
        }
      >
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
          label="Terminquote"
          value={apptRate}
          format="pct"
          delta={deltaPP(apptRate, prevApptRate)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<CalendarCheck size={15} />}
          index={4}
        />
        <KpiHero
          label="Terminquote ab Entscheider"
          value={apptOnDecider}
          format="pct"
          delta={deltaPP(apptOnDecider, prevApptOnDecider)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<CalendarClock size={15} />}
          index={5}
        />
        <KpiHero
          label="Rückruf-Quote"
          value={callbackRate}
          format="pct"
          delta={deltaPP(callbackRate, prevCallbackRate)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<PhoneForwarded size={15} />}
          index={6}
        />
      </KpiBlock>

      {/* ══ 2 · Vergleich ══
          Bleibt offen: die zentrale Vergleichstabelle des Tabs. */}
      <Fade i={5}>
        <AnalyseSection
          title="Vergleich"
          icon={Filter}
          meta="Erstkontakte · Entscheider · Termine"
          collapsible
          info={
            <InfoBody>
              <span>
                Nur &bdquo;Erstkontakte&ldquo; ist zeitraumgefiltert (<code>first_call_at</code> im Fenster) —
                Entscheider, Termine, Rückrufe und Dead sind der aktuelle Stand derselben Leads. Die Quoten sind damit
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
                { key: "calls", label: "Erstkontakte", format: "int" },
                { key: "decider", label: "Entscheider", format: "int" },
                { key: "deciderRate", label: "Entscheider-Quote", format: "pct", deltaVsAvg: true },
                { key: "appts", label: "Termine aus Erstkontakten", format: "int" },
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

      {/* ══ 3 · Anwahlen aus dem Ereignis-Log ══
          Steht jetzt direkt unter dem Vergleich statt als achte von zwölf
          zugeklappten Karten: Sie beantwortet die Frage mit der höchsten
          Entscheidungsrelevanz („nochmal anrufen oder neue Leads scrapen?")
          und schlüsselt genau die Leitkachel auf.
          Bleibt trotzdem zu: Die Leitzahl selbst steht oben auf der Glaskachel
          samt Log-Hinweis — hier liegt die Aufschlüsselung, und die ist eine
          Wochen-, keine Tagesfrage. */}
      <Fade i={6}>
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
              anrufen?&ldquo; weiter unten der einzige Blick.
            </span>
          }
        >
          <MetricTable
            label="Anruf-Typ"
            columns={[
              { key: "calls", label: "Anwahlen", format: "int" },
              { key: "apptRate", label: "Terminquote", format: "pct", emphasis: true },
            ]}
            rows={attemptRows}
            total={
              attemptTotal.calls === 0
                ? undefined
                : {
                    calls: attemptTotal.calls,
                    apptRate: pct(attemptTotal.appointments, attemptTotal.calls),
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

      {/* ══ 4 · Fortschritt (kumuliert) ══
          Der einzige Zeit-Chart des Tabs. Die frühere Tagesreihe je Person
          darüber zeigte dieselben Serien ungeglättet — zwei Zeit-Charts
          untereinander waren der Hauptgrund, warum die Seite überladen wirkte.
          Startet zu: Die Endstände aller vier Serien stehen in den Kacheln
          ganz oben. */}
      <Fade i={7}>
        <AnalyseSection title="Fortschritt" icon={Target} meta="kumuliert" collapsible defaultOpen={false}>
          <CumulativeProgressChart
            buckets={buckets}
            series={[
              { key: "calls", label: "Erstkontakte", kind: "count", values: byBucket.calls, defaultOn: true },
              { key: "decider", label: "Entscheider", kind: "count", values: byBucket.decider },
              { key: "appts", label: "Termine aus Erstkontakten", kind: "count", values: byBucket.appts, defaultOn: true },
            ]}
            rangeLabel={rangeLabel}
            note="Jeder Lead zählt am Tag seines Erstkontakts — Entscheider und Termine also dort, nicht am Tag des Ereignisses."
          />
        </AnalyseSection>
      </Fade>

      {/* ══ 5 · A/B-Test: Skript-Arme und Zielgruppen ══
          Zwei Achsen desselben Tests: WAS gesagt wurde und WEM. Beide brauchen
          gepflegte Labels — ohne sie bleiben die Tabellen leer, und genau das
          sagt der Leerzustand.
          Beide starten zu (gleicher Startzustand im zweispaltigen Raster, sonst
          stünde die zugeklappte Karte als hohe leere Fläche neben der offenen):
          Ein A/B-Vergleich ist eine gezielte Frage, keine Tageszahl. */}
      <div className="analyse-row" style={{ alignItems: "start" }}>
        <Fade i={8}>
          <AnalyseSection
            title="Welches Skript konvertiert?"
            icon={FileText}
            meta={scriptAb.cells.length === 1 ? "1 Arm" : `${INT_FMT.format(scriptAb.cells.length)} Arme`}
            collapsible
            defaultOpen={false}
            info={abInfo({
              unlabeled: scriptAb.unlabeled,
              axisHint:
                "der Testarm wird beim Import am Lead festgeschrieben (Migration 0030) und bleibt dort, auch wenn der Lead später als „Rückruf“ oder „Nicht erreicht“ in eine Routing-Liste wandert. Vor 0030 importierte Leads erben ihn ersatzweise von ihrer Liste; nur bei ihnen kann ein Umzug den Arm gekostet haben.",
            })}
          >
            <AbTable
              cells={scriptAb.cells}
              axisLabel="Skript-Arm"
              emptyHint="Noch kein Skript-Arm mit genug Erstkontakten. Der Testarm wird beim CSV-Import gesetzt — dasselbe Label in mehreren Importen ergibt einen gemeinsamen Arm."
            />
          </AnalyseSection>
        </Fade>
        <Fade i={9}>
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
              emptyHint="Noch keine Branche mit genug Erstkontakten. Beim CSV-Import lässt sich die Branche für die ganze Datei setzen; bestehende Listen bekommen sie auf der Listen-Seite unter „Skript und A/B-Test“."
            />
          </AnalyseSection>
        </Fade>
      </div>

      {/* ══ 6 · Lead-Ebene: Anruf-Versuche ══ */}
      <div className="analyse-row" style={{ alignItems: "start" }}>
        <Fade i={11}>
          <AnalyseSection
            title="Wie oft musst du anrufen?"
            icon={Repeat}
            meta={attemptUnknown > 0 ? `${INT_FMT.format(attemptUnknown)} ohne Versuchszähler` : "Leads nach erreichtem Versuch"}
            collapsible
            defaultOpen={false}
            info={
              <InfoBody>
                <span>
                  <code>call_attempt</code> ist der zuletzt gezählte Versuch eines Leads, nicht ein Ereignis-Log. Die
                  Spalte &bdquo;3. Versuch&ldquo; enthält also Leads, bei denen dreimal angerufen wurde — bricht die
                  Terminquote dort ein, lohnt der dritte Anruf nicht mehr.
                </span>
                <span>
                  &bdquo;Nachfassen oder neue Leads?&ldquo; zählt dieselben Anrufe als <B>Anwahlen</B>, also als
                  Ereignisse; hier stehen die <B>Leads</B>, gruppiert nach ihrem Zählerstand.
                </span>
              </InfoBody>
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
      </div>

      {/* ══ 8 · Funnel ══
          Startet zu: Dieselben drei Stufen stehen als Kacheln und als Spalten
          der Vergleichstabelle oben — hier nur zusätzlich als Form je Person. */}
      <Fade i={13}>
        <AnalyseSection title="Funnel" icon={Phone} collapsible defaultOpen={false}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <FunnelStrip
              label="Gesamt"
              highlight
              stages={[
                { label: "Erstkontakte", value: sum.calls },
                { label: "Entscheider", value: sum.decider },
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
                    { label: "Erstkontakte", value: t.calls },
                    { label: "Entscheider", value: t.decider },
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
