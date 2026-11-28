// Nachfass-Eingang — die Datenbeschaffung (Plan M3). EIN Loader für Seite UND
// Badge: Ein Badge, das anders zählt als die Seite darunter, ist laut
// docs/data-model.md §5.4 ein Fehler, keine Optik. Memoisiert per React
// `cache()`, damit Layout (Badge) und Seite in derselben Anfrage nur einmal
// laden.

import { cache } from "react";
import { getAccessContext, listDataViewUsers, type AccessContext } from "@/lib/access";
import { berlinDateISO } from "@/lib/apptTime";
import { berlinWindowIso } from "@/components/dashboard/periodWindow";
import { terminZustand, istInArbeitsmenge, type TerminZustand } from "@/lib/dranRegel";
import { absageWirktNoch } from "@/lib/terminMeta";
import { erinnererOf, ownerUserIdOfList } from "@/lib/personResolution";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { DURATION_MIN } from "@/lib/termine";
import { heuteVorbeiOhneErgebnis, istAltfall } from "@/lib/nachfassRegel";
import type { NachfassArt, NachfassEintrag, NachfassKontaktKurz } from "@/lib/nachfassRegel";

type Client = Awaited<ReturnType<typeof createClient>>;

/** `mein` = wer den Vorgang erinnert/nervt (`erinnererOf`) bzw. Listen-Owner; `alle` nur mit Team-Sicht. */
export type NachfassWer = "mein" | "alle";

export type NachfassAnzeige = NachfassEintrag & {
  /** Zustand bei Terminen (`terminZustand`), sonst null. */
  zustand: TerminZustand | null;
  /** Termin-Zeitpunkt (ISO) bei Terminen, Rückruf-Zeitpunkt bei Rückrufen. */
  terminAt: string | null;
  /** Wer zuständig ist (user_id). */
  personId: string | null;
  personName: string | null;
  /** Letzter Protokolleintrag, für „zuletzt vor 4 Tagen (Kevin, nicht erreicht)". */
  letzterKontakt: { at: string; vonName: string | null; ergebnis: NachfassKontaktKurz["ergebnis"] } | null;
  /** Kontaktwege. */
  telefon: string | null;
  email: string | null;
  linkedinUrl: string | null;
  /** Sprungziel (Detailseite oder Liste). */
  href: string | null;
  /** Kontext-Chip: „Erstgespräch · No-Show", „Rückruf", „Recycling · Verloren: Preis". */
  kontext: string;
  /** Recycling: Versuche und Deckel-Grund. */
  recycle: { origin: "linkedin" | "telefon" | "setting" | "closing"; reason: string | null; attempt: number } | null;
  /** Closing im Status „nachfassen". */
  closingNachfassen: boolean;
  /**
   * Wer was gemacht hat — für die Organisations-Ansicht (28.11.):
   * „terminiert" (Erstgespräch: Zuweisung bzw. Ersteller; Closing: wer es
   * angelegt hat), „geführt" (Durchgeführt von), bei Rückrufen „Liste".
   */
  rollen: { label: string; name: string }[];
};

export type NachfassenDaten = {
  eintraege: NachfassAnzeige[];
  /** Eigene Protokolleinträge von heute — „Heute erledigt". */
  heuteErledigt: number;
  /** false = Migration 0049 fehlt; das Protokoll fehlt dann, der Eingang läuft trotzdem. */
  protokollVerfuegbar: boolean;
  /**
   * false = mindestens eine der Grundabfragen (Termine, Rückrufe, Listen,
   * Mitglieder) ist gescheitert. Die Seite sagt das, das Badge schweigt —
   * eine Lücke darf nie wie „nichts fällig" aussehen.
   */
  vollstaendig: boolean;
  recyclingVerfuegbar: boolean;
  today: string;
  nowMs: number;
  wer: NachfassWer;
  darfAlle: boolean;
};

const SETTING_COLS =
  "id, lead_name, company, status, show_status, appointment_at, cancelled_at, cancel_outlook, " +
  "no_show_resolution, revived_at, follow_up_due, follow_up_last_contacted_at, created_at, " +
  "assigned_user_id, created_by_user_id, conducted_by_user_id, phone, source_contact_id, source_phone_lead_id";

