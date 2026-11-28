"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { getInternRechte } from "@/lib/internData";
import { berlinDateISO } from "@/lib/apptTime";
import {
  ABLAGE_BUCKET,
  ABLAGE_TYPEN,
  KUNDEN_STATUS,
  KUNDEN_STATUS_LABELS,
  VORLAGEN_BUCKET,
  sichereUrl,
  zeilenZuPunkten,
  type AblageTyp,
  type KundenStatus,
} from "@/lib/kunden";

// Schreibpfade des Fulfillments (Migration 0047), für alle Titan-Mitglieder.
// Jede Action prüft das als erste Anweisung (direkter POST).
//
// Das nächste Meeting ist ein eigenes Objekt: Ein Protokoll zu korrigieren
// fasst die Planung nie an (M5). Abschließen ist die RPC
// `meeting_abschliessen()` und damit eine Transaktion.

type Result = { error?: string };
const KEIN_RECHT = { error: "Nur für Mitglieder der Titan-Organisation." };
const NICHT_GEFUNDEN = { error: "Eintrag nicht gefunden. Vielleicht hat ihn gerade jemand gelöscht." };
const MAX_ZEILEN = 300;

async function requireKunden() {
  const rechte = await getInternRechte();
  if (!rechte.kunden) return null;
  const access = await getAccessContext();
  if (!access) return null;
  return { supabase: await createClient(), userId: access.user.id, rechte };
}
type Ctx = NonNullable<Awaited<ReturnType<typeof requireKunden>>>;

function revalidate(kundeId?: string) {
  revalidatePath("/kunden", "page");
  if (kundeId) revalidatePath(`/kunden/${kundeId}`);
}

function revalidateVorlagen() {
  revalidatePath("/kunden/vorlagen", "page");
}

// Fail-soft: Ein fehlender Log-Eintrag dreht die Änderung nicht zurück.
async function log(ctx: Ctx, kundeId: string, art: string, text: string, bereich: "fulfillment" | "finanz" = "fulfillment") {
  await ctx.supabase.from("kunden_log").insert({ kunde_id: kundeId, bereich, art, text, user_id: ctx.userId });
}

const clean = (s: unknown) => (typeof s === "string" ? s.trim() : "") || null;
const heute = () => berlinDateISO(new Date().toISOString());

/** null = leer, undefined = unlesbar. */
function isoOrNull(s: string | null | undefined): string | null | undefined {
  const v = clean(s);
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function zeilen(text: string): string[] {
  return zeilenZuPunkten(String(text ?? "")).map((z) => z.titel);
}

// ── Kunde ──────────────────────────────────────────────────────────────────

export async function createKunde(input: {
  name: string;
  firma?: string | null;
  email?: string | null;
  telefon?: string | null;
  betreuer_user_id?: string | null;
}): Promise<{ error?: string; id?: string }> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const name = clean(input.name);
  if (!name) return { error: "Bitte einen Namen angeben." };
  // Vertrag und geplantes Meeting legt der Trigger `kunden_nach_anlage` an.
  const { data, error } = await ctx.supabase
    .from("kunden")
    .insert({
      name,
      firma: clean(input.firma),
      email: clean(input.email),
      telefon: clean(input.telefon),
      betreuer_user_id: ctx.rechte.umsatz ? input.betreuer_user_id || null : null,
      status: "onboarding",
      created_by_user_id: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Anlegen fehlgeschlagen." };
  const id = (data as { id: string }).id;
  await log(ctx, id, "angelegt", "Kunde manuell angelegt.");
  revalidate(id);
  revalidatePath("/umsatz", "page");
  return { id };
}

export async function updateKunde(
  id: string,
  patch: {
    name?: string;
    firma?: string | null;
    email?: string | null;
    telefon?: string | null;
    status?: KundenStatus;
    betreuer_user_id?: string | null;
    kunden_workspace_id?: string | null;
    steckbrief?: string | null;
  },
): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const { data, error: le } = await ctx.supabase.from("kunden").select("status, betreuer_user_id").eq("id", id).maybeSingle();
  if (le) return { error: le.message };
  if (!data) return NICHT_GEFUNDEN;
  const alt = data as { status: KundenStatus; betreuer_user_id: string | null };

  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) {
    const n = clean(patch.name);
    if (!n) return { error: "Der Name darf nicht leer sein." };
    row.name = n;
  }
  for (const k of ["firma", "email", "telefon", "steckbrief"] as const) {
    if (patch[k] !== undefined) row[k] = clean(patch[k]);
  }
  if (patch.status !== undefined) {
    if (!KUNDEN_STATUS.includes(patch.status)) return { error: "Unbekannter Status." };
    row.status = patch.status;
  }
  if (patch.betreuer_user_id !== undefined || patch.kunden_workspace_id !== undefined) {
    if (!ctx.rechte.umsatz) return { error: "Zuordnen können nur Admins." };
    if (patch.betreuer_user_id !== undefined) row.betreuer_user_id = patch.betreuer_user_id || null;
    if (patch.kunden_workspace_id !== undefined) row.kunden_workspace_id = patch.kunden_workspace_id || null;
  }

  const { error } = await ctx.supabase.from("kunden").update(row).eq("id", id);
  if (error) return { error: error.message };

  if (patch.status !== undefined && patch.status !== alt.status) {
    await log(ctx, id, "status", `Status: ${KUNDEN_STATUS_LABELS[alt.status]} → ${KUNDEN_STATUS_LABELS[patch.status]}.`);
  }
  if (patch.betreuer_user_id !== undefined && (patch.betreuer_user_id || null) !== alt.betreuer_user_id) {
    await log(ctx, id, "betreuer", "Zuständigkeit neu vergeben.");
  }
  revalidate(id);
  revalidatePath("/umsatz", "page");
  return {};
}

