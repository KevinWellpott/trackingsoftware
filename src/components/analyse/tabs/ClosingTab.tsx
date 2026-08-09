import type { CSSProperties, ReactNode } from "react";
import {
  BarChart3, CalendarCheck, ChevronRight, CreditCard, Euro, Eye, FileSignature, Filter, PieChart,
  Receipt, Timer, TrendingUp, Trophy, Users, XCircle,
} from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { loadClosingCalls, loadSettingCalls, type AnalyseSettingCall } from "@/lib/analyseData";
import {
  NUM, bucketIndex, buildBuckets, bucketOf, closingEffDate, eur, fmtPct, pct, settingEffDate,
  type Granularity,
} from "@/lib/analyse";
import { channelLabel } from "@/lib/channels";
import { personIn } from "@/lib/personResolution";
import { AnalyseSection } from "@/components/analyse/AnalyseSection";
import { ComparisonTable, type ComparisonRow } from "@/components/analyse/ComparisonTable";
import { Footnote, MetricTable, StatRow, type MetricColumn, type MetricRow } from "@/components/analyse/AnalyseTables";
import { BucketBarChart } from "@/components/analyse/AnalyseCharts";
import { CumulativeProgressChart } from "@/components/analyse/CumulativeProgressChart";
import { DistBars, DonutChart, KpiHero, QuoteColumns, KpiRow } from "@/components/analyse/AnalyseViz";
import { CLOSING_LOST_REASON_CODES, CLOSING_LOST_REASON_LABELS } from "@/lib/types";

// Closing-Flow: Closing-Termine → Shows → Abschluss → Umsatz.
// Ein einziger Fetch deckt aktuelles UND Vorperioden-Fenster ab — der Split
// passiert in JS über closingEffDate.
//
// Oben stehen genau fünf Zahlen (Auftraggeber-Vorgabe): Termine, Show-Quote,
// Abschlussrate, Umsatz pro Meeting, Umsatz gesamt. Darunter die zwei Fragen,
// die daraus folgen — wer holt die Cash-Termine, und woran sterben die
// verlorenen Deals. Alles Weitere liegt eingeklappt unter „Mehr Auswertungen".
//
// Die Setting-Calls kommen mit dazu, aber nicht als Kennzahl: sie liefern die
// Herkunft (source_detail/source_type) und den Termin, gegen den die
// Abschluss-Geschwindigkeit gerechnet wird.
//
// Personenachse: `personIn` (Zuweisung vor Ersteller). Beim Closing wog der
// alte Weg über `created_by_user_id` besonders schwer — ein Closing entsteht
// nur über „Qualifiziert" im Setting und wurde damit faktisch immer von
// derselben Person angelegt.

type Member = { user_id: string; username: string };

// Sammelzeile für Closings, deren Person nicht (mehr) zur Organisation gehört.
// Wortgleich mit dem Übersichts-Tab, damit beide dieselbe Gesamtsumme zeigen.
const OHNE = "Ohne Zuordnung";

/** Verlorene Deals ohne gesetzten Code — ehrlicher als sie auf „Sonstiges" zu buchen. */
const LOST_UNSET = "__ohne";

type Totals = {
  closings: number;
  shows: number;
  won: number;
  lost: number;
  revenue: number;
};

const ZERO = (): Totals => ({ closings: 0, shows: 0, won: 0, lost: 0, revenue: 0 });

const INT = new Intl.NumberFormat("de-DE");

// Abschluss-Geschwindigkeit: Tage vom Setting-Termin bis zum Closing-Gespräch.
const SPEED_BOUNDS = [0, 2, 7, 14, 30] as const;
const SPEED_LABELS = ["Selber Tag", "1–2 Tage", "3–7 Tage", "8–14 Tage", "15–30 Tage", "> 30 Tage"];

// Deal-Größen in Euro.
const SIZE_BOUNDS = [2000, 5000, 10000, 25000] as const;
const SIZE_LABELS = ["≤ 2k", "2–5k", "5–10k", "10–25k", "> 25k"];

// ── Info-Texte ───────────────────────────────────────────────
// Die Methodik-Erklärungen standen bis hierher als Fußnote unter jeder
// Sektion und verlängerten sie dauerhaft um drei bis sechs Zeilen. Sie liegen
// jetzt hinter dem Info-Icon am Sektionstitel — dieselbe Information, aber
// dort abrufbar, wo die Frage entsteht.
//
// `InfoText` setzt nur die Absätze; Schriftgröße und Farbe bringt das Popover
// mit (InfoPopover). Der Abstand kommt über `gap`, damit der letzte Absatz
// unten keinen überzähligen Rand gegen die Polsterung des Popovers setzt.
function InfoText({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>{children}</div>;
}

const INFO_P: CSSProperties = { margin: 0 };
const INFO_STRONG: CSSProperties = { fontWeight: 600 };

/** %-Änderung vs. Vorperiode für Zähl-/EUR-KPIs; Vorwert 0 → null. */
function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

/** Prozentpunkt-Differenz zweier Quoten; fehlende Basis (null) → null. */
function ppDelta(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null) return null;
  return Math.round((cur - prev) * 10) / 10;
}

