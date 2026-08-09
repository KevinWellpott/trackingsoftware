"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext, ownScopeFilter } from "@/lib/access";
import { nextFollowUpAfter } from "@/lib/followup";

// Bewusst KEIN revalidatePath in diesen Actions: alle Zielrouten sind dynamisch
// (Cookies) und rendern beim nächsten Besuch ohnehin frisch. Ein revalidatePath
// aus einer Server-Action rendert die komplette Seite sofort neu (inkl. Laden
// ALLER Kontakte der Liste) und machte jede Inline-Änderung spürbar langsam.
// Die Boards aktualisieren sich selbst: optimistisches UI + router.refresh().

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
  meeting_notes?: string | null;
  deal_closed?: boolean | null;
  deal_lost_reason?: string | null;
  // Tracking 2.0
  linkedin_url?: string | null;
  target_group?: string | null;
};

/**
 * Berechnet next_follow_up_at automatisch aus follow_up_number.
 *
 * Der Rhythmus selbst steht in `nextFollowUpAfter` (src/lib/followup.ts) — eine
 * Quelle für dieses Listen-Board UND für advanceLinkedInFollowUp im
 * Nachfassen-Board. Vorher rechneten beide Pfade eigene daysMaps und kamen für
 * denselben Kontakt auf verschiedene Wiedervorlagen.
 *
 * Der Schlüssel ist immer die gerade ABGESCHLOSSENE Stufe, nicht die nächste:
 * `follow_up_number` dokumentiert, welches Follow-up bereits raus ist. Steht
 * dort eine 1, ist FU1 verschickt und FU2 folgt laut docs/data-model.md §4 in
 * +5 Tagen (nicht +3 — das war der Abstand Pitch → FU1).
 *
 * anchor="pitch": Anker = pitched_at (Erst-Terminierung / pitch-Korrektur).
 * anchor="today": Anker = heute — wenn ein FU gerade als erledigt eingetragen
 * wird, muss die nächste Stufe von HEUTE aus zählen (sonst landet sie bei
 * älteren Leads sofort in der Vergangenheit und bleibt in der Nachfassen-
 * Übersicht überfällig hängen). Deckungsgleich mit advanceLinkedInFollowUp.
 */
function calcNextFollowUp(
  pitchedAt: string | null | undefined,
  fuNumber: 1 | 2 | 3 | null | undefined,
  answered: boolean | null | undefined,
  anchor: "pitch" | "today" = "pitch",
): string | null {
  // Geantwortet → raus aus dem Follow-up-Flow (§4). Das Ende nach FU3
  // entscheidet nextFollowUpAfter selbst (liefert dort null).
  if (answered === true) return null;
  const base = anchor === "today" ? todayLocal() : pitchedAt ?? null;
  if (!base) return null;
  return nextFollowUpAfter(fuNumber, base);
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function canAccessPitchList(listId: string) {
  const access = await getAccessContext();
  if (!access) return false;
  const supabase = await createClient();
  let query = supabase
    .from("lists")
    .select("id")
    .eq("id", listId)
    .eq("workspace_id", access.workspace_id);
  const ownScope = ownScopeFilter(access);
  if (ownScope) {
    query = query.or(ownScope);
  }
  const { data } = await query.maybeSingle();
  return Boolean(data);
}

export async function createContact(input: ContactInput) {
  if (!(await canAccessPitchList(input.list_id))) {
    return { error: "Keine Berechtigung." };
  }
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
      meeting_notes: input.meeting_notes ?? null,
      deal_closed: input.deal_closed ?? false,
      deal_lost_reason: input.deal_lost_reason ?? null,
      linkedin_url: input.linkedin_url ?? null,
      target_group: input.target_group ?? null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: data.id };
}