/**
 * Nur für Fehlanlagen: Admins, und nur ohne Buchungen. Wer je gezahlt hat,
 * wird nicht gelöscht, sondern beendet.
 */
export async function deleteKunde(id: string): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  if (!ctx.rechte.umsatz) return { error: "Löschen können nur Admins." };
  const { count, error: ze } = await ctx.supabase
    .from("kunden_zahlungen")
    .select("id", { count: "exact", head: true })
    .eq("kunde_id", id);
  if (ze || count === null) return { error: "Buchungen nicht prüfbar, deshalb wurde nichts gelöscht." };
  if (count > 0) return { error: "Für diesen Kunden sind Zahlungen gebucht. Bitte beenden statt löschen." };
  const { data: dateien, error: de } = await ctx.supabase.from("kunden_ablage").select("storage_path").eq("kunde_id", id);
  if (de) return { error: de.message };

  const { data, error } = await ctx.supabase.from("kunden").delete().eq("id", id).select("id");
  if (error) return { error: error.message };
  if (!data?.length) return NICHT_GEFUNDEN;

  const pfade = ((dateien ?? []) as { storage_path: string | null }[]).flatMap((d) => (d.storage_path ? [d.storage_path] : []));
  if (pfade.length) await ctx.supabase.storage.from(ABLAGE_BUCKET).remove(pfade);
  // Kein Revalidate der Akte: Sie gäbe ein 404, bevor der Client wegnavigiert.
  revalidatePath("/kunden", "page");
  revalidatePath("/umsatz", "page");
  return {};
}

// ── Nächstes Meeting und Agenda ────────────────────────────────────────────

export async function setMeetingTermin(kundeId: string, meetingId: string, termin: string | null): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const iso = isoOrNull(termin);
  if (iso === undefined) return { error: "Ungültiger Termin." };
  const { data, error } = await ctx.supabase
    .from("kunden_meetings")
    .update({ termin: iso, updated_at: new Date().toISOString() })
    .eq("id", meetingId)
    .eq("kunde_id", kundeId)
    .eq("status", "geplant")
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Das Meeting wurde inzwischen abgeschlossen. Bitte neu laden." };
  revalidate(kundeId);
  return {};
}

/** Ausgefallen: Der Termin geht, die Agenda bleibt. */
export async function meetingAusgefallen(kundeId: string, meetingId: string): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const { data, error: le } = await ctx.supabase
    .from("kunden_meetings")
    .select("termin")
    .eq("id", meetingId)
    .eq("kunde_id", kundeId)
    .eq("status", "geplant")
    .maybeSingle();
  if (le) return { error: le.message };
  const termin = (data as { termin: string | null } | null)?.termin;
  if (!termin) return { error: "Es steht kein Termin." };
  const { error } = await ctx.supabase
    .from("kunden_meetings")
    .update({ termin: null, updated_at: new Date().toISOString() })
    .eq("id", meetingId)
    .eq("status", "geplant");
  if (error) return { error: error.message };
  await log(ctx, kundeId, "meeting", `Meeting vom ${berlinDateISO(termin).split("-").reverse().join(".")} ist ausgefallen.`);
  revalidate(kundeId);
  return {};
}

