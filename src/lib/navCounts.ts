// Zähler für die drei Aufgaben-Einträge der Seitenleiste.
//
// WARUM ÜBERHAUPT: /nachfassen, /erinnerungen und /ablage erzeugen täglich
// Arbeit, aber die Navigation schwieg darüber. Wer nicht von sich aus
// hineinklickt, erfährt nie, dass dort etwas liegt — bei einem System, das
// Fälligkeiten selbst erzeugt, ist das der Unterschied zwischen benutzt und
// vergessen.
//
// PREIS: Die Seitenleiste steht in `(dashboard)/layout.tsx` und wird auf JEDER
// Seite gebaut. Vier Abfragen, alle parallel, alle winzig — die Aufgaben-RPCs
// liefern nur die Spalte `due_at`, die Ablage nur einen `count`. Sie hängen
// sich in das Bündel ein, das das Layout ohnehin abwartet (Listen, Ansichten,
// Datensicht), und kosten damit einen Roundtrip, keine Summe.
//
// UND EINE FRIST: Zusätzlich läuft eine Deadline mit. Kommt eine Zahl nicht
// rechtzeitig, rendert die Navigation ohne sie. Lieber kein Zähler als eine
// hängende Navigation — die Zahl ist eine Beigabe, das Menü ist es nicht.
//
// EHRLICHKEIT: Fehlt eine Migration, erscheint GAR KEIN Zähler statt einer 0.
// Eine 0 wäre eine Behauptung über die Daten („nichts fällig"), die niemand
// geprüft hat; genau die Verwechslung, gegen die auch die roten Hinweise auf
// den Seiten selbst stehen (Muster `loadRecycleTasks`, `loadDropoutList`).

import type { AccessContext } from "@/lib/access";
import { berlinDateISO, berlinInputToIso } from "@/lib/apptTime";
import { dueRefNow, isOverdue, reminderDueSpec, type DueGranularity, type DueSpec } from "@/lib/dueState";
import { isStaleDue, staleSourceOf } from "@/lib/staleTasks";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Ein Zähler. `null` heißt „nicht ermittelbar" — nicht „null Aufgaben". */
export type NavCount = { total: number; overdue: number };

export type NavCounts = {
  nachfassen: NavCount | null;
  erinnerungen: NavCount | null;
  ablage: NavCount | null;
};

export const EMPTY_NAV_COUNTS: NavCounts = { nachfassen: null, erinnerungen: null, ablage: null };

/**
 * So viele Fälligkeits-Werte holt der Zähler höchstens herein. Der `count` der
 * Antwort bleibt trotzdem exakt (PostgREST zählt vor dem Fenster) — gedeckelt
 * ist nur die Aufteilung fällig/überfällig. Weil aufsteigend nach Fälligkeit
 * sortiert wird, stehen die überfälligen Zeilen vorn: Der Deckel greift erst,
 * wenn jemand mehr als 500 überfällige Aufgaben mit sich herumträgt, und dann
 * ist die genaue Zahl ohnehin nicht mehr die Nachricht.
 */
const ROW_CAP = 500;

/** Nach dieser Zeit rendert die Navigation ohne Zähler. */
const DEADLINE_MS = 1500;

/**
 * Welche Ablage-Liste der Zähler meint.
 *
 * Bewusst NICHT die Summe aller sechs: Fünf davon sind ein Aktenschrank, der
 * über Monate wächst und nie auf null geht — eine Zahl, die man nicht
 * abarbeiten kann, ist als Abzeichen keine Nachricht, sondern Rauschen.
 * „Ersatztermin steht aus" ist die einzige Liste mit einer offenen Handlung:
 * Der Lead hat abgesagt UND einen neuen Termin in Aussicht gestellt, der noch
 * niemand eingetragen hat.
 */
const ABLAGE_LIST = "ersatztermin_offen";

