"use server";

import { getAccessContext, ownScopeFilter } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

// Globale Suche ueber alle Kanaele.
//
// Anlass: Wer eine Antwort auf LinkedIn bekommt, musste den Namen bisher in
// drei bis vier Listen einzeln suchen — es gab keinen Ort, der ueber Listen
// hinweg sucht. Diese Action durchsucht beide Akquise-Kanaele und den
// Termin-Funnel in einem Rutsch.
//
// Scope: `lists`/`phone_lists` tragen den Owner, `contacts`/`phone_leads`
// nicht. Der Personenfilter laeuft deshalb ueber die Listen-Ebene (owner_name
// hat Vorrang vor created_by_user_id — siehe docs/data-model.md §2), Termine
// ueber die Zuweisung (`assigned_user_id`, Migration 0028). Bei
// workspace-weitem Zugriff liefert `ownScopeFilter` null und es wird nicht
// eingeschraenkt.
//
// WARUM DIESE DATEI SO VORSICHTIG MIT FEHLERN UMGEHT:
// Sie hat frueher jedes `error`-Feld ignoriert und bei einem Fehler still `[]`
// zurueckgegeben. Ein abgelaufener Org-Cookie, ein Statement-Timeout oder eine
// zu lange Filter-URL sahen fuer den Nutzer damit exakt aus wie „nichts
// gefunden" — der haeufigste Grund, warum die Suche als „kaputt" gemeldet
// wurde, war unsichtbar. Jede Quelle prueft ihren Fehler jetzt selbst, loggt
// ihn serverseitig und setzt `failed`; der Dialog unterscheidet sichtbar
// zwischen leerem Ergebnis und Fehlschlag.
//
// Ebenfalls bewusst: Der Listenname haengt per eingebetteter Ressource
// (`lists!inner(name)`) am Treffer, statt vorher alle Listen-IDs zu laden und
// per `.in("list_id", …)` einzuschraenken. Der alte Weg baute eine URL mit
// einer UUID je Liste (ab wenigen hundert Listen reisst das die
// Request-Groessenbegrenzung des Gateways) und war zudem ein Kurzschluss:
// lieferte die Vorabfrage nichts, wurde die Kontaktsuche gar nicht gestellt.
// Die Zugehoerigkeit ist ueber `workspace_id` + RLS ohnehin erzwungen.

export type SearchKind = "contact" | "phone_lead" | "setting" | "closing";

export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string;
  /** Zweite Zeile: Firma, Telefonnummer o. Ae. */
  subtitle: string | null;
  /** Woher der Treffer stammt — bei Kontakten der Listenname. */
  context: string | null;
  href: string;
};

export type SearchResult = {
  hits: SearchHit[];
  /** true, wenn mindestens eine Quelle ihr Limit ausgeschoepft hat. */
  truncated: boolean;
  /**
   * true, wenn mindestens eine Quelle mit einem Fehler zurueckkam (oder gar
   * kein Zugriffskontext da war). Traegt die Unterscheidung „nichts gefunden"
   * vs. „Suche fehlgeschlagen" in die UI. Der Grund bleibt bewusst im
   * Server-Log — er kann Spaltennamen und Filterwerte enthalten.
   */
  failed: boolean;
};

const PER_SOURCE = 25;
const MIN_LEN = 2;
/** Obergrenze fuer den Suchbegriff — haelt die Filter-URL berechenbar kurz. */
const MAX_LEN = 80;
/** Mehr als vier UND-verknuepfte Token grenzen nicht mehr sinnvoll ein. */
const MAX_TOKENS = 4;

const CONTACT_COLUMNS = ["name", "company"];
const LEAD_COLUMNS = ["company", "decider_name", "phone"];
const CALL_COLUMNS = ["lead_name", "company"];

