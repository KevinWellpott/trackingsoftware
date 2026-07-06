import { Filter, XCircle } from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { NUM, closingEffDate, pct } from "@/lib/analyse";
import { AnalyseSection } from "@/components/analyse/AnalyseSection";
import { ComparisonTable, type ComparisonRow } from "@/components/analyse/ComparisonTable";

// Closing-Flow: Closings → Shows → Gewonnen/Verloren → Umsatz, aus
// closing_calls (JS-Filter nach Effektiv-Datum).

type Member = { user_id: string; username: string };

type ClosingRow = {
  created_by_user_id: string | null;
  call_at: string | null;
  created_at: string;
  show_status: "show" | "no_show" | null;
  status: "offen" | "gewonnen" | "verloren" | "nachfassen";
  deal_volume: number | null;
  lost_reason: string | null;
};

type Totals = {
  closings: number;
  shows: number;
  noShows: number;
  won: number;
  lost: number;
  revenue: number;
};

const ZERO = (): Totals => ({ closings: 0, shows: 0, noShows: 0, won: 0, lost: 0, revenue: 0 });

export async function ClosingTab({
  access,
  from,
  to,
  selectedMembers,
  canCompare,
}: {
  access: AccessContext;
  from: string;
  to: string;
  selectedMembers: Member[];
  canCompare: boolean;
}) {
  const supabase = await createClient();

  let query = supabase
    .from("closing_calls")
    .select("created_by_user_id, call_at, created_at, show_status, status, deal_volume, lost_reason")
    .eq("workspace_id", access.workspace_id);
  if (!canCompare) query = query.eq("created_by_user_id", access.user.id);

  const res = await query;
  const allRows = (res.data ?? []) as ClosingRow[];

  const selectedIds = new Set(selectedMembers.map((m) => m.user_id));
  const nameById = new Map(selectedMembers.map((m) => [m.user_id, m.username]));

  const totals = new Map<string, Totals>();
  for (const m of selectedMembers) totals.set(m.username, ZERO());

  const lostReasons = new Map<string, number>();

  for (const r of allRows) {
    const day = closingEffDate(r);
    if (day < from || day > to) continue;
    const uid = r.created_by_user_id ?? "";
    if (!selectedIds.has(uid)) continue;
    const name = nameById.get(uid)!;

    const t = totals.get(name)!;
    t.closings += 1;
    if (r.show_status === "show") t.shows += 1;
    if (r.show_status === "no_show") t.noShows += 1;
    if (r.status === "gewonnen") {
      t.won += 1;
      t.revenue += NUM(r.deal_volume);
    }
    if (r.status === "verloren") {
      t.lost += 1;
      const reason = (r.lost_reason ?? "").trim() || "Ohne Angabe";
      lostReasons.set(reason, (lostReasons.get(reason) ?? 0) + 1);
    }
  }

  const names = selectedMembers.map((m) => m.username);
  const sum = ZERO();
  for (const name of names) {
    const t = totals.get(name)!;
    sum.closings += t.closings;
    sum.shows += t.shows;
    sum.noShows += t.noShows;
    sum.won += t.won;
    sum.lost += t.lost;
    sum.revenue += t.revenue;
  }

  const tableRows: ComparisonRow[] = names.map((name) => {
    const t = totals.get(name)!;
    return {
      name,
      values: {
        closings: t.closings,
        shows: t.shows,
        showRate: pct(t.shows, t.shows + t.noShows),
        won: t.won,
        lost: t.lost,
        winRate: pct(t.won, t.won + t.lost),
        revenue: t.revenue,
        avgDeal: t.won === 0 ? null : Math.round(t.revenue / t.won),
      },
    };
  });

  const average = {
    closings: sum.closings,
    shows: sum.shows,
    showRate: pct(sum.shows, sum.shows + sum.noShows),
    won: sum.won,
    lost: sum.lost,
    winRate: pct(sum.won, sum.won + sum.lost),
    revenue: sum.revenue,
    avgDeal: sum.won === 0 ? null : Math.round(sum.revenue / sum.won),
  };

  const reasonRows = [...lostReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxReason = reasonRows.length > 0 ? reasonRows[0][1] : 0;

  return (
    <>
      <AnalyseSection title="Vergleich" icon={Filter} meta="Closings · Win-Rate · Umsatz">
        <ComparisonTable
          columns={[
            { key: "closings", label: "Closings", format: "int" },
            { key: "shows", label: "Shows", format: "int" },
            { key: "showRate", label: "Show-Quote", format: "pct" },
            { key: "won", label: "Gewonnen", format: "int" },
            { key: "lost", label: "Verloren", format: "int" },
            { key: "winRate", label: "Win-Rate", format: "pct", deltaVsAvg: true },
            { key: "revenue", label: "Umsatz", format: "eur" },
            { key: "avgDeal", label: "Ø-Deal", format: "eur" },
          ]}
          rows={tableRows}
          average={average}
          averageLabel="Gesamt"
        />
      </AnalyseSection>

      <AnalyseSection title="Verlust-Gründe" icon={XCircle} meta={`${sum.lost} verloren`}>
        {reasonRows.length === 0 ? (
          <p style={{ fontSize: "0.8125rem", color: "var(--text-subtle)", margin: 0 }}>
            Keine verlorenen Deals im Zeitraum.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {reasonRows.map(([reason, count]) => (
              <div key={reason} style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: `${maxReason > 0 ? (count / maxReason) * 100 : 0}%`,
                      background: "var(--color-error-bg)",
                      borderRadius: "var(--radius-md)",
                    }}
                  />
                  <span
                    style={{
                      position: "relative",
                      display: "block",
                      padding: "0.3125rem 0.625rem",
                      fontSize: "0.8125rem",
                      color: "var(--text-primary)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {reason}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: "0.8125rem",
                    fontWeight: 800,
                    color: "var(--text-primary)",
                    fontVariantNumeric: "tabular-nums",
                    flexShrink: 0,
                  }}
                >
                  {count.toLocaleString("de-DE")}
                </span>
              </div>
            ))}
          </div>
        )}
      </AnalyseSection>
    </>
  );
}
