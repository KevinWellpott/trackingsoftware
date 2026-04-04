"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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

export async function createUser(username: string, password: string, role: "owner" | "member" = "member") {
  if (!username.trim() || !password) {
    return { error: "Benutzername und Passwort sind erforderlich." };
  }
  const supabase = await createClient();
  const m = await (await import("@/lib/workspace")).getMembership();
  if (!m || m.role !== "owner") return { error: "Keine Berechtigung." };

  const email = `${username.trim().toLowerCase()}@pitchtracker.internal`;
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
  const res = await createUser(username, password, role);
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
    .select("user_id, role, profiles (username)")
    .eq("workspace_id", workspaceId);
  if (error) return { error: error.message, users: [] };
  return {
    users: (data ?? []).map((row) => ({
      user_id: row.user_id,
      role: row.role,
      username:
        ((row.profiles as unknown) as { username: string } | null)?.username ?? row.user_id,
    })),
  };
}
