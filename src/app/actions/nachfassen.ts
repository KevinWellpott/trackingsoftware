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
import { contactGapWindowStart, isWithinContactGap } from "@/lib/contactGap";
import { berlinDateISO, berlinInputToIso, isoToBerlinInput } from "@/lib/apptTime";
import { markRecycleContacted, markRecycleResponded } from "@/app/actions/recycle";
import { updateSettingCall } from "@/app/actions/settingCalls";
import { updateClosingCall } from "@/app/actions/closingCalls";
import type { SettingStatus } from "@/lib/types";

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
  /**
   * Nur bei `source === "setting"`: WARUM diese Wiedervorlage fällig ist.
   *
   * Der Zweig der RPC vereint `no_show` und `unqualifiziert` — zwei völlig
   * verschiedene Anlässe, die dieselbe Vorlage bekommen. Ohne dieses Feld stand
   * auf der Karte nichts davon, und man musste jede einzelne öffnen, um zu
   * wissen, was man schreiben soll. Die RPC liefert es nicht mit und bleibt
   * unangetastet (sie speist auch den Navigations-Zähler) — es kommt aus dem
   * Nachschlag der zweiten Welle.
   */
  setting_status?: SettingStatus | null;
  /** Nur bei `setting_status === "unqualifiziert"` interessant: der Grund-Code. */
  setting_disqualify_reason?: string | null;
};

