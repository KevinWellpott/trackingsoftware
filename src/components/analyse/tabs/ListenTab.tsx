import { Award, FileText, Filter, Layers, ListOrdered, Target, TrendingUp, Users2 } from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { loadClosingCalls, loadContacts, type AnalyseContact } from "@/lib/analyseData";
import { NUM, fuStage, ownerKey, pct, sentimentOf } from "@/lib/analyse";
import { AnalyseSection } from "@/components/analyse/AnalyseSection";
import { Footnote, MetricTable, type MetricRow } from "@/components/analyse/AnalyseTables";
import { DistBars, KpiHero, KpiRow } from "@/components/analyse/AnalyseViz";
import { ListPerformanceTable, type ListPerfRow } from "@/components/analyse/ListPerformanceTable";
import { ownerColor } from "@/lib/ownerColor";

// Listen-Ebene: Welche Pitch-Liste — und damit welcher Text-Satz — trägt?
//
// Eine Liste bündelt Pitch-Text UND Nachfass-Sequenz (`lists.pitch_text`,
// `fu1_text`…`fu3_text`). Listen zu vergleichen heißt deshalb, Textvarianten zu
// vergleichen. Umsatz wird über contacts.setting_call_id → closing_calls
// zurückgerechnet: der Deal zählt bei der Liste, aus der der Lead stammt.

type Member = { user_id: string; username: string };

const INT = new Intl.NumberFormat("de-DE");
const OHNE = "Ohne Zuordnung";

type ListAgg = {
  id: string;
  name: string;
  owner: string;
  archived: boolean;
  texts: { pitch: boolean; fu1: boolean; fu2: boolean; fu3: boolean };
  dms: number;
  answers: number;
  positive: number;
  categorized: number;
  appts: number;
  blocked: number;
  withFu: number;
  stageSum: number;
  revenue: number;
  /** Kaskade je Stufe: [erreicht, Antworten] */
  reached: number[];
  stageAnswers: number[];
};

function newAgg(id: string, c: AnalyseContact): ListAgg {
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
    dms: 0, answers: 0, positive: 0, categorized: 0, appts: 0, blocked: 0,
    withFu: 0, stageSum: 0, revenue: 0,
    reached: [0, 0, 0, 0],
    stageAnswers: [0, 0, 0, 0],
  };
}

