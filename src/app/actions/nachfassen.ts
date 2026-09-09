"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { revalidatePath } from "next/cache";
import { localDateISO, addDaysISO } from "@/lib/dates";
import { FU_MAX_STAGE, nextFollowUpAfter } from "@/lib/followup";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { loadRecycleTasks, scheduleRecycle } from "@/app/actions/recycle";
import { getTemplateBundles } from "@/app/actions/reminders";
import {
  renderResolved,
  type TemplateBundle,
  type TemplateKey,
  type TemplateSource,
} from "@/lib/messageTemplates";
import { renderRecycleTemplate, type RecycleOrigin } from "@/lib/recycleCadence";
import { CONTACT_GAP_WARN_DAYS } from "@/lib/contactGap";

// Nachfassen-Union: LinkedIn-Follow-up · Telefon-Rückruf · Erstgespräch-
// Wiedervorlage · Closing-Wiedervorlage (RPC `nachfassen_tasks`) PLUS Recycling
// (RPC `recycle_tasks`) — fünf Quellen, app-seitig gemischt, weil eine geänderte
// RETURNS-TABLE-Signatur ein DROP FUNCTION statt CREATE OR REPLACE bräuchte
// (docs §5). Jede Karte trägt einen fertigen Text zum Kopieren, KEIN
// Auto-Versand.
//
// Die Texte kommen ausnahmslos aus dem Vorlagen-Katalog (messageTemplates.ts)
// mit seiner Vorrangkette Liste > persönlich > Organisation > Auslieferung. Die
// früher hier hartkodierten Texte sind ersatzlos weg: sie ließen sich im
// Vorlagen-Editor pflegen, ohne dass sich auf dieser Seite irgendetwas änderte —
// schlimmer als ein unveränderlicher Text, weil der Nutzer die Änderung sieht
// und ihr glaubt. Aus demselben Grund liest diese Datei `followup_templates`
// nicht mehr: Migration 0034 hat die Zeilen nach `message_templates` übernommen,
// die Alt-Tabelle hat keine Oberfläche mehr.
//
// LATENZ: Die Seite ist der tägliche Arbeitsplatz und lädt in ZWEI Wellen —
// erst beide RPCs parallel, dann alle Nachschläge parallel. Vorher lief jeder
// Nachschlag einzeln hintereinander (bis zu acht `await` in Folge, jeder
// `.in()`-Block zusätzlich Chunk für Chunk), und das Recycling startete erst,
// wenn alles davor fertig war.

export type NachfassenTask = {
  source: "linkedin" | "telefon" | "closing" | "setting" | "recycling";
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
  /** Welche Stufe der Vorrangkette den Text geliefert hat — Badge auf der Karte. */
  text_source: TemplateSource;
  /**
   * Zeitpunkt des letzten Kontakts zu DIESEM Lead aus einem ANDEREN Vorgang,
   * sofern er weniger als `CONTACT_GAP_WARN_DAYS` zurückliegt — sonst null.
   */
  recent_contact_at: string | null;
  /** Nur bei `source === "recycling"` gesetzt — welche der vier Ursprungstabellen. */
  recycle_origin?: RecycleOrigin;
  /** lost_reason_code | 'dead' | 'fu_exhausted' — für Badge + Aktionen. */
  recycle_reason?: string | null;
  recycle_attempt?: number;
};

export type NachfassenResult = {
  tasks: NachfassenTask[];
  hiddenOlder: number; // ältere LinkedIn-Leads (Pitch > 7 Tage), ausgeblendet
  /**
   * false = das Recycling-Schema fehlt (Migration 0033). Muss bis in die
   * Oberfläche durchgereicht werden: sonst sieht eine fehlende Migration
   * genauso aus wie „nichts fällig" — und niemand erfährt, dass gerade gar
   * keine toten Leads wiedervorgelegt werden.
   */
  recyclingAvailable: boolean;
};

/* ------------------------------------------------------------------ *
 * Kontaktfrequenz (Entscheidung K3)
 * ------------------------------------------------------------------ */

/**
 * Die Warnschwelle steht seit dem Zusammenlegen in `lib/contactGap.ts` — sie
 * lag vorher zweimal im Code (hier und in `ErinnerungenBoard`), und zwei
 * Kopien einer Zahl, die eine Warnung auslöst, laufen früher oder später
 * auseinander.
 *
 * Die Termin-Kaskade ist ausgenommen — dort sind drei Kontakte in drei Tagen
 * gewollt. Auf dieser Seite steht keine Kaskadenstufe, wohl aber ihr Ergebnis:
 * deshalb zählt ein erledigter Touch NUR dann als Vorkontakt, wenn er zu einem
 * ANDEREN Vorgang gehört. Sonst warnte die Closing-Wiedervorlage vor ihrer
 * eigenen Bestätigungs-Kaskade — einer der beiden Überschneidungen zwischen
 * /nachfassen und /erinnerungen (die zweite ist die No-Show-Kette eines
 * Settings, siehe `SECTION_CROSSLINK` im Board).
 */

