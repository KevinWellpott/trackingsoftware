"use server";

import { getAccessContext, ownScopeFilter } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

// Globale Suche ueber alle Kanaele.
//
// Anlass: Wer eine Antwort auf LinkedIn bekommt, musste den Namen bisher in
// drei bis vier Listen einzeln suchen — es gab keinen Ort, der ueber Listen
// hinweg sucht. Diese Action durchsucht beide Akquise-Kanaele und den
// Termin-Funnel in einem Rutsch.
//
// Scope: `lists`/`phone_lists` tragen den Owner, `contacts`/`phone_leads`
// nicht. Der Personenfilter laeuft deshalb ueber die Listen-Ebene (owner_name
// hat Vorrang vor created_by_user_id — siehe docs/data-model.md §2), Termine
// ueber `created_by_user_id`. Bei workspace-weitem Zugriff liefert
// `ownScopeFilter` null und es wird nicht eingeschraenkt.

export type SearchKind = "contact" | "phone_lead" | "setting" | "closing";

export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string;
  /** Zweite Zeile: Firma, Telefonnummer o. Ae. */
  subtitle: string | null;
  /** Woher der Treffer stammt — bei Kontakten der Listenname. */
  context: string | null;
  href: string;
};

export type SearchResult = {
  hits: SearchHit[];
  /** true, wenn mindestens eine Quelle ihr Limit ausgeschoepft hat. */
  truncated: boolean;
};

const PER_SOURCE = 25;
const MIN_LEN = 2;

/**
 * Suchbegriff zu einem sicheren `ilike`-Wert fuer einen PostgREST-`or()`.
 *
 * Zwei Ebenen muessen entschaerft werden:
 * 1. `%`, `_` und `\` sind LIKE-Wildcards — sonst sucht „50%" nach allem.
 * 2. Komma und Klammer trennen den or()-Ausdruck. Ein Begriff wie
 *    „Mueller, GmbH" wuerde den Filter sonst in zwei zerreissen. Der Wert
 *    wandert deshalb in Anfuehrungszeichen; darin sind Trennzeichen literal.
 *
 * Reihenfolge ist wichtig: erst LIKE, dann Transport. Die vom ersten Schritt
 * eingefuegten Backslashes werden dabei bewusst noch einmal verdoppelt —
 * PostgREST entfernt genau eine Ebene wieder.
 */
