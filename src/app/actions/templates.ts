"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { revalidatePath } from "next/cache";

// Follow-up-Vorlagen pro Nutzer (FU1–FU3). {name} wird durch den Vornamen
// des Leads ersetzt. Fallback auf die Standard-Texte in nachfassen.ts.

export type FollowupTemplate = { fu_number: number; body: string };

export async function getFollowupTemplates(
  userId?: string,
): Promise<FollowupTemplate[]> {
  const access = await getAccessContext();
  if (!access) return [];
  const supabase = await createClient();
  let q = supabase
    .from("followup_templates")
    .select("fu_number, body")
    .eq("workspace_id", access.workspace_id);
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q;
  if (error) {
    console.error("getFollowupTemplates:", error.message);
    return [];
  }
  return (data ?? []) as FollowupTemplate[];
}

export async function setFollowupTemplate(
  fuNumber: number,
  body: string,
): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (fuNumber < 1 || fuNumber > 3) return { error: "Ungültige FU-Stufe." };

  const supabase = await createClient();
  const userId = access.effective_user_id ?? access.user.id;
  const trimmed = body.trim();

  if (!trimmed) {
    // Leer = Vorlage löschen → Fallback auf Standard
    const { error } = await supabase
      .from("followup_templates")
      .delete()
      .eq("user_id", userId)
      .eq("fu_number", fuNumber);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("followup_templates").upsert(
      {
        workspace_id: access.workspace_id,
        user_id: userId,
        fu_number: fuNumber,
        body: trimmed,
      },
      { onConflict: "user_id,fu_number" },
    );
    if (error) return { error: error.message };
  }

  revalidatePath("/settings", "page");
  revalidatePath("/nachfassen", "page");
  return {};
}

export async function setFollowupTemplateForm(formData: FormData): Promise<void> {
  const fuNumber = Number(formData.get("fu_number"));
  const body = String(formData.get("body") ?? "");
  await setFollowupTemplate(fuNumber, body);
}
