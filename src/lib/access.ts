import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { Workspace } from "@/lib/types";

export const DATA_VIEW_COOKIE = "pt_data_view_user_id";

export type DataScope = "workspace" | "own";

export type DataViewUser = {
  user_id: string;
  username: string;
  data_scope: DataScope;
};

export type AccessContext = {
  user: { id: string };
  workspace_id: string;
  role: "owner" | "member";
  data_scope: DataScope;
  workspaces: Workspace;
  username: string;
  effective_user_id: string | null;
  effective_username: string | null;
  can_switch_view: boolean;
};

type MemberRow = {
  workspace_id: string;
  user_id: string;
  role: "owner" | "member";
  data_scope?: DataScope | null;
};

type ProfileRow = { username: string } | null;

export async function getAccessContext(): Promise<AccessContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: member, error: memberError } = await supabase
    .from("workspace_members")
    .select("workspace_id, user_id, role, data_scope")
    .eq("user_id", user.id)
    .maybeSingle();

  if (memberError || !member) return null;
  const row = member as MemberRow;

  const [{ data: workspace }, { data: profile }] = await Promise.all([
    supabase
      .from("workspaces")
      .select("*")
      .eq("id", row.workspace_id)
      .single(),
    supabase
      .from("profiles")
      .select("username")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  if (!workspace) return null;

  const dataScope = row.data_scope ?? "workspace";
  const username = ((profile as ProfileRow)?.username ?? workspace.name) as string;
  const canSwitchView = row.role === "owner" && dataScope === "workspace";
  let effectiveUserId: string | null = dataScope === "own" ? user.id : null;
  let effectiveUsername: string | null = dataScope === "own" ? username : null;

  if (canSwitchView) {
    const cookieStore = await cookies();
    const requestedUserId = cookieStore.get(DATA_VIEW_COOKIE)?.value;
    if (requestedUserId) {
      const { data: target } = await supabase
        .from("workspace_members")
        .select("user_id, data_scope, profiles (username)")
        .eq("workspace_id", row.workspace_id)
        .eq("user_id", requestedUserId)
        .maybeSingle();

      const targetRow = target as
        | {
            user_id: string;
            data_scope?: DataScope | null;
            profiles: { username: string } | null;
          }
        | null;

      if (targetRow) {
        effectiveUserId = targetRow.user_id;
        effectiveUsername = targetRow.profiles?.username ?? "Ausgewählter Nutzer";
      }
    }
  }

  return {
    user: { id: user.id },
    workspace_id: row.workspace_id,
    role: row.role,
    data_scope: dataScope,
    workspaces: workspace as Workspace,
    username,
    effective_user_id: effectiveUserId,
    effective_username: effectiveUsername,
    can_switch_view: canSwitchView,
  };
}

export async function listDataViewUsers(workspaceId: string): Promise<DataViewUser[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("workspace_members")
    .select("user_id, data_scope, profiles (username)")
    .eq("workspace_id", workspaceId)
    .order("role", { ascending: true });

  return ((data ?? []) as unknown as {
    user_id: string;
    data_scope?: DataScope | null;
    profiles: { username: string } | null;
  }[])
    .map((row) => ({
      user_id: row.user_id,
      username: row.profiles?.username ?? row.user_id,
      data_scope: row.data_scope ?? "workspace",
    }))
    .sort((a, b) => a.username.localeCompare(b.username, "de"));
}

export function isScopedToUser(access: AccessContext): access is AccessContext & {
  effective_user_id: string;
  effective_username: string;
} {
  return Boolean(access.effective_user_id);
}
