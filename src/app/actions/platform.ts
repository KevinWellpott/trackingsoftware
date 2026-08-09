"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

// ---------------------------------------------------------------------------
// Plattformweite Nutzeruebersicht
// ---------------------------------------------------------------------------
// Bewusst hier und nicht in /settings: die Einstellungen sind org-lokal (sie
// zeigen immer nur die AKTIVE Organisation). Eine Nutzerliste ueber alle
// Mandanten haette dort hinter dem Owner-Gate gestanden — ein Kunden-Owner
// saehe fremde Organisationen. Diese Uebersicht ist deshalb an
// `is_platform_admin` gebunden, nicht an `role === 'owner'`.

/** Eine Zeile der Uebersicht — exakt die Felder, die die Tabelle anzeigt. */
export type PlatformUserRow = {
  user_id: string;
  /** NULL = Auth-Konto ohne Profilzeile (kein Anzeigename vorhanden). */
  username: string | null;
  /** NULL = keine Mitgliedschaft (verwaistes Konto). */
  role: "owner" | "member" | null;
  data_scope: "workspace" | "own" | null;
  /** ISO-Zeitstempel des letzten Logins; NULL = noch nie angemeldet. */
  last_sign_in_at: string | null;
  is_platform_admin: boolean;
};

export type PlatformUserGroup = {
  /** NULL = Sammelgruppe „ohne Organisation". */
  workspace_id: string | null;
  workspace: string;
  users: PlatformUserRow[];
};

// Die Auth-API liefert Nutzer SEITENWEISE (ohne Angabe 50 je Seite). Ohne
// Schleife fehlten ab der ersten vollen Seite stillschweigend Konten — und
// zwar ohne jeden Hinweis, dass die Liste unvollstaendig ist. Die Obergrenze
// verhindert eine Endlosschleife, falls die API einmal keinen sauberen
// `nextPage` liefert.
const AUTH_PAGE_SIZE = 200;
const AUTH_MAX_PAGES = 50;

type AuthAccount = { id: string; last_sign_in_at: string | null };

type MembershipRow = {
  user_id: string;
  workspace_id: string;
  role: "owner" | "member";
  data_scope?: "workspace" | "own" | null;
};

/**
 * Alle Auth-Konten — reduziert auf ID und letzten Login.
 *
 * Das rohe User-Objekt der Auth-API traegt E-Mail, App-/User-Metadaten,
 * Provider und weitere Auth-Zeitstempel. Nichts davon verlaesst diese
 * Funktion: was hier nicht abgeschrieben wird, kann spaeter auch nicht
 * versehentlich an den Client serialisiert werden.
 */
async function listAuthAccounts(
  admin: ReturnType<typeof createAdminClient>,
): Promise<{ error?: string; accounts: AuthAccount[] }> {
  const accounts: AuthAccount[] = [];
  for (let page = 1; page <= AUTH_MAX_PAGES; page++) {
    const res = await admin.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE });
    if (res.error) return { error: res.error.message, accounts };
    for (const u of res.data.users) {
      accounts.push({ id: u.id, last_sign_in_at: u.last_sign_in_at ?? null });
    }
    if (!res.data.nextPage) break;
  }
  return { accounts };
}

// PostgREST schneidet ein Ergebnis still bei 1000 Zeilen ab (vgl. fetchAllRows
// in src/lib/analyseData.ts). Fuer eine Uebersicht, die vollstaendig sein MUSS,
// ist das die gefaehrlichste Fehlerart: die Tabelle saehe voellig plausibel
// aus, es fehlten nur Leute. Also seitenweise lesen — wie bei den Auth-Konten.
const ROW_PAGE_SIZE = 1000;

async function fetchAllRowsAsAdmin<T>(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
  columns: string,
): Promise<{ error?: string; rows: T[] }> {
  const rows: T[] = [];
  for (let page = 0; page < AUTH_MAX_PAGES; page++) {
    const from = page * ROW_PAGE_SIZE;
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .range(from, from + ROW_PAGE_SIZE - 1);
    if (error) return { error: error.message, rows };
    const batch = (data ?? []) as unknown as T[];
    rows.push(...batch);
    if (batch.length < ROW_PAGE_SIZE) break;
  }
  return { rows };
}