/**
 * Identität eines Leads über Quellen hinweg (Muster `leadKeyOf`,
 * ErinnerungenBoard). Ohne Namen UND Firma gibt es keine belastbare Identität —
 * dann bleibt die Zeile für sich, statt mit allen anderen Namenlosen zu
 * verschmelzen.
 */
function leadKeyOf(leadName: string | null, company: string | null): string | null {
  const n = (leadName ?? "").trim().toLowerCase();
  const c = (company ?? "").trim().toLowerCase();
  return n || c ? `${n}|${c}` : null;
}

/** Ein belegter Kontakt zu einem Lead: wann, und aus welchem Vorgang heraus. */
type ContactEvent = { entityId: string; at: string };

/**
 * Ein eingebetteter Datensatz kommt je nach PostgREST-Version als Objekt oder
 * als einelementiges Array zurück. Beide Formen lesen, statt sich auf eine zu
 * verlassen — ein falscher Zugriff wäre hier lautlos `undefined` (Muster
 * `embeddedOwner`, erinnerungen/page.tsx).
 */
function embeddedRow<T>(node: unknown): T | null {
  const one = Array.isArray(node) ? node[0] : node;
  return (one ?? null) as T | null;
}

type LeadNames = { lead_name: string | null; company: string | null };

/**
 * Erledigte Erinnerungs-Touches der letzten Tage, gebündelt je Lead.
 *
 * `reminder_touches` trägt Namen und Firma nicht selbst, sondern nur den Bezug
 * auf Setting bzw. Closing — beide Seiten werden deshalb eingebettet statt in
 * einer zweiten Runde nachgeladen: EINE Abfrage für die ganze Seite.
 *
 * Fail-soft: fehlt die Kaskaden-Migration (0032), kostet das hier die Warnung
 * und nicht die Aufgaben.
 *
 * `phone_call_attempts` ist bewusst KEINE Quelle: Wer gestern angerufen und
 * dabei einen Rückruf für heute vereinbart hat, ist genau die vorgesehene
 * Kadenz gefahren. Eine Warnung darauf wäre Rauschen an der Stelle, an der die
 * Seite ihre Kernaufgabe erfüllt.
 */
async function loadRecentContacts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  sinceIso: string,
): Promise<Map<string, ContactEvent[]>> {
  const byLead = new Map<string, ContactEvent[]>();
  type TouchRow = {
    done_at: string | null;
    setting_call_id: string | null;
    closing_call_id: string | null;
    setting_calls: unknown;
    closing_calls: unknown;
  };

  try {
    const touches = await fetchAllRows<TouchRow>((from, to) =>
      supabase
        .from("reminder_touches")
        .select("done_at, setting_call_id, closing_call_id, setting_calls(lead_name, company), closing_calls(lead_name, company)")
        .eq("workspace_id", workspaceId)
        .not("done_at", "is", null)
        .gte("done_at", sinceIso)
        .order("done_at", { ascending: true })
        .order("id")
        .range(from, to),
    );

    for (const t of touches) {
      const entityId = t.setting_call_id ?? t.closing_call_id;
      if (!entityId || !t.done_at) continue;
      const lead = embeddedRow<LeadNames>(t.setting_calls) ?? embeddedRow<LeadNames>(t.closing_calls);
      const key = leadKeyOf(lead?.lead_name ?? null, lead?.company ?? null);
      if (!key) continue;
      const list = byLead.get(key);
      if (list) list.push({ entityId, at: t.done_at });
      else byLead.set(key, [{ entityId, at: t.done_at }]);
    }
  } catch (e) {
    // Eine fehlende Tabelle ist hier kein Fehler, sondern der Zustand „Kaskade
    // noch nicht eingespielt" — sie soll nicht bei jedem Seitenaufruf ins Log.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/does not exist|could not find|schema cache/i.test(msg)) console.error("[loadRecentContacts]", msg);
  }

  return byLead;
}

/* ------------------------------------------------------------------ *
 * Nachschläge
 * ------------------------------------------------------------------ */

/** PostgREST-URL-Länge: mehr IDs als das gehen nicht in ein `.in()`. */
const ID_CHUNK = 200;

