// „Setting No-Show"-Listen — die Abfragen. Die Regel steht in settingNoShow.ts.

import { matchesOwnScope, ownScopeFilter, type AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { noShowJeLead, type NoShowSettingRow } from "@/lib/settingNoShow";
import { LIST_CONTACT_COLUMNS, type ListContact, type PhoneLead } from "@/lib/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** PostgREST trägt `.in()` in der URL — 100 UUIDs sind ~3,7 kB und damit sicher. */
const IN_CHUNK = 100;

function chunks<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Alle Settings eines Kanals mit Quell-Lead, je Lead auf das jüngste No-Show
 * verdichtet. Geladen wird bewusst OHNE Status-Filter: Ob ein No-Show der
 * jüngste Anlauf ist, lässt sich nur gegen die übrigen Settings desselben
 * Leads entscheiden.
 */
async function loadNoShowSettings(
  supabase: Supabase,
  workspaceId: string,
  column: "source_phone_lead_id" | "source_contact_id",
): Promise<Map<string, NoShowSettingRow>> {
  const rows = await fetchAllRows<Record<string, unknown>>((from, to) =>
    supabase
      .from("setting_calls")
      .select(`id, ${column}, status, no_show_resolution, appointment_at, created_at`)
      .eq("workspace_id", workspaceId)
      .not(column, "is", null)
      .order("id", { ascending: true })
      .range(from, to),
  );
  return noShowJeLead(
    rows.map((r) => ({
      id: r.id as string,
      source_id: r[column] as string,
      status: (r.status as string | null) ?? null,
      no_show_resolution: (r.no_show_resolution as string | null) ?? null,
      appointment_at: (r.appointment_at as string | null) ?? null,
      created_at: r.created_at as string,
    })),
  );
}

/** Jüngster No-Show zuerst: Wer gestern nicht kam, ist heute noch am ehesten zu erreichen. */
function nachNoShowDatum<T extends { id: string }>(items: T[], noShows: Map<string, NoShowSettingRow>): T[] {
  return [...items].sort((a, b) =>
    (noShows.get(b.id)?.appointment_at ?? "").localeCompare(noShows.get(a.id)?.appointment_at ?? ""),
  );
}

export type PhoneNoShowLead = PhoneLead & { owner_name: string | null };

/**
 * Telefon: Leads, deren jüngstes Setting auf No-Show steht.
 *
 * Zusätzlich `phone_leads.status='termin'`: Der Lead steht nur so lange hier,
 * bis im Call-Mode ein neues Ergebnis für ihn gesetzt wird. Wer „Rückruf",
 * „Nicht erreicht" oder „Kein Termin" bekommt, wandert in die jeweilige
 * Routing-Liste — ohne diese Bedingung stünde er dann in zwei Listen zugleich.
 *
 * Personenfilter wie überall im Telefon-Bereich: über die Liste, in der der
 * Lead liegt (`owner_name` vor `created_by_user_id`, `matchesOwnScope`).
 */
export async function loadPhoneNoShowLeads(access: AccessContext): Promise<PhoneNoShowLead[]> {
  const supabase = await createClient();
  const noShows = await loadNoShowSettings(supabase, access.workspace_id, "source_phone_lead_id");
  if (noShows.size === 0) return [];

  const leads: PhoneNoShowLead[] = [];
  for (const ids of chunks([...noShows.keys()])) {
    const { data, error } = await supabase
      .from("phone_leads")
      .select("*, phone_lists!inner(owner_name, created_by_user_id)")
      .eq("workspace_id", access.workspace_id)
      .eq("status", "termin")
      .in("id", ids);
    if (error) throw new Error(error.message);
    for (const raw of data ?? []) {
      const { phone_lists: list, ...lead } = raw as PhoneLead & {
        phone_lists: { owner_name: string | null; created_by_user_id: string | null };
      };
      if (!matchesOwnScope(access, list)) continue;
      leads.push({ ...(lead as PhoneLead), owner_name: list.owner_name });
    }
  }
  return nachNoShowDatum(leads, noShows);
}

export type LinkedInNoShowContact = ListContact & { owner_name: string | null };

/**
 * LinkedIn: Kontakte, deren jüngstes Setting auf No-Show steht.
 *
 * Anders als beim Telefon ohne Zusatzbedingung am Kontakt: Das LinkedIn-Board
 * verschiebt keine Kontakte zwischen Listen, es gibt also keine zweite Liste,
 * in der er parallel stehen könnte. Er verlässt die No-Show-Liste über das
 * Setting — neuer Termin oder tot.
 *
 * Obergrenze sind die sichtbaren, nicht archivierten Listen — dieselbe Regel
 * wie bei den Smart Views (`/ansicht/[viewId]`).
 */
export async function loadLinkedInNoShowContacts(access: AccessContext): Promise<LinkedInNoShowContact[]> {
  const supabase = await createClient();
  let listsQuery = supabase
    .from("lists")
    .select("id, owner_name")
    .eq("workspace_id", access.workspace_id)
    .is("archived_at", null);
  const scope = ownScopeFilter(access);
  if (scope) listsQuery = listsQuery.or(scope);
  const { data: listRows } = await listsQuery;
  // Liste → Inhaber. Zugleich die Obergrenze: Was hier fehlt, ist nicht sichtbar.
  const allowed = new Map((listRows ?? []).map((l) => [l.id as string, (l.owner_name as string | null) ?? null]));
  if (allowed.size === 0) return [];

  const noShows = await loadNoShowSettings(supabase, access.workspace_id, "source_contact_id");
  if (noShows.size === 0) return [];

  const contacts: LinkedInNoShowContact[] = [];
  for (const ids of chunks([...noShows.keys()])) {
    const { data, error } = await supabase.from("contacts").select(LIST_CONTACT_COLUMNS).in("id", ids);
    if (error) throw new Error(error.message);
    for (const c of (data ?? []) as unknown as ListContact[]) {
      if (c.list_id && allowed.has(c.list_id)) contacts.push({ ...c, owner_name: allowed.get(c.list_id) ?? null });
    }
  }
  return nachNoShowDatum(contacts, noShows);
}