/** Eine Zeile ist ein Punkt, Einfügen mehrerer Zeilen geht. */
export async function addAgenda(kundeId: string, meetingId: string, text: string): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const neu = zeilen(text);
  if (!neu.length) return { error: "Bitte einen Punkt eingeben." };
  if (neu.length > MAX_ZEILEN) return { error: `Höchstens ${MAX_ZEILEN} Zeilen auf einmal.` };
  const { data: m, error: me } = await ctx.supabase
    .from("kunden_meetings")
    .select("id")
    .eq("id", meetingId)
    .eq("status", "geplant")
    .maybeSingle();
  if (me) return { error: me.message };
  if (!m) return { error: "Das Meeting wurde inzwischen abgeschlossen. Bitte neu laden." };
  const { data: max, error: le } = await ctx.supabase
    .from("kunden_meeting_punkte")
    .select("sort_order")
    .eq("meeting_id", meetingId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (le) return { error: le.message };
  const basis = (max as { sort_order: number } | null)?.sort_order ?? 0;
  const { error } = await ctx.supabase
    .from("kunden_meeting_punkte")
    .insert(neu.map((t, i) => ({ kunde_id: kundeId, meeting_id: meetingId, text: t, sort_order: basis + (i + 1) * 10 })));
  if (error) {
    return {
      error: error.message.includes("MEETING_SCHON_ABGESCHLOSSEN")
        ? "Das Meeting wurde inzwischen abgeschlossen. Bitte neu laden."
        : error.message,
    };
  }
  revalidate(kundeId);
  return {};
}

export async function updateAgenda(id: string, patch: { text?: string; besprochen?: boolean }): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const row: Record<string, unknown> = {};
  if (patch.text !== undefined) {
    const t = clean(patch.text);
    if (!t) return { error: "Der Punkt darf nicht leer sein." };
    row.text = t;
  }
  if (patch.besprochen !== undefined) row.besprochen = patch.besprochen === true;
  if (!Object.keys(row).length) return {};
  const { data, error } = await ctx.supabase.from("kunden_meeting_punkte").update(row).eq("id", id).select("kunde_id");
  if (error) return { error: error.message };
  if (!data?.length) return NICHT_GEFUNDEN;
  revalidate(data[0].kunde_id as string);
  return {};
}

export async function deleteAgenda(id: string): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const { data, error } = await ctx.supabase.from("kunden_meeting_punkte").delete().eq("id", id).select("kunde_id");
  if (error) return { error: error.message };
  if (!data?.length) return NICHT_GEFUNDEN;
  revalidate(data[0].kunde_id as string);
  return {};
}

export type AbschlussEingabe = {
  termin: string;
  person: string | null;
  teilnehmer: string;
  ergebnisse: string;
  aufzeichnung_url: string;
  besprochen: string[];
  /** Was ausdrücklich NICHT mitwandert. Alles andere Offene wandert. */
  entfaellt: string[];
  erledigte_bausteine: string[];
  /** Je Zeile eine Aufgabe. */
  aufgaben_wir: string;
  aufgaben_kunde: string;
  naechster_termin: string | null;
  /** Je Zeile ein Agenda-Punkt. */
  naechste_agenda: string;
};

export async function meetingAbschliessen(kundeId: string, meetingId: string, input: AbschlussEingabe): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const termin = isoOrNull(input.termin);
  if (!termin) return { error: "Bitte angeben, wann das Meeting war." };
  if (Date.parse(termin) > Date.now() + 15 * 60_000) return { error: "Ein Meeting in der Zukunft lässt sich nicht abschließen." };
  const naechster = isoOrNull(input.naechster_termin);
  if (naechster === undefined) return { error: "Ungültiger Folgetermin." };
  if (naechster && Date.parse(naechster) <= Date.parse(termin)) return { error: "Das nächste Meeting muss nach diesem liegen." };
  const url = clean(input.aufzeichnung_url) ? sichereUrl(input.aufzeichnung_url) : null;
  if (clean(input.aufzeichnung_url) && !url) return { error: "Der Aufzeichnungs-Link ist keine gültige Adresse." };

  const { error } = await ctx.supabase.rpc("meeting_abschliessen", {
    p_meeting_id: meetingId,
    p: {
      termin,
      person: input.person || null,
      teilnehmer: clean(input.teilnehmer),
      ergebnisse: clean(input.ergebnisse),
      aufzeichnung_url: url,
      besprochen: input.besprochen,
      entfaellt: input.entfaellt,
      erledigte_bausteine: input.erledigte_bausteine,
      aufgaben: [
        ...zeilen(input.aufgaben_wir).map((text) => ({ seite: "wir", text })),
        ...zeilen(input.aufgaben_kunde).map((text) => ({ seite: "kunde", text })),
      ],
      naechster_termin: naechster,
      naechste_agenda: zeilen(input.naechste_agenda),
    },
  });
  revalidate(kundeId);
  if (error) {
    return {
      error: error.message.includes("MEETING_SCHON_ABGESCHLOSSEN")
        ? "Dieses Meeting ist schon abgeschlossen."
        : error.message,
    };
  }
  return {};
}