/**
 * `.in()`-Nachschlag über beliebig viele IDs — die Chunks laufen PARALLEL.
 * Vorher stand je Chunk ein `await` in einer for-Schleife: bei 600 IDs drei
 * Roundtrips nacheinander, obwohl keiner auf den anderen wartet.
 */
async function selectByIds<T>(
  ids: string[],
  run: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK));
  const results = await Promise.all(chunks.map(run));
  const out: T[] = [];
  for (const res of results) {
    if (res.error) {
      console.error("[nachfassen] Nachschlag:", res.error.message);
      continue;
    }
    if (Array.isArray(res.data)) out.push(...(res.data as T[]));
  }
  return out;
}

/** Rohzeile der RPC — alles Weitere hängt die App an. */
type NachfassenRpcRow = Pick<
  NachfassenTask,
  "entity_id" | "owner_name" | "lead_name" | "company" | "due_at" | "channel" | "next_fu_number"
> & { source: "linkedin" | "telefon" | "closing" | "setting" };

/** `lists` ist eingebettet: die Nachfass-Sequenz der Liste hat Vorrang vor der
    persönlichen Vorlage und wird sonst in einer eigenen Runde nachgeladen. */
type ContactRow = { id: string; list_id: string; pitched_at: string | null; lists: unknown };

type ListTexts = { fu1_text: string | null; fu2_text: string | null; fu3_text: string | null };

type LeadRow = { id: string; list_id: string; phone: string | null };

/** FU-Stufe → Vorlagen-Schlüssel. Die RPC liefert 1–3; alles andere fällt auf FU1. */
function linkedinTemplateKey(fu: number | null): TemplateKey {
  if (fu === 2) return "linkedin_fu_2";
  if (fu === 3) return "linkedin_fu_3";
  return "linkedin_fu_1";
}

/** Ursprung → Vorlagen-Schlüssel im gemeinsamen Katalog (messageTemplates.ts). */
const RECYCLE_TEMPLATE_KEY: Record<RecycleOrigin, TemplateKey> = {
  linkedin: "recycle_linkedin",
  telefon: "recycle_telefon",
  setting: "recycle_setting",
  closing: "recycle_closing",
};

/**
 * Der grund-spezifische Anlass für {anlass} bleibt in recycleCadence.ts: die
 * Zuordnung Grund → Aufhänger ("vielleicht passt der Zeitpunkt inzwischen
 * besser") ist Fachwissen und darf nicht ein zweites Mal entstehen. Gerendert
 * wird hier nur noch der nackte Platzhalter — den Rest des Textes macht die
 * Vorlagenkette.
 */
function recycleAnlass(reason: string | null): string {
  return renderRecycleTemplate("{anlass}", { leadName: null, company: null, reason });
}

/* ------------------------------------------------------------------ *
 * Fällige Aufgaben
 * ------------------------------------------------------------------ */

