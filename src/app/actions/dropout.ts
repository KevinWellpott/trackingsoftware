"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext, type AccessContext } from "@/lib/access";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { berlinDateISO } from "@/lib/apptTime";
import { getPipelineSettings } from "@/app/actions/reminders";
import {
  dropoutListMeta,
  isDropoutListKey,
  listFeedsRecycling,
  recycleBlockedReason,
  recycleReasonCodeFor,
  reviveBlockedReason,
  type DropoutAppointmentEntity,
  type DropoutEntity,
  type DropoutSourceList,
} from "@/lib/dropoutLists";

// Der Ablage-Bereich: liest die ausgeschiedenen Vorgänge aus `dropout_lists()`
// (Migration 0033) und trägt die beiden Aktionen, die es dort gibt.
//
// EINE ANSICHT, MEHRERE AUFRUFE. Die RPC liegt seit dem Einspielen von 0033
// fest und nimmt genau EINEN Listen-Schlüssel entgegen. „Ausgeschieden" fasst
// vier davon zusammen — also vier Aufrufe, parallel, und ein Entdoppeln
// danach. Zusammenlegen in SQL bräuchte Migration 0042; für eine reine
// Anzeigefrage ist das der falsche Preis.
//
// Gelesen wird nur — die Zugehörigkeit zu einer Liste ist abgeleiteter
// Zeilenzustand und lässt sich hier gar nicht setzen. Geschrieben wird
// ausschließlich am Recycling: vorziehen (`pullRecycleForward`) oder dauerhaft
// sperren (`excludeFromRecycle` aus actions/recycle.ts, unverändert
// weiterverwendet).
//
// Die dritte Aktion der Ablage — „Zurückholen" (Entscheidung K10) — steht
// bewusst NICHT hier, sondern in actions/revive.ts: sie liest nicht die Ablage,
// sondern legt einen Termin an, und ist damit eine Anlagestrecke wie
// `createManualSetting`. Hier bleibt nur, was die Karte dafür anzeigen muss:
// der Sperrgrund am Knopf und die Kette aus Vorgänger und Nachfolger.

/* ------------------------------------------------------------------ *
 * Verfügbarkeits-Probe
 * ------------------------------------------------------------------ */

/**
 * Fehlt das Schema (Migration 0033 nicht eingespielt), muss das von „Liste ist
 * leer" unterscheidbar sein — sonst zeigt die Ablage in beiden Fällen denselben
 * ruhigen Leerzustand, obwohl im einen Fall gar nichts erfasst wird. Muster
 * `loadCallAttempts` (src/lib/phoneAttemptsData.ts) und `loadRecycleTasks`.
 *
 * Geprüft wird der Fehlercode bzw. der Meldungstext, NICHT die leere
 * Ergebnismenge: eine fehlende Funktion meldet 42883/PGRST202, eine fehlende
 * Spalte oder Relation 42P01/42703/PGRST204/PGRST205. Dritte Kopie desselben
 * Prädikats (recycle.ts, reminders.ts) — sie wandern zusammen, sobald es die
 * gemeinsame `schemaProbe.ts` gibt.
 */
