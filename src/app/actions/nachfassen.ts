"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { revalidatePath } from "next/cache";
import { localDateISO, addDaysISO } from "@/lib/dates";

// Nachfassen-Union (LinkedIn-FU + Telefon-Rückruf + Closing-Nachfassen) über die
// nachfassen_tasks-RPC + vorbereiteter Kopier-Text (KEIN Auto-Versand).

export type NachfassenTask = {
  source: "linkedin" | "telefon" | "closing";
  entity_id: string;
  owner_name: string | null;
  lead_name: string | null;
  company: string | null;
  due_at: string | null;
  channel: string;
  next_fu_number: number | null;
  list_id: string | null;
  phone: string | null;
  prepared_text: string;
};

function firstName(name: string | null): string {
  return (name ?? "").trim().split(/\s+/)[0] || "";
}

// Vorbereiteter LinkedIn-Nachfass-Text je FU-Stufe (editierbar durch den Nutzer).
function linkedinFollowUpText(name: string | null, fu: number | null): string {
  const n = firstName(name);
  const hi = n ? `Hey ${n}, ` : "Hey, ";
  switch (fu) {
    case 1:
      return `${hi}ich wollte kurz nachhaken – hattest du schon die Gelegenheit, dir meine Nachricht anzuschauen?`;
    case 2:
      return `${hi}ich weiß, es ist gerade viel los. Magst du mir kurz Bescheid geben, ob das Thema für dich grundsätzlich spannend ist?`;
    case 3:
      return `${hi}letzter Versuch von meiner Seite 🙂 – wenn es aktuell nicht passt, ist das völlig okay, dann melde ich mich in ein paar Monaten nochmal.`;
    default:
      return `${hi}ich melde mich nochmal kurz bei dir.`;
  }
}

export async function getNachfassenTasks(): Promise<NachfassenTask[]> {
  const access = await getAccessContext();
  if (!access) return [];
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("nachfassen_tasks", {
    p_workspace_id: access.workspace_id,
    p_today: localDateISO(),
    p_now: new Date().toISOString(),
    p_effective_user_id: access.effective_user_id ?? null,
  });
  if (error || !data) return [];

  const rows = data as Array<Omit<NachfassenTask, "list_id" | "phone" | "prepared_text">>;

  // Anreichern: list_id (LinkedIn/Telefon) + Telefonnummer
  const linkedinIds = rows.filter((r) => r.source === "linkedin").map((r) => r.entity_id);
  const telefonIds = rows.filter((r) => r.source === "telefon").map((r) => r.entity_id);

  const contactList = new Map<string, string>();
  if (linkedinIds.length > 0) {
    const { data: cs } = await supabase.from("contacts").select("id, list_id").in("id", linkedinIds);
    (cs ?? []).forEach((c) => contactList.set(c.id, c.list_id));
  }
  const leadInfo = new Map<string, { list_id: string; phone: string | null }>();
  if (telefonIds.length > 0) {
    const { data: ls } = await supabase.from("phone_leads").select("id, list_id, phone").in("id", telefonIds);
    (ls ?? []).forEach((l) => leadInfo.set(l.id, { list_id: l.list_id, phone: l.phone }));
  }

  return rows.map((r) => {
    let list_id: string | null = null;
    let phone: string | null = null;
    let prepared_text = "";
    if (r.source === "linkedin") {
      list_id = contactList.get(r.entity_id) ?? null;
      prepared_text = linkedinFollowUpText(r.lead_name, r.next_fu_number);
    } else if (r.source === "telefon") {
      const info = leadInfo.get(r.entity_id);
      list_id = info?.list_id ?? null;
      phone = info?.phone ?? null;
      prepared_text = `Rückruf fällig: ${r.lead_name ?? "—"}${r.company ? ` (${r.company})` : ""}${phone ? ` · ${phone}` : ""}`;
    } else {
      prepared_text = `Closing nachfassen: ${r.lead_name ?? "—"}${r.company ? ` (${r.company})` : ""}`;
    }
    return { ...r, list_id, phone, prepared_text };
  });
}

/** LinkedIn-Lead als beantwortet markieren → raus aus dem Follow-up-Flow. */
export async function markLinkedInAnswered(contactId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: c } = await supabase.from("contacts").select("id, list_id").eq("id", contactId).maybeSingle();
  if (!c) return { error: "Kontakt nicht gefunden." };
  const { error } = await supabase
    .from("contacts")
    .update({ answered: true, next_follow_up_at: null })
    .eq("id", contactId);
  if (error) return { error: error.message };
  revalidatePath("/nachfassen", "page");
  revalidatePath(`/lists/${c.list_id}`, "page");
  revalidatePath("/", "layout");
  return {};
}

/** LinkedIn-Follow-up erledigt: nächste Stufe (+3/+5/+7) oder tot nach FU3. */
export async function advanceLinkedInFollowUp(contactId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: c } = await supabase
    .from("contacts")
    .select("id, list_id, follow_up_number")
    .eq("id", contactId)
    .maybeSingle();
  if (!c) return { error: "Kontakt nicht gefunden." };

  const current = (c as { follow_up_number: number | null }).follow_up_number ?? 0;
  const next = current + 1;
  const daysMap: Record<number, number> = { 0: 3, 1: 5, 2: 7 };
  const nextDate = next <= 3 && daysMap[current] ? addDaysISO(localDateISO(), daysMap[current]) : null;

  const { error } = await supabase
    .from("contacts")
    .update({ follow_up_number: Math.min(next, 3), next_follow_up_at: nextDate })
    .eq("id", contactId);
  if (error) return { error: error.message };
  revalidatePath("/nachfassen", "page");
  revalidatePath(`/lists/${(c as { list_id: string }).list_id}`, "page");
  revalidatePath("/", "layout");
  return {};
}
