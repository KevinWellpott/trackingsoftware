"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { revalidatePath } from "next/cache";
import { parsePhoneCsv } from "@/lib/phone-csv";
import type { PhoneListKind } from "@/lib/types";

// Telefonakquise: Listen, Routing (Rückruf/Nicht erreicht = echte separate Listen),
// Lead-CRUD und CSV-Import. Personenbezogen über created_by_user_id/owner_name.

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function canAccessPhoneList(listId: string): Promise<boolean> {
  const access = await getAccessContext();
  if (!access) return false;
  const supabase = await createClient();
  let query = supabase
    .from("phone_lists")
    .select("id")
    .eq("id", listId)
    .eq("workspace_id", access.workspace_id);
  if (access.effective_user_id) {
    query = query.eq("created_by_user_id", access.effective_user_id);
  }
  const { data } = await query.maybeSingle();
  return Boolean(data);
}

const ROUTING_LABEL: Record<Exclude<PhoneListKind, "akquise">, string> = {
  rueckruf: "Rückruf",
  nicht_erreicht: "Nicht erreicht",
};

/** Stellt sicher, dass die Routing-Liste (Rückruf / Nicht erreicht) für den Owner existiert. */
async function ensurePhoneRoutingList(
  source: { workspace_id: string; created_by_user_id: string | null; owner_name: string | null },
  kind: Exclude<PhoneListKind, "akquise">,
): Promise<string | null> {
  const supabase = await createClient();
  let sel = supabase
    .from("phone_lists")
    .select("id")
    .eq("workspace_id", source.workspace_id)
    .eq("list_kind", kind);
  sel = source.created_by_user_id
    ? sel.eq("created_by_user_id", source.created_by_user_id)
    : sel.is("created_by_user_id", null);
  const { data: existing } = await sel.maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from("phone_lists")
    .insert({
      workspace_id: source.workspace_id,
      created_by_user_id: source.created_by_user_id,
      owner_name: source.owner_name,
      name: ROUTING_LABEL[kind],
      list_kind: kind,
    })
    .select("id")
    .single();
  if (error || !created) return null;
  return created.id;
}

