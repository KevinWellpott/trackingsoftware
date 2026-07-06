import { Filter } from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { NUM, ownerKey, settingEffDate, closingEffDate, eur, type QuelleKey } from "@/lib/analyse";
import { AnalyseSection, MigrationHint } from "@/components/analyse/AnalyseSection";
import { FunnelStrip, type FunnelStage } from "@/components/analyse/FunnelStrip";

// End-to-End-Funnel je Quelle: LinkedIn/Telefon-Erstkontakt → Setting-Shows →
// Closings → Gewonnen → Umsatz. Verknüpft Setting- und Closing-Datensätze über
// setting_call_id.

type Member = { user_id: string; username: string };

type OwnerDayRow = {
  owner_name: string | null;
  dms: number | string | null;
  answers: number | string | null;
  appts: number | string | null;
};

type PhoneDayRow = {
  owner_name: string | null;
  calls: number | string | null;
  decider_reached: number | string | null;
  appointments: number | string | null;
};

type SettingRow = {
  id: string;
  created_by_user_id: string | null;
  source_type: string | null;
  appointment_at: string | null;
  call_at: string | null;
  created_at: string;
  show_status: "show" | "no_show" | null;
};

type ClosingRow = {
  created_by_user_id: string | null;
  setting_call_id: string | null;
  call_at: string | null;
  created_at: string;
  status: "offen" | "gewonnen" | "verloren" | "nachfassen";
  deal_volume: number | null;
};

type Row = { name: string; stages: FunnelStage[]; revenue: number };

