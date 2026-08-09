"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { revalidatePath } from "next/cache";
import { localDateISO, addDaysISO } from "@/lib/dates";
import { FU_MAX_STAGE, nextFollowUpAfter } from "@/lib/followup";
import { fetchAllRows } from "@/lib/supabase/fetchAll";

// Nachfassen-Union (LinkedIn-FU + Telefon-Rückruf + Closing-Nachfassen +
// Setting-Wiedervorlage) über die nachfassen_tasks-RPC + vorbereiteter
// Kopier-Text (KEIN Auto-Versand).

export type NachfassenTask = {
  source: "linkedin" | "telefon" | "closing" | "setting";
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
      return `${hi}letzter Versuch von meiner Seite – wenn es aktuell nicht passt, ist das völlig okay, dann melde ich mich in ein paar Monaten nochmal.`;
    default:
      return `${hi}ich melde mich nochmal kurz bei dir.`;
  }
}

export type NachfassenResult = {
  tasks: NachfassenTask[];
  hiddenOlder: number; // ältere LinkedIn-Leads (Pitch > 7 Tage), ausgeblendet
};

export async function getNachfassenTasks(options?: {
  includeOlder?: boolean;
}): Promise<NachfassenResult> {
  const access = await getAccessContext();
  if (!access) return { tasks: [], hiddenOlder: 0 };
  const supabase = await createClient();

  // IMMER personenbezogen: der eingeloggte Nutzer (bzw. die aktive Admin-Datensicht).
  const scopeUserId = access.effective_user_id ?? access.user.id;

  // RPC paginieren (PostgREST cappt auch Funktions-Ergebnisse bei 1000).
  let rows: Array<Omit<NachfassenTask, "list_id" | "phone" | "prepared_text">> = [];
  try {
    rows = await fetchAllRows((from, to) =>
      supabase
        .rpc("nachfassen_tasks", {
          p_workspace_id: access.workspace_id,
          p_today: localDateISO(),
          p_now: new Date().toISOString(),
          p_effective_user_id: scopeUserId,
        })
        .range(from, to),
    );
  } catch (e) {
    console.error("nachfassen_tasks:", e instanceof Error ? e.message : e);
    return { tasks: [], hiddenOlder: 0 };
  }
  // Stabile Reihenfolge clientseitig (RPC hat kein ORDER BY)
  rows.sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? "") || a.entity_id.localeCompare(b.entity_id));

  // Anreichern: list_id (LinkedIn/Telefon) + Telefonnummer + pitched_at (Cutoff)
  const linkedinIds = rows.filter((r) => r.source === "linkedin").map((r) => r.entity_id);
  const telefonIds = rows.filter((r) => r.source === "telefon").map((r) => r.entity_id);

  const contactInfo = new Map<string, { list_id: string; pitched_at: string | null }>();
  if (linkedinIds.length > 0) {
    // .in()-Batches (URL-Länge) + fetchAllRows nicht nötig, da bereits ID-gebunden
    for (let i = 0; i < linkedinIds.length; i += 200) {
      const chunk = linkedinIds.slice(i, i + 200);
      const { data: cs } = await supabase
        .from("contacts")
        .select("id, list_id, pitched_at")
        .in("id", chunk);
      (cs ?? []).forEach((c) =>
        contactInfo.set(c.id, { list_id: c.list_id, pitched_at: (c as { pitched_at: string | null }).pitched_at }),
      );
    }
  }
  const leadInfo = new Map<string, { list_id: string; phone: string | null }>();
  if (telefonIds.length > 0) {
    for (let i = 0; i < telefonIds.length; i += 200) {
      const chunk = telefonIds.slice(i, i + 200);
      const { data: ls } = await supabase.from("phone_leads").select("id, list_id, phone").in("id", chunk);
      (ls ?? []).forEach((l) => leadInfo.set(l.id, { list_id: l.list_id, phone: l.phone }));
    }
  }

  // Eigene FU-Vorlagen des Scope-Nutzers laden (Fallback: Standardtexte)
  const templates = new Map<number, string>();
  {
    const { data: tpl } = await supabase
      .from("followup_templates")
      .select("fu_number, body")
      .eq("user_id", scopeUserId);
    (tpl ?? []).forEach((t) => templates.set(t.fu_number, t.body));
  }

  // Listen-eigene Nachfass-Sequenz (hat Vorrang vor der Nutzer-Vorlage) —
  // nur für die Listen, aus denen tatsächlich Aufgaben stammen.
  const listTexts = new Map<string, (string | null)[]>();
  {
    const listIds = [...new Set([...contactInfo.values()].map((i) => i.list_id))];
    for (let i = 0; i < listIds.length; i += 200) {
      const { data: ls } = await supabase
        .from("lists")
        .select("id, fu1_text, fu2_text, fu3_text")
        .in("id", listIds.slice(i, i + 200));
      (ls ?? []).forEach((l) => {
        const row = l as { id: string; fu1_text: string | null; fu2_text: string | null; fu3_text: string | null };
        listTexts.set(row.id, [row.fu1_text, row.fu2_text, row.fu3_text]);
      });
    }
  }

  // Cutoff: nur Leads der letzten 7 Tage nachfassen (Bestandsdaten bleiben unangetastet,
  // ältere sind über includeOlder erreichbar).
  const cutoff = addDaysISO(localDateISO(), -7);
  let hiddenOlder = 0;

  const tasks: NachfassenTask[] = [];
  for (const r of rows) {
    let list_id: string | null = null;
    let phone: string | null = null;
    let prepared_text = "";
    if (r.source === "linkedin") {
      const info = contactInfo.get(r.entity_id);
      list_id = info?.list_id ?? null;
      const pitched = info?.pitched_at ?? null;
      if (!options?.includeOlder && (!pitched || pitched < cutoff)) {
        hiddenOlder++;
        continue;
      }
      const listFu =
        list_id && r.next_fu_number != null
          ? listTexts.get(list_id)?.[r.next_fu_number - 1] ?? null
          : null;
      prepared_text = followUpTextFor(templates, r.lead_name, r.next_fu_number, listFu);
    } else if (r.source === "telefon") {
      const info = leadInfo.get(r.entity_id);
      list_id = info?.list_id ?? null;
      phone = info?.phone ?? null;
      prepared_text = `Rückruf fällig: ${r.lead_name ?? "—"}${r.company ? ` (${r.company})` : ""}${phone ? ` · ${phone}` : ""}`;
    } else if (r.source === "setting") {
      prepared_text = `Setting nachfassen: ${r.lead_name ?? "—"}${r.company ? ` (${r.company})` : ""}`;
    } else {
      prepared_text = `Closing nachfassen: ${r.lead_name ?? "—"}${r.company ? ` (${r.company})` : ""}`;
    }
    tasks.push({ ...r, list_id, phone, prepared_text });
  }

  return { tasks, hiddenOlder };
}

