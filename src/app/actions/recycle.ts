"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext, type AccessContext } from "@/lib/access";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { berlinDateISO } from "@/lib/apptTime";
import type { RecycleOrigin } from "@/lib/recycleCadence";

// Lead-Recycling: Wiedervorlage für terminal negative Leads (Closing verloren,
// Telefon-/Setting-Lead dead, LinkedIn-Nachfasssequenz ohne Antwort zu Ende) —
// die vier Stellen, an denen ein Lead sonst spurlos verschwindet.
//
// Diese Datei RECHNET nichts mehr. Wartezeit, Grund und Versuchsdeckel liegen
// seit Migration 0033 in der Datenbank, aus zwei Gründen:
//
//  1. Der Grund kam vorher vom Client. Server Actions sind per direktem POST
//     erreichbar — damit ließ sich jede beliebige Wartezeit auslösen.
//     `schedule_recycle()` liest Grund UND Status aus der Ursprungszeile und
//     verweigert bei ausgeschlossenen oder wiederbelebten Leads.
//  2. Der Versuchszähler wurde gelesen, gerechnet und zurückgeschrieben. Zwei
//     parallele Klicks auf „Nochmal versucht" verbrannten zwei von zwei
//     erlaubten Versuchen. `recycle_attempt()` erhöht ihn in EINER Anweisung,
//     und der `max_attempts`-Deckel sitzt in derselben Anweisung.
//
// Die Konfiguration (Wartezeiten, `max_attempts`) steht seit 0032 zusammen mit
// der Kaskade in `pipeline_settings`; gelesen und geschrieben wird sie über
// `getPipelineSettings()` / `updatePipelineSettings()` in actions/reminders.ts.
// Hier gibt es bewusst kein zweites Settings-Paar mehr.
//
// Das Einplanen bleibt FAIL-SOFT (Muster Erinnerungs-Kaskade): ein
// fehlgeschlagener Recycling-Eintrag darf nie das Setzen des Outcomes
// blockieren. Die Aktionen aus dem Board melden dagegen sichtbar zurück — dort
// wartet jemand auf eine Reaktion.

/* ------------------------------------------------------------------ *
 * Verfügbarkeits-Probe
 * ------------------------------------------------------------------ */

/**
 * Fehlt das Schema (Migration 0033 nicht eingespielt), muss das von „nichts
 * fällig" unterscheidbar sein — sonst zeigt `/nachfassen` in beiden Fällen
 * denselben grünen Leerzustand. Muster `loadCallAttempts`
 * (src/lib/phoneAttemptsData.ts).
 *
 * Geprüft wird der Fehlercode bzw. der Meldungstext, NICHT die leere
 * Ergebnismenge: eine fehlende Funktion meldet 42883/PGRST202, eine fehlende
 * Spalte oder Relation 42P01/42703/PGRST204/PGRST205 — nichts davon sieht wie
 * ein leeres Ergebnis aus. Bewusst neben demselben Prädikat in reminders.ts,
 * solange es die gemeinsame `schemaProbe.ts` noch nicht gibt.
 */
function isMissingSchema(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code && ["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(e.code)) return true;
  const msg = (e?.message ?? (err instanceof Error ? err.message : "")).toLowerCase();
  return /does not exist|could not find|schema cache/.test(msg);
}

const TABLE_BY_ORIGIN: Record<RecycleOrigin, string> = {
  linkedin: "contacts",
  telefon: "phone_leads",
  setting: "setting_calls",
  closing: "closing_calls",
};

/** Heute als BERLINER Kalendertag — auf Vercel läuft der Server in UTC, ein
    `new Date()` läge dort abends einen Tag daneben (docs §6). */
function todayBerlin(): string {
  return berlinDateISO(new Date().toISOString());
}

/* ------------------------------------------------------------------ *
 * Einplanen und Zurücknehmen
 * ------------------------------------------------------------------ */

/**
 * Recycling für einen frisch terminal gewordenen Lead einplanen.
 *
 * Aufrufer: `setClosingOutcome('verloren')`, `setSettingOutcome('dead')`,
 * `setPhoneLeadOutcome('dead')`, `advanceLinkedInFollowUp` (FU3 ohne Antwort).
 * Ohne Grund-Parameter — den liest die RPC selbst aus der Zeile.
 *
 * `p_today` wird bewusst NICHT mitgeschickt: die Funktion setzt den Berliner
 * Kalendertag selbst ein. Ein Datum als Parameter wäre über einen direkten
 * POST frei wählbar und damit eine zweite Wahrheit neben der Serveruhr.
 */
export async function scheduleRecycle(origin: RecycleOrigin, entityId: string): Promise<void> {
  try {
    const access = await getAccessContext();
    if (!access) return;
    const supabase = await createClient();
    const { error } = await supabase.rpc("schedule_recycle", {
      p_workspace_id: access.workspace_id,
      p_origin: origin,
      p_entity_id: entityId,
    });
    if (error) console.error("[scheduleRecycle]", error.message);
  } catch (e) {
    console.error("[scheduleRecycle]", e instanceof Error ? e.message : e);
  }
}

async function canAccessRecycleRow(
  access: AccessContext,
  origin: RecycleOrigin,
  entityId: string,
): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from(TABLE_BY_ORIGIN[origin])
    .select("id")
    .eq("id", entityId)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();
  return Boolean(data);
}

/** Gemeinsamer Rumpf der drei Board-Aktionen — immer mit `workspace_id` im
    UPDATE, nicht nur in der Vorprüfung davor. */
