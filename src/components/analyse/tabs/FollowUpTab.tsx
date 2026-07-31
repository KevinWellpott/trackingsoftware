import {
  AlarmClock, Layers, MessageSquare, PieChart, Repeat, Sparkles, Target, TrendingUp, Users,
} from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { loadContacts, contactDay, type AnalyseContact } from "@/lib/analyseData";
import {
  FU_MATURITY_DAYS, FU_STAGE_LABELS, SENTIMENT_META, ZERO_SENTIMENT,
  addSentiment, buildFuCascade, fuStage, ownerKey, pct, type ReifeKey, type SentimentCounts,
} from "@/lib/analyse";
import { addDaysISO } from "@/lib/dates";
import { AnalyseSection } from "@/components/analyse/AnalyseSection";
import { ComparisonTable, type ComparisonRow } from "@/components/analyse/ComparisonTable";
import { Footnote, MetricTable, ShareBar, ShareLegend, type MetricRow } from "@/components/analyse/AnalyseTables";
import { BarFunnel, DonutChart, KpiHero, KpiRow } from "@/components/analyse/AnalyseViz";
import { VIZ_RAMP } from "@/lib/viz";

// Follow-up-Kaskade: Was bringt welche Nachfass-Stufe?
//
// Datenlage: `contacts` speichert nur den STAND (zuletzt gesendete Stufe,
// geantwortet ja/nein), kein Ereignis-Log je Follow-up und kein `answered_at`.
// Weil der Flow das Nachfassen bei einer Antwort stoppt, ist die Stufe eines
// beantworteten Kontakts zugleich die Stufe, auf der die Antwort kam — das ist
// die Zuordnung, auf der dieser Tab beruht. Sie ist exakt, solange niemand nach
// einer Antwort noch von Hand weiter-nachfasst.

type Member = { user_id: string; username: string };

const OHNE = "Ohne Zuordnung";
const INT = new Intl.NumberFormat("de-DE");

/**
 * Stufenfarbe: eine Hue in Helligkeitsstufen, Pitch hell → FU3 tief. Bewusst
 * nur die oberen vier Rampenstufen — VIZ_RAMP[0]/[1] sind auf dem dunklen
 * Canvas praktisch unsichtbar (gleiche Wahl wie FUNNEL_STEPS in AnalyseViz).
 */
function stageColor(stage: number): string {
  return VIZ_RAMP[5 - Math.min(stage, 3)];
}

/** %-Änderung vs. Vorperiode; Vorwert 0 → null. */
function deltaPct(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

function ppDelta(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null) return null;
  return Math.round((cur - prev) * 10) / 10;
}

type PersonAgg = {
  pitches: number;
  withFu: number;
  stageSum: number;
  directAnswers: number;
  fuAnswers: number;
  appts: number;
};

const ZERO_PERSON = (): PersonAgg => ({
  pitches: 0, withFu: 0, stageSum: 0, directAnswers: 0, fuAnswers: 0, appts: 0,
});

