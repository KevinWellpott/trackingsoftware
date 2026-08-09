import { buildOwnScope, getAccessContext, listDataViewUsers, type AccessContext } from "@/lib/access";
import { berlinDateISO } from "@/lib/apptTime";
import { parseAnalyseParams, prevRange } from "@/lib/analyse";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { AnalyseFilterBar, type ListFilterOption } from "@/components/analyse/AnalyseFilterBar";
import { PageHeader } from "@/components/ui/PageHeader";
import { UebersichtTab } from "@/components/analyse/tabs/UebersichtTab";
import { LinkedInTab } from "@/components/analyse/tabs/LinkedInTab";
import { TelefonTab } from "@/components/analyse/tabs/TelefonTab";
import { SettingTab } from "@/components/analyse/tabs/SettingTab";
import { ClosingTab } from "@/components/analyse/tabs/ClosingTab";
import { FunnelTab } from "@/components/analyse/tabs/FunnelTab";

// Deep-Analytics-Bereich: sechs Flow-Tabs mit Zeitraum-, Nutzer- und
// tab-spezifischen Filtern.
//
//   Übersicht   beide Kanäle + Termin-Funnel + Umsatz auf einer Seite
//   LinkedIn    DMs → Antworten → Termine, Consistency, Follow-ups, Listen
//   Telefon     Calls → Gatekeeper → Entscheider → Termine
//   Setting     Termine → Shows → Qualifikation, inkl. Ursachen-Schnitte
//   Closing     Abschlüsse, Umsatz, Geschwindigkeit
//   Funnel      End-to-End je Quelle und je Person
//
// Die früheren Tabs „Follow-ups" und „Listen" sind im LinkedIn-Tab aufgegangen:
// beides sind LinkedIn-Kennzahlen, und drei Tabs für einen Kanal zwangen zum
// Hin- und Herspringen, sobald man DMs, Nachfassen und Listen zusammen las.
//
// Alles läuft gegen die AKTIVE Organisation (access.workspace_id) — für einen
// Plattform-Admin also gegen die per Org-Umschalter gewählte. Owner mit
// Workspace-Sicht vergleichen Mitglieder; Member sehen nur eigene Daten.

export const dynamic = "force-dynamic";

type Member = { user_id: string; username: string };

type ListRow = {
  id: string;
  name: string | null;
  owner_name: string | null;
  created_by_user_id: string | null;
  archived_at: string | null;
};

/**
 * Auswahlliste für den Listen-Filter des LinkedIn-Tabs.
 *
 * Bewusst nur hier und nur für diesen Tab geladen: Die Leiste braucht Namen,
 * die Auswertung darunter braucht sie nicht (dort kommt der Name über die
 * eingebettete Liste am Kontakt mit). Der Personen-Scope spiegelt
 * `list_owned_by_user()`: `owner_name` hat Vorrang, der Ersteller greift nur
 * ohne Namen — sonst böte die Leiste einem Mitglied Listen an, deren Kontakte
 * es gar nicht sehen darf, und der Filter liefe ins Leere.
 */
async function loadFilterLists(
  supabase: Awaited<ReturnType<typeof createClient>>,
  access: AccessContext,
  canCompare: boolean,
): Promise<ListFilterOption[]> {
  const rows = await fetchAllRows<ListRow>((f, t) => {
    let q = supabase
      .from("lists")
      .select("id, name, owner_name, created_by_user_id, archived_at")
      .eq("workspace_id", access.workspace_id);
    if (!canCompare) q = q.or(buildOwnScope(access.user.id, access.username));
    // Stabile Sortierung ist Pflicht, sonst überlappen sich die Seiten.
    return q.order("id").range(f, t);
  }).catch((err) => {
    console.error("loadFilterLists:", err instanceof Error ? err.message : err);
    return [] as ListRow[];
  });

  return rows
    .map((l) => ({
      id: l.id,
      name: l.name?.trim() || "Unbenannte Liste",
      owner: l.owner_name?.trim() || null,
      archived: Boolean(l.archived_at),
    }))
    // Archivierte nach hinten: sie sind der Sonderfall, nicht der Regelfall.
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, "de"));
}