/** Umsatz je Closing-TERMIN — nicht je gewonnenem Deal (das ist der Ø-Deal). */
function revenuePerMeeting(revenue: number, closings: number): number | null {
  if (closings === 0) return null;
  return Math.round(revenue / closings);
}

/** "01.07. – 31.07." — Fußnote des Fortschritts-Charts. */
function rangeLabelOf(from: string, to: string): string {
  const d = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
  return `${d(from)} – ${d(to)}`;
}

// Kein `lost` mehr: Die Abschlussrate rechnet auch hier gegen die SHOWS, damit
// die Quelle-Tabelle und die KPI-Kachel dieselbe Zahl meinen.
type SourceCell = { closings: number; shows: number; won: number; revenue: number };
const ZERO_SOURCE = (): SourceCell => ({ closings: 0, shows: 0, won: 0, revenue: 0 });

/**
 * Quelle eines Closings — dieselbe Regel wie im Setting-Tab.
 *
 * `source_detail` hat Vorrang vor `source_type`: Der Freitext trägt den echten
 * Ursprung; ohne ihn fallen alle manuell gebuchten Termine in einen Sammeltopf,
 * der im Umsatz-Ranking regelmäßig die Top-Zeile ist und nichts erklärt.
 * Case-insensitiv normalisiert, angezeigt wird die zuerst gesehene Schreibweise.
 */
function sourceKeyOf(
  setting: AnalyseSettingCall | undefined,
): { key: string; label: string; channel: string | null } {
  if (!setting) return { key: "ohne", label: "Ohne Setting-Bezug", channel: null };
  const detail = (setting.source_detail ?? "").trim();
  if (detail) {
    return { key: `d:${detail.toLowerCase()}`, label: detail, channel: channelLabel(setting.source_type) };
  }
  return { key: `t:${setting.source_type ?? "sonstige"}`, label: channelLabel(setting.source_type), channel: null };
}

/**
 * Aufklappbarer Bereich für die Detail-Auswertungen.
 *
 * Der Auftraggeber wollte den zweiten Teil des Tabs „erstmal" weghaben — nicht
 * für immer. Ein `<details>` kostet nichts (kein State, kein Client-JS) und
 * hält die Rechenwege am Leben; sie zu löschen hieße, sie beim nächsten „doch
 * wieder" komplett neu zu bauen.
 */
function MoreAnalyses({ meta, children }: { meta: string; children: ReactNode }) {
  return (
    <details className="fade-up" style={{ animationDelay: "560ms" }}>
      <summary
        className="collapse-summary"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-4)",
          padding: "var(--sp-5) var(--sp-7)",
          cursor: "pointer",
          userSelect: "none",
          background: "var(--surface-1)",
        }}
      >
        <ChevronRight size={14} className="collapse-chevron" style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span className="eyebrow">Mehr Auswertungen</span>
        <span className="eyebrow eyebrow-muted" style={{ marginLeft: "auto" }}>
          {meta}
        </span>
      </summary>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>{children}</div>
    </details>
  );
}

