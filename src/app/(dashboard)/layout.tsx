import { createClient } from "@/lib/supabase/server";
import { getAccessContext, listDataViewUsers } from "@/lib/access";
import { MobileHeader } from "@/components/MobileHeader";
import { SidebarContent } from "@/components/Sidebar";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = await getAccessContext();
  if (!access) redirect("/onboarding");

  const supabase = await createClient();
  let listsQuery = supabase
    .from("lists")
    .select("id, name, archived_at, owner_name")
    .eq("workspace_id", access.workspace_id)
    .is("archived_at", null)
    .order("sort_order", { ascending: true });
  let organicListsQuery = supabase
    .from("organic_lists")
    .select("id, name, owner_name")
    .eq("workspace_id", access.workspace_id)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (access.effective_user_id) {
    listsQuery = listsQuery.eq("created_by_user_id", access.effective_user_id);
    organicListsQuery = organicListsQuery.eq("created_by_user_id", access.effective_user_id);
  }

  const [{ data: lists }, { data: organicListsData }, dataViewUsers] = await Promise.all([
    listsQuery,
    organicListsQuery,
    access.can_switch_view ? listDataViewUsers(access.workspace_id) : Promise.resolve([]),
  ]);

  const sidebarLists = (lists ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    owner_name: (l as { owner_name?: string | null }).owner_name ?? null,
  }));

  const organicLists = (organicListsData ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    owner_name: (l as { owner_name?: string | null }).owner_name ?? null,
  }));

  return (
    <div style={{ display: "flex", minHeight: "100dvh" }}>
      {/* Desktop Sidebar */}
      <aside
        style={{
          width: 220,
          flexShrink: 0,
          borderRight: "1px solid var(--border-bright)",
          position: "sticky",
          top: 0,
          height: "100dvh",
          overflowY: "auto",
        }}
        className="hidden md:block"
      >
        <SidebarContent
          workspaceName={access.workspaces.name}
          username={access.username}
          workspaceId={access.workspace_id}
          lists={sidebarLists}
          organicLists={organicLists}
          dataScope={access.data_scope}
          dataView={{
            canSwitch: access.can_switch_view,
            activeUserId: access.effective_user_id,
            activeLabel: access.effective_username ?? "Alle Daten",
            users: dataViewUsers,
          }}
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
            organicLists={organicLists}
            dataScope={access.data_scope}
            dataView={{
              canSwitch: access.can_switch_view,
              activeUserId: access.effective_user_id,
              activeLabel: access.effective_username ?? "Alle Daten",
              users: dataViewUsers,
            }}
          />
        </div>

        <main
          className="main-content"
          style={{
            flex: 1,
            padding: "2rem",
            maxWidth: "100%",
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