export default async function AnalysePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const access = await getAccessContext();
  if (!access) return null;

  const members = await listDataViewUsers(access.workspace_id);
  // Berliner Kalendertag, nicht die Server-Uhr. Vercel laeuft in UTC — mit
  // `localDateISO()` haette „heute" zwischen 00:00 und 02:00 Berliner Zeit noch
  // den Vortag gemeint, und damit auch das `bis` jedes Zeitraum-Presets. Der
  // gesamte Analysebereich bucketet ueber Berlin-Tage (`berlinDateISO`), also
  // muss die Grenze aus derselben Quelle kommen.
  const today = berlinDateISO(new Date().toISOString());
  const params = parseAnalyseParams(sp, today);
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

  // ── Listen-Filter (nur LinkedIn) ─────────────────────────────
  // `parseAnalyseParams` prüft die IDs nur syntaktisch; ob sie zu einer real
  // sichtbaren Liste gehören, entscheidet erst dieser Abgleich. Ohne ihn ließe
  // eine fremde UUID in der URL den Tab leer laufen, statt sie zu ignorieren.
  const isLinkedIn = params.tab === "linkedin";
  const supabase = await createClient();
  const filterLists = isLinkedIn ? await loadFilterLists(supabase, access, canCompare) : [];
  const knownListIds = new Set(filterLists.map((l) => l.id));
  const selectedListIds = isLinkedIn ? params.listIds.filter((id) => knownListIds.has(id)) : [];

  const memberProps: Member[] = selectedMembers.map((m) => ({ user_id: m.user_id, username: m.username }));
  const showQuelle = params.tab === "setting" || params.tab === "funnel";
  const prev = prevRange(params.from, params.to);

  const common = {
    access,
    from: params.from,
    to: params.to,
    prevFrom: prev.from,
    prevTo: prev.to,
    today,
    granularity: params.g,
    selectedMembers: memberProps,
    canCompare,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      {/* ══ HEADER ══ */}
      <PageHeader eyebrow="Auswertung" title="Analyse" meta={access.workspaces.name} />

      {/* ══ FILTER ══ */}
      {/* from/to sind IMMER das aufgelöste Fenster — auch bei "Eigener" ohne
          Eingabe (dann der laufende Monat). Die Leiste beschriftet damit ihren
          Ausschnitt UND belegt die Datumsfelder vor; ein roher sp.von-Wert
          könnte ungültig sein und stünde dann im Feld, ohne dass die Auswertung
          daneben ihm folgt. (Früher gingen dieselben zwei Werte doppelt als
          von/bis und from/to raus.) */}
      <AnalyseFilterBar
        tab={params.tab}
        rangeKey={params.rangeKey}
        hasCustomDates={params.hasCustomDates}
        from={params.from}
        to={params.to}
        quelle={params.quelle}
        granularity={params.g}
        reife={params.reife}
        modus={params.modus}
        selectedUserIds={selectedUserIds}
        users={members.map((m) => ({ user_id: m.user_id, username: m.username }))}
        lists={filterLists}
        selectedListIds={selectedListIds}
        canCompare={canCompare}
        showQuelle={showQuelle}
        selfName={access.username}
      />

      {/* ══ FLOW-TAB ══ */}
      {params.tab === "uebersicht" && <UebersichtTab {...common} allSelected={allSelected} />}
      {params.tab === "linkedin" && (
        <LinkedInTab
          {...common}
          allSelected={allSelected}
          reife={params.reife}
          listIds={selectedListIds}
        />
      )}
      {params.tab === "telefon" && <TelefonTab {...common} allSelected={allSelected} />}
      {params.tab === "setting" && <SettingTab {...common} quelle={params.quelle} allSelected={allSelected} />}
      {params.tab === "closing" && <ClosingTab {...common} allSelected={allSelected} />}
      {params.tab === "funnel" && (
        <FunnelTab {...common} quelle={params.quelle} modus={params.modus} allSelected={allSelected} />
      )}
    </div>
  );
}
