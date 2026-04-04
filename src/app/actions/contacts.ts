"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ContactInput = {
  list_id: string;
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  stage_id?: string | null;
  last_contacted_at?: string | null;
  next_follow_up_at?: string | null;
  deal_value?: number | null;
  custom_fields?: Record<string, unknown>;
  // Neue Felder
  pitched_at?: string | null;
  follow_up_number?: 1 | 2 | 3 | null;
  answered?: boolean | null;
  appointment_set?: boolean | null;
  answer_text?: string | null;
  answer_category?: string | null;
};

/** Berechnet next_follow_up_at automatisch aus pitched_at und follow_up_number. */
function calcNextFollowUp(
  pitchedAt: string | null | undefined,
  fuNumber: 1 | 2 | 3 | null | undefined,
  answered: boolean | null | undefined,
): string | null {
  // Wenn geantwortet oder letztes FU erledigt → kein weiteres Follow-up
  if (answered === true || fuNumber === 3) return null;
  if (!pitchedAt) return null;
  const [y, m, d] = pitchedAt.split("-").map(Number);
  const base = new Date(y, m - 1, d);
  const daysMap: Record<number, number> = { 0: 3, 1: 5, 2: 7 };
  const days = daysMap[fuNumber ?? 0] ?? 3;
  base.setDate(base.getDate() + days);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function createContact(input: ContactInput) {
  const supabase = await createClient();
  // Sicherstellen dass pitched_at immer gesetzt ist — jeder Eintrag = eine DM
  if (!input.pitched_at) input.pitched_at = todayLocal();
  const nextFU = calcNextFollowUp(input.pitched_at, input.follow_up_number, input.answered);
  const { data, error } = await supabase
    .from("contacts")
    .insert({
      list_id: input.list_id,
      name: input.name.trim(),
      company: input.company ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      notes: input.notes ?? null,
      stage_id: input.stage_id ?? null,
      last_contacted_at: input.last_contacted_at ?? null,
      next_follow_up_at: nextFU,
      deal_value: input.deal_value ?? null,
      custom_fields: input.custom_fields ?? {},
      pitched_at: input.pitched_at ?? null,
      follow_up_number: input.follow_up_number ?? null,
      answered: input.answered ?? null,
      appointment_set: input.appointment_set ?? null,
      answer_text: input.answer_text ?? null,
      answer_category: input.answer_category ?? null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath(`/lists/${input.list_id}`, "page");
  revalidatePath("/", "layout");
  return { id: data.id };
}

export async function updateContact(
  contactId: string,
  listId: string,
  patch: Partial<ContactInput>,
) {
  const supabase = await createClient();
  const { name, ...rest } = patch;
  const payload: Record<string, unknown> = { ...rest };
  if (name !== undefined) payload.name = name.trim();

  // Immer next_follow_up_at auto-berechnen wenn pitch-relevante Felder geändert werden
  if (
    patch.pitched_at !== undefined ||
    patch.follow_up_number !== undefined ||
    patch.answered !== undefined
  ) {
    // Aktuelle Werte aus DB holen falls nicht im patch
    if (
      patch.pitched_at === undefined ||
      patch.follow_up_number === undefined ||
      patch.answered === undefined
    ) {
      const { data: current } = await (await createClient())
        .from("contacts")
        .select("pitched_at, follow_up_number, answered")
        .eq("id", contactId)
        .single();
      if (current) {
        payload.next_follow_up_at = calcNextFollowUp(
          patch.pitched_at !== undefined ? patch.pitched_at : current.pitched_at,
          patch.follow_up_number !== undefined ? patch.follow_up_number : current.follow_up_number,
          patch.answered !== undefined ? patch.answered : current.answered,
        );
      }
    } else {
      payload.next_follow_up_at = calcNextFollowUp(
        patch.pitched_at,
        patch.follow_up_number,
        patch.answered,
      );
    }
  }

  const { error } = await supabase
    .from("contacts")
    .update(payload)
    .eq("id", contactId);
  if (error) return { error: error.message };
  revalidatePath(`/lists/${listId}`, "page");
  revalidatePath("/", "layout");
  return {};
}

export async function deleteContact(contactId: string, listId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .delete()
    .eq("id", contactId);
  if (error) return { error: error.message };
  revalidatePath(`/lists/${listId}`, "page");
  revalidatePath("/", "layout");
  return {};
}

function parseDate(v: FormDataEntryValue | null): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

function parseNum(v: FormDataEntryValue | null): number | null {
  const s = v == null ? "" : String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseFollowUpNumber(
  v: FormDataEntryValue | null,
): 1 | 2 | 3 | null {
  const s = v == null ? "" : String(v).trim();
  if (s === "1") return 1;
  if (s === "2") return 2;
  if (s === "3") return 3;
  return null;
}

function parseBool(v: FormDataEntryValue | null): boolean | null {
  const s = v == null ? "" : String(v).trim();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return null;
}

function parseCustomFields(
  v: FormDataEntryValue | null,
): Record<string, unknown> {
  const s = v == null ? "" : String(v).trim();
  if (s === "") return {};
  try {
    const parsed: unknown = JSON.parse(s);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function createContactForm(formData: FormData) {
  const list_id = String(formData.get("list_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const stageRaw = String(formData.get("stage_id") ?? "").trim();
  await createContact({
    list_id,
    name,
    company: String(formData.get("company") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
    stage_id: stageRaw === "" ? null : stageRaw,
    last_contacted_at: parseDate(formData.get("last_contacted_at")),
    next_follow_up_at: parseDate(formData.get("next_follow_up_at")),
    deal_value: parseNum(formData.get("deal_value")),
    custom_fields: parseCustomFields(formData.get("custom_fields")),
    pitched_at: parseDate(formData.get("pitched_at")),
    follow_up_number: parseFollowUpNumber(formData.get("follow_up_number")),
    answered: parseBool(formData.get("answered")),
    appointment_set: parseBool(formData.get("appointment_set")),
    answer_text: String(formData.get("answer_text") ?? "").trim() || null,
    answer_category: String(formData.get("answer_category") ?? "").trim() || null,
  });
}

export async function updateContactForm(formData: FormData) {
  const contact_id = String(formData.get("contact_id") ?? "");
  const list_id = String(formData.get("list_id") ?? "");
  if (!contact_id || !list_id) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const stageRaw = String(formData.get("stage_id") ?? "").trim();
  await updateContact(contact_id, list_id, {
    name,
    company: String(formData.get("company") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
    stage_id: stageRaw === "" ? null : stageRaw,
    last_contacted_at: parseDate(formData.get("last_contacted_at")),
    next_follow_up_at: parseDate(formData.get("next_follow_up_at")),
    deal_value: parseNum(formData.get("deal_value")),
    custom_fields: parseCustomFields(formData.get("custom_fields")),
    pitched_at: parseDate(formData.get("pitched_at")),
    follow_up_number: parseFollowUpNumber(formData.get("follow_up_number")),
    answered: parseBool(formData.get("answered")),
    appointment_set: parseBool(formData.get("appointment_set")),
    answer_text: String(formData.get("answer_text") ?? "").trim() || null,
    answer_category: String(formData.get("answer_category") ?? "").trim() || null,
  });
}

export async function deleteContactForm(formData: FormData) {
  const contact_id = String(formData.get("contact_id") ?? "");
  const list_id = String(formData.get("list_id") ?? "");
  if (!contact_id || !list_id) return;
  await deleteContact(contact_id, list_id);
}
