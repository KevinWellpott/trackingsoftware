"use server";

// Nachfass-Eingang — die Schreibpfade (Plan M4).
//
// „Kontakt eintragen" schreibt in EINEM Durchlauf: einen Protokolleintrag
// (`nachfass_kontakte`, Migration 0049), das nächste Fälligkeitsdatum der
// Quelle (`follow_up_due` bzw. `next_recycle_at`), den bestehenden Stempel aus
// 0041 (Dossier und Termin-Mails lesen ihn weiter) und beim Recycling den
// Versuchszähler (`recycle_attempt()`, der Deckel bleibt wirksam).
//
// Fail-closed: Scheitert das Datum, wird der Protokolleintrag zurückgenommen.
// Jede Fehlerbehandlung endet in „bleibt Arbeit", nie in „ist versorgt".

import { revalidatePath } from "next/cache";
import { getAccessContext } from "@/lib/access";
import { berlinDateISO } from "@/lib/apptTime";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { markTerminDead } from "@/app/actions/followUpStamp";
import { excludeFromRecycle, scheduleRecycle } from "@/app/actions/recycle";
import { logCallAttempt } from "@/app/actions/phoneAttempts";
import type { NachfassArt, NachfassQuelle } from "@/lib/nachfassRegel";

type Ergebnis = "nicht_erreicht" | "erreicht";
type Kanal = "anruf" | "whatsapp" | "mail" | "linkedin" | "sms" | "sonstiges";
type Folge = "naechster_kontakt" | "termin" | "aufgegeben" | "gesperrt" | "ergebnis";

const TABELLE: Record<NachfassArt, "setting_calls" | "closing_calls" | "contacts" | "phone_leads"> = {
  setting: "setting_calls",
  closing: "closing_calls",
  contact: "contacts",
  phone_lead: "phone_leads",
};

const FK: Record<NachfassArt, "setting_call_id" | "closing_call_id" | "contact_id" | "phone_lead_id"> = {
  setting: "setting_call_id",
  closing: "closing_call_id",
  contact: "contact_id",
  phone_lead: "phone_lead_id",
};

const ORIGIN: Record<NachfassArt, "setting" | "closing" | "linkedin" | "telefon"> = {
  setting: "setting",
  closing: "closing",
  contact: "linkedin",
  phone_lead: "telefon",
};

const ISO_TAG = /^\d{4}-\d{2}-\d{2}$/;
const KANAELE: readonly Kanal[] = ["anruf", "whatsapp", "mail", "linkedin", "sms", "sonstiges"];

function istArt(v: unknown): v is NachfassArt {
  return v === "setting" || v === "closing" || v === "contact" || v === "phone_lead";
}

/** Darf die angemeldete Person diesen Vorgang in der AKTIVEN Organisation anfassen? */
async function sichtbar(art: NachfassArt, id: string): Promise<boolean> {
  const access = await getAccessContext();
  if (!access) return false;
  const supabase = await createClient();
  const { data } = await supabase
    .from(TABELLE[art])
    .select("id")
    .eq("id", id)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();
  return Boolean(data);
}

/** Was vor dem Schreiben stand — für „Rückgängig". */
export type NachfassUndo = {
  kontaktId: string | null;
  art: NachfassArt;
  id: string;
  quelle: NachfassQuelle;
  vorher: Record<string, string | number | null>;
};

export type NachfassErgebnis = { error?: string; undo?: NachfassUndo };

function revalidate() {
  revalidatePath("/nachfassen", "page");
  revalidatePath("/termine", "page");
  revalidatePath("/", "layout");
}

