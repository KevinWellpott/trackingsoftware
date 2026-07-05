"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { revalidatePath } from "next/cache";

// Flexibles Multi-Select: Setter/Closer einem Setting-/Closing-Call zuweisen.
// call_assignees ist RLS-gescoped; wir prüfen zusätzlich Zugriff auf die Entität.

export type AssigneeEntity = "setting_call" | "closing_call";

async function canAccessEntity(entity: AssigneeEntity, entityId: string): Promise<boolean> {
  const supabase = await createClient();
  const table = entity === "setting_call" ? "setting_calls" : "closing_calls";
  const { data } = await supabase.from(table).select("id").eq("id", entityId).maybeSingle();
  return Boolean(data); // RLS lässt nur zugreifbare Zeilen durch
}

export type Assignee = { user_id: string; username: string };

export async function getAssignees(entity: AssigneeEntity, entityId: string): Promise<Assignee[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("call_assignees")
    .select("user_id, profiles ( username )")
    .eq("entity_type", entity)
    .eq("entity_id", entityId);
  return ((data ?? []) as unknown as { user_id: string; profiles: { username: string } | null }[]).map((r) => ({
    user_id: r.user_id,
    username: r.profiles?.username ?? r.user_id,
  }));
}

/** Zuweisungen setzen (Diff: fehlende einfügen, entfernte löschen). */
export async function setAssignees(
  entity: AssigneeEntity,
  entityId: string,
  userIds: string[],
): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (!(await canAccessEntity(entity, entityId))) return { error: "Keine Berechtigung." };

  const supabase = await createClient();
  const desired = new Set(userIds);
  const { data: current } = await supabase
    .from("call_assignees")
    .select("user_id")
    .eq("entity_type", entity)
    .eq("entity_id", entityId);
  const existing = new Set((current ?? []).map((r) => r.user_id));

  const toAdd = [...desired].filter((u) => !existing.has(u));
  const toRemove = [...existing].filter((u) => !desired.has(u));

  if (toAdd.length > 0) {
    const rows = toAdd.map((user_id) => ({
      workspace_id: access.workspace_id,
      entity_type: entity,
      entity_id: entityId,
      user_id,
    }));
    const { error } = await supabase.from("call_assignees").insert(rows);
    if (error) return { error: error.message };
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("call_assignees")
      .delete()
      .eq("entity_type", entity)
      .eq("entity_id", entityId)
      .in("user_id", toRemove);
    if (error) return { error: error.message };
  }

  revalidatePath("/setting", "page");
  revalidatePath("/closing", "page");
  return {};
}