export type NachfassenResult = {
  tasks: NachfassenTask[];
  hiddenOlder: number; // ältere LinkedIn-Leads (Pitch > 7 Tage), ausgeblendet
  /**
   * LinkedIn-Aufgaben, deren Kontaktzeile der Nachschlag NICHT lesen konnte.
   *
   * Sie werden trotzdem ausgeliefert (die RPC ist die Instanz, die „heute
   * fällig" entscheidet), tragen aber weder Listenbezug noch Pitch-Datum —
   * und dürfen deshalb nicht in `hiddenOlder` landen: Diese Zahl behauptet
   * „Pitch älter als 7 Tage", und das ist hier schlicht unbekannt. Der Pitch
   * kann von gestern sein.
   */
  unreadableContacts: number;
  /**
   * false = das Recycling-Schema fehlt (Migration 0033). Muss bis in die
   * Oberfläche durchgereicht werden: sonst sieht eine fehlende Migration
   * genauso aus wie „nichts fällig" — und niemand erfährt, dass gerade gar
   * keine toten Leads wiedervorgelegt werden.
   */
  recyclingAvailable: boolean;
  /**
   * false = die Union-RPC `nachfassen_tasks` hat nicht geantwortet (Timeout,
   * RLS-Hänger, Rechteproblem). Dieselbe Doktrin wie beim Recycling und beim
   * Navigations-Zähler (docs §5.4): `null`/`false` heißt „nicht ermittelbar",
   * NICHT „nichts zu tun".
   *
   * Ohne dieses Flag fielen vier der fünf Quellen still aus und das Board
   * zeigte den grünen Leerzustand „Alles nachgefasst" — der Mitarbeiter hätte
   * Follow-ups, Rückrufe und Wiedervorlagen und ginge davon aus, dass keine
   * da sind. Der Zähler in der Seitenleiste verschwindet in genau dieser Lage
   * korrekt; die Seite widersprach ihm.
   */
  tasksAvailable: boolean;
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
    persönlichen Vorlage und wird sonst in einer eigenen Runde nachgeladen.
    `created_at` kommt mit, weil der Pitch-Tag app-weit
    `coalesce(pitched_at, created_at::date)` ist (docs §1) — ohne die Spalte
    ließe sich für eine Zeile ohne `pitched_at` gar keine Aussage über ihr
    Alter treffen. */
type ContactRow = {
  id: string;
  list_id: string;
  pitched_at: string | null;
  created_at: string | null;
  lists: unknown;
};

type ListTexts = { fu1_text: string | null; fu2_text: string | null; fu3_text: string | null };

type LeadRow = { id: string; list_id: string; phone: string | null };

/**
 * Der Anlass einer Erstgespräch-Wiedervorlage. Fail-soft wie jeder Nachschlag:
 * fehlt `disqualify_reason_code` (Migration 0032), weist PostgREST die ganze
 * Abfrage ab, `selectByIds` protokolliert das und liefert nichts — die Karte
 * steht dann ohne Anlass-Badge da, statt dass die Seite ausfällt.
 */
type SettingReasonRow = {
  id: string;
  status: SettingStatus | null;
  disqualify_reason_code: string | null;
};

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
  if (!access) {
    return {
      tasks: [],
      hiddenOlder: 0,
      unreadableContacts: 0,
      recyclingAvailable: true,
      tasksAvailable: true,
    };
  }
  const supabase = await createClient();

  // IMMER personenbezogen: der eingeloggte Nutzer (bzw. die aktive Admin-Datensicht).
  const scopeUserId = access.effective_user_id ?? access.user.id;
  const today = localDateISO();

  /* ── Welle 1: beide RPCs parallel ──────────────────────────────────
     Sie hängen nicht voneinander ab. Vorher lief das Recycling erst los,
     wenn die Union-RPC samt aller ihrer Nachschläge fertig war. Ein Fehler
     der Union-RPC beendet die Funktion außerdem nicht mehr: das Recycling
     hat damit gar nichts zu tun und bleibt sichtbar.                    */
  // Der Ausfall muss die Oberfläche erreichen. Eine leere Liste allein ist
  // nicht unterscheidbar von „heute ist nichts fällig" — und genau diese
  // Verwechslung ist auf dieser Seite die teuerste: Sie sieht aus wie
  // Feierabend.
  let tasksAvailable = true;
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
      tasksAvailable = false;
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
  // Der Anlass gilt nur für den Setting-ZWEIG der Union-RPC. Ein Erstgespräch,
  // das über das Recycling hereinkommt, trägt seinen Grund bereits im
  // Recycling-Badge — zweimal dieselbe Auskunft auf einer 300-px-Karte.
  const settingIds = [...new Set(rows.filter((r) => r.source === "setting").map((r) => r.entity_id))];
  // Absender ist die ZUSTÄNDIGE Person der Aufgabe, nicht der Betrachter — ein
  // Owner in der Team-Sicht bekäme sonst seine eigenen Texte unter fremdem
  // Namen. Die vier Zweige der Union-RPC tragen keine Zuweisung; dort gilt die
  // aktive Datensicht.
  const senderIds = [
    ...new Set([scopeUserId, ...recycle.tasks.map((r) => r.assigned_user_id ?? scopeUserId)]),
  ];
  // EIN Zeitpunkt für Ladefenster und Auswertung: liefe die Uhr zwischen beiden
  // weiter, könnte ein Kontakt geladen und danach anders beurteilt werden als
  // der daneben.
  const nowIso = new Date().toISOString();
  // Ladefenster, nicht die Schwelle selbst: gefiltert wird gleich exakt über
  // `isWithinContactGap` (Berliner Kalendertage), siehe lib/contactGap.ts.
  const contactSince = contactGapWindowStart(nowIso);

  const [contactRows, leadRows, settingReasonRows, bundles, touchContacts] = await Promise.all([
    selectByIds<ContactRow>(contactIds, (chunk) =>
      supabase
        .from("contacts")
        .select("id, list_id, pitched_at, created_at, lists(fu1_text, fu2_text, fu3_text)")
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
    selectByIds<SettingReasonRow>(settingIds, (chunk) =>
      supabase
        .from("setting_calls")
        .select("id, status, disqualify_reason_code")
        .eq("workspace_id", access.workspace_id)
        .in("id", chunk),
    ),
    getTemplateBundles(senderIds),
    loadRecentContacts(supabase, access.workspace_id, contactSince),
  ]);

  const contactInfo = new Map<string, { list_id: string; pitchDay: string | null; fuTexts: (string | null)[] }>();
  for (const c of contactRows) {
    const l = embeddedRow<ListTexts>(c.lists);
    contactInfo.set(c.id, {
      list_id: c.list_id,
      // Der Pitch-Tag ist app-weit `coalesce(pitched_at, created_at::date)`
      // (docs §1, so rechnen auch die RPCs). `berlinDateISO` statt eines
      // rohen `slice(0,10)`, weil `created_at` timestamptz ist und die
      // Tageszuordnung überall am Berliner Kalendertag hängt (docs §6).
      pitchDay: c.pitched_at ?? (berlinDateISO(c.created_at) || null),
      fuTexts: [l?.fu1_text ?? null, l?.fu2_text ?? null, l?.fu3_text ?? null],
    });
  }
  const leadInfo = new Map<string, LeadRow>();
  for (const l of leadRows) leadInfo.set(l.id, l);
  const settingReason = new Map<string, SettingReasonRow>();
  for (const s of settingReasonRows) settingReason.set(s.id, s);

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
      // Dieselbe Auswertung wie im Board und dieselbe Körnung wie die
      // Beschriftung („vor 2 Tagen") — eine Karte, die warnt, muss ihre eigene
      // Zahl erklären können.
      if (!isWithinContactGap(ev.at, nowIso)) continue;
      if (!latest || ev.at > latest) latest = ev.at;
    }
    return latest;
  }

  const bundleFor = (userId: string): TemplateBundle | undefined => bundles.get(userId);

  // Cutoff: nur Leads der letzten 7 Tage nachfassen (Bestandsdaten bleiben unangetastet,
  // ältere sind über includeOlder erreichbar).
  const cutoff = addDaysISO(today, -7);
  let hiddenOlder = 0;
  let unreadableContacts = 0;

  const tasks: NachfassenTask[] = [];
  for (const r of rows) {
    let list_id: string | null = null;
    let phone: string | null = null;
    let rendered: { body: string; source: TemplateSource };

    if (r.source === "linkedin") {
      const info = contactInfo.get(r.entity_id);
      list_id = info?.list_id ?? null;
      if (info) {
        // Das Pitch-Datum liegt belegt vor — erst jetzt darf der 7-Tage-Schnitt
        // greifen, und erst jetzt stimmt der Satz „Pitch > 7 Tage".
        //
        // Ein FEHLENDES Pitch-Datum ist dabei kein altes Datum: Die Spalte ist
        // nullable, und der Pitch-Tag fällt dann auf `created_at` zurück (docs
        // §1). Vorher zählte die leere Spalte die Zeile nach `hiddenOlder` und
        // blendete sie unter „ältere Leads (Pitch > 7 Tage)" aus — eine
        // Aussage, die für sie genauso unbelegt ist wie die frühere für die
        // nicht lesbaren Kontakte im else-Zweig. Derselbe Denkfehler, nur
        // leiser: Wer die Zahl nachrechnet, findet die Differenz nicht.
        //
        // Bleibt auch nach dem Rückfall kein Tag übrig, wird NICHT
        // ausgeblendet — fällig ist fällig, und über das Alter behauptet die
        // Seite dann eben nichts.
        if (!options?.includeOlder && info.pitchDay !== null && info.pitchDay < cutoff) {
          hiddenOlder++;
          continue;
        }
      } else {
        // Die RPC kennt die Zeile, der Nachschlag sieht sie nicht. Das ist kein
        // Fehler, sondern das von docs §2 ausdrücklich unterstützte Muster:
        // Liste mit `owner_name = Mitglied`, `created_by = Admin`, Datensicht
        // `own` — `nachfassen_tasks` filtert über `list_owned_by_user()`
        // (owner_name hat Vorrang), die RLS auf `contacts` nicht.
        //
        // Früher fiel diese Aufgabe hier still in `hiddenOlder` und stand damit
        // unter „ältere Leads (Pitch > 7 Tage) ausgeblendet" — einer Erklärung,
        // die schlicht falsch ist: Der Pitch kann von gestern sein. Sie wird
        // deshalb AUSGELIEFERT (fällig ist fällig) und getrennt gezählt, damit
        // die Oberfläche den Unterschied benennen kann.
        unreadableContacts++;
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

    const anlass = r.source === "setting" ? settingReason.get(r.entity_id) : undefined;
    tasks.push({
      ...r,
      list_id,
      phone,
      prepared_text: rendered.body,
      text_source: rendered.source,
      recent_contact_at: recentContactFor(r),
      setting_status: anlass?.status ?? null,
      setting_disqualify_reason: anlass?.disqualify_reason_code ?? null,
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

  return {
    tasks,
    hiddenOlder,
    unreadableContacts,
    recyclingAvailable: recycle.available,
    tasksAvailable,
  };
}

/* ------------------------------------------------------------------ *
 * Rückgängig
 * ------------------------------------------------------------------ */

/**
 * Warum es das gibt: Auf diesem Board liegt „Beantwortet" wenige Pixel neben
 * „Erledigt → nächste Stufe", und ein Fehlgriff setzte `answered = true` sowie
 * `next_follow_up_at = null` — der Kontakt fiel DAUERHAFT aus dem
 * Follow-up-Fluss, ohne dass die Oberfläche einen Weg zurück angeboten hätte.
 * Auf `/erinnerungen` kann derselbe Nutzer längst jede Stufe einzeln
 * zurücknehmen; zwei Boards, dieselbe Arbeit, gegensätzliche Zusagen.
 *
 * Zurückgeschrieben werden AUSSCHLIESSLICH die Spalten, die die jeweilige
 * Aktion vorher überschrieben hat — mit den Werten, die dort standen. Kein
 * Nachrechnen, kein Raten: Wo eine Aktion einen Wert vernichtet hat, den
 * niemand mehr kennt, gibt es hier keinen Eintrag und im Board keinen Knopf
 * („Endgültig raus" ist genau dieser Fall und sagt es im Bestätigungsdialog).
 */
export type UndoKind =
  | "linkedin_stufe"
  | "linkedin_antwort"
  | "telefon_rueckruf"
  | "setting_wiedervorlage"
  | "closing_wiedervorlage"
  | "recycling_versuch"
  | "recycling_reaktion";

/** Zellwerte, wie PostgREST sie liefert — nichts Verschachteltes. */
export type UndoValue = string | number | boolean | null;

export type NachfassenUndo = {
  kind: UndoKind;
  entity_id: string;
  /** Nur bei den beiden Recycling-Arten: welche der vier Ursprungstabellen. */
  origin?: RecycleOrigin;
  /** Vorherige Werte GENAU der Spalten, die die Aktion angefasst hat. */
  values: Record<string, UndoValue>;
};

export type NachfassenActionResult = { error?: string; undo?: NachfassenUndo };

/**
 * Tabelle UND erlaubte Spalten je Art — beides serverseitig, nie aus dem Token.
 *
 * Server Actions sind per direktem POST erreichbar. Käme die Spaltenliste vom
 * Aufrufer, wäre `undoNachfassenTask` ein beliebiges UPDATE auf vier Tabellen;
 * so ist es die Rücknahme genau einer bekannten Aktion.
 */
const UNDO_COLUMNS: Record<UndoKind, readonly string[]> = {
  linkedin_stufe: ["follow_up_number", "next_follow_up_at", "next_recycle_at", "recycle_reason_code"],
  linkedin_antwort: ["answered", "next_follow_up_at"],
  telefon_rueckruf: ["callback_at"],
  setting_wiedervorlage: ["follow_up_due"],
  closing_wiedervorlage: ["follow_up_due", "follow_up_due_at"],
  recycling_versuch: ["recycle_attempt_count", "recycle_last_contacted_at", "next_recycle_at", "recycle_reason_code"],
  recycling_reaktion: ["next_recycle_at", "recycle_responded_at"],
};

/** null = die Tabelle steht im `origin` des Tokens (Recycling deckt alle vier ab). */
const UNDO_TABLE: Record<UndoKind, string | null> = {
  linkedin_stufe: "contacts",
  linkedin_antwort: "contacts",
  telefon_rueckruf: "phone_leads",
  setting_wiedervorlage: "setting_calls",
  closing_wiedervorlage: "closing_calls",
  recycling_versuch: null,
  recycling_reaktion: null,
};

const TABLE_BY_ORIGIN: Record<RecycleOrigin, string> = {
  linkedin: "contacts",
  telefon: "phone_leads",
  setting: "setting_calls",
  closing: "closing_calls",
};

/**
 * Vorherige Werte einer Zeile lesen — die Grundlage jedes Rückgängig.
 *
 * Der Select steht bei jedem Aufrufer als LITERAL da und nicht als
 * zusammengesetzter String: supabase-js leitet den Zeilentyp aus dem Literal
 * ab, eine Konkatenation kippt die Inferenz auf `GenericStringError` (dieselbe
 * Falle wie in closing/[callId]/page.tsx).
 *
 * `null` heißt „nicht gelesen", nicht „leer" — die betroffenen Spalten bleiben
 * dann aus dem Token heraus und werden folglich auch nicht zurückgeschrieben.
 */
function snapshotOf(row: unknown, columns: readonly string[]): Record<string, UndoValue> {
  const source = (row ?? {}) as Record<string, unknown>;
  const out: Record<string, UndoValue> = {};
  for (const c of columns) {
    const v = source[c];
    if (v === undefined) continue;
    out[c] = (v ?? null) as UndoValue;
  }
  return out;
}

/**
 * Eine Aktion zurücknehmen.
 *
 * Zugriffsprüfung wie bei allen Nachbarn dieser Datei: die Zeile wird über den
 * NUTZER-Client gelesen (läuft also durch die Zeilensicherheit) UND gegen die
 * aktive Organisation gefiltert — für einen Plattform-Admin lässt RLS sonst
 * jede Zeile der Plattform durch.
 */
export async function undoNachfassenTask(undo: NachfassenUndo): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };

  const kind = undo?.kind;
  const columns = kind ? UNDO_COLUMNS[kind] : undefined;
  if (!columns || typeof undo.entity_id !== "string" || !undo.entity_id) return { error: "Nicht gefunden." };
  const table = UNDO_TABLE[kind] ?? (undo.origin ? TABLE_BY_ORIGIN[undo.origin] : null);
  if (!table) return { error: "Nicht gefunden." };

  // Nur die Spalten dieser Art, und nur einfache Werte: alles andere wäre kein
  // zurückgelesener Zellwert, sondern etwas Untergeschobenes.
  const patch: Record<string, UndoValue> = {};
  for (const col of columns) {
    if (!undo.values || !(col in undo.values)) continue;
    const v = undo.values[col];
    if (v !== null && typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
      return { error: "Nicht gefunden." };
    }
    patch[col] = v;
  }
  if (Object.keys(patch).length === 0) return {};

  const supabase = await createClient();
  const { data: row } = await supabase
    .from(table)
    .select("id")
    .eq("id", undo.entity_id)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();
  if (!row) return { error: "Nicht gefunden." };

  // Das Closing geht bewusst NICHT den direkten Weg: `follow_up_due_at` speist
  // die Kaskade `followup_msg` (docs §1, eine der genau zwei Überschneidungen
  // mit /erinnerungen). Ein rohes UPDATE ließe dort die Erinnerungen zum
  // verschobenen Zeitpunkt stehen — der Text ginge real zum falschen Termin
  // raus. `updateClosingCall` entwertet sie und baut sie neu auf.
  if (kind === "closing_wiedervorlage") {
    const res = await updateClosingCall(undo.entity_id, {
      follow_up_due_at: (patch.follow_up_due_at ?? null) as string | null,
    });
    if (res.error) return res;
    // `updateClosingCall` LEITET `follow_up_due` aus `follow_up_due_at` ab.
    // Eine Bestandszeile trägt aber womöglich nur das Tagesdatum —
    // `follow_up_due_at` gibt es erst seit Migration 0032, und
    // `nachfassen_tasks` liest weiterhin `follow_up_due` (docs §5). Ohne
    // dieses wörtliche Zurückschreiben stünde dort danach NULL: Das Closing
    // fiele lautlos ganz aus der Wiedervorlage — ausgerechnet durch einen
    // Klick, der nur etwas zurücknehmen sollte.
    if ("follow_up_due" in patch) {
      const { error: dayError } = await supabase
        .from("closing_calls")
        .update({ follow_up_due: patch.follow_up_due })
        .eq("id", undo.entity_id)
        .eq("workspace_id", access.workspace_id);
      if (dayError) return { error: dayError.message };
    }
    revalidatePath("/nachfassen", "page");
    return {};
  }

  const { error } = await supabase
    .from(table)
    .update(patch)
    .eq("id", undo.entity_id)
    .eq("workspace_id", access.workspace_id);
  if (error) return { error: error.message };

  revalidatePath("/nachfassen", "page");
  revalidatePath("/erinnerungen", "page");
  revalidatePath("/", "layout");
  return {};
}

/** LinkedIn-Lead als beantwortet markieren → raus aus dem Follow-up-Flow. */
export async function markLinkedInAnswered(contactId: string): Promise<NachfassenActionResult> {
  // Ohne Org-Filter waere dies fuer einen Plattform-Admin ein Schreibzugriff
  // auf JEDEN Kontakt der Plattform — RLS laesst dort alles durch.
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  const supabase = await createClient();
  // Die beiden Spalten, die gleich überschrieben werden, kommen im selben
  // Select mit — der Zustand VOR dem Schreiben ist danach nicht mehr lesbar.
  const { data: c } = await supabase
    .from("contacts")
    .select("id, list_id, answered, next_follow_up_at")
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
  revalidatePath(`/lists/${(c as { list_id: string }).list_id}`, "page");
  revalidatePath("/", "layout");
  return {
    undo: {
      kind: "linkedin_antwort",
      entity_id: contactId,
      values: snapshotOf(c, UNDO_COLUMNS.linkedin_antwort),
    },
  };
}

/**
 * LinkedIn-Follow-up erledigt: Stufe hochzählen und die nächste Wiedervorlage
 * setzen (nach FU1 +5, nach FU2 +7, nach FU3 keine mehr — der Flow endet).
 */
export async function advanceLinkedInFollowUp(contactId: string): Promise<NachfassenActionResult> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  const supabase = await createClient();
  const { data: c } = await supabase
    .from("contacts")
    .select("id, list_id, follow_up_number, next_follow_up_at")
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

  const values = snapshotOf(c, ["follow_up_number", "next_follow_up_at"]);

  // FU3 erledigt, ohne dass je geantwortet wurde: der Flow endet hier für
  // immer (nextDate === null) — eines der vier "toten Enden" (§ Konzept-
  // Diskussion). Statt spurlos zu verschwinden, bekommt der Kontakt ein
  // Recycling-Datum. Ohne Grund-Argument: Grund und Status liest
  // `schedule_recycle()` selbst aus der Zeile.
  if (nextDate === null && done >= FU_MAX_STAGE) {
    // Erst lesen, dann planen — sonst steht im Rückgängig schon das Datum, das
    // dieser Klick gerade gesetzt hat. Die beiden Spalten hängen an Migration
    // 0033; fehlt sie, weist PostgREST die Abfrage ab, und der Snapshot bleibt
    // ohne sie: Es gibt dann auch nichts einzuplanen, also nichts zurückzunehmen.
    const { data: r } = await supabase
      .from("contacts")
      .select("next_recycle_at, recycle_reason_code")
      .eq("id", contactId)
      .eq("workspace_id", access.workspace_id)
      .maybeSingle();
    Object.assign(values, snapshotOf(r, ["next_recycle_at", "recycle_reason_code"]));
    await scheduleRecycle("linkedin", contactId);
  }
  revalidatePath("/nachfassen", "page");
  revalidatePath(`/lists/${(c as { list_id: string }).list_id}`, "page");
  revalidatePath("/", "layout");
  return { undo: { kind: "linkedin_stufe", entity_id: contactId, values } };
}

/* ------------------------------------------------------------------ *
 * Vom Tisch nehmen, ohne die Seite zu verlassen
 * ------------------------------------------------------------------ *
 *
 * Drei der fünf Sektionen hatten bis hierher nur Links: Telefon-Rückruf,
 * Erstgespräch- und Closing-Wiedervorlage verschwanden erst, wenn jemand auf
 * der ZIELSEITE eine neue Wiedervorlage setzte. Wer den Kontakt gerade
 * erledigt hatte, ließ die Karte stehen — und fand sie am nächsten Morgen
 * wieder, überfällig.
 *
 * Die Links bleiben daneben bestehen: Wer das Gespräch führen will, braucht
 * die Detailseite weiterhin.
 */

/** Um wie viel eine Tages-Wiedervorlage vorgeschoben wird. */
const FOLLOW_UP_PUSH_DAYS = 7;

/**
 * Erstgespräch- oder Closing-Wiedervorlage um eine Woche vorschieben.
 *
 * Anker ist HEUTE, nicht das alte Fälligkeitsdatum — dieselbe Begründung wie
 * bei `advanceLinkedInFollowUp`: Bei einer überfälligen Aufgabe läge das neue
 * Datum sonst wieder in der Vergangenheit, und die Karte stünde morgen
 * unverändert da.
 *
 * Beide Quellen tragen ein TAGESDATUM (`follow_up_due`, `DUE_GRANULARITY:
 * day`) — anders als der Telefon-Rückruf, der eine mit dem Lead verabredete
 * Uhrzeit trägt und deshalb kein festes Intervall bekommt.
 *
 * Geschrieben wird über die bestehenden Actions der beiden Detailseiten, nicht
 * per rohem UPDATE: `updateClosingCall` hält `follow_up_due` synchron zu
 * `follow_up_due_at` und baut die Kaskade `followup_msg` neu auf. Ein rohes
 * UPDATE ließe die Erinnerungen auf dem alten Zeitpunkt stehen.
 */
export async function pushFollowUpDue(
  entity: "setting" | "closing",
  id: string,
): Promise<NachfassenActionResult> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (entity !== "setting" && entity !== "closing") return { error: "Nicht gefunden." };
  if (typeof id !== "string" || !id) return { error: "Nicht gefunden." };

  const supabase = await createClient();
  const nextDay = addDaysISO(localDateISO(), FOLLOW_UP_PUSH_DAYS);

  if (entity === "setting") {
    const { data: row } = await supabase
      .from("setting_calls")
      .select("id, follow_up_due")
      .eq("id", id)
      .eq("workspace_id", access.workspace_id)
      .maybeSingle();
    if (!row) return { error: "Nicht gefunden." };
    const res = await updateSettingCall(id, { follow_up_due: nextDay });
    if (res.error) return res;
    revalidatePath("/nachfassen", "page");
    return {
      undo: {
        kind: "setting_wiedervorlage",
        entity_id: id,
        values: snapshotOf(row, UNDO_COLUMNS.setting_wiedervorlage),
      },
    };
  }

  const { data: row } = await supabase
    .from("closing_calls")
    .select("id, follow_up_due, follow_up_due_at")
    .eq("id", id)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();
  if (!row) return { error: "Nicht gefunden." };
  const previous = row as { follow_up_due_at: string | null };
  // Die UHRZEIT des vereinbarten Nachfass-Kontakts bleibt stehen und nur der
  // Tag wandert: „nächste Woche um zehn" ist eine Verabredung, „nächste Woche
  // um 00:00" wäre eine erfundene. Ohne Vorgänger (Bestandszeilen ohne
  // `follow_up_due_at`) bleibt es bei einem ruhigen Vormittagstermin.
  const time = previous.follow_up_due_at ? isoToBerlinInput(previous.follow_up_due_at).slice(11, 16) : "09:00";
  const res = await updateClosingCall(id, { follow_up_due_at: berlinInputToIso(`${nextDay}T${time}`) });
  if (res.error) return res;
  revalidatePath("/nachfassen", "page");
  return {
    undo: {
      kind: "closing_wiedervorlage",
      entity_id: id,
      values: snapshotOf(row, UNDO_COLUMNS.closing_wiedervorlage),
    },
  };
}