const CLOSING_COLS =
  "id, lead_name, company, status, show_status, call_at, cancelled_at, cancel_outlook, " +
  "no_show_resolution, revived_at, follow_up_due, follow_up_last_contacted_at, created_at, " +
  "assigned_user_id, created_by_user_id, conducted_by_user_id, setting_call_id";

type TerminRow = {
  id: string;
  lead_name: string | null;
  company: string | null;
  status: string;
  show_status: "show" | "no_show" | null;
  appointment_at?: string | null;
  call_at?: string | null;
  cancelled_at: string | null;
  cancel_outlook: string | null;
  no_show_resolution: string | null;
  revived_at: string | null;
  follow_up_due: string | null;
  follow_up_last_contacted_at: string | null;
  created_at: string;
  assigned_user_id: string | null;
  created_by_user_id: string | null;
  conducted_by_user_id: string | null;
  phone?: string | null;
  source_contact_id?: string | null;
  source_phone_lead_id?: string | null;
  setting_call_id?: string | null;
};

const ZUSTAND_KONTEXT: Partial<Record<TerminZustand, string>> = {
  offen: "kein Termin",
  no_show: "No-Show",
  show: "erschienen, kein Ergebnis",
};

const RECYCLE_KONTEXT: Record<string, string> = {
  linkedin: "LinkedIn · nach 3 Follow-ups",
  telefon: "Telefon · tot",
  setting: "Erstgespräch",
  closing: "Closing · verloren",
};

function maxTag(...werte: (string | null | undefined)[]): string | null {
  const tage = werte.filter((v): v is string => Boolean(v)).map((v) => (v.length > 10 ? berlinDateISO(v) : v));
  if (tage.length === 0) return null;
  return tage.reduce((a, b) => (a > b ? a : b));
}

async function ladeNachfolger(supabase: Client, ws: string): Promise<{ settings: Set<string>; closings: Set<string> }> {
  const rows = await fetchAllRows<{ revived_from_setting_call_id: string | null; revived_from_closing_call_id: string | null }>(
    (f, t) =>
      supabase
        .from("setting_calls")
        .select("revived_from_setting_call_id, revived_from_closing_call_id")
        .eq("workspace_id", ws)
        .or("revived_from_setting_call_id.not.is.null,revived_from_closing_call_id.not.is.null")
        .order("id")
        .range(f, t),
  );
  return {
    settings: new Set(rows.map((r) => r.revived_from_setting_call_id).filter((v): v is string => Boolean(v))),
    closings: new Set(rows.map((r) => r.revived_from_closing_call_id).filter((v): v is string => Boolean(v))),
  };
}

type RecycleRow = {
  origin: "linkedin" | "telefon" | "setting" | "closing";
  entity_id: string;
  lead_name: string | null;
  company: string | null;
  due_at: string | null;
  reason: string | null;
  attempt_count: number | null;
  last_contacted_at: string | null;
};

type KontaktRow = {
  setting_call_id: string | null;
  closing_call_id: string | null;
  contact_id: string | null;
  phone_lead_id: string | null;
  ergebnis: NachfassKontaktKurz["ergebnis"];
  created_at: string;
  created_by_user_id: string | null;
};

/** Protokoll für die geladenen IDs — in Paketen, weil `.in()` an der URL-Länge hängt. */
async function ladeProtokoll(
  supabase: Client,
  ids: Record<"setting_call_id" | "closing_call_id" | "contact_id" | "phone_lead_id", string[]>,
): Promise<{ rows: KontaktRow[]; available: boolean }> {
  const out: KontaktRow[] = [];
  try {
    const jobs: Promise<KontaktRow[]>[] = [];
    for (const [spalte, liste] of Object.entries(ids)) {
      for (let i = 0; i < liste.length; i += 150) {
        const teil = liste.slice(i, i + 150);
        // Paginiert: 150 Vorgänge können zusammen mehr als 1000 Einträge haben.
        jobs.push(
          fetchAllRows<KontaktRow>((f, t) =>
            supabase
              .from("nachfass_kontakte")
              .select("setting_call_id, closing_call_id, contact_id, phone_lead_id, ergebnis, created_at, created_by_user_id")
              .in(spalte, teil)
              .order("created_at", { ascending: false })
              .order("id")
              .range(f, t),
          ),
        );
      }
    }
    for (const rows of await Promise.all(jobs)) out.push(...rows);
    // Neueste zuerst über alle Teilabfragen hinweg.
    out.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    return { rows: out, available: true };
  } catch (err) {
    console.error("[nachfassen] Protokoll:", err instanceof Error ? err.message : err);
    return { rows: [], available: false };
  }
}