// ── Protokolle ─────────────────────────────────────────────────────────────

/** Nachtragen oder korrigieren. Fasst das geplante Meeting NIE an (M5). */
export async function saveProtokoll(
  kundeId: string,
  input: {
    id?: string;
    termin: string;
    person: string | null;
    teilnehmer: string;
    themen: string;
    ergebnisse: string;
    aufzeichnung_url: string;
  },
): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const termin = isoOrNull(input.termin);
  if (!termin) return { error: "Bitte Datum und Uhrzeit angeben." };
  if (Date.parse(termin) > Date.now() + 15 * 60_000) return { error: "Ein Protokoll gibt es erst nach dem Meeting." };
  const url = clean(input.aufzeichnung_url) ? sichereUrl(input.aufzeichnung_url) : null;
  if (clean(input.aufzeichnung_url) && !url) return { error: "Der Aufzeichnungs-Link ist keine gültige Adresse." };
  const row = {
    termin,
    durchgefuehrt_von_user_id: input.person || null,
    teilnehmer: clean(input.teilnehmer),
    themen: clean(input.themen),
    ergebnisse: clean(input.ergebnisse),
    aufzeichnung_url: url,
    updated_at: new Date().toISOString(),
  };
  const tabelle = ctx.supabase.from("kunden_meetings");
  const { data, error } = input.id
    ? await tabelle.update(row).eq("id", input.id).eq("kunde_id", kundeId).eq("status", "stattgefunden").select("id")
    : await tabelle.insert({ ...row, kunde_id: kundeId, status: "stattgefunden", created_by_user_id: ctx.userId }).select("id");
  if (error) return { error: error.message };
  if (!data?.length) return NICHT_GEFUNDEN;
  await log(ctx, kundeId, "meeting", input.id ? "Protokoll korrigiert." : "Protokoll nachgetragen.");
  revalidate(kundeId);
  return {};
}

export async function deleteProtokoll(id: string): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const { data, error } = await ctx.supabase
    .from("kunden_meetings")
    .delete()
    .eq("id", id)
    .eq("status", "stattgefunden")
    .select("kunde_id, termin");
  if (error) return { error: error.message };
  if (!data?.length) return NICHT_GEFUNDEN;
  const m = data[0] as { kunde_id: string; termin: string };
  await log(ctx, m.kunde_id, "meeting", `Protokoll vom ${berlinDateISO(m.termin).split("-").reverse().join(".")} gelöscht.`);
  revalidate(m.kunde_id);
  return {};
}

// ── Aufgaben ───────────────────────────────────────────────────────────────

export async function addAufgabe(kundeId: string, seite: "wir" | "kunde", text: string): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const neu = zeilen(text);
  if (!neu.length) return { error: "Bitte eine Aufgabe eingeben." };
  if (neu.length > MAX_ZEILEN) return { error: `Höchstens ${MAX_ZEILEN} Zeilen auf einmal.` };
  const { error } = await ctx.supabase
    .from("kunden_aufgaben")
    .insert(neu.map((t) => ({ kunde_id: kundeId, seite: seite === "kunde" ? "kunde" : "wir", text: t })));
  if (error) return { error: error.message };
  revalidate(kundeId);
  return {};
}

export async function setAufgabeErledigt(id: string, erledigt: boolean): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const { data, error } = await ctx.supabase
    .from("kunden_aufgaben")
    .update({ erledigt_am: erledigt ? heute() : null, erledigt_von_user_id: erledigt ? ctx.userId : null })
    .eq("id", id)
    .select("kunde_id");
  if (error) return { error: error.message };
  if (!data?.length) return NICHT_GEFUNDEN;
  revalidate(data[0].kunde_id as string);
  return {};
}

