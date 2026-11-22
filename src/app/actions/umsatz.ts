"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { getAccessContext } from "@/lib/access";
import { getInternRechte } from "@/lib/internData";
import { berlinDateISO } from "@/lib/apptTime";
import { cent, parseEuro } from "@/lib/umsatz";
import { planeAktion, type GeldAktion } from "@/lib/geldAktion";
import {
  KOSTEN_KATEGORIE_LABELS,
  RHYTHMUS_LABELS,
  istMonat,
  type KostenKategorie,
  type KostenRhythmus,
} from "@/lib/finanzen";
import type { KundenRate, KundenVertrag, KundenZahlung } from "@/lib/kunden";

// Schreibpfade für Geld (Migration 0047).
//
// Es gibt genau EINE Geldaktion je Kunde: `geldAktion()`. Sie prüft die Rechte,
// liest den Stand frisch, rechnet mit src/lib/umsatzPlanung.ts und schreibt
// über `finanz_anwenden()` in einer Transaktion. `version` ist der Stand, den
// die Person GESEHEN hat: Ein Doppelklick oder eine zweite Person auf altem
// Stand wird abgewiesen, statt zweimal zu buchen.

type Result = { error?: string };

const KEIN_RECHT = { error: "Nur für Admins der Titan-Organisation." };
const VERALTET = { error: "Der Stand hat sich inzwischen geändert. Bitte Fenster schließen, prüfen und noch einmal öffnen." };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireFinanz() {
  const rechte = await getInternRechte();
  if (!rechte.umsatz) return null;
  const access = await getAccessContext();
  if (!access) return null;
  return { supabase: await createClient(), userId: access.user.id };
}

function revalidate(kundeId?: string) {
  revalidatePath("/umsatz", "page");
  revalidatePath("/kunden", "page");
  if (kundeId) revalidatePath(`/kunden/${kundeId}`);
}

export async function geldAktion(
  kundeId: string,
  version: number,
  aktion: GeldAktion,
): Promise<{ error?: string; doppelt?: string }> {
  const ctx = await requireFinanz();
  if (!ctx) return KEIN_RECHT;
  if (!UUID.test(kundeId) || !Number.isInteger(version) || !aktion || typeof aktion !== "object") {
    return { error: "Ungültige Anfrage." };
  }

  const { supabase } = ctx;
  const { data, error } = await supabase.from("kunden_vertraege").select("*").eq("kunde_id", kundeId).maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Kunde nicht gefunden." };
  const vertrag = data as KundenVertrag;
  if (vertrag.version !== version) {
    revalidate(kundeId);
    return VERALTET;
  }

  try {
    const [raten, zahlungen] = await Promise.all([
      fetchAllRows<KundenRate>(
        (from, to) => supabase.from("kunden_raten").select("*").eq("kunde_id", kundeId).order("id").range(from, to) as never,
      ),
      fetchAllRows<KundenZahlung>(
        (from, to) => supabase.from("kunden_zahlungen").select("*").eq("kunde_id", kundeId).order("id").range(from, to) as never,
      ),
    ]);

    const ergebnis = planeAktion(
      {
        vertrag: { ...vertrag, vertragswert: Number(vertrag.vertragswert) },
        raten: raten.map((r) => ({ ...r, betrag: Number(r.betrag) })),
        zahlungen: zahlungen.map((z) => ({ ...z, betrag: Number(z.betrag) })),
      },
      aktion,
      { heute: berlinDateISO(new Date().toISOString()), neueId: randomUUID },
    );
    if ("error" in ergebnis) return { error: ergebnis.error };
    if ("doppelt" in ergebnis) return { doppelt: ergebnis.doppelt };

    const { error: e } = await supabase.rpc("finanz_anwenden", {
      p_kunde_id: kundeId,
      p_version: version,
      p: ergebnis.aenderung,
    });
    revalidate(kundeId);
    if (e) return e.message.includes("STAND_VERALTET") ? VERALTET : { error: e.message };
    return {};
  } catch (e) {
    // Auch ein von Hand gebauter POST mit falschen Typen landet hier, statt die Seite abzuräumen.
    return { error: e instanceof Error ? e.message : "Die Aktion ist fehlgeschlagen." };
  }
}

// ── Erinnert ───────────────────────────────────────────────────────────────

/** Stempel „habe an die Zahlung erinnert". Ein Verlaufseintrag, keine eigene Spalte. */
export async function zahlungErinnert(kundeId: string): Promise<Result> {
  const ctx = await requireFinanz();
  if (!ctx) return KEIN_RECHT;
  if (!UUID.test(kundeId)) return { error: "Ungültige Anfrage." };
  const { error } = await ctx.supabase.from("kunden_log").insert({
    kunde_id: kundeId,
    bereich: "finanz",
    art: "erinnert",
    text: "An die Zahlung erinnert.",
    user_id: ctx.userId,
  });
  if (error) return { error: error.message };
  revalidate(kundeId);
  return {};
}

// ── Kosten ─────────────────────────────────────────────────────────────────

function betragOk(v: string | number): number | null {
  const n = parseEuro(v);
  return n !== null && cent(n) >= 0 ? n : null;
}