/**
 * Die Beschriftung dazu, [Einzahl, Mehrzahl] — die Seitenleiste erklärt ihren
 * Zähler im Tooltip. Sie steht hier und nicht dort, weil sie die Auswahl der
 * Liste eine Zeile weiter oben beschreibt: Wer `ABLAGE_LIST` ändert, sieht die
 * Beschriftung direkt daneben.
 */
export const ABLAGE_COUNT_LABEL: [singular: string, plural: string] = [
  "Absage ohne eingetragenen Ersatztermin",
  "Absagen ohne eingetragenen Ersatztermin",
];

/**
 * Eine Zahl mit Frist. Der Fehlerfall und der Zeitfall sind derselbe Ausgang:
 * kein Zähler. Der `catch` hängt am Versprechen selbst und nicht am Rennen —
 * eine später eintreffende Ablehnung darf den Prozess nicht mitnehmen.
 */
function withDeadline<T>(work: Promise<T>, signal: Promise<null>): Promise<T | null> {
  return Promise.race([work.catch(() => null), signal]);
}

/**
 * Eine Fälligkeit samt ihrer Frist. Die Körnung kommt aus der QUELLE, nicht aus
 * dem Datentyp: `nachfassen_tasks` castet vier Tages-Spalten nach
 * `timestamptz`, und nach dem Typ gelesen wäre alles ab 02:00 überfällig
 * (lib/dueState.ts). Deshalb holt der Zähler `source` mit — und bei den
 * Erinnerungen zusätzlich `touch_kind`, weil der Sofort-Touch gegen seinen
 * Termin misst statt gegen sich selbst.
 */
type DueRow = { due_at: string | null; spec: DueSpec };

/** Fällig/überfällig aus einer Liste von Fälligkeiten — `count` schlägt `length`. */
function tally(rows: DueRow[], exact: number | null): NavCount {
  const ref = dueRefNow();
  let overdue = 0;
  for (const r of rows) if (isOverdue(r.due_at, r.spec, ref)) overdue++;
  return { total: exact ?? rows.length, overdue };
}

/**
 * Die fälligen Aufgaben von /nachfassen: dieselben zwei RPCs, die die Seite
 * liest, nur auf die Fälligkeitsspalte reduziert.
 *
 * Beide müssen antworten. Fällt eine aus, gibt es keinen Zähler — ein Abzeichen,
 * das eine ganze Quelle stillschweigend wegzählt, ist schlimmer als keines.
 *
 * DER ZÄHLER FÄHRT DIESELBEN ZWEI SCHNITTE WIE DIE SEITE. Das ist neu und eine
 * bewusste Abkehr von der früheren Regel („das Badge zählt mehr, die Seite
 * erklärt die Differenz", docs §5.4):
 *
 *  · Der LinkedIn-Zweig steht gar nicht mehr auf der Seite. Ein Badge, das ihn
 *    zählt, behauptet Arbeit, die man dort nicht finden kann — es zeigte
 *    dreistellige Zahlen für ein Board mit einer Handvoll Karten.
 *  · Die Altlasten (lib/staleTasks.ts) blendet die Seite aus, nennt sie aber
 *    in derselben Zeile. Als Differenz im Badge wären sie trotzdem genau die
 *    Zahl, über die sich der Nutzer beschwert hat: eine Mahnung ohne Adressat.
 *
 * Beides läuft über dieselben Funktionen wie die Server-Action — zwei Kopien
 * einer Grenze, die Aufgaben verschwinden lässt, laufen auseinander.
 */
