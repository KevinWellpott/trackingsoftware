"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type OrganicPost = {
  id: string;
  list_id: string;
  workspace_id: string;
  owner_name: string | null;
  posted_at: string;
  hook_text: string | null;
  topic: string | null;
  content_type: "educational" | "motivational" | "entertaining" | "bts" | "other" | null;
  insta_impressions: number | null;
  tiktok_impressions: number | null;
  generated_cta: boolean | null;
  cta_notes: string | null;
  stories_done: boolean | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type OrganicList = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  owner_name: string | null;
  archived_at: string | null;
  created_at: string;
};

export type PostInput = {
  list_id: string;
  owner_name?: string | null;
  posted_at?: string | null;
  hook_text?: string | null;
  topic?: string | null;
  content_type?: OrganicPost["content_type"];
  insta_impressions?: number | null;
  tiktok_impressions?: number | null;
  generated_cta?: boolean | null;
  cta_notes?: string | null;
  stories_done?: boolean | null;
  notes?: string | null;
};

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseNum(v: FormDataEntryValue | null): number | null {
  const s = v == null ? "" : String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseBool(v: FormDataEntryValue | null): boolean | null {
  const s = v == null ? "" : String(v).trim();
  if (s === "true" || s === "1") return true;
  return null;
}

// ── Create post ────────────────────────────────────────────────────────────
export async function createOrganicPost(input: PostInput) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organic_posts")
    .insert({
      list_id:            input.list_id,
      owner_name:         input.owner_name ?? null,
      posted_at:          input.posted_at || todayLocal(),
      hook_text:          input.hook_text ?? null,
      topic:              input.topic ?? null,
      content_type:       input.content_type ?? null,
      insta_impressions:  input.insta_impressions ?? null,
      tiktok_impressions: input.tiktok_impressions ?? null,
      generated_cta:      input.generated_cta ?? null,
      cta_notes:          input.cta_notes ?? null,
      stories_done:       input.stories_done ?? null,
      notes:              input.notes ?? null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath(`/organic/${input.list_id}`, "page");
  revalidatePath("/organic", "layout");
  return { id: data.id };
}

export async function createOrganicPostForm(formData: FormData) {
  const list_id = String(formData.get("list_id") ?? "");
  if (!list_id) return;
  await createOrganicPost({
    list_id,
    owner_name:         String(formData.get("owner_name") ?? "").trim() || null,
    posted_at:          String(formData.get("posted_at") ?? "").trim() || null,
    hook_text:          String(formData.get("hook_text") ?? "").trim() || null,
    topic:              String(formData.get("topic") ?? "").trim() || null,
    content_type:       (String(formData.get("content_type") ?? "").trim() || null) as OrganicPost["content_type"],
    insta_impressions:  parseNum(formData.get("insta_impressions")),
    tiktok_impressions: parseNum(formData.get("tiktok_impressions")),
    generated_cta:      parseBool(formData.get("generated_cta")),
    cta_notes:          String(formData.get("cta_notes") ?? "").trim() || null,
    stories_done:       parseBool(formData.get("stories_done")),
    notes:              String(formData.get("notes") ?? "").trim() || null,
  });
}

// ── Update post ────────────────────────────────────────────────────────────
export async function updateOrganicPost(postId: string, listId: string, patch: Partial<PostInput>) {
  const supabase = await createClient();
  const payload: Record<string, unknown> = {};
  if (patch.posted_at          !== undefined) payload.posted_at          = patch.posted_at;
  if (patch.hook_text          !== undefined) payload.hook_text          = patch.hook_text;
  if (patch.topic              !== undefined) payload.topic              = patch.topic;
  if (patch.content_type       !== undefined) payload.content_type       = patch.content_type;
  if (patch.insta_impressions  !== undefined) payload.insta_impressions  = patch.insta_impressions;
  if (patch.tiktok_impressions !== undefined) payload.tiktok_impressions = patch.tiktok_impressions;
  if (patch.generated_cta      !== undefined) payload.generated_cta      = patch.generated_cta;
  if (patch.cta_notes          !== undefined) payload.cta_notes          = patch.cta_notes;
  if (patch.stories_done       !== undefined) payload.stories_done       = patch.stories_done;
  if (patch.notes              !== undefined) payload.notes              = patch.notes;

  const { error } = await supabase.from("organic_posts").update(payload).eq("id", postId);
  if (error) return { error: error.message };
  revalidatePath(`/organic/${listId}`, "page");
  revalidatePath("/organic", "layout");
  return {};
}

// ── Delete post ────────────────────────────────────────────────────────────
export async function deleteOrganicPost(postId: string, listId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("organic_posts").delete().eq("id", postId);
  if (error) return { error: error.message };
  revalidatePath(`/organic/${listId}`, "page");
  revalidatePath("/organic", "layout");
  return {};
}

export async function deleteOrganicPostForm(formData: FormData) {
  const post_id = String(formData.get("post_id") ?? "");
  const list_id = String(formData.get("list_id") ?? "");
  if (!post_id || !list_id) return;
  await deleteOrganicPost(post_id, list_id);
}

// ── Create organic list ────────────────────────────────────────────────────
export async function createOrganicList(workspaceId: string, name: string, ownerName?: string, description?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organic_lists")
    .insert({
      workspace_id: workspaceId,
      name:         name.trim() || "Neue Serie",
      owner_name:   ownerName?.trim() || null,
      description:  description?.trim() || null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/organic", "layout");
  return { listId: data.id };
}

export async function createOrganicListForm(formData: FormData) {
  const workspaceId = String(formData.get("workspace_id") ?? "");
  const name        = String(formData.get("name") ?? "");
  const ownerName   = String(formData.get("owner_name") ?? "");
  const res = await createOrganicList(workspaceId, name, ownerName);
  if ("error" in res) return;
  if ("listId" in res && res.listId) {
    redirect(`/organic/${res.listId}`);
  }
}

// ── Delete organic list ────────────────────────────────────────────────────
export async function deleteOrganicList(listId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("organic_lists").delete().eq("id", listId);
  if (error) return { error: error.message };
  revalidatePath("/organic", "layout");
  return {};
}