/**
 * Alle Nutzer der Plattform, nach Organisation gruppiert.
 *
 * Enthaelt auch Auth-Konten OHNE Mitgliedschaft: die sieht man sonst nirgends,
 * obwohl genau die aufzuraeumen waeren (ein Login ohne Organisation landet
 * beim naechsten Aufruf auf /onboarding).
 */
export async function listPlatformUsers(): Promise<{
  error?: string;
  groups: PlatformUserGroup[];
  total: number;
}> {
  // ERSTE Anweisung, bewusst vor jedem Datenzugriff: Server Actions sind per
  // direktem POST erreichbar, ein Gate in der Seite schuetzt sie nicht (siehe
  // Next-Guide „Data Security", Abschnitt Authentication and authorization).
  const access = await getAccessContext();
  if (!access?.is_platform_admin) {
    return { error: "Keine Berechtigung.", groups: [], total: 0 };
  }

  // Ab hier service_role: `platform_admins` ist fuer jeden Nutzer bis auf die
  // eigene Zeile gesperrt, und die Auth-Konten liegen ohnehin nur ueber die
  // Admin-API vor. Die Organisationsgrenze spielt hier keine Rolle — das IST
  // die Plattformebene, und der Aufrufer ist oben als Admin verifiziert.
  const admin = createAdminClient();
  const [auth, profiles, members, orgs, padmins] = await Promise.all([
    listAuthAccounts(admin),
    fetchAllRowsAsAdmin<{ user_id: string; username: string }>(admin, "profiles", "user_id, username"),
    fetchAllRowsAsAdmin<MembershipRow>(
      admin,
      "workspace_members",
      "user_id, workspace_id, role, data_scope",
    ),
    fetchAllRowsAsAdmin<{ id: string; name: string }>(admin, "workspaces", "id, name"),
    fetchAllRowsAsAdmin<{ user_id: string }>(admin, "platform_admins", "user_id"),
  ]);

  // Eine halbe Uebersicht ist schlimmer als gar keine: lieber die Fehlermeldung
  // zeigen, als eine Tabelle, der man die fehlenden Zeilen nicht ansieht.
  const failed = [auth, profiles, members, orgs, padmins].find((r) => r.error);
  if (failed?.error) return { error: failed.error, groups: [], total: 0 };

  const usernameOf = new Map(profiles.rows.map((p) => [p.user_id, p.username]));
  // Bewusst eine Liste je Nutzer statt eines einzelnen Eintrags: laut Modell
  // hat jeder genau EINE Mitgliedschaft (docs §2). Haette jemand zwei, wuerde
  // ihn getAccessContext aussperren — und ein Map-Eintrag wuerde die zweite
  // still schlucken. So taucht er stattdessen in beiden Organisationen auf und
  // der Defekt ist genau dort sichtbar, wo man ihn reparieren wuerde.
  const membershipsOf = new Map<string, MembershipRow[]>();
  for (const m of members.rows) {
    const list = membershipsOf.get(m.user_id);
    if (list) list.push(m);
    else membershipsOf.set(m.user_id, [m]);
  }
  const orgName = new Map(orgs.rows.map((o) => [o.id, o.name]));
  const adminIds = new Set(padmins.rows.map((a) => a.user_id));

  // Gruppen ueber alle Organisationen vorbelegen, damit auch eine leere
  // Organisation in der Uebersicht auftaucht (sonst wirkte sie wie geloescht).
  const groups = new Map<string, PlatformUserGroup>();
  for (const [id, name] of orgName) {
    groups.set(id, { workspace_id: id, workspace: name, users: [] });
  }
  const orphans: PlatformUserGroup = {
    workspace_id: null,
    workspace: "Ohne Organisation",
    users: [],
  };

  for (const account of auth.accounts) {
    const memberships = membershipsOf.get(account.id) ?? [];
    const base = {
      user_id: account.id,
      username: usernameOf.get(account.id) ?? null,
      last_sign_in_at: account.last_sign_in_at,
      is_platform_admin: adminIds.has(account.id),
    };
    if (memberships.length === 0) {
      orphans.users.push({ ...base, role: null, data_scope: null });
      continue;
    }
    for (const m of memberships) {
      const group = groups.get(m.workspace_id) ?? orphans;
      group.users.push({ ...base, role: m.role, data_scope: m.data_scope ?? "workspace" });
    }
  }

  const byName = (a: PlatformUserRow, b: PlatformUserRow) =>
    (a.username ?? "￿").localeCompare(b.username ?? "￿", "de");

  const sorted = [...groups.values()]
    .sort((a, b) => a.workspace.localeCompare(b.workspace, "de"))
    .map((g) => ({ ...g, users: [...g.users].sort(byName) }));
  // Verwaiste Konten ganz nach unten: sie sind eine To-do-Liste, keine Organisation.
  if (orphans.users.length > 0) sorted.push({ ...orphans, users: [...orphans.users].sort(byName) });

  return { groups: sorted, total: auth.accounts.length };
}

