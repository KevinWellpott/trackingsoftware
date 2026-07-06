import { MessagesSquare, Filter, TrendingUp } from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { NUM, buildBuckets, bucketOf, ownerKey, pct } from "@/lib/analyse";
import { AnalyseSection } from "@/components/analyse/AnalyseSection";
import { ComparisonTable, type ComparisonRow } from "@/components/analyse/ComparisonTable";
import { FunnelStrip } from "@/components/analyse/FunnelStrip";
import { LinkedInSeriesChart } from "@/components/analyse/AnalyseCharts";

// LinkedIn-Flow: DMs → Antworten → Termine je Mitglied, aus rpc_owner_day_metrics.

type Member = { user_id: string; username: string };

type OwnerDayRow = {
  owner_name: string | null;
  day: string;
  dms: number | string | null;
  answers: number | string | null;
  appts: number | string | null;
};

type Totals = { dms: number; answers: number; appts: number };

const OHNE = "Ohne Zuordnung";

export async function LinkedInTab({
  access,
  from,
  to,
  selectedMembers,
  canCompare,
  allSelected,
}: {
  access: AccessContext;
  from: string;
  to: string;
  selectedMembers: Member[];
  canCompare: boolean;
  allSelected: boolean;
}) {
  const supabase = await createClient();
  const eff = canCompare ? null : access.user.id;

  const res = await supabase.rpc("rpc_owner_day_metrics", {
    p_workspace_id: access.workspace_id,
    p_from: from,
    p_to: to,
    p_effective_user_id: eff,
  });

  const rows: OwnerDayRow[] = res.error ? [] : ((res.data ?? []) as OwnerDayRow[]);
  const buckets = buildBuckets(from, to);

  // Namens-Index: ownerKey(username) → Anzeigename
  const nameByKey = new Map<string, string>();
  for (const m of selectedMembers) nameByKey.set(ownerKey(m.username), m.username);

  // Aggregation je Anzeigename (Summen + Buckets)
  const totals = new Map<string, Totals>();
  const perUser: Record<string, Record<string, Totals>> = {};
  const ensure = (name: string) => {
    if (!totals.has(name)) totals.set(name, { dms: 0, answers: 0, appts: 0 });
    if (!perUser[name]) perUser[name] = {};
  };
  for (const m of selectedMembers) ensure(m.username);

  for (const r of rows) {
    const key = ownerKey(r.owner_name);
    let name = nameByKey.get(key);
    if (!name) {
      if (!allSelected) continue; // Fremd-Owner nur im "Alle"-Modus zeigen
      name = OHNE;
    }
    ensure(name);
    const t = totals.get(name)!;
    const dms = NUM(r.dms);
    const answers = NUM(r.answers);
    const appts = NUM(r.appts);
    t.dms += dms;
    t.answers += answers;
    t.appts += appts;
    const bk = bucketOf(r.day, from, to);
    const b = perUser[name][bk] ?? { dms: 0, answers: 0, appts: 0 };
    b.dms += dms;
    b.answers += answers;
    b.appts += appts;
    perUser[name][bk] = b;
  }

  // Anzeigereihenfolge: Mitglieder, dann "Ohne Zuordnung" (nur mit Daten)
  const names = selectedMembers.map((m) => m.username);
  const ohne = totals.get(OHNE);
  if (ohne && (ohne.dms > 0 || ohne.answers > 0 || ohne.appts > 0)) names.push(OHNE);

  const sum: Totals = { dms: 0, answers: 0, appts: 0 };
  for (const name of names) {
    const t = totals.get(name)!;
    sum.dms += t.dms;
    sum.answers += t.answers;
    sum.appts += t.appts;
  }

  const tableRows: ComparisonRow[] = names.map((name) => {
    const t = totals.get(name)!;
    return {
      name,
      values: {
        dms: t.dms,
        answers: t.answers,
        answerRate: pct(t.answers, t.dms),
        appts: t.appts,
        apptRate: pct(t.appts, t.dms),
      },
    };
  });

  const average = {
    dms: sum.dms,
    answers: sum.answers,
    answerRate: pct(sum.answers, sum.dms),
    appts: sum.appts,
    apptRate: pct(sum.appts, sum.dms),
  };

  return (
    <>
      <AnalyseSection title="Vergleich" icon={Filter} meta="DMs · Antworten · Termine">
        <ComparisonTable
          columns={[
            { key: "dms", label: "DMs", format: "int" },
            { key: "answers", label: "Antworten", format: "int" },
            { key: "answerRate", label: "Antwortquote", format: "pct", deltaVsAvg: true },
            { key: "appts", label: "Termine", format: "int" },
            { key: "apptRate", label: "Terminquote", format: "pct", deltaVsAvg: true },
          ]}
          rows={tableRows}
          average={average}
          averageLabel="Gesamt"
        />
      </AnalyseSection>

      <AnalyseSection title="Verlauf" icon={TrendingUp}>
        <LinkedInSeriesChart buckets={buckets} perUser={perUser} />
      </AnalyseSection>

      <AnalyseSection title="Funnel" icon={MessagesSquare}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <FunnelStrip
            label="Gesamt"
            highlight
            stages={[
              { label: "DMs", value: sum.dms },
              { label: "Antworten", value: sum.answers },
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
                  { label: "DMs", value: t.dms },
                  { label: "Antworten", value: t.answers },
                  { label: "Termine", value: t.appts },
                ]}
              />
            );
          })}
        </div>
      </AnalyseSection>
    </>
  );
}
