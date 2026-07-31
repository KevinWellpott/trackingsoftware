import type { ReactNode } from "react";
import { CalendarCheck, Euro, Filter, GitBranch, Handshake, Percent, Users } from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { loadClosingCalls, loadSettingCalls } from "@/lib/analyseData";
import { NUM, ownerKey, settingEffDate, closingEffDate, eur, pct, type Granularity, type QuelleKey } from "@/lib/analyse";
import { AnalyseSection, MigrationHint } from "@/components/analyse/AnalyseSection";
import { Footnote, MetricTable, type MetricRow } from "@/components/analyse/AnalyseTables";
import { BarFunnel, FunnelMatrix, KpiHero, KpiRow } from "@/components/analyse/AnalyseViz";

// End-to-End-Funnel je Quelle: LinkedIn/Telefon-Erstkontakt → Setting-Shows →
// Closings → Gewonnen → Umsatz. Verknüpft Setting- und Closing-Datensätze über
// setting_call_id. Oben Wert-Kennzahlen (Umsatz je Stufe), darunter der
// Gesamt-Funnel als BarFunnel und (ab 2 Mitgliedern) die Vergleichs-Matrix
// FunnelMatrix je Nutzer.

type Member = { user_id: string; username: string };

type FunnelStage = { label: string; value: number };

const RANGE_FMT = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

/** "2026-07-01" → "01.07.2026" (lokale Mitternacht, kein UTC-Tagessprung). */
function fmtDay(iso: string): string {
  return RANGE_FMT.format(new Date(`${iso}T00:00:00`));
}

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

type Row = { name: string; stages: FunnelStage[]; revenue: number };

