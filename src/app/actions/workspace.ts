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

/**
 * Nutzer in einer BESTIMMTEN Organisation anlegen.
 *
 * Erlaubt fuer Plattform-Admins (beliebige Organisation) und fuer Owner ihrer
 * eigenen aktiven Organisation. Die Pruefung steht in der Funktion selbst,
 * nicht beim Aufrufer: als Server Action ist sie vom Client erreichbar.
 */
export async function createUserInWorkspace(
  workspaceId: string,
  username: string,
  password: string,
  role: "owner" | "member" = "member",
  dataScope: DataScope = "workspace",
) {
  if (!username.trim() || !password) {
    return { error: "Benutzername und Passwort sind erforderlich." };
  }
  const access = await getAccessContext();
  if (!access) return { error: "Keine Berechtigung." };

  const mayCreate =
    access.is_platform_admin ||
    (access.workspace_id === workspaceId && access.role === "owner");
  if (!mayCreate) return { error: "Keine Berechtigung." };

  const trimmed = username.trim();
  const email = usernameToInternalEmail(trimmed);
  const admin = createAdminClient();

  if (email === "@pitchtracker.internal") {
    return { error: "Benutzername enthält keine verwendbaren Zeichen (a–z, 0–9)." };
  }

  // Benutzernamen sind organisationsuebergreifend eindeutig, weil die
  // Login-Adresse aus ihnen abgeleitet wird (usernameToInternalEmail).
  // Ohne diese Vorabpruefung scheitert das Anlegen mit einem rohen
  // Auth-Fehler, den niemand deuten kann.
  const { data: clash } = await admin
    .from("profiles")
    .select("user_id")
    .ilike("username", trimmed)
    .maybeSingle();
  if (clash) {
    return {
      error: `Der Benutzername „${trimmed}" ist bereits vergeben. Benutzernamen gelten organisationsübergreifend.`,
    };
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    // usernameToInternalEmail ist verlustbehaftet: "Anna B" und "Anna.B"
    // ergeben dieselbe Adresse. Die Namenspruefung oben faengt das nicht.
    if (/already been registered|already exists/i.test(error.message)) {
      return {
        error: `Aus „${trimmed}" ergibt sich die bereits vergebene Login-Adresse ${email}. Bitte einen anderen Benutzernamen wählen.`,
      };
    }
    return { error: error.message };
  }

  const uid = data.user.id;

  const { error: profileError } = await admin.from("profiles").insert({
    user_id: uid,
    username: trimmed,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(uid);
    return { error: profileError.message };
  }

  // Direkt zum Workspace hinzufügen
  const { error: memberError } = await admin.from("workspace_members").insert({
    workspace_id: workspaceId,
    user_id: uid,
    role,
    data_scope: dataScope,
  });
  if (memberError) {
    await admin.auth.admin.deleteUser(uid);
    return { error: memberError.message };
  }

  revalidatePath("/settings");
  revalidatePath("/admin");
  return { userId: uid };
}

/** Nutzer in der AKTIVEN Organisation anlegen (Screen /settings). */
export async function createUser(
  username: string,
  password: string,
  role: "owner" | "member" = "member",
  dataScope: DataScope = "workspace",
) {
  const access = await getAccessContext();
  if (!access || access.role !== "owner") return { error: "Keine Berechtigung." };
  return createUserInWorkspace(access.workspace_id, username, password, role, dataScope);
}

export async function deleteUser(userId: string) {
  const access = await getAccessContext();
  if (!access || access.role !== "owner") return { error: "Keine Berechtigung." };

  // Nicht sich selbst löschen
  if (access.user.id === userId) {
    return { error: "Du kannst dich nicht selbst löschen." };
  }

  const admin = createAdminClient();

  // Zuerst pruefen, ob der Nutzer ueberhaupt zur AKTIVEN Organisation gehoert.
  // Ohne diese Pruefung wuerde zwar nur die Mitgliedschaft org-gefiltert
  // geloescht, Profil und Auth-Account aber ungeprueft — ein Owner koennte
  // damit einen Nutzer einer fremden Organisation aus dem System entfernen.
  const { data: member } = await admin
    .from("workspace_members")
    .select("user_id")
    .eq("user_id", userId)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();
  if (!member) {
    return { error: "Nutzer gehört nicht zu dieser Organisation." };
  }

  await admin
    .from("workspace_members")
    .delete()
    .eq("user_id", userId)
    .eq("workspace_id", access.workspace_id);
  await admin.from("profiles").delete().eq("user_id", userId);
  await admin.auth.admin.deleteUser(userId);

  revalidatePath("/settings");
  return {};
}

/** Datensicht eines bestehenden Nutzers der AKTIVEN Organisation ändern. */
export async function updateUserScope(userId: string, scope: DataScope) {
  const access = await getAccessContext();
  if (!access || access.role !== "owner") return { error: "Keine Berechtigung." };

  const admin = createAdminClient();

  // Nur Nutzer der aktiven Organisation umstellen (vgl. deleteUser/renameUser).
  const { data: member } = await admin
    .from("workspace_members")
    .select("user_id")
    .eq("user_id", userId)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();
  if (!member) {
    return { error: "Nutzer gehört nicht zu dieser Organisation." };
  }

  const { error } = await admin
    .from("workspace_members")
    .update({ data_scope: scope })
    .eq("user_id", userId)
    .eq("workspace_id", access.workspace_id);
  if (error) return { error: error.message };

  revalidatePath("/settings");
  revalidatePath("/", "layout");
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
  if (/^\/setting\/[^/]+/.test(next)) return "/termine";
  if (/^\/closing\/[^/]+/.test(next)) return "/termine";
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
      secure: process.env.NODE_ENV === "production",
      // Eine fremde Datensicht ist ein Ausnahmezustand. Ohne maxAge waere es
      // ein Session-Cookie, das bis zum Browser-Neustart aktiv bleibt — man
      // traegt dann tagelang unbemerkt fremde Zahlen im Dashboard.
      maxAge: 60 * 60 * 8,
    });
  }

  revalidatePath("/", "layout");
  redirect(safeRedirectAfterViewSwitch(next));
}