export async function getNachfassenTasks(options?: {
  includeOlder?: boolean;
}): Promise<NachfassenResult> {
  const access = await getAccessContext();
  // Ohne Anmeldung gibt es keine Aussage über das Schema — hier ist `true` die
  // ehrliche Antwort, sonst behauptete die leere Seite eine fehlende Migration.
  if (!access) return { tasks: [], hiddenOlder: 0, recyclingAvailable: true };
  const supabase = await createClient();

  // IMMER personenbezogen: der eingeloggte Nutzer (bzw. die aktive Admin-Datensicht).
  const scopeUserId = access.effective_user_id ?? access.user.id;
  const today = localDateISO();

  /* ── Welle 1: beide RPCs parallel ──────────────────────────────────
     Sie hängen nicht voneinander ab. Vorher lief das Recycling erst los,
     wenn die Union-RPC samt aller ihrer Nachschläge fertig war. Ein Fehler
     der Union-RPC beendet die Funktion außerdem nicht mehr: das Recycling
     hat damit gar nichts zu tun und bleibt sichtbar.                    */
  const [rows, recycle] = await Promise.all([
    fetchAllRows<NachfassenRpcRow>((from, to) =>
      supabase
        .rpc("nachfassen_tasks", {
          p_workspace_id: access.workspace_id,
          p_today: today,
          p_now: new Date().toISOString(),
          p_effective_user_id: scopeUserId,
        })
        .range(from, to),
    ).catch((e: unknown) => {
      console.error("nachfassen_tasks:", e instanceof Error ? e.message : e);
      return [] as NachfassenRpcRow[];
    }),
    loadRecycleTasks(),
  ]);

  // Stabile Reihenfolge clientseitig (RPC hat kein ORDER BY)
  rows.sort(
    (a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? "") || a.entity_id.localeCompare(b.entity_id),
  );

  /* ── Welle 2: alle Nachschläge parallel ─────────────────────────────
     Kontakte und Leads werden für BEIDE Quellen zusammen geholt (Aufgabe
     und Recycling) — die Entity-IDs sind zwar disjunkt, die Tabelle ist
     aber dieselbe, und zwei Abfragen gegen dieselbe Tabelle sind ein
     Roundtrip zu viel. Die Nachfass-Texte der Liste kommen eingebettet mit,
     statt in einer dritten Runde über die eingesammelten `list_id`.      */
  const contactIds = [
    ...new Set([
      ...rows.filter((r) => r.source === "linkedin").map((r) => r.entity_id),
      ...recycle.tasks.filter((r) => r.origin === "linkedin").map((r) => r.entity_id),
    ]),
  ];
  const leadIds = [
    ...new Set([
      ...rows.filter((r) => r.source === "telefon").map((r) => r.entity_id),
      ...recycle.tasks.filter((r) => r.origin === "telefon").map((r) => r.entity_id),
    ]),
  ];
  // Absender ist die ZUSTÄNDIGE Person der Aufgabe, nicht der Betrachter — ein
  // Owner in der Team-Sicht bekäme sonst seine eigenen Texte unter fremdem
  // Namen. Die vier Zweige der Union-RPC tragen keine Zuweisung; dort gilt die
  // aktive Datensicht.
  const senderIds = [
    ...new Set([scopeUserId, ...recycle.tasks.map((r) => r.assigned_user_id ?? scopeUserId)]),
  ];
  const contactSince = new Date(Date.now() - CONTACT_GAP_WARN_DAYS * 86_400_000).toISOString();

  const [contactRows, leadRows, bundles, touchContacts] = await Promise.all([
    selectByIds<ContactRow>(contactIds, (chunk) =>
      supabase
        .from("contacts")
        .select("id, list_id, pitched_at, lists(fu1_text, fu2_text, fu3_text)")
        .eq("workspace_id", access.workspace_id)
        .in("id", chunk),
    ),
    selectByIds<LeadRow>(leadIds, (chunk) =>
      supabase
        .from("phone_leads")
        .select("id, list_id, phone")
        .eq("workspace_id", access.workspace_id)
        .in("id", chunk),
    ),
    getTemplateBundles(senderIds),
    loadRecentContacts(supabase, access.workspace_id, contactSince),
  ]);

  const contactInfo = new Map<string, { list_id: string; pitched_at: string | null; fuTexts: (string | null)[] }>();
  for (const c of contactRows) {
    const l = embeddedRow<ListTexts>(c.lists);
    contactInfo.set(c.id, {
      list_id: c.list_id,
      pitched_at: c.pitched_at,
      fuTexts: [l?.fu1_text ?? null, l?.fu2_text ?? null, l?.fu3_text ?? null],
    });
  }
  const leadInfo = new Map<string, LeadRow>();
  for (const l of leadRows) leadInfo.set(l.id, l);

  // Recycling-Versuche sind ebenfalls belegte Kontakte — die Zeile trägt ihren
  // letzten Versuch selbst mit (`recycle_last_contacted_at`).
  for (const r of recycle.tasks) {
    const key = leadKeyOf(r.lead_name, r.company);
    if (!key || !r.last_contacted_at) continue;
    const list = touchContacts.get(key);
    const event = { entityId: r.entity_id, at: r.last_contacted_at };
    if (list) list.push(event);
    else touchContacts.set(key, [event]);
  }

  const contactCutoff = Date.now() - CONTACT_GAP_WARN_DAYS * 86_400_000;

  /** Letzter Kontakt zu diesem Lead aus einem ANDEREN Vorgang, sonst null. */
  function recentContactFor(task: {
    lead_name: string | null;
    company: string | null;
    entity_id: string;
  }): string | null {
    const key = leadKeyOf(task.lead_name, task.company);
    if (!key) return null;
    let latest: string | null = null;
    for (const ev of touchContacts.get(key) ?? []) {
      if (ev.entityId === task.entity_id) continue;
      if (new Date(ev.at).getTime() < contactCutoff) continue;
      if (!latest || ev.at > latest) latest = ev.at;
    }
    return latest;
  }

  const bundleFor = (userId: string): TemplateBundle | undefined => bundles.get(userId);

  // Cutoff: nur Leads der letzten 7 Tage nachfassen (Bestandsdaten bleiben unangetastet,
  // ältere sind über includeOlder erreichbar).
  const cutoff = addDaysISO(today, -7);
  let hiddenOlder = 0;

  const tasks: NachfassenTask[] = [];
  for (const r of rows) {
    let list_id: string | null = null;
    let phone: string | null = null;
    let rendered: { body: string; source: TemplateSource };

    if (r.source === "linkedin") {
      const info = contactInfo.get(r.entity_id);
      list_id = info?.list_id ?? null;
      const pitched = info?.pitched_at ?? null;
      if (!options?.includeOlder && (!pitched || pitched < cutoff)) {
        hiddenOlder++;
        continue;
      }
      // Der Text der Liste geht vor (`LIST_SCOPED_KEYS`) — er gehört fachlich
      // zum Pitch-Text derselben Liste.
      const listFu = r.next_fu_number != null ? info?.fuTexts[r.next_fu_number - 1] ?? null : null;
      rendered = renderResolved(
        linkedinTemplateKey(r.next_fu_number),
        bundleFor(scopeUserId),
        { leadName: r.lead_name, company: r.company, absender: r.owner_name },
        listFu,
      );
    } else if (r.source === "telefon") {
      const info = leadInfo.get(r.entity_id);
      list_id = info?.list_id ?? null;
      phone = info?.phone ?? null;
      rendered = renderResolved("telefon_rueckruf", bundleFor(scopeUserId), {
        leadName: r.lead_name,
        company: r.company,
        appointmentAtIso: r.due_at,
        kanal: "Telefon",
        absender: r.owner_name,
      });
    } else {
      const key: TemplateKey = r.source === "setting" ? "setting_wiedervorlage" : "closing_wiedervorlage";
      rendered = renderResolved(key, bundleFor(scopeUserId), {
        leadName: r.lead_name,
        company: r.company,
        appointmentAtIso: r.due_at,
        absender: r.owner_name,
      });
    }

    tasks.push({
      ...r,
      list_id,
      phone,
      prepared_text: rendered.body,
      text_source: rendered.source,
      recent_contact_at: recentContactFor(r),
    });
  }

  // Recycling: eigene RPC (Migration 0033), eigene Texte — die Entity-IDs hier
  // sind disjunkt zu den vier Zweigen oben (ein FU3-Kontakt ohne Antwort steht
  // nicht mehr im LinkedIn-Zweig, ein toter Telefon-Lead nicht mehr im
  // Rückruf-Zweig usw.), deshalb kein Konflikt mit den Karten davor.
  for (const r of recycle.tasks) {
    // Vorrangkette persönlich > Organisation > Auslieferung (resolveTemplate);
    // der Freitext neben dem Grund steht als {notiz} zur Verfügung — Code ist
    // Statistik, Freitext ist Gedächtnis.
    const rendered = renderResolved(
      RECYCLE_TEMPLATE_KEY[r.origin],
      bundleFor(r.assigned_user_id ?? scopeUserId),
      {
        leadName: r.lead_name,
        company: r.company,
        anlass: recycleAnlass(r.reason),
        notiz: r.reason_note,
      },
    );
    let list_id: string | null = null;
    let phone: string | null = null;
    if (r.origin === "linkedin") list_id = contactInfo.get(r.entity_id)?.list_id ?? null;
    if (r.origin === "telefon") {
      const info = leadInfo.get(r.entity_id);
      list_id = info?.list_id ?? null;
      phone = info?.phone ?? null;
    }
    tasks.push({
      source: "recycling",
      entity_id: r.entity_id,
      owner_name: r.owner_name,
      lead_name: r.lead_name,
      company: r.company,
      due_at: r.due_at,
      channel: "Recycling",
      next_fu_number: null,
      list_id,
      phone,
      prepared_text: rendered.body,
      text_source: rendered.source,
      recent_contact_at: recentContactFor(r),
      recycle_origin: r.origin,
      recycle_reason: r.reason,
      recycle_attempt: r.attempt_count,
    });
  }

  return { tasks, hiddenOlder, recyclingAvailable: recycle.available };
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

  // FU3 erledigt, ohne dass je geantwortet wurde: der Flow endet hier für
  // immer (nextDate === null) — eines der vier "toten Enden" (§ Konzept-
  // Diskussion). Statt spurlos zu verschwinden, bekommt der Kontakt ein
  // Recycling-Datum. Ohne Grund-Argument: Grund und Status liest
  // `schedule_recycle()` selbst aus der Zeile.
  if (nextDate === null && done >= FU_MAX_STAGE) await scheduleRecycle("linkedin", contactId);
  revalidatePath("/nachfassen", "page");
  revalidatePath(`/lists/${(c as { list_id: string }).list_id}`, "page");
  revalidatePath("/", "layout");
  return {};
}
