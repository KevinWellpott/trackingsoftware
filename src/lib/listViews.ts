// Smart Views: Typ, Validierung und Query-Aufbau — an EINER Stelle.
//
// Die Filter kommen als jsonb aus der DB und sind damit per Definition
// ungeprueft: eine aeltere App-Version, ein Handeingriff oder ein spaeter
// entfernter Filter koennen alles Moegliche hinterlassen. `parseViewFilters`
// ist deshalb die einzige Tuer, durch die sie hereinkommen.
//
// Bewusst framework-frei (kein "use client", kein "use server"): Route,
// Sidebar-Zaehler und Editor-Modal teilen sich denselben Code.

import type { SelectableCategory } from "@/lib/categories";

export type ViewFilters = {
  /** Leer/fehlend = alle Listen im Scope. */
  listIds?: string[];
  categories?: string[];
  /** Zuletzt GESENDETE Stufe (0 = noch keins) — nicht die ausstehende. */
  fuStages?: number[];
  /** Nur Kontakte mit faelliger Wiedervorlage. */
  dueOnly?: boolean;
  answered?: boolean;
  appointmentSet?: boolean;
  /** true = nur blockierte, false = nur nicht blockierte, fehlend = egal. */
  blocked?: boolean;
  /** Pitch-Datum von/bis (YYYY-MM-DD). */
  pitchedFrom?: string;
  pitchedTo?: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function strArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && x.length > 0);
  return out.length ? out : undefined;
}

function numArray(v: unknown, min: number, max: number): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = [...new Set(v.filter((x): x is number => typeof x === "number" && x >= min && x <= max))];
  return out.length ? out : undefined;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function isoDate(v: unknown): string | undefined {
  return typeof v === "string" && ISO_DATE.test(v) ? v : undefined;
}

/** Unbekanntes jsonb → geprueftes ViewFilters. Ein Ordner liefert null. */
export function parseViewFilters(raw: unknown): ViewFilters | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const f: ViewFilters = {
    listIds: strArray(r.listIds),
    categories: strArray(r.categories),
    fuStages: numArray(r.fuStages, 0, 3),
    dueOnly: bool(r.dueOnly),
    answered: bool(r.answered),
    appointmentSet: bool(r.appointmentSet),
    blocked: bool(r.blocked),
    pitchedFrom: isoDate(r.pitchedFrom),
    pitchedTo: isoDate(r.pitchedTo),
  };
  // Alle Schluessel weglassen, die nichts einschraenken — sonst sieht eine
  // leere Ansicht im Editor aus, als haette sie Filter.
  for (const k of Object.keys(f) as (keyof ViewFilters)[]) {
    if (f[k] === undefined) delete f[k];
  }
  return f;
}

/** true, wenn die Ansicht ueberhaupt etwas einschraenkt. */
export function hasAnyFilter(f: ViewFilters | null): boolean {
  return !!f && Object.keys(f).length > 0;
}

/** Kurzbeschreibung fuer Sidebar-Titel und Editor („FU2 · fällig · 2 Listen"). */
export function describeFilters(f: ViewFilters | null, listCount?: number): string {
  if (!hasAnyFilter(f)) return "Alle Kontakte";
  const parts: string[] = [];
  if (f!.listIds?.length) parts.push(`${f!.listIds.length} ${f!.listIds.length === 1 ? "Liste" : "Listen"}`);
  if (f!.categories?.length) parts.push(f!.categories.join("/"));
  if (f!.fuStages?.length) parts.push(f!.fuStages.map((n) => (n === 0 ? "kein FU" : `FU${n}`)).join("/"));
  if (f!.dueOnly) parts.push("fällig");
  if (f!.answered === true) parts.push("geantwortet");
  if (f!.answered === false) parts.push("ohne Antwort");
  if (f!.appointmentSet === true) parts.push("mit Termin");
  if (f!.appointmentSet === false) parts.push("ohne Termin");
  if (f!.blocked === true) parts.push("blockiert");
  if (f!.pitchedFrom || f!.pitchedTo) parts.push(`${f!.pitchedFrom ?? "…"}–${f!.pitchedTo ?? "…"}`);
  if (listCount != null && !f!.listIds?.length) parts.push(`${listCount} Listen`);
  return parts.join(" · ");
}

/**
 * Eine einzelne Einschraenkung, uebersetzt in die Supabase-Filter-API.
 *
 * Bewusst als Datenstruktur statt als Funktion, die den Query-Builder
 * durchreicht: ein Generic ueber den Builder (`T extends Filterable<T>`)
 * laeuft in TS in „type instantiation is excessively deep". Der Aufrufer
 * legt die Operationen in einer Schleife auf seine konkrete Query — und die
 * Liste laesst sich nebenbei direkt pruefen.
 */
export type FilterOp =
  | { op: "in"; column: string; values: (string | number)[] }
  | { op: "eq"; column: string; value: string | number | boolean }
  | { op: "isNull"; column: string }
  | { op: "notNull"; column: string }
  /** `NOT (spalte IS TRUE)` — trifft false UND NULL. */
  | { op: "notIsTrue"; column: string }
  | { op: "gte"; column: string; value: string }
  | { op: "lte"; column: string; value: string }
  /** Roher PostgREST-`or()`-Ausdruck — fuer „NULL oder in (…)". */
  | { op: "or"; expr: string };