export async function deleteAufgabe(id: string): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const { data, error } = await ctx.supabase.from("kunden_aufgaben").delete().eq("id", id).select("kunde_id");
  if (error) return { error: error.message };
  if (!data?.length) return NICHT_GEFUNDEN;
  revalidate(data[0].kunde_id as string);
  return {};
}

// ── Checklisten je Kunde ───────────────────────────────────────────────────

/** Zuweisen kopiert. Mit `checklisteId` wird nur angehängt, was dort fehlt. */
export async function checklisteAusVorlage(
  kundeId: string,
  vorlageId: string,
  punktIds: string[],
  checklisteId?: string,
): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  if (!Array.isArray(punktIds) || !punktIds.length) return { error: "Bitte mindestens einen Punkt anhaken." };
  const { error } = await ctx.supabase.rpc("checkliste_aus_vorlage", {
    p_kunde_id: kundeId,
    p_vorlage_id: vorlageId,
    p_punkte: punktIds,
    p_checkliste_id: checklisteId ?? null,
  });
  if (error) return { error: error.message };
  revalidate(kundeId);
  return {};
}

export async function createCheckliste(kundeId: string, titel: string): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const t = clean(titel);
  if (!t) return { error: "Bitte einen Namen angeben." };
  const { error } = await ctx.supabase.from("kunden_checklisten").insert({ kunde_id: kundeId, titel: t });
  if (error) return { error: error.message };
  revalidate(kundeId);
  return {};
}

export async function renameCheckliste(id: string, titel: string): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const t = clean(titel);
  if (!t) return { error: "Bitte einen Namen angeben." };
  const { data, error } = await ctx.supabase.from("kunden_checklisten").update({ titel: t }).eq("id", id).select("kunde_id");
  if (error) return { error: error.message };
  if (!data?.length) return NICHT_GEFUNDEN;
  revalidate(data[0].kunde_id as string);
  return {};
}

export async function deleteCheckliste(id: string): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const { data, error } = await ctx.supabase.from("kunden_checklisten").delete().eq("id", id).select("kunde_id, titel");
  if (error) return { error: error.message };
  if (!data?.length) return NICHT_GEFUNDEN;
  const l = data[0] as { kunde_id: string; titel: string };
  await log(ctx, l.kunde_id, "checkliste", `Checkliste „${l.titel}“ entfernt.`);
  revalidate(l.kunde_id);
  return {};
}

export async function addBausteine(kundeId: string, checklisteId: string, text: string, phase?: string | null): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const neu = zeilenZuPunkten(String(text ?? ""));
  if (!neu.length) return { error: "Bitte einen Punkt eingeben." };
  if (neu.length > MAX_ZEILEN) return { error: `Höchstens ${MAX_ZEILEN} Zeilen auf einmal.` };
  const { data: max, error: le } = await ctx.supabase
    .from("kunden_bausteine")
    .select("sort_order")
    .eq("checkliste_id", checklisteId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (le) return { error: le.message };
  const basis = (max as { sort_order: number } | null)?.sort_order ?? 0;
  const { error } = await ctx.supabase.from("kunden_bausteine").insert(
    neu.map((n, i) => ({
      kunde_id: kundeId,
      checkliste_id: checklisteId,
      titel: n.titel,
      phase: n.phase ?? clean(phase),
      sort_order: basis + (i + 1) * 10,
    })),
  );
  if (error) return { error: error.message };
  revalidate(kundeId);
  return {};
}

export async function updateBaustein(
  id: string,
  patch: { titel?: string; beschreibung?: string | null; phase?: string | null; notiz?: string | null },
): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const row: Record<string, unknown> = {};
  if (patch.titel !== undefined) {
    const t = clean(patch.titel);
    if (!t) return { error: "Der Titel darf nicht leer sein." };
    row.titel = t;
  }
  for (const k of ["beschreibung", "phase", "notiz"] as const) {
    if (patch[k] !== undefined) row[k] = clean(patch[k]);
  }
  if (!Object.keys(row).length) return {};
  const { data, error } = await ctx.supabase.from("kunden_bausteine").update(row).eq("id", id).select("kunde_id");
  if (error) return { error: error.message };
  if (!data?.length) return NICHT_GEFUNDEN;
  revalidate(data[0].kunde_id as string);
  return {};
}

