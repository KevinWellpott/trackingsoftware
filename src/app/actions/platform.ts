"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_ORG_COOKIE, DATA_VIEW_COOKIE, getAccessContext } from "@/lib/access";

// Aktionen der Plattform-Ebene — also OBERHALB der einzelnen Organisation.
// Bewusst getrennt von actions/workspace.ts: dort geht es immer um die
// aktuelle Organisation, hier um die Verwaltung aller Organisationen.
//
// Jede Aktion prueft `is_platform_admin`. Serverseitig zaehlt zusaetzlich die
// RLS-Policy bzw. der Guard in den SECURITY-DEFINER-Funktionen — die Pruefung
// hier ist die erste, nicht die einzige Verteidigungslinie.

/**
 * Aktive Organisation wechseln. Leerer Wert (oder die eigene Heim-Org)
 * bedeutet: zurueck in die Heim-Organisation.
 */
export async function setActiveOrgForm(formData: FormData) {
  const access = await getAccessContext();
  if (!access?.is_platform_admin) return;

  const target = String(formData.get("workspace_id") ?? "");
  const cookieStore = await cookies();

  // Ein Org-Wechsel setzt IMMER die Datensicht zurueck. Der Datensicht-Cookie
  // haelt eine user_id; die gehoert zur vorherigen Organisation und ergaebe in
  // der neuen keinen Sinn. getAccessContext wuerde sie zwar ohnehin verwerfen
  // (der Zielnutzer muss in der aktiven Org sein), aber der Cookie bliebe
  // liegen und griffe beim Zurueckwechseln wieder.
  cookieStore.delete(DATA_VIEW_COOKIE);

  if (!target || target === access.home_workspace_id) {
    cookieStore.delete(ACTIVE_ORG_COOKIE);
  } else {
    cookieStore.set(ACTIVE_ORG_COOKIE, target, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      // Bewusst kurz: in einer fremden Organisation zu stehen, ohne es zu
      // merken, ist die gefaehrlichste Fehlbedienung des ganzen Features.
      maxAge: 60 * 60 * 8,
    });
  }

  revalidatePath("/", "layout");
  // Bewusst NICHT safeRedirectAfterViewSwitch: beim Org-Wechsel wechselt der
  // gesamte Datenbestand, jede Detail-Route der alten Organisation waere ein
  // 404. Der Start ist immer das Dashboard der neuen Organisation.
  redirect("/");
}

export type OrganizationRow = {
  id: string;
  name: string;
  created_at: string;
  member_count: number;
};

/** Alle Organisationen mit Mitgliederzahl — Grundlage von /admin. */
export async function listOrganizations(): Promise<{
  error?: string;
  organizations: OrganizationRow[];
}> {
  const access = await getAccessContext();
  if (!access?.is_platform_admin) {
    return { error: "Keine Berechtigung.", organizations: [] };
  }

  const supabase = await createClient();
  const [{ data: orgs, error }, { data: members }] = await Promise.all([
    supabase.from("workspaces").select("id, name, created_at").order("name", { ascending: true }),
    supabase.from("workspace_members").select("workspace_id"),
  ]);

  if (error) return { error: error.message, organizations: [] };

  const counts = new Map<string, number>();
  for (const m of (members ?? []) as { workspace_id: string }[]) {
    counts.set(m.workspace_id, (counts.get(m.workspace_id) ?? 0) + 1);
  }

  return {
    organizations: ((orgs ?? []) as { id: string; name: string; created_at: string }[]).map((o) => ({
      ...o,
      member_count: counts.get(o.id) ?? 0,
    })),
  };
}

export async function createOrganization(name: string): Promise<{ error?: string; id?: string }> {
  const access = await getAccessContext();
  if (!access?.is_platform_admin) return { error: "Keine Berechtigung." };

  const trimmed = name.trim();
  if (!trimmed) return { error: "Name der Organisation ist erforderlich." };

  const supabase = await createClient();
  // Ueber die RPC, nicht per Insert: bootstrap_workspace() bricht mit
  // 'Already in a workspace' ab, sobald der Aufrufer eine Mitgliedschaft hat.
  // platform_create_workspace() legt die Organisation an, OHNE den Aufrufer
  // zum Mitglied zu machen — sonst stuende ein Plattform-Admin im
  // Team-Dashboard des Kunden.
  const { data, error } = await supabase.rpc("platform_create_workspace", { p_name: trimmed });
  if (error) return { error: error.message };

  revalidatePath("/admin");
  revalidatePath("/", "layout");
  return { id: data as string };
}

