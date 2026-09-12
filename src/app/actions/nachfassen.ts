"use server";

import { revalidatePath } from "next/cache";
import { getAccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { loadRecycleTasks, markRecycleContacted, markRecycleResponded } from "@/app/actions/recycle";
import type { RecycleOrigin } from "@/lib/recycleCadence";

// /nachfassen nach dem Rückbau: NUR NOCH RECYCLING.
//
// WAS HIER WAR: eine Union aus fünf Quellen — LinkedIn-Follow-up,
// Telefon-Rückruf, Erstgespräch- und Closing-Wiedervorlage und Recycling —,
// jede Karte mit einem aus dem Vorlagen-Katalog gerenderten Text zum Kopieren.
//
// WAS DAVON GEBLIEBEN IST UND WARUM AUSGERECHNET DAS:
//
//  · Der LinkedIn-Follow-up ist schon vorher in das Listen-Board gewandert (die
//    Kadenz gehört an die Liste, wo auch Pitch-Text und FU-Sequenz stehen).
//  · Telefon-Rückruf, Setting- und Closing-Wiedervorlage sind Zeilen, die „in
//    der Luft liegen" — sie gehören in die eine Arbeitsliste, die der
//    Auftraggeber verlangt hat, und stehen künftig in der Terminliste. Wer
//    offen ist, wird jeden Tag kontaktiert; dafür braucht es keine zweite
//    Seite.
//  · Das RECYCLING ist etwas anderes, und deshalb bleibt es hier. Es ist kein
//    tägliches Nerven, sondern eine Wiedervorlage nach Wochen bis Monaten
//    (28–270 Tage, docs §5). Stünde ein Recycling-Lead in der täglichen Liste,
//    fiele er unter deren einzige Regel — „jeden Tag kontaktieren" —, und die
//    ist für ihn genau falsch.
//
// UND DER STRUKTURELLE GRUND, der die Frage überhaupt entscheidet: Das
// Recycling deckt VIER Ursprungstabellen ab (docs §1), darunter `contacts` und
// `phone_leads`. Diese beiden haben gar keinen Termin — sie können in einer
// Terminliste nicht vorkommen, egal wie man sie baut. Ein LinkedIn-Kontakt nach
// FU3 ohne Antwort und ein toter Telefon-Lead wären nach einem Umzug nirgends
// mehr erreichbar; das Listen-Board schließt genau sie aus seiner
// Nachfass-Ansicht aus (`follow_up_number !== 3`).
//
// WAS MIT DEN QUELLEN MITGEFALLEN IST: die Vorlagen-Auflösung samt Kopiertext
// (`renderResolved`, `getTemplateBundles`, `RECYCLE_TEMPLATE_KEY`), die
// Kanal-Ableitung und die Kontaktfrequenz-Warnung. Die Warnung las erledigte
// Kaskaden-Touches (`reminder_touches`) — die Kaskade hat keine Oberfläche
// mehr, und die einzige verbliebene Quelle wäre der letzte Versuch DESSELBEN
// Vorgangs gewesen, den sie ausdrücklich ausschließt. Sie hätte also einen
// Roundtrip je Seitenaufruf gekostet und niemals angeschlagen.
//
// DIE RPC `nachfassen_tasks` WIRD NICHT MEHR GELESEN, aber auch nicht
// angefasst: Sie ist seit Migration 0030 eingefroren, liegt produktiv auf der
// Datenbank und speist bis auf Weiteres den Navigations-Zähler
// (`lib/navCounts.ts`). Ein DROP FUNCTION für eine Anzeigefrage wäre der
// falsche Preis.
//
// DIE NAMEN BLEIBEN: Datei, Komponente und diese Funktion heißen weiter
// „nachfassen", weil die ROUTE so heißt (/nachfassen) — Lesezeichen und der
// Rückweg der Detailseiten (`?from=nachfassen`) hängen daran. Was der Nutzer
// liest, sagt dagegen „Recycling"; das ist der Titel der Seite.

/**
 * Eine fällige Wiedervorlage.
 *
 * `origin` ersetzt die frühere `source`-Union: Es gibt nur noch eine Quelle,
 * und die interessante Unterscheidung ist, aus WELCHER der vier
 * Ursprungstabellen der Lead kommt — sie entscheidet den Sprung-Link, das
 * Dossier und die Tabelle, in die eine Aktion schreibt.
 */
export type RecycleTask = {
  origin: RecycleOrigin;
  entity_id: string;
  lead_name: string | null;
  company: string | null;
  /** `next_recycle_at` — ein TAGESdatum, keine Uhrzeit (docs §6). */
  due_at: string | null;
  /** lost_reason_code | disqualify_reason_code | 'dead' | 'fu_exhausted'. */
  reason: string | null;
  /** Wie oft schon versucht wurde — 0 heißt „erster Anlauf". */
  attempt: number;
  /** Letzter Versuch, sofern es einen gab — Kontext, keine Warnung. */
  last_contacted_at: string | null;
  /** Nur bei `linkedin`/`telefon` gefüllt: Ziel des Sprung-Links. */
  list_id: string | null;
  /** Nur bei `telefon`: die Rufnummer für den `tel:`-Link. */
  phone: string | null;
};

export type NachfassenResult = {
  tasks: RecycleTask[];
  /**
   * false = das Recycling-Schema fehlt (Migration 0033). Muss bis in die
   * Oberfläche durchgereicht werden: sonst sieht eine fehlende Migration
   * genauso aus wie „nichts fällig" — und niemand erfährt, dass gerade gar
   * keine toten Leads wiedervorgelegt werden. Auf dieser Seite ist es
   * zusätzlich der EINZIGE Ausfall, den es noch geben kann: Mit dem
   * Union-Zweig ist auch sein Ausfall-Kasten entfallen.
   */
  recyclingAvailable: boolean;
};

/* ------------------------------------------------------------------ *
 * Nachschläge
 * ------------------------------------------------------------------ */

/** PostgREST-URL-Länge: mehr IDs als das gehen nicht in ein `.in()`. */
const ID_CHUNK = 200;

/**
 * `.in()`-Nachschlag über beliebig viele IDs — die Chunks laufen PARALLEL.
 * Ein `await` je Chunk in einer for-Schleife wären bei 600 IDs drei Roundtrips
 * nacheinander, obwohl keiner auf den anderen wartet.
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

type ContactRow = { id: string; list_id: string };
type LeadRow = { id: string; list_id: string; phone: string | null };

/* ------------------------------------------------------------------ *
 * Fällige Wiedervorlagen
 * ------------------------------------------------------------------ */

export async function getNachfassenTasks(): Promise<NachfassenResult> {
  const access = await getAccessContext();
  // Ohne Anmeldung gibt es keine Aussage über das Schema — hier ist `true` die
  // ehrliche Antwort, sonst behauptete die leere Seite eine fehlende Migration.
  if (!access) return { tasks: [], recyclingAvailable: true };

  const supabase = await createClient();

  const recycle = await loadRecycleTasks();

  /* ── HIER STAND EIN ALTLAST-SCHNITT, UND ER IST GEFALLEN ─────────────
     Versuche, deren Fälligkeit über ein Vierteljahr zurücklag, wurden
     versteckt, gezählt und über einen URL-Parameter wieder hereingeholt. Der
     Auftraggeber hat das gestrichen: „Wer offen ist, wird JEDEN TAG
     kontaktiert. Ohne Ausnahme, ohne Intervall-Logik. Er verschwindet von
     der Liste, wenn er entweder neu terminiert ist oder als tot markiert
     wird. Nichts anderes nimmt ihn da runter."

     „Nichts anderes" schließt ein Alter ein. Was einen Lead hier herausnimmt,
     steht ausschließlich in `recycle_tasks` (Status-Riegel je Zweig, docs §5)
     und in den drei Knöpfen der Karte — nicht in einer Zahl, die die Software
     sich selbst gibt.                                                    */
  const due = [...recycle.tasks];

  // Stabile Reihenfolge: das Älteste zuerst. Die RPC hat kein ORDER BY, und
  // eine Liste, deren Reihenfolge sich bei jedem Aufruf ändert, kann man nicht
  // von oben nach unten abarbeiten.
  due.sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? "") || a.entity_id.localeCompare(b.entity_id));

  /* ── Nachschläge: beide Tabellen parallel ────────────────────────────
     Nur die beiden Lead-Ursprünge brauchen einen: LinkedIn-Kontakte und
     Telefon-Leads haben keine Detailseite, ihr Verweis führt auf die LISTE
     (dieselbe Regel wie in /ablage). Termine kennen ihre Adresse selbst.   */
  const contactIds = [...new Set(due.filter((r) => r.origin === "linkedin").map((r) => r.entity_id))];
  const leadIds = [...new Set(due.filter((r) => r.origin === "telefon").map((r) => r.entity_id))];

  const [contactRows, leadRows] = await Promise.all([
    selectByIds<ContactRow>(contactIds, (chunk) =>
      supabase.from("contacts").select("id, list_id").eq("workspace_id", access.workspace_id).in("id", chunk),
    ),
    selectByIds<LeadRow>(leadIds, (chunk) =>
      supabase
        .from("phone_leads")
        .select("id, list_id, phone")
        .eq("workspace_id", access.workspace_id)
        .in("id", chunk),
    ),
  ]);

  const contactInfo = new Map<string, ContactRow>();
  for (const c of contactRows) contactInfo.set(c.id, c);
  const leadInfo = new Map<string, LeadRow>();
  for (const l of leadRows) leadInfo.set(l.id, l);

  const tasks: RecycleTask[] = due.map((r) => {
    const lead = r.origin === "telefon" ? leadInfo.get(r.entity_id) : undefined;
    const contact = r.origin === "linkedin" ? contactInfo.get(r.entity_id) : undefined;
    return {
      origin: r.origin,
      entity_id: r.entity_id,
      lead_name: r.lead_name,
      company: r.company,
      due_at: r.due_at,
      reason: r.reason,
      attempt: r.attempt_count,
      last_contacted_at: r.last_contacted_at,
      list_id: lead?.list_id ?? contact?.list_id ?? null,
      phone: lead?.phone ?? null,
    };
  });

  return { tasks, recyclingAvailable: recycle.available };
}