export async function setBausteinErledigt(id: string, erledigt: boolean): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const { data, error } = await ctx.supabase
    .from("kunden_bausteine")
    .update({ erledigt_am: erledigt ? heute() : null, erledigt_von_user_id: erledigt ? ctx.userId : null })
    .eq("id", id)
    .select("kunde_id, titel");
  if (error) return { error: error.message };
  if (!data?.length) return NICHT_GEFUNDEN;
  const b = data[0] as { kunde_id: string; titel: string };
  await log(ctx, b.kunde_id, "baustein", `„${b.titel}“ ${erledigt ? "erledigt" : "wieder offen"}.`);
  revalidate(b.kunde_id);
  return {};
}

export async function deleteBaustein(id: string): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const { data, error } = await ctx.supabase.from("kunden_bausteine").delete().eq("id", id).select("kunde_id");
  if (error) return { error: error.message };
  if (!data?.length) return NICHT_GEFUNDEN;
  revalidate(data[0].kunde_id as string);
  return {};
}

export async function setReihenfolge(
  art: "vorlage" | "baustein" | "agenda",
  ids: string[],
  kundeId?: string,
): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const { error } = await ctx.supabase.rpc("intern_reihenfolge", { p_art: art, p_ids: ids });
  if (error) return { error: error.message };
  if (art === "vorlage") revalidateVorlagen();
  else revalidate(kundeId);
  return {};
}

// ── Vorlagen ───────────────────────────────────────────────────────────────

export async function createVorlage(name: string, liste: string): Promise<{ error?: string; id?: string }> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const n = clean(name);
  if (!n) return { error: "Bitte einen Namen angeben." };
  const punkte = zeilenZuPunkten(String(liste ?? ""));
  if (punkte.length > MAX_ZEILEN) return { error: `Höchstens ${MAX_ZEILEN} Zeilen auf einmal.` };
  const { data, error } = await ctx.supabase.from("fulfillment_vorlagen").insert({ name: n }).select("id").single();
  if (error || !data) return { error: error?.message ?? "Anlegen fehlgeschlagen." };
  const id = (data as { id: string }).id;
  if (punkte.length) {
    const { error: e } = await ctx.supabase
      .from("fulfillment_vorlage_punkte")
      .insert(punkte.map((p, i) => ({ vorlage_id: id, titel: p.titel, phase: p.phase, sort_order: (i + 1) * 10 })));
    if (e) {
      await ctx.supabase.from("fulfillment_vorlagen").delete().eq("id", id);
      return { error: e.message };
    }
  }
  revalidateVorlagen();
  return { id };
}

export async function updateVorlage(
  id: string,
  patch: { name?: string; beschreibung?: string | null; archiviert?: boolean },
): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const n = clean(patch.name);
    if (!n) return { error: "Bitte einen Namen angeben." };
    row.name = n;
  }
  if (patch.beschreibung !== undefined) row.beschreibung = clean(patch.beschreibung);
  if (patch.archiviert !== undefined) row.archiviert_at = patch.archiviert ? new Date().toISOString() : null;
  if (!Object.keys(row).length) return {};
  const { error } = await ctx.supabase.from("fulfillment_vorlagen").update(row).eq("id", id);
  if (error) return { error: error.message };
  revalidateVorlagen();
  return {};
}

export async function duplicateVorlage(id: string): Promise<{ error?: string; id?: string }> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const { data, error } = await ctx.supabase.rpc("vorlage_duplizieren", { p_vorlage_id: id });
  if (error) return { error: error.message };
  revalidateVorlagen();
  return { id: data as string };
}

export async function deleteVorlage(id: string): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  // Dateien der Vorlage (0052) zuerst aus dem Bucket — die Zeilen gehen per
  // Cascade mit, die Objekte nicht. Fehlt 0052, gibt es keine.
  const { data: dateien } = await ctx.supabase.from("fulfillment_vorlage_dateien").select("storage_path").eq("vorlage_id", id);
  const pfade = ((dateien ?? []) as { storage_path: string }[]).map((d) => d.storage_path);
  if (pfade.length) await ctx.supabase.storage.from(VORLAGEN_BUCKET).remove(pfade);
  const { error } = await ctx.supabase.from("fulfillment_vorlagen").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateVorlagen();
  return {};
}