function likeValue(q: string): string {
  const forLike = q.replace(/[\\%_]/g, (m) => `\\${m}`);
  const forTransport = forLike.replace(/["\\]/g, (m) => `\\${m}`);
  return `"%${forTransport}%"`;
}

export async function globalSearch(query: string): Promise<SearchResult> {
  const q = query.trim();
  if (q.length < MIN_LEN) return { hits: [], truncated: false };

  const access = await getAccessContext();
  if (!access) return { hits: [], truncated: false };

  const supabase = await createClient();
  const ws = access.workspace_id;
  const scope = ownScopeFilter(access);
  const like = likeValue(q);

  // Listen zuerst: sie liefern sowohl den Personenfilter als auch die
  // Namen, die spaeter als Kontext an den Treffern haengen.
  let listsQuery = supabase.from("lists").select("id, name").eq("workspace_id", ws);
  let phoneListsQuery = supabase.from("phone_lists").select("id, name").eq("workspace_id", ws);
  if (scope) {
    listsQuery = listsQuery.or(scope);
    phoneListsQuery = phoneListsQuery.or(scope);
  }

  const [{ data: listRows }, { data: phoneListRows }] = await Promise.all([listsQuery, phoneListsQuery]);
  const listNames = new Map((listRows ?? []).map((l) => [l.id as string, l.name as string]));
  const phoneListNames = new Map((phoneListRows ?? []).map((l) => [l.id as string, l.name as string]));

  const listIds = [...listNames.keys()];
  const phoneListIds = [...phoneListNames.keys()];

  // Ohne Listen im Scope kann es dort auch keine Treffer geben — die Abfrage
  // waere `in.()` und damit ein Syntaxfehler.
  const contactsPromise = listIds.length
    ? supabase
        .from("contacts")
        .select("id, name, company, list_id")
        .eq("workspace_id", ws)
        .in("list_id", listIds)
        .or(`name.ilike.${like},company.ilike.${like}`)
        .order("pitched_at", { ascending: false, nullsFirst: false })
        .limit(PER_SOURCE)
    : Promise.resolve({ data: [] });

  const leadsPromise = phoneListIds.length
    ? supabase
        .from("phone_leads")
        .select("id, company, decider_name, phone, list_id")
        .eq("workspace_id", ws)
        .in("list_id", phoneListIds)
        .or(`company.ilike.${like},decider_name.ilike.${like},phone.ilike.${like}`)
        .limit(PER_SOURCE)
    : Promise.resolve({ data: [] });

  let settingQuery = supabase
    .from("setting_calls")
    .select("id, lead_name, company, status")
    .eq("workspace_id", ws)
    .or(`lead_name.ilike.${like},company.ilike.${like}`)
    .order("appointment_at", { ascending: false, nullsFirst: false })
    .limit(PER_SOURCE);
  let closingQuery = supabase
    .from("closing_calls")
    .select("id, lead_name, company, status")
    .eq("workspace_id", ws)
    .or(`lead_name.ilike.${like},company.ilike.${like}`)
    .order("call_at", { ascending: false, nullsFirst: false })
    .limit(PER_SOURCE);

  // Termine tragen kein owner_name — dort ist created_by_user_id die Zuordnung.
  if (access.effective_user_id) {
    settingQuery = settingQuery.eq("created_by_user_id", access.effective_user_id);
    closingQuery = closingQuery.eq("created_by_user_id", access.effective_user_id);
  }

  const [contactsRes, leadsRes, settingRes, closingRes] = await Promise.all([
    contactsPromise,
    leadsPromise,
    settingQuery,
    closingQuery,
  ]);

  const contacts = (contactsRes.data ?? []) as { id: string; name: string; company: string | null; list_id: string }[];
  const leads = (leadsRes.data ?? []) as {
    id: string;
    company: string | null;
    decider_name: string | null;
    phone: string | null;
    list_id: string;
  }[];
  const settings = (settingRes.data ?? []) as { id: string; lead_name: string | null; company: string | null; status: string }[];
  const closings = (closingRes.data ?? []) as { id: string; lead_name: string | null; company: string | null; status: string }[];

  const hits: SearchHit[] = [
    ...contacts.map((c) => ({
      kind: "contact" as const,
      id: c.id,
      title: c.name,
      subtitle: c.company,
      context: listNames.get(c.list_id) ?? null,
      href: `/lists/${c.list_id}`,
    })),
    ...leads.map((l) => ({
      kind: "phone_lead" as const,
      id: l.id,
      title: l.company ?? l.decider_name ?? "Unbenannter Lead",
      subtitle: [l.decider_name, l.phone].filter(Boolean).join(" · ") || null,
      context: phoneListNames.get(l.list_id) ?? null,
      href: `/telefon/${l.list_id}`,
    })),
    ...settings.map((s) => ({
      kind: "setting" as const,
      id: s.id,
      title: s.lead_name ?? "Unbenannter Lead",
      subtitle: s.company,
      context: s.status,
      href: `/setting/${s.id}`,
    })),
    ...closings.map((c) => ({
      kind: "closing" as const,
      id: c.id,
      title: c.lead_name ?? "Unbenannter Lead",
      subtitle: c.company,
      context: c.status,
      href: `/closing/${c.id}`,
    })),
  ];

  const truncated =
    contacts.length === PER_SOURCE ||
    leads.length === PER_SOURCE ||
    settings.length === PER_SOURCE ||
    closings.length === PER_SOURCE;

  return { hits, truncated };
}