export async function FunnelTab({
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
  const eff = canCompare ? null : access.user.id;

  let settingQuery = supabase
    .from("setting_calls")
    .select("id, created_by_user_id, source_type, appointment_at, call_at, created_at, show_status")
    .eq("workspace_id", access.workspace_id);
  let closingQuery = supabase
    .from("closing_calls")
    .select("created_by_user_id, setting_call_id, call_at, created_at, status, deal_volume")
    .eq("workspace_id", access.workspace_id);
  if (!canCompare) {
    settingQuery = settingQuery.eq("created_by_user_id", access.user.id);
    closingQuery = closingQuery.eq("created_by_user_id", access.user.id);
  }

  const [liRes, phoneRes, settingRes, closingRes] = await Promise.all([
    supabase.rpc("rpc_owner_day_metrics", {
      p_workspace_id: access.workspace_id,
      p_from: from,
      p_to: to,
      p_effective_user_id: eff,
    }),
    supabase.rpc("rpc_phone_day_metrics", {
      p_workspace_id: access.workspace_id,
      p_from: from,
      p_to: to,
      p_effective_user_id: eff,
    }),
    settingQuery,
    closingQuery,
  ]);

  if (quelle === "telefon" && phoneRes.error) {
    return <MigrationHint>Telefon-Analyse benötigt die neueste Datenbank-Migration (0013).</MigrationHint>;
  }

  const names = selectedMembers.map((m) => m.username);
  const nameByOwnerKey = new Map<string, string>();
  for (const m of selectedMembers) nameByOwnerKey.set(ownerKey(m.username), m.username);
  const nameById = new Map(selectedMembers.map((m) => [m.user_id, m.username]));
  const selectedIds = new Set(selectedMembers.map((m) => m.user_id));

  // ── Erstkontakt-Kennzahlen aus RPC (nur linkedin/telefon) ────
  const first = new Map<string, { a: number; b: number; c: number }>();
  for (const name of names) first.set(name, { a: 0, b: 0, c: 0 });
  if (quelle === "linkedin") {
    const rows = liRes.error ? [] : ((liRes.data ?? []) as OwnerDayRow[]);
    for (const r of rows) {
      const name = nameByOwnerKey.get(ownerKey(r.owner_name));
      if (!name) continue;
      const t = first.get(name)!;
      t.a += NUM(r.dms);
      t.b += NUM(r.answers);
      t.c += NUM(r.appts);
    }
  } else if (quelle === "telefon") {
    const rows = phoneRes.error ? [] : ((phoneRes.data ?? []) as PhoneDayRow[]);
    for (const r of rows) {
      const name = nameByOwnerKey.get(ownerKey(r.owner_name));
      if (!name) continue;
      const t = first.get(name)!;
      t.a += NUM(r.calls);
      t.b += NUM(r.decider_reached);
      t.c += NUM(r.appointments);
    }
  }

  // ── Setting: Shows + relevante setting_call_ids je Mitglied ──
  const settingTermine = new Map<string, number>();
  const settingShows = new Map<string, number>();
  const settingIds = new Map<string, Set<string>>();
  for (const name of names) {
    settingTermine.set(name, 0);
    settingShows.set(name, 0);
    settingIds.set(name, new Set());
  }
  const settingRows = (settingRes.data ?? []) as SettingRow[];
  for (const r of settingRows) {
    const day = settingEffDate(r);
    if (day < from || day > to) continue;
    const uid = r.created_by_user_id ?? "";
    if (!selectedIds.has(uid)) continue;
    const name = nameById.get(uid)!;
    if (quelle !== "alle" && r.source_type !== quelle) continue;
    settingTermine.set(name, settingTermine.get(name)! + 1);
    if (r.show_status === "show") settingShows.set(name, settingShows.get(name)! + 1);
    settingIds.get(name)!.add(r.id);
  }

  // ── Closings: je Mitglied (linkedin/telefon über setting_call_id) ──
  const closingCount = new Map<string, number>();
  const wonCount = new Map<string, number>();
  const revenue = new Map<string, number>();
  for (const name of names) {
    closingCount.set(name, 0);
    wonCount.set(name, 0);
    revenue.set(name, 0);
  }
  const closingRows = (closingRes.data ?? []) as ClosingRow[];
  for (const r of closingRows) {
    const day = closingEffDate(r);
    if (day < from || day > to) continue;
    const uid = r.created_by_user_id ?? "";
    if (!selectedIds.has(uid)) continue;
    const name = nameById.get(uid)!;
    if (quelle !== "alle") {
      const ids = settingIds.get(name)!;
      if (!r.setting_call_id || !ids.has(r.setting_call_id)) continue;
    }
    closingCount.set(name, closingCount.get(name)! + 1);
    if (r.status === "gewonnen") {
      wonCount.set(name, wonCount.get(name)! + 1);
      revenue.set(name, revenue.get(name)! + NUM(r.deal_volume));
    }
  }

  // ── Stufen je Mitglied bauen ─────────────────────────────────
  const buildRow = (name: string): Row => {
    const t = first.get(name)!;
    const rev = revenue.get(name)!;
    const stages: FunnelStage[] =
      quelle === "linkedin"
        ? [
            { label: "DMs", value: t.a },
            { label: "Antworten", value: t.b },
            { label: "Termine", value: t.c },
            { label: "Setting-Shows", value: settingShows.get(name)! },
            { label: "Closings", value: closingCount.get(name)! },
            { label: "Gewonnen", value: wonCount.get(name)! },
          ]
        : quelle === "telefon"
          ? [
              { label: "Calls", value: t.a },
              { label: "Entscheider", value: t.b },
              { label: "Termine", value: t.c },
              { label: "Setting-Shows", value: settingShows.get(name)! },
              { label: "Closings", value: closingCount.get(name)! },
              { label: "Gewonnen", value: wonCount.get(name)! },
            ]
          : [
              { label: "Termine", value: settingTermine.get(name)! },
              { label: "Shows", value: settingShows.get(name)! },
              { label: "Closings", value: closingCount.get(name)! },
              { label: "Gewonnen", value: wonCount.get(name)! },
            ];
    return { name, stages, revenue: rev };
  };

  const rows = names.map(buildRow);

  // ── Gesamt (Summen je Stufe) ─────────────────────────────────
  const stageCount = rows[0]?.stages.length ?? 0;
  const totalStages: FunnelStage[] = [];
  for (let i = 0; i < stageCount; i++) {
    totalStages.push({
      label: rows[0].stages[i].label,
      value: rows.reduce((acc, r) => acc + r.stages[i].value, 0),
    });
  }
  const totalRevenue = rows.reduce((acc, r) => acc + r.revenue, 0);

  const sub =
    quelle === "linkedin"
      ? "LinkedIn → Setting → Closing → Umsatz"
      : quelle === "telefon"
        ? "Telefon → Setting → Closing → Umsatz"
        : "Setting → Closing → Umsatz";

  return (
    <AnalyseSection title="Funnel" icon={Filter} meta={sub}>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <FunnelStrip
          label="Gesamt"
          highlight
          stages={totalStages}
          trailing={{ label: "Umsatz", value: eur(totalRevenue) }}
        />
        {rows.map((r) => (
          <FunnelStrip
            key={r.name}
            label={r.name}
            stages={r.stages}
            trailing={{ label: "Umsatz", value: eur(r.revenue) }}
          />
        ))}
      </div>
    </AnalyseSection>
  );
}