const SOURCE_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  telefon: "Telefon",
  manuell: "Manuell",
  inbound: "Inbound",
  website: "Website",
  sonstige: "Sonstige",
  ohne: "Ohne Setting-Bezug",
};

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
  prevFrom?: string;
  prevTo?: string;
  granularity?: Granularity;
}) {
  const supabase = await createClient();
  const eff = canCompare ? null : access.user.id;

  const [liRes, phoneRes, settingRows, closingRows] = await Promise.all([
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
    loadSettingCalls(supabase, access, canCompare),
    loadClosingCalls(supabase, access, canCompare),
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
  // Quellen-Matrix: dieselben Stufen, aber je source_type statt je Person.
  type SourceCell = { termine: number; shows: number; closings: number; won: number; revenue: number };
  const sourceCells = new Map<string, SourceCell>();
  const sourceOfSetting = new Map<string, string>();
  const cellFor = (key: string): SourceCell => {
    let c = sourceCells.get(key);
    if (!c) {
      c = { termine: 0, shows: 0, closings: 0, won: 0, revenue: 0 };
      sourceCells.set(key, c);
    }
    return c;
  };

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

    const srcKey = (r.source_type ?? "").trim() || "sonstige";
    sourceOfSetting.set(r.id, srcKey);
    const cell = cellFor(srcKey);
    cell.termine += 1;
    if (r.show_status === "show") cell.shows += 1;
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
  for (const r of closingRows) {
    const day = closingEffDate(r);
    if (day < from || day > to) continue;
    const uid = r.created_by_user_id ?? "";
    if (!selectedIds.has(uid)) continue;
    const name = nameById.get(uid)!;

    // Die Quellen-Matrix folgt IMMER der Setting-Verknüpfung, unabhängig vom
    // Quellen-Filter — sie ist die Aufschlüsselung, die der Filter ersetzt.
    const srcKey = (r.setting_call_id ? sourceOfSetting.get(r.setting_call_id) : null) ?? "ohne";
    const cell = cellFor(srcKey);
    cell.closings += 1;
    if (r.status === "gewonnen") {
      cell.won += 1;
      cell.revenue += NUM(r.deal_volume);
    }

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

  // ── Wert-Kennzahlen (Umsatz je Stufe, null-sicher) ───────────
  const stageValue = (label: string): number =>
    totalStages.find((s) => s.label === label)?.value ?? 0;
  const firstTotal = totalStages[0]?.value ?? 0;
  const termineTotal = stageValue("Termine");
  const closingsTotal = stageValue("Closings");
  const wonTotal = stageValue("Gewonnen");
  const perValue = (basis: number): number => (basis === 0 ? 0 : Math.round(totalRevenue / basis));
  const konversion = pct(wonTotal, firstTotal) ?? 0;

  const firstLabel = quelle === "linkedin" ? "Umsatz pro DM" : "Umsatz pro Call";
  const kpis: {
    label: string;
    value: number;
    format: "int" | "pct" | "eur";
    tone: "default" | "success";
    icon: ReactNode;
  }[] = [
    // Bei quelle=alle ist die erste Stufe bereits "Termine" — die Erstkontakt-
    // Kachel wäre ein Duplikat und entfällt.
    ...(quelle === "alle"
      ? []
      : [{
          label: firstLabel,
          value: perValue(firstTotal),
          format: "eur" as const,
          tone: firstTotal > 0 ? ("success" as const) : ("default" as const),
          icon: <Euro size={15} />,
        }]),
    {
      label: "Umsatz pro Termin",
      value: perValue(termineTotal),
      format: "eur",
      tone: termineTotal > 0 ? "success" : "default",
      icon: <CalendarCheck size={15} />,
    },
    {
      label: "Umsatz pro Closing",
      value: perValue(closingsTotal),
      format: "eur",
      tone: closingsTotal > 0 ? "success" : "default",
      icon: <Handshake size={15} />,
    },
    {
      label: "Gesamt-Konversion",
      value: konversion,
      format: "pct",
      tone: "default",
      icon: <Percent size={15} />,
    },
  ];

  const quelleLabel =
    quelle === "linkedin" ? "LinkedIn" : quelle === "telefon" ? "Telefon" : quelle === "manuell" ? "Manuell" : "Alle Quellen";
  const rangeMeta = `${fmtDay(from)} – ${fmtDay(to)} · ${quelleLabel}`;

  // ── Quellen-Matrix (nur ohne Quellen-Filter — sonst bliebe eine Zeile) ──
  const matrixRows: MetricRow[] = [...sourceCells.entries()]
    .filter(([, c]) => c.termine > 0 || c.closings > 0)
    .sort((a, b) => b[1].revenue - a[1].revenue || b[1].termine - a[1].termine)
    .map(([key, c]) => ({
      key,
      label: SOURCE_LABELS[key] ?? "Sonstige",
      share: termineTotal === 0 ? null : c.termine / termineTotal,
      values: {
        termine: c.termine,
        showRate: pct(c.shows, c.termine),
        closings: c.closings,
        closingRate: pct(c.closings, c.shows),
        won: c.won,
        winRate: pct(c.won, c.closings),
        revenue: c.revenue,
      },
    }));
  const matrixTotal = [...sourceCells.values()].reduce(
    (acc, c) => {
      acc.termine += c.termine;
      acc.shows += c.shows;
      acc.closings += c.closings;
      acc.won += c.won;
      acc.revenue += c.revenue;
      return acc;
    },
    { termine: 0, shows: 0, closings: 0, won: 0, revenue: 0 },
  );

  return (
    <>
      {/* ── Wert-Kennzahlen ────────────────────────────────────── */}
      <KpiRow>
        {kpis.map((k, i) => (
          <KpiHero
            key={k.label}
            label={k.label}
            value={k.value}
            format={k.format}
            tone={k.tone}
            icon={k.icon}
            index={i}
          />
        ))}
      </KpiRow>

      {/* ── Funnel Gesamt ──────────────────────────────────────── */}
      <div className="fade-up" style={{ animationDelay: "240ms" }}>
        <AnalyseSection title="Funnel Gesamt" icon={Filter} meta={rangeMeta}>
          <BarFunnel stages={totalStages} trailing={{ label: "Umsatz", value: eur(totalRevenue) }} />
        </AnalyseSection>
      </div>

      {/* ── Quellen-Matrix ─────────────────────────────────────── */}
      {quelle === "alle" && matrixRows.length > 0 && (
        <div className="fade-up" style={{ animationDelay: "270ms" }}>
          <AnalyseSection title="Je Quelle" icon={GitBranch} meta="derselbe Trichter, aufgeschlüsselt nach Herkunft">
            <MetricTable
              label="Quelle"
              columns={[
                { key: "termine", label: "Termine", format: "int" },
                { key: "showRate", label: "Show-Quote", format: "pct" },
                { key: "closings", label: "Closings", format: "int" },
                { key: "closingRate", label: "Show → Closing", format: "pct" },
                { key: "won", label: "Gewonnen", format: "int" },
                { key: "winRate", label: "Closing → Win", format: "pct" },
                { key: "revenue", label: "Umsatz", format: "eur", emphasis: true },
              ]}
              rows={matrixRows}
              total={{
                termine: matrixTotal.termine,
                showRate: pct(matrixTotal.shows, matrixTotal.termine),
                closings: matrixTotal.closings,
                closingRate: pct(matrixTotal.closings, matrixTotal.shows),
                won: matrixTotal.won,
                winRate: pct(matrixTotal.won, matrixTotal.closings),
                revenue: matrixTotal.revenue,
              }}
              minWidth={720}
            />
            <Footnote>
              Show-Quote hier gegen alle Termine der Quelle (nicht gegen <code>no_show_count</code> wie im
              Setting-Tab) — so bleibt die Kette Termin → Show → Closing → Win in einer Zeile durchrechenbar.
            </Footnote>
          </AnalyseSection>
        </div>
      )}

      {/* ── Je Nutzer (nur bei >1 Mitglied — sonst ist Gesamt bereits die
             Einzelsicht) ──────────────────────────────────────── */}
      {rows.length > 1 && (
        <div className="fade-up" style={{ animationDelay: "300ms" }}>
          <AnalyseSection title="Je Nutzer" icon={Users} meta={`${rows.length} Mitglieder`}>
            <FunnelMatrix
              stages={totalStages.map((s) => s.label)}
              rows={rows.map((r) => ({
                name: r.name,
                values: r.stages.map((s) => s.value),
                revenue: eur(r.revenue),
              }))}
            />
          </AnalyseSection>
        </div>
      )}
    </>
  );
}