export async function ListenTab({
  access,
  from,
  to,
  selectedMembers,
  canCompare,
  allSelected,
  minDms,
}: {
  access: AccessContext;
  from: string;
  to: string;
  selectedMembers: Member[];
  canCompare: boolean;
  allSelected: boolean;
  minDms: number;
}) {
  const supabase = await createClient();
  const [contactsRaw, closings] = await Promise.all([
    loadContacts(supabase, access, canCompare, from, to),
    loadClosingCalls(supabase, access, canCompare),
  ]);

  // Gewonnene Deals je Setting-Call — Brücke zurück zur Liste des Leads.
  const wonBySetting = new Map<string, number>();
  for (const cc of closings) {
    if (cc.status !== "gewonnen" || !cc.setting_call_id) continue;
    wonBySetting.set(cc.setting_call_id, (wonBySetting.get(cc.setting_call_id) ?? 0) + NUM(cc.deal_volume));
  }

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

  // ── Aggregation je Liste ─────────────────────────────────────
  const byList = new Map<string, ListAgg>();
  const byTarget = new Map<string, { dms: number; answers: number; appts: number }>();

  for (const c of contactsRaw) {
    if (ownerOf(c) === null) continue;

    let agg = byList.get(c.list_id);
    if (!agg) {
      agg = newAgg(c.list_id, c);
      byList.set(c.list_id, agg);
    }
    const s = fuStage(c.follow_up_number);
    agg.dms += 1;
    agg.stageSum += s;
    if (s >= 1) agg.withFu += 1;
    for (let k = 0; k <= s; k++) agg.reached[k] += 1;
    if (c.answered === true) {
      agg.answers += 1;
      agg.stageAnswers[s] += 1;
      const sent = sentimentOf(c.answer_category);
      if (sent) {
        agg.categorized += 1;
        if (sent === "positiv") agg.positive += 1;
      }
    }
    if (c.appointment_set === true) agg.appts += 1;
    if (c.blocked_at) agg.blocked += 1;
    if (c.setting_call_id) agg.revenue += wonBySetting.get(c.setting_call_id) ?? 0;

    const tg = (c.target_group ?? "").trim() || "Ohne Angabe";
    const t = byTarget.get(tg) ?? { dms: 0, answers: 0, appts: 0 };
    t.dms += 1;
    if (c.answered === true) t.answers += 1;
    if (c.appointment_set === true) t.appts += 1;
    byTarget.set(tg, t);
  }

  const allLists = [...byList.values()].sort((a, b) => b.dms - a.dms);
  const qualified = allLists.filter((l) => l.dms >= minDms);

  const perfRows: ListPerfRow[] = qualified.map((l) => ({
    id: l.id,
    name: l.name,
    owner: l.owner,
    archived: l.archived,
    texts: l.texts,
    dms: l.dms,
    answers: l.answers,
    answerRate: pct(l.answers, l.dms),
    positive: l.positive,
    positiveShare: pct(l.positive, l.categorized),
    appts: l.appts,
    apptRate: pct(l.appts, l.dms),
    fuUsage: pct(l.withFu, l.dms),
    avgFu: l.dms === 0 ? null : Math.round((l.stageSum / l.dms) * 10) / 10,
    blockedRate: pct(l.blocked, l.dms),
    revenue: l.revenue,
  }));

  // ── KPI-Reihe ────────────────────────────────────────────────
  const totalDms = allLists.reduce((s, l) => s + l.dms, 0);
  const totalAnswers = allLists.reduce((s, l) => s + l.answers, 0);
  const totalAppts = allLists.reduce((s, l) => s + l.appts, 0);
  const rated = perfRows.filter((r) => r.answerRate !== null).sort((a, b) => (b.answerRate ?? 0) - (a.answerRate ?? 0));
  const best = rated[0] ?? null;
  const worst = rated.length > 1 ? rated[rated.length - 1] : null;
  const spread = best && worst ? Math.round(((best.answerRate ?? 0) - (worst.answerRate ?? 0)) * 10) / 10 : null;

  // ── Stufen-Matrix (Top-Listen nach DMs) ──────────────────────
  const matrixLists = qualified.slice(0, 10);
  const matrixRows: MetricRow[] = matrixLists.map((l) => ({
    key: l.id,
    label: l.name,
    sub: canCompare && l.owner ? l.owner : undefined,
    share: totalDms === 0 ? null : l.dms / (matrixLists[0]?.dms || 1),
    color: ownerColor(l.owner).fg,
    values: {
      dms: l.dms,
      s0: pct(l.stageAnswers[0], l.reached[0]),
      s1: pct(l.stageAnswers[1], l.reached[1]),
      s2: pct(l.stageAnswers[2], l.reached[2]),
      s3: pct(l.stageAnswers[3], l.reached[3]),
      total: pct(l.answers, l.dms),
    },
  }));

  const matrixTotals = matrixLists.reduce(
    (acc, l) => {
      acc.dms += l.dms;
      for (let k = 0; k < 4; k++) {
        acc.reached[k] += l.reached[k];
        acc.answers[k] += l.stageAnswers[k];
      }
      return acc;
    },
    { dms: 0, reached: [0, 0, 0, 0], answers: [0, 0, 0, 0] },
  );

  // ── Textsatz-Vergleich ───────────────────────────────────────
  // Nur Listen mit Mindestmenge, sonst entscheidet Rauschen.
  const withTexts = qualified.filter((l) => l.texts.fu1 || l.texts.fu2 || l.texts.fu3);
  const withoutTexts = qualified.filter((l) => !(l.texts.fu1 || l.texts.fu2 || l.texts.fu3));

  function sumGroup(group: ListAgg[]) {
    const dms = group.reduce((s, l) => s + l.dms, 0);
    const answers = group.reduce((s, l) => s + l.answers, 0);
    const appts = group.reduce((s, l) => s + l.appts, 0);
    const withFu = group.reduce((s, l) => s + l.withFu, 0);
    const fuAnswers = group.reduce((s, l) => s + l.stageAnswers[1] + l.stageAnswers[2] + l.stageAnswers[3], 0);
    const reachedFu1 = group.reduce((s, l) => s + l.reached[1], 0);
    return {
      lists: group.length,
      dms,
      answerRate: pct(answers, dms),
      fuUsage: pct(withFu, dms),
      fuAnswerRate: pct(fuAnswers, reachedFu1),
      apptRate: pct(appts, dms),
      revenue: group.reduce((s, l) => s + l.revenue, 0),
    };
  }

  const textRows: MetricRow[] = [
    { key: "eigen", label: "Eigene Nachfass-Texte", sub: "mindestens FU1 hinterlegt", values: sumGroup(withTexts) },
    { key: "standard", label: "Standard-Texte", sub: "Nutzer-Vorlage bzw. Fallback", values: sumGroup(withoutTexts) },
  ].filter((r) => (r.values.lists as number) > 0);

  // ── Zielgruppen ──────────────────────────────────────────────
  const targetRows: MetricRow[] = [...byTarget.entries()]
    .sort((a, b) => b[1].dms - a[1].dms)
    .slice(0, 10)
    .map(([label, t]) => ({
      key: label,
      label,
      share: totalDms === 0 ? null : t.dms / totalDms,
      values: {
        dms: t.dms,
        answers: t.answers,
        answerRate: pct(t.answers, t.dms),
        appts: t.appts,
        apptRate: pct(t.appts, t.dms),
      },
    }));

  // ── Ranking-Balken ───────────────────────────────────────────
  const rankItems = rated.slice(0, 8).map((r) => ({
    label: `${r.name}${canCompare && r.owner ? ` · ${r.owner}` : ""} (${INT.format(r.answers)}/${INT.format(r.dms)})`,
    value: Math.round(r.answerRate ?? 0),
    color: ownerColor(r.owner).fg,
  }));

  const minLabel = minDms === 0 ? "alle Listen" : `ab ${minDms} DMs`;

  return (
    <>
      {/* ══ 1 · KPI-Reihe ══ */}
      <KpiRow>
        <KpiHero label="Listen mit Aktivität" value={allLists.length} icon={<ListOrdered size={15} />} index={0} />
        <KpiHero label="DMs" value={totalDms} icon={<TrendingUp size={15} />} index={1} />
        <KpiHero
          label="Beste Antwortquote"
          value={best?.answerRate ?? null}
          format="pct"
          tone={best ? "success" : "default"}
          icon={<Award size={15} />}
          index={2}
        />
        <KpiHero label="Ø Antwortquote" value={pct(totalAnswers, totalDms)} format="pct" icon={<Filter size={15} />} index={3} />
        <KpiHero
          label="Spannweite"
          value={spread}
          format="num1"
          tone={spread !== null && spread >= 10 ? "warning" : "default"}
          icon={<Layers size={15} />}
          index={4}
        />
        <KpiHero label="Ø Terminquote" value={pct(totalAppts, totalDms)} format="pct" icon={<Target size={15} />} index={5} />
      </KpiRow>

      {/* ══ 2 · Listen-Tabelle ══ */}
      <div className="fade-up" style={{ animationDelay: "240ms" }}>
        <AnalyseSection
          title="Listen im Vergleich"
          icon={ListOrdered}
          meta={`${qualified.length} von ${allLists.length} Listen · ${minLabel} · Spalte anklicken zum Sortieren`}
        >
          <ListPerformanceTable rows={perfRows} showOwner={canCompare} />
          <Footnote>
            <strong>P · 1 · 2 · 3</strong> zeigt, welche Texte die Liste selbst hinterlegt hat (Pitch, FU1–FU3);
            wo nichts hinterlegt ist, greift die Nutzer-Vorlage bzw. der Standardtext.
            <strong> Umsatz</strong> rechnet gewonnene Deals über <code>contacts.setting_call_id</code> auf die
            Liste des Leads zurück — Termine ohne Quellkontakt (manuell gebucht) tauchen hier nicht auf.
            Die Mindestmenge steuert der Filter &bdquo;Mindest-DMs&ldquo; oben.
          </Footnote>
        </AnalyseSection>
      </div>

      {/* ══ 3 · Antwortquote je Stufe je Liste ══ */}
      <div className="fade-up" style={{ animationDelay: "300ms" }}>
        <AnalyseSection
          title="Welcher Text zieht auf welcher Stufe?"
          icon={Layers}
          meta={`Antwortquote je Follow-up-Stufe · Top ${matrixLists.length} nach DMs`}
        >
          <MetricTable
            label="Liste"
            columns={[
              { key: "dms", label: "DMs", format: "int" },
              { key: "s0", label: "Pitch", format: "pct" },
              { key: "s1", label: "FU1", format: "pct" },
              { key: "s2", label: "FU2", format: "pct" },
              { key: "s3", label: "FU3", format: "pct" },
              { key: "total", label: "Gesamt", format: "pct", emphasis: true },
            ]}
            rows={matrixRows}
            total={{
              dms: matrixTotals.dms,
              s0: pct(matrixTotals.answers[0], matrixTotals.reached[0]),
              s1: pct(matrixTotals.answers[1], matrixTotals.reached[1]),
              s2: pct(matrixTotals.answers[2], matrixTotals.reached[2]),
              s3: pct(matrixTotals.answers[3], matrixTotals.reached[3]),
              total: pct(
                matrixTotals.answers.reduce((a, b) => a + b, 0),
                matrixTotals.dms,
              ),
            }}
            minWidth={620}
          />
          <Footnote>
            Jede Spalte ist die Quote GENAU dieser Stufe: Antworten auf der Stufe geteilt durch die Kontakte, die
            sie erreicht haben. Ein leeres Feld heißt, dass diese Liste die Stufe nie erreicht hat.
          </Footnote>
        </AnalyseSection>
      </div>

      {/* ══ 4 · Textsatz + Zielgruppen ══ */}
      <div className="analyse-row">
        <div className="fade-up" style={{ display: "grid", animationDelay: "360ms" }}>
          <AnalyseSection title="Eigene Nachfass-Texte vs. Standard" icon={FileText} meta={minLabel}>
            <MetricTable
              label="Textsatz"
              columns={[
                { key: "lists", label: "Listen", format: "int" },
                { key: "dms", label: "DMs", format: "int" },
                { key: "answerRate", label: "Antwortquote", format: "pct", emphasis: true },
                { key: "fuUsage", label: "Nachgefasst", format: "pct" },
                { key: "fuAnswerRate", label: "Quote ab FU1", format: "pct" },
                { key: "apptRate", label: "Terminquote", format: "pct" },
              ]}
              rows={textRows}
              minWidth={520}
              emptyHint="Keine Liste erreicht die Mindestmenge."
            />
            <Footnote>
              Grober Schnitt, kein A/B-Test: Listen unterscheiden sich auch in Zielgruppe und Zeitpunkt. Als
              Richtungsanzeige taugt er, als Beweis nicht.
            </Footnote>
          </AnalyseSection>
        </div>
        <div className="fade-up" style={{ display: "grid", animationDelay: "420ms" }}>
          <AnalyseSection title="Zielgruppen" icon={Users2} meta={`${byTarget.size} Ausprägungen`}>
            <MetricTable
              label="Zielgruppe"
              columns={[
                { key: "dms", label: "DMs", format: "int" },
                { key: "answers", label: "Antw.", format: "int" },
                { key: "answerRate", label: "Antwortquote", format: "pct", emphasis: true },
                { key: "apptRate", label: "Terminquote", format: "pct" },
              ]}
              rows={targetRows}
              minWidth={420}
              emptyHint="Keine Zielgruppen erfasst."
            />
          </AnalyseSection>
        </div>
      </div>

      {/* ══ 5 · Ranking ══ */}
      <div className="fade-up" style={{ animationDelay: "480ms" }}>
        <AnalyseSection title="Top-Listen nach Antwortquote" icon={Award} meta={`${minLabel} · Wert = Antwortquote in %`}>
          <DistBars items={rankItems} />
          {worst && best && (
            <Footnote>
              Beste Liste &bdquo;{best.name}&ldquo; liegt {spread} Prozentpunkte über der schwächsten (&bdquo;{worst.name}&ldquo;) — der
              Abstand ist der eigentliche Hebel, nicht der Durchschnitt.
            </Footnote>
          )}
        </AnalyseSection>
      </div>
    </>
  );
}
