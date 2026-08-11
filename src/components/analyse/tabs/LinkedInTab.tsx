import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlarmClock,
  Ban,
  CalendarPlus,
  Euro,
  Flame,
  ListOrdered,
  MessageSquare,
  Percent,
  Repeat,
  Smile,
  TrendingUp,
  Users,
} from "lucide-react";
import { buildOwnScope, type AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import {
  contactDay, loadClosingCalls, loadContacts, loadSettingCalls, type AnalyseContact,
} from "@/lib/analyseData";
import {
  FU_MATURITY_DAYS, NUM, SENTIMENT_META, buildBuckets, buildFuCascade, bucketOf, eur, fmtPct, fuStage,
  ownerKey, pct, sentimentOf, weekdayIndex, type Granularity, type ReifeKey,
} from "@/lib/analyse";
import { VIZ_NEUTRAL } from "@/lib/viz";
import { berlinDateISO } from "@/lib/apptTime";
import { addDaysISO } from "@/lib/dates";
import { personOf } from "@/lib/personResolution";
import { getTargets } from "@/app/actions/targets";
import { resolveTarget } from "@/lib/targets";
import { ownerColor } from "@/lib/ownerColor";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { InfoPopover } from "@/components/ui/InfoPopover";
import { AnalyseSection } from "@/components/analyse/AnalyseSection";
import { ComparisonTable, type ComparisonRow } from "@/components/analyse/ComparisonTable";
import {
  MetricTable, ShareBar, type MetricRow, type ShareSegment,
} from "@/components/analyse/AnalyseTables";
import { CumulativeProgressChart } from "@/components/analyse/CumulativeProgressChart";
import { ListPerformanceTable, type ListPerfRow } from "@/components/analyse/ListPerformanceTable";
import { KpiHero, KpiRow, type Tone } from "@/components/analyse/AnalyseViz";

// LinkedIn-Flow — der einzige Ort, an dem LinkedIn-Kennzahlen stehen.
//
// Hier sind seit dem Umbau drei frühere Tabs zusammengelaufen: LinkedIn,
// Follow-ups und Listen. Der Grund ist nicht Platzersparnis, sondern dass die
// drei Fragen zusammengehören — „wie viel pitche ich", „wie konsequent fasse
// ich nach" und „welche Liste trägt" beantwortet man nur gemeinsam.
//
// ── Zwei Rechen-Entscheidungen, die den Tab prägen ────────────────────────
//
// 1) ALLES kommt aus den Kontaktdaten, nicht aus `rpc_owner_day_metrics`.
//    Die RPC kennt keinen Listen-Parameter. Mit aktivem Listen-Filter zeigten
//    Kacheln und Vergleichstabelle sonst die ungefilterten Zahlen, während
//    Ranking und Kaskade daneben gefiltert wären — der schlimmste Fall: kein
//    Fehler, nur zwei Wahrheiten auf einer Seite. Die Definition ist dieselbe
//    (`coalesce(pitched_at, created_at)`, Owner über `lists.owner_name`), nur
//    in JS statt in SQL.
//
// 2) TERMINE zählen als GELEGT, nicht als Kohorte.
//    Gezählt wird, was im Zeitraum GEBUCHT wurde (`setting_calls.created_at`),
//    nicht, welche der hier gepitchten Kontakte irgendwann einen Termin bekamen.
//    Das ist die Zahl, die Akquise-Arbeit im Zeitraum misst, und sie überlebt
//    Umterminierungen. Preis: Zähler (Buchungen im Zeitraum) und Nenner (Pitches
//    im Zeitraum) sind verschiedene Kohorten, und ein später abgesagter Termin
//    bleibt gezählt. Beides steht als Fußnote unter der Kachelreihe.
//
// ── Aufbau (nach dem Entschlacken) ────────────────────────────────────────
//
//   1 Kennzahlen        6 Kacheln, „Termine gelegt" als einzige Leitzahl
//   2 Vergleich         nur bei mehr als einer sichtbaren Person
//   3 Fortschritt       drei Mengen-Serien, eine Y-Achse
//   4 Consistency       Arbeitstage je Person
//   5 Follow-ups        AQ FU 1/2/3 + Umsatz-Zusatz
//   6 Nachfass-Disziplin  je Stufe · je Person
//   7 Listen im Vergleich
//
// Gestrichen wurden nur Kacheln und Sektionen, KEINE Rechenwege: die drei
// Stimmungs-Kacheln (jetzt ein Anteilsbalken), „Zusatz durch FU" auf Antwort-
// und Terminquote, die Spalten „Streak"/„Aktive Tage" und die Sektion „Eigene
// Nachfass-Texte vs. Standard". Begründung steht jeweils an der Stelle.

type Member = { user_id: string; username: string };

const OHNE = "Ohne Zuordnung";
const INT = new Intl.NumberFormat("de-DE");

/**
 * Mindestmenge, ab der eine Liste im Ranking erscheint.
 *
 * Früher ein URL-Filter („Mindest-DMs") des Listen-Tabs. Der ist mit dem Tab
 * entfallen: Bei 3 von 5 DMs steht in der Antwortquote 60 %, und das ist kein
 * Ergebnis, sondern Rauschen — ein Regler, mit dem man das Rauschen einschalten
 * kann, hilft niemandem.
 */
const MIN_LIST_DMS = 10;

/** Prozentuale Veränderung vs. Vorperiode; Vorwert 0 → null (kein Delta). */
function deltaPct(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

/** Differenz zweier Quoten in Prozentpunkten; eine Seite null → null. */
function deltaPP(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null) return null;
  return Math.round((cur - prev) * 10) / 10;
}

/**
 * YYYY-MM-DD → DD.MM.YYYY.
 *
 * Der Fortschritts-Chart trug seinen Zeitraum als rohes ISO-Datum, während
 * jeder andere Tab deutsch datiert — dasselbe Feld in zwei Schreibweisen liest
 * sich wie zwei verschiedene Angaben. Bewusst per String-Split statt über
 * `Date`: ein Parse würde den Kalendertag über die Zeitzone verschieben.
 */
function deDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
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
// Beide Helfer sind bewusst lokal: `AnalyseSection`, `AnalyseTables` und
// `InfoPopover` sind fertig und werden nicht angefasst. (`Fade` unten ist aus
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
 * Karte. Der Follow-up-Block braucht trotzdem eine Überschrift, sonst stünden
 * plötzlich vier weitere Kacheln im Tab, ohne dass klar wäre, worauf sie sich
 * beziehen. Typografie identisch zum Sektionskopf.
 *
 * `info` trägt hier dieselbe Rolle wie an der Sektion: Ein Kachelblock hat
 * keine Karte, an die man ein Info-Icon hängen könnte — die Überschrift ist der
 * einzige Anker, an dem der Erklärtext nicht dauerhaft im Weg steht.
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
 * Kachel-Hülle für die beiden lokalen Varianten unten.
 *
 * Maße, Klassen und der 2px-Ton-Rail sind bewusst 1:1 aus `KpiHero`
 * (AnalyseViz) übernommen: In derselben `.kpi-row` stehen fremde und lokale
 * Kacheln nebeneinander, und die Naht darf man nicht sehen. Als eigene Hülle,
 * damit die Übereinstimmung an EINER Stelle gepflegt wird statt in zweien.
 */
function TileShell({
  label,
  tone = "default",
  icon,
  index = 0,
  children,
}: {
  label: string;
  tone?: Tone;
  icon?: ReactNode;
  index?: number;
  children: ReactNode;
}) {
  const toneColor =
    tone === "success" ? "var(--success)" : tone === "warning" ? "var(--warning)" : tone === "error" ? "var(--danger)" : null;

  return (
    <div
      className="card fade-up"
      style={{
        position: "relative",
        padding: "var(--sp-6) var(--sp-7)",
        animationDelay: `${index * 60}ms`,
        overflow: "hidden",
      }}
    >
      {toneColor && (
        <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: toneColor }} />
      )}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--sp-4)" }}>
        <span className="eyebrow">{label}</span>
        {icon && <span style={{ color: "var(--orange-500)", display: "inline-flex", flexShrink: 0 }}>{icon}</span>}
      </div>
      {children}
    </div>
  );
}

