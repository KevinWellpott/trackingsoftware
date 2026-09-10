// Der Aufgaben-Zähler der Seitenleiste.
//
// WARUM ÜBERHAUPT: /nachfassen erzeugt Arbeit, ohne dass die Navigation davon
// sprach. Wer nicht von sich aus hineinklickt, erfährt nie, dass dort etwas
// liegt — bei einem System, das Fälligkeiten selbst erzeugt, ist das der
// Unterschied zwischen benutzt und vergessen.
//
// FRÜHER WAREN ES DREI, DANN ZWEI, JETZT EINER. Der Erinnerungs-Zähler hing an
// der Kaskade und ist mit ihr gefallen; der Ablage-Zähler ist mit dem Rückbau
// der Ablage gefallen (Begründung bei `countNachfassen` unten). Übrig ist der
// eine Zweig, der eine Frage beantwortet, die man abarbeiten kann.
//
// PREIS: Die Seitenleiste steht in `(dashboard)/layout.tsx` und wird auf JEDER
// Seite gebaut. Eine Abfrage, die nur die Spalte `due_at` liefert — sie hängt
// sich in das Bündel ein, das das Layout ohnehin abwartet (Listen, Ansichten,
// Datensicht), und kostet damit einen Roundtrip, keine Summe.
//
// UND EINE FRIST: Zusätzlich läuft eine Deadline mit. Kommt die Zahl nicht
// rechtzeitig, rendert die Navigation ohne sie. Lieber kein Zähler als eine
// hängende Navigation — die Zahl ist eine Beigabe, das Menü ist es nicht.
//
// EHRLICHKEIT: Fehlt eine Migration, erscheint GAR KEIN Zähler statt einer 0.
// Eine 0 wäre eine Behauptung über die Daten („nichts fällig"), die niemand
// geprüft hat; genau die Verwechslung, gegen die auch die roten Hinweise auf
// den Seiten selbst stehen (Muster `loadRecycleTasks`, `loadDropoutList`).

import type { AccessContext } from "@/lib/access";
import { berlinDateISO } from "@/lib/apptTime";
import { dueRefNow, isOverdue } from "@/lib/dueState";
import { isStaleDue } from "@/lib/staleTasks";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Ein Zähler. `null` heißt „nicht ermittelbar" — nicht „null Aufgaben". */
export type NavCount = { total: number; overdue: number };

export type NavCounts = {
  nachfassen: NavCount | null;
};

export const EMPTY_NAV_COUNTS: NavCounts = { nachfassen: null };

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
 * Eine Zahl mit Frist. Der Fehlerfall und der Zeitfall sind derselbe Ausgang:
 * kein Zähler. Der `catch` hängt am Versprechen selbst und nicht am Rennen —
 * eine später eintreffende Ablehnung darf den Prozess nicht mitnehmen.
 */
function withDeadline<T>(work: Promise<T>, signal: Promise<null>): Promise<T | null> {
  return Promise.race([work.catch(() => null), signal]);
}

/** Fällig/überfällig aus einer Liste von Fälligkeiten — `count` schlägt `length`. */
function tally(dueAts: (string | null)[], exact: number | null): NavCount {
  const ref = dueRefNow();
  let overdue = 0;
  // Tages-Körnung, ausnahmslos: `next_recycle_at` ist eine `date`-Spalte
  // (Wochen-Kadenz, keine Uhrzeit-Präzision, docs §6). Nach dem Datentyp
  // gelesen wäre ab 02:00 Berliner Zeit alles überfällig — und weil die RPC
  // ohnehin nur Fälliges liefert, wäre schlicht ALLES überfällig.
  for (const d of dueAts) if (isOverdue(d, "day", ref)) overdue++;
  return { total: exact ?? dueAts.length, overdue };
}