export async function kostenAnlegen(input: {
  name: string;
  kategorie: KostenKategorie;
  rhythmus: KostenRhythmus;
  start: string;
  betrag: string | number;
}): Promise<Result> {
  const ctx = await requireFinanz();
  if (!ctx) return KEIN_RECHT;
  const name = String(input.name ?? "").trim();
  if (!name) return { error: "Bitte einen Namen angeben." };
  if (!(input.kategorie in KOSTEN_KATEGORIE_LABELS)) return { error: "Unbekannte Kategorie." };
  if (!(input.rhythmus in RHYTHMUS_LABELS)) return { error: "Unbekannter Rhythmus." };
  if (!istMonat(input.start)) return { error: "Ungültiger Monat." };
  const betrag = betragOk(input.betrag);
  if (betrag === null) return { error: "Bitte einen gültigen Betrag eingeben." };
  const { error } = await ctx.supabase.rpc("kosten_anlegen", {
    p_name: name,
    p_kategorie: input.kategorie,
    p_rhythmus: input.rhythmus,
    p_start: input.start,
    p_betrag: betrag,
  });
  if (error) return { error: error.message };
  revalidate();
  return {};
}

export async function kostenBearbeiten(id: string, input: { name: string; kategorie: KostenKategorie }): Promise<Result> {
  const ctx = await requireFinanz();
  if (!ctx) return KEIN_RECHT;
  const name = String(input.name ?? "").trim();
  if (!name) return { error: "Bitte einen Namen angeben." };
  if (!(input.kategorie in KOSTEN_KATEGORIE_LABELS)) return { error: "Unbekannte Kategorie." };
  const { error } = await ctx.supabase.from("kosten_positionen").update({ name, kategorie: input.kategorie }).eq("id", id);
  if (error) return { error: error.message };
  revalidate();
  return {};
}

/** Neuer Betrag ab Monat X. Frühere Monate behalten ihren. */
export async function kostenBetragAb(id: string, monat: string, wert: string | number): Promise<Result> {
  const ctx = await requireFinanz();
  if (!ctx) return KEIN_RECHT;
  if (!istMonat(monat)) return { error: "Ungültiger Monat." };
  const betrag = betragOk(wert);
  if (betrag === null) return { error: "Bitte einen gültigen Betrag eingeben." };
  const { data, error } = await ctx.supabase.from("kosten_positionen").select("start_monat").eq("id", id).maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Position nicht gefunden." };
  if (monat < (data as { start_monat: string }).start_monat) return { error: "Die Position beginnt erst später." };
  const { error: e } = await ctx.supabase.from("kosten_betraege").upsert({ position_id: id, gueltig_ab: monat, betrag });
  if (e) return { error: e.message };
  revalidate();
  return {};
}

/** Ist-Betrag oder Aussetzen für EINEN Monat. Leer heißt: es gilt der Plan. */
export async function kostenMonat(
  id: string,
  monat: string,
  input: { ist: string | number; ausgesetzt: boolean },
): Promise<Result> {
  const ctx = await requireFinanz();
  if (!ctx) return KEIN_RECHT;
  if (!istMonat(monat)) return { error: "Ungültiger Monat." };
  const ist = input.ist === "" ? null : betragOk(input.ist);
  if (input.ist !== "" && ist === null) return { error: "Bitte einen gültigen Betrag eingeben." };
  const ausgesetzt = input.ausgesetzt === true;
  const tabelle = ctx.supabase.from("kosten_monate");
  const { error } =
    ist === null && !ausgesetzt
      ? await tabelle.delete().eq("position_id", id).eq("monat", monat)
      : await tabelle.upsert({ position_id: id, monat, ist, ausgesetzt });
  if (error) return { error: error.message };
  revalidate();
  return {};
}

/** Letzter Monat, in dem die Position anfällt. null nimmt das Ende zurück. */
export async function kostenBeenden(id: string, letzterMonat: string | null): Promise<Result> {
  const ctx = await requireFinanz();
  if (!ctx) return KEIN_RECHT;
  if (letzterMonat !== null && !istMonat(letzterMonat)) return { error: "Ungültiger Monat." };
  const { error } = await ctx.supabase.from("kosten_positionen").update({ ende_monat: letzterMonat }).eq("id", id);
  if (error) {
    return { error: error.code === "23514" ? "Das Ende liegt vor dem Beginn." : error.message };
  }
  revalidate();
  return {};
}

export async function kostenLoeschen(id: string): Promise<Result> {
  const ctx = await requireFinanz();
  if (!ctx) return KEIN_RECHT;
  const { error } = await ctx.supabase.from("kosten_positionen").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidate();
  return {};
}

export async function setRuecklage(prozent: string | number): Promise<Result> {
  const ctx = await requireFinanz();
  if (!ctx) return KEIN_RECHT;
  const p = parseEuro(typeof prozent === "string" ? prozent.replace("%", "") : prozent);
  if (p === null || p < 0 || p > 100) return { error: "Bitte einen Prozentsatz zwischen 0 und 100 eingeben." };
  const { error } = await ctx.supabase.from("intern_einstellungen").update({ steuerruecklage_prozent: p }).eq("id", true);
  if (error) return { error: error.message };
  revalidate();
  return {};
}