async function countNachfassen(supabase: Supabase, access: AccessContext): Promise<NavCount | null> {
  const today = berlinDateISO(new Date().toISOString());
  const scopeUserId = access.effective_user_id ?? access.user.id;

  const [tasks, recycle] = await Promise.all([
    supabase
      .rpc(
        "nachfassen_tasks",
        {
          p_workspace_id: access.workspace_id,
          p_today: today,
          p_now: new Date().toISOString(),
          p_effective_user_id: scopeUserId,
        },
        { count: "exact" },
      )
      // `source` kommt mit, weil es die Zeitkörnung entscheidet — nur der
      // Telefon-Rückruf trägt eine verabredete Uhrzeit.
      .select("source, due_at")
      .order("due_at", { ascending: true })
      .range(0, ROW_CAP - 1),
    supabase
      .rpc(
        "recycle_tasks",
        {
          p_workspace_id: access.workspace_id,
          p_today: today,
          p_effective_user_id: scopeUserId,
        },
        { count: "exact" },
      )
      .select("due_at")
      .order("due_at", { ascending: true })
      .range(0, ROW_CAP - 1),
  ]);

  if (tasks.error || recycle.error) return null;
  // Fehlt die exakte Zahl EINER Quelle, gibt es keinen Zähler — dieselbe Regel
  // wie bei der Ablage. `(count ?? 0)` hätte die fehlende Quelle stillschweigend
  // als „nichts fällig" verbucht: genau die halbe Wahrheit, gegen die eine Zeile
  // weiter oben schon der Fehlerfall steht.
  if (tasks.count == null || recycle.count == null) return null;

  const taskRows = (tasks.data ?? []) as unknown as { source: string; due_at: string | null }[];
  const recycleRows = (recycle.data ?? []) as unknown as { due_at: string | null }[];

  // Der Deckel und die Schnitte vertragen sich nicht: `count` ist exakt, das
  // Fenster ist es nicht — und weil aufsteigend nach Fälligkeit sortiert wird,
  // stehen ausgerechnet die ÄLTESTEN (also die wegzuschneidenden) Zeilen vorn.
  // Wurde abgeschnitten, lässt sich die gefilterte Zahl nicht mehr ermitteln,
  // und dann gibt es hier kein Badge statt einer zu kleinen Zahl (docs §5.4:
  // `null` heißt „nicht ermittelbar", nicht „nichts fällig").
  if (tasks.count > taskRows.length || recycle.count > recycleRows.length) return null;

  const rows: DueRow[] = [];
  for (const r of taskRows) {
    // Steht nicht mehr auf der Seite (actions/nachfassen.ts).
    if (r.source === "linkedin") continue;
    const stale = staleSourceOf(r.source);
    if (stale && isStaleDue(stale, r.due_at, today)) continue;
    rows.push({
      due_at: r.due_at,
      spec: (r.source === "telefon" ? "moment" : "day") as DueGranularity,
    });
  }
  for (const r of recycleRows) {
    if (isStaleDue("recycling", r.due_at, today)) continue;
    // Ein Recycling-Versuch ist immer auf den Tag fällig (`next_recycle_at`
    // ist eine `date`-Spalte — Wochen-Kadenz, keine Uhrzeit-Präzision).
    rows.push({ due_at: r.due_at, spec: "day" as DueGranularity });
  }
  // `rows.length` statt der beiden `count`: Nach den Schnitten oben ist die
  // gefilterte Liste die Wahrheit, und dass sie vollständig ist, hat die
  // Deckel-Prüfung gerade festgestellt.
  return tally(rows, rows.length);
}

/**
 * Die Erinnerungen, die HEUTE dran sind — überfällig, in der nächsten Stunde
 * oder im Lauf des Tages. Das Fenster der Seite reicht weiter (sieben Tage,
 * `reminder_horizon_days`); ein Zähler über den ganzen Vorlauf ginge nie auf
 * null und mahnte an, was noch gar nicht fällig ist. Die Seite trennt „Heute"
 * und „Diese Woche" sichtbar in zwei Körben — die Zahl hier ist der erste.
 *
 * Gezählt werden TOUCHES, nicht Termine: Die Seite bündelt mehrere Stufen
 * desselben Termins zu einer Karte. Der Tooltip sagt deshalb „Erinnerungen"
 * (docs §1: eine Erinnerung = eine Zeile in `reminder_touches`), nicht
 * „Termine".
 */