async function protokolliere(input: {
  art: NachfassArt;
  id: string;
  quelle: "termin" | "recycling";
  ergebnis: Ergebnis;
  folge: Folge;
  kanal?: Kanal | null;
  notiz?: string | null;
  naechsterKontaktAm?: string | null;
  userId: string;
}): Promise<{ id: string | null; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("nachfass_kontakte")
    .insert({
      [FK[input.art]]: input.id,
      quelle: input.quelle,
      ergebnis: input.ergebnis,
      folge: input.folge,
      kanal: input.kanal ?? null,
      notiz: input.notiz?.trim() || null,
      naechster_kontakt_am: input.naechsterKontaktAm ?? null,
      created_by_user_id: input.userId,
    })
    .select("id")
    .single();
  if (error) {
    if (/nachfass_kontakte/.test(error.message) || error.code === "42P01" || error.code === "PGRST205") {
      return { id: null, error: "Das Kontakt-Protokoll fehlt in der Datenbank — Migration 0049 ist noch nicht eingespielt." };
    }
    return { id: null, error: error.message };
  }
  return { id: (data as { id: string }).id };
}

async function protokollZuruecknehmen(kontaktId: string | null) {
  if (!kontaktId) return;
  try {
    await createAdminClient().from("nachfass_kontakte").delete().eq("id", kontaktId);
  } catch (err) {
    console.error("[nachfassKontakt] Rücknahme:", err instanceof Error ? err.message : err);
  }
}

/**
 * „Kontakt eintragen" — Ergebnis Pflicht, Kanal und Notiz optional, dazu das
 * Datum des nächsten Kontakts (Plan §4.3). Für Termine und Recycling;
 * Rückrufe laufen über die Ergebnis-Knöpfe des Call-Modus (`setPhoneLeadOutcome`),
 * die ohnehin in `phone_call_attempts` protokollieren.
 */
