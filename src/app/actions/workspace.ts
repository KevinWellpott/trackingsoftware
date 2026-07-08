"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { DATA_VIEW_COOKIE, getAccessContext, type DataScope } from "@/lib/access";
import { usernameToInternalEmail } from "@/lib/internal-email";

export async function bootstrapWorkspace(name: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bootstrap_workspace", {
    p_name: name,
  });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { workspaceId: data as string };
}

export async function joinWorkspace(inviteCode: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("join_workspace", {
    p_invite: inviteCode,
  });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { workspaceId: data as string };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function bootstrapWorkspaceForm(formData: FormData) {
  const name = String(formData.get("name") ?? "");
  const res = await bootstrapWorkspace(name);
  if (res.error) {
    redirect(`/onboarding?err=${encodeURIComponent(res.error)}`);
  }
  redirect("/");
}

export async function joinWorkspaceForm(formData: FormData) {
  const code = String(formData.get("code") ?? "");
  const res = await joinWorkspace(code);
  if (res.error) {
    redirect(`/onboarding?err=${encodeURIComponent(res.error)}`);
  }
  redirect("/");
}

export async function createUser(
  username: string,
  password: string,
  role: "owner" | "member" = "member",
  dataScope: DataScope = "workspace",
) {
  if (!username.trim() || !password) {
    return { error: "Benutzername und Passwort sind erforderlich." };
  }
  const m = await (await import("@/lib/workspace")).getMembership();
  if (!m || m.role !== "owner") return { error: "Keine Berechtigung." };

  const email = usernameToInternalEmail(username);
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) return { error: error.message };

  const uid = data.user.id;

  const { error: profileError } = await admin.from("profiles").insert({
    user_id: uid,
    username: username.trim(),
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(uid);
    return { error: profileError.message };
  }

  // Direkt zum Workspace hinzufügen
  const { error: memberError } = await admin.from("workspace_members").insert({
    workspace_id: m.workspace_id,
    user_id: uid,
    role,
    data_scope: dataScope,
  });
  if (memberError) {
    await admin.auth.admin.deleteUser(uid);
    return { error: memberError.message };
  }

  revalidatePath("/settings");
  return { userId: uid };
}

export async function deleteUser(userId: string) {
  const m = await (await import("@/lib/workspace")).getMembership();
  if (!m || m.role !== "owner") return { error: "Keine Berechtigung." };

  // Nicht sich selbst löschen
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id === userId) return { error: "Du kannst dich nicht selbst löschen." };

  const admin = createAdminClient();
  await admin.from("workspace_members").delete().eq("user_id", userId).eq("workspace_id", m.workspace_id);
  await admin.from("profiles").delete().eq("user_id", userId);
  await admin.auth.admin.deleteUser(userId);

  revalidatePath("/settings");
  return {};
}

export async function createUserForm(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = (String(formData.get("role") ?? "member")) as "owner" | "member";
  const dataScope = (String(formData.get("data_scope") ?? "workspace")) as DataScope;
  const res = await createUser(username, password, role, dataScope);
  if (res.error) {
    redirect(`/settings?userErr=${encodeURIComponent(res.error)}`);
  }
  redirect("/settings?userOk=1");
}

// Detail-Routen sind an einen konkreten – ggf. fremden – Datensatz gebunden.
// Nach einem Datensicht-Wechsel liegt dieser Datensatz evtl. nicht mehr im
// Scope der neu gewählten Person → die Detailseite würde notFound() (404).
// Deshalb solche Ziele auf ihre Sektions-Übersicht ausweichen lassen.
function safeRedirectAfterViewSwitch(next: string): string {
  if (/^\/lists\/[^/]+/.test(next)) return "/";
  if (/^\/telefon\/[^/]+/.test(next)) return "/telefon";
  if (/^\/setting\/[^/]+/.test(next)) return "/setting";
  if (/^\/closing\/[^/]+/.test(next)) return "/closing";
  return next;
}

export async function setDataViewForm(formData: FormData) {
  const access = await getAccessContext();
  if (!access?.can_switch_view) return;

  const userId = String(formData.get("view_user_id") ?? "");
  const next = String(formData.get("next") ?? "/") || "/";
  const cookieStore = await cookies();

  if (!userId) {
    cookieStore.delete(DATA_VIEW_COOKIE);
  } else {
    cookieStore.set(DATA_VIEW_COOKIE, userId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  }

  revalidatePath("/", "layout");
  redirect(safeRedirectAfterViewSwitch(next));
}

export async function renameUser(userId: string, newUsername: string) {
  const m = await (await import("@/lib/workspace")).getMembership();
  if (!m || m.role !== "owner") return { error: "Keine Berechtigung." };

  const trimmed = newUsername.trim();
  if (!trimmed) return { error: "Name darf nicht leer sein." };

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("username")
    .eq("user_id", userId)
    .maybeSingle();
  const oldUsername = (profile as { username?: string } | null)?.username;
  if (!oldUsername) return { error: "Nutzer nicht gefunden." };
  if (oldUsername === trimmed) return {};

  // Login-E-Mail wird aus dem Benutzernamen abgeleitet (siehe LoginForm) —
  // muss mit umbenannt werden, sonst kann sich der Nutzer nicht mehr einloggen.
  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    email: usernameToInternalEmail(trimmed),
    email_confirm: true,
  });
  if (authError) return { error: authError.message };

  const { error: profileError } = await admin
    .from("profiles")
    .update({ username: trimmed })
    .eq("user_id", userId);
  if (profileError) return { error: profileError.message };

  // owner_name-Kopien auf Bestandslisten nachziehen — sonst greift der
  // owner_name-Fallback (ownScopeFilter in access.ts) nach der Umbenennung
  // nicht mehr und Listen 404en wie im "Neukundengewinnung A"-Fall.
  await admin
    .from("lists")
    .update({ owner_name: trimmed })
    .eq("workspace_id", m.workspace_id)
    .eq("owner_name", oldUsername);
  await admin
    .from("phone_lists")
    .update({ owner_name: trimmed })
    .eq("workspace_id", m.workspace_id)
    .eq("owner_name", oldUsername);

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return {};
}

export async function renameUserForm(formData: FormData) {
  const userId = String(formData.get("user_id") ?? "");
  const username = String(formData.get("username") ?? "");
  const res = await renameUser(userId, username);
  if (res.error) {
    redirect(`/settings?userErr=${encodeURIComponent(res.error)}`);
  }
  redirect("/settings?userOk=1");
}

export async function deleteUserForm(formData: FormData) {
  const userId = String(formData.get("user_id") ?? "");
  if (!userId) return;
  const res = await deleteUser(userId);
  if (res.error) {
    redirect(`/settings?userErr=${encodeURIComponent(res.error)}`);
  }
  redirect("/settings");
}

export async function listUsers(workspaceId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("user_id, role, data_scope, profiles (username)")
    .eq("workspace_id", workspaceId);
  if (error) return { error: error.message, users: [] };
  return {
    users: (data ?? []).map((row) => ({
      user_id: row.user_id,
      role: row.role,
      data_scope: (row as { data_scope?: DataScope | null }).data_scope ?? "workspace",
      username:
        ((row.profiles as unknown) as { username: string } | null)?.username ?? row.user_id,
    })),
  };
}
