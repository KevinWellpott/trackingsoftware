import { Filter, BarChart3, ListChecks } from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { buildBuckets, bucketOf, settingEffDate, pct, type QuelleKey } from "@/lib/analyse";
import { AnalyseSection } from "@/components/analyse/AnalyseSection";
import { ComparisonTable, type ComparisonRow } from "@/components/analyse/ComparisonTable";
import { BucketBarChart } from "@/components/analyse/AnalyseCharts";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

// Setting-Flow: Termine → Shows → Qualifikation → Closing gelegt, aus
// setting_calls (JS-Filter nach Effektiv-Datum und optionaler Quelle).

type Member = { user_id: string; username: string };

type SettingRow = {
  id: string;
  created_by_user_id: string | null;
  source_type: string | null;
  appointment_at: string | null;
  call_at: string | null;
  created_at: string;
  show_status: "show" | "no_show" | null;
  status: "offen" | "qualifiziert" | "disqualifiziert" | "closing_gelegt" | "dead";
};

type SettingStatus = SettingRow["status"];

const STATUS_META: { key: SettingStatus; label: string; tone: BadgeTone }[] = [
  { key: "offen", label: "Offen", tone: "info" },
  { key: "qualifiziert", label: "Qualifiziert", tone: "success" },
  { key: "closing_gelegt", label: "Closing gelegt", tone: "brand" },
  { key: "disqualifiziert", label: "Disqualifiziert", tone: "neutral" },
  { key: "dead", label: "Dead", tone: "error" },
];

type Totals = {
  termine: number;
  shows: number;
  noShows: number;
  quali: number;
  closing: number;
  dead: number;
};

const ZERO = (): Totals => ({ termine: 0, shows: 0, noShows: 0, quali: 0, closing: 0, dead: 0 });

export async function SettingTab({
  access,
  from,
  to,
  selectedMembers,
  canCompare,
  quelle,
}: {
  access: AccessContext;
  from: string;
  to: string;
  selectedMembers: Member[];
  canCompare: boolean;
  quelle: QuelleKey;
}) {
  const supabase = await createClient();

  let query = supabase
    .from("setting_calls")
    .select("id, created_by_user_id, source_type, appointment_at, call_at, created_at, show_status, status")
    .eq("workspace_id", access.workspace_id);
  if (!canCompare) query = query.eq("created_by_user_id", access.user.id);

  const res = await query;
  const allRows = (res.data ?? []) as SettingRow[];
  const buckets = buildBuckets(from, to);

  const selectedIds = new Set(selectedMembers.map((m) => m.user_id));
  const nameById = new Map(selectedMembers.map((m) => [m.user_id, m.username]));

  const totals = new Map<string, Totals>();
  const perUser: Record<string, Record<string, number>> = {};
  for (const m of selectedMembers) {
    totals.set(m.username, ZERO());
    perUser[m.username] = {};
  }
  const statusCounts: Record<SettingStatus, number> = {
    offen: 0, qualifiziert: 0, closing_gelegt: 0, disqualifiziert: 0, dead: 0,
  };

  for (const r of allRows) {
    const day = settingEffDate(r);
    if (day < from || day > to) continue;
    if (quelle !== "alle" && r.source_type !== quelle) continue;
    const uid = r.created_by_user_id ?? "";
    if (!selectedIds.has(uid)) continue;
    const name = nameById.get(uid)!;

    const t = totals.get(name)!;
    t.termine += 1;
    if (r.show_status === "show") t.shows += 1;
    if (r.show_status === "no_show") t.noShows += 1;
    if (r.show_status === "show" && (r.status === "qualifiziert" || r.status === "closing_gelegt")) t.quali += 1;
    if (r.show_status === "show" && r.status === "closing_gelegt") t.closing += 1;
    if (r.status === "dead") t.dead += 1;
    statusCounts[r.status] += 1;

    const bk = bucketOf(day, from, to);
    perUser[name][bk] = (perUser[name][bk] ?? 0) + 1;
  }

  const names = selectedMembers.map((m) => m.username);
  const sum = ZERO();
  for (const name of names) {
    const t = totals.get(name)!;
    sum.termine += t.termine;
    sum.shows += t.shows;
    sum.noShows += t.noShows;
    sum.quali += t.quali;
    sum.closing += t.closing;
    sum.dead += t.dead;
  }

  const tableRows: ComparisonRow[] = names.map((name) => {
    const t = totals.get(name)!;
    const withStatus = t.shows + t.noShows;
    return {
      name,
      values: {
        termine: t.termine,
        shows: t.shows,
        noShows: t.noShows,
        showRate: pct(t.shows, withStatus),
        qualiRate: pct(t.quali, t.shows),
        closingRate: pct(t.closing, t.shows),
        dead: t.dead,
      },
    };
  });

  const sumWithStatus = sum.shows + sum.noShows;
  const average = {
    termine: sum.termine,
    shows: sum.shows,
    noShows: sum.noShows,
    showRate: pct(sum.shows, sumWithStatus),
    qualiRate: pct(sum.quali, sum.shows),
    closingRate: pct(sum.closing, sum.shows),
    dead: sum.dead,
  };

  const statusTotal = STATUS_META.reduce((acc, s) => acc + statusCounts[s.key], 0);

  return (
    <>
      <AnalyseSection title="Vergleich" icon={Filter} meta="Termine · Shows · Qualifikation · Closing">
        <ComparisonTable
          columns={[
            { key: "termine", label: "Termine", format: "int" },
            { key: "shows", label: "Shows", format: "int" },
            { key: "noShows", label: "No-Shows", format: "int" },
            { key: "showRate", label: "Show-Quote", format: "pct", deltaVsAvg: true },
            { key: "qualiRate", label: "Qualifiziert-Quote", format: "pct", deltaVsAvg: true },
            { key: "closingRate", label: "Closing-Quote", format: "pct", deltaVsAvg: true },
            { key: "dead", label: "Dead", format: "int" },
          ]}
          rows={tableRows}
          average={average}
          averageLabel="Gesamt"
        />
      </AnalyseSection>

      <AnalyseSection title="Termine je Zeitraum" icon={BarChart3}>
        <BucketBarChart buckets={buckets} perUser={perUser} />
      </AnalyseSection>

      <AnalyseSection title="Status-Verteilung" icon={ListChecks} meta={`${statusTotal} gesamt`}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {STATUS_META.map((s) => (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Badge tone={s.tone}>{s.label}</Badge>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: "0.875rem",
                  fontWeight: 800,
                  color: "var(--text-primary)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {statusCounts[s.key].toLocaleString("de-DE")}
              </span>
            </div>
          ))}
        </div>
      </AnalyseSection>
    </>
  );
}