export async function createOrganizationForm(formData: FormData) {
  const res = await createOrganization(String(formData.get("name") ?? ""));
  if (res.error) redirect(`/admin?err=${encodeURIComponent(res.error)}`);
  redirect("/admin?ok=org");
}

export async function renameOrganization(
  workspaceId: string,
  name: string,
): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access?.is_platform_admin) return { error: "Keine Berechtigung." };

  const trimmed = name.trim();
  if (!trimmed) return { error: "Name der Organisation ist erforderlich." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .update({ name: trimmed })
    .eq("id", workspaceId);
  if (error) return { error: error.message };

  revalidatePath("/admin");
  revalidatePath("/", "layout");
  return {};
}

export async function renameOrganizationForm(formData: FormData) {
  const res = await renameOrganization(
    String(formData.get("workspace_id") ?? ""),
    String(formData.get("name") ?? ""),
  );
  if (res.error) redirect(`/admin?err=${encodeURIComponent(res.error)}`);
  redirect("/admin?ok=rename");
}

export type OrgMember = {
  user_id: string;
  username: string;
  role: "owner" | "member";
  data_scope: "workspace" | "own";
};

/** Mitglieder EINER Organisation — Grundlage von /admin/org/[id]. */
export async function listOrgMembers(workspaceId: string): Promise<{
  error?: string;
  organization?: { id: string; name: string };
  members: OrgMember[];
}> {
  const access = await getAccessContext();
  if (!access?.is_platform_admin) return { error: "Keine Berechtigung.", members: [] };

  const supabase = await createClient();
  const [{ data: org }, { data, error }] = await Promise.all([
    supabase.from("workspaces").select("id, name").eq("id", workspaceId).maybeSingle(),
    supabase
      .from("workspace_members")
      .select("user_id, role, data_scope, profiles (username)")
      .eq("workspace_id", workspaceId),
  ]);

  if (!org) return { error: "Organisation nicht gefunden.", members: [] };
  if (error) return { error: error.message, members: [] };

  const members = ((data ?? []) as unknown as {
    user_id: string;
    role: "owner" | "member";
    data_scope?: "workspace" | "own" | null;
    profiles: { username: string } | null;
  }[])
    .map((r) => ({
      user_id: r.user_id,
      username: r.profiles?.username ?? r.user_id,
      role: r.role,
      data_scope: r.data_scope ?? ("workspace" as const),
    }))
    .sort((a, b) => a.username.localeCompare(b.username, "de"));

  return { organization: org as { id: string; name: string }, members };
}

export type MovableUser = {
  user_id: string;
  username: string;
  current_workspace_id: string;
  current_workspace: string;
};

/**
 * Alle Nutzer, die NICHT in dieser Organisation sind — Grundlage für
 * „Nutzer hierher holen". Das ist die Richtung, in der man denkt: erst die
 * Organisation anlegen, dann jemanden hineinziehen.
 */
export async function listUsersOutsideOrg(workspaceId: string): Promise<{
  error?: string;
  users: MovableUser[];
}> {
  const access = await getAccessContext();
  if (!access?.is_platform_admin) return { error: "Keine Berechtigung.", users: [] };

  const supabase = await createClient();
  const [{ data: members, error }, { data: orgs }] = await Promise.all([
    supabase.from("workspace_members").select("user_id, workspace_id, profiles (username)"),
    supabase.from("workspaces").select("id, name"),
  ]);
  if (error) return { error: error.message, users: [] };

  const orgName = new Map(
    ((orgs ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]),
  );

  return {
    users: ((members ?? []) as unknown as {
      user_id: string;
      workspace_id: string;
      profiles: { username: string } | null;
    }[])
      .filter((m) => m.workspace_id !== workspaceId)
      .map((m) => ({
        user_id: m.user_id,
        username: m.profiles?.username ?? m.user_id,
        current_workspace_id: m.workspace_id,
        current_workspace: orgName.get(m.workspace_id) ?? "—",
      }))
      .sort((a, b) => a.username.localeCompare(b.username, "de")),
  };
}