export async function addVorlagePunkte(vorlageId: string, text: string, phase?: string | null): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const neu = zeilenZuPunkten(String(text ?? ""));
  if (!neu.length) return { error: "Bitte einen Punkt eingeben." };
  if (neu.length > MAX_ZEILEN) return { error: `Höchstens ${MAX_ZEILEN} Zeilen auf einmal.` };
  const { data: max, error: le } = await ctx.supabase
    .from("fulfillment_vorlage_punkte")
    .select("sort_order")
    .eq("vorlage_id", vorlageId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (le) return { error: le.message };
  const basis = (max as { sort_order: number } | null)?.sort_order ?? 0;
  const { error } = await ctx.supabase.from("fulfillment_vorlage_punkte").insert(
    neu.map((n, i) => ({ vorlage_id: vorlageId, titel: n.titel, phase: n.phase ?? clean(phase), sort_order: basis + (i + 1) * 10 })),
  );
  if (error) return { error: error.message };
  revalidateVorlagen();
  return {};
}

export async function updateVorlagePunkt(
  id: string,
  patch: { titel?: string; beschreibung?: string | null; phase?: string | null },
): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const row: Record<string, unknown> = {};
  if (patch.titel !== undefined) {
    const t = clean(patch.titel);
    if (!t) return { error: "Der Titel darf nicht leer sein." };
    row.titel = t;
  }
  for (const k of ["beschreibung", "phase"] as const) {
    if (patch[k] !== undefined) row[k] = clean(patch[k]);
  }
  if (!Object.keys(row).length) return {};
  const { error } = await ctx.supabase.from("fulfillment_vorlage_punkte").update(row).eq("id", id);
  if (error) return { error: error.message };
  revalidateVorlagen();
  return {};
}

export async function deleteVorlagePunkt(id: string): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const { error } = await ctx.supabase.from("fulfillment_vorlage_punkte").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateVorlagen();
  return {};
}

// ── Ablage ─────────────────────────────────────────────────────────────────

function typOk(t: string): AblageTyp {
  return (ABLAGE_TYPEN as readonly string[]).includes(t) ? (t as AblageTyp) : "sonstiges";
}

export async function addAblageLink(kundeId: string, input: { typ: string; titel: string; url: string }): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const url = sichereUrl(input.url);
  if (!url) return { error: "Bitte einen gültigen Link (http/https) angeben." };
  const titel = clean(input.titel) ?? new URL(url).hostname;
  const { error } = await ctx.supabase
    .from("kunden_ablage")
    .insert({ kunde_id: kundeId, typ: typOk(input.typ), titel, url, created_by_user_id: ctx.userId });
  if (error) return { error: error.message };
  await log(ctx, kundeId, "ablage", `Link „${titel}“ abgelegt.`, input.typ === "vertrag" ? "finanz" : "fulfillment");
  revalidate(kundeId);
  return {};
}

/** Registriert eine Datei, die der Browser schon in den Bucket geladen hat. */
export async function registerAblageUpload(
  kundeId: string,
  input: { typ: string; titel: string; storage_path: string; dateiname: string; groesse_bytes: number; mime: string | null },
): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  if (!input.storage_path.startsWith(`${kundeId}/`) || input.storage_path.includes("..")) {
    return { error: "Ungültiger Ablagepfad." };
  }
  const titel = clean(input.titel) ?? input.dateiname;
  const { error } = await ctx.supabase.from("kunden_ablage").insert({
    kunde_id: kundeId,
    typ: typOk(input.typ),
    titel,
    storage_path: input.storage_path,
    dateiname: input.dateiname,
    groesse_bytes: Math.max(0, Math.round(input.groesse_bytes)),
    mime: input.mime || null,
    created_by_user_id: ctx.userId,
  });
  if (error) {
    // Schon registriert (23505): Dann gehört die Datei einer anderen Zeile und bleibt liegen.
    if (error.code !== "23505") await ctx.supabase.storage.from(ABLAGE_BUCKET).remove([input.storage_path]);
    return { error: error.message };
  }
  await log(ctx, kundeId, "ablage", `Datei „${titel}“ hochgeladen.`, input.typ === "vertrag" ? "finanz" : "fulfillment");
  revalidate(kundeId);
  return {};
}

export async function deleteAblage(id: string): Promise<Result> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const { data, error: le } = await ctx.supabase.from("kunden_ablage").select("kunde_id, titel, storage_path, typ").eq("id", id).maybeSingle();
  if (le) return { error: le.message };
  if (!data) return NICHT_GEFUNDEN;
  const a = data as { kunde_id: string; titel: string; storage_path: string | null; typ: AblageTyp };
  if (a.storage_path) {
    const { error: se } = await ctx.supabase.storage.from(ABLAGE_BUCKET).remove([a.storage_path]);
    if (se) return { error: se.message };
  }
  const { error } = await ctx.supabase.from("kunden_ablage").delete().eq("id", id);
  if (error) return { error: error.message };
  await log(ctx, a.kunde_id, "ablage", `„${a.titel}“ aus der Ablage entfernt.`, a.typ === "vertrag" ? "finanz" : "fulfillment");
  revalidate(a.kunde_id);
  return {};
}

