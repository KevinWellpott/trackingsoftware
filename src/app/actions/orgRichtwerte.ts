"use server";

// Richtwerte je Organisation (Migration 0051) — nur Plattform-Admins.
// Die Datenbank prüft dasselbe noch einmal per RLS (`is_platform_admin()`).

import { revalidatePath } from "next/cache";
import { getAccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { KENNZAHLEN, parseRichtwert, type Richtwerte } from "@/lib/orgUebersicht";

const UUID = /^[0-9a-f-]{36}$/i;

export async function speichereOrgRichtwerte(input: {
  /** Eine Organisation oder mehrere („für alle übernehmen“). */
  workspaceIds: string[];
  werte: Record<string, unknown>;
}): Promise<{ error?: string; ok?: number }> {
  const access = await getAccessContext();
  if (!access?.is_platform_admin) return { error: "Nur für Plattform-Admins." };

  const erlaubt = new Set(access.available_workspaces.map((w) => w.id));
  const ids = [...new Set(input.workspaceIds ?? [])].filter((id) => UUID.test(id) && erlaubt.has(id));
  if (ids.length === 0) return { error: "Keine gültige Organisation gewählt." };

  const werte = {} as Richtwerte;
  for (const k of KENNZAHLEN) {
    const v = parseRichtwert(input.werte?.[k.key]);
    if (v === undefined) return { error: `${k.label}: bitte eine ganze Zahl zwischen 0 und 100.000 (oder leer lassen).` };
    werte[k.key] = v;
  }

  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from("org_richtwerte").upsert(
    ids.map((workspace_id) => ({ workspace_id, ...werte, updated_by_user_id: access.user.id, updated_at: now })),
    { onConflict: "workspace_id" },
  );
  if (error) {
    const fehlt = /org_richtwerte|does not exist|schema cache/i.test(error.message);
    return { error: fehlt ? "Die Richtwerte fehlen noch in der Datenbank — Migration 0051 ist nicht eingespielt." : error.message };
  }
  revalidatePath("/admin/uebersicht");
  return { ok: ids.length };
}
