import { Phone, Filter, TrendingUp } from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { NUM, buildBuckets, bucketOf, ownerKey, pct } from "@/lib/analyse";
import { AnalyseSection, MigrationHint } from "@/components/analyse/AnalyseSection";
import { ComparisonTable, type ComparisonRow } from "@/components/analyse/ComparisonTable";
import { FunnelStrip } from "@/components/analyse/FunnelStrip";
import { PhoneSeriesChart } from "@/components/analyse/AnalyseCharts";

// Telefon-Flow: Calls → Gatekeeper → Entscheider → Termine, aus
// rpc_phone_day_metrics (benötigt Migration 0013).

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

type Totals = {
  calls: number;
  gatekeeper: number;
  decider: number;
  appts: number;
  callbacks: number;
  dead: number;
};

const ZERO = (): Totals => ({ calls: 0, gatekeeper: 0, decider: 0, appts: 0, callbacks: 0, dead: 0 });
const OHNE = "Ohne Zuordnung";

export async function TelefonTab({
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

  const res = await supabase.rpc("rpc_phone_day_metrics", {
    p_workspace_id: access.workspace_id,
    p_from: from,
    p_to: to,
    p_effective_user_id: eff,
  });

  if (res.error) {
    return <MigrationHint>Telefon-Analyse benötigt die neueste Datenbank-Migration (0013).</MigrationHint>;
  }

  const rows = (res.data ?? []) as PhoneDayRow[];
  const buckets = buildBuckets(from, to);

  const nameByKey = new Map<string, string>();
  for (const m of selectedMembers) nameByKey.set(ownerKey(m.username), m.username);

  const totals = new Map<string, Totals>();
  const perUser: Record<string, Record<string, { calls: number; decider: number; appts: number }>> = {};
  const ensure = (name: string) => {
    if (!totals.has(name)) totals.set(name, ZERO());
    if (!perUser[name]) perUser[name] = {};
  };
  for (const m of selectedMembers) ensure(m.username);

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
    const bk = bucketOf(r.day, from, to);
    const b = perUser[name][bk] ?? { calls: 0, decider: 0, appts: 0 };
    b.calls += calls;
    b.decider += decider;
    b.appts += appts;
    perUser[name][bk] = b;
  }

  const names = selectedMembers.map((m) => m.username);
  const ohne = totals.get(OHNE);
  if (ohne && ohne.calls > 0) names.push(OHNE);

  const sum = ZERO();
  for (const name of names) {
    const t = totals.get(name)!;
    sum.calls += t.calls;
    sum.gatekeeper += t.gatekeeper;
    sum.decider += t.decider;
    sum.appts += t.appts;
    sum.callbacks += t.callbacks;
    sum.dead += t.dead;
  }

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
    gkRate: pct(sum.gatekeeper, sum.calls),
    decider: sum.decider,
    deciderRate: pct(sum.decider, sum.calls),
    appts: sum.appts,
    apptRate: pct(sum.appts, sum.calls),
    callbacks: sum.callbacks,
    dead: sum.dead,
  };

  return (
    <>
      <AnalyseSection title="Vergleich" icon={Filter} meta="Calls · Gatekeeper · Entscheider · Termine">
        <ComparisonTable
          columns={[
            { key: "calls", label: "Calls", format: "int" },
            { key: "gatekeeper", label: "Gatekeeper", format: "int" },
            { key: "gkRate", label: "GK-Quote", format: "pct", deltaVsAvg: true },
            { key: "decider", label: "Entscheider", format: "int" },
            { key: "deciderRate", label: "Entscheider-Quote", format: "pct", deltaVsAvg: true },
            { key: "appts", label: "Termine", format: "int" },
            { key: "apptRate", label: "Terminquote", format: "pct", deltaVsAvg: true },
            { key: "callbacks", label: "Rückrufe", format: "int" },
            { key: "dead", label: "Dead", format: "int" },
          ]}
          rows={tableRows}
          average={average}
          averageLabel="Gesamt"
        />
      </AnalyseSection>

      <AnalyseSection title="Verlauf" icon={TrendingUp}>
        <PhoneSeriesChart buckets={buckets} perUser={perUser} />
      </AnalyseSection>

      <AnalyseSection title="Funnel" icon={Phone}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <FunnelStrip
            label="Gesamt"
            highlight
            stages={[
              { label: "Calls", value: sum.calls },
              { label: "Gatekeeper", value: sum.gatekeeper },
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
                  { label: "Calls", value: t.calls },
                  { label: "Gatekeeper", value: t.gatekeeper },
                  { label: "Entscheider", value: t.decider },
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
