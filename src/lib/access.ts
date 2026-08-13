import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { Workspace } from "@/lib/types";

export const DATA_VIEW_COOKIE = "pt_data_view_user_id";

// Aktive Organisation eines Plattform-Admins. Normale Nutzer haben diesen
// Cookie nie — fuer sie ist die aktive Organisation immer ihre einzige.
export const ACTIVE_ORG_COOKIE = "pt_active_workspace_id";

export type DataScope = "workspace" | "own";

export type DataViewUser = {
  user_id: string;
  username: string;
  data_scope: DataScope;
};

export type OrgSummary = {
  id: string;
  name: string;
};

export type AccessContext = {
  user: { id: string };
  // Die AKTIVE Organisation — fuer normale Nutzer identisch mit ihrer
  // Mitgliedschaft, fuer einen Plattform-Admin ggf. eine fremde. Alle
  // Abfragen der App filtern hierauf; dadurch wandert der gesamte
  // Datenbestand beim Org-Wechsel mit, ohne dass die Aufrufstellen etwas
  // davon wissen muessen.
  workspace_id: string;
  role: "owner" | "member";
  data_scope: DataScope;
  workspaces: Workspace;
  username: string;
  effective_user_id: string | null;
  effective_username: string | null;
  can_switch_view: boolean;
  is_platform_admin: boolean;
  // Die Organisation, in der der Nutzer wirklich Mitglied ist. Bei einem
  // Plattform-Admin in fremder Org weicht sie von workspace_id ab.
  home_workspace_id: string | null;
  is_foreign_org: boolean;
  // Nur fuer Plattform-Admins befuellt (Auswahl im Org-Umschalter).
  available_workspaces: OrgSummary[];
};

type MemberRow = {
  workspace_id: string;
  user_id: string;
  role: "owner" | "member";
  data_scope?: DataScope | null;
};

type ProfileRow = { username: string } | null;

// Vor dem Einspielen von Migration 0025 existiert die RPC noch nicht. Dann
// ist niemand Plattform-Admin und die App verhaelt sich exakt wie vorher,
// statt mit einem Fehler stehenzubleiben (gleiche Vorsichtsmassnahme wie beim
// list_views-Rollout, siehe (dashboard)/layout.tsx).
async function resolvePlatformAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error) return false;
  return data === true;
}

