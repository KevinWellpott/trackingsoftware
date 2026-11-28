// Plattform-Übersicht „Organisationen im Blick“ — die Datenbeschaffung.
//
// Nur für Plattform-Admins. Gelesen wird mit dem Client der angemeldeten
// Person: Die Policies `<tabelle>_platform_admin` (Migration 0025/0028) geben
// einem Plattform-Admin jede Organisation frei — kein Service-Schlüssel nötig.
//
// Geladen werden nur die Spalten, die einen Tag bestimmen, ab dem frühesten
// Tag der drei Zeiträume (eine Woche kann im Vormonat beginnen). Gezählt wird
// in JS nach Berliner Kalendertag — PostgREST kann nicht in Berlin-Zeit
// schneiden (docs §6), deshalb ein Tag Puffer in der Abfrage.

import { getAccessContext } from "@/lib/access";
import { absageWirktNoch } from "@/lib/terminMeta";
import { berlinDateISO } from "@/lib/apptTime";
import { closingEffDate, settingEffDate } from "@/lib/analyse";
import { addDaysISO } from "@/lib/dates";
import { berlinWindowIso } from "@/components/dashboard/periodWindow";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import {
  KEINE_RICHTWERTE,
  fruehesterTag,
  leererZaehler,
  zaehle,
  type Richtwerte,
  type Zaehler,
} from "@/lib/orgUebersicht";

export type OrgZeile = {
  id: string;
  name: string;
  /** Die eigene Organisation der Plattform-Admins (Titan). */
  eigene: boolean;
  zaehler: Zaehler;
  richtwerte: Richtwerte;
};

export type OrgUebersichtDaten = {
  orgs: OrgZeile[];
  today: string;
  /** Uhrzeit des Stands, Berlin („14:05“). */
  stand: string;
  /** false = Migration 0051 fehlt; die Übersicht zeigt dann nur das Ist. */
  richtwerteVerfuegbar: boolean;
  /** Kennzahlen, deren Abfrage gescheitert ist — sie stehen als „—“ da, nie als 0. */
  luecken: string[];
};

type RichtwertRow = { workspace_id: string } & Partial<Record<keyof Richtwerte, number | null>>;

export async function ladeOrgUebersicht(): Promise<OrgUebersichtDaten | null> {
  const access = await getAccessContext();
  if (!access?.is_platform_admin) return null;
  const supabase = await createClient();

  const nowMs = Date.now();
  const today = berlinDateISO(new Date(nowMs).toISOString());
  const von = fruehesterTag(today);
  // Ein Tag Puffer nach vorn: Ein Berliner Tag beginnt am Vorabend in UTC.
  const { startIso } = berlinWindowIso(addDaysISO(von, -1), today);
  const luecken: string[] = [];
  const merke = <T,>(name: string, fallback: T) => (err: unknown) => {
    console.error(`[org-uebersicht] ${name}:`, err instanceof Error ? err.message : err);
    luecken.push(name);
    return fallback;
  };

  const [anwahlen, pitches, settings, closings, richtwerteRes] = await Promise.all([
    fetchAllRows<{ workspace_id: string; called_at: string }>((f, t) =>
      supabase
        .from("phone_call_attempts")
        .select("workspace_id, called_at")
        .gte("called_at", startIso)
        .order("id")
        .range(f, t),
    ).catch(merke("anwahlen", [])),
    fetchAllRows<{ workspace_id: string; pitched_at: string | null; created_at: string }>((f, t) =>
      supabase
        .from("contacts")
        .select("workspace_id, pitched_at, created_at")
        .or(`pitched_at.gte.${von},and(pitched_at.is.null,created_at.gte.${startIso})`)
        .order("id")
        .range(f, t),
    ).catch(merke("pitches", [])),
    fetchAllRows<{
      workspace_id: string;
      created_at: string;
      appointment_at: string | null;
      call_at: string | null;
      cancelled_at: string | null;
      revived_at: string | null;
    }>((f, t) =>
      supabase
        .from("setting_calls")
        .select("workspace_id, created_at, appointment_at, call_at, cancelled_at, revived_at")
        .or(`created_at.gte.${startIso},appointment_at.gte.${startIso},call_at.gte.${von}`)
        .order("id")
        .range(f, t),
    ).catch(merke("settings", [])),
    fetchAllRows<{
      workspace_id: string;
      created_at: string;
      call_at: string | null;
      cancelled_at: string | null;
      revived_at: string | null;
    }>((f, t) =>
      supabase
        .from("closing_calls")
        .select("workspace_id, created_at, call_at, cancelled_at, revived_at")
        .or(`call_at.gte.${startIso},and(call_at.is.null,created_at.gte.${startIso})`)
        .order("id")
        .range(f, t),
    ).catch(merke("closings", [])),
    supabase.from("org_richtwerte").select("workspace_id, anwahlen, pitches, settings, closings, termine"),
  ]);

  const zaehlerJe = new Map<string, Zaehler>();
  const z = (ws: string) => {
    let v = zaehlerJe.get(ws);
    if (!v) {
      v = leererZaehler();
      zaehlerJe.set(ws, v);
    }
    return v;
  };

  for (const a of anwahlen) zaehle(z(a.workspace_id), "anwahlen", berlinDateISO(a.called_at), today);
  for (const c of pitches) zaehle(z(c.workspace_id), "pitches", c.pitched_at ?? berlinDateISO(c.created_at), today);
  for (const s of settings) {
    // „Termine gelegt“: Tag der Buchung (docs §5, „gelegt“).
    zaehle(z(s.workspace_id), "termine", berlinDateISO(s.created_at), today);
    // „Settings“: Termin im Zeitraum, schon begonnen, keine wirkende Absage.
    if (absageWirktNoch(s)) continue;
    if (s.appointment_at && Date.parse(s.appointment_at) > nowMs) continue;
    zaehle(z(s.workspace_id), "settings", settingEffDate(s), today);
  }
  for (const c of closings) {
    if (absageWirktNoch(c)) continue;
    if (c.call_at && Date.parse(c.call_at) > nowMs) continue;
    zaehle(z(c.workspace_id), "closings", closingEffDate(c), today);
  }

  // Richtwerte: ein Fehler heißt fast immer „Migration 0051 fehlt“ — dann nur das Ist.
  const richtwerteVerfuegbar = !richtwerteRes.error;
  if (richtwerteRes.error) console.error("[org-uebersicht] Richtwerte:", richtwerteRes.error.message);
  const richtwerteJe = new Map<string, Richtwerte>();
  for (const r of ((richtwerteRes.data ?? []) as RichtwertRow[])) {
    richtwerteJe.set(r.workspace_id, {
      anwahlen: r.anwahlen ?? null,
      pitches: r.pitches ?? null,
      termine: r.termine ?? null,
      settings: r.settings ?? null,
      closings: r.closings ?? null,
    });
  }

  const orgs: OrgZeile[] = access.available_workspaces.map((w) => ({
    id: w.id,
    name: w.name,
    eigene: w.id === access.home_workspace_id,
    zaehler: zaehlerJe.get(w.id) ?? leererZaehler(),
    richtwerte: richtwerteJe.get(w.id) ?? { ...KEINE_RICHTWERTE },
  }));

  const stand = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }).format(
    new Date(nowMs),
  );
  return { orgs, today, stand, richtwerteVerfuegbar, luecken };
}
