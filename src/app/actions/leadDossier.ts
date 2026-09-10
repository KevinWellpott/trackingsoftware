"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { personOf } from "@/lib/personResolution";
import {
  buildDossier,
  isDossierEntityKind,
  type DossierAttempt,
  type DossierClosing,
  type DossierContact,
  type DossierEntityKind,
  type DossierPhoneLead,
  type DossierSetting,
  type DossierTouch,
  type LeadDossier,
} from "@/lib/leadDossier";

// Lese-Action des Lead-Dossiers. Rechnet nichts — das tut `buildDossier()`
// (src/lib/leadDossier.ts, rein und getestet). Hier steht ausschliesslich, WIE
// die Zeilen zusammenkommen.
//
// VIER RUNDEN, HOECHSTENS ACHT ABFRAGEN. Die Kette Kontakt/Lead → Termin →
// Closing ist zwei Sprünge lang und laesst sich nicht in eine Abfrage falten:
// Erst der Anker sagt, welche Termine zu suchen sind, erst die Termine sagen,
// welche Closings und Quellzeilen dazugehoeren.
//
//   1. Ankerzeile                                             (1 Abfrage)
//   2. Erstgespräche: eigene ID, Quellkontakt, Quell-Lead     (1)
//   3. Closings · Kontakte · Telefon-Leads, parallel          (bis 3)
//   4. Anwahlen · Erinnerungen · Namen der Zuständigen        (bis 3)
//
// Innerhalb einer Runde laeuft alles parallel; leere Zweige entfallen. Ein
// Dossier ohne Telefon-Bezug braucht damit fuenf Abfragen.
//
// VERMUTUNGEN werden in Runde 3 MITGELADEN, nicht extra: derselbe
// Firmenname wird als zusaetzlicher `or`-Zweig an die Kontakt- und
// Lead-Abfrage gehaengt. Nur diese beiden Tabellen brauchen ihn — sie sind die
// einzigen, die ohne gemeinsamen Schluessel nebeneinander stehen koennen;
// Termine und Closings haengen immer an einer belegten Kette. Ob eine so
// geladene Zeile am Ende „belegt" oder „vermutet" heisst, entscheidet
// ausschliesslich die Bibliothek.
//
// SICHTBARKEIT: Jede Abfrage filtert zusaetzlich auf `workspace_id`. Fuer ein
// Mitglied greift darueber hinaus RLS; fuer einen Plattform-Admin laesst RLS
// alles durch, dort IST der Organisationsfilter die Grenze (Muster
// canAccessAppointment / pullRecycleForward).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fehlt das Schema (eine Migration nicht eingespielt), muss das von „kein
 * Lead gefunden" unterscheidbar sein. Vierte Kopie desselben Praedikats
 * (recycle.ts, reminders.ts, dropout.ts) — sie wandern zusammen, sobald es die
 * gemeinsame `schemaProbe.ts` gibt.
 */