export async function updateContact(
  contactId: string,
  listId: string,
  patch: Partial<ContactInput>,
) {
  if (!(await canAccessPitchList(listId))) {
    return { error: "Keine Berechtigung." };
  }
  const supabase = await createClient();
  // Ein Select für Existenz-/Scope-Check UND die aktuellen Werte — nötig, um
  // eine ECHTE FU-Änderung zu erkennen und fehlende Patch-Felder aufzufüllen.
  // (ListBoardV2 sendet immer alle Felder, daher reicht "ist im Patch
  // enthalten" nicht als Änderungs-Signal.)
  const { data: current } = await supabase
    .from("contacts")
    .select("id, pitched_at, follow_up_number, answered, blocked_at")
    .eq("id", contactId)
    .eq("list_id", listId)
    .maybeSingle();
  if (!current) return { error: "Keine Berechtigung." };

  const { name, ...rest } = patch;
  const payload: Record<string, unknown> = { ...rest };
  if (name !== undefined) payload.name = name.trim();
  if (patch.deal_closed === null) payload.deal_closed = false;

  // next_follow_up_at auto-berechnen, wenn sich pitch-relevante Felder ändern.
  // Ein EXPLIZIT mitgegebenes next_follow_up_at hat Vorrang (Undo-Pfad im
  // Board stellt damit die alte Fälligkeit exakt wieder her).
  if (
    patch.next_follow_up_at === undefined &&
    (patch.pitched_at !== undefined ||
      patch.follow_up_number !== undefined ||
      patch.answered !== undefined)
  ) {
    const effPitched = patch.pitched_at !== undefined ? patch.pitched_at : current.pitched_at ?? null;
    const effFU = patch.follow_up_number !== undefined ? patch.follow_up_number : current.follow_up_number;
    const effAnswered = patch.answered !== undefined ? patch.answered : current.answered;

    // Nur wenn ein FU NEU auf eine positive Stufe gesetzt wird ("erledigt"),
    // zählt die nächste Fälligkeit ab HEUTE (analog advanceLinkedInFollowUp) —
    // sonst ab pitched_at. So verschiebt ein unabhängiger Feld-Edit (z. B. Notiz)
    // den Nachfass-Termin NICHT.
    const fuAdvanced =
      patch.follow_up_number != null &&
      patch.follow_up_number > 0 &&
      patch.follow_up_number !== (current.follow_up_number ?? null);

    payload.next_follow_up_at = calcNextFollowUp(
      effPitched,
      effFU,
      effAnswered,
      fuAdvanced ? "today" : "pitch",
    );
  }

  // Blockierte Kontakte haben NIE eine Wiedervorlage.
  if (current.blocked_at != null) payload.next_follow_up_at = null;

  const { error } = await supabase
    .from("contacts")
    .update(payload)
    .eq("id", contactId);
  if (error) return { error: error.message };
  return {};
}

/**
 * Lead hat uns auf LinkedIn blockiert (bzw. Blockierung wieder aufheben).
 * Blockieren nimmt den Kontakt aus dem Follow-up-Flow (Wiedervorlage genullt,
 * RPCs filtern zusätzlich auf blocked_at). Entblocken berechnet die
 * Wiedervorlage aus dem aktuellen Stand neu.
 */
export async function setContactBlocked(
  contactId: string,
  listId: string,
  blocked: boolean,
): Promise<{ error?: string }> {
  if (!(await canAccessPitchList(listId))) {
    return { error: "Keine Berechtigung." };
  }
  const supabase = await createClient();
  const { data: current } = await supabase
    .from("contacts")
    .select("id, pitched_at, follow_up_number, answered, appointment_set")
    .eq("id", contactId)
    .eq("list_id", listId)
    .maybeSingle();
  if (!current) return { error: "Keine Berechtigung." };

  const payload = blocked
    ? { blocked_at: new Date().toISOString(), next_follow_up_at: null }
    : {
        blocked_at: null,
        next_follow_up_at:
          current.appointment_set === true
            ? null
            : calcNextFollowUp(current.pitched_at, current.follow_up_number, current.answered),
      };

  const { error } = await supabase
    .from("contacts")
    .update(payload)
    .eq("id", contactId);
  if (error) return { error: error.message };
  return {};
}

export async function deleteContact(contactId: string, listId: string) {
  if (!(await canAccessPitchList(listId))) {
    return { error: "Keine Berechtigung." };
  }
  const supabase = await createClient();
  // Kein Pre-Select nötig: canAccessPitchList hat die Liste bereits gescopet,
  // die list_id-Bedingung bindet den Kontakt an genau diese Liste.
  const { error } = await supabase
    .from("contacts")
    .delete()
    .eq("id", contactId)
    .eq("list_id", listId);
  if (error) return { error: error.message };
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
    meeting_notes: String(formData.get("meeting_notes") ?? "").trim() || null,
    deal_closed: parseBool(formData.get("deal_closed")),
    deal_lost_reason: String(formData.get("deal_lost_reason") ?? "").trim() || null,
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
    meeting_notes: String(formData.get("meeting_notes") ?? "").trim() || null,
    deal_closed: parseBool(formData.get("deal_closed")),
    deal_lost_reason: String(formData.get("deal_lost_reason") ?? "").trim() || null,
  });
}

export async function deleteContactForm(formData: FormData) {
  const contact_id = String(formData.get("contact_id") ?? "");
  const list_id = String(formData.get("list_id") ?? "");
  if (!contact_id || !list_id) return;
  await deleteContact(contact_id, list_id);
}