export async function kontaktEintragen(input: {
  art: NachfassArt;
  id: string;
  quelle: "termin" | "recycling";
  ergebnis: Ergebnis;
  kanal?: Kanal | null;
  notiz?: string | null;
  naechsterKontaktAm: string;
}): Promise<NachfassErgebnis> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (!istArt(input.art) || typeof input.id !== "string" || !input.id) return { error: "Nicht gefunden." };
  if (input.ergebnis !== "nicht_erreicht" && input.ergebnis !== "erreicht") return { error: "Bitte ein Ergebnis wählen." };
  if (!ISO_TAG.test(input.naechsterKontaktAm ?? "")) return { error: "Bitte das Datum des nächsten Kontakts wählen." };
  if (input.kanal && !KANAELE.includes(input.kanal)) return { error: "Unbekannter Kanal." };
  if (input.quelle === "termin" && input.art !== "setting" && input.art !== "closing") return { error: "Unbekannte Termin-Art." };
  if (!(await sichtbar(input.art, input.id))) return { error: "Keine Berechtigung." };

  const supabase = await createClient();
  const tabelle = TABELLE[input.art];

  // Vorher-Stand lesen — für „Rückgängig" und um nur Gelesenes zurückzuschreiben.
  const felder =
    input.quelle === "termin"
      ? "follow_up_due, follow_up_last_contacted_at, follow_up_last_contacted_by_user_id"
      : "next_recycle_at, recycle_attempt_count, recycle_last_contacted_at";
  const { data: vorherRaw } = await supabase.from(tabelle).select(felder).eq("id", input.id).maybeSingle();
  const vorher = (vorherRaw ?? {}) as unknown as Record<string, string | number | null>;

  const kontakt = await protokolliere({
    art: input.art,
    id: input.id,
    quelle: input.quelle,
    ergebnis: input.ergebnis,
    folge: "naechster_kontakt",
    kanal: input.kanal,
    notiz: input.notiz,
    naechsterKontaktAm: input.naechsterKontaktAm,
    userId: access.user.id,
  });
  if (kontakt.error) return { error: kontakt.error };

  const now = new Date().toISOString();
  if (input.quelle === "termin") {
    const patch: Record<string, string | null> = {
      follow_up_due: input.naechsterKontaktAm,
      follow_up_last_contacted_at: now,
      follow_up_last_contacted_by_user_id: access.user.id,
    };
    // Am Closing trägt `follow_up_due_at` die Uhrzeit eines VEREINBARTEN
    // Kontakts. Ein Datum aus dem Eingang ist keine Verabredung — die Uhrzeit
    // fällt weg, statt eine zu erfinden.
    if (input.art === "closing") patch.follow_up_due_at = null;
    const { error } = await supabase
      .from(tabelle)
      .update(patch)
      .eq("id", input.id)
      .eq("workspace_id", access.workspace_id);
    if (error) {
      await protokollZuruecknehmen(kontakt.id);
      return { error: error.message };
    }
  } else {
    // Recycling: Versuch zählen (der Deckel bleibt wirksam), dann das Datum.
    // Bei „erreicht" kein Versuch — es ist eine Antwort, kein Fehlschlag.
    if (input.ergebnis === "nicht_erreicht") {
      const { data: count, error } = await supabase.rpc("recycle_attempt", {
        p_workspace_id: access.workspace_id,
        p_origin: ORIGIN[input.art],
        p_entity_id: input.id,
        p_today: berlinDateISO(now),
      });
      if (error) {
        await protokollZuruecknehmen(kontakt.id);
        return { error: error.message };
      }
      // Am Deckel hat `recycle_attempt()` die Wiedervorlage genullt — der
      // Lead verschwindet endgültig, das Datum wird NICHT wieder gesetzt.
      const { data: nach } = await supabase.from(tabelle).select("next_recycle_at").eq("id", input.id).maybeSingle();
      if (!(nach as { next_recycle_at: string | null } | null)?.next_recycle_at && typeof count === "number") {
        revalidate();
        return {
          undo: { kontaktId: kontakt.id, art: input.art, id: input.id, quelle: input.quelle, vorher },
        };
      }
    }
    // Detailfrage O2: Ein Recycling-ANRUF bei einem Telefon-Lead ist ein
    // echter Wählversuch — er gehört ins Anruf-Log, sonst fehlt er in
    // „Anwahlen". Fail-soft wie jeder Log-Eintrag.
    if (input.art === "phone_lead" && input.kanal === "anruf") {
      const { data: lead } = await supabase.from("phone_leads").select("status").eq("id", input.id).maybeSingle();
      await logCallAttempt({
        leadId: input.id,
        outcome: input.ergebnis === "erreicht" ? "kein_ergebnis" : "nicht_erreicht",
        statusBefore: (lead as { status?: string | null } | null)?.status ?? null,
      });
    }
    const { error } = await supabase
      .from(tabelle)
      .update({ next_recycle_at: input.naechsterKontaktAm, recycle_last_contacted_at: now })
      .eq("id", input.id)
      .eq("workspace_id", access.workspace_id);
    if (error) {
      await protokollZuruecknehmen(kontakt.id);
      return { error: error.message };
    }
  }

  revalidate();
  return { undo: { kontaktId: kontakt.id, art: input.art, id: input.id, quelle: input.quelle, vorher } };
}

/**
 * „Rückgängig" — nur der eigene, frische Eintrag (10 Minuten) und nur die
 * Spalten, die der Klick überschrieben hat, mit den Werten, die dort standen.
 */