/**
 * Suchbegriff zu einem sicheren `ilike`-Wert fuer einen PostgREST-`or()`.
 *
 * Zwei Ebenen muessen entschaerft werden:
 * 1. `%`, `_` und `\` sind LIKE-Wildcards — sonst sucht „50%" nach allem.
 * 2. Komma und Klammer trennen den or()-Ausdruck. Ein Begriff wie
 *    „Mueller, GmbH" wuerde den Filter sonst in zwei zerreissen. Der Wert
 *    wandert deshalb in Anfuehrungszeichen; darin sind Trennzeichen literal.
 *
 * Reihenfolge ist wichtig: erst LIKE, dann Transport. Die vom ersten Schritt
 * eingefuegten Backslashes werden dabei bewusst noch einmal verdoppelt —
 * PostgREST entfernt genau eine Ebene wieder.
 */
function likeValue(q: string): string {
  const forLike = q.replace(/[\\%_]/g, (m) => `\\${m}`);
  const forTransport = forLike.replace(/["\\]/g, (m) => `\\${m}`);
  return `"%${forTransport}%"`;
}

/** Ein Token gegen eine Spaltengruppe: `name.ilike.X,company.ilike.X`. */
function columnGroup(columns: string[], token: string): string {
  const like = likeValue(token);
  return columns.map((c) => `${c}.ilike.${like}`).join(",");
}

/**
 * Suchbegriff in Token zerlegen.
 *
 * Warum: „Mueller GmbH" fand vorher nichts, wenn „Mueller" im Namen und
 * „GmbH" in der Firma steht — der Begriff wurde als eine Zeichenkette gegen
 * jede Spalte einzeln geprueft. Jedes Token wird deshalb eine eigene
 * ODER-Gruppe ueber die Spalten; die Gruppen sind untereinander UND-verknuepft
 * (jeder weitere `.or()`-Aufruf ist ein eigener Query-Parameter, und PostgREST
 * verknuepft Parameter mit UND). Ergebnis: alle Token muessen vorkommen, jedes
 * darf aber in einer anderen Spalte stehen.
 */
function tokenize(q: string): string[] {
  return q.split(/\s+/).filter(Boolean).slice(0, MAX_TOKENS);
}

/** Sieht der Begriff nach einer Telefonnummer aus? Nur Ziffern und uebliche Trenner. */
const PHONE_SHAPE = /^\+?[\d\s()/.-]+$/;

/**
 * Telefonnummer-Varianten fuer die Suche.
 *
 * Der Import normalisiert Nummern auf reine Ziffern mit optionalem fuehrenden
 * `+` (`normalizePhone` in src/lib/phone-csv.ts). Wer „0170 12 34" tippt, sucht
 * roh also nie eine gespeicherte „+4917012 34". Deshalb dieselbe Regel auf den
 * Suchbegriff anwenden und die gaengigen Praefix-Formen mitprobieren.
 *
 * Das `+` faellt in allen Varianten bewusst weg: gesucht wird per `%…%`, und
 * „4917012" trifft sowohl „+4917012" als auch „004917012". Ein Muster MIT `+`
 * wuerde dagegen jede ohne Laendervorwahl importierte Nummer verfehlen.
 */
function phoneSearchTerms(q: string): string[] {
  if (!PHONE_SHAPE.test(q)) return [];
  const digits = q.replace(/\D/g, "");
  if (digits.length < 4) return [];

  const terms = new Set<string>([digits]);
  if (digits.startsWith("0049")) terms.add(`0${digits.slice(4)}`); // 0049170… -> 0170…
  if (digits.startsWith("00")) terms.add(digits.slice(2)); // 0049170… -> 49170…
  else if (digits.startsWith("0")) terms.add(`49${digits.slice(1)}`); // 0170… -> 49170…
  if (digits.startsWith("49")) terms.add(`0${digits.slice(2)}`); // 49170… -> 0170…
  return [...terms];
}

/**
 * Personenachse fuer Setting-/Closing-Treffer.
 *
 * Spiegelt `personOf()` aus src/lib/personResolution.ts: die Zuweisung
 * entscheidet, der Ersteller greift nur, solange keine Zuweisung existiert.
 * Vorher stand hier `created_by_user_id.eq.<uid>` — damit fand ein Mitglied
 * genau die Termine nicht, die ein Admin FUER es angelegt und ihm zugewiesen
 * hat.
 */
function assignedOrCreatedBy(userId: string): string {
  return `assigned_user_id.eq.${userId},and(assigned_user_id.is.null,created_by_user_id.eq.${userId})`;
}

type SourceError = { code?: string | null; message?: string | null } | null;
type SourceOutcome = { data: unknown; error: SourceError };

/**
 * Migration 0028 laeuft nicht automatisch (docs §7). Solange sie nicht
 * eingespielt ist, kennt PostgREST `assigned_user_id` nicht und antwortet mit
 * 42703 — ohne diesen Zweig verloere jedes Mitglied mit eingeschraenkter
 * Datensicht seine Termin-Treffer komplett. Gleiche Vorsichtsmassnahme wie bei
 * `resolvePlatformAdmin` (src/lib/access.ts) vor Migration 0025.
 */
function isMissingAssignedColumn(error: SourceError): boolean {
  if (!error) return false;
  return error.code === "42703" || (error.message ?? "").includes("assigned_user_id");
}

const EMPTY: SearchResult = { hits: [], truncated: false, failed: false };

/** Eingebettete `lists`/`phone_lists` liefern je nach Beziehung Objekt oder Array. */
function embeddedName(rel: unknown): string | null {
  const row = Array.isArray(rel) ? rel[0] : rel;
  if (!row || typeof row !== "object") return null;
  const name = (row as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

type ContactRow = { id: string; name: string; company: string | null; list_id: string; lists: unknown };
type LeadRow = {
  id: string;
  company: string | null;
  decider_name: string | null;
  phone: string | null;
  list_id: string;
  phone_lists: unknown;
};
type CallRow = { id: string; lead_name: string | null; company: string | null; status: string };

export async function globalSearch(query: string): Promise<SearchResult> {
  // Server Actions sind per direktem POST erreichbar — der Parameter ist erst
  // nach dieser Pruefung verlaesslich ein String.
  const q = (typeof query === "string" ? query : "").trim().slice(0, MAX_LEN);
  if (q.length < MIN_LEN) return EMPTY;

  const access = await getAccessContext();
  if (!access) {
    // Kein Kontext heisst abgelaufene Sitzung oder fehlende Mitgliedschaft —
    // beides ist ein Fehlschlag und darf nicht als „nichts gefunden" erscheinen.
    console.error("globalSearch: kein Zugriffskontext (Sitzung oder Mitgliedschaft fehlt)");
    return { hits: [], truncated: false, failed: true };
  }

  const supabase = await createClient();
  const ws = access.workspace_id;
  const scope = ownScopeFilter(access);
  const tokens = tokenize(q);
  const phoneTerms = phoneSearchTerms(q);

  let failed = false;

  function unwrap<T>(label: string, res: SourceOutcome): T[] {
    if (res.error) {
      console.error(`globalSearch/${label}:`, res.error.message ?? res.error.code ?? "unbekannter Fehler");
      failed = true;
      return [];
    }
    return (res.data ?? []) as T[];
  }

  // ── LinkedIn-Kontakte ────────────────────────────────────────
  // Der Personen-Scope sitzt auf der eingebetteten Liste (`lists`), weil nur
  // sie owner_name/created_by_user_id traegt. `!inner` sorgt dafuer, dass der
  // Filter die Kontakte selbst einschraenkt und nicht bloss die Einbettung.
  let contactsQuery = supabase
    .from("contacts")
    .select("id, name, company, list_id, lists!inner(name)")
    .eq("workspace_id", ws);
  for (const token of tokens) contactsQuery = contactsQuery.or(columnGroup(CONTACT_COLUMNS, token));
  if (scope) contactsQuery = contactsQuery.or(scope, { referencedTable: "lists" });
  const contactsPromise = contactsQuery
    .order("pitched_at", { ascending: false, nullsFirst: false })
    .limit(PER_SOURCE);

  // ── Telefon-Leads ────────────────────────────────────────────
  // Bei einer Telefonnummer NICHT in Token zerlegen: „0170 12 34" ist eine
  // Nummer, keine drei Bedingungen. Der Rohbegriff bleibt in derselben
  // ODER-Gruppe, damit eine Firma wie „1000" weiter gefunden wird.
  const leadGroups = phoneTerms.length
    ? [
        [
          columnGroup(LEAD_COLUMNS, q),
          ...phoneTerms.map((t) => `phone.ilike.${likeValue(t)}`),
        ].join(","),
      ]
    : tokens.map((token) => columnGroup(LEAD_COLUMNS, token));

  let leadsQuery = supabase
    .from("phone_leads")
    .select("id, company, decider_name, phone, list_id, phone_lists!inner(name)")
    .eq("workspace_id", ws);
  for (const group of leadGroups) leadsQuery = leadsQuery.or(group);
  if (scope) leadsQuery = leadsQuery.or(scope, { referencedTable: "phone_lists" });
  const leadsPromise = leadsQuery.limit(PER_SOURCE);

  // ── Termine (Setting/Closing) ────────────────────────────────
  // Termine tragen kein owner_name — dort ist die Zuweisung die Zuordnung.
  const personUserId = access.effective_user_id;

  async function runCallQuery(
    label: string,
    build: (personFilter: string | null) => PromiseLike<SourceOutcome>,
  ): Promise<SourceOutcome> {
    const uid = personUserId;
    if (!uid) return build(null);

    const res = await build(assignedOrCreatedBy(uid));
    if (res.error && isMissingAssignedColumn(res.error)) {
      console.warn(
        `globalSearch/${label}: assigned_user_id nicht verfuegbar (Migration 0028 noch nicht eingespielt) — ` +
          "Fallback auf created_by_user_id",
      );
      return build(`created_by_user_id.eq.${uid}`);
    }
    return res;
  }

  const settingPromise = runCallQuery("setting", (personFilter) => {
    let sq = supabase.from("setting_calls").select("id, lead_name, company, status").eq("workspace_id", ws);
    for (const token of tokens) sq = sq.or(columnGroup(CALL_COLUMNS, token));
    if (personFilter) sq = sq.or(personFilter);
    return sq.order("appointment_at", { ascending: false, nullsFirst: false }).limit(PER_SOURCE);
  });

  const closingPromise = runCallQuery("closing", (personFilter) => {
    let cq = supabase.from("closing_calls").select("id, lead_name, company, status").eq("workspace_id", ws);
    for (const token of tokens) cq = cq.or(columnGroup(CALL_COLUMNS, token));
    if (personFilter) cq = cq.or(personFilter);
    return cq.order("call_at", { ascending: false, nullsFirst: false }).limit(PER_SOURCE);
  });

  const [contactsRes, leadsRes, settingRes, closingRes] = await Promise.all([
    contactsPromise,
    leadsPromise,
    settingPromise,
    closingPromise,
  ]);

  const contacts = unwrap<ContactRow>("contacts", contactsRes);
  const leads = unwrap<LeadRow>("phone_leads", leadsRes);
  const settings = unwrap<CallRow>("setting_calls", settingRes);
  const closings = unwrap<CallRow>("closing_calls", closingRes);

  const hits: SearchHit[] = [
    ...contacts.map((c) => ({
      kind: "contact" as const,
      id: c.id,
      title: c.name,
      subtitle: c.company,
      context: embeddedName(c.lists),
      href: `/lists/${c.list_id}`,
    })),
    ...leads.map((l) => ({
      kind: "phone_lead" as const,
      id: l.id,
      title: l.company ?? l.decider_name ?? "Unbenannter Lead",
      subtitle: [l.decider_name, l.phone].filter(Boolean).join(" · ") || null,
      context: embeddedName(l.phone_lists),
      href: `/telefon/${l.list_id}`,
    })),
    ...settings.map((s) => ({
      kind: "setting" as const,
      id: s.id,
      title: s.lead_name ?? "Unbenannter Lead",
      subtitle: s.company,
      context: s.status,
      href: `/setting/${s.id}`,
    })),
    ...closings.map((c) => ({
      kind: "closing" as const,
      id: c.id,
      title: c.lead_name ?? "Unbenannter Lead",
      subtitle: c.company,
      context: c.status,
      href: `/closing/${c.id}`,
    })),
  ];

  const truncated =
    contacts.length === PER_SOURCE ||
    leads.length === PER_SOURCE ||
    settings.length === PER_SOURCE ||
    closings.length === PER_SOURCE;

  return { hits, truncated, failed };
}
