import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/workspace";
import { MobileHeader } from "@/components/MobileHeader";
import { SidebarContent } from "@/components/Sidebar";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const m = await getMembership();
  if (!m) redirect("/onboarding");

  const supabase = await createClient();

  const [{ data: lists }, { data: organicListsData }, userResult] = await Promise.all([
    supabase
      .from("lists")
      .select("id, name, archived_at, owner_name")
      .eq("workspace_id", m.workspace_id)
      .is("archived_at", null)
      .order("sort_order", { ascending: true }),
    supabase
      .from("organic_lists")
      .select("id, name, owner_name")
      .eq("workspace_id", m.workspace_id)
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase.auth.getUser(),
  ]);

  const { data: profileData } = await supabase
    .from("profiles")
    .select("username")
    .eq("user_id", userResult.data.user?.id ?? "")
    .maybeSingle();

  const username =
    (profileData as { username: string } | null)?.username ??
    m.workspaces.name;

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
          workspaceName={m.workspaces.name}
          username={username}
          workspaceId={m.workspace_id}
          lists={sidebarLists}
          organicLists={organicLists}
        />
      </aside>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Mobile header */}
        <div className="md:hidden">
          <MobileHeader
            workspaceName={m.workspaces.name}
            username={username}
            workspaceId={m.workspace_id}
            lists={sidebarLists}
            organicLists={organicLists}
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