export async function nachfassRueckgaengig(undo: NachfassUndo): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (!istArt(undo?.art) || !undo.id) return { error: "Nicht gefunden." };
  if (!(await sichtbar(undo.art, undo.id))) return { error: "Keine Berechtigung." };

  // Ohne eigenen, frischen Protokolleintrag gibt es kein Rückgängig: Er ist
  // der Beleg, dass dieser Mensch gerade genau diesen Vorgang angefasst hat.
  // Sonst schriebe ein direkter POST beliebige Werte (z. B. den
  // Recycling-Deckel zurück).
  if (!undo.kontaktId) return { error: "Nichts zum Zurücknehmen." };
  const admin = createAdminClient();
  const { data } = await admin
    .from("nachfass_kontakte")
    .select("created_by_user_id, created_at, setting_call_id, closing_call_id, contact_id, phone_lead_id")
    .eq("id", undo.kontaktId)
    .maybeSingle();
  const row = data as
    | ({ created_by_user_id: string | null; created_at: string } & Record<string, string | null>)
    | null;
  if (!row || row.created_by_user_id !== access.user.id) return { error: "Nur der eigene Eintrag lässt sich zurücknehmen." };
  if (row[FK[undo.art]] !== undo.id) return { error: "Der Eintrag gehört zu einem anderen Vorgang." };
  if (Date.now() - Date.parse(row.created_at) > 10 * 60 * 1000) return { error: "Der Eintrag ist älter als zehn Minuten." };

  // Nur gelesene Spalten, nur plausible Werte. Der Versuchszähler darf nur
  // sinken (er war vor dem Klick kleiner), nie über den heutigen Stand steigen.
  const supabase = await createClient();
  const { data: jetztRaw } = await supabase
    .from(TABELLE[undo.art])
    .select(undo.quelle === "termin" ? "follow_up_due" : "recycle_attempt_count")
    .eq("id", undo.id)
    .maybeSingle();
  const jetzt = (jetztRaw ?? {}) as unknown as Record<string, number | string | null>;
  const ISO_ZEIT = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})?$/;
  const UUID = /^[0-9a-f-]{36}$/i;
  const gueltig: Record<string, (v: unknown) => boolean> = {
    follow_up_due: (v) => v === null || (typeof v === "string" && ISO_TAG.test(v)),
    next_recycle_at: (v) => v === null || (typeof v === "string" && ISO_TAG.test(v.slice(0, 10))),
    follow_up_last_contacted_at: (v) => v === null || (typeof v === "string" && ISO_ZEIT.test(v)),
    recycle_last_contacted_at: (v) => v === null || (typeof v === "string" && ISO_ZEIT.test(v)),
    follow_up_last_contacted_by_user_id: (v) => v === null || (typeof v === "string" && UUID.test(v)),
    recycle_attempt_count: (v) =>
      typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= Number(jetzt.recycle_attempt_count ?? 0),
  };
  const erlaubt =
    undo.quelle === "termin"
      ? ["follow_up_due", "follow_up_last_contacted_at", "follow_up_last_contacted_by_user_id"]
      : ["next_recycle_at", "recycle_attempt_count", "recycle_last_contacted_at"];
  const patch: Record<string, string | number | null> = {};
  for (const k of erlaubt) {
    if (!(k in (undo.vorher ?? {}))) continue;
    const v = undo.vorher[k];
    if (!gueltig[k](v)) return { error: "Ungültiger Wert — Rückgängig abgebrochen." };
    patch[k] = v;
  }
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase
      .from(TABELLE[undo.art])
      .update(patch)
      .eq("id", undo.id)
      .eq("workspace_id", access.workspace_id);
    if (error) return { error: error.message };
  }
  await protokollZuruecknehmen(undo.kontaktId);
  revalidate();
  return {};
}

/**
 * „Aufgeben" — der Vorgang ist tot, das Recycling plant die Wiedervorlage
 * (`schedule_recycle()`), er kommt nach der Wartezeit von selbst wieder.
 * Bei einem Recycling-Eintrag heißt Aufgeben: diesen Anlauf beenden und die
 * nächste Wartezeit einplanen.
 */
export async function aufgeben(art: NachfassArt, id: string, quelle: NachfassQuelle): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (!istArt(art) || !id) return { error: "Nicht gefunden." };
  if (!(await sichtbar(art, id))) return { error: "Keine Berechtigung." };

  if (quelle === "termin") {
    if (art !== "setting" && art !== "closing") return { error: "Unbekannte Termin-Art." };
    const res = await markTerminDead(art, id);
    if (res.error) return res;
    await protokolliere({ art, id, quelle: "termin", ergebnis: "nicht_erreicht", folge: "aufgegeben", userId: access.user.id });
  } else if (quelle === "recycling") {
    const supabase = await createClient();
    const { error } = await supabase.rpc("recycle_attempt", {
      p_workspace_id: access.workspace_id,
      p_origin: ORIGIN[art],
      p_entity_id: id,
      p_today: berlinDateISO(new Date().toISOString()),
    });
    if (error) return { error: error.message };
    await scheduleRecycle(ORIGIN[art], id);
    await protokolliere({ art, id, quelle: "recycling", ergebnis: "nicht_erreicht", folge: "aufgegeben", userId: access.user.id });
  } else {
    // Rückruf aufgeben (aus dem Aufräumen): der Lead ist tot wie nach „Toter
    // Lead" im Call-Modus, das Recycling plant ihn ein. Keine Anwahl im Log —
    // es wurde nicht gewählt.
    if (art !== "phone_lead") return { error: "Unbekannte Art." };
    const supabase = await createClient();
    const { error } = await supabase
      .from("phone_leads")
      .update({ status: "dead", callback_at: null })
      .eq("id", id)
      .eq("workspace_id", access.workspace_id);
    if (error) return { error: error.message };
    await scheduleRecycle("telefon", id);
  }
  revalidate();
  return {};
}

