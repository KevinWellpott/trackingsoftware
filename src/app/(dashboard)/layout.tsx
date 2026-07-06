import { createClient } from "@/lib/supabase/server";
import { getAccessContext, listDataViewUsers, buildOwnScope } from "@/lib/access";
import { MobileHeader } from "@/components/MobileHeader";
import { QuickAddLinkedIn } from "@/components/quicktrack/QuickAddLinkedIn";
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
  const phoneListsQuery = supabase
    .from("phone_lists")
    .select("id, name, owner_name, list_kind, created_by_user_id")
    .eq("workspace_id", access.workspace_id)
    .or(ownScope)
    .is("archived_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  const [{ data: lists }, { data: phoneListsData }, dataViewUsers] = await Promise.all([
    listsQuery,
    phoneListsQuery,
    access.can_switch_view ? listDataViewUsers(access.workspace_id) : Promise.resolve([]),
  ]);

  const sidebarLists = (lists ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    owner_name: (l as { owner_name?: string | null }).owner_name ?? null,
  }));

  const phoneLists = (phoneListsData ?? []).map((l) => ({
    id: l.id as string,
    name: l.name as string,
    owner_name: (l as { owner_name?: string | null }).owner_name ?? null,
    list_kind: (l as { list_kind?: "akquise" | "rueckruf" | "nicht_erreicht" }).list_kind ?? "akquise",
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
          phoneLists={phoneLists}
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
            phoneLists={phoneLists}
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
          <QuickAddLinkedIn lists={sidebarLists} />
        </main>
      </div>
    </div>
  );
}