async function updateRecycleRow(
  origin: RecycleOrigin,
  entityId: string,
  patch: Record<string, string | null>,
): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (!(await canAccessRecycleRow(access, origin, entityId))) return { error: "Nicht gefunden." };

  const supabase = await createClient();
  const { error } = await supabase
    .from(TABLE_BY_ORIGIN[origin])
    .update(patch)
    .eq("id", entityId)
    .eq("workspace_id", access.workspace_id);
  if (error) {
    return {
      error: isMissingSchema(error) ? "Recycling ist nicht verfügbar — Migration 0033 fehlt." : error.message,
    };
  }
  revalidatePath("/nachfassen");
  return {};
}

/**
 * „Nochmal versucht, kein Ergebnis" — Versuchszähler hoch, Kontaktzeitpunkt
 * festhalten. Beides erledigt `recycle_attempt()` in einer Anweisung; reicht
 * der Versuch an `max_attempts`, nullt dieselbe Anweisung die Wiedervorlage.
 * Der Deckel steht damit in der Datenbank statt im App-Code, wo ihn zwei
 * gleichzeitige Klicks aushebeln konnten.
 */
export async function markRecycleContacted(
  origin: RecycleOrigin,
  entityId: string,
): Promise<{ error?: string; attemptCount?: number }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (!(await canAccessRecycleRow(access, origin, entityId))) return { error: "Nicht gefunden." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recycle_attempt", {
    p_workspace_id: access.workspace_id,
    p_origin: origin,
    p_entity_id: entityId,
  });
  if (error) {
    return {
      error: isMissingSchema(error) ? "Recycling ist nicht verfügbar — Migration 0033 fehlt." : error.message,
    };
  }
  revalidatePath("/nachfassen");
  return { attemptCount: typeof data === "number" ? data : undefined };
}

/**
 * „Reagiert" — Recycling stoppen, ohne den Lead auszuschließen (er ist ja
 * wieder im Spiel). `recycle_responded_at` ist dabei nicht nur ein Riegel
 * gegen das Wiederauftauchen in `recycle_tasks`, sondern die einzige Grundlage
 * für eine Wiederbelebungsquote — ohne sie ließe sich nie begründen, ob eine
 * Wartezeit zu kurz oder zu lang ist.
 */
export async function markRecycleResponded(origin: RecycleOrigin, entityId: string): Promise<{ error?: string }> {
  return updateRecycleRow(origin, entityId, {
    next_recycle_at: null,
    recycle_responded_at: new Date().toISOString(),
  });
}

/**
 * Recycling zurücknehmen, weil der Lead auf ANDEREM Weg wieder im Funnel ist
 * (neuer Termin, Ersatztermin, gewonnener Deal). Für die Wiederbelebungspfade
 * in appointments.ts/settingCalls.ts — ohne diesen Aufruf taucht ein längst
 * gewonnener Deal Monate später als Aufgabe auf.
 *
 * Bewusst ohne `recycle_attempt_count`-Reset: die Zahl der bisherigen Versuche
 * ist Historie, kein Zustand.
 */
export async function clearRecycle(origin: RecycleOrigin, entityId: string): Promise<{ error?: string }> {
  return updateRecycleRow(origin, entityId, { next_recycle_at: null, recycle_reason_code: null });
}

/**
 * „Endgültig raus" — permanentes Opt-out, unabhängig von `blocked_at` (das
 * kennt nur LinkedIn). `next_recycle_at` muss dabei mitgenullt werden: seit
 * 0033 erzwingt ein CHECK, dass „endgültig raus" und „noch im Rennen" sich
 * ausschließen.
 */
export async function excludeFromRecycle(origin: RecycleOrigin, entityId: string): Promise<{ error?: string }> {
  return updateRecycleRow(origin, entityId, {
    next_recycle_at: null,
    recycle_excluded_at: new Date().toISOString(),
  });
}

/* ------------------------------------------------------------------ *
 * Fällige Wiedervorlagen
 * ------------------------------------------------------------------ */

export type RecycleTaskRaw = {
  origin: RecycleOrigin;
  entity_id: string;
  owner_name: string | null;
  lead_name: string | null;
  company: string | null;
  due_at: string | null;
  /** `lost_reason_code` bzw. `disqualify_reason_code`, sonst 'dead'/'fu_exhausted'. */
  reason: string | null;
  /** Freitext daneben — Code ist Statistik, Freitext ist Gedächtnis. */
  reason_note: string | null;
  attempt_count: number;
  assigned_user_id: string | null;
  last_contacted_at: string | null;
};

export type RecycleTasksResult = {
  tasks: RecycleTaskRaw[];
  /** false = Schema fehlt (Migration 0033). Nicht mit „nichts fällig" verwechseln. */
  available: boolean;
};

/**
 * Fällige Recycling-Versuche über alle vier Ursprünge (RPC `recycle_tasks`).
 *
 * Ohne Parameter: der Aufrufer schickt keinen `AccessContext` mehr mit. Als
 * Server Action ist die Funktion per direktem POST erreichbar — eine
 * mitgelieferte `workspace_id` hätte die RPC (security definer) ohne
 * Gegenprüfung übernommen.
 */
export async function loadRecycleTasks(): Promise<RecycleTasksResult> {
  const access = await getAccessContext();
  if (!access) return { tasks: [], available: false };

  const supabase = await createClient();
  const scopeUserId = access.effective_user_id ?? access.user.id;
  try {
    const tasks = await fetchAllRows<RecycleTaskRaw>((from, to) =>
      supabase
        .rpc("recycle_tasks", {
          p_workspace_id: access.workspace_id,
          p_today: todayBerlin(),
          p_effective_user_id: scopeUserId,
        })
        .range(from, to),
    );
    return { tasks, available: true };
  } catch (e) {
    const missing = isMissingSchema(e);
    if (!missing) console.error("recycle_tasks:", e instanceof Error ? e.message : e);
    return { tasks: [], available: !missing };
  }
}
