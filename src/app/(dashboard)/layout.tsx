import { createClient } from "@/lib/supabase/server";
import { getAccessContext, listDataViewUsers, buildOwnScope } from "@/lib/access";
import { MobileHeader } from "@/components/MobileHeader";
import { QuickAddLinkedIn } from "@/components/quicktrack/QuickAddLinkedIn";
import { SidebarContent } from "@/components/Sidebar";
import { ForeignOrgBanner } from "@/components/ForeignOrgBanner";
import { buildViewTree, type ViewRow } from "@/lib/listViews";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = await getAccessContext();
  if (!access) redirect("/onboarding");

  const supabase = await createClient();
  // Sidebar ist strikt persönlich: immer auf den effektiven Nutzer filtern
  // (Datensicht-Impersonation oder der eingeloggte Nutzer selbst).
  const scopeUserId = access.effective_user_id ?? access.user.id;
  const scopeUsername = access.effective_username ?? access.username;
  const ownScope = buildOwnScope(scopeUserId, scopeUsername);
  const listsQuery = supabase
    .from("lists")
    .select("id, name, archived_at, owner_name")
    .eq("workspace_id", access.workspace_id)
    .or(ownScope)
    .is("archived_at", null)
    .order("sort_order", { ascending: true });
  // Smart Views fuer den Sidebar-Baum. Gleicher Scope wie die Listen.
  const viewsQuery = supabase
    .from("list_views")
    .select("id, name, parent_id, sort_order, filters")
    .eq("workspace_id", access.workspace_id)
    .or(ownScope)
    .order("sort_order", { ascending: true });
  const phoneListsQuery = supabase
    .from("phone_lists")
    .select("id, name, owner_name, list_kind, created_by_user_id")
    .eq("workspace_id", access.workspace_id)
    .or(ownScope)
    .is("archived_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  const [{ data: lists }, { data: phoneListsData }, { data: viewRows }, dataViewUsers] = await Promise.all([
    listsQuery,
    phoneListsQuery,
    viewsQuery,
    access.can_switch_view ? listDataViewUsers(access.workspace_id) : Promise.resolve([]),
  ]);

  const sidebarLists = (lists ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    owner_name: (l as { owner_name?: string | null }).owner_name ?? null,
  }));

  // list_views existiert erst nach Migration 0023 — bis dahin liefert die
  // Abfrage einen Fehler und `viewRows` ist null. Der Baum bleibt dann leer,
  // statt die ganze App zu blockieren.
  const viewTree = buildViewTree((viewRows ?? []) as ViewRow[]);

  // Nur Plattform-Admins bekommen den Umschalter — fuer alle anderen bleibt
  // orgSwitch undefined und die Sidebar rendert exakt wie bisher.
  const orgSwitch = access.is_platform_admin
    ? {
        activeId: access.workspace_id,
        activeName: access.workspaces.name,
        homeId: access.home_workspace_id,
        isForeign: access.is_foreign_org,
        orgs: access.available_workspaces,
      }
    : undefined;

  const phoneLists = (phoneListsData ?? []).map((l) => ({
    id: l.id as string,
    name: l.name as string,
    owner_name: (l as { owner_name?: string | null }).owner_name ?? null,
    list_kind: (l as { list_kind?: "akquise" | "rueckruf" | "nicht_erreicht" }).list_kind ?? "akquise",
  }));

  return (
    <div style={{ display: "flex", minHeight: "100dvh", background: "var(--surface-0)" }}>
      {/* Desktop Sidebar — 248px, solid, rechte Kante als 1px-Linie. */}
      <aside
        style={{
          width: "var(--w-sidebar)",
          flexShrink: 0,
          borderRight: "1px solid var(--border-default)",
          position: "sticky",
          top: 0,
          height: "100dvh",
          overflow: "hidden",
        }}
        className="hidden md:block"
      >
        <SidebarContent
          workspaceName={access.workspaces.name}
          username={access.username}
          workspaceId={access.workspace_id}
          lists={sidebarLists}
          phoneLists={phoneLists}
          viewTree={viewTree}
          dataScope={access.data_scope}
          dataView={{
            canSwitch: access.can_switch_view,
            activeUserId: access.effective_user_id,
            activeLabel: access.effective_username ?? "Alle Daten",
            users: dataViewUsers,
          }}
          orgSwitch={orgSwitch}
        />
      </aside>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Mobile header */}
        <div className="md:hidden">
          <MobileHeader
            workspaceName={access.workspaces.name}
            username={access.username}
            workspaceId={access.workspace_id}
            lists={sidebarLists}
            phoneLists={phoneLists}
            viewTree={viewTree}
            dataScope={access.data_scope}
            dataView={{
              canSwitch: access.can_switch_view,
              activeUserId: access.effective_user_id,
              activeLabel: access.effective_username ?? "Alle Daten",
              users: dataViewUsers,
            }}
            orgSwitch={orgSwitch}
          />
        </div>

        {/* Content-Maxbreite 1440px (DESIGN.md §8), Blockabstand ueber --sp-9. */}
        <main
          className="main-content"
          style={{
            flex: 1,
            width: "100%",
            maxWidth: 1440,
            margin: "0 auto",
            padding: "var(--sp-9)",
          }}
        >
          {access.is_foreign_org && <ForeignOrgBanner name={access.workspaces.name} />}
          {children}
          <QuickAddLinkedIn lists={sidebarLists} />
        </main>
      </div>
    </div>
  );
}
