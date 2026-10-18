import { cache } from "react";
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
  workspaces?: Workspace | null;
};

type ViewTargetRow = {
  user_id: string;
  workspace_id: string;
  data_scope?: DataScope | null;
  profiles: { username: string } | null;
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

/**
 * Der Zugriffskontext EINER Anfrage — gecacht mit React `cache()`.
 *
 * Warum überhaupt: Die Funktion kostet je Aufruf sechs Abfragen in einer
 * parallelen Welle (bis Oktober 2026 waren es bis zu fünf Wellen
 * hintereinander, beginnend mit einem Roundtrip zum Auth-Server), und sie läuft pro
 * Seitenaufruf mehrfach: das Layout braucht sie, die Seite selbst, und jede
 * aufgerufene Server-Funktion holt sie sich erneut, weil sie als direkter POST
 * erreichbar ist und ihre Berechtigung deshalb SELBST prüfen muss (siehe
 * `loadRecycleTasks`). Diese Selbstprüfung ist richtig und bleibt — sie darf
 * nur nicht jedes Mal wieder an die Datenbank gehen. Auf /nachfassen waren das
 * vier Durchläufe, auf /settings sechs.
 *
 * Warum `cache()` aus React und NICHT `use cache`/`unstable_cache`: Der Kontext
 * hängt an Cookies (Datensicht `pt_data_view_user_id`, aktive Organisation
 * `pt_active_workspace_id`) und am angemeldeten Konto. Ein Cache, der über
 * Anfragen hinweg hält, zeigte dem nächsten Nutzer fremde Daten.
 * `cache()` kann das strukturell nicht: Der Speicher hängt am React-Request
 * (`ReactSharedInternals.A` → `request.cache`, je gerendertem Request eine
 * frische Map) und wird über AsyncLocalStorage aufgelöst. Ohne laufenden
 * Request — in einer Server Action, in einem Route Handler — greift gar keine
 * Memoisierung, die Funktion läuft dann wie bisher jedes Mal durch. Damit ist
 * die Reichweite höchstens EIN Render, nie zwei Anfragen und nie zwei Nutzer.
 *
 * Innerhalb eines Renders kann sich der Kontext auch nicht ändern: Server
 * Components dürfen keine Cookies schreiben. Die beiden Aktionen, die es tun
 * (`setDataViewForm`, `setActiveOrgForm`), lesen den Kontext ausschließlich
 * VOR dem Schreiben und beenden sich danach mit `redirect()` — die neue Sicht
 * entsteht in der nächsten Anfrage mit eigenem Cache.
 */
export const getAccessContext = cache(async function getAccessContext(): Promise<AccessContext | null> {
  const supabase = await createClient();
  // getClaims statt getUser: lokale Signaturprüfung gegen den gecachten JWKS
  // (ES256), kein Roundtrip zum Auth-Server. Begründung und Preis: proxy.ts.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;

  const cookieStore = await cookies();
  const requestedOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value ?? null;
  const requestedViewUserId = cookieStore.get(DATA_VIEW_COOKIE)?.value ?? null;

  // EINE Welle statt bis zu fünf hintereinander. Was nur vielleicht gebraucht
  // wird — die fremde Organisation, das Ziel der Datensicht, die Org-Liste des
  // Plattform-Admins —, wird vorsorglich mitgeholt und erst unten gegen die
  // tatsächlich aktive Organisation geprüft. Ein überflüssiger paralleler
  // Aufruf kostet keine Latenz, ein serieller einen vollen Roundtrip. Gelesen
  // wird weiterhin als der angemeldete Nutzer durch die RLS: Was er nicht
  // sehen darf, kommt gar nicht erst zurück.
  const [
    { data: memberRows },
    isPlatformAdmin,
    { data: profile },
    { data: requestedOrgRow },
    { data: viewTargetRows },
    { data: orgRows },
  ] = await Promise.all([
    // Bewusst KEIN .maybeSingle(): zwei Mitgliedschaften wuerden dort einen
    // PostgREST-Fehler ausloesen, getAccessContext gaebe null zurueck und der
    // Nutzer landete in einer Endlosschleife auf /onboarding, wo
    // bootstrap_workspace mit 'Already in a workspace' abbricht.
    // Die Organisation reist eingebettet mit — vorher eine eigene Welle.
    supabase
      .from("workspace_members")
      .select("workspace_id, user_id, role, data_scope, workspaces (*)")
      .eq("user_id", userId),
    resolvePlatformAdmin(supabase),
    supabase.from("profiles").select("username").eq("user_id", userId).maybeSingle(),
    requestedOrgId
      ? supabase.from("workspaces").select("*").eq("id", requestedOrgId).maybeSingle()
      : Promise.resolve({ data: null }),
    requestedViewUserId
      ? supabase
          .from("workspace_members")
          .select("user_id, workspace_id, data_scope, profiles (username)")
          .eq("user_id", requestedViewUserId)
      : Promise.resolve({ data: null }),
    // Nur für Plattform-Admins gebraucht. Für alle anderen liefert die RLS
    // ohnehin nur die eigene Organisation, und das Ergebnis wird verworfen.
    // Vor Migration 0025 greift die Plattform-Admin-Policy auf `workspaces`
    // noch nicht — dann blendet sich der Umschalter mangels Alternativen aus.
    supabase.from("workspaces").select("id, name").order("name", { ascending: true }),
  ]);

  const memberships = (memberRows ?? []) as unknown as MemberRow[];
  const home = memberships[0] ?? null;

  // Welche Organisation ist aktiv?
  let activeWorkspaceId: string | null = null;
  let workspace: Workspace | null = null;
  let role: "owner" | "member" = "member";
  let dataScope: DataScope = "workspace";
  let isForeignOrg = false;

  const requestedMembership = requestedOrgId
    ? memberships.find((m) => m.workspace_id === requestedOrgId)
    : undefined;

  if (requestedMembership) {
    activeWorkspaceId = requestedMembership.workspace_id;
    workspace = requestedMembership.workspaces ?? null;
    role = requestedMembership.role;
    dataScope = requestedMembership.data_scope ?? "workspace";
  } else if (requestedOrgId && isPlatformAdmin && requestedOrgRow) {
    // Fremde Organisation. Ein Plattform-Admin arbeitet dort ohne
    // Mitgliedschaft — Rolle und Datensicht werden synthetisiert, damit alle
    // bestehenden Owner-Gates (/team, /settings, Sidebar) unveraendert
    // greifen.
    activeWorkspaceId = requestedOrgId;
    workspace = requestedOrgRow as Workspace;
    role = "owner";
    dataScope = "workspace";
    isForeignOrg = true;
  }

  // Kein oder ungueltiges Cookie -> Heim-Organisation. Ein ungueltiges Cookie
  // wird bewusst nur ignoriert und nicht geloescht: Server Components duerfen
  // keine Cookies schreiben. Aufgeraeumt wird beim naechsten Org-Wechsel.
  if (!activeWorkspaceId) {
    if (!home) return null;
    activeWorkspaceId = home.workspace_id;
    workspace = home.workspaces ?? null;
    role = home.role;
    dataScope = home.data_scope ?? "workspace";
  }

  if (!workspace) return null;

  const username = ((profile as ProfileRow)?.username ?? workspace.name) as string;
  const canSwitchView = role === "owner" && dataScope === "workspace";

  let effectiveUserId: string | null = dataScope === "own" ? userId : null;
  let effectiveUsername: string | null = dataScope === "own" ? username : null;

  if (canSwitchView && requestedViewUserId) {
    // Der Zielnutzer muss in der AKTIVEN Organisation sein. Damit verfaellt
    // eine Datensicht aus der vorherigen Organisation automatisch, falls
    // der Cookie den Org-Wechsel ueberlebt hat. Geprüft wird hier statt in
    // der Abfrage, weil die aktive Organisation erst jetzt feststeht.
    const targetRow = ((viewTargetRows ?? []) as unknown as ViewTargetRow[]).find(
      (r) => r.workspace_id === activeWorkspaceId,
    );
    if (targetRow) {
      effectiveUserId = targetRow.user_id;
      effectiveUsername = targetRow.profiles?.username ?? "Ausgewählter Nutzer";
    }
  }

  const availableWorkspaces: OrgSummary[] = isPlatformAdmin
    ? ((orgRows ?? []) as OrgSummary[])
    : [];

  return {
    user: { id: userId },
    workspace_id: activeWorkspaceId,
    role,
    data_scope: dataScope,
    workspaces: workspace,
    username,
    effective_user_id: effectiveUserId,
    effective_username: effectiveUsername,
    can_switch_view: canSwitchView,
    is_platform_admin: isPlatformAdmin,
    home_workspace_id: home?.workspace_id ?? null,
    is_foreign_org: isForeignOrg,
    available_workspaces: availableWorkspaces,
  };
});

/**
 * Ebenfalls pro Anfrage gecacht, aus demselben Grund und mit derselben
 * Reichweite: Layout und Seite fragen die Mitgliederliste derselben
 * Organisation regelmäßig beide ab (/telefon, /termine, /analyse, /team,
 * /erinnerungen). Der Schlüssel ist die `workspaceId` — zwei Organisationen
 * teilen sich keinen Eintrag —, und gelesen wird weiterhin als der angemeldete
 * Nutzer durch die RLS.
 */
export const listDataViewUsers = cache(async function listDataViewUsers(
  workspaceId: string,
): Promise<DataViewUser[]> {
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
});

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