/** „Sperren" — Sperrliste, nie wieder (Termin: vorher tot setzen). */
export async function sperren(art: NachfassArt, id: string, quelle: NachfassQuelle): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (!istArt(art) || !id) return { error: "Nicht gefunden." };
  if (!(await sichtbar(art, id))) return { error: "Keine Berechtigung." };

  if (quelle === "termin") {
    if (art !== "setting" && art !== "closing") return { error: "Unbekannte Termin-Art." };
    const res = await markTerminDead(art, id);
    if (res.error) return res;
  } else if (quelle === "rueckruf") {
    const supabase = await createClient();
    const { error } = await supabase
      .from("phone_leads")
      .update({ status: "dead", callback_at: null })
      .eq("id", id)
      .eq("workspace_id", access.workspace_id);
    if (error) return { error: error.message };
  }
  const res = await excludeFromRecycle(ORIGIN[art], id);
  if (res.error) return res;
  if (quelle !== "rueckruf") {
    await protokolliere({
      art,
      id,
      quelle: quelle === "termin" ? "termin" : "recycling",
      ergebnis: "nicht_erreicht",
      folge: "gesperrt",
      userId: access.user.id,
    });
  }
  revalidate();
  return {};
}

/**
 * „Nochmal versuchen" aus dem Aufräumen — setzt nur das Fälligkeitsdatum. Kein
 * Protokolleintrag: Es war kein Kontakt.
 */
export async function nochmalVersuchen(
  art: NachfassArt,
  id: string,
  quelle: NachfassQuelle,
  tag: string,
): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (!istArt(art) || !id) return { error: "Nicht gefunden." };
  if (!ISO_TAG.test(tag)) return { error: "Bitte ein Datum wählen." };
  if (!(await sichtbar(art, id))) return { error: "Keine Berechtigung." };

  const supabase = await createClient();
  let patch: Record<string, string | null>;
  if (quelle === "termin") patch = { follow_up_due: tag, ...(art === "closing" ? { follow_up_due_at: null } : {}) };
  else if (quelle === "recycling") patch = { next_recycle_at: tag };
  else return { error: "Einen Rückruf bitte über „Rückruf verschieben“ neu terminieren." };

  const { error } = await supabase.from(TABELLE[art]).update(patch).eq("id", id).eq("workspace_id", access.workspace_id);
  if (error) return { error: error.message };
  revalidate();
  return {};
}

/** Sammelaktion für das Aufräumen. Läuft einzeln, damit jeder Riegel greift. */
export async function sammelAktion(
  eintraege: { art: NachfassArt; id: string; quelle: NachfassQuelle }[],
  aktion: "nochmal" | "aufgeben" | "sperren",
  tag?: string,
): Promise<{ ok: number; fehler: string[] }> {
  const fehler: string[] = [];
  let ok = 0;
  for (const e of (eintraege ?? []).slice(0, 500)) {
    const res =
      aktion === "nochmal"
        ? await nochmalVersuchen(e.art, e.id, e.quelle, tag ?? "")
        : aktion === "aufgeben"
          ? await aufgeben(e.art, e.id, e.quelle)
          : await sperren(e.art, e.id, e.quelle);
    if (res.error) fehler.push(res.error);
    else ok += 1;
  }
  revalidate();
  return { ok, fehler: [...new Set(fehler)] };
}