/* ------------------------------------------------------------------ *
 * Rückgängig
 * ------------------------------------------------------------------ */

/**
 * Warum es das gibt: Auf diesem Board liegen die Aktionen wenige Pixel
 * nebeneinander, und ein Fehlgriff verbrannte einen von standardmäßig zwei
 * erlaubten Recycling-Versuchen, ohne dass die Oberfläche einen Weg zurück
 * angeboten hätte.
 *
 * Zurückgeschrieben werden AUSSCHLIESSLICH die Spalten, die die jeweilige
 * Aktion vorher überschrieben hat — mit den Werten, die dort standen. Kein
 * Nachrechnen, kein Raten: Wo eine Aktion einen Wert vernichtet hat, den
 * niemand mehr kennt, gibt es hier keinen Eintrag und im Board keinen Knopf
 * („Endgültig raus" ist genau dieser Fall und sagt es im Bestätigungsdialog).
 *
 * Die drei Arten der Tages-Wiedervorlagen (`telefon_rueckruf`,
 * `setting_wiedervorlage`, `closing_wiedervorlage`) sind mit ihren Quellen
 * entfallen. Sie hatten je einen Aufrufer, und der steht nicht mehr auf der
 * Seite; ein erreichbarer Schreibpfad ohne Bedienung ist kein Rest, sondern
 * eine offene Tür (Server Actions sind per direktem POST ansprechbar).
 */