async function ladeHeuteErledigt(supabase: Client, userId: string, today: string): Promise<number> {
  const { startIso, endIso } = berlinWindowIso(today, today);
  const { count, error } = await supabase
    .from("nachfass_kontakte")
    .select("id", { count: "exact", head: true })
    .eq("created_by_user_id", userId)
    .gte("created_at", startIso)
    .lt("created_at", endIso);
  return error ? 0 : count ?? 0;
}

/**
 * `schlank` (Badge und Dashboard, Punkt 5): dieselben Termine und Rückrufe,
 * dieselbe Gruppierung — aber ohne Wiedervorlage (die zählt nicht mit),
 * ohne Kontaktwege und mit dem Protokoll nur dort, wo es die Gruppe
 * entscheidet (Altfall ja/nein). Auf jeder Seite lief vorher der volle
 * Eingang samt aller Recycling-Leads.
 */
async function ladeIntern(access: AccessContext, wer: NachfassWer, schlank = false): Promise<NachfassenDaten> {
  const supabase = await createClient();
  const ws = access.workspace_id;
  const nowMs = Date.now();
  let vollstaendig = true;
  const luecke = <T,>(fallback: T) => () => {
    vollstaendig = false;
    return fallback;
  };
  const today = berlinDateISO(new Date(nowMs).toISOString());
  const scopeUser = access.effective_user_id ?? access.user.id;
  const darfAlle = access.can_switch_view && !access.effective_user_id;
  const alle = wer === "alle" && darfAlle;

  // Vorfilter auf die Person (Obermenge von `erinnererOf`: Zuweisung,
  // Ersteller oder Durchführung). Die genaue Regel prüft die Schleife unten;
  // hier fällt nur weg, was ihr sicher nicht gehört — statt alle offenen
  // Termine der ganzen Organisation zu laden.
  const personFilter = `assigned_user_id.eq.${scopeUser},created_by_user_id.eq.${scopeUser},conducted_by_user_id.eq.${scopeUser}`;
  const [settings, closings, nachfolger, members, rueckrufLeads, phoneLists, recycle] = await Promise.all([
    fetchAllRows((f, t) => {
      let q = supabase
        .from("setting_calls")
        .select(SETTING_COLS)
        .eq("workspace_id", ws)
        .in("status", ["offen", "no_show"]);
      if (!alle) q = q.or(personFilter);
      return q.order("id").range(f, t);
    })
      .then((rows) => rows as unknown as TerminRow[])
      .catch(luecke([] as TerminRow[])),
    fetchAllRows((f, t) => {
      let q = supabase
        .from("closing_calls")
        .select(CLOSING_COLS)
        .eq("workspace_id", ws)
        .in("status", ["offen", "nachfassen"]);
      if (!alle) q = q.or(personFilter);
      return q.order("id").range(f, t);
    })
      .then((rows) => rows as unknown as TerminRow[])
      .catch(luecke([] as TerminRow[])),
    // Ohne Nachfolger-Liste stünde ein aus der Ablage neu angesetzter Lead
    // doppelt da — eine Lücke, kein „keine Nachfolger".
    ladeNachfolger(supabase, ws).catch(luecke({ settings: new Set<string>(), closings: new Set<string>() })),
    listDataViewUsers(ws).catch(luecke([] as Awaited<ReturnType<typeof listDataViewUsers>>)),
    fetchAllRows<{ id: string; company: string | null; decider_name: string | null; phone: string | null; email: string | null; callback_at: string; list_id: string | null }>(
      (f, t) =>
        supabase
          .from("phone_leads")
          .select("id, company, decider_name, phone, email, callback_at, list_id")
          .eq("workspace_id", ws)
          .eq("status", "rueckruf")
          .not("callback_at", "is", null)
          .order("id")
          .range(f, t),
    ).catch(luecke([])),
    fetchAllRows<{ id: string; name: string | null; owner_name: string | null; created_by_user_id: string | null }>((f, t) =>
      supabase.from("phone_lists").select("id, name, owner_name, created_by_user_id").eq("workspace_id", ws).order("id").range(f, t),
    ).catch(luecke([])),
    schlank
      ? Promise.resolve({ rows: [] as RecycleRow[], available: true })
      : fetchAllRows<RecycleRow>((f, t) =>
      supabase
        .rpc("recycle_tasks", { p_workspace_id: ws, p_today: today, p_effective_user_id: alle ? null : scopeUser })
        // Seitenweise nur mit fester Reihenfolge — sonst überlappen Seiten.
        .order("origin")
        .order("entity_id")
        .range(f, t),
    )
      .then((rows) => ({ rows, available: true }))
      .catch(() => ({ rows: [] as RecycleRow[], available: false })),
  ]);

  const nameById = new Map(members.map((m) => [m.user_id, m.username]));
  const idByName = new Map(members.map((m) => [m.username, m.user_id]));
  const eintraege: NachfassAnzeige[] = [];
  /** Woher ein Termin kommt — für die Kontaktwege (Punkt 3). */
  const quellen = new Map<string, { settingId: string | null; contactId: string | null; phoneLeadId: string | null }>();

  // ── Termine ─────────────────────────────────────────────────
  const terminRows: { art: NachfassArt; r: TerminRow }[] = [
    ...settings.map((r) => ({ art: "setting" as const, r })),
    ...closings.map((r) => ({ art: "closing" as const, r })),
  ];
  for (const { art, r } of terminRows) {
    const at = (art === "setting" ? r.appointment_at : r.call_at) ?? null;
    const hatNachfolger = art === "setting" ? nachfolger.settings.has(r.id) : nachfolger.closings.has(r.id);
    const zustand = terminZustand(
      {
        kind: art === "setting" ? "setting" : "closing",
        status: r.status,
        showStatus: r.show_status,
        at,
        cancelledAt: r.cancelled_at,
        cancelOutlook: r.cancel_outlook,
        noShowResolution: r.no_show_resolution,
        revivedAt: r.revived_at,
        hatNachfolger,
      },
      today,
      nowMs,
    );
    const closingNachfassen = art === "closing" && r.status === "nachfassen";
    const absage = absageWirktNoch(r, hatNachfolger);
    // Heute schon vorbei, noch kein Ergebnis (Punkt 6): Der Zustand sagt dann
    // noch „Termin steht“ (Tagesregel), die Handlung ist aber schon „Ergebnis
    // eintragen“.
    const heuteVorbei = heuteVorbeiOhneErgebnis({
      at,
      dauerMin: DURATION_MIN[art === "setting" ? "setting" : "closing"],
      status: r.status,
      showStatus: r.show_status,
      abgesagt: absage,
      today,
      nowMs,
    });
    if (!istInArbeitsmenge(zustand) && !closingNachfassen && !heuteVorbei) continue;

    const person = erinnererOf(r, zustand);
    if (!alle && person !== scopeUser) continue;

    quellen.set(`${art}:${r.id}`, {
      settingId: art === "setting" ? r.id : r.setting_call_id ?? null,
      contactId: r.source_contact_id ?? null,
      phoneLeadId: r.source_phone_lead_id ?? null,
    });
    const ergebnisFehlt =
      heuteVorbei ||
      (zustand === "offen" && !absage && Boolean(at) && berlinDateISO(at!) < today && !r.show_status && r.status === "offen");
    const nameVon = (id: string | null | undefined) => (id ? nameById.get(id) ?? null : null);
    const terminiert = art === "setting" ? nameVon(r.assigned_user_id ?? r.created_by_user_id) : nameVon(r.created_by_user_id);
    const gefuehrt = nameVon(r.conducted_by_user_id);
    const rollen = [
      ...(terminiert ? [{ label: "terminiert", name: terminiert }] : []),
      ...(gefuehrt ? [{ label: "geführt", name: gefuehrt }] : []),
    ];

    eintraege.push({
      key: `${art}:${r.id}`,
      quelle: "termin",
      art,
      id: r.id,
      name: r.lead_name?.trim() || r.company?.trim() || "Ohne Namen",
      firma: r.lead_name?.trim() ? r.company : null,
      faelligAm: r.follow_up_due,
      koernung: "tag",
      ergebnisFehlt,
      lebenszeichen: maxTag(at, r.follow_up_last_contacted_at, r.created_at),
      kontakte: [],
      zustand,
      terminAt: at,
      personId: person,
      personName: person ? nameById.get(person) ?? null : null,
      letzterKontakt: null,
      telefon: r.phone ?? null,
      email: null,
      linkedinUrl: null,
      href: art === "setting" ? `/setting/${r.id}?from=nachfassen` : `/closing/${r.id}?from=nachfassen`,
      // Bei fehlendem Ergebnis nur die Art: „kein Termin" las sich dort wie
      // „nie terminiert", gemeint war „Termin vorbei" (28.11.).
      kontext: ergebnisFehlt
        ? art === "setting"
          ? "Erstgespräch"
          : "Closing"
        : `${art === "setting" ? "Erstgespräch" : "Closing"} · ${
            closingNachfassen ? "Nachfassen" : absage ? "abgesagt" : ZUSTAND_KONTEXT[zustand] ?? zustand
          }`,
      recycle: null,
      closingNachfassen,
      rollen,
    });
  }

  // ── Rückrufe ────────────────────────────────────────────────
  const listById = new Map(phoneLists.map((l) => [l.id, l]));
  for (const l of rueckrufLeads) {
    const list = l.list_id ? listById.get(l.list_id) : undefined;
    // Ohne Liste lässt sich der Owner nicht bestimmen — im Team-Blick steht
    // der Rückruf trotzdem da, in „Mein" kann er niemandem zugeordnet werden.
    if (!list && !alle) continue;
    const owner = list ? ownerUserIdOfList(list, idByName) : null;
    if (!alle && owner !== scopeUser) continue;
    eintraege.push({
      key: `phone_lead:${l.id}`,
      quelle: "rueckruf",
      art: "phone_lead",
      id: l.id,
      name: l.company?.trim() || l.decider_name?.trim() || "Ohne Namen",
      firma: l.company?.trim() ? l.decider_name : null,
      faelligAm: l.callback_at,
      koernung: "minute",
      ergebnisFehlt: false,
      lebenszeichen: berlinDateISO(l.callback_at),
      kontakte: [],
      zustand: null,
      terminAt: l.callback_at,
      personId: owner,
      personName: owner ? nameById.get(owner) ?? list?.owner_name ?? null : list?.owner_name ?? null,
      letzterKontakt: null,
      telefon: l.phone,
      email: l.email,
      linkedinUrl: null,
      href: list ? `/telefon/${list.id}` : null,
      kontext: `Rückruf · ${list?.name ?? "ohne Liste"}`,
      recycle: null,
      closingNachfassen: false,
      rollen: (() => {
        const n = owner ? nameById.get(owner) ?? list?.owner_name ?? null : list?.owner_name ?? null;
        return n ? [{ label: "Liste", name: n }] : [];
      })(),
    });
  }

  // ── Recycling ───────────────────────────────────────────────
  const artOf: Record<string, NachfassArt> = {
    linkedin: "contact",
    telefon: "phone_lead",
    setting: "setting",
    closing: "closing",
  };
  for (const t of recycle.rows) {
    const art = artOf[t.origin];
    const key = `${art}:${t.entity_id}`;
    // Ein Vorgang, der schon als Termin oder Rückruf im Eingang steht, bekommt
    // keine zweite Zeile.
    if (eintraege.some((e) => e.key === key)) continue;
    eintraege.push({
      key,
      quelle: "recycling",
      art,
      id: t.entity_id,
      name: t.lead_name?.trim() || t.company?.trim() || "Ohne Namen",
      firma: t.lead_name?.trim() ? t.company : null,
      faelligAm: t.due_at ? t.due_at.slice(0, 10) : null,
      koernung: "tag",
      ergebnisFehlt: false,
      lebenszeichen: maxTag(t.due_at, t.last_contacted_at),
      kontakte: [],
      zustand: null,
      terminAt: null,
      personId: null,
      personName: null,
      letzterKontakt: null,
      telefon: null,
      email: null,
      linkedinUrl: null,
      href:
        t.origin === "setting"
          ? `/setting/${t.entity_id}?from=nachfassen`
          : t.origin === "closing"
            ? `/closing/${t.entity_id}?from=nachfassen`
            : null,
      kontext: `Wiedervorlage · ${RECYCLE_KONTEXT[t.origin] ?? t.origin}`,
      recycle: { origin: t.origin, reason: t.reason, attempt: t.attempt_count ?? 0 },
      closingNachfassen: false,
      rollen: [],
    });
  }

  // In Stücken statt der ersten 300 — sonst fehlten ab dem 301. Recycling-Lead
  // Telefonnummer, Mail und Link (Code-Review 27.11.).
  const stueckweise = async <R,>(ids: string[], hole: (teil: string[]) => PromiseLike<{ data: unknown }>): Promise<R[]> => {
    const eindeutig = [...new Set(ids)];
    const teile: string[][] = [];
    for (let i = 0; i < eindeutig.length; i += 200) teile.push(eindeutig.slice(i, i + 200));
    const res = await Promise.all(teile.map((teil) => hole(teil)));
    return res.flatMap((r) => ((r.data ?? []) as R[]));
  };

  if (!schlank) {
    // ── Kontaktwege der Termine (Punkt 3) ───────────────────────
    // Beim Nachfassen braucht man Nummer, Mail und LinkedIn des Leads — nicht
    // nur die Einwahlnummer eines Telefon-Termins. Ein Closing erbt die
    // Quelle von seinem Erstgespräch.
    type SettingQuelle = { phone: string | null; source_contact_id: string | null; source_phone_lead_id: string | null };
    const settingById = new Map<string, SettingQuelle>();
    for (const x of settings) {
      settingById.set(x.id, {
        phone: x.phone ?? null,
        source_contact_id: x.source_contact_id ?? null,
        source_phone_lead_id: x.source_phone_lead_id ?? null,
      });
    }
    const fehlendeSettings = [...quellen.values()]
      .map((q) => q.settingId)
      .filter((id): id is string => Boolean(id) && !settingById.has(id!));
    const nachgeladen = await stueckweise<SettingQuelle & { id: string }>(fehlendeSettings, (teil) =>
      supabase.from("setting_calls").select("id, phone, source_contact_id, source_phone_lead_id").in("id", teil),
    ).catch(() => []);
    for (const x of nachgeladen) settingById.set(x.id, x);
    for (const q of quellen.values()) {
      const st = q.settingId ? settingById.get(q.settingId) : undefined;
      if (st) {
        q.contactId = q.contactId ?? st.source_contact_id;
        q.phoneLeadId = q.phoneLeadId ?? st.source_phone_lead_id;
      }
    }

    // ── Nachschläge: Recycling-Leads und Quellen der Termine ────
    const leadIds = [
      ...eintraege.filter((e) => e.quelle === "recycling" && e.art === "phone_lead").map((e) => e.id),
      ...[...quellen.values()].map((q) => q.phoneLeadId).filter((v): v is string => Boolean(v)),
    ];
    const contactIds = [
      ...eintraege.filter((e) => e.quelle === "recycling" && e.art === "contact").map((e) => e.id),
      ...[...quellen.values()].map((q) => q.contactId).filter((v): v is string => Boolean(v)),
    ];
    const [leadInfo, contactInfo] = await Promise.all([
      stueckweise<{ id: string; list_id: string; phone: string | null; email: string | null }>(leadIds, (teil) =>
        supabase.from("phone_leads").select("id, list_id, phone, email").in("id", teil),
      ).catch(() => []),
      stueckweise<{ id: string; list_id: string; linkedin_url: string | null; email: string | null }>(contactIds, (teil) =>
        supabase.from("contacts").select("id, list_id, linkedin_url, email").in("id", teil),
      ).catch(() => []),
    ]);
    const leadMap = new Map(leadInfo.map((r) => [r.id, r]));
    const contactMap = new Map(contactInfo.map((r) => [r.id, r]));
    for (const e of eintraege) {
      if (e.quelle === "recycling") {
        if (e.art === "phone_lead") {
          const l = leadMap.get(e.id);
          if (l) Object.assign(e, { href: `/telefon/${l.list_id}`, telefon: l.phone, email: l.email });
        } else if (e.art === "contact") {
          const c = contactMap.get(e.id);
          if (c) Object.assign(e, { href: `/lists/${c.list_id}`, linkedinUrl: c.linkedin_url, email: c.email });
        }
        continue;
      }
      const q = quellen.get(e.key);
      if (!q) continue;
      const st = q.settingId ? settingById.get(q.settingId) : undefined;
      const lead = q.phoneLeadId ? leadMap.get(q.phoneLeadId) : undefined;
      const kontakt = q.contactId ? contactMap.get(q.contactId) : undefined;
      // Die Nummer am Termin (Einwahl bei Telefon-Terminen) zuerst, sonst die
      // des Telefon-Leads.
      e.telefon = e.telefon ?? st?.phone ?? lead?.phone ?? null;
      e.email = kontakt?.email ?? lead?.email ?? null;
      e.linkedinUrl = kontakt?.linkedin_url ?? null;
    }
  }

  // ── Protokoll ───────────────────────────────────────────────
  // Schlank: nur für Einträge, deren Gruppe davon abhängt — ein Altfall ist
  // keiner mehr, sobald es einen Eintrag gibt. Alle anderen gruppiert das
  // Protokoll nicht um.
  const fuerProtokoll = schlank ? eintraege.filter((e) => istAltfall(e, today)) : eintraege;
  const idsNach = (art: NachfassArt) => fuerProtokoll.filter((e) => e.art === art).map((e) => e.id);
  const [protokoll, heuteErledigt] = await Promise.all([
    ladeProtokoll(supabase, {
      setting_call_id: idsNach("setting"),
      closing_call_id: idsNach("closing"),
      contact_id: idsNach("contact"),
      phone_lead_id: idsNach("phone_lead"),
    }),
    schlank ? Promise.resolve(0) : ladeHeuteErledigt(supabase, access.user.id, today),
  ]);
  const proKey = new Map<string, KontaktRow[]>();
  for (const k of protokoll.rows) {
    const key = k.setting_call_id
      ? `setting:${k.setting_call_id}`
      : k.closing_call_id
        ? `closing:${k.closing_call_id}`
        : k.contact_id
          ? `contact:${k.contact_id}`
          : `phone_lead:${k.phone_lead_id}`;
    const list = proKey.get(key) ?? [];
    list.push(k);
    proKey.set(key, list);
  }
  for (const e of eintraege) {
    const list = (proKey.get(e.key) ?? []).sort((a, b) => b.created_at.localeCompare(a.created_at));
    e.kontakte = list.map((k) => ({ ergebnis: k.ergebnis, created_at: k.created_at }));
    const neu = list[0];
    if (neu) {
      e.letzterKontakt = {
        at: neu.created_at,
        vonName: neu.created_by_user_id ? nameById.get(neu.created_by_user_id) ?? null : null,
        ergebnis: neu.ergebnis,
      };
    }
  }

  return {
    eintraege,
    heuteErledigt: protokoll.available ? heuteErledigt : 0,
    protokollVerfuegbar: protokoll.available,
    vollstaendig,
    recyclingVerfuegbar: recycle.available,
    today,
    nowMs,
    wer: alle ? "alle" : "mein",
    darfAlle,
  };
}

/**
 * Der Eingang einer Person. `cache()` hält das Ergebnis je Anfrage — die
 * Seitenleiste (Badge) und die Seite teilen es, solange sie dieselbe
 * Personenachse fragen.
 */
export const ladeNachfassen = cache(async function ladeNachfassen(wer: NachfassWer = "mein"): Promise<NachfassenDaten | null> {
  const access = await getAccessContext();
  if (!access) return null;
  return ladeIntern(access, wer);
});

/**
 * Der schlanke Eingang für Badge und Dashboard (Punkt 5): dieselben Gruppen
 * „Ergebnis fehlt · Überfällig · Heute“ wie die Seite, ohne Wiedervorlage und
 * Kontaktwege. Badge und Dashboard-Karte teilen ihn je Anfrage — die Zahl
 * neben der Liste kommt damit aus derselben Menge wie die Liste selbst.
 */
export const ladeNachfassenSchlank = cache(async function ladeNachfassenSchlank(): Promise<NachfassenDaten | null> {
  const access = await getAccessContext();
  if (!access) return null;
  return ladeIntern(access, "mein", true);
});