export async function FollowUpTab({
  access,
  from,
  to,
  prevFrom,
  prevTo,
  today,
  selectedMembers,
  canCompare,
  allSelected,
  reife,
}: {
  access: AccessContext;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  today: string;
  selectedMembers: Member[];
  canCompare: boolean;
  allSelected: boolean;
  reife: ReifeKey;
}) {
  const supabase = await createClient();

  // Vorperiode kommt aus einem zweiten Fetch — der Kontakt-Zuschnitt hängt am
  // Pitch-Tag, und den filtert schon die Query.
  const [curRaw, prevRaw] = await Promise.all([
    loadContacts(supabase, access, canCompare, from, to),
    loadContacts(supabase, access, canCompare, prevFrom, prevTo),
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

  // Reife-Schnitt: ein vorgestern gepitchter Kontakt KANN keine FU3-Antwort
  // haben und drückt sonst jede Stufenquote. Der Schnitt lässt nur Kontakte zu,
  // deren Sequenz rechnerisch durchlaufen sein könnte.
  const matureBefore = addDaysISO(today, -FU_MATURITY_DAYS);
  const inCohort = (c: AnalyseContact) => reife === "alle" || contactDay(c) <= matureBefore;

  const contacts = curRaw.filter((c) => ownerOf(c) !== null && inCohort(c));
  const prevContacts = prevRaw.filter((c) => ownerOf(c) !== null && inCohort(c));

  // ── Kaskade ──────────────────────────────────────────────────
  const cascade = buildFuCascade(contacts);
  const prevCascade = buildFuCascade(prevContacts);
  const pitches = cascade[0].reached;
  const prevPitches = prevCascade[0].reached;

  const totalAnswers = cascade.reduce((s, r) => s + r.answers, 0);
  const prevAnswers = prevCascade.reduce((s, r) => s + r.answers, 0);
  const answerRate = pct(totalAnswers, pitches);
  const prevAnswerRate = pct(prevAnswers, prevPitches);

  const directRate = cascade[0].rate;
  const prevDirectRate = prevCascade[0].rate;
  const fuAnswers = totalAnswers - cascade[0].answers;
  const fuLift = pct(fuAnswers, pitches);
  const prevFuLift = pct(prevAnswers - prevCascade[0].answers, prevPitches);

  const coverage = cascade[1].coverage;
  const prevCoverage = prevCascade[1].coverage;

  const stageSum = contacts.reduce((s, c) => s + fuStage(c.follow_up_number), 0);
  const avgStage = pitches === 0 ? null : Math.round((stageSum / pitches) * 10) / 10;

  const cascadeRows: MetricRow[] = cascade.map((r) => ({
    key: r.label,
    label: r.label,
    sub: r.stage === 0 ? "ohne Nachfassen" : `nach ${r.stage}. Nachfassen`,
    share: pitches === 0 ? null : r.reached / pitches,
    color: stageColor(r.stage),
    values: {
      reached: r.reached,
      coverage: r.coverage,
      answers: r.answers,
      rate: r.rate,
      cumRate: r.cumRate,
      appts: r.appts,
      apptRate: r.apptRate,
    },
  }));

  // ── Stimmung je Stufe ────────────────────────────────────────
  const sentimentByStage: SentimentCounts[] = [ZERO_SENTIMENT(), ZERO_SENTIMENT(), ZERO_SENTIMENT(), ZERO_SENTIMENT()];
  const sentimentTotal = ZERO_SENTIMENT();
  for (const c of contacts) {
    if (c.answered !== true) continue;
    const s = fuStage(c.follow_up_number);
    addSentiment(sentimentByStage[s], c.answer_category);
    addSentiment(sentimentTotal, c.answer_category);
  }
  const kategorisiert = sentimentTotal.positiv + sentimentTotal.neutral + sentimentTotal.negativ;
  const positiveShare = pct(sentimentTotal.positiv, kategorisiert);

  // ── Antworten nach Stufe (Donut) ─────────────────────────────
  const answerOrigin = cascade
    .filter((r) => r.answers > 0)
    .map((r) => ({ name: r.label, value: r.answers, color: stageColor(r.stage) }));

  // ── Offene Pipeline je Stufe ─────────────────────────────────
  const soon = addDaysISO(today, 3);
  const open = [0, 0, 0, 0];
  const overdue = [0, 0, 0, 0];
  const dueSoon = [0, 0, 0, 0];
  const blocked = [0, 0, 0, 0];
  let ausgereizt = 0;
  for (const c of contacts) {
    const s = fuStage(c.follow_up_number);
    if (c.blocked_at) {
      blocked[s] += 1;
      continue;
    }
    if (c.answered === true || c.appointment_set === true) continue;
    if (s === 3) {
      ausgereizt += 1;
      continue;
    }
    open[s] += 1;
    const due = c.next_follow_up_at;
    if (due) {
      if (due < today) overdue[s] += 1;
      else if (due <= soon) dueSoon[s] += 1;
    }
  }
  const pipelineRows: MetricRow[] = FU_STAGE_LABELS.slice(0, 3).map((label, s) => ({
    key: label,
    label: `steht auf ${label}`,
    sub: `nächstes Nachfassen: FU${s + 1}`,
    values: { open: open[s], overdue: overdue[s], dueSoon: dueSoon[s], blocked: blocked[s] },
  }));
  const openTotal = open.reduce((a, b) => a + b, 0);
  const overdueTotal = overdue.reduce((a, b) => a + b, 0);

  // ── Je Person ────────────────────────────────────────────────
  const perPerson = new Map<string, PersonAgg>();
  for (const m of selectedMembers) perPerson.set(m.username, ZERO_PERSON());
  for (const c of contacts) {
    const name = ownerOf(c)!;
    let agg = perPerson.get(name);
    if (!agg) {
      agg = ZERO_PERSON();
      perPerson.set(name, agg);
    }
    const s = fuStage(c.follow_up_number);
    agg.pitches += 1;
    agg.stageSum += s;
    if (s >= 1) agg.withFu += 1;
    if (c.answered === true) {
      if (s === 0) agg.directAnswers += 1;
      else agg.fuAnswers += 1;
    }
    if (c.appointment_set === true) agg.appts += 1;
  }
  const personNames = selectedMembers.map((m) => m.username);
  const ohne = perPerson.get(OHNE);
  if (ohne && ohne.pitches > 0) personNames.push(OHNE);

  const personRows: ComparisonRow[] = personNames.map((name) => {
    const a = perPerson.get(name) ?? ZERO_PERSON();
    return {
      name,
      values: {
        pitches: a.pitches,
        fuQuote: pct(a.withFu, a.pitches),
        avgStage: a.pitches === 0 ? null : Math.round((a.stageSum / a.pitches) * 10) / 10,
        directRate: pct(a.directAnswers, a.pitches),
        fuLift: pct(a.fuAnswers, a.pitches),
        answerRate: pct(a.directAnswers + a.fuAnswers, a.pitches),
        appts: a.appts,
      },
    };
  });

  const personAverage = {
    pitches,
    fuQuote: coverage,
    avgStage,
    directRate,
    fuLift,
    answerRate,
    appts: cascade.reduce((s, r) => s + r.appts, 0),
  };

  const reifeNote =
    reife === "reif"
      ? `nur Pitches bis ${matureBefore} (Sequenz konnte durchlaufen)`
      : "alle Pitches im Zeitraum";

  return (
    <>
      {/* ══ 1 · KPI-Reihe ══ */}
      <KpiRow>
        <KpiHero
          label="Pitches"
          value={pitches}
          delta={deltaPct(pitches, prevPitches)}
          icon={<MessageSquare size={15} />}
          index={0}
        />
        <KpiHero
          label="Antwortquote"
          value={answerRate}
          format="pct"
          delta={ppDelta(answerRate, prevAnswerRate)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<TrendingUp size={15} />}
          index={1}
        />
        <KpiHero
          label="Direkt auf den Pitch"
          value={directRate}
          format="pct"
          delta={ppDelta(directRate, prevDirectRate)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<Target size={15} />}
          index={2}
        />
        <KpiHero
          label="Zusatz durch Nachfassen"
          value={fuLift}
          format="pct"
          delta={ppDelta(fuLift, prevFuLift)}
          deltaLabel="vs. Vorperiode (pp)"
          tone={fuLift !== null && fuLift > 0 ? "success" : "default"}
          icon={<Sparkles size={15} />}
          index={3}
        />
        <KpiHero
          label="Nachgefasst"
          value={coverage}
          format="pct"
          delta={ppDelta(coverage, prevCoverage)}
          deltaLabel="vs. Vorperiode (pp)"
          icon={<Repeat size={15} />}
          index={4}
        />
        <KpiHero label="Ø Stufe" value={avgStage} format="num1" icon={<Layers size={15} />} index={5} />
      </KpiRow>

      {/* ══ 2 · Kaskade ══ */}
      <div className="fade-up" style={{ animationDelay: "240ms" }}>
        <AnalyseSection
          title="Was bringt welches Follow-up?"
          icon={Layers}
          meta={`${INT.format(pitches)} Pitches · ${reifeNote}`}
        >
          <MetricTable
            label="Stufe"
            columns={[
              { key: "reached", label: "Erreicht", format: "int" },
              { key: "coverage", label: "Anteil", format: "pct" },
              { key: "answers", label: "Antworten", format: "int" },
              { key: "rate", label: "Antwortquote", format: "pct", emphasis: true },
              { key: "cumRate", label: "Kumuliert", format: "pct" },
              { key: "appts", label: "Termine", format: "int" },
              { key: "apptRate", label: "Terminquote", format: "pct" },
            ]}
            rows={cascadeRows}
            total={{
              reached: pitches,
              coverage: null,
              answers: totalAnswers,
              rate: answerRate,
              cumRate: answerRate,
              appts: personAverage.appts,
              apptRate: pct(personAverage.appts, pitches),
            }}
          />
          <Footnote>
            <strong>Antwortquote</strong> = Antworten, die genau auf dieser Stufe kamen, geteilt durch die Kontakte,
            die die Stufe erreicht haben — also der Zusatzertrag genau dieses Schrittes.
            <strong> Kumuliert</strong> rechnet alle Antworten bis hierher gegen alle Pitches.
            Zuordnung über die zuletzt gesendete Stufe: `contacts` führt kein Ereignis-Log je Follow-up.
            {reife === "alle" && " Junge Pitches sind mitgezählt — sie können späte Stufen noch gar nicht erreicht haben."}
          </Footnote>
        </AnalyseSection>
      </div>

      {/* ══ 3 · Trichter + Herkunft der Antworten ══ */}
      <div className="analyse-row" data-split="wide-left">
        <div className="fade-up" style={{ display: "grid", animationDelay: "300ms" }}>
          <AnalyseSection title="Wie weit kommt die Sequenz?" icon={Layers} meta="Kontakte je erreichter Stufe">
            <BarFunnel stages={cascade.map((r) => ({ label: r.label, value: r.reached }))} />
          </AnalyseSection>
        </div>
        <div className="fade-up" style={{ display: "grid", animationDelay: "360ms" }}>
          <AnalyseSection title="Woher kommen die Antworten?" icon={PieChart} meta={`${INT.format(totalAnswers)} Antworten`}>
            <DonutChart
              data={answerOrigin}
              centerLabel={INT.format(totalAnswers)}
              centerSub="Antworten"
            />
          </AnalyseSection>
        </div>
      </div>

      {/* ══ 4 · Stimmung je Stufe ══ */}
      <div className="fade-up" style={{ animationDelay: "420ms" }}>
        <AnalyseSection
          title="Stimmung der Antworten je Stufe"
          icon={Sparkles}
          meta={positiveShare === null ? "keine Kategorien" : `${INT.format(kategorisiert)} kategorisiert`}
        >
          {/* Eine Legende für alle vier Balken — die Zahlen stehen je Balken in
              der Kopfzeile, eine Legende mit Werten EINER Stufe wäre irreführend. */}
          <div style={{ marginBottom: "var(--sp-6)" }}>
            <ShareLegend
              segments={SENTIMENT_META.map((m) => ({ label: m.label, value: 0, color: m.color }))}
              withValues={false}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-7)" }}>
            {cascade.map((r, i) => {
              const s = sentimentByStage[i];
              const cat = s.positiv + s.neutral + s.negativ;
              return (
                <ShareBar
                  key={r.label}
                  showLegend={false}
                  caption={
                    <>
                      <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{r.label}</span>
                      <span>
                        {INT.format(r.answers)} Antworten
                        {s.offen > 0 && ` · ${INT.format(s.offen)} ohne Kategorie`}
                        {cat > 0 && ` · ${Math.round((s.positiv / cat) * 100)} % positiv`}
                      </span>
                    </>
                  }
                  segments={SENTIMENT_META.map((m) => ({ label: m.label, value: s[m.key], color: m.color }))}
                />
              );
            })}
          </div>
          <Footnote>
            Grundlage ist <code>contacts.answer_category</code>. Alt-Kategorien werden auf dieselben drei Töpfe
            gemappt (Interessiert → Positiv, Falsches Timing → Neutral, Kein Interesse / Zu teuer / Kein Budget /
            Bereits Lösung / Falsche Zielgruppe → Negativ), damit Zeiträume über den Kategorie-Wechsel hinweg
            vergleichbar bleiben.
          </Footnote>
        </AnalyseSection>
      </div>

      {/* ══ 5 · Je Person ══ */}
      {canCompare && (
        <div className="fade-up" style={{ animationDelay: "480ms" }}>
          <AnalyseSection title="Wer fasst wie konsequent nach?" icon={Users} meta="und was es einbringt">
            <ComparisonTable
              columns={[
                { key: "pitches", label: "Pitches", format: "int" },
                { key: "fuQuote", label: "Nachgefasst", format: "pct", deltaVsAvg: true },
                { key: "avgStage", label: "Ø Stufe", format: "num1" },
                { key: "directRate", label: "Direkt", format: "pct", deltaVsAvg: true },
                { key: "fuLift", label: "Durch FU", format: "pct", deltaVsAvg: true },
                { key: "answerRate", label: "Antwortquote", format: "pct", deltaVsAvg: true },
                { key: "appts", label: "Termine", format: "int" },
              ]}
              rows={personRows}
              average={personAverage}
              averageLabel="Gesamt"
            />
            <Footnote>
              &bdquo;Direkt&ldquo; = Antwortquote ohne jedes Nachfassen, &bdquo;Durch FU&ldquo; = zusätzliche Antworten aus FU1–FU3,
              beide gegen die Pitches derselben Person gerechnet. Zuordnung über <code>lists.owner_name</code>
              {" "}(Vorrang) bzw. den Ersteller der Liste.
            </Footnote>
          </AnalyseSection>
        </div>
      )}

      {/* ══ 6 · Offene Pipeline ══ */}
      <div className="fade-up" style={{ animationDelay: "540ms" }}>
        <AnalyseSection
          title="Was liegt noch offen?"
          icon={AlarmClock}
          meta={`${INT.format(openTotal)} offen · ${INT.format(overdueTotal)} überfällig`}
        >
          <MetricTable
            label="Stand"
            columns={[
              { key: "open", label: "Offen", format: "int", emphasis: true },
              { key: "overdue", label: "Überfällig", format: "int" },
              { key: "dueSoon", label: "Fällig ≤ 3 Tage", format: "int" },
              { key: "blocked", label: "Blockiert", format: "int" },
            ]}
            rows={pipelineRows}
            minWidth={480}
          />
          <Footnote>
            Nur Kontakte aus dem gewählten Pitch-Zeitraum, die weder geantwortet noch einen Termin haben.
            {ausgereizt > 0 && ` ${INT.format(ausgereizt)} Kontakte haben FU3 ohne Antwort durchlaufen — die Sequenz ist dort ausgereizt.`}
          </Footnote>
        </AnalyseSection>
      </div>
    </>
  );
}