/** Die große Zahl einer Kachel — identisch zur `kpi-value`-Zeile in `KpiHero`. */
function TileValue({ value, format = "int" }: { value: number | null; format?: "int" | "pct" | "eur" }) {
  return (
    <div className="kpi-value" style={{ marginTop: "var(--sp-3)" }}>
      {value === null ? (
        "—"
      ) : format === "pct" ? (
        <>
          <NumberTicker value={value} decimalPlaces={1} />
          {" %"}
        </>
      ) : format === "eur" ? (
        <>
          <NumberTicker value={value} decimalPlaces={0} />
          {" €"}
        </>
      ) : (
        <NumberTicker value={value} decimalPlaces={0} />
      )}
    </div>
  );
}

/**
 * KPI-Kachel mit erklärender Unterzeile statt Delta-Chip.
 *
 * `KpiHero` kennt nur den Delta-Chip. Für „AQ FU 1 = 12,4 %" ist ein Delta aber
 * die falsche Zusatzinformation — gebraucht wird der Bruch, aus dem die Quote
 * kommt („18 Antworten von 145 erreichten"). Die Unterzeile sitzt exakt dort,
 * wo in `KpiHero` der Delta-Chip steht.
 */
function KpiSub({
  label,
  value,
  format = "int",
  sub,
  tone = "default",
  icon,
  index = 0,
}: {
  label: string;
  value: number | null;
  format?: "int" | "pct" | "eur";
  sub: string;
  tone?: Tone;
  icon?: ReactNode;
  index?: number;
}) {
  return (
    <TileShell label={label} tone={tone} icon={icon} index={index}>
      <TileValue value={value} format={format} />
      <div style={{ marginTop: "var(--sp-4)", fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{sub}</div>
    </TileShell>
  );
}

/**
 * Kachel mit Anteilsbalken statt Unterzeile.
 *
 * Ersetzt die früheren drei Kacheln „Positive / Neutrale / Negative Antwort".
 * Die drei zeigten eine Verteilung, die sich auf 100 % addiert, und schrieben
 * dabei dreimal denselben Nenner aus — drei Kacheln für einen einzigen Split.
 * `ShareBar` zeigt denselben Inhalt auf einem Sechstel der Fläche und zeigt ihn
 * erstmals ALS Split: Die Segmentbreiten stehen nebeneinander, statt dass man
 * drei Prozentwerte im Kopf sortieren muss.
 *
 * Der Balken rechnet gegen ALLE Antworten, nicht nur gegen die kategorisierten:
 * unkategorisierte Antworten sind ein eigenes Segment. Vorher fielen sie aus
 * dem Nenner und damit unsichtbar aus der Auswertung.
 */
function KpiShare({
  label,
  value,
  segments,
  icon,
  index = 0,
}: {
  label: string;
  value: number | null;
  segments: ShareSegment[];
  icon?: ReactNode;
  index?: number;
}) {
  return (
    <TileShell label={label} icon={icon} index={index}>
      <TileValue value={value} />
      <div style={{ marginTop: "var(--sp-4)" }}>
        <ShareBar segments={segments} height={8} />
      </div>
    </TileShell>
  );
}

// ── Brücke Termin → Pitch-Liste ──────────────────────────────
// Ein im Zeitraum gebuchter Termin kann von einem Kontakt stammen, der VOR dem
// Zeitraum gepitcht wurde — der steckt dann nicht in der geladenen Kohorte, und
// ohne seine `list_id` ließe sich der Termin dem Listen-Filter nicht zuordnen.
// Deshalb dieser schmale Nachschlag über alle Kontakte mit Termin.
//
// Läuft NUR bei aktivem Listen-Filter: ohne ihn braucht niemand die Zuordnung,
// und eine Abfrage, die nichts entscheidet, gehört nicht in den Renderpfad.
type BridgeRow = { id: string; list_id: string; setting_call_id: string | null };

async function loadApptListBridge(
  supabase: Awaited<ReturnType<typeof createClient>>,
  access: AccessContext,
  canCompare: boolean,
): Promise<BridgeRow[]> {
  return fetchAllRows<BridgeRow>((f, t) => {
    let q = supabase
      .from("contacts")
      // Die eingebettete Liste trägt nur den Personen-Scope; ihre Spalten
      // werden nicht gelesen. `!inner` schneidet die Kontakte mit.
      .select("id, list_id, setting_call_id, lists!inner(owner_name, created_by_user_id)")
      .eq("workspace_id", access.workspace_id)
      .not("setting_call_id", "is", null);
    if (!canCompare) q = q.or(buildOwnScope(access.user.id, access.username), { referencedTable: "lists" });
    return q.order("id").range(f, t);
  }).catch((err) => {
    // Kein harter Fehler: die Kohorte des Zeitraums liefert bereits einen
    // Großteil der Zuordnungen (siehe Seed unten), es fehlten dann nur Termine
    // aus älteren Pitches.
    console.error("loadApptListBridge:", err instanceof Error ? err.message : err);
    return [] as BridgeRow[];
  });
}

/** Alle Arbeitstage (Mo–Fr) im Fenster, aufsteigend. */
function workdayList(from: string, to: string): string[] {
  const out: string[] = [];
  if (from > to) return out;
  let cursor = from;
  // Obergrenze wie in `buildBuckets` — 730 Tage sind die maximale Spanne.
  for (let i = 0; i <= 730 && cursor <= to; i++) {
    if (weekdayIndex(cursor) < 5) out.push(cursor);
    cursor = addDaysISO(cursor, 1);
  }
  return out;
}

type ListAgg = {
  id: string;
  name: string;
  owner: string;
  archived: boolean;
  texts: { pitch: boolean; fu1: boolean; fu2: boolean; fu3: boolean };
  dms: number;
  answers: number;
  appts: number;
  revenue: number;
};

function newListAgg(id: string, c: AnalyseContact): ListAgg {
  const l = c.lists;
  return {
    id,
    name: l?.name?.trim() || "Unbenannte Liste",
    owner: (l?.owner_name ?? "").trim(),
    archived: Boolean(l?.archived_at),
    texts: {
      pitch: Boolean(l?.pitch_text?.trim()),
      fu1: Boolean(l?.fu1_text?.trim()),
      fu2: Boolean(l?.fu2_text?.trim()),
      fu3: Boolean(l?.fu3_text?.trim()),
    },
    dms: 0, answers: 0, appts: 0, revenue: 0,
  };
}

type PersonAgg = {
  dms: number;
  answers: number;
  booked: number;
  blocked: number;
  /** Offene Follow-ups (weder Antwort noch Termin noch blockiert, Stufe < 3). */
  openFu: number;
  overdueFu: number;
  /** Summe der Verzugstage über alle überfälligen Follow-ups. */
  delaySum: number;
};

const ZERO_PERSON = (): PersonAgg => ({
  dms: 0, answers: 0, booked: 0, blocked: 0, openFu: 0, overdueFu: 0, delaySum: 0,
});

export async function LinkedInTab({
  access,
  from,
  to,
  prevFrom,
  prevTo,
  today,
  granularity,
  selectedMembers,
  canCompare,
  allSelected,
  reife,
  listIds,
}: {
  access: AccessContext;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  today: string;
  granularity: Granularity;
  selectedMembers: Member[];
  canCompare: boolean;
  allSelected: boolean;
  reife: ReifeKey;
  /** Bereits gegen die sichtbaren Listen geprüft (siehe analyse/page.tsx). */
  listIds: string[];
}) {
  const supabase = await createClient();
  const hasListFilter = listIds.length > 0;

  const [contactsRaw, prevRaw, settings, closings, targets, bridgeRows] = await Promise.all([
    loadContacts(supabase, access, canCompare, from, to),
    loadContacts(supabase, access, canCompare, prevFrom, prevTo),
    loadSettingCalls(supabase, access, canCompare),
    loadClosingCalls(supabase, access, canCompare),
    getTargets(),
    hasListFilter ? loadApptListBridge(supabase, access, canCompare) : Promise.resolve([] as BridgeRow[]),
  ]);

  // ── Personen-Zuordnung (owner_name hat Vorrang, wie list_owned_by_user) ──
  const nameByKey = new Map<string, string>();
  for (const m of selectedMembers) nameByKey.set(ownerKey(m.username), m.username);
  const nameById = new Map(selectedMembers.map((m) => [m.user_id, m.username]));

  function ownerOf(c: AnalyseContact): string | null {
    const owner = c.lists?.owner_name;
    if (owner && owner.trim()) return nameByKey.get(ownerKey(owner)) ?? (allSelected ? OHNE : null);
    const byId = nameById.get(c.lists?.created_by_user_id ?? "");
    if (byId) return byId;
    return allSelected ? OHNE : null;
  }

  const listFilter = hasListFilter ? new Set(listIds) : null;
  const inFilter = (c: AnalyseContact) => !listFilter || listFilter.has(c.list_id);

  const contacts = contactsRaw.filter((c) => ownerOf(c) !== null && inFilter(c));
  const prevContacts = prevRaw.filter((c) => ownerOf(c) !== null && inFilter(c));

  // ── Gewonnene Deals je Setting-Call (Brücke zurück zur Liste) ───────────
  const wonBySetting = new Map<string, number>();
  for (const cc of closings) {
    if (cc.status !== "gewonnen" || !cc.setting_call_id) continue;
    wonBySetting.set(cc.setting_call_id, (wonBySetting.get(cc.setting_call_id) ?? 0) + NUM(cc.deal_volume));
  }

  // ── Termin → Liste ───────────────────────────────────────────
  // Seed aus der geladenen Kohorte (deckt Termine ab, deren Kontakt im
  // Zeitraum gepitcht wurde), darüber der Nachschlag für ältere Pitches.
  const listBySetting = new Map<string, string>();
  const listByContact = new Map<string, string>();
  if (listFilter) {
    for (const c of contactsRaw) {
      listByContact.set(c.id, c.list_id);
      if (c.setting_call_id) listBySetting.set(c.setting_call_id, c.list_id);
    }
    for (const b of bridgeRows) {
      listByContact.set(b.id, b.list_id);
      if (b.setting_call_id) listBySetting.set(b.setting_call_id, b.list_id);
    }
  }

  // ── Kohorten-Kennzahlen aus den Kontakten ────────────────────
  const buckets = buildBuckets(from, to, granularity);
  const dmsByBucket: Record<string, number> = {};
  const answersByBucket: Record<string, number> = {};
  const perPerson = new Map<string, PersonAgg>();
  const ensure = (name: string) => {
    let p = perPerson.get(name);
    if (!p) {
      p = ZERO_PERSON();
      perPerson.set(name, p);
    }
    return p;
  };
  for (const m of selectedMembers) ensure(m.username);

  // Tages-Zählung je Person für die Consistency-Übersicht.
  const dmsByPersonDay = new Map<string, Map<string, number>>();

  let dms = 0;
  let answers = 0;
  let blocked = 0;
  const sentiment = { positiv: 0, neutral: 0, negativ: 0, offen: 0 };

  for (const c of contacts) {
    const name = ownerOf(c)!;
    const p = ensure(name);
    const day = contactDay(c);
    const bk = bucketOf(day, from, to, granularity);

    dms += 1;
    p.dms += 1;
    dmsByBucket[bk] = (dmsByBucket[bk] ?? 0) + 1;

    let days = dmsByPersonDay.get(name);
    if (!days) {
      days = new Map();
      dmsByPersonDay.set(name, days);
    }
    days.set(day, (days.get(day) ?? 0) + 1);

    if (c.answered === true) {
      answers += 1;
      p.answers += 1;
      answersByBucket[bk] = (answersByBucket[bk] ?? 0) + 1;
      const s = sentimentOf(c.answer_category);
      if (s) sentiment[s] += 1;
      else sentiment.offen += 1;
    }
    if (c.blocked_at) {
      blocked += 1;
      p.blocked += 1;
    }

    // Offene Follow-ups: `answered`/`appointment_set` sind nullable, NULL ist
    // der Normalfall — deshalb „nicht true" statt `=== false` (docs §7).
    const stage = fuStage(c.follow_up_number);
    const eligible =
      c.answered !== true && c.appointment_set !== true && !c.blocked_at && stage < 3;
    if (eligible) {
      p.openFu += 1;
      const due = c.next_follow_up_at;
      if (due && due < today) {
        p.overdueFu += 1;
        const delay = Math.max(
          0,
          Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${due}T00:00:00Z`).getTime()) / 86400000),
        );
        p.delaySum += delay;
      }
    }
  }

  const prevDms = prevContacts.length;
  const prevAnswers = prevContacts.filter((c) => c.answered === true).length;

  // ── Termine: im Zeitraum GEBUCHT ─────────────────────────────
  const bookedByBucket: Record<string, number> = {};
  let booked = 0;
  let prevBooked = 0;

  for (const sc of settings) {
    // Nur LinkedIn-Termine — dies ist der LinkedIn-Tab. Manuelle und Telefon-
    // Termine haben ihre eigenen Quellen und würden die Terminquote gegen die
    // LinkedIn-DMs künstlich anheben.
    if (sc.source_type !== "linkedin") continue;

    const uid = personOf(sc);
    const name = uid ? nameById.get(uid) : undefined;
    if (!name && !allSelected) continue;

    if (listFilter) {
      const lid = listBySetting.get(sc.id) ?? (sc.source_contact_id ? listByContact.get(sc.source_contact_id) : undefined);
      if (!lid || !listFilter.has(lid)) continue;
    }

    // Buchungstag = Anlage des Termins in Berliner Kalenderzeit. `created_at`
    // statt `appointment_at`: eine Umterminierung verschiebt den Termin, nicht
    // die Leistung, ihn geholt zu haben.
    const day = berlinDateISO(sc.created_at);
    if (day >= prevFrom && day <= prevTo) {
      prevBooked += 1;
      continue;
    }
    if (day < from || day > to) continue;

    booked += 1;
    ensure(name ?? OHNE).booked += 1;
    const bk = bucketOf(day, from, to, granularity);
    bookedByBucket[bk] = (bookedByBucket[bk] ?? 0) + 1;
  }

  // ── Quoten ───────────────────────────────────────────────────
  const answerRate = pct(answers, dms);
  const prevAnswerRate = pct(prevAnswers, prevDms);
  const apptRate = pct(booked, dms);
  const prevApptRate = pct(prevBooked, prevDms);
  const apptTone: Tone = apptRate === null ? "default" : apptRate < 3 ? "error" : apptRate <= 7 ? "success" : "default";
  const blockedRate = pct(blocked, dms);

  // Stimmungs-Split für den Anteilsbalken. „Ohne Kategorie" ist ein VOLLWERTIGES
  // Segment, nicht ein weggelassener Rest: Nenner ist die Zahl über dem Balken
  // (alle Antworten). Vorher rechneten die drei Kacheln gegen die
  // kategorisierten Antworten — wer nichts kategorisiert, sah trotzdem
  // saubere 100 %, und die Datenlücke stand nur im Info-Popover.
  const sentimentSegments: ShareSegment[] = [
    ...SENTIMENT_META.map((m) => ({ label: m.label, value: sentiment[m.key], color: m.color })),
    { label: "Ohne Kategorie", value: sentiment.offen, color: VIZ_NEUTRAL },
  ];

  // Anzeigereihenfolge: Mitglieder, dann "Ohne Zuordnung" (nur mit Daten).
  const names = selectedMembers.map((m) => m.username);
  const ohne = perPerson.get(OHNE);
  if (ohne && (ohne.dms > 0 || ohne.booked > 0)) names.push(OHNE);

  /**
   * Gibt es überhaupt etwas zu vergleichen?
   *
   * Bei genau einer sichtbaren Person ist die Vergleichstabelle eine Zeile plus
   * eine „Gesamt"-Zeile mit denselben Zahlen — und beide Zeilen stehen bereits
   * in der Kachelreihe darüber. Der Übersicht-Tab blendet seine Personen-
   * Tabelle aus demselben Grund aus; hier fehlte das Gate.
   */
  const multiPerson = names.length > 1;

  const personRows: ComparisonRow[] = names.map((name) => {
    const p = perPerson.get(name) ?? ZERO_PERSON();
    return {
      name,
      values: {
        dms: p.dms,
        answers: p.answers,
        answerRate: pct(p.answers, p.dms),
        booked: p.booked,
        apptRate: pct(p.booked, p.dms),
        blockedRate: pct(p.blocked, p.dms),
      },
    };
  });

  // ── Consistency ──────────────────────────────────────────────
  // Nur bis heute rechnen: ein laufender Monat darf seine Zukunft nicht als
  // Lücke zählen (gleiche Regel wie beim Ziel-Abgleich in der Übersicht).
  //
  // Die frühere Spalte „Streak" ist ersatzlos weg: Sie zählte nur innerhalb des
  // gewählten Zeitraums und war damit auf dessen Arbeitstage gedeckelt — bei
  // „Diese Woche" konnte sie nie über 5 gehen, dieselbe Person hatte je nach
  // Filter eine andere Serie. Eine Zahl, deren Bedeutung am Filter hängt,
  // motiviert nicht, sie verwirrt.
  const consistencyTo = to < today ? to : today;
  const workdays = workdayList(from, consistencyTo);

  const consistencyRows: MetricRow[] = selectedMembers.map((m) => {
    const days = dmsByPersonDay.get(m.username) ?? new Map<string, number>();
    const goal = resolveTarget(targets, m.user_id, "linkedin", "daily", "pitches");

    let activeDays = 0;
    let goalDays = 0;
    let dmsOnActive = 0;
    for (const d of workdays) {
      const n = days.get(d) ?? 0;
      if (n > 0) {
        activeDays += 1;
        dmsOnActive += n;
      }
      if (goal > 0 && n >= goal) goalDays += 1;
    }

    const quote = pct(activeDays, workdays.length);
    return {
      key: m.user_id,
      label: m.username,
      // „Aktive Tage" stand früher als eigene Spalte neben „Konsistenz" —
      // Zähler und Quotient desselben Bruchs, also dieselbe Messung zweimal.
      // Vergleichbar über verschiedene Zeiträume ist nur der Quotient; der
      // Zähler steht jetzt dort, wo auch sein Nenner steht, und liest sich
      // damit als Bruch statt als konkurrierende Kennzahl.
      sub: `${INT.format(activeDays)} von ${INT.format(workdays.length)} Arbeitstagen${
        goal > 0 ? ` · Ziel ${INT.format(goal)} DMs/Tag` : " · kein Tagesziel"
      }`,
      share: quote === null ? null : quote / 100,
      color: ownerColor(m.username).fg,
      values: {
        quote,
        goalDays,
        avgDms: activeDays === 0 ? null : Math.round((dmsOnActive / activeDays) * 10) / 10,
      },
    };
  });

  // ── Follow-up-Kaskade ────────────────────────────────────────
  // Der Reife-Schnitt lässt nur Pitches zu, deren Sequenz rechnerisch
  // durchlaufen sein könnte — sonst drücken frische Pitches jede späte Stufe.
  const matureBefore = addDaysISO(today, -FU_MATURITY_DAYS);
  const fuContacts = reife === "reif" ? contacts.filter((c) => contactDay(c) <= matureBefore) : contacts;

  const cascade = buildFuCascade(fuContacts);
  const fuPitches = cascade[0].reached;

  // Von den drei früheren „Zusatz durch FU"-Kacheln ist nur die Euro-Fassung
  // geblieben. Die Prozent-Varianten (Anteil an Antwort- und Terminquote)
  // sagten dasselbe wie ihr eigener Info-Text: kein Inkrementalwert, ohne
  // Kontrollgruppe eher Obergrenze als Beweis. Eine Zahl, die selbst erklärt,
  // nichts zu belegen, löst keine Handlung aus. Beim Umsatz ist das anders —
  // „ohne Nachfassen wären X € nicht entstanden" ist die einzige Größe hier,
  // die je eine Entscheidung ändert.
  let revenueTotal = 0;
  let revenueAfterFu = 0;
  for (const c of fuContacts) {
    if (!c.setting_call_id) continue;
    const won = wonBySetting.get(c.setting_call_id) ?? 0;
    if (won === 0) continue;
    revenueTotal += won;
    if (fuStage(c.follow_up_number) >= 1) revenueAfterFu += won;
  }
  const revenueShare = pct(revenueAfterFu, revenueTotal);

  // ── Follow-up-Erledigung je Stufe ────────────────────────────
  // „Fällig gewesen" = wer die Vorstufe hat und danach noch im Flow war.
  // Kontakte, die geantwortet haben, einen Termin haben oder blockiert sind,
  // sollen NICHT nachgefasst werden — sie gehören nicht in den Nenner.
  const advanced = [0, 0, 0, 0];
  const stalled = [0, 0, 0, 0];
  const stalledOverdue = [0, 0, 0, 0];
  for (const c of fuContacts) {
    const s = fuStage(c.follow_up_number);
    for (let k = 0; k <= s; k++) advanced[k] += 1;
    const eligible = c.answered !== true && c.appointment_set !== true && !c.blocked_at;
    if (eligible && s < 3) {
      stalled[s] += 1;
      if (c.next_follow_up_at && c.next_follow_up_at < today) stalledOverdue[s] += 1;
    }
  }

  const stageRows: MetricRow[] = [1, 2, 3].map((k) => {
    const due = advanced[k] + stalled[k - 1];
    return {
      key: `fu${k}`,
      label: `FU${k}`,
      sub: `nach ${k === 1 ? "dem Pitch" : `FU${k - 1}`}`,
      share: due === 0 ? null : advanced[k] / due,
      values: {
        due,
        sent: advanced[k],
        rate: pct(advanced[k], due),
        open: stalled[k - 1],
        overdue: stalledOverdue[k - 1],
      },
    };
  });

  const openFuTotal = names.reduce((s, n) => s + (perPerson.get(n)?.openFu ?? 0), 0);
  const overdueFuTotal = names.reduce((s, n) => s + (perPerson.get(n)?.overdueFu ?? 0), 0);

  const overdueRows: MetricRow[] = names.map((name) => {
    const p = perPerson.get(name) ?? ZERO_PERSON();
    return {
      key: name,
      label: name,
      share: openFuTotal === 0 ? null : p.openFu / openFuTotal,
      color: ownerColor(name === OHNE ? "" : name).fg,
      values: {
        open: p.openFu,
        overdue: p.overdueFu,
        overdueRate: pct(p.overdueFu, p.openFu),
        avgDelay: p.overdueFu === 0 ? null : Math.round((p.delaySum / p.overdueFu) * 10) / 10,
      },
    };
  });

  // ── Listen-Ranking ───────────────────────────────────────────
  const byList = new Map<string, ListAgg>();
  for (const c of contacts) {
    let agg = byList.get(c.list_id);
    if (!agg) {
      agg = newListAgg(c.list_id, c);
      byList.set(c.list_id, agg);
    }
    agg.dms += 1;
    if (c.answered === true) agg.answers += 1;
    if (c.appointment_set === true) agg.appts += 1;
    if (c.setting_call_id) agg.revenue += wonBySetting.get(c.setting_call_id) ?? 0;
  }

  const allLists = [...byList.values()].sort((a, b) => b.dms - a.dms);
  const qualified = allLists.filter((l) => l.dms >= MIN_LIST_DMS);
  const listRows: ListPerfRow[] = qualified.map((l) => ({
    id: l.id,
    name: l.name,
    owner: l.owner,
    archived: l.archived,
    texts: l.texts,
    dms: l.dms,
    answers: l.answers,
    answerRate: pct(l.answers, l.dms),
    appts: l.appts,
    apptRate: pct(l.appts, l.dms),
    revenue: l.revenue,
  }));

  const reifeNote =
    reife === "reif"
      ? `nur Pitches bis ${matureBefore}`
      : "alle Pitches im Zeitraum";

  return (
    <>
      {/* ══ 1 · Sechs Kennzahlen ══
          Die Kachelreihe hat keine Karte und damit keinen Sektionskopf, an dem
          ein Info-Icon sitzen könnte. Die Überschrift ist dieser Anker — und
          sie stellt den Block zugleich auf dieselbe Stufe wie den
          Follow-up-Block weiter unten, der schon immer eine hatte.

          Reihenfolge = Funnel-Reihenfolge; auf breiten Viewports ergibt das zwei
          Zeilen à drei Kacheln: oben die Ansprache (DMs → Antwortquote →
          Stimmung der Antworten), unten das Ergebnis (Termine → Terminquote →
          was uns verloren geht). Die drei früheren Stimmungs-Kacheln sind zu
          einer zusammengefallen. */}
      <BlockHeading
        title="Kennzahlen"
        icon={MessageSquare}
        meta={hasListFilter ? "auf die gewählten Listen eingegrenzt" : undefined}
        info={
          <InfoBody>
            <span>
              <B>Termine gelegt</B> zählt LinkedIn-Termine, die <em>im</em> Zeitraum gebucht wurden — nicht die
              Kontakte dieses Zeitraums, die irgendwann einen Termin bekamen. Zähler und Nenner der Terminquote
              sind damit verschiedene Kohorten, und ein später abgesagter Termin bleibt gezählt: Gemessen wird die
              Akquise-Leistung, nicht das Ergebnis.
            </span>
            <span>
              Der <B>Stimmungs-Balken</B> teilt die Antworten in Positiv, Neutral, Negativ und &bdquo;Ohne
              Kategorie&ldquo;. Sein Nenner sind ALLE Antworten — Antworten ohne gepflegte Kategorie sind ein
              eigenes Segment, statt aus der Rechnung zu fallen.
              {sentiment.offen > 0 &&
                ` Aktuell betrifft das ${INT.format(sentiment.offen)} von ${INT.format(answers)} Antworten.`}
            </span>
          </InfoBody>
        }
      />
      <KpiRow>
        <KpiHero
          label="DMs"
          value={dms}
          delta={deltaPct(dms, prevDms)}
          icon={<MessageSquare size={15} />}
          index={0}
        />
        <KpiHero
          label="Antwortquote"
          value={answerRate}
          format="pct"
          delta={deltaPP(answerRate, prevAnswerRate)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<TrendingUp size={15} />}
          index={1}
        />
        <KpiShare
          label="Antworten"
          value={answers}
          segments={sentimentSegments}
          icon={<Smile size={15} />}
          index={2}
        />
        {/* Die EINE Leitzahl des Tabs (`lead`, siehe KpiHero): DMs sind Aufwand,
            Termine sind das Ergebnis, für das der Aufwand betrieben wird. Die
            Quoten daneben sind Diagnose — sie erklären die Leitzahl, ersetzen
            sie aber nicht: 8 % Terminquote auf 25 DMs ist kein guter Monat.
            Nur eine Glaskarte pro Ansicht (COMPONENTS §5.2). */}
        <KpiHero
          label="Termine gelegt"
          value={booked}
          delta={deltaPct(booked, prevBooked)}
          icon={<CalendarPlus size={15} />}
          index={3}
          lead
        />
        <KpiHero
          label="Terminquote"
          value={apptRate}
          format="pct"
          delta={deltaPP(apptRate, prevApptRate)}
          deltaLabel="vs. Vorperiode (pp)"
          tone={apptTone}
          icon={<Percent size={15} />}
          index={4}
        />
        <KpiSub
          label="Block-Quote"
          value={blockedRate}
          format="pct"
          sub={`${INT.format(blocked)} von ${INT.format(dms)} Kontakten haben blockiert`}
          tone={blockedRate !== null && blockedRate >= 5 ? "error" : "default"}
          icon={<Ban size={15} />}
          index={5}
        />
      </KpiRow>

      {/* ══ 2 · Vergleich je Person ══
          Bleibt offen: die zentrale Vergleichstabelle des Tabs — aber nur, wenn
          es mehr als eine Person zu vergleichen gibt (siehe `multiPerson`). */}
      {multiPerson && (
        <Fade i={6}>
          <AnalyseSection title="Vergleich" icon={Users} meta="DMs · Antworten · gelegte Termine" collapsible>
            <ComparisonTable
              columns={[
                { key: "dms", label: "DMs", format: "int" },
                { key: "answers", label: "Antworten", format: "int" },
                { key: "answerRate", label: "Antwortquote", format: "pct", deltaVsAvg: true },
                { key: "booked", label: "Termine gelegt", format: "int" },
                { key: "apptRate", label: "Terminquote", format: "pct", deltaVsAvg: true },
                { key: "blockedRate", label: "Block-Quote", format: "pct" },
              ]}
              rows={personRows}
              average={{
                dms,
                answers,
                answerRate,
                booked,
                apptRate,
                blockedRate,
              }}
              averageLabel="Gesamt"
            />
          </AnalyseSection>
        </Fade>
      )}

      {/* ══ 3 · Fortschritt ══
          Startet zu: Die Endstände aller drei Serien stehen bereits in der
          Kachelreihe. Der Chart beantwortet nur, WANN im Zeitraum sie
          entstanden sind — eine Nachfrage.

          Antwort- und Terminquote sind als Serien raus. Sie zeigten exakt die
          Endwerte zweier Kacheln darüber und zwangen den Chart dafür auf eine
          zweite Y-Achse — COMPONENTS §9 erlaubt genau eine. Kumulierte Quoten
          laufen zudem gegen ihren eigenen Endwert und sehen deshalb immer nach
          Beruhigung aus, egal was passiert ist. */}
      <Fade i={7}>
        <AnalyseSection
          title="Fortschritt"
          icon={TrendingUp}
          meta="kumuliert über den Zeitraum"
          collapsible
          defaultOpen={false}
        >
          <CumulativeProgressChart
            buckets={buckets}
            series={[
              { key: "dms", label: "DMs", kind: "count", values: dmsByBucket, defaultOn: true },
              { key: "answers", label: "Antworten", kind: "count", values: answersByBucket },
              { key: "termine", label: "Termine gelegt", kind: "count", values: bookedByBucket },
            ]}
            rangeLabel={`${deDate(from)} – ${deDate(to)}`}
            note="DMs und Antworten sitzen auf dem Pitch-Tag, Termine auf ihrem Buchungstag."
          />
        </AnalyseSection>
      </Fade>

      {/* ══ 4 · Consistency ══
          Startet zu: Arbeitsverhalten je Person ist eine Führungsfrage, kein
          Erstblick auf die Zahlen des Zeitraums.

          Bleibt auch bei einer einzigen Person stehen: Anders als beim
          Vergleich oben steht hier keine Spalte irgendwo sonst im Tab — die
          Verteilung der DMs über die Arbeitstage ist eine eigene Frage, keine
          zweite Schreibweise der Kachelreihe. */}
      <Fade i={8}>
        <AnalyseSection
          title="Consistency"
          icon={Flame}
          meta={`${INT.format(workdays.length)} Arbeitstage im Zeitraum`}
          collapsible
          defaultOpen={false}
          info={
            <InfoBody>
              <span>
                Ein Tag zählt ab <B>einer</B> DM als aktiv; &bdquo;Ziel erreicht&ldquo; ist die strengere Spalte —
                Tage mit mindestens dem Tagesziel aus den Einstellungen (ohne eigenen Eintrag 20 DMs).
              </span>
              <span>
                <B>Konsistenz</B> misst gegen die Arbeitstage Mo–Fr bis heute, nicht gegen Kalendertage — sonst
                bestrafte jedes Wochenende die Quote. Pitches am Wochenende zählen hier aus demselben Grund nicht
                mit; in den Kennzahlen oben sind sie enthalten. Die aktiven Tage selbst stehen unter dem Namen,
                nicht als eigene Spalte: Sie sind der Zähler dieser Quote, keine zweite Kennzahl.
              </span>
            </InfoBody>
          }
        >
          <MetricTable
            label="Person"
            columns={[
              { key: "quote", label: "Konsistenz", format: "pct", emphasis: true },
              { key: "goalDays", label: "Ziel erreicht", format: "int" },
              { key: "avgDms", label: "Ø DMs/aktiver Tag", format: "num1" },
            ]}
            rows={consistencyRows}
            minWidth={440}
            emptyHint="Keine Person ausgewählt."
          />
        </AnalyseSection>
      </Fade>

      {/* ══ 5 · Follow-ups ══ */}
      <BlockHeading
        title="Follow-ups"
        icon={Repeat}
        meta={`${INT.format(fuPitches)} Pitches · ${reifeNote}`}
        info={
          <InfoBody>
            <span>
              <B>&bdquo;Zusatz durch FU an Umsatz&ldquo; ist kein Inkrementalwert.</B> Es gibt keine Kontrollgruppe
              und keinen Zeitstempel je Follow-up — gespeichert ist nur die zuletzt gesendete Stufe. Belastbar ist
              allein: So viel Umsatz entstand bei Kontakten, deren letzte Stufe mindestens FU1 war. Ein Teil davon
              hätte auch ohne Nachfassen geantwortet — eher Obergrenze als Beweis. Als Euro-Betrag trägt die Zahl
              trotzdem eine Entscheidung (lohnt der Aufwand?); die früheren Prozent-Fassungen auf Antwort- und
              Terminquote taten das nicht und sind deshalb entfallen.
            </span>
            <span>
              Der Umsatz läuft über den Quellkontakt des gewonnenen Closings; manuell gebuchte Termine ohne
              Quellkontakt tauchen dort nicht auf.
            </span>
            {reife === "alle" && (
              <span>
                Junge Pitches sind mitgezählt: Sie können FU2/FU3 noch gar nicht erreicht haben und drücken deren
                Quoten. Der Filter &bdquo;Kohorte&ldquo; oben schneidet sie weg.
              </span>
            )}
          </InfoBody>
        }
      />
      <KpiRow>
        <KpiSub
          label="AQ FU 1"
          value={cascade[1].rate}
          format="pct"
          sub={`${INT.format(cascade[1].answers)} Antworten von ${INT.format(cascade[1].reached)} erreichten`}
          icon={<Repeat size={15} />}
          index={0}
        />
        <KpiSub
          label="AQ FU 2"
          value={cascade[2].rate}
          format="pct"
          sub={`${INT.format(cascade[2].answers)} Antworten von ${INT.format(cascade[2].reached)} erreichten`}
          icon={<Repeat size={15} />}
          index={1}
        />
        <KpiSub
          label="AQ FU 3"
          value={cascade[3].rate}
          format="pct"
          sub={`${INT.format(cascade[3].answers)} Antworten von ${INT.format(cascade[3].reached)} erreichten`}
          icon={<Repeat size={15} />}
          index={2}
        />
        <KpiSub
          label="Zusatz durch FU an Umsatz"
          value={revenueAfterFu}
          format="eur"
          sub={
            revenueTotal === 0
              ? "kein gewonnener Deal in dieser Kohorte"
              : `${fmtPct(revenueShare)} von ${eur(revenueTotal)} Kohorten-Umsatz`
          }
          tone={revenueAfterFu > 0 ? "success" : "default"}
          icon={<Euro size={15} />}
          index={3}
        />
      </KpiRow>

      {/* ══ 6 · Follow-up-Consistency ══
          Beide Sektionen starten ZU und teilen sich denselben Startzustand:
          In einem zweispaltigen Raster stünde eine zugeklappte Karte neben
          einer offenen sonst als hohe, leere Fläche da.
          `alignItems: start` sorgt dafür, dass das auch nach dem Aufklappen
          einer der beiden Karten so bleibt — ohne die Vorgabe würde die
          zugeklappte auf die Höhe der offenen gestreckt. */}
      <div className="analyse-row" style={{ alignItems: "start" }}>
        <Fade i={9}>
          <AnalyseSection
            title="Wird konsequent nachgefasst?"
            icon={AlarmClock}
            meta="je Stufe"
            collapsible
            defaultOpen={false}
            info={
              <span>
                &bdquo;Fällig gewesen&ldquo; sind die Kontakte, die die Vorstufe erreicht haben und danach noch im
                Flow waren. Wer geantwortet hat, einen Termin hat oder uns blockiert hat, steht bewusst nicht im
                Nenner — dort soll gar nicht mehr nachgefasst werden.
              </span>
            }
          >
            <MetricTable
              label="Stufe"
              columns={[
                { key: "due", label: "Fällig gewesen", format: "int" },
                { key: "sent", label: "Gesendet", format: "int" },
                { key: "rate", label: "Erledigt", format: "pct", emphasis: true },
                { key: "open", label: "Offen", format: "int" },
                { key: "overdue", label: "Überfällig", format: "int" },
              ]}
              rows={stageRows}
              minWidth={520}
            />
          </AnalyseSection>
        </Fade>
        {/* Bleibt auch bei einer Person stehen: „Anteil" und „Ø Verzug" stehen
            nirgends sonst im Tab — der Sektionskopf nennt nur die beiden
            Absolutwerte. Eine Zeile ist hier also kein Echo, sondern die
            einzige Stelle mit diesen Zahlen. */}
        <Fade i={10}>
          <AnalyseSection
            title="Wer hängt hinterher?"
            icon={Users}
            meta={`${INT.format(openFuTotal)} offen · ${INT.format(overdueFuTotal)} überfällig`}
            collapsible
            defaultOpen={false}
            info={
              <InfoBody>
                <span>
                  Momentaufnahme von heute über <B>alle</B> Pitches des Zeitraums — der Kohorten-Filter gilt hier
                  bewusst nicht: überfällig ist überfällig.
                </span>
                <span>
                  &bdquo;Ø Verzug&ldquo; sind Tage seit der Fälligkeit, gemittelt über die überfälligen Kontakte.
                  Eine Tages-Zeitreihe ist im Datenmodell nicht möglich — es gibt kein Ereignis-Log und keinen
                  Sendezeitpunkt je Follow-up.
                </span>
              </InfoBody>
            }
          >
            <MetricTable
              label="Person"
              columns={[
                { key: "open", label: "Offen", format: "int" },
                { key: "overdue", label: "Überfällig", format: "int", emphasis: true },
                { key: "overdueRate", label: "Anteil", format: "pct" },
                { key: "avgDelay", label: "Ø Verzug", format: "num1" },
              ]}
              rows={overdueRows}
              minWidth={460}
              emptyHint="Nichts offen — alle Follow-ups sind raus."
            />
          </AnalyseSection>
        </Fade>
      </div>

      {/* ══ 7 · Listen ══
          Startet zu: Das Listen-Ranking ist Textarbeit („welche Variante
          trägt?"), keine Zahl des Tages. Die Kopfzeile nennt weiterhin, wie
          viele Listen die Mindestmenge erreichen.

          Letzte Sektion des Tabs. Die frühere Nebenauswertung „Eigene
          Nachfass-Texte vs. Standard" darunter ist gestrichen: zwei Gruppen,
          die sich in Zielgruppe UND Zeitpunkt unterscheiden, ergeben keinen
          A/B-Test — das stand schon in ihrem eigenen Info-Text. Die einzige
          Handlung daraus („Liste X hat keine FU-Texte") steht als Chip
          P · 1 · 2 · 3 in dieser Tabelle, pro Liste statt als Sammelquote. */}
      <Fade i={11}>
        <AnalyseSection
          title="Listen im Vergleich"
          icon={ListOrdered}
          meta={`${qualified.length} von ${allLists.length} Listen · ab ${MIN_LIST_DMS} DMs · Spalte anklicken zum Sortieren`}
          collapsible
          defaultOpen={false}
          info={
            <InfoBody>
              <span>
                Eine Liste bündelt Pitch-Text und Nachfass-Sequenz — Listen zu vergleichen heißt, Textvarianten zu
                vergleichen. <B>P · 1 · 2 · 3</B> zeigt, welche Texte die Liste selbst hinterlegt hat; wo nichts
                steht, greift die Nutzer-Vorlage bzw. der Standardtext.
              </span>
              <span>
                <B>Termine</B> und <B>Umsatz</B> folgen hier der Pitch-Kohorte, nicht dem Buchungstag: Der Deal
                zählt bei der Liste, aus der der Lead stammt. Unter {MIN_LIST_DMS} DMs erscheint eine Liste nicht —
                darunter ist jede Quote Rauschen.
              </span>
            </InfoBody>
          }
        >
          <ListPerformanceTable rows={listRows} showOwner={canCompare} />
        </AnalyseSection>
      </Fade>
    </>
  );
}