/**
 * Filter einer Ansicht in Query-Operationen uebersetzen.
 *
 * `allowedListIds` ist die Menge, die der Aufrufer sehen DARF (Scope). Die
 * Ansicht waehlt daraus aus, kann aber nie darueber hinaus — sonst waere eine
 * Ansicht ein Weg an der Datensicht vorbei.
 *
 * `today` kommt von aussen (Berlin-Kalendertag), damit Server und Client
 * dasselbe „faellig" meinen.
 */
export function viewFilterOps(
  filters: ViewFilters | null,
  allowedListIds: string[],
  today: string,
): FilterOp[] {
  const f = filters ?? {};
  const scoped = f.listIds?.length ? f.listIds.filter((id) => allowedListIds.includes(id)) : allowedListIds;
  const ops: FilterOp[] = [{ op: "in", column: "list_id", values: scoped }];

  if (f.categories?.length) ops.push({ op: "in", column: "answer_category", values: f.categories });
  if (f.fuStages?.length) {
    // WICHTIG: `follow_up_number` kennt laut CHECK nur NULL oder 1–3 — eine 0
    // steht nie in der DB. „Kein Follow-up" ist also NULL, und ein blosses
    // in(0) faende nichts. Sind NULL und Stufen zugleich gewaehlt, braucht es
    // ein or(), weil in() NULL grundsaetzlich nicht trifft.
    const stages = f.fuStages.filter((n) => n > 0);
    const wantsNone = f.fuStages.includes(0);
    if (wantsNone && stages.length) {
      ops.push({ op: "or", expr: `follow_up_number.is.null,follow_up_number.in.(${stages.join(",")})` });
    } else if (wantsNone) {
      ops.push({ op: "isNull", column: "follow_up_number" });
    } else {
      ops.push({ op: "in", column: "follow_up_number", values: stages });
    }
  }
  // `answered` und `appointment_set` sind NULLABLE, und NULL ist der Normalfall
  // (frisch gepitcht = noch nichts passiert). Ein eq(false) wuerde genau diese
  // Mehrheit verlieren. Die ganze App liest „nicht true" als Nein — siehe
  // isDueFollowUp und den nachfassen_tasks-RPC.
  if (f.answered === true) ops.push({ op: "eq", column: "answered", value: true });
  if (f.answered === false) ops.push({ op: "notIsTrue", column: "answered" });
  if (f.appointmentSet === true) ops.push({ op: "eq", column: "appointment_set", value: true });
  if (f.appointmentSet === false) ops.push({ op: "notIsTrue", column: "appointment_set" });
  if (f.blocked === true) ops.push({ op: "notNull", column: "blocked_at" });
  if (f.blocked === false) ops.push({ op: "isNull", column: "blocked_at" });
  if (f.pitchedFrom) ops.push({ op: "gte", column: "pitched_at", value: f.pitchedFrom });
  if (f.pitchedTo) ops.push({ op: "lte", column: "pitched_at", value: f.pitchedTo });

  if (f.dueOnly) {
    // Identisch zu isDueFollowUp (ListBoardV2) und zum nachfassen_tasks-RPC.
    // Weicht das hier ab, widersprechen sich die Zahlen zwischen den Ansichten.
    ops.push({ op: "notNull", column: "next_follow_up_at" });
    ops.push({ op: "lte", column: "next_follow_up_at", value: today });
    if (f.blocked !== true) ops.push({ op: "isNull", column: "blocked_at" });
    if (f.answered === undefined) ops.push({ op: "notIsTrue", column: "answered" });
    if (f.appointmentSet === undefined) ops.push({ op: "notIsTrue", column: "appointment_set" });
  }

  return ops;
}

/** Baum-Knoten fuer Sidebar und Editor. */
export type ViewNode = {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  filters: ViewFilters | null;
  children: ViewNode[];
};

export type ViewRow = {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  filters: unknown;
};

/**
 * Flache Zeilen → Baum.
 *
 * Waisen (Elternteil ausserhalb des Scopes) haengen an der Wurzel statt zu
 * verschwinden. Zyklen kann die Server-Action zwar nicht entstehen lassen,
 * ein Handeingriff in der DB aber sehr wohl — der Aufbau ist deshalb
 * iterativ und kann nicht in eine Endlosschleife laufen.
 */
export function buildViewTree(rows: ViewRow[]): ViewNode[] {
  const byId = new Map<string, ViewNode>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      name: r.name,
      parent_id: r.parent_id,
      sort_order: r.sort_order,
      filters: parseViewFilters(r.filters),
      children: [],
    });
  }

  const roots: ViewNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : null;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }

  const sort = (nodes: ViewNode[]) => {
    nodes.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "de"));
    for (const n of nodes) sort(n.children);
  };
  sort(roots);
  return roots;
}

/** Alle Nachfahren-Ids eines Knotens — fuer den Zyklusschutz beim Verschieben. */
export function descendantIds(rows: ViewRow[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.parent_id) continue;
    const arr = childrenOf.get(r.parent_id);
    if (arr) arr.push(r.id);
    else childrenOf.set(r.parent_id, [r.id]);
  }
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop() as string;
    for (const child of childrenOf.get(id) ?? []) {
      if (out.has(child)) continue; // Schutz gegen Zyklen in Altdaten
      out.add(child);
      stack.push(child);
    }
  }
  return out;
}

/** Kategorien, die im Editor waehlbar sind — Alt-Werte bleiben aussen vor. */
export type ViewCategory = SelectableCategory;