export async function getAccessContext(): Promise<AccessContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: memberRows }, isPlatformAdmin, { data: profile }] = await Promise.all([
    // Bewusst KEIN .maybeSingle(): zwei Mitgliedschaften wuerden dort einen
    // PostgREST-Fehler ausloesen, getAccessContext gaebe null zurueck und der
    // Nutzer landete in einer Endlosschleife auf /onboarding, wo
    // bootstrap_workspace mit 'Already in a workspace' abbricht.
    supabase
      .from("workspace_members")
      .select("workspace_id, user_id, role, data_scope")
      .eq("user_id", user.id),
    resolvePlatformAdmin(supabase),
    supabase.from("profiles").select("username").eq("user_id", user.id).maybeSingle(),
  ]);

  const memberships = (memberRows ?? []) as MemberRow[];
  const home = memberships[0] ?? null;

  const cookieStore = await cookies();
  const requestedOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value ?? null;

  // Welche Organisation ist aktiv?
  let activeWorkspaceId: string | null = null;
  let role: "owner" | "member" = "member";
  let dataScope: DataScope = "workspace";
  let isForeignOrg = false;

  const requestedMembership = requestedOrgId
    ? memberships.find((m) => m.workspace_id === requestedOrgId)
    : undefined;

  if (requestedMembership) {
    activeWorkspaceId = requestedMembership.workspace_id;
    role = requestedMembership.role;
    dataScope = requestedMembership.data_scope ?? "workspace";
  } else if (requestedOrgId && isPlatformAdmin) {
    // Fremde Organisation. Ein Plattform-Admin arbeitet dort ohne
    // Mitgliedschaft — Rolle und Datensicht werden synthetisiert, damit alle
    // bestehenden Owner-Gates (/team, /settings, Sidebar) unveraendert
    // greifen.
    const { data: foreign } = await supabase
      .from("workspaces")
      .select("id")
      .eq("id", requestedOrgId)
      .maybeSingle();
    if (foreign) {
      activeWorkspaceId = requestedOrgId;
      role = "owner";
      dataScope = "workspace";
      isForeignOrg = true;
    }
  }

  // Kein oder ungueltiges Cookie -> Heim-Organisation. Ein ungueltiges Cookie
  // wird bewusst nur ignoriert und nicht geloescht: Server Components duerfen
  // keine Cookies schreiben. Aufgeraeumt wird beim naechsten Org-Wechsel.
  if (!activeWorkspaceId) {
    if (!home) return null;
    activeWorkspaceId = home.workspace_id;
    role = home.role;
    dataScope = home.data_scope ?? "workspace";
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("*")
    .eq("id", activeWorkspaceId)
    .single();

  if (!workspace) return null;

  const username = ((profile as ProfileRow)?.username ?? workspace.name) as string;
  const canSwitchView = role === "owner" && dataScope === "workspace";

  let effectiveUserId: string | null = dataScope === "own" ? user.id : null;
  let effectiveUsername: string | null = dataScope === "own" ? username : null;

  if (canSwitchView) {
    const requestedUserId = cookieStore.get(DATA_VIEW_COOKIE)?.value;
    if (requestedUserId) {
      // Der Zielnutzer muss in der AKTIVEN Organisation sein. Damit verfaellt
      // eine Datensicht aus der vorherigen Organisation automatisch, falls
      // der Cookie den Org-Wechsel ueberlebt hat.
      const { data: target } = await supabase
        .from("workspace_members")
        .select("user_id, data_scope, profiles (username)")
        .eq("workspace_id", activeWorkspaceId)
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

  let availableWorkspaces: OrgSummary[] = [];
  if (isPlatformAdmin) {
    // Vor Migration 0025 greift die Plattform-Admin-Policy auf `workspaces`
    // noch nicht — dann liefert die Abfrage nur die eigene Organisation und
    // der Umschalter blendet sich mangels Alternativen selbst aus.
    const { data: orgs } = await supabase
      .from("workspaces")
      .select("id, name")
      .order("name", { ascending: true });
    availableWorkspaces = (orgs ?? []) as OrgSummary[];
  }

  return {
    user: { id: user.id },
    workspace_id: activeWorkspaceId,
    role,
    data_scope: dataScope,
    workspaces: workspace as Workspace,
    username,
    effective_user_id: effectiveUserId,
    effective_username: effectiveUsername,
    can_switch_view: canSwitchView,
    is_platform_admin: isPlatformAdmin,
    home_workspace_id: home?.workspace_id ?? null,
    is_foreign_org: isForeignOrg,
    available_workspaces: availableWorkspaces,
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

/**
 * Dieselbe Regel wie `buildOwnScope`, nur in JS statt als PostgREST-Filter.
 *
 * Damit kann eine Detailseite zwischen den beiden Faellen unterscheiden, die
 * eine gefilterte Abfrage sonst zu einer einzigen leeren Antwort verschmilzt:
 * „gibt es in dieser Organisation nicht" (404 ist richtig) und „gibt es, aber
 * die aktive Datensicht blendet es aus" (404 ist irrefuehrend — der Datensatz
 * ist da, nur zeigt der Filter woandershin). Die Regel steht bewusst neben
 * buildOwnScope: Zwei Formulierungen derselben Bedingung, die auseinanderlaufen
 * koennen, waeren genau der Fehler, den diese Funktion aufdecken soll.
 */
export function matchesOwnScope(
  access: AccessContext,
  row: { owner_name: string | null; created_by_user_id: string | null },
): boolean {
  if (!access.effective_user_id) return true;
  if (row.owner_name) return row.owner_name === access.effective_username;
  return row.created_by_user_id === access.effective_user_id;
}