export type UndoKind = "recycling_versuch" | "recycling_reaktion";

/** Zellwerte, wie PostgREST sie liefert — nichts Verschachteltes. */
export type UndoValue = string | number | boolean | null;

export type NachfassenUndo = {
  kind: UndoKind;
  entity_id: string;
  /** Welche der vier Ursprungstabellen. */
  origin: RecycleOrigin;
  /** Vorherige Werte GENAU der Spalten, die die Aktion angefasst hat. */
  values: Record<string, UndoValue>;
};

export type NachfassenActionResult = { error?: string; undo?: NachfassenUndo };

/**
 * Erlaubte Spalten je Art — serverseitig, nie aus dem Token.
 *
 * Server Actions sind per direktem POST erreichbar. Käme die Spaltenliste vom
 * Aufrufer, wäre `undoNachfassenTask` ein beliebiges UPDATE auf vier Tabellen;
 * so ist es die Rücknahme genau einer bekannten Aktion.
 */
const UNDO_COLUMNS: Record<UndoKind, readonly string[]> = {
  recycling_versuch: ["recycle_attempt_count", "recycle_last_contacted_at", "next_recycle_at", "recycle_reason_code"],
  recycling_reaktion: ["next_recycle_at", "recycle_responded_at"],
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
  const table = undo.origin ? TABLE_BY_ORIGIN[undo.origin] : null;
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

  const { error } = await supabase
    .from(table)
    .update(patch)
    .eq("id", undo.entity_id)
    .eq("workspace_id", access.workspace_id);
  if (error) return { error: error.message };

  revalidatePath("/nachfassen", "page");
  revalidatePath("/", "layout");
  return {};
}

/* ------------------------------------------------------------------ *
 * Die beiden Aktionen — dieselben wie vorher, nur mit Rückweg
 * ------------------------------------------------------------------ *
 *
 * Geschrieben wird weiterhin ausschließlich über actions/recycle.ts (dort
 * sitzen Besitzprüfung, Deckel und die beiden RPCs). Hier kommt nur der Blick
 * auf die Zeile DAVOR dazu — `recycle_attempt()` und `schedule_recycle()`
 * überschreiben ihn, und „Nochmal versucht" verbrennt dabei einen von
 * standardmäßig zwei erlaubten Versuchen.
 */

/** Die Spalten, die `recycle_attempt()` + `schedule_recycle()` zusammen anfassen. */
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