/** Neue Akquise-Liste anlegen (für den Import; owner kann von auth.uid abweichen). */
export async function createPhoneList(input: {
  name: string;
  ownerName: string | null;
  ownerUserId: string | null;
}): Promise<{ id?: string; error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("phone_lists")
    .insert({
      workspace_id: access.workspace_id,
      created_by_user_id: input.ownerUserId ?? access.user.id,
      owner_name: input.ownerName,
      name: input.name.trim() || "Telefonliste",
      list_kind: "akquise",
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Liste anlegen fehlgeschlagen." };
  revalidatePath("/telefon", "page");
  revalidatePath("/", "layout");
  return { id: data.id };
}

export type PhoneLeadInput = {
  list_id: string;
  decider_name?: string | null;
  company?: string | null;
  phone?: string | null;
  website?: string | null;
  email?: string | null;
  decider_direct_dial?: string | null;
  first_call_at?: string | null;
  call_attempt?: number | null;
  gatekeeper_reached?: "ja" | "nein" | "direkt" | null;
  gatekeeper_attempts?: number | null;
  script?: string | null;
  decider_reached?: boolean | null;
  callback_at?: string | null;
  answer_sentiment?: "positiv" | "neutral" | "negativ" | null;
  objection_notes?: string | null;
  no_transfer_reason?: string | null;
  no_pitch_reason?: string | null;
  no_appointment_reason?: string | null;
  mailbox?: boolean | null;
  yt_video_link?: string | null;
  target_group?: string | null;
  notes?: string | null;
};

export async function createPhoneLead(input: PhoneLeadInput): Promise<{ id?: string; error?: string }> {
  if (!(await canAccessPhoneList(input.list_id))) return { error: "Keine Berechtigung." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("phone_leads")
    .insert({ ...input, status: "aktiv" })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Anlegen fehlgeschlagen." };
  revalidatePath(`/telefon/${input.list_id}`, "page");
  revalidatePath("/telefon", "page");
  return { id: data.id };
}

export async function updatePhoneLead(
  leadId: string,
  listId: string,
  patch: Partial<PhoneLeadInput>,
): Promise<{ error?: string }> {
  if (!(await canAccessPhoneList(listId))) return { error: "Keine Berechtigung." };
  const supabase = await createClient();
  const { error } = await supabase.from("phone_leads").update(patch).eq("id", leadId).eq("list_id", listId);
  if (error) return { error: error.message };
  revalidatePath(`/telefon/${listId}`, "page");
  revalidatePath("/telefon", "page");
  return {};
}

/**
 * Ergebnis eines Anrufs setzen. Rückruf/Nicht-erreicht verschieben den Lead
 * physisch in die jeweilige Routing-Liste des Owners. Rückruf braucht callback_at.
 */
export async function setPhoneLeadOutcome(input: {
  leadId: string;
  listId: string;
  outcome: "aktiv" | "rueckruf" | "nicht_erreicht" | "dead";
  callbackAt?: string | null;
}): Promise<{ error?: string }> {
  if (!(await canAccessPhoneList(input.listId))) return { error: "Keine Berechtigung." };
  if (input.outcome === "rueckruf" && !input.callbackAt) {
    return { error: "Für einen Rückruf ist Datum + Uhrzeit erforderlich." };
  }
  const supabase = await createClient();

  // Lead + Quell-Liste laden (Owner/Workspace für Routing)
  const { data: lead } = await supabase
    .from("phone_leads")
    .select("id, list_id, first_call_at, phone_lists!inner(workspace_id, created_by_user_id, owner_name)")
    .eq("id", input.leadId)
    .maybeSingle();
  if (!lead) return { error: "Lead nicht gefunden." };
  const srcList = (lead as unknown as {
    phone_lists: { workspace_id: string; created_by_user_id: string | null; owner_name: string | null };
  }).phone_lists;

  const patch: Record<string, unknown> = { status: input.outcome };
  if (!(lead as { first_call_at?: string | null }).first_call_at) patch.first_call_at = todayLocal();

  if (input.outcome === "rueckruf") {
    patch.callback_at = input.callbackAt;
    const target = await ensurePhoneRoutingList(srcList, "rueckruf");
    if (target) patch.list_id = target;
  } else if (input.outcome === "nicht_erreicht") {
    const target = await ensurePhoneRoutingList(srcList, "nicht_erreicht");
    if (target) patch.list_id = target;
  }
  // 'dead' und 'aktiv' bleiben in der aktuellen Liste.

  const { error } = await supabase.from("phone_leads").update(patch).eq("id", input.leadId);
  if (error) return { error: error.message };
  revalidatePath(`/telefon/${input.listId}`, "page");
  revalidatePath("/telefon", "page");
  revalidatePath("/nachfassen", "page");
  revalidatePath("/", "layout");
  return {};
}

/** Ganze Telefonliste löschen (Leads hängen per ON DELETE CASCADE dran). */
export async function deletePhoneList(listId: string): Promise<{ error?: string }> {
  if (!(await canAccessPhoneList(listId))) return { error: "Keine Berechtigung." };
  const supabase = await createClient();
  const { error } = await supabase.from("phone_lists").delete().eq("id", listId);
  if (error) return { error: error.message };
  revalidatePath("/telefon", "page");
  revalidatePath("/", "layout");
  return {};
}

export async function deletePhoneLead(leadId: string, listId: string): Promise<{ error?: string }> {
  if (!(await canAccessPhoneList(listId))) return { error: "Keine Berechtigung." };
  const supabase = await createClient();
  const { error } = await supabase.from("phone_leads").delete().eq("id", leadId).eq("list_id", listId);
  if (error) return { error: error.message };
  revalidatePath(`/telefon/${listId}`, "page");
  revalidatePath("/telefon", "page");
  return {};
}

/** CSV-Import (Google-Maps-Export). Nur Firma/Telefon/Website; personenbezogen. */
export async function importPhoneCsv(
  formData: FormData,
): Promise<{ error?: string; imported?: number; duplicates?: number; total?: number; listId?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Keine Datei erhalten." };
  const ownerName = String(formData.get("owner_name") ?? "").trim() || null;
  const ownerUserId = String(formData.get("owner_user_id") ?? "").trim() || access.user.id;
  const listName =
    String(formData.get("list_name") ?? "").trim() ||
    file.name.replace(/\.csv$/i, "").trim() ||
    "Telefonliste";

  const text = await file.text();
  const { rows, totalDataRows } = parsePhoneCsv(text);
  if (rows.length === 0) return { error: "Keine verwertbaren Zeilen (Firma/Telefon) gefunden.", total: totalDataRows };

  const supabase = await createClient();

  // Akquise-Liste anlegen
  const { data: list, error: listErr } = await supabase
    .from("phone_lists")
    .insert({
      workspace_id: access.workspace_id,
      created_by_user_id: ownerUserId,
      owner_name: ownerName,
      name: listName,
      list_kind: "akquise",
    })
    .select("id")
    .single();
  if (listErr || !list) return { error: listErr?.message ?? "Liste anlegen fehlgeschlagen." };

  // Dedup gegen bestehende Telefonnummern des Owners
  const { data: existing } = await supabase
    .from("phone_leads")
    .select("phone")
    .eq("created_by_user_id", ownerUserId);
  const seen = new Set(
    (existing ?? []).map((r) => (r.phone ?? "").replace(/[^\d+]/g, "")).filter(Boolean),
  );

  const toInsert: Array<Record<string, unknown>> = [];
  let duplicates = 0;
  for (const r of rows) {
    const norm = (r.phone ?? "").replace(/[^\d+]/g, "");
    if (norm && seen.has(norm)) {
      duplicates++;
      continue;
    }
    if (norm) seen.add(norm);
    toInsert.push({
      list_id: list.id,
      created_by_user_id: ownerUserId,
      company: r.company,
      phone: r.phone,
      website: r.website,
      status: "aktiv",
    });
  }

  // Batched insert (≤500)
  let imported = 0;
  for (let i = 0; i < toInsert.length; i += 500) {
    const chunk = toInsert.slice(i, i + 500);
    const { error } = await supabase.from("phone_leads").insert(chunk);
    if (error) return { error: error.message, imported, duplicates, total: totalDataRows, listId: list.id };
    imported += chunk.length;
  }

  await supabase.from("csv_imports").insert({
    workspace_id: access.workspace_id,
    created_by_user_id: ownerUserId,
    owner_name: ownerName,
    filename: file.name,
    phone_list_id: list.id,
    row_count: totalDataRows,
    imported_count: imported,
    duplicate_count: duplicates,
  });

  revalidatePath("/telefon", "page");
  revalidatePath("/", "layout");
  return { imported, duplicates, total: totalDataRows, listId: list.id };
}