async function countErinnerungen(supabase: Supabase, access: AccessContext): Promise<NavCount | null> {
  const scopeUserId = access.effective_user_id ?? access.user.id;
  // Tagesende in Berliner Wandzeit — auf Vercel läuft der Server in UTC, ein
  // `setHours(23,59)` läge dort im Sommer zwei Stunden daneben (docs §6).
  const endOfToday = berlinInputToIso(`${berlinDateISO(new Date().toISOString())}T23:59`);
  if (!endOfToday) return null;

  const { data, error, count } = await supabase
    .from("reminder_touches")
    // `touch_kind` und `appointment_at` kommen mit, weil sie beim Sofort-Touch
    // die Frist entscheiden — seine eigene Fälligkeit ist der Zeitpunkt seiner
    // Entstehung und taugt dafür nicht (lib/dueState.ts).
    .select("due_at, touch_kind, appointment_at", { count: "exact" })
    .eq("workspace_id", access.workspace_id)
    // Die Seitenleiste ist strikt persönlich (siehe layout.tsx) — die
    // Team-Ansicht der Seite ist eine bewusste Umschaltung, kein Standard.
    .eq("assigned_user_id", scopeUserId)
    .is("superseded_at", null)
    .is("done_at", null)
    .lte("due_at", endOfToday)
    .order("due_at", { ascending: true })
    .range(0, ROW_CAP - 1);

  if (error) return null;
  // `reminder_touches.due_at` ist echtes `timestamptz` — die Kaskade rechnet
  // genau darauf („eine Stunde vorher"), hier ist die Uhrzeit die Aussage. Der
  // Sofort-Touch ist die Ausnahme, und `reminderDueSpec` ist genau die Stelle,
  // an der die Seite dieselbe Ausnahme liest.
  const rows = (
    (data ?? []) as unknown as { due_at: string | null; touch_kind: string | null; appointment_at: string | null }[]
  ).map((r) => ({ due_at: r.due_at, spec: reminderDueSpec(r) }));
  return tally(rows, count ?? null);
}

/**
 * Die eine Ablage-Liste mit offener Handlung. `count: 'exact'` mit
 * `range(0, 0)`: Postgres zählt, die Antwort trägt eine einzige Zeile (Muster
 * `loadDropoutCounts`). Kein Überfällig-Begriff — eine Absage mit Aussicht auf
 * einen neuen Termin hat kein Datum, an dem sie zu spät wird.
 */
async function countAblage(supabase: Supabase, access: AccessContext): Promise<NavCount | null> {
  const { error, count } = await supabase
    .rpc(
      "dropout_lists",
      {
        p_workspace_id: access.workspace_id,
        p_list: ABLAGE_LIST,
        p_effective_user_id: access.effective_user_id,
      },
      { count: "exact" },
    )
    .range(0, 0);

  if (error || count == null) return null;
  return { total: count, overdue: 0 };
}

/**
 * Alle drei Zähler in einem Bündel. Wirft nie und blockiert nie länger als
 * `DEADLINE_MS`; jeder Zweig fällt einzeln auf `null` zurück, damit ein
 * fehlendes Recycling-Schema nicht auch den Erinnerungs-Zähler mitnimmt.
 */
export async function loadNavCounts(supabase: Supabase, access: AccessContext): Promise<NavCounts> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), DEADLINE_MS);
  });

  try {
    const [nachfassen, erinnerungen, ablage] = await Promise.all([
      withDeadline(countNachfassen(supabase, access), deadline),
      withDeadline(countErinnerungen(supabase, access), deadline),
      withDeadline(countAblage(supabase, access), deadline),
    ]);
    return { nachfassen, erinnerungen, ablage };
  } catch {
    return EMPTY_NAV_COUNTS;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