/**
 * Telefon-Rückruf auf einen neuen Zeitpunkt verschieben.
 *
 * `callback_at` ist der einzige Fälligkeitswert dieses Boards mit einer MIT DEM
 * LEAD VERABREDETEN Uhrzeit (`DUE_GRANULARITY: moment`, docs §1). Ein festes
 * „+7 Tage" wie bei den beiden Wiedervorlagen wäre hier fachlich falsch, und
 * eine automatisch gesetzte Uhrzeit wäre keine Angabe, sondern eine Behauptung
 * — deshalb kommt der Zeitpunkt aus dem Feld auf der Karte.
 *
 * KEIN Anruf-Protokoll: `phone_call_attempts` zählt Wählversuche (docs §3), und
 * hier hat niemand gewählt. Der Weg für ein echtes Gespräch bleibt der
 * Call-Modus hinter „Anrufen".
 */
export async function pushPhoneCallback(leadId: string, berlinInput: string): Promise<NachfassenActionResult> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (typeof leadId !== "string" || !leadId) return { error: "Nicht gefunden." };
  const iso = berlinInputToIso(berlinInput);
  if (!iso) return { error: "Bitte Datum und Uhrzeit für den Rückruf angeben." };

  const supabase = await createClient();
  const { data: lead } = await supabase
    .from("phone_leads")
    .select("id, list_id, callback_at")
    .eq("id", leadId)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();
  if (!lead) return { error: "Nicht gefunden." };

  const { error } = await supabase
    .from("phone_leads")
    .update({ callback_at: iso })
    .eq("id", leadId)
    .eq("workspace_id", access.workspace_id);
  if (error) return { error: error.message };

  revalidatePath("/nachfassen", "page");
  revalidatePath(`/telefon/${(lead as { list_id: string }).list_id}`, "page");
  revalidatePath("/", "layout");
  return {
    undo: {
      kind: "telefon_rueckruf",
      entity_id: leadId,
      values: snapshotOf(lead, UNDO_COLUMNS.telefon_rueckruf),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Recycling — dieselben Aktionen, nur mit Rückweg
 * ------------------------------------------------------------------ *
 *
 * Die beiden Knöpfe schreiben weiterhin ausschließlich über actions/recycle.ts
 * (dort sitzen Besitzprüfung, Deckel und die beiden RPCs). Hier kommt nur der
 * Blick auf die Zeile DAVOR dazu — `recycle_attempt()` und `schedule_recycle()`
 * überschreiben ihn, und „Nochmal versucht" verbrennt dabei einen von
 * standardmäßig zwei erlaubten Versuchen.
 */

/** Die vier Spalten, die `recycle_attempt()` + `schedule_recycle()` zusammen anfassen. */
async function recycleSnapshot(
  workspaceId: string,
  origin: RecycleOrigin,
  entityId: string,
  columns: readonly string[],
): Promise<Record<string, UndoValue>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from(TABLE_BY_ORIGIN[origin])
    .select("recycle_attempt_count, recycle_last_contacted_at, recycle_responded_at, next_recycle_at, recycle_reason_code")
    .eq("id", entityId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return snapshotOf(data, columns);
}

/** „Nochmal versucht" — mit Rückweg (der Versuchszähler ist gedeckelt). */
export async function recycleContactedUndoable(
  origin: RecycleOrigin,
  entityId: string,
): Promise<NachfassenActionResult> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (!TABLE_BY_ORIGIN[origin]) return { error: "Nicht gefunden." };
  const values = await recycleSnapshot(access.workspace_id, origin, entityId, UNDO_COLUMNS.recycling_versuch);
  const res = await markRecycleContacted(origin, entityId);
  if (res.error) return { error: res.error };
  return { undo: { kind: "recycling_versuch", entity_id: entityId, origin, values } };
}

/** „Reagiert" — mit Rückweg. */
export async function recycleRespondedUndoable(
  origin: RecycleOrigin,
  entityId: string,
): Promise<NachfassenActionResult> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (!TABLE_BY_ORIGIN[origin]) return { error: "Nicht gefunden." };
  const values = await recycleSnapshot(access.workspace_id, origin, entityId, UNDO_COLUMNS.recycling_reaktion);
  const res = await markRecycleResponded(origin, entityId);
  if (res.error) return { error: res.error };
  return { undo: { kind: "recycling_reaktion", entity_id: entityId, origin, values } };
}