export type MovePreview = {
  username: string;
  source_workspace: string;
  target_workspace: string;
  counts: Record<string, number>;
  warnings: { code: string; count: number; text: string }[];
};

/** Was wuerde ein Umzug bewegen? Reine Leseoperation, veraendert nichts. */
export async function previewMoveUser(
  userId: string,
  targetWorkspaceId: string,
): Promise<{ error?: string; preview?: MovePreview }> {
  const access = await getAccessContext();
  if (!access?.is_platform_admin) return { error: "Keine Berechtigung." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_move_user", {
    p_user_id: userId,
    p_target_workspace_id: targetWorkspaceId,
  });
  if (error) return { error: error.message };
  return { preview: data as MovePreview };
}

/**
 * Umzug ausfuehren. `expected` sind die Zahlen aus der Vorschau — weichen die
 * tatsaechlichen davon ab, bricht die Datenbank ab, statt etwas anderes zu
 * verschieben, als der Admin bestaetigt hat.
 */
export async function moveUser(
  userId: string,
  targetWorkspaceId: string,
  expected?: Record<string, number>,
): Promise<{ error?: string; moved?: Record<string, number> }> {
  const access = await getAccessContext();
  if (!access?.is_platform_admin) return { error: "Keine Berechtigung." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_move_user_to_workspace", {
    p_user_id: userId,
    p_target_workspace_id: targetWorkspaceId,
    p_role: null,
    p_data_scope: null,
    p_force: false,
    p_expected: expected ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin");
  revalidatePath("/", "layout");
  return { moved: (data as { moved?: Record<string, number> })?.moved };
}

export type DeletePreview = {
  workspace_id: string;
  workspace: string;
  members: string[];
  counts: Record<string, number>;
};

/** Was würde beim Löschen dieser Organisation verschwinden? Reine Leseoperation. */
export async function previewDeleteOrganization(
  workspaceId: string,
): Promise<{ error?: string; preview?: DeletePreview }> {
  const access = await getAccessContext();
  if (!access?.is_platform_admin) return { error: "Keine Berechtigung." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_delete_workspace", {
    p_workspace_id: workspaceId,
  });
  if (error) return { error: error.message };
  return { preview: data as DeletePreview };
}

/**
 * Organisation löschen. Irreversibel: an `workspaces` hängen 14
 * Fremdschlüssel mit `on delete cascade`, es geht also der komplette
 * Datenbestand der Organisation mit. Die Datenbank verweigert das, solange
 * noch Mitglieder da sind (siehe Migration 0027).
 */
export async function deleteOrganization(
  workspaceId: string,
  expected?: Record<string, number>,
): Promise<{ error?: string; deleted?: DeletePreview }> {
  const access = await getAccessContext();
  if (!access?.is_platform_admin) return { error: "Keine Berechtigung." };
  if (workspaceId === access.home_workspace_id) {
    return { error: "Die eigene Organisation kann nicht gelöscht werden." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_delete_workspace", {
    p_workspace_id: workspaceId,
    p_expected: expected ?? null,
  });
  if (error) return { error: error.message };

  // Stand der Admin gerade IN dieser Organisation, zeigt der Cookie jetzt ins
  // Leere. getAccessContext ignoriert ihn dann zwar, aber sauberer ist es,
  // ihn direkt wegzuräumen.
  if (workspaceId === access.workspace_id) {
    const cookieStore = await cookies();
    cookieStore.delete(ACTIVE_ORG_COOKIE);
    cookieStore.delete(DATA_VIEW_COOKIE);
  }

  revalidatePath("/admin");
  revalidatePath("/", "layout");
  return { deleted: data as DeletePreview };
}

export async function createUserInOrgForm(formData: FormData) {
  const workspaceId = String(formData.get("workspace_id") ?? "");
  const { createUserInWorkspace } = await import("@/app/actions/workspace");
  const res = await createUserInWorkspace(
    workspaceId,
    String(formData.get("username") ?? ""),
    String(formData.get("password") ?? ""),
    String(formData.get("role") ?? "member") as "owner" | "member",
    String(formData.get("data_scope") ?? "workspace") as "workspace" | "own",
  );
  if (res.error) {
    redirect(`/admin/org/${workspaceId}?err=${encodeURIComponent(res.error)}`);
  }
  redirect(`/admin/org/${workspaceId}?ok=user`);
}