// Reihenfolge: Text der Pitch-Liste > Vorlage des Nutzers > Standardtext.
// Die Listen-Sequenz gewinnt, weil sie fachlich zum Pitch-Text derselben Liste
// gehört ({name}-Platzhalter überall gleich).
function followUpTextFor(
  templates: Map<number, string>,
  leadName: string | null,
  fu: number | null,
  listText?: string | null,
): string {
  const fill = (t: string) => t.replaceAll("{name}", firstName(leadName) || "du");
  if (listText && listText.trim()) return fill(listText);
  const custom = fu != null ? templates.get(fu) : undefined;
  if (custom) return fill(custom);
  return linkedinFollowUpText(leadName, fu);
}

/** LinkedIn-Lead als beantwortet markieren → raus aus dem Follow-up-Flow. */
export async function markLinkedInAnswered(contactId: string): Promise<{ error?: string }> {
  // Ohne Org-Filter waere dies fuer einen Plattform-Admin ein Schreibzugriff
  // auf JEDEN Kontakt der Plattform — RLS laesst dort alles durch.
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  const supabase = await createClient();
  const { data: c } = await supabase
    .from("contacts")
    .select("id, list_id")
    .eq("id", contactId)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();
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

/**
 * LinkedIn-Follow-up erledigt: Stufe hochzählen und die nächste Wiedervorlage
 * setzen (nach FU1 +5, nach FU2 +7, nach FU3 keine mehr — der Flow endet).
 */
export async function advanceLinkedInFollowUp(contactId: string): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  const supabase = await createClient();
  const { data: c } = await supabase
    .from("contacts")
    .select("id, list_id, follow_up_number")
    .eq("id", contactId)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();
  if (!c) return { error: "Kontakt nicht gefunden." };

  const current = (c as { follow_up_number: number | null }).follow_up_number ?? 0;
  // `done` ist die Stufe, die mit diesem Klick ABGESCHLOSSEN wird — und genau
  // nach ihr ist der Rhythmus geschlüsselt: nach FU1 folgt FU2 in +5 Tagen,
  // nicht in +3 (das ist der Abstand Pitch → FU1). Vorher rechnete dieser Pfad
  // mit `current`, der Stufe DAVOR, und lag damit systematisch zwei Tage vor
  // dem Listen-Board (calcNextFollowUp in actions/contacts.ts).
  const done = Math.min(current + 1, FU_MAX_STAGE);
  // Anker ist HEUTE, nicht das Pitch-Datum: bei älteren Leads läge die nächste
  // Stufe sonst sofort in der Vergangenheit und bliebe überfällig hängen.
  // Nach FU3 liefert nextFollowUpAfter null — der Flow endet dort wirklich
  // (vorher wurde noch +7 gesetzt; das fiel nur nicht auf, weil die RPCs
  // Stufe 3 ohnehin ausschließen).
  const nextDate = nextFollowUpAfter(done, localDateISO());

  const { error } = await supabase
    .from("contacts")
    .update({ follow_up_number: done, next_follow_up_at: nextDate })
    .eq("id", contactId);
  if (error) return { error: error.message };
  revalidatePath("/nachfassen", "page");
  revalidatePath(`/lists/${(c as { list_id: string }).list_id}`, "page");
  revalidatePath("/", "layout");
  return {};
}
