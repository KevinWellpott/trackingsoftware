"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const DEFAULT_STAGES: {
  name: string;
  probability_pct: number | null;
  sort_order: number;
  exclude_from_followup: boolean;
}[] = [
  { name: "Neu", probability_pct: 10, sort_order: 0, exclude_from_followup: false },
  { name: "Gespräch", probability_pct: 30, sort_order: 1, exclude_from_followup: false },
  { name: "Angebot", probability_pct: 60, sort_order: 2, exclude_from_followup: false },
  { name: "Verhandlung", probability_pct: 80, sort_order: 3, exclude_from_followup: false },
  { name: "Gewonnen", probability_pct: 100, sort_order: 4, exclude_from_followup: true },
  { name: "Verloren", probability_pct: 0, sort_order: 5, exclude_from_followup: true },
];

export async function createList(
  workspaceId: string,
  name: string,
  pitchText?: string,
  ownerName?: string,
) {
  const supabase = await createClient();
  const { data: list, error: le } = await supabase
    .from("lists")
    .insert({
      workspace_id: workspaceId,
      name: name.trim() || "Neue Liste",
      pitch_text: pitchText?.trim() || null,
      owner_name: ownerName?.trim() || null,
    })
    .select("id")
    .single();
  if (le || !list)
    return { error: le?.message ?? "Liste konnte nicht angelegt werden." };

  const rows = DEFAULT_STAGES.map((s) => ({
    list_id: list.id,
    name: s.name,
    probability_pct: s.probability_pct,
    sort_order: s.sort_order,
    exclude_from_followup: s.exclude_from_followup,
  }));
  const { error: se } = await supabase.from("pipeline_stages").insert(rows);
  if (se) return { error: se.message };

  revalidatePath("/", "layout");
  revalidatePath(`/lists/${list.id}`, "page");
  return { listId: list.id };
}

export async function updateList(
  listId: string,
  patch: { name?: string; pitch_text?: string | null; archived_at?: string | null },
) {
  const supabase = await createClient();
  const { error } = await supabase.from("lists").update(patch).eq("id", listId);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  revalidatePath(`/lists/${listId}`, "page");
  return {};
}

export async function deleteList(listId: string) {
  const supabase = await createClient();
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
  await updateList(listId, { pitch_text: pitchText, ...(name ? { name } : {}) });
}
