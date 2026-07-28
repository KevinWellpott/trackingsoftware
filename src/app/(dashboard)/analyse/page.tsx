import { getAccessContext, listDataViewUsers } from "@/lib/access";
import { localDateISO } from "@/lib/dates";
import { parseAnalyseParams, prevRange } from "@/lib/analyse";
import { AnalyseFilterBar } from "@/components/analyse/AnalyseFilterBar";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkedInTab } from "@/components/analyse/tabs/LinkedInTab";
import { TelefonTab } from "@/components/analyse/tabs/TelefonTab";
import { SettingTab } from "@/components/analyse/tabs/SettingTab";
import { ClosingTab } from "@/components/analyse/tabs/ClosingTab";
import { FunnelTab } from "@/components/analyse/tabs/FunnelTab";

// Deep-Analytics-Bereich: fünf Flow-Tabs (LinkedIn · Telefon · Setting · Closing
// · Funnel) mit Zeitraum-, Nutzer- und Quellen-Filter. Owner mit Workspace-Sicht
// vergleichen Mitglieder; Member sehen nur eigene Daten.

export const dynamic = "force-dynamic";

type Member = { user_id: string; username: string };

export default async function AnalysePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const access = await getAccessContext();
  if (!access) return null;

  const members = await listDataViewUsers(access.workspace_id);
  const params = parseAnalyseParams(sp, localDateISO());
  const canCompare = access.can_switch_view;

  // ── Ausgewählte Mitglieder auflösen ──────────────────────────
  let selectedMembers: Member[];
  let selectedUserIds: string[] = [];
  let allSelected = false;

  if (!canCompare) {
    selectedMembers = [{ user_id: access.user.id, username: access.username }];
  } else {
    const memberIds = new Set(members.map((m) => m.user_id));
    const validIds = params.userIds.filter((id) => memberIds.has(id));
    selectedUserIds = validIds;
    if (validIds.length > 0) {
      selectedMembers = members.filter((m) => validIds.includes(m.user_id));
    } else if (access.effective_user_id && memberIds.has(access.effective_user_id)) {
      selectedMembers = members.filter((m) => m.user_id === access.effective_user_id);
    } else {
      selectedMembers = members.map((m) => ({ user_id: m.user_id, username: m.username }));
      allSelected = true;
    }
  }

  const memberProps: Member[] = selectedMembers.map((m) => ({ user_id: m.user_id, username: m.username }));
  const showQuelle = params.tab === "setting" || params.tab === "funnel";
  const prev = prevRange(params.from, params.to);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      {/* ══ HEADER ══ */}
      <PageHeader eyebrow="Auswertung" title="Analyse" meta="Flows · Vergleich · Zeiträume" />

      {/* ══ FILTER ══ */}
      <AnalyseFilterBar
        tab={params.tab}
        rangeKey={params.rangeKey}
        von={sp.von ?? params.from}
        bis={sp.bis ?? params.to}
        from={params.from}
        to={params.to}
        quelle={params.quelle}
        granularity={params.g}
        selectedUserIds={selectedUserIds}
        users={members.map((m) => ({ user_id: m.user_id, username: m.username }))}
        canCompare={canCompare}
        showQuelle={showQuelle}
        selfName={access.username}
      />

      {/* ══ FLOW-TAB ══ */}
      {params.tab === "linkedin" && (
        <LinkedInTab
          access={access}
          from={params.from}
          to={params.to}
          prevFrom={prev.from}
          prevTo={prev.to}
          granularity={params.g}
          selectedMembers={memberProps}
          canCompare={canCompare}
          allSelected={allSelected}
        />
      )}
      {params.tab === "telefon" && (
        <TelefonTab
          access={access}
          from={params.from}
          to={params.to}
          prevFrom={prev.from}
          prevTo={prev.to}
          granularity={params.g}
          selectedMembers={memberProps}
          canCompare={canCompare}
          allSelected={allSelected}
        />
      )}
      {params.tab === "setting" && (
        <SettingTab
          access={access}
          from={params.from}
          to={params.to}
          prevFrom={prev.from}
          prevTo={prev.to}
          granularity={params.g}
          selectedMembers={memberProps}
          canCompare={canCompare}
          quelle={params.quelle}
        />
      )}
      {params.tab === "closing" && (
        <ClosingTab
          access={access}
          from={params.from}
          to={params.to}
          prevFrom={prev.from}
          prevTo={prev.to}
          granularity={params.g}
          selectedMembers={memberProps}
          canCompare={canCompare}
        />
      )}
      {params.tab === "funnel" && (
        <FunnelTab
          access={access}
          from={params.from}
          to={params.to}
          prevFrom={prev.from}
          prevTo={prev.to}
          granularity={params.g}
          selectedMembers={memberProps}
          canCompare={canCompare}
          quelle={params.quelle}
        />
      )}
    </div>
  );
}
