import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { getAccessContext } from "@/lib/access";
import { berlinDateISO } from "@/lib/apptTime";
import { kundenKennzahlen } from "@/lib/umsatz";
import type { KostenDaten, KostenPosition, KundeFinanz, Vereinbarung } from "@/lib/finanzen";
import type {
  AblageEintrag,
  AgendaPunkt,
  Kunde,
  KundenAufgabe,
  KundenBaustein,
  KundenCheckliste,
  KundenLogEintrag,
  KundenMeeting,
  KundenRate,
  KundenVertrag,
  KundenZahlung,
  TeamMitglied,
  Vorlage,
  VorlageDatei,
  VorlagePunkt,
} from "@/lib/kunden";

// Server-Seite des Kundenspace (Migration 0047). Getrennt von `kunden.ts`, weil
// diese Datei `next/headers` zieht.
//
// Jeder Lesefehler WIRFT (U4, B17): Ein Ladefehler darf nie aussehen wie
// „nichts offen" oder „keine Agenda".

export type InternRechte = {
  /** Kundenakte und Fulfillment: alle Titan-Mitglieder. */
  kunden: boolean;
  /** Geld: Titan-Mitglieder, die Plattform-Admin sind. */
  umsatz: boolean;
  /** Die Rechte ließen sich nicht prüfen. Seiten zeigen dann einen Fehler, kein 404. */
  fehler?: boolean;
};

export const KEINE_INTERN_RECHTE: InternRechte = { kunden: false, umsatz: false };

/**
 * Die Rechte stehen in der DATENBANK (`intern_rechte()`), an derselben Stelle
 * wie die RLS. Fehlt die Migration, gibt es die Bereiche schlicht nicht.
 * Jeder andere Fehler wird als `fehler` gemeldet, die Seitenleiste bleibt stehen.
 */
export const getInternRechte = cache(async function getInternRechte(): Promise<InternRechte> {
  const access = await getAccessContext();
  if (!access) return KEINE_INTERN_RECHTE;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("intern_rechte", { p_workspace_id: access.workspace_id });
  // PGRST202 / 42883: Die Funktion gibt es nicht, Migration 0047 fehlt noch.
  if (error) {
    return error.code === "PGRST202" || error.code === "42883" ? KEINE_INTERN_RECHTE : { ...KEINE_INTERN_RECHTE, fehler: true };
  }
  if (!data) return KEINE_INTERN_RECHTE;
  const row = (Array.isArray(data) ? data[0] : data) as { kunden?: boolean; umsatz?: boolean } | undefined;
  return { kunden: row?.kunden === true, umsatz: row?.umsatz === true };
});

export async function loadInternTeam(): Promise<TeamMitglied[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("intern_team");
  if (error) throw new Error(`Team nicht ladbar: ${error.message}`);
  return (data ?? []) as TeamMitglied[];
}

type Client = Awaited<ReturnType<typeof createClient>>;

function alle<T>(
  supabase: Client,
  tabelle: string,
  sortierung: string[],
  opt: { spalten?: string; filter?: [string, string] } = {},
): Promise<T[]> {
  return fetchAllRows<T>((from, to) => {
    let q = supabase.from(tabelle).select(opt.spalten ?? "*");
    if (opt.filter) q = q.eq(opt.filter[0], opt.filter[1]);
    for (const s of sortierung) q = q.order(s);
    return q.range(from, to) as never;
  });
}

// ── Finanzen ───────────────────────────────────────────────────────────────

export type KundenGeld = KundeFinanz & {
  vertrag: KundenVertrag;
  rohRaten: KundenRate[];
  zahlungen: KundenZahlung[];
};

/**
 * Geld je Kunde, fertig gerechnet. Nur mit `rechte.umsatz` aufrufen: Sonst
 * liefert die RLS leere Mengen, und das sähe aus wie „nichts kassiert".
 */
