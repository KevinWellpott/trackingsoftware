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
  const { data, error } = await supabase
    .from("workspace_members")
    .select("user_id, data_scope, profiles (username)")
    .eq("workspace_id", workspaceId)
    .order("role", { ascending: true });

  // Nicht still verschlucken: ohne FK workspace_members→profiles schlägt der
  // Embed mit PGRST200 fehl und alle Nutzer-Picker wären leer.
  if (error) {
    console.error("listDataViewUsers:", error.message);
    return [];
  }

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

// created_by_user_id ist "wer hat den DB-Eintrag angelegt" (z.B. ein Owner,
// der über das Owner-Dropdown eine Liste FÜR ein anderes Teammitglied
// anlegt) — NICHT zwingend "wem gehört die Liste". owner_name ist die
// eigentliche Zuordnung und hat deshalb Vorrang. created_by_user_id wird
// nur als Fallback genutzt, wenn owner_name NULL ist (echte Altbestände
// ohne Namensfeld, z.B. nach Löschen+Neuanlegen eines Nutzers). Ohne diesen
// Vorrang tauchen fälschlich fremde Listen beim Ersteller auf, sobald
// jemand für ein anderes Teammitglied eine Liste anlegt.
export function buildOwnScope(userId: string, username: string): string {
  const safeUsername = username.replaceAll('"', "");
  return `owner_name.eq."${safeUsername}",and(owner_name.is.null,created_by_user_id.eq.${userId})`;
}

// Für Detail-/Action-Routen: nur scopen, wenn der Zugriff auf einen
// bestimmten Nutzer eingeschränkt ist (Datensicht "own" oder aktive
// Impersonation). Bei workspace-weitem Zugriff (z.B. Owner ohne aktive
// Datensicht) wird nicht gefiltert — dort ist `null` das korrekte Ergebnis.
export function ownScopeFilter(access: AccessContext): string | null {
  if (!access.effective_user_id) return null;
  return buildOwnScope(access.effective_user_id, access.effective_username ?? "");
}
