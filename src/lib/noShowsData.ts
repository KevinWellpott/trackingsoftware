// /no-shows — wer ist nicht erschienen und braucht einen neuen Termin?
// (Redesign Phase 4). Getrennt nach Erstgespräch und Closing.
//
// ── ERSTGESPRÄCH: DIESELBE REGEL WIE DIE KANAL-LISTEN ─────────────────────
// Die Menge ist die Vereinigung der beiden abgeleiteten Listen
// /telefon/setting-no-show und /listen/setting-no-show (src/lib/settingNoShow.ts):
// je Lead das JÜNGSTE Setting, auf No-Show, nicht `ohne_antwort`, und strikt
// persönlich (`gehoertMir`: Termin selbst gelegt UND Lead in der eigenen
// Liste). Die Loader dafür werden NICHT nachgebaut, sondern aufgerufen — eine
// zweite Fassung der Regel liefe beim nächsten Umbau auseinander.
//
// Dazu kommen direkt gebuchte Erstgespräche (Ads, Social Media, Sonstige,
// Altbestand „manuell"): Sie haben keinen Lead und keine Liste, die beiden
// Kanal-Listen kennen sie deshalb nicht. Für sie gilt die erste Hälfte von
// `gehoertMir` — selbst gelegt (`personOf`) —, die zweite (Liste) entfällt
// mangels Liste. Ein Erstgespräch mit Nachfolger aus der Ablage ist Historie
// und fällt heraus.
//
// ── CLOSING: ÜBER DEN ABGELEITETEN ZUSTAND ────────────────────────────────
// `closing_calls` kennt keinen Status „no_show"; ein nicht erschienener
// Closing-Termin steht auf `status='offen'` + `show_status='no_show'`.
// Maßgeblich ist deshalb `terminZustand() === "no_show"` — die Seite filtert
// die Zeilen aus `ladeClosings` im Client über `buildEvents`.

import type { AccessContext } from "@/lib/access";
import { personOf } from "@/lib/personResolution";
import { loadLinkedInNoShowContacts, loadPhoneNoShowLeads } from "@/lib/settingNoShowData";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import type { WithCancellation } from "@/lib/termine";
import type { SettingCall } from "@/lib/types";

/** PostgREST trägt `.in()` in der URL — 100 UUIDs sind sicher. */
const IN_CHUNK = 100;

function chunks<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type SettingNoShows = {
  /** Die Setting-Zeilen (select *) — für `buildEvents` und die Handgriffe. */
  settings: WithCancellation<SettingCall>[];
  /** Herkunft je Setting-ID, für die Beschriftung. */
  herkunft: Record<string, "telefon" | "linkedin" | "direkt">;
};

export async function ladeSettingNoShows(access: AccessContext): Promise<SettingNoShows> {
  const supabase = await createClient();
  const ich = access.effective_user_id ?? access.user.id;

  const [phone, linkedin, direkt] = await Promise.all([
    loadPhoneNoShowLeads(access),
    loadLinkedInNoShowContacts(access),
    // Direkt gebucht: kein Quell-Lead. Nur No-Shows, die die Person selbst
    // gelegt hat — gefiltert wird unten über `personOf`, damit es dieselbe
    // Funktion ist wie in `gehoertMir`.
    fetchAllRows<WithCancellation<SettingCall> & { revived_from_setting_call_id?: string | null }>((from, to) =>
      supabase
        .from("setting_calls")
        .select("*")
        .eq("workspace_id", access.workspace_id)
        .is("source_contact_id", null)
        .is("source_phone_lead_id", null)
        .eq("status", "no_show")
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const herkunft: SettingNoShows["herkunft"] = {};
  for (const l of phone) herkunft[l.no_show_setting_id] = "telefon";
  for (const c of linkedin) herkunft[c.no_show_setting_id] = "linkedin";

  const direktKandidaten = direkt.filter(
    (r) => r.no_show_resolution !== "ohne_antwort" && personOf(r) === ich,
  );
  // Nachfolger aus der Ablage: Die alte Zeile ist Historie (lib/dranRegel.ts).
  const mitNachfolger = new Set<string>();
  for (const ids of chunks(direktKandidaten.map((r) => r.id))) {
    const { data } = await supabase
      .from("setting_calls")
      .select("revived_from_setting_call_id")
      .eq("workspace_id", access.workspace_id)
      .in("revived_from_setting_call_id", ids);
    for (const r of data ?? []) mitNachfolger.add(r.revived_from_setting_call_id as string);
  }
  const direktRows = direktKandidaten.filter((r) => !mitNachfolger.has(r.id));
  for (const r of direktRows) herkunft[r.id] = "direkt";

  // Die Setting-Zeilen der beiden Kanal-Listen vollständig nachladen — die
  // Loader liefern Leads bzw. Kontakte, die Handgriffe brauchen das Setting.
  const kanalIds = [...phone.map((l) => l.no_show_setting_id), ...linkedin.map((c) => c.no_show_setting_id)];
  const kanalRows: WithCancellation<SettingCall>[] = [];
  for (const ids of chunks(kanalIds)) {
    const { data, error } = await supabase
      .from("setting_calls")
      .select("*")
      .eq("workspace_id", access.workspace_id)
      .in("id", ids);
    if (error) throw new Error(error.message);
    kanalRows.push(...((data ?? []) as WithCancellation<SettingCall>[]));
  }

  return { settings: [...kanalRows, ...direktRows], herkunft };
}