export async function loadGeld(
  kunden: readonly Pick<Kunde, "id" | "name">[],
  heute: string,
  kundeId?: string,
): Promise<Map<string, KundenGeld>> {
  const supabase = await createClient();
  const filter: [string, string] | undefined = kundeId ? ["kunde_id", kundeId] : undefined;
  const [vertraege, raten, zahlungen, vereinbarungen] = await Promise.all([
    alle<KundenVertrag>(supabase, "kunden_vertraege", ["kunde_id"], { filter }),
    alle<KundenRate>(supabase, "kunden_raten", ["faellig_am", "id"], { filter }),
    alle<KundenZahlung>(supabase, "kunden_zahlungen", ["eingang_am", "id"], { filter }),
    alle<Vereinbarung & { kunde_id: string }>(supabase, "kunden_vereinbarungen", ["created_at", "id"], { filter }),
  ]);

  const r = gruppiert(raten.map((x) => ({ ...x, betrag: Number(x.betrag) })));
  const z = gruppiert(zahlungen.map((x) => ({ ...x, betrag: Number(x.betrag) })));
  const v = gruppiert(vereinbarungen.map((x) => ({ ...x, betrag: Number(x.betrag) })));
  const name = new Map(kunden.map((k) => [k.id, k.name]));

  const out = new Map<string, KundenGeld>();
  for (const roh of vertraege) {
    const id = roh.kunde_id;
    if (!name.has(id)) continue;
    const vertrag = { ...roh, vertragswert: Number(roh.vertragswert) };
    const rohRaten = r.get(id) ?? [];
    const kz = z.get(id) ?? [];
    out.set(id, {
      id,
      name: name.get(id)!,
      vertrag,
      rohRaten,
      zahlungen: kz,
      vereinbarungen: v.get(id) ?? [],
      k: kundenKennzahlen(vertrag, rohRaten, kz, heute),
    });
  }
  return out;
}

function gruppiert<T extends { kunde_id: string }>(rows: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of rows) {
    const liste = m.get(x.kunde_id);
    if (liste) liste.push(x);
    else m.set(x.kunde_id, [x]);
  }
  return m;
}

export async function loadKosten(): Promise<KostenDaten> {
  const supabase = await createClient();
  const [positionen, betraege, monate] = await Promise.all([
    alle<KostenPosition>(supabase, "kosten_positionen", ["name", "id"]),
    alle<KostenDaten["betraege"][number]>(supabase, "kosten_betraege", ["position_id", "gueltig_ab"]),
    alle<KostenDaten["monate"][number]>(supabase, "kosten_monate", ["position_id", "monat"]),
  ]);
  return {
    positionen,
    betraege: betraege.map((b) => ({ ...b, betrag: Number(b.betrag) })),
    monate: monate.map((m) => ({ ...m, ist: m.ist === null ? null : Number(m.ist) })),
  };
}

export async function loadRuecklageProzent(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("intern_einstellungen").select("steuerruecklage_prozent").maybeSingle();
  if (error) throw new Error(`Einstellungen nicht ladbar: ${error.message}`);
  return Number((data as { steuerruecklage_prozent: number } | null)?.steuerruecklage_prozent ?? 0);
}

// ── Kunden ─────────────────────────────────────────────────────────────────

export async function loadKundenKurz(): Promise<Kunde[]> {
  return alle<Kunde>(await createClient(), "kunden", ["name", "id"]);
}

export type KundenListenZeile = Kunde & {
  termin: string | null;
  agenda: string[];
  letztesMeeting: string | null;
  checklisten: number;
  bausteine: { erledigt: number; gesamt: number };
};