export async function renameUser(userId: string, newUsername: string) {
  const access = await getAccessContext();
  if (!access || access.role !== "owner") return { error: "Keine Berechtigung." };

  const trimmed = newUsername.trim();
  if (!trimmed) return { error: "Name darf nicht leer sein." };

  const admin = createAdminClient();

  // Nur Nutzer der aktiven Organisation umbenennen (vgl. deleteUser).
  const { data: member } = await admin
    .from("workspace_members")
    .select("user_id")
    .eq("user_id", userId)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();
  if (!member) {
    return { error: "Nutzer gehört nicht zu dieser Organisation." };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("username")
    .eq("user_id", userId)
    .maybeSingle();
  const oldUsername = (profile as { username?: string } | null)?.username;
  if (!oldUsername) return { error: "Nutzer nicht gefunden." };
  if (oldUsername === trimmed) return {};

  if (usernameToInternalEmail(trimmed) === "@pitchtracker.internal") {
    return { error: "Benutzername enthält keine verwendbaren Zeichen (a–z, 0–9)." };
  }

  // Benutzernamen sind organisationsuebergreifend eindeutig (Login-Adresse).
  const { data: clash } = await admin
    .from("profiles")
    .select("user_id")
    .ilike("username", trimmed)
    .neq("user_id", userId)
    .maybeSingle();
  if (clash) {
    return {
      error: `Der Benutzername „${trimmed}" ist bereits vergeben. Benutzernamen gelten organisationsübergreifend.`,
    };
  }

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
    .eq("workspace_id", access.workspace_id)
    .eq("owner_name", oldUsername);
  await admin
    .from("phone_lists")
    .update({ owner_name: trimmed })
    .eq("workspace_id", access.workspace_id)
    .eq("owner_name", oldUsername);
  // list_views tragen ebenfalls owner_name (Migration 0023) — ohne das
  // Nachziehen verlieren Smart Views nach einer Umbenennung ihren Besitzer.
  await admin
    .from("list_views")
    .update({ owner_name: trimmed })
    .eq("workspace_id", access.workspace_id)
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