/** Kurzlebiger Download-Link (5 Minuten), der Bucket ist privat. */
export async function ablageDownloadUrl(id: string): Promise<{ error?: string; url?: string }> {
  const ctx = await requireKunden();
  if (!ctx) return KEIN_RECHT;
  const { data, error: le } = await ctx.supabase.from("kunden_ablage").select("storage_path, dateiname").eq("id", id).maybeSingle();
  if (le) return { error: le.message };
  const a = data as { storage_path: string | null; dateiname: string | null } | null;
  if (!a?.storage_path) return { error: "Keine Datei." };
  const { data: signed, error } = await ctx.supabase.storage
    .from(ABLAGE_BUCKET)
    .createSignedUrl(a.storage_path, 300, { download: a.dateiname ?? true });
  if (error || !signed) return { error: error?.message ?? "Link konnte nicht erzeugt werden." };
  return { url: signed.signedUrl };
}

// ── Dateien an Vorlagen (Migration 0052, 28.11.) ─────────────────────────

const MIGRATION_0052 = "Dateien an Vorlagen fehlen noch in der Datenbank — Migration 0052 ist nicht eingespielt.";

/** Nach dem Hochladen in den Bucket: die Datei an der Vorlage eintragen. */
export async function registerVorlageDatei(
  vorlageId: string,
  input: { titel: string; storage_path: string; dateiname: string; groesse_bytes: number; mime: string | null },
): Promise<{ error?: string }> {
  const ctx = await requireKunden();
  if (!ctx) return { error: "Keine Berechtigung." };
  if (!input.storage_path.startsWith(`${vorlageId}/`) || input.storage_path.includes("..")) {
    return { error: "Ungültiger Speicherpfad." };
  }
  const titel = (input.titel || input.dateiname).trim().slice(0, 200) || "Datei";
  const { error } = await ctx.supabase.from("fulfillment_vorlage_dateien").insert({
    vorlage_id: vorlageId,
    titel,
    dateiname: input.dateiname.slice(0, 255),
    storage_path: input.storage_path,
    groesse_bytes: Number.isFinite(input.groesse_bytes) ? input.groesse_bytes : null,
    mime: input.mime,
    created_by_user_id: ctx.userId,
  });
  if (error) {
    await ctx.supabase.storage.from(VORLAGEN_BUCKET).remove([input.storage_path]);
    return { error: /fulfillment_vorlage_dateien|does not exist|schema cache/i.test(error.message) ? MIGRATION_0052 : error.message };
  }
  revalidateVorlagen();
  return {};
}

export async function deleteVorlageDatei(id: string): Promise<{ error?: string }> {
  const ctx = await requireKunden();
  if (!ctx) return { error: "Keine Berechtigung." };
  const { data, error: le } = await ctx.supabase.from("fulfillment_vorlage_dateien").select("storage_path").eq("id", id).maybeSingle();
  if (le) return { error: le.message };
  if (!data) return { error: "Datei nicht gefunden." };
  const pfad = (data as { storage_path: string }).storage_path;
  const { error: se } = await ctx.supabase.storage.from(VORLAGEN_BUCKET).remove([pfad]);
  if (se) return { error: se.message };
  const { error } = await ctx.supabase.from("fulfillment_vorlage_dateien").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateVorlagen();
  return {};
}

/** Kurzlebiger Download-Link (5 Minuten) — der Bucket ist privat. */
export async function vorlageDateiUrl(id: string): Promise<{ error?: string; url?: string }> {
  const ctx = await requireKunden();
  if (!ctx) return { error: "Keine Berechtigung." };
  const { data, error: le } = await ctx.supabase
    .from("fulfillment_vorlage_dateien")
    .select("storage_path, dateiname")
    .eq("id", id)
    .maybeSingle();
  if (le) return { error: le.message };
  const d = data as { storage_path: string; dateiname: string } | null;
  if (!d) return { error: "Datei nicht gefunden." };
  const { data: signed, error } = await ctx.supabase.storage
    .from(VORLAGEN_BUCKET)
    .createSignedUrl(d.storage_path, 300, { download: d.dateiname });
  if (error || !signed) return { error: error?.message ?? "Kein Link." };
  return { url: signed.signedUrl };
}
