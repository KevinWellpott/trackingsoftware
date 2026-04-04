import { createClient } from "@/lib/supabase/server";
import type { Workspace, WorkspaceMember } from "@/lib/types";

export async function getMembership (): Promise<
  (WorkspaceMember & { workspaces: Workspace }) | null
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: row, error: me } = await supabase
    .from("workspace_members")
    .select("workspace_id, user_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (me || !row) return null;

  const { data: ws, error: we } = await supabase
    .from("workspaces")
    .select("*")
    .eq("id", row.workspace_id)
    .single();

  if (we || !ws) return null;

  return {
    workspace_id: row.workspace_id,
    user_id: row.user_id,
    role: row.role as "owner" | "member",
    workspaces: ws as Workspace,
  };
}