export async function loadKundenListe(): Promise<KundenListenZeile[]> {
  const supabase = await createClient();
  const [kunden, meetings, punkte, listen, bausteine] = await Promise.all([
    alle<Kunde>(supabase, "kunden", ["name", "id"]),
    alle<Pick<KundenMeeting, "id" | "kunde_id" | "status" | "termin">>(supabase, "kunden_meetings", ["id"], {
      spalten: "id, kunde_id, status, termin",
    }),
    alle<Pick<AgendaPunkt, "meeting_id" | "text">>(supabase, "kunden_meeting_punkte", ["sort_order", "created_at", "id"], {
      spalten: "meeting_id, text",
    }),
    alle<{ kunde_id: string }>(supabase, "kunden_checklisten", ["id"], { spalten: "kunde_id" }),
    alle<{ kunde_id: string; erledigt_am: string | null }>(supabase, "kunden_bausteine", ["id"], {
      spalten: "kunde_id, erledigt_am",
    }),
  ]);

  const jeKunde = gruppiert(meetings);
  const listenJe = gruppiert(listen);
  const bausteineJe = gruppiert(bausteine);
  const agenda = new Map<string, string[]>();
  for (const p of punkte) agenda.set(p.meeting_id, [...(agenda.get(p.meeting_id) ?? []), p.text]);

  return kunden.map((k) => {
    const eigene = jeKunde.get(k.id) ?? [];
    const geplant = eigene.find((m) => m.status === "geplant");
    let letztes: string | null = null;
    for (const m of eigene) {
      if (m.status !== "stattgefunden" || !m.termin) continue;
      if (!letztes || Date.parse(m.termin) > Date.parse(letztes)) letztes = m.termin;
    }
    const b = bausteineJe.get(k.id) ?? [];
    return {
      ...k,
      termin: geplant?.termin ?? null,
      agenda: geplant ? (agenda.get(geplant.id) ?? []) : [],
      letztesMeeting: letztes,
      checklisten: listenJe.get(k.id)?.length ?? 0,
      bausteine: { erledigt: b.filter((x) => x.erledigt_am).length, gesamt: b.length },
    };
  });
}

export type KundenAkte = {
  kunde: Kunde;
  geplant: KundenMeeting;
  protokolle: KundenMeeting[];
  punkte: AgendaPunkt[];
  aufgaben: KundenAufgabe[];
  checklisten: KundenCheckliste[];
  bausteine: KundenBaustein[];
  ablage: AblageEintrag[];
  log: KundenLogEintrag[];
  closing: { id: string; call_at: string | null; status: string } | null;
  kundenOrg: { id: string; name: string } | null;
};