function isMissingSchema(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code && ["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(e.code)) return true;
  const msg = (e?.message ?? (err instanceof Error ? err.message : "")).toLowerCase();
  return /does not exist|could not find|schema cache/.test(msg);
}

// Nur die beiden Termin-Tabellen: „Recycling vorziehen" gibt es ausschließlich
// dort. Die beiden Lead-Ursprünge erscheinen nur in der Sperrliste, und ein
// gesperrter Lead bekommt per Definition keine Wiedervorlage mehr.
const TABLE_BY_ENTITY: Record<DropoutAppointmentEntity, string> = {
  setting: "setting_calls",
  closing: "closing_calls",
};

function isDropoutAppointmentEntity(value: unknown): value is DropoutAppointmentEntity {
  return value === "setting" || value === "closing";
}

/** Heute als BERLINER Kalendertag — auf Vercel läuft der Server in UTC, ein
    `new Date()` läge dort abends einen Tag daneben (docs §6). */
function todayBerlin(): string {
  return berlinDateISO(new Date().toISOString());
}

/* ------------------------------------------------------------------ *
 * Lesen
 * ------------------------------------------------------------------ */

/** Rückgabespalten von `dropout_lists()` (Migration 0033, Abschnitt 5). */
export type DropoutRowRaw = {
  /** Vier Ursprünge — 'linkedin' und 'telefon' kommen nur in der Sperrliste vor. */
  entity_type: DropoutEntity;
  entity_id: string;
  lead_name: string | null;
  company: string | null;
  /** `profiles.username` der zuständigen Person (assigned_user_id ?? created_by). */
  owner_name: string | null;
  assigned_user_id: string | null;
  /** Absage-, Disqualifizierungs- oder Verlustgrund — je nach Liste (docs §4). */
  reason_code: string | null;
  /** Freitext daneben: Code ist Statistik, Freitext ist Gedächtnis. */
  reason_text: string | null;
  /** `cancelled_at`, sonst `updated_at`, sonst `created_at`. */
  dropped_at: string | null;
  next_recycle_at: string | null;
  recycle_attempt_count: number;
  excluded: boolean;
  revived_at: string | null;
  reschedule_count: number;
  /**
   * Nur bei 'linkedin'/'telefon' gesetzt. Die beiden Lead-Tabellen haben keine
   * Detailseite — der Verweis führt zu ihrer Liste (`/lists/…` bzw.
   * `/telefon/…`), wie im Nachfassen-Board. Bei Terminen NULL: dort führt er
   * auf `/setting/<id>` bzw. `/closing/<id>`.
   */
  list_id: string | null;
};

/* ------------------------------------------------------------------ *
 * Rückhol-Kette (Entscheidung K10)
 * ------------------------------------------------------------------ */

/**
 * Vorgänger und Nachfolger einer zurückgeholten Kette.
 *
 * Beides liefert `dropout_lists()` NICHT mit — die RPC liegt seit dem
 * Einspielen von 0033 fest, und die Kette ist eine reine Anzeigehilfe. Sie
 * wird deshalb app-seitig nachgeladen, mit denselben zwei Regeln wie überall:
 * immer mit `workspace_id` gefiltert (für einen Plattform-Admin lässt RLS jede
 * Zeile durch) und fail-soft (eine fehlende Kette darf die Ablage nicht
 * abräumen).
 */
export type DropoutLineage = {
  /**
   * Die Zeile, AUS DER dieser Vorgang zurückgeholt wurde — mit ihren Zählern.
   * Nur Erstgespräche können Nachfolger sein: `revived_from_*` steht auf
   * `setting_calls`.
   */
  predecessor: {
    entity: DropoutAppointmentEntity;
    id: string;
    reschedule_count: number;
    /** null = die Tabelle führt keinen No-Show-Zähler (`closing_calls`). */
    no_show_count: number | null;
  } | null;
  /** Der Termin, der AUS dieser Zeile zurückgeholt wurde. */
  successor: { id: string; appointment_at: string | null } | null;
};

const EMPTY_LINEAGE: DropoutLineage = { predecessor: null, successor: null };

export type DropoutRow = DropoutRowRaw & {
  /**
   * Aus welchem Aufruf von `dropout_lists()` die Zeile stammt.
   *
   * Trägt zweierlei: das Kennzeichen auf der Karte („Kein Close", „No-Show ohne
   * Antwort" …) und die Antwort auf `listFeedsRecycling`. Seit die vier
   * Endzustände in EINER Ansicht liegen, ist beides nicht mehr aus der Ansicht
   * abzulesen — ein abgesagtes Closing und ein verlorenes stehen nebeneinander,
   * und nur das verlorene speist eine Wiedervorlage.
   */
  source_list: DropoutSourceList;
  /** null = „Jetzt wieder anschreiben" ist möglich, sonst der Satz dagegen. */
  recycle_blocked: string | null;
  /**
   * null = „Neuen Termin ansetzen" ist möglich, sonst der Satz dagegen.
   *
   * Ein SATZ, kein Wahrheitswert: Der Knopf wird weggelassen statt ausgegraut,
   * und damit ist dieser Text die einzige Stelle, an der die Karte noch sagen
   * kann, warum — die Alternative wäre eine Karte, auf der wortlos ein Knopf
   * weniger steht als auf der daneben.
   */
  revive_blocked: string | null;
  /**
   * true = der Grund existiert vielleicht, ist aber durch die eingestellte
   * Datensicht nicht lesbar (nur in der org-weiten Sperrliste möglich). Die
   * Karte schreibt dann „Grund nicht sichtbar" statt „Ohne Grund" — das eine ist
   * eine Aussage über die Sicht, das andere über die Daten.
   */
  reason_hidden: boolean;
  lineage: DropoutLineage;
};

type RevivedRow = {
  id: string;
  appointment_at: string | null;
  revived_from_setting_call_id: string | null;
  revived_from_closing_call_id: string | null;
};

function lineageKey(entity: DropoutAppointmentEntity, id: string): string {
  return `${entity}:${id}`;
}

/**
 * Die Rückhol-Ketten zu den geladenen Zeilen — Ergebnis geschlüsselt nach
 * `<entity>:<id>` der ABLAGE-Zeile.
 *
 * Abgefragt werden bewusst ALLE Rückholungen der Organisation statt der zu den
 * gelisteten IDs passenden: Rückholungen sind selten (eine Handvoll Zeilen),
 * die Ablage wächst dagegen über Monate — ein `in`-Filter über tausende
 * Ablage-IDs erzeugte eine URL, die PostgREST irgendwann abweist. Die Zähler
 * der Vorgänger holt danach ein zweiter Zugriff, aber nur für die Vorgänger,
 * die wirklich in dieser Ansicht gebraucht werden.
 */
async function loadLineage(
  access: AccessContext,
  rows: DropoutRowRaw[],
): Promise<Map<string, DropoutLineage>> {
  const out = new Map<string, DropoutLineage>();
  const listed = new Set<string>();
  for (const r of rows) {
    if (isDropoutAppointmentEntity(r.entity_type)) listed.add(lineageKey(r.entity_type, r.entity_id));
  }
  if (listed.size === 0) return out;

  const supabase = await createClient();

  let revived: RevivedRow[];
  try {
    revived = await fetchAllRows<RevivedRow>((from, to) =>
      supabase
        .from("setting_calls")
        .select("id, appointment_at, revived_from_setting_call_id, revived_from_closing_call_id")
        .eq("workspace_id", access.workspace_id)
        .or("revived_from_setting_call_id.not.is.null,revived_from_closing_call_id.not.is.null")
        // Stabile Sortierung, sonst überlappen sich die Seiten (fetchAllRows).
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (e) {
    if (!isMissingSchema(e)) console.error("dropout lineage:", e instanceof Error ? e.message : e);
    return out;
  }

  function entry(key: string): DropoutLineage {
    const existing = out.get(key);
    if (existing) return existing;
    const fresh = { ...EMPTY_LINEAGE };
    out.set(key, fresh);
    return fresh;
  }

  // Nachfolger je Vorgängerzeile — und nebenbei die Umkehrung, aus der gleich
  // die Vorgänger der gelisteten Zeilen fallen.
  const predecessorOf = new Map<string, { entity: DropoutAppointmentEntity; id: string }>();
  for (const r of revived) {
    const pred = r.revived_from_setting_call_id
      ? { entity: "setting" as const, id: r.revived_from_setting_call_id }
      : r.revived_from_closing_call_id
        ? { entity: "closing" as const, id: r.revived_from_closing_call_id }
        : null;
    if (!pred) continue;
    predecessorOf.set(r.id, pred);
    const key = lineageKey(pred.entity, pred.id);
    if (listed.has(key)) {
      entry(key).successor = { id: r.id, appointment_at: r.appointment_at };
    }
  }

  const needBy: Record<DropoutAppointmentEntity, string[]> = { setting: [], closing: [] };
  const predByListed = new Map<string, { entity: DropoutAppointmentEntity; id: string }>();
  for (const r of rows) {
    // Nur Erstgespräche tragen `revived_from_*` — ein Closing entsteht
    // ausschließlich aus einem Setting und wird nie zurückgeholt.
    if (r.entity_type !== "setting") continue;
    const pred = predecessorOf.get(r.entity_id);
    if (!pred) continue;
    predByListed.set(lineageKey("setting", r.entity_id), pred);
    needBy[pred.entity].push(pred.id);
  }
  if (predByListed.size === 0) return out;

  const counters = new Map<string, { reschedule_count: number; no_show_count: number | null }>();
  for (const entity of ["setting", "closing"] as const) {
    const ids = needBy[entity];
    if (ids.length === 0) continue;
    // `no_show_count` gibt es nur am Erstgespräch (Migration 0018) — beim
    // Closing bleibt die Spalte bewusst weg statt als 0 gelesen zu werden:
    // „kein Zähler" und „Zähler steht auf 0" sind zwei verschiedene Aussagen.
    const columns = entity === "setting" ? "id, reschedule_count, no_show_count" : "id, reschedule_count";
    const { data, error } = await supabase
      .from(TABLE_BY_ENTITY[entity])
      .select(columns)
      .eq("workspace_id", access.workspace_id)
      .in("id", ids);
    if (error || !data) continue;
    for (const raw of data as unknown as {
      id: string;
      reschedule_count: number | null;
      no_show_count?: number | null;
    }[]) {
      counters.set(lineageKey(entity, raw.id), {
        reschedule_count: raw.reschedule_count ?? 0,
        no_show_count: entity === "setting" ? raw.no_show_count ?? 0 : null,
      });
    }
  }

  for (const [key, pred] of predByListed) {
    const c = counters.get(lineageKey(pred.entity, pred.id));
    entry(key).predecessor = {
      entity: pred.entity,
      id: pred.id,
      reschedule_count: c?.reschedule_count ?? 0,
      no_show_count: c?.no_show_count ?? null,
    };
  }

  return out;
}

/**
 * Der maßgebliche Grund der SPERRLISTE — nachgeladen, weil `dropout_lists()`
 * ihn dort nicht liefern kann.
 *
 * Die RPC wählt die Grund-Spalte per `case p_list`: 'disqualifiziert' nimmt
 * `disqualify_reason_code`, 'kein_close' den `lost_reason_code`, ALLES ANDERE —
 * also auch 'gesperrt' — den `cancel_reason_code`. Ein Erstgespräch landet in
 * der Sperrliste aber typischerweise über `disqualify_reason_code =
 * 'keine_zusammenarbeit'` (`applyDisqualifyConsequences`), ein Closing über
 * seinen `lost_reason_code`. Beide haben gar keinen Absage-Grund, und die
 * Karten trugen deshalb reihenweise den Warn-Badge „Ohne Grund" — ausgerechnet
 * in der einen Liste, die die Frage „warum darf hier niemand mehr anrufen?"
 * beantworten soll.
 *
 * App-seitig statt in SQL: 0033 ist eingefroren. Überschrieben wird nur, wo die
 * RPC nichts geliefert hat — ein wirklich erfasster Absage-Grund bleibt stehen.
 *
 * ── Der Nachschlag sieht weniger als die Liste, und das muss er sagen ────────
 * `dropout_lists()` liefert die Sperrliste bewusst ORG-WEIT (`v_user := null`);
 * dieser Nachschlag läuft dagegen als normale Abfrage durch die
 * Zeilensicherheit. Für ein Mitglied mit Datensicht „nur eigene" ist die Zeile
 * einer Kollegin damit unlesbar — sie kommt gar nicht zurück. Ohne die
 * Unterscheidung stünde auf ihrer Karte „Ohne Grund", also eine Aussage über
 * die Daten, wo in Wahrheit eine über die Sichtbarkeit gemeint ist. Deshalb
 * `visible: false` statt eines fehlenden Eintrags: Die Karte schreibt dann
 * „Grund nicht sichtbar".
 *
 * Bewusst NICHT org-weit nachgeschlagen: Der Grund steht als Freitext daneben
 * (`disqualify_reason`, `lost_reason`) und ist die Gesprächsnotiz zu einem
 * fremden Lead. Die Sperrliste hebt die Datensicht auf, um IDENTITÄTEN zu
 * zeigen — wen niemand mehr anrufen darf —, nicht die Akte dahinter.
 *
 * Fail-soft wie die Rückhol-Kette: Fällt der Nachschlag ganz aus, gelten alle
 * angefragten Zeilen als nicht sichtbar; die Liste selbst lädt weiter.
 */
type BlockReasonLookup =
  | { visible: true; reason_code: string | null; reason_text: string | null }
  | { visible: false };

async function loadBlockReasons(
  access: AccessContext,
  rows: DropoutRowRaw[],
): Promise<Map<string, BlockReasonLookup>> {
  const out = new Map<string, BlockReasonLookup>();
  const supabase = await createClient();
  // Nur Zeilen ohne Grund nachschlagen — und nur Termine: ein LinkedIn-Kontakt
  // und ein Telefon-Lead haben weder Absage noch Disqualifizierung, ihr
  // Recycling-Grund steht bereits in der Antwort der RPC.
  const needBy: Record<DropoutAppointmentEntity, string[]> = { setting: [], closing: [] };
  for (const r of rows) {
    if (r.reason_code) continue;
    if (isDropoutAppointmentEntity(r.entity_type)) needBy[r.entity_type].push(r.entity_id);
  }

  for (const entity of ["setting", "closing"] as const) {
    const ids = needBy[entity];
    if (ids.length === 0) continue;
    const columns =
      entity === "setting"
        ? "id, disqualify_reason_code, disqualify_reason"
        : "id, lost_reason_code, lost_reason";
    const { data, error } = await supabase
      .from(TABLE_BY_ENTITY[entity])
      .select(columns)
      .eq("workspace_id", access.workspace_id)
      .in("id", ids);
    // Erst alle als „nicht sichtbar" vormerken, dann jede zurückgekommene Zeile
    // überschreiben. Was übrig bleibt, hat die Zeilensicherheit weggefiltert —
    // die Unterscheidung entsteht genau aus dieser Differenz.
    for (const id of ids) out.set(`${entity}:${id}`, { visible: false });
    if (error || !data) continue;
    for (const raw of data as unknown as {
      id: string;
      disqualify_reason_code?: string | null;
      disqualify_reason?: string | null;
      lost_reason_code?: string | null;
      lost_reason?: string | null;
    }[]) {
      const code = entity === "setting" ? raw.disqualify_reason_code : raw.lost_reason_code;
      out.set(`${entity}:${raw.id}`, {
        visible: true,
        reason_code: code ?? null,
        reason_text: (entity === "setting" ? raw.disqualify_reason : raw.lost_reason) ?? null,
      });
    }
  }

  return out;
}

export type DropoutListResult = {
  rows: DropoutRow[];
  /** false = Schema fehlt (Migration 0033). NICHT dasselbe wie „Liste ist leer". */
  available: boolean;
  /** Versuchsdeckel der Organisation — die Karte zeigt „Versuch 1 von 2". */
  maxAttempts: number;
};

/**
 * Eine der beiden Ansichten laden.
 *
 * Die Datensicht kommt aus dem `AccessContext` und wird NICHT vom Aufrufer
 * entgegengenommen: Als Server Action ist die Funktion per direktem POST
 * erreichbar, und `dropout_lists` läuft als `security definer` — eine
 * mitgelieferte `workspace_id` hätte sie ohne Gegenprüfung übernommen.
 *
 * `p_effective_user_id` ist bewusst `access.effective_user_id` (null = org-weit)
 * und nicht das eigene Konto: Die Ablage ist ein Aktenschrank der Organisation,
 * keine persönliche Aufgabenliste. Ein Mitglied mit `data_scope='own'` wird von
 * `rpc_effective_user` serverseitig ohnehin auf sich selbst gezwungen. Die
 * Sperrliste hebt den Filter zusätzlich in der RPC auf.
 *
 * ENTDOPPELT WIRD ÜBER `<entity_type>:<entity_id>`, und zwar nach der
 * Reihenfolge in `meta.sources` (Begründung dort). Ohne diesen Schritt stünde
 * ein disqualifiziertes und später abgesagtes Erstgespräch zweimal in derselben
 * Ansicht — als zwei Karten für einen Menschen. In den sechs alten Reitern fiel
 * das nicht auf: Dieselbe Zeile stand in zwei Reitern, aber nie zweimal
 * nebeneinander.
 */
export async function loadDropoutList(list: string): Promise<DropoutListResult> {
  const access = await getAccessContext();
  if (!access) return { rows: [], available: false, maxAttempts: 0 };
  if (!isDropoutListKey(list)) return { rows: [], available: true, maxAttempts: 0 };

  const supabase = await createClient();
  // Der Deckel steht in `pipeline_settings` (0032) und wird hier nur angezeigt;
  // durchgesetzt wird er in `recycle_attempt()` bzw. in der Gate-Prüfung unten.
  const settings = await getPipelineSettings();
  const sources = dropoutListMeta(list).sources;

  try {
    const perSource = await Promise.all(
      sources.map(async (source) => {
        const rows = await fetchAllRows<DropoutRowRaw>((from, to) =>
          supabase
            .rpc("dropout_lists", {
              p_workspace_id: access.workspace_id,
              p_list: source,
              p_effective_user_id: access.effective_user_id,
            })
            // Stabile Sortierung ist Pflicht, sonst überlappen sich die Seiten
            // der Paginierung — die RPC selbst gibt die Union ungeordnet zurück.
            .order("entity_id", { ascending: true })
            .range(from, to),
        );
        return rows.map((r) => ({ ...r, source_list: source }));
      }),
    );

    const raw: (DropoutRowRaw & { source_list: DropoutSourceList })[] = [];
    const seen = new Set<string>();
    for (const rows of perSource) {
      for (const r of rows) {
        const key = `${r.entity_type}:${r.entity_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        raw.push(r);
      }
    }

    // Die Rückhol-Kette ist eine Anzeigehilfe und darf die Liste nicht
    // aufhalten: sie hängt hinter derselben `available`-Antwort, liefert im
    // Fehlerfall aber nur eine leere Map.
    const lineage = await loadLineage(access, raw);
    const blockReasons = list === "gesperrt" ? await loadBlockReasons(access, raw) : null;

    const rows = raw
      .map<DropoutRow>((r) => {
        const key = `${r.entity_type}:${r.entity_id}`;
        const lookup = blockReasons?.get(key);
        // Überschrieben wird nur, wo der Nachschlag wirklich etwas gefunden hat
        // — ein von der RPC gelieferter Absage-Grund bleibt stehen.
        const nachgeschlagen =
          lookup?.visible && lookup.reason_code
            ? { reason_code: lookup.reason_code, reason_text: lookup.reason_text }
            : {};
        return {
          ...r,
          ...nachgeschlagen,
          reason_hidden: lookup ? !lookup.visible : false,
          lineage: lineage.get(key) ?? EMPTY_LINEAGE,
          revive_blocked: reviveBlockedReason({
            entity: r.entity_type,
            revived: Boolean(r.revived_at),
            excluded: r.excluded,
          }),
          recycle_blocked: recycleBlockedReason({
            entity: r.entity_type,
            excluded: r.excluded,
            revived: Boolean(r.revived_at),
            // `recycle_responded_at` liefert die RPC nicht mit; ein Lead, der
            // reagiert hat, ist ohnehin über `revived_at` oder einen
            // Statuswechsel aus der Liste heraus. Die Action prüft es zusätzlich
            // an der Zeile selbst.
            responded: false,
            // Aus der Absage-Quelle trägt `reason_code` den ABSAGEgrund, nicht den
            // Verlust- oder Disqualifizierungsgrund — die Sperre „bekommt nie ein
            // Recycling" greift hier also nur, wenn beide Gründe gesetzt sind.
            // Das ist bewusst die optimistische Seite: Die Action liest den
            // maßgeblichen Code an der Zeile und weist den Klick sonst mit
            // derselben Begründung ab.
            reasonCode: r.reason_code,
            attemptCount: r.recycle_attempt_count ?? 0,
            maxAttempts: settings.settings.max_attempts,
            // Die QUELLE der Zeile, nicht die Ansicht: In „Ausgeschieden" liegen
            // Zeilen nebeneinander, von denen die einen einen Recycling-Zweig
            // speisen und die anderen nicht.
            inRecycleBranch: listFeedsRecycling(r.source_list, r.entity_type),
          }),
        };
      })
      // Neueste Zugänge oben: Die Ablage wird von vorn gelesen, nicht von hinten.
      .sort((a, b) => (b.dropped_at ?? "").localeCompare(a.dropped_at ?? ""));

    return { rows, available: true, maxAttempts: settings.settings.max_attempts };
  } catch (e) {
    const missing = isMissingSchema(e);
    if (!missing) console.error("dropout_lists:", e instanceof Error ? e.message : e);
    return { rows: [], available: !missing, maxAttempts: settings.settings.max_attempts };
  }
}

/* ------------------------------------------------------------------ *
 * Recycling vorziehen
 * ------------------------------------------------------------------ */

/** Die Spalten, an denen die Gate-Prüfung hängt — je Termin-Art eine andere Grund-Spalte. */
const GATE_COLUMNS: Record<DropoutAppointmentEntity, string> = {
  setting:
    "id, status, cancel_outlook, no_show_resolution, revived_at, recycle_excluded_at, recycle_responded_at, recycle_attempt_count, disqualify_reason_code",
  closing:
    "id, status, revived_at, recycle_excluded_at, recycle_responded_at, recycle_attempt_count, lost_reason_code",
};

type GateRow = {
  status: string | null;
  cancel_outlook?: string | null;
  no_show_resolution?: string | null;
  revived_at: string | null;
  recycle_excluded_at: string | null;
  recycle_responded_at: string | null;
  recycle_attempt_count: number | null;
  disqualify_reason_code?: string | null;
  lost_reason_code?: string | null;
};

/**
 * Erfüllt die Zeile den Status-Zweig von `recycle_tasks`? Wörtlich dieselbe
 * Bedingung wie dort — hier aus der Zeile gelesen statt aus der Liste
 * abgeleitet, weil ein direkter POST keine Liste mitschickt.
 */
function rowFeedsRecycling(entity: DropoutAppointmentEntity, row: GateRow): boolean {
  if (entity === "closing") return row.status === "verloren";
  return (
    row.status === "dead" ||
    row.status === "unqualifiziert" ||
    row.no_show_resolution === "ohne_antwort" ||
    row.cancel_outlook === "ohne_aussicht"
  );
}

/**
 * „Recycling vorziehen": die Wiedervorlage auf HEUTE setzen, damit der Vorgang
 * beim nächsten Aufruf von `/nachfassen` in der Recycling-Sektion auftaucht.
 *
 * Bewusst kein Aufruf von `schedule_recycle()`: Die RPC rechnet die
 * grundabhängige Wartezeit ab heute NEU aus — sie ist das Gegenteil von
 * „vorziehen". Geschrieben wird deshalb direkt, aber erst hinter derselben
 * Prüfung, die `schedule_recycle()` intern anstellt:
 *
 *  · gesperrte und wiederbelebte Zeilen bleiben unangetastet (der CHECK aus
 *    0033 würde ein Datum neben `recycle_excluded_at` ohnehin abweisen — der
 *    Nutzer bekäme eine rohe Postgres-Meldung statt einer Ansage),
 *  · „falsche Zielgruppe"/„kein Fit"/„keine Zusammenarbeit" bekommen nie ein
 *    Datum,
 *  · der Versuchsdeckel gilt auch für den vorgezogenen Versuch,
 *  · und die Zeile muss überhaupt einen Zweig von `recycle_tasks` speisen,
 *    sonst wäre das Datum unsichtbar.
 *
 * `recycle_attempt_count` bleibt unberührt: Vorziehen ist kein Versuch,
 * sondern nur eine frühere Fälligkeit. Hochgezählt wird erst im Board über
 * `markRecycleContacted`.
 *
 * Der GRUND wandert dagegen mit (`recycleReasonCodeFor`) — sonst trüge die
 * Wiedervorlage einen Grund, der nicht stimmt.
 */
export async function pullRecycleForward(
  entity: string,
  entityId: string,
): Promise<{ error?: string; dueAt?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  // 'linkedin'/'telefon' fallen hier bewusst durch: Sie stehen nur in der
  // Sperrliste, und eine Wiedervorlage widerspräche der Sperre.
  if (!isDropoutAppointmentEntity(entity)) return { error: "Unbekannte Termin-Art." };

  const supabase = await createClient();
  const table = TABLE_BY_ENTITY[entity];

  // Immer mit `workspace_id` gelesen UND geschrieben: für einen
  // Plattform-Admin lässt RLS jede Zeile durch, maßgeblich ist die aktive
  // Organisation (Muster canAccessAppointment).
  const { data, error: readError } = await supabase
    .from(table)
    .select(GATE_COLUMNS[entity])
    .eq("id", entityId)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();

  if (readError) {
    return {
      error: isMissingSchema(readError)
        ? "Recycling ist nicht verfügbar — Migration 0033 fehlt."
        : readError.message,
    };
  }
  const row = data as unknown as GateRow | null;
  if (!row) return { error: "Nicht gefunden." };

  const settings = await getPipelineSettings();
  const blocked = recycleBlockedReason({
    entity,
    excluded: Boolean(row.recycle_excluded_at),
    revived: Boolean(row.revived_at),
    responded: Boolean(row.recycle_responded_at),
    reasonCode: entity === "closing" ? row.lost_reason_code ?? null : row.disqualify_reason_code ?? null,
    attemptCount: row.recycle_attempt_count ?? 0,
    maxAttempts: settings.settings.max_attempts,
    inRecycleBranch: rowFeedsRecycling(entity, row),
  });
  if (blocked) return { error: blocked };

  const today = todayBerlin();
  // Der Grund wandert MIT. Ohne ihn stünde die Karte in „Nachfassen" unter dem
  // festverdrahteten Ersatzwert der Abfrage — ein abgesagtes Erstgespräch läse
  // sich dort und in der Grund-Tabelle des Analyse-Bereichs als toter Lead.
  // Abgeleitet wird er aus der eben gelesenen Zeile, nie aus dem Aufruf.
  const reasonCode = recycleReasonCodeFor({
    entity,
    status: row.status,
    cancelOutlook: row.cancel_outlook ?? null,
    noShowResolution: row.no_show_resolution ?? null,
    disqualifyReasonCode: row.disqualify_reason_code ?? null,
    lostReasonCode: row.lost_reason_code ?? null,
  });

  // Gelesen und geschrieben sind zwei Anweisungen — dazwischen kann jemand
  // dieselbe Zeile sperren. Der Ausschluss steht deshalb als Bedingung IM
  // Update: Es trifft dann keine Zeile mehr, statt am Exklusiv-CHECK der
  // Datenbank zu scheitern und eine rohe Postgres-Meldung durchzureichen.
  const { data: updated, error } = await supabase
    .from(table)
    .update({
      next_recycle_at: today,
      ...(reasonCode ? { recycle_reason_code: reasonCode } : {}),
    })
    .eq("id", entityId)
    .eq("workspace_id", access.workspace_id)
    .is("recycle_excluded_at", null)
    .select("id");

  if (error) {
    return {
      error: isMissingSchema(error) ? "Recycling ist nicht verfügbar — Migration 0033 fehlt." : error.message,
    };
  }
  if (!updated || updated.length === 0) {
    // Die Zeile gab es beim Lesen noch — sie ist also nicht verschwunden,
    // sondern in der Zwischenzeit gesperrt worden. Bis auf das erste Wort
    // wortgleich zu `recycleBlockedReason`: Der Satz auf der Karte nennt
    // denselben Zustand ohne „Inzwischen", und genau dieser Unterschied sagt,
    // dass er sich geändert hat, während die Karte offen stand.
    return { error: "Inzwischen gesperrt — eine Wiedervorlage widerspräche der Sperre." };
  }

  revalidatePath("/ablage");
  revalidatePath("/nachfassen");
  return { dueAt: today };
}