function isMissingSchema(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code && ["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(e.code)) return true;
  const msg = (e?.message ?? (err instanceof Error ? err.message : "")).toLowerCase();
  return /does not exist|could not find|schema cache/.test(msg);
}

/* ------------------------------------------------------------------ *
 * Spaltenlisten
 * ------------------------------------------------------------------ */

const RECYCLE_COLUMNS =
  "next_recycle_at, recycle_attempt_count, recycle_excluded_at, recycle_last_contacted_at, " +
  "recycle_responded_at, recycle_reason_code";

const CONTACT_COLUMNS =
  "id, list_id, name, company, email, phone, linkedin_url, target_group, notes, meeting_notes, " +
  "answer_text, answer_category, answered, pitched_at, follow_up_number, next_follow_up_at, " +
  "last_contacted_at, appointment_set, appointment_at, blocked_at, setting_call_id, created_at, " +
  `updated_at, ${RECYCLE_COLUMNS}, lists(name, owner_name)`;

const PHONE_LEAD_COLUMNS =
  "id, list_id, decider_name, company, phone, decider_direct_dial, email, website, target_group, " +
  "script_label, status, first_call_at, call_attempt, gatekeeper_reached, decider_reached, " +
  "pitch_delivered, mailbox, answer_sentiment, callback_at, appointment_set, appointment_at, " +
  "no_transfer_reason, no_pitch_reason, no_appointment_reason, objection_notes, notes, created_at, " +
  `updated_at, ${RECYCLE_COLUMNS}, phone_lists(name, owner_name)`;

const SETTING_COLUMNS =
  "id, lead_name, company, phone, wa_phone, wa_consent_at, wa_refused_at, source_type, source_detail, " +
  "source_contact_id, source_phone_lead_id, appointment_at, call_at, meeting_kind, meet_link, status, " +
  "show_status, branche, has_budget_8k, sole_decider, can_decide_now, clear_need, ist_pain, warmth, " +
  "soll_ziel, script_answers, notes, objections_handled, objections_open, follow_up_due, no_show_count, " +
  "no_show_resolution, cancelled_at, cancel_reason_code, cancel_reason, cancel_outlook, reschedule_count, " +
  "last_reschedule_at, revived_at, disqualify_reason_code, disqualify_reason, assigned_user_id, " +
  `created_by_user_id, created_at, updated_at, ${RECYCLE_COLUMNS}`;

const CLOSING_COLUMNS =
  "id, setting_call_id, lead_name, company, call_at, meet_link, status, show_status, deal_volume, " +
  "payment_type, signature_received, contract_start, onboarding_at, lost_reason_code, lost_reason, " +
  "follow_up_due, follow_up_due_at, script_answers, notes, objections_handled, objections_open, " +
  "cancelled_at, cancel_reason_code, cancel_reason, cancel_outlook, reschedule_count, last_reschedule_at, " +
  `revived_at, assigned_user_id, created_by_user_id, created_at, updated_at, ${RECYCLE_COLUMNS}`;

const ATTEMPT_COLUMNS =
  "id, lead_id, called_at, attempt_no, kind, outcome, mailbox, gatekeeper_reached, decider_reached, " +
  "pitch_delivered, notes";

const TOUCH_COLUMNS =
  "id, entity_type, entity_id, cascade_kind, touch_kind, step_no, template_key, channel, due_at, " +
  "outcome, done_at, done_note, superseded_at";

/* ------------------------------------------------------------------ *
 * Hilfen
 * ------------------------------------------------------------------ */

/**
 * Der eingebettete Listen-Datensatz kommt je nach PostgREST-Version als Objekt
 * oder als einelementiges Array — beide Formen lesen, statt sich auf eine zu
 * verlassen (Muster `embeddedOwner` in /erinnerungen).
 */
function embeddedList(row: unknown, relation: "lists" | "phone_lists"): { name: string | null; owner: string | null } {
  const node = (row as Record<string, unknown>)[relation];
  const one = (Array.isArray(node) ? node[0] : node) as { name?: string | null; owner_name?: string | null } | undefined;
  return { name: one?.name ?? null, owner: one?.owner_name ?? null };
}

/**
 * Ein Wert für einen `or`-Ausdruck. PostgREST trennt dort an Komma und Punkt;
 * ein Firmenname bringt beides mit („Meier, Schulz & Co. KG"). Anführungszeichen
 * schützen den Wert, Backslash und Anführungszeichen darin müssen escaped
 * werden — sonst bricht ein Name mit Zitat die Abfrage auf.
 *
 * `%` und `_` im Namen bleiben für `ilike` Platzhalter und holen dann etwas zu
 * viel herein. Das ist die harmlose Richtung: Die Bibliothek prüft jede so
 * geladene Zeile noch einmal auf normalisierte Namensgleichheit, ein Treffer zu
 * viel fällt dort heraus. Umgekehrt — ein Vorschlag, der nie erscheint —
 * bliebe unsichtbar.
 */
function orQuoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const uuids = (values: (string | null | undefined)[]): string[] =>
  [...new Set(values.filter((v): v is string => typeof v === "string" && UUID_RE.test(v)))];

export type LeadDossierResult = {
  dossier: LeadDossier | null;
  /** false = Schema fehlt. Ausdrücklich NICHT dasselbe wie „nicht gefunden". */
  available: boolean;
  error?: string;
};

const NOT_FOUND: LeadDossierResult = { dossier: null, available: true };

/* ------------------------------------------------------------------ *
 * Die Action
 * ------------------------------------------------------------------ */

export async function getLeadDossier(kind: string, id: string): Promise<LeadDossierResult> {
  if (!isDossierEntityKind(kind) || !UUID_RE.test(id)) return NOT_FOUND;

  const access = await getAccessContext();
  if (!access) return { dossier: null, available: true };

  const supabase = await createClient();
  const ws = access.workspace_id;

  try {
    /* ── Runde 1: die Ankerzeile ───────────────────────────────── */
    const anchorTable: Record<DossierEntityKind, { table: string; columns: string }> = {
      contact: { table: "contacts", columns: CONTACT_COLUMNS },
      phone_lead: { table: "phone_leads", columns: PHONE_LEAD_COLUMNS },
      setting: { table: "setting_calls", columns: SETTING_COLUMNS },
      closing: { table: "closing_calls", columns: CLOSING_COLUMNS },
    };
    const spec = anchorTable[kind];
    const { data: anchorRow, error: anchorError } = await supabase
      .from(spec.table)
      .select(spec.columns)
      .eq("id", id)
      .eq("workspace_id", ws)
      .maybeSingle();
    if (anchorError) throw anchorError;
    if (!anchorRow) return NOT_FOUND;

    const anchor = anchorRow as unknown as Record<string, unknown>;
    const company = typeof anchor.company === "string" ? anchor.company.trim() : "";

    /* ── Runde 2: die Erstgespräche der Kette ──────────────────── */
    const settingSeeds = uuids([
      kind === "setting" ? id : null,
      kind === "contact" ? (anchor.setting_call_id as string | null) : null,
      kind === "closing" ? (anchor.setting_call_id as string | null) : null,
    ]);
    const settingOr: string[] = [];
    if (settingSeeds.length > 0) settingOr.push(`id.in.(${settingSeeds.join(",")})`);
    if (kind === "contact") settingOr.push(`source_contact_id.eq.${id}`);
    if (kind === "phone_lead") settingOr.push(`source_phone_lead_id.eq.${id}`);

    let settingRows: Record<string, unknown>[] = [];
    if (settingOr.length > 0) {
      const { data, error } = await supabase
        .from("setting_calls")
        .select(SETTING_COLUMNS)
        .eq("workspace_id", ws)
        .or(settingOr.join(","));
      if (error) throw error;
      settingRows = (data ?? []) as unknown as Record<string, unknown>[];
    }
    const settingIds = uuids(settingRows.map((s) => s.id as string));

    /* ── Runde 3: Closings, Kontakte, Telefon-Leads ────────────── */
    const closingOr: string[] = [];
    if (kind === "closing") closingOr.push(`id.eq.${id}`);
    if (settingIds.length > 0) closingOr.push(`setting_call_id.in.(${settingIds.join(",")})`);

    const contactSeeds = uuids([
      kind === "contact" ? id : null,
      ...settingRows.map((s) => s.source_contact_id as string | null),
    ]);
    const contactOr: string[] = [];
    if (contactSeeds.length > 0) contactOr.push(`id.in.(${contactSeeds.join(",")})`);
    if (settingIds.length > 0) contactOr.push(`setting_call_id.in.(${settingIds.join(",")})`);
    if (company) contactOr.push(`company.ilike.${orQuoted(company)}`);

    const leadSeeds = uuids([
      kind === "phone_lead" ? id : null,
      ...settingRows.map((s) => s.source_phone_lead_id as string | null),
    ]);
    const leadOr: string[] = [];
    if (leadSeeds.length > 0) leadOr.push(`id.in.(${leadSeeds.join(",")})`);
    if (company) leadOr.push(`company.ilike.${orQuoted(company)}`);

    const [closingRes, contactRes, leadRes] = await Promise.all([
      closingOr.length > 0
        ? supabase.from("closing_calls").select(CLOSING_COLUMNS).eq("workspace_id", ws).or(closingOr.join(","))
        : Promise.resolve({ data: [], error: null }),
      contactOr.length > 0
        ? supabase.from("contacts").select(CONTACT_COLUMNS).eq("workspace_id", ws).or(contactOr.join(","))
        : Promise.resolve({ data: [], error: null }),
      leadOr.length > 0
        ? supabase.from("phone_leads").select(PHONE_LEAD_COLUMNS).eq("workspace_id", ws).or(leadOr.join(","))
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (closingRes.error) throw closingRes.error;
    if (contactRes.error) throw contactRes.error;
    if (leadRes.error) throw leadRes.error;

    const closingRows = (closingRes.data ?? []) as unknown as Record<string, unknown>[];
    const contactRows = (contactRes.data ?? []) as unknown as Record<string, unknown>[];
    const leadRows = (leadRes.data ?? []) as unknown as Record<string, unknown>[];

    // Die Ankerzeile selbst kann in Runde 3 fehlen (ein Closing ohne Setting
    // etwa taucht in keiner der drei Abfragen auf) — sie wird deshalb immer
    // dazugelegt und entdoppelt.
    const mergeAnchor = (rows: Record<string, unknown>[], target: DossierEntityKind) => {
      if (kind !== target) return rows;
      return rows.some((r) => r.id === id) ? rows : [...rows, anchor];
    };

    /* ── Runde 4: Anwahlen, Erinnerungen, Namen ────────────────── */
    const allLeads = mergeAnchor(leadRows, "phone_lead");
    const allSettings = mergeAnchor(settingRows, "setting");
    const allClosings = mergeAnchor(closingRows, "closing");
    const allContacts = mergeAnchor(contactRows, "contact");

    const leadIds = uuids(allLeads.map((l) => l.id as string));
    const closingIds = uuids(allClosings.map((c) => c.id as string));
    const personIds = uuids([
      ...allSettings.map((s) => personOf(s as { assigned_user_id: string | null; created_by_user_id: string | null })),
      ...allClosings.map((c) => personOf(c as { assigned_user_id: string | null; created_by_user_id: string | null })),
    ]);

    const touchOr: string[] = [];
    if (settingIds.length > 0) touchOr.push(`setting_call_id.in.(${settingIds.join(",")})`);
    if (closingIds.length > 0) touchOr.push(`closing_call_id.in.(${closingIds.join(",")})`);

    const [attemptRes, touchRes, profileRes] = await Promise.all([
      leadIds.length > 0
        ? supabase
            .from("phone_call_attempts")
            .select(ATTEMPT_COLUMNS)
            .eq("workspace_id", ws)
            .in("lead_id", leadIds)
            .order("called_at", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      touchOr.length > 0
        ? supabase.from("reminder_touches").select(TOUCH_COLUMNS).eq("workspace_id", ws).or(touchOr.join(","))
        : Promise.resolve({ data: [], error: null }),
      personIds.length > 0
        ? supabase.from("profiles").select("user_id, username").in("user_id", personIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    // Anwahl-Log und Erinnerungen sind fail-soft: fehlt eine der beiden
    // Migrationen, bleibt die Zeitleiste unvollständig statt leer. Der Anker
    // steht bereits, das Dossier ist auch ohne sie brauchbar.
    if (attemptRes.error) console.error("[leadDossier] phone_call_attempts:", attemptRes.error.message);
    if (touchRes.error) console.error("[leadDossier] reminder_touches:", touchRes.error.message);
    if (profileRes.error) console.error("[leadDossier] profiles:", profileRes.error.message);

    const usernameById = new Map<string, string>();
    for (const p of (profileRes.data ?? []) as unknown as { user_id: string; username: string }[]) {
      usernameById.set(p.user_id, p.username);
    }
    const nameOf = (row: Record<string, unknown>): string | null => {
      const uid = personOf(row as { assigned_user_id: string | null; created_by_user_id: string | null });
      return uid ? (usernameById.get(uid) ?? null) : null;
    };

    /* ── Übergabe an die Bibliothek ────────────────────────────── */
    const dossier = buildDossier({
      anchor: { kind, id },
      contacts: allContacts.map((r) => {
        const list = embeddedList(r, "lists");
        return { ...(r as unknown as DossierContact), list_name: list.name, list_owner_name: list.owner };
      }),
      phoneLeads: allLeads.map((r) => {
        const list = embeddedList(r, "phone_lists");
        return { ...(r as unknown as DossierPhoneLead), list_name: list.name, list_owner_name: list.owner };
      }),
      settings: allSettings.map((r) => ({ ...(r as unknown as DossierSetting), assigned_username: nameOf(r) })),
      closings: allClosings.map((r) => ({ ...(r as unknown as DossierClosing), assigned_username: nameOf(r) })),
      attempts: (attemptRes.data ?? []) as unknown as DossierAttempt[],
      touches: (touchRes.data ?? []) as unknown as DossierTouch[],
      now: new Date().toISOString(),
    });

    return { dossier: dossier.found ? dossier : null, available: true };
  } catch (e) {
    const missing = isMissingSchema(e);
    if (!missing) console.error("getLeadDossier:", e instanceof Error ? e.message : e);
    // Der ROHE Fehlertext bleibt im Server-Log (oben) und geht nicht an den
    // Bildschirm: Er ist englisch, nennt Tabellen- und Spaltennamen und sagt
    // niemandem, was er jetzt tun soll. Die Fehlerkarte zeigt den Text
    // wörtlich an — sie braucht deshalb einen Satz, der für sich steht.
    return {
      dossier: null,
      available: !missing,
      error: missing
        ? "Das Dossier braucht Spalten, die in dieser Datenbank fehlen — eine Migration ist nicht eingespielt."
        : "Das Dossier ließ sich nicht laden.",
    };
  }
}