/**
 * Die fälligen Aufgaben von /nachfassen: dieselbe RPC, die die Seite liest, nur
 * auf die Fälligkeitsspalte reduziert.
 *
 * DER ZÄHLER FÄHRT DIESELBEN SCHNITTE WIE DIE SEITE — eine bewusste Abkehr von
 * der früheren Regel („das Badge zählt mehr, die Seite erklärt die Differenz",
 * docs §5.4). Die Altlasten (lib/staleTasks.ts) blendet die Seite aus, nennt sie
 * aber in derselben Zeile; als Differenz im Badge wären sie genau die Zahl,
 * über die sich der Auftraggeber beschwert hat: eine Mahnung ohne Adressat.
 *
 * ── WARUM HIER NUR NOCH `recycle_tasks` STEHT ─────────────────────────────
 * Bis zum Rückbau las dieser Zähler BEIDE Nachfassen-RPCs und filterte aus
 * `nachfassen_tasks` lediglich den LinkedIn-Zweig heraus. Die zweite Welle hat
 * aber drei weitere Zweige von der Seite genommen — Telefon-Rückruf, Setting-
 * und Closing-Wiedervorlage stehen jetzt in der Terminliste (docs §1) —, und
 * der Zähler wurde nicht nachgezogen: Das Badge zeigte 14, die Seite darunter
 * zwei Karten. `/nachfassen` trägt seither GENAU EINE Quelle
 * (`getNachfassenTasks` → `loadRecycleTasks`), also tut es dieser Zähler auch.
 *
 * DARAUS FOLGT DIESELBE PFLICHT FÜR DEN NÄCHSTEN UMBAU, und sie gilt in BEIDE
 * Richtungen: Die Quellenliste hier ist an die der Seite gebunden. Ein Badge,
 * das weniger zählt als die Seite darunter, ist genauso falsch wie eines, das
 * mehr zählt; nur fällt es später auf.
 *
 * ── UND WARUM ES KEINEN ABLAGE-ZÄHLER MEHR GIBT ───────────────────────────
 * Er zählte `dropout_lists('ersatztermin_offen')` — die eine Liste mit einer
 * offenen Handlung. Genau diese Liste hat der Rückbau aus der Ablage entfernt
 * (lib/dropoutLists.ts): Ein Lead, der abgesagt hat und noch keinen Ersatz
 * trägt, ist kein Archiv-Eintrag, sondern der Normalfall der täglichen
 * Arbeitsliste — er steht dort gold in /termine. Das Badge zeigte damit eine
 * Zahl aus einer Menge, die es in der Oberfläche nicht mehr gab, und führte auf
 * eine DISJUNKTE Ansicht („Ausgeschieden").
 *
 * Umgehängt wurde es nicht, sondern gestrichen: Beide verbliebenen
 * Ablage-Ansichten sind Aktenschränke, die über Monate wachsen und nie auf null
 * gehen. „Ein Badge auf einem Archiv, das nie auf null geht, ist eine Mahnung
 * ohne Adressat" (docs §5.4) — das ist wörtlich dieser Fall.
 *
 * Und /termine hat bewusst KEINEN Ersatz-Zähler bekommen: Sein Gold ist aus
 * Zustand, Absage, Nachfass-Stempel und Berliner Tagesgrenze ABGELEITET
 * (lib/dranRegel.ts). Die Navigation müsste dafür entweder dieselben Zeilen
 * laden, die die Seite lädt — auf jeder Seite —, und oberhalb des Fensters
 * trotzdem schweigen, oder die Regel ein zweites Mal als PostgREST-Filter
 * formulieren. Genau dagegen gibt es dranRegel.ts. Dazu kommt: /termine ist die
 * Fläche, die man ohnehin öffnet; ein Badge spricht für eine Seite, die man
 * sonst nicht aufmacht.
 */
async function countNachfassen(supabase: Supabase, access: AccessContext): Promise<NavCount | null> {
  const today = berlinDateISO(new Date().toISOString());
  const scopeUserId = access.effective_user_id ?? access.user.id;

  const recycle = await supabase
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
    .range(0, ROW_CAP - 1);

  if (recycle.error) return null;
  // Fehlt die exakte Zahl, gibt es keinen Zähler. `(count ?? 0)` hätte die
  // fehlende Auskunft stillschweigend als „nichts fällig" verbucht: genau die
  // halbe Wahrheit, gegen die eine Zeile weiter oben schon der Fehlerfall steht.
  if (recycle.count == null) return null;

  const rows = (recycle.data ?? []) as unknown as { due_at: string | null }[];

  // Der Deckel und der Schnitt vertragen sich nicht: `count` ist exakt, das
  // Fenster ist es nicht — und weil aufsteigend nach Fälligkeit sortiert wird,
  // stehen ausgerechnet die ÄLTESTEN (also die wegzuschneidenden) Zeilen vorn.
  // Wurde abgeschnitten, lässt sich die gefilterte Zahl nicht mehr ermitteln,
  // und dann gibt es hier kein Badge statt einer zu kleinen Zahl (docs §5.4:
  // `null` heißt „nicht ermittelbar", nicht „nichts fällig").
  if (recycle.count > rows.length) return null;

  const due: (string | null)[] = [];
  for (const r of rows) {
    if (isStaleDue("recycling", r.due_at, today)) continue;
    due.push(r.due_at);
  }
  // `due.length` statt `count`: Nach dem Schnitt oben ist die gefilterte Liste
  // die Wahrheit, und dass sie vollständig ist, hat die Deckel-Prüfung gerade
  // festgestellt.
  return tally(due, due.length);
}

/**
 * Der Zähler in einem Bündel. Wirft nie und blockiert nie länger als
 * `DEADLINE_MS`; ein Fehler fällt auf `null` zurück, nicht auf eine 0.
 *
 * Die Bündel-Form bleibt, obwohl nur noch ein Zweig darin steht: Seitenleiste,
 * Quicklink-Streifen und mobiler Menü-Punkt nehmen `NavCounts` entgegen, und
 * der nächste Zähler soll sich einhängen können, ohne drei Signaturen zu
 * drehen.
 */
export async function loadNavCounts(supabase: Supabase, access: AccessContext): Promise<NavCounts> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), DEADLINE_MS);
  });

  try {
    const nachfassen = await withDeadline(countNachfassen(supabase, access), deadline);
    return { nachfassen };
  } catch {
    return EMPTY_NAV_COUNTS;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
