"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext, listDataViewUsers, ownScopeFilter } from "@/lib/access";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createList(
  workspaceId: string,
  name: string,
  pitchText?: string,
  ownerName?: string,
) {
  void workspaceId;
  const access = await getAccessContext();
  if (!access) return { error: "Keine Berechtigung." };

  const supabase = await createClient();
  // Der Inhaber muss ein Mitglied der aktiven Organisation sein (docs §2,
  // `owner_name`-Invariante). Ein fremder oder leerer Name machte die Liste
  // heimatlos: DMs zählten bei „—" bzw. beim Ersteller, die Pitch-Quote je
  // Person konnte über 100 % steigen (Live-Test 26.11., P2-5). Ohne Angabe
  // gehört die Liste dem Anlegenden, sofern er Mitglied ist.
  const members = await listDataViewUsers(access.workspace_id);
  const wanted = access.data_scope === "own" ? access.username : ownerName?.trim() || access.username;
  const owner = members.find((m) => m.username.toLowerCase() === (wanted ?? "").toLowerCase());
  if (!owner) {
    const names = members.map((m) => m.username).join(", ");
    return {
      error: names
        ? `Bitte einen Inhaber aus der Organisation wählen: ${names}.`
        : "Die Organisation hat noch kein Mitglied, dem die Liste gehören könnte.",
    };
  }
  const normalizedOwnerName = owner.username;

  const { data: list, error: le } = await supabase
    .from("lists")
    .insert({
      workspace_id: access.workspace_id,
      name: name.trim() || "Neue Liste",
      pitch_text: pitchText?.trim() || null,
      owner_name: normalizedOwnerName,
      created_by_user_id: access.user.id,
    })
    .select("id")
    .single();
  if (le || !list)
    return { error: le?.message ?? "Liste konnte nicht angelegt werden." };

  revalidatePath("/", "layout");
  revalidatePath(`/lists/${list.id}`, "page");
  return { listId: list.id };
}

export async function updateList(
  listId: string,
  patch: {
    name?: string;
    pitch_text?: string | null;
    fu1_text?: string | null;
    fu2_text?: string | null;
    fu3_text?: string | null;
    archived_at?: string | null;
  },
) {
  const access = await getAccessContext();
  if (!access) return { error: "Keine Berechtigung." };
  const supabase = await createClient();
  let accessQuery = supabase
    .from("lists")
    .select("id")
    .eq("id", listId)
    .eq("workspace_id", access.workspace_id);
  const ownScope = ownScopeFilter(access);
  if (ownScope) {
    accessQuery = accessQuery.or(ownScope);
  }
  const { data: list } = await accessQuery.maybeSingle();
  if (!list) return { error: "Keine Berechtigung." };

  const { error } = await supabase.from("lists").update(patch).eq("id", listId);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  revalidatePath(`/lists/${listId}`, "page");
  return {};
}

export async function deleteList(listId: string) {
  const access = await getAccessContext();
  if (!access) return { error: "Keine Berechtigung." };
  const supabase = await createClient();
  let accessQuery = supabase
    .from("lists")
    .select("id")
    .eq("id", listId)
    .eq("workspace_id", access.workspace_id);
  const ownScope = ownScopeFilter(access);
  if (ownScope) {
    accessQuery = accessQuery.or(ownScope);
  }
  const { data: list } = await accessQuery.maybeSingle();
  if (!list) return { error: "Keine Berechtigung." };

  const { error } = await supabase.from("lists").delete().eq("id", listId);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return {};
}

export async function createListForm(formData: FormData) {
  const workspaceId = String(formData.get("workspace_id") ?? "");
  const name = String(formData.get("name") ?? "");
  const pitchText = String(formData.get("pitch_text") ?? "");
  const ownerName = String(formData.get("owner_name") ?? "");
  const res = await createList(workspaceId, name, pitchText, ownerName);
  if (res.error) {
    redirect(`/?err=${encodeURIComponent(res.error)}`);
  }
  if (!("listId" in res) || !res.listId) {
    redirect("/?err=Liste konnte nicht angelegt werden.");
  }
  redirect(`/lists/${res.listId}`);
}

export async function updateListPitchForm(formData: FormData) {
  const listId = String(formData.get("list_id") ?? "");
  const pitchText = String(formData.get("pitch_text") ?? "").trim() || null;
  const name = String(formData.get("name") ?? "").trim();
  if (!listId) return;
  await updateList(listId, {
    pitch_text: pitchText,
    fu1_text: String(formData.get("fu1_text") ?? "").trim() || null,
    fu2_text: String(formData.get("fu2_text") ?? "").trim() || null,
    fu3_text: String(formData.get("fu3_text") ?? "").trim() || null,
    ...(name ? { name } : {}),
  });
}

export async function restoreListForm(formData: FormData) {
  const listId = String(formData.get("list_id") ?? "");
  if (!listId) return;
  await updateList(listId, { archived_at: null });
  revalidatePath("/team/archiv", "page");
  revalidatePath("/listen", "page");
  // Die Sidebar haengt am Dashboard-Layout — ohne das taucht die
  // wiederhergestellte Liste dort erst nach einem harten Reload auf.
  revalidatePath("/", "layout");
}