export async function loadKundenAkte(id: string): Promise<KundenAkte | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("kunden").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Kunde nicht ladbar: ${error.message}`);
  if (!data) return null;
  const kunde = data as Kunde;
  const filter: [string, string] = ["kunde_id", id];

  const [meetings, punkte, aufgaben, checklisten, bausteine, ablage, log, closing, org] = await Promise.all([
    alle<KundenMeeting>(supabase, "kunden_meetings", ["created_at", "id"], { filter }),
    alle<AgendaPunkt>(supabase, "kunden_meeting_punkte", ["sort_order", "created_at", "id"], { filter }),
    alle<KundenAufgabe>(supabase, "kunden_aufgaben", ["created_at", "id"], { filter }),
    alle<KundenCheckliste>(supabase, "kunden_checklisten", ["created_at", "id"], { filter }),
    alle<KundenBaustein>(supabase, "kunden_bausteine", ["sort_order", "created_at", "id"], { filter }),
    alle<AblageEintrag>(supabase, "kunden_ablage", ["created_at", "id"], { filter }),
    supabase.from("kunden_log").select("*").eq("kunde_id", id).order("created_at", { ascending: false }).limit(200),
    kunde.closing_call_id
      ? supabase.from("closing_calls").select("id, call_at, status").eq("id", kunde.closing_call_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    kunde.kunden_workspace_id
      ? supabase.from("workspaces").select("id, name").eq("id", kunde.kunden_workspace_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const fehler = log.error ?? closing.error ?? org.error;
  if (fehler) throw new Error(`Akte nicht vollständig ladbar: ${fehler.message}`);
  const geplant = meetings.find((m) => m.status === "geplant");
  if (!geplant) throw new Error("Die Akte hat kein geplantes Meeting.");

  return {
    kunde,
    geplant,
    protokolle: meetings
      .filter((m) => m.status === "stattgefunden")
      .sort((a, b) => Date.parse(b.termin ?? b.created_at) - Date.parse(a.termin ?? a.created_at)),
    punkte,
    aufgaben,
    checklisten,
    bausteine,
    ablage: ablage.reverse(),
    log: (log.data ?? []) as KundenLogEintrag[],
    closing: (closing.data as KundenAkte["closing"]) ?? null,
    kundenOrg: (org.data as KundenAkte["kundenOrg"]) ?? null,
  };
}

export async function loadVorlagen(): Promise<Vorlage[]> {
  const supabase = await createClient();
  const [vorlagen, punkte] = await Promise.all([
    alle<Omit<Vorlage, "punkte">>(supabase, "fulfillment_vorlagen", ["name", "id"]),
    alle<VorlagePunkt>(supabase, "fulfillment_vorlage_punkte", ["sort_order", "created_at", "id"]),
  ]);
  return vorlagen.map((v) => ({ ...v, punkte: punkte.filter((p) => p.vorlage_id === v.id) }));
}

/**
 * Dateien einer Vorlage (Migration 0052). `verfuegbar: false` heißt „Migration
 * fehlt“ — dann zeigt die Seite einen Hinweis statt einer leeren Liste.
 */
export async function loadVorlageDateien(vorlageId: string): Promise<{ dateien: VorlageDatei[]; verfuegbar: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fulfillment_vorlage_dateien")
    .select("id, vorlage_id, titel, dateiname, storage_path, groesse_bytes, mime, created_at")
    .eq("vorlage_id", vorlageId)
    .order("created_at", { ascending: false });
  if (error) return { dateien: [], verfuegbar: false };
  return { dateien: (data ?? []) as VorlageDatei[], verfuegbar: true };
}

// ── Seitenleiste ───────────────────────────────────────────────────────────

const BADGE_FRIST_MS = 1500;

export type InternNavDaten = InternRechte & { meineUeberfaelligen: { total: number; overdue: number } | null };

/**
 * „Muss ich mich ums Geld kümmern?": meine Kunden mit Überfälligem. Dieselbe
 * Rechnung wie /umsatz, keine zweite Regel in SQL. Wirft nie und wartet nie
 * länger als die Frist; null heißt „nicht ermittelbar", nicht 0 (U4).
 */
export const getInternNav = cache(async function getInternNav(): Promise<InternNavDaten> {
  const rechte = await getInternRechte();
  const ohne = { ...rechte, meineUeberfaelligen: null };
  if (!rechte.umsatz) return ohne;

  const zaehlen = async () => {
    const access = await getAccessContext();
    if (!access) return null;
    const wer = access.effective_user_id ?? access.user.id;
    const meine = (await loadKundenKurz()).filter((k) => k.betreuer_user_id === wer);
    if (!meine.length) return { total: 0, overdue: 0 };
    const geld = await loadGeld(meine, berlinDateISO(new Date().toISOString()));
    const n = [...geld.values()].filter((g) => g.k.ueberfaellig > 0).length;
    return { total: n, overdue: n };
  };

  let uhr: ReturnType<typeof setTimeout> | undefined;
  const frist = new Promise<null>((fertig) => {
    uhr = setTimeout(() => fertig(null), BADGE_FRIST_MS);
  });
  const zahl = await Promise.race([zaehlen().catch(() => null), frist]);
  clearTimeout(uhr);
  return { ...rechte, meineUeberfaelligen: zahl };
});

// ── Zahlungserinnerungen ───────────────────────────────────────────────────

export type Erinnerung = { tag: string; user_id: string | null };

/** Je Kunde der jüngste „Erinnert"-Stempel, aus dem Verlauf gelesen. */
export async function loadErinnerungen(): Promise<Map<string, Erinnerung>> {
  const zeilen = await alle<{ kunde_id: string; bereich: string; created_at: string; user_id: string | null }>(
    await createClient(),
    "kunden_log",
    ["created_at", "id"],
    { spalten: "kunde_id, bereich, created_at, user_id", filter: ["art", "erinnert"] },
  );
  // Nur der Finanzbereich zählt: Den Fulfillment-Verlauf kann jedes Mitglied beschreiben.
  return new Map(zeilen.filter((z) => z.bereich === "finanz").map((z) => [z.kunde_id, { tag: berlinDateISO(z.created_at), user_id: z.user_id }]));
}