// ---------------------------------------------------------------------------
// Plattform-Admins verwalten
// ---------------------------------------------------------------------------
// `platform_admins` hat bewusst KEINE insert/update/delete-Policy — ein selbst
// setzbares Admin-Flag waere wertlos (Migration 0025, §1). Gepflegt wird die
// Tabelle deshalb ueber den service_role-Client, genau wie `workspace_members`
// in actions/workspace.ts. Es kommt keine RLS-Policy hinzu, die das Schreiben
// fuer normale Nutzer oeffnet.

/**
 * Plattform-Admin-Rechte vergeben.
 *
 * WIRKUNG: der Nutzer liest und schreibt danach in JEDER Organisation
 * org-weit — eine Datensicht „nur eigene Daten" ist damit faktisch aufgehoben
 * (rpc_effective_user prueft Plattform-Admins zuerst, Migration 0025 §4).
 */
export async function grantPlatformAdmin(userId: string): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access?.is_platform_admin) return { error: "Keine Berechtigung." };
  if (!userId) return { error: "Kein Nutzer gewählt." };

  const admin = createAdminClient();

  // Nur Konten mit Profil: ohne Benutzernamen stuende in der Verwaltung eine
  // nackte UUID, die niemand mehr zuordnen kann.
  const { data: profile } = await admin
    .from("profiles")
    .select("username")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile) return { error: "Nutzer nicht gefunden." };

  const { error } = await admin
    .from("platform_admins")
    .insert({ user_id: userId, note: `Vergeben von ${access.username}` });
  // 23505 = Zeile existiert schon. Das ist der gewuenschte Endzustand, kein Fehler.
  if (error && error.code !== "23505") return { error: error.message };

  revalidatePath("/admin");
  revalidatePath("/", "layout");
  return {};
}

/** Plattform-Admin-Rechte entziehen. */
export async function revokePlatformAdmin(userId: string): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access?.is_platform_admin) return { error: "Keine Berechtigung." };

  // Sicherheitsnetz 1: niemand entzieht sie sich selbst. Sonst sperrt sich der
  // Letzte mit einem Klick aus — und die Tabelle laesst sich nur noch im
  // SQL-Editor reparieren.
  if (userId === access.user.id) {
    return { error: "Du kannst dir die Plattform-Rechte nicht selbst entziehen." };
  }

  const admin = createAdminClient();

  // Sicherheitsnetz 2: es muss immer mindestens einer uebrig bleiben. Durch
  // Netz 1 ist das hier eigentlich schon garantiert — die Invariante steht
  // trotzdem explizit da, damit sie beim naechsten Umbau nicht mitverschwindet.
  const { count } = await admin
    .from("platform_admins")
    .select("user_id", { count: "exact", head: true });
  if ((count ?? 0) <= 1) {
    return { error: "Es muss mindestens ein Plattform-Admin übrig bleiben." };
  }

  const { error } = await admin.from("platform_admins").delete().eq("user_id", userId);
  if (error) return { error: error.message };

  revalidatePath("/admin");
  revalidatePath("/", "layout");
  return {};
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
