// Laden der Termin-Zeilen für /setting, /closing und /no-shows.
//
// Dieselbe Abfrage wie der Kalender (app/(dashboard)/termine/page.tsx): eine
// Termin-Tabelle komplett, mit `select("*")`, bei aktiver Datensicht auf deren
// Person zugeschnitten. Die Seiten filtern danach nur noch im Client — eine
// zweite Definition, welche Zeilen jemand sehen darf, gibt es damit nicht.

import type { AccessContext } from "@/lib/access";
import { listDataViewUsers } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import type { WithCancellation } from "@/lib/termine";
import type { ClosingCall, SettingCall } from "@/lib/types";

/**
 * Datensicht-Filter — wortgleich `personScope()` in app/(dashboard)/termine/page.tsx:
 * zugewiesen ODER (nicht zugewiesen UND selbst angelegt) ODER durchgeführt.
 * Deckungsgleich mit den RLS-Policies aus Migration 0028/0042.
 */
function personScope(userId: string): string {
  return `assigned_user_id.eq.${userId},and(assigned_user_id.is.null,created_by_user_id.eq.${userId}),conducted_by_user_id.eq.${userId}`;
}

export type Mitglied = { user_id: string; username: string };

export async function ladeSettings(access: AccessContext): Promise<WithCancellation<SettingCall>[]> {
  const supabase = await createClient();
  return fetchAllRows<WithCancellation<SettingCall>>((from, to) => {
    let q = supabase.from("setting_calls").select("*").eq("workspace_id", access.workspace_id);
    if (access.effective_user_id) q = q.or(personScope(access.effective_user_id));
    return q
      .order("appointment_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
  });
}

export async function ladeClosings(access: AccessContext): Promise<WithCancellation<ClosingCall>[]> {
  const supabase = await createClient();
  return fetchAllRows<WithCancellation<ClosingCall>>((from, to) => {
    let q = supabase.from("closing_calls").select("*").eq("workspace_id", access.workspace_id);
    if (access.effective_user_id) q = q.or(personScope(access.effective_user_id));
    return q
      .order("call_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
  });
}

/** Namensquelle für Zuweisung, „Durchgeführt von" und den Nachfass-Stempler. */
export async function ladeMitglieder(access: AccessContext): Promise<Mitglied[]> {
  const users = await listDataViewUsers(access.workspace_id).catch(() => []);
  return users.map((m) => ({ user_id: m.user_id, username: m.username }));
}