export async function ClosingTab({
  access,
  from,
  to,
  prevFrom,
  prevTo,
  granularity,
  selectedMembers,
  canCompare,
  allSelected = false,
}: {
  access: AccessContext;
  from: string;
  to: string;
  selectedMembers: Member[];
  canCompare: boolean;
  prevFrom?: string;
  prevTo?: string;
  granularity?: Granularity;
  /**
   * `true`, wenn kein Personenfilter aktiv ist (alle Mitglieder ausgewählt).
   * Nur dann bekommen Closings ohne auflösbare Person eine „Ohne
   * Zuordnung"-Zeile; mit aktivem Filter wäre das ein Wiedereinschleusen
   * abgewählter Zeilen.
   */
  allSelected?: boolean;
}) {
  const supabase = await createClient();
  const hasPrev = Boolean(prevFrom && prevTo);

  const [allRows, settings] = await Promise.all([
    loadClosingCalls(supabase, access, canCompare),
    loadSettingCalls(supabase, access, canCompare),
  ]);
  const buckets = buildBuckets(from, to, granularity);

  // Setting-Index: Herkunft + Termin für Velocity und Quellen-Zuordnung.
  const settingById = new Map(settings.map((s) => [s.id, s]));

  const selectedIds = new Set(selectedMembers.map((m) => m.user_id));
  const nameById = new Map(selectedMembers.map((m) => [m.user_id, m.username]));

  const totals = new Map<string, Totals>();
  const revPerUser: Record<string, Record<string, number>> = {};
  // Lazy, weil "Ohne Zuordnung" erst entsteht, wenn eine solche Zeile auftaucht.
  const ensure = (name: string): Totals => {
    let t = totals.get(name);
    if (!t) {
      t = ZERO();
      totals.set(name, t);
      revPerUser[name] = {};
    }
    return t;
  };
  for (const m of selectedMembers) ensure(m.username);

  // Verlustgründe über den CODE (Migration 0029) statt über den Freitext:
  // „zu teuer", „Preis", „Budget nicht da" waren drei Balken mit je Häufigkeit
  // 1 — als Statistik unbrauchbar. Zusätzlich je Person, damit sichtbar wird,
  // an welchem Einwand WER hängenbleibt.
  const lostByCode = new Map<string, number>();
  const lostByCodePerson = new Map<string, Map<string, number>>();
  // Zahlungsarten gewonnener Deals: case-insensitiv dedupliziert,
  // erste Schreibweise gewinnt als Anzeige-Label.
  const paymentTypes = new Map<string, { label: string; value: number }>();
  const statusCounts = { offen: 0, gewonnen: 0, verloren: 0, nachfassen: 0 };

  // Zuwächse je Bucket für den Fortschritts-Chart (die Komponente kumuliert selbst).
  const closingsByBucket: Record<string, number> = {};
  const showsByBucket: Record<string, number> = {};
  const wonByBucket: Record<string, number> = {};
  const revenueByBucket: Record<string, number> = {};

  // Schnitte
  const speedCells = SPEED_LABELS.map(() => ({ n: 0, won: 0, lost: 0 }));
  let speedUnknown = 0;
  const sizeBins = SIZE_LABELS.map(() => ({ n: 0, revenue: 0 }));
  const sourceCells = new Map<string, SourceCell>();
  const sourceMeta = new Map<string, { label: string; channel: string | null }>();
  let signatureYes = 0;
  let signatureKnown = 0;
  const startLead: number[] = [];

  const prev = ZERO();

  for (const r of allRows) {
    const day = closingEffDate(r);

    // Zuweisung schlägt Ersteller. Kein Treffer heißt entweder "bewusst
    // abgewählt" (Personenfilter aktiv → raus) oder "Person gehört nicht mehr
    // zur Organisation" (kein Filter → sichtbar unter OHNE, statt Umsatz und
    // Gesamtsumme still zu kürzen).
    const uid = personIn(r, selectedIds);
    if (!uid && !allSelected) continue;
    const name = uid ? nameById.get(uid)! : OHNE;

    // ── Vorperioden-Fenster ────────────────────────────────────
    if (hasPrev && day >= prevFrom! && day <= prevTo!) {
      prev.closings += 1;
      if (r.show_status === "show") prev.shows += 1;
      if (r.status === "gewonnen") {
        prev.won += 1;
        prev.revenue += NUM(r.deal_volume);
      }
      if (r.status === "verloren") prev.lost += 1;
      continue;
    }

    // ── Aktuelles Fenster ──────────────────────────────────────
    if (day < from || day > to) continue;

    const t = ensure(name);
    t.closings += 1;
    if (r.show_status === "show") t.shows += 1;
    statusCounts[r.status] += 1;

    const bk = bucketOf(day, from, to, granularity);
    closingsByBucket[bk] = (closingsByBucket[bk] ?? 0) + 1;
    if (r.show_status === "show") showsByBucket[bk] = (showsByBucket[bk] ?? 0) + 1;

    // Herkunft über das zugehörige Setting.
    const setting = r.setting_call_id ? settingById.get(r.setting_call_id) : undefined;
    const srcKey = sourceKeyOf(setting);
    let src = sourceCells.get(srcKey.key);
    if (!src) {
      src = ZERO_SOURCE();
      sourceCells.set(srcKey.key, src);
      sourceMeta.set(srcKey.key, { label: srcKey.label, channel: srcKey.channel });
    }
    src.closings += 1;
    if (r.show_status === "show") src.shows += 1;

    // Abschluss-Geschwindigkeit: Setting-Termin → Closing-Gespräch.
    const settingDay = setting ? settingEffDate(setting) : null;
    if (settingDay && r.call_at) {
      const diff = Math.max(
        Math.round((new Date(`${day}T12:00:00Z`).getTime() - new Date(`${settingDay}T12:00:00Z`).getTime()) / 86400000),
        0,
      );
      const cell = speedCells[bucketIndex(diff, SPEED_BOUNDS)];
      cell.n += 1;
      if (r.status === "gewonnen") cell.won += 1;
      if (r.status === "verloren") cell.lost += 1;
    } else {
      speedUnknown += 1;
    }

    if (r.status === "gewonnen") {
      t.won += 1;
      const vol = NUM(r.deal_volume);
      t.revenue += vol;
      src.won += 1;
      src.revenue += vol;
      wonByBucket[bk] = (wonByBucket[bk] ?? 0) + 1;
      revPerUser[name][bk] = (revPerUser[name][bk] ?? 0) + vol;
      revenueByBucket[bk] = (revenueByBucket[bk] ?? 0) + vol;

      const bin = sizeBins[bucketIndex(vol, SIZE_BOUNDS)];
      bin.n += 1;
      bin.revenue += vol;

      if (r.signature_received !== null) {
        signatureKnown += 1;
        if (r.signature_received) signatureYes += 1;
      }
      const lead = r.contract_start
        ? Math.round((new Date(`${r.contract_start}T12:00:00Z`).getTime() - new Date(`${day}T12:00:00Z`).getTime()) / 86400000)
        : null;
      if (lead !== null) startLead.push(lead);

      const rawPayment = (r.payment_type ?? "").trim();
      const label = rawPayment || "Ohne Angabe";
      const key = label.toLowerCase();
      const entry = paymentTypes.get(key);
      if (entry) entry.value += 1;
      else paymentTypes.set(key, { label, value: 1 });
    }
    if (r.status === "verloren") {
      t.lost += 1;
      const code = r.lost_reason_code ?? LOST_UNSET;
      lostByCode.set(code, (lostByCode.get(code) ?? 0) + 1);
      let perPerson = lostByCodePerson.get(code);
      if (!perPerson) {
        perPerson = new Map<string, number>();
        lostByCodePerson.set(code, perPerson);
      }
      perPerson.set(name, (perPerson.get(name) ?? 0) + 1);
    }
  }

  const names = selectedMembers.map((m) => m.username);
  // Die OHNE-Zeile erscheint nur, wenn sie im Zeitraum wirklich etwas zählt.
  if ((totals.get(OHNE)?.closings ?? 0) > 0) names.push(OHNE);

  const sum = ZERO();
  for (const name of names) {
    const t = totals.get(name)!;
    sum.closings += t.closings;
    sum.shows += t.shows;
    sum.won += t.won;
    sum.lost += t.lost;
    sum.revenue += t.revenue;
  }

  // ── KPI-Werte + Deltas ───────────────────────────────────────
  // NEUER NENNER (Show-Quote): alle Closing-TERMINE, nicht nur die mit
  // gesetztem Erschienen-Feld. Vorher fielen Termine ohne Angabe komplett aus
  // der Rechnung — die Quote maß, wer das Häkchen gesetzt hat.
  const showRate = pct(sum.shows, sum.closings);
  // NEUER NENNER (Abschlussrate): die SHOWS. Vorher wurde gegen
  // „gewonnen + verloren" gerechnet; das wirft jeden noch offenen Deal aus dem
  // Nenner und schönt die Quote systematisch — ein Zeitraum ohne einen einzigen
  // Verlust stand auf 100 %, obwohl zehn Termine unentschieden lagen.
  const winRate = pct(sum.won, sum.shows);
  const revPerMeeting = revenuePerMeeting(sum.revenue, sum.closings);
  const avgDeal = sum.won === 0 ? null : Math.round(sum.revenue / sum.won);

  const prevShowRate = pct(prev.shows, prev.closings);
  const prevWinRate = pct(prev.won, prev.shows);
  const prevRevPerMeeting = revenuePerMeeting(prev.revenue, prev.closings);

  const closingsSpark = buckets.map((b) => closingsByBucket[b.key] ?? 0);
  const revenueSpark = buckets.map((b) => revenueByBucket[b.key] ?? 0);
  const medianStartLead =
    startLead.length === 0 ? null : [...startLead].sort((a, b) => a - b)[Math.floor(startLead.length / 2)];

  const tableRows: ComparisonRow[] = names.map((name) => {
    const t = totals.get(name)!;
    return {
      name,
      values: {
        closings: t.closings,
        showRate: pct(t.shows, t.closings),
        winRate: pct(t.won, t.shows),
        revPerMeeting: revenuePerMeeting(t.revenue, t.closings),
        revenue: t.revenue,
      },
    };
  });

  const average = {
    closings: sum.closings,
    showRate,
    winRate,
    revPerMeeting,
    revenue: sum.revenue,
  };

  // ── Win / Loss (Donut) ───────────────────────────────────────
  const winLossData = [
    { name: "Gewonnen", value: statusCounts.gewonnen, color: "var(--success)" },
    { name: "Verloren", value: statusCounts.verloren, color: "var(--danger)" },
    { name: "Nachfassen", value: statusCounts.nachfassen, color: "var(--warning)" },
    { name: "Offen", value: statusCounts.offen, color: "var(--viz-2)" },
  ].filter((d) => d.value > 0);

  // ── Verlustgründe: Rangliste + Matrix Kategorie × Person ─────
  const lostCodeLabel = (code: string): string =>
    code === LOST_UNSET
      ? "Ohne Angabe"
      : CLOSING_LOST_REASON_LABELS[code as keyof typeof CLOSING_LOST_REASON_LABELS] ?? code;

  // Reihenfolge: Häufigkeit zuerst — die Rangliste IST die Aussage.
  const lostCodesRanked = [...CLOSING_LOST_REASON_CODES, LOST_UNSET]
    .filter((code) => (lostByCode.get(code) ?? 0) > 0)
    .sort((a, b) => (lostByCode.get(b) ?? 0) - (lostByCode.get(a) ?? 0));

  const reasonItems = lostCodesRanked.map((code) => ({
    label: lostCodeLabel(code),
    value: lostByCode.get(code) ?? 0,
    color: "var(--danger)",
  }));

  // Personen als Spalten. Der Schlüssel trägt ein Präfix, damit ein Nutzername
  // wie „gesamt" nicht die Summenspalte überschreibt.
  const matrixColumns: MetricColumn[] = [
    ...names.map((name) => ({ key: `p:${name}`, label: name, format: "int" as const })),
    { key: "gesamt", label: "Gesamt", format: "int" as const, emphasis: true },
  ];
  const matrixRows: MetricRow[] = lostCodesRanked.map((code) => {
    const perPerson = lostByCodePerson.get(code);
    const values: Record<string, number | null> = { gesamt: lostByCode.get(code) ?? 0 };
    for (const name of names) values[`p:${name}`] = perPerson?.get(name) ?? 0;
    return {
      key: code,
      label: lostCodeLabel(code),
      share: sum.lost === 0 ? null : (lostByCode.get(code) ?? 0) / sum.lost,
      color: "var(--danger)",
      values,
    };
  });
  const matrixTotal: Record<string, number> = { gesamt: sum.lost };
  for (const name of names) matrixTotal[`p:${name}`] = totals.get(name)!.lost;

  // ── Quelle ───────────────────────────────────────────────────
  const sourceRows: MetricRow[] = [...sourceCells.entries()]
    .filter(([, c]) => c.closings > 0)
    .sort((a, b) => b[1].revenue - a[1].revenue || b[1].closings - a[1].closings)
    .map(([key, c]) => {
      const meta = sourceMeta.get(key)!;
      return {
        key,
        label: meta.label,
        sub: meta.channel,
        share: sum.closings === 0 ? null : c.closings / sum.closings,
        values: {
          closings: c.closings,
          showRate: pct(c.shows, c.closings),
          winRate: pct(c.won, c.shows),
          revPerMeeting: revenuePerMeeting(c.revenue, c.closings),
          revenue: c.revenue,
        },
      };
    });

  const sizeRows: MetricRow[] = SIZE_LABELS.map((label, i) => ({
    key: label,
    label,
    share: sum.won === 0 ? null : sizeBins[i].n / sum.won,
    values: {
      n: sizeBins[i].n,
      anteil: pct(sizeBins[i].n, sum.won),
      revenue: sizeBins[i].revenue,
      revenueShare: pct(sizeBins[i].revenue, sum.revenue),
    },
  })).filter((r) => (r.values.n as number) > 0);

  const paymentItems = [...paymentTypes.values()]
    .sort((a, b) => b.value - a.value)
    .map((p) => ({ label: p.label, value: p.value, color: "var(--viz-1)" }));

  return (
    <>
      {/* ── KPI-Heroes: die fünf Zahlen des Closing-Flows ──────── */}
      <KpiRow>
        <KpiHero
          label="Closing-Termine"
          value={sum.closings}
          format="int"
          delta={pctChange(sum.closings, prev.closings)}
          spark={closingsSpark}
          icon={<CalendarCheck size={15} />}
          index={0}
        />
        <KpiHero
          label="Show-Quote"
          value={showRate}
          format="pct"
          delta={ppDelta(showRate, prevShowRate)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<Eye size={15} />}
          index={1}
        />
        <KpiHero
          label="Abschlussrate"
          value={winRate}
          format="pct"
          delta={ppDelta(winRate, prevWinRate)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<Trophy size={15} />}
          index={2}
        />
        <KpiHero
          label="Umsatz pro Meeting"
          value={revPerMeeting}
          format="eur"
          delta={
            revPerMeeting === null || prevRevPerMeeting === null
              ? null
              : pctChange(revPerMeeting, prevRevPerMeeting)
          }
          icon={<Receipt size={15} />}
          index={3}
        />
        <KpiHero
          label="Umsatz"
          value={sum.revenue}
          format="eur"
          delta={pctChange(sum.revenue, prev.revenue)}
          spark={revenueSpark}
          tone="success"
          icon={<Euro size={15} />}
          index={4}
        />
      </KpiRow>

      {/* ── Vergleich ──────────────────────────────────────────────
             NICHT zuklappbar: Zusammen mit der KPI-Reihe darüber ist das die
             Kernaussage des Tabs. Wer sie wegklappen könnte, hätte eine leere
             Seite — und das ist keine Übersichtlichkeit. */}
      <div className="fade-up" style={{ animationDelay: "240ms" }}>
        <AnalyseSection
          title="Vergleich"
          icon={Filter}
          meta="Termine · Show · Abschluss · Umsatz"
          info={
            <InfoText>
              <p style={INFO_P}>
                <strong style={INFO_STRONG}>Show-Quote</strong> = erschienen ÷ ALLE Closing-Termine. Termine
                ohne gesetztes Erschienen-Feld fallen damit nicht mehr aus der Rechnung — vorher maß die Quote,
                wer das Häkchen gesetzt hat.
              </p>
              <p style={INFO_P}>
                <strong style={INFO_STRONG}>Abschlussrate</strong> = gewonnen ÷ erschienen. Ein noch offener
                Deal drückt die Quote, statt aus dem Nenner zu fallen: Die frühere Rechnung gegen
                &bdquo;gewonnen + verloren&ldquo; stand in einem Zeitraum ohne einen einzigen Verlust auf 100 %,
                obwohl zehn Termine unentschieden lagen.
              </p>
              <p style={INFO_P}>
                <strong style={INFO_STRONG}>Umsatz/Meeting</strong> = Umsatz ÷ Closing-Termine, also je
                gebuchtem Gespräch. Der Umsatz je <em>gewonnenem</em> Deal ist der Ø-Deal unter
                &bdquo;Mehr Auswertungen&ldquo;.
              </p>
            </InfoText>
          }
        >
          <ComparisonTable
            columns={[
              { key: "closings", label: "Closings", format: "int" },
              { key: "showRate", label: "Show-Quote", format: "pct", deltaVsAvg: true },
              { key: "winRate", label: "Abschlussrate", format: "pct", deltaVsAvg: true },
              { key: "revPerMeeting", label: "Umsatz/Meeting", format: "eur" },
              { key: "revenue", label: "Umsatz", format: "eur" },
            ]}
            rows={tableRows}
            average={average}
            averageLabel="Gesamt"
          />
          {/* Bleibt als Fußnote stehen (statt hinter dem Info-Icon zu
              verschwinden): Sie qualifiziert den ANGEZEIGTEN Wert. Ohne sie
              liest man die Show-Quote nahe 100 % als Erfolg, obwohl sie
              schlicht abgeleitet wurde. */}
          <Footnote>
            &bdquo;Erschienen&ldquo; wird beim Erfassen eines Ergebnisses automatisch gesetzt und wurde für
            Bestandsdaten nachgetragen — die Show-Quote steht deshalb nahe 100 % und wird erst mit neu erfassten
            No-Shows aussagekräftig.
          </Footnote>
        </AnalyseSection>
      </div>

      {/* ── Fortschritt ────────────────────────────────────────────
             Startet zugeklappt: ein Verlaufs-Chart beantwortet keine Frage,
             die man beim Öffnen der Seite stellt — er beantwortet die zweite. */}
      <div className="fade-up" style={{ animationDelay: "280ms" }}>
        <AnalyseSection
          title="Fortschritt im Zeitraum"
          icon={TrendingUp}
          meta="kumuliert"
          collapsible
          defaultOpen={false}
          info={
            <InfoText>
              <p style={INFO_P}>
                Die Kurven kumulieren über den Zeitraum: Sie steigen, solange etwas dazukommt, und laufen flach,
                wenn nichts passiert.
              </p>
              <p style={INFO_P}>
                Der Umsatz fehlt hier bewusst — Euro und Stückzahlen auf einer Achse machen jede Mengenkurve
                platt. Der Umsatzverlauf steht unter &bdquo;Mehr Auswertungen&ldquo;.
              </p>
            </InfoText>
          }
        >
          <CumulativeProgressChart
            buckets={buckets}
            series={[
              { key: "closings", label: "Closings", kind: "count", values: closingsByBucket, defaultOn: true },
              { key: "shows", label: "Shows", kind: "count", values: showsByBucket, defaultOn: true },
              { key: "won", label: "Gewonnen", kind: "count", values: wonByBucket, defaultOn: true },
              {
                key: "winRate",
                label: "Abschlussrate",
                kind: "rate",
                values: wonByBucket,
                denominator: showsByBucket,
              },
            ]}
            rangeLabel={rangeLabelOf(from, to)}
          />
        </AnalyseSection>
      </div>

      {/* ── Herkunft ───────────────────────────────────────────────
             Startet offen: die Tabelle beantwortet die zweite Frage des Tabs
             („woher kommt der Umsatz") und besteht aus Zahlen, nicht aus
             einem Bild, das man ohnehin nur überfliegt. */}
      <div className="fade-up" style={{ animationDelay: "340ms" }}>
        <AnalyseSection
          title="Welche Quelle schließt am besten ab?"
          icon={TrendingUp}
          meta="Closings nach Herkunft des Termins"
          collapsible
          info={
            <InfoText>
              <p style={INFO_P}>
                Die Herkunft kommt vom verknüpften Setting (<code>setting_call_id</code>) und wird nach{" "}
                <code>source_detail</code> aufgeschlüsselt, wo ein Freitext-Ursprung hinterlegt ist — sonst nach
                dem Kanal.
              </p>
              <p style={INFO_P}>
                Ein Closing ohne diese Verknüpfung steht in &bdquo;Ohne Setting-Bezug&ldquo;: kein Fehler,
                sondern ein direkt angelegtes oder beim Organisations-Umzug gekapptes Closing.
              </p>
            </InfoText>
          }
        >
          <MetricTable
            label="Quelle"
            columns={[
              { key: "closings", label: "Closings", format: "int" },
              { key: "showRate", label: "Show-Quote", format: "pct" },
              { key: "winRate", label: "Abschlussrate", format: "pct", emphasis: true },
              { key: "revPerMeeting", label: "Umsatz/Meeting", format: "eur" },
              { key: "revenue", label: "Umsatz", format: "eur" },
            ]}
            rows={sourceRows}
            total={{
              closings: sum.closings,
              showRate,
              winRate,
              revPerMeeting,
              revenue: sum.revenue,
            }}
            minWidth={640}
            emptyHint="Im Zeitraum keine Closings erfasst."
          />
        </AnalyseSection>
      </div>

      {/* ── Verlustgründe ──────────────────────────────────────────
             Beide starten offen, und zwar GEMEINSAM: Die zwei Karten stehen in
             einem Raster nebeneinander und werden auf gleiche Höhe gezogen —
             eine offene neben einer geschlossenen ergäbe eine leere Karte.
             Offen, weil „woran sterben die Deals" die dritte Frage des Tabs
             ist und der Auftraggeber sie ausdrücklich sichtbar behalten wollte. */}
      <div className="analyse-row">
        <div className="fade-up" style={{ display: "grid", animationDelay: "400ms" }}>
          <AnalyseSection
            title="Top-Einwände"
            icon={XCircle}
            meta={`${INT.format(sum.lost)} verloren`}
            collapsible
            info={
              <InfoText>
                <p style={INFO_P}>
                  Gezählt wird der codierte Verlustgrund, nicht der Freitext daneben: Als Freitext hatte jeder
                  Grund die Häufigkeit 1 — &bdquo;zu teuer&ldquo;, &bdquo;Preis&ldquo; und &bdquo;Budget nicht
                  da&ldquo; waren drei Balken.
                </p>
              </InfoText>
            }
          >
            <DistBars items={reasonItems} />
            {/* Bleibt als Fußnote stehen: Sie qualifiziert den angezeigten
                Balken selbst. Ohne sie liest man „Sonstiges ist der häufigste
                Einwand" als Befund statt als Altlast. */}
            <Footnote>
              Bestandsdaten stehen alle auf &bdquo;Sonstiges&ldquo; — der Balken ist entsprechend aufgebläht,
              bis die betroffenen Closings von Hand nachgepflegt sind.
            </Footnote>
          </AnalyseSection>
        </div>
        <div className="fade-up" style={{ display: "grid", animationDelay: "440ms" }}>
          <AnalyseSection
            title="Einwand × Person"
            icon={Users}
            meta="woran hängt wer?"
            collapsible
            info={
              <InfoText>
                <p style={INFO_P}>
                  &bdquo;Falsche Zielgruppe&ldquo; ist der einzige Grund, der nicht das Closing bewertet,
                  sondern das Setting davor: Häuft er sich bei einer Person, wird dort falsch qualifiziert —
                  nicht schlecht abgeschlossen.
                </p>
              </InfoText>
            }
          >
            <MetricTable
              label="Einwand"
              columns={matrixColumns}
              rows={matrixRows}
              total={matrixTotal}
              minWidth={320 + names.length * 110}
              emptyHint="Im Zeitraum keine verlorenen Deals."
            />
          </AnalyseSection>
        </div>
      </div>

      {/* ── Alles Weitere: eingeklappt ──────────────────────────
             Auftraggeber: „rest kann raus erstmal, unnötig". Das „erstmal"
             ist der Grund, warum es hier steht statt gelöscht zu sein. */}
      <MoreAnalyses meta="Umsatzverlauf · Win/Loss · Geschwindigkeit · Deal-Größen · Vertrag · Zahlungsarten">
        <div className="analyse-row" data-split="chart">
          <AnalyseSection
            title="Umsatz im Verlauf"
            icon={BarChart3}
            meta="Umsatz (EUR) aus gewonnenen Deals"
            collapsible
          >
            <BucketBarChart buckets={buckets} perUser={revPerUser} />
          </AnalyseSection>
          <AnalyseSection
            title="Win / Loss"
            icon={PieChart}
            meta={`${INT.format(sum.closings)} Closings`}
            collapsible
          >
            <DonutChart data={winLossData} centerLabel={fmtPct(winRate)} centerSub="Abschlussrate" />
          </AnalyseSection>
        </div>

        <div className="analyse-row">
          <div style={{ display: "grid" }}>
            <AnalyseSection
              title="Wie lange dauert der Abschluss?"
              icon={Timer}
              meta={speedUnknown > 0 ? `${INT.format(speedUnknown)} ohne Setting-Bezug` : "Balken = Closings, Zeile = Win-Rate"}
              collapsible
              info={
                <InfoText>
                  <p style={INFO_P}>
                    Tage zwischen Setting-Termin und Abschlussgespräch. Ein Deal, der lange liegt, wird selten
                    besser — die Win-Rate in den hinteren Blöcken zeigt, ab wann Nachfassen sich nicht mehr
                    lohnt.
                  </p>
                  <p style={INFO_P}>
                    Die Win-Rate rechnet hier gegen entschiedene Deals (gewonnen + verloren), weil ein noch
                    offener Deal über seine endgültige Dauer nichts aussagt. Sie ist damit ein anderer Nenner
                    als bei der KPI-Kachel oben.
                  </p>
                </InfoText>
              }
            >
              <QuoteColumns
                perDay={SPEED_LABELS.map((label, i) => ({
                  label,
                  n: speedCells[i].n,
                  quote: pct(speedCells[i].won, speedCells[i].won + speedCells[i].lost),
                }))}
                quoteLabel="Win-Rate"
              />
            </AnalyseSection>
          </div>
          <div style={{ display: "grid" }}>
            <AnalyseSection
              title="Deal-Größen"
              icon={Receipt}
              meta={`${INT.format(sum.won)} gewonnene Deals`}
              collapsible
            >
              <MetricTable
                label="Größe"
                columns={[
                  { key: "n", label: "Deals", format: "int" },
                  { key: "anteil", label: "Anteil", format: "pct" },
                  { key: "revenue", label: "Umsatz", format: "eur", emphasis: true },
                  { key: "revenueShare", label: "Umsatzanteil", format: "pct" },
                ]}
                rows={sizeRows}
                minWidth={420}
                emptyHint="Noch keine gewonnenen Deals im Zeitraum."
              />
            </AnalyseSection>
          </div>
        </div>

        <AnalyseSection
          title="Vertrag & Abwicklung"
          icon={FileSignature}
          meta="nach gewonnenem Abschluss"
          collapsible
          info={
            <InfoText>
              <p style={INFO_P}>
                &bdquo;Unterschrift erhalten&ldquo; rechnet nur über die Deals, bei denen das Feld überhaupt
                gesetzt wurde — die Zahl daneben nennt, wie viele das sind.
              </p>
              <p style={INFO_P}>
                Der Ø-Deal ist der Umsatz je <strong style={INFO_STRONG}>gewonnenem</strong> Deal und damit
                bewusst etwas anderes als die KPI-Kachel &bdquo;Umsatz pro Meeting&ldquo; oben, die je Termin
                rechnet.
              </p>
            </InfoText>
          }
        >
          <StatRow
            items={[
              {
                label: "Unterschrift erhalten",
                value: signatureKnown === 0 ? "—" : fmtPct(pct(signatureYes, signatureKnown)),
                tone: signatureKnown > 0 && signatureYes === signatureKnown ? "success" : "default",
              },
              { label: "davon erfasst", value: `${INT.format(signatureKnown)} von ${INT.format(sum.won)}` },
              {
                label: "Vertragsstart (Median)",
                value: medianStartLead === null ? "—" : `${medianStartLead} Tage nach Abschluss`,
              },
              // Ø-Deal = Umsatz je GEWONNENEM Deal — bewusst nicht in den
              // KPI-Kacheln: dort steht „Umsatz pro Meeting" (je Termin).
              { label: "Ø-Deal (je gewonnenem Deal)", value: avgDeal === null ? "—" : eur(avgDeal) },
            ]}
          />
        </AnalyseSection>

        <AnalyseSection
          title="Zahlungsarten"
          icon={CreditCard}
          meta={`${INT.format(sum.won)} gewonnen`}
          collapsible
          info={
            <InfoText>
              <p style={INFO_P}>
                <code>payment_type</code> ist ein Freitextfeld; gleiche Schreibweisen werden ohne Rücksicht auf
                Groß-/Kleinschreibung zusammengefasst, angezeigt wird die zuerst gesehene. Gewonnene Deals ohne
                Eintrag stehen unter &bdquo;Ohne Angabe&ldquo;.
              </p>
            </InfoText>
          }
        >
          <DistBars items={paymentItems} />
        </AnalyseSection>
      </MoreAnalyses>
    </>
  );
}
