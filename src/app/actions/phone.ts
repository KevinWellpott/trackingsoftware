"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext, listDataViewUsers, ownScopeFilter, type AccessContext } from "@/lib/access";
import { berlinInputToIso } from "@/lib/apptTime";
import { revalidatePath } from "next/cache";
import { parsePhoneCsv } from "@/lib/phone-csv";
import { logCallAttempt } from "@/app/actions/phoneAttempts";
import type { PhoneCallKind, PhoneListKind } from "@/lib/types";

// Telefonakquise: Listen, Routing (Rückruf/Nicht erreicht = echte separate Listen),
// Lead-CRUD und CSV-Import. Personenbezogen über created_by_user_id/owner_name.

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function canAccessPhoneList(listId: string): Promise<boolean> {
  const access = await getAccessContext();
  if (!access) return false;
  const supabase = await createClient();
  let query = supabase
    .from("phone_lists")
    .select("id")
    .eq("id", listId)
    .eq("workspace_id", access.workspace_id);
  const ownScope = ownScopeFilter(access);
  if (ownScope) {
    query = query.or(ownScope);
  }
  const { data } = await query.maybeSingle();
  return Boolean(data);
}

/**
 * Freitext-Gruppierungswert normalisieren (Branche, Skript-Label).
 *
 * Trimmen + Mehrfach-Leerzeichen einkochen ist hier kein Kosmetik-Schritt: Die
 * Auswertung gruppiert nach genau diesen Werten, und „ Handwerk" / „Handwerk "
 * / „Hand  werk" wären sonst drei Testarme mit je zu kleiner Fallzahl. Die
 * Gross-/Kleinschreibung bleibt bewusst erhalten (die Auswertung dedupliziert
 * case-insensitiv) — sonst müsste die App entscheiden, ob „SaaS" oder „saas"
 * die richtige Schreibweise ist.
 */
function cleanGroupValue(raw: FormDataEntryValue | string | null | undefined): string | null {
  const s = String(raw ?? "").trim().replace(/\s+/g, " ");
  return s || null;
}

/** Telefonliste archivieren/wiederherstellen (Admin-Archiv-Ansicht). */
export async function setPhoneListArchived(listId: string, archived: boolean): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (!(access.role === "owner" && access.data_scope === "workspace")) {
    return { error: "Keine Berechtigung." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("phone_lists")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", listId)
    .eq("workspace_id", access.workspace_id);
  if (error) return { error: error.message };
  revalidatePath("/telefon", "page");
  revalidatePath("/team/archiv", "page");
  revalidatePath("/", "layout");
  return {};
}

export async function restorePhoneListForm(formData: FormData) {
  const listId = String(formData.get("list_id") ?? "");
  if (!listId) return;
  await setPhoneListArchived(listId, false);
}

const ROUTING_LABEL: Record<Exclude<PhoneListKind, "akquise">, string> = {
  rueckruf: "Rückruf",
  nicht_erreicht: "Nicht erreicht",
};

/** Stellt sicher, dass die Routing-Liste (Rückruf / Nicht erreicht) für den Owner existiert. */
async function ensurePhoneRoutingList(
  source: { workspace_id: string; created_by_user_id: string | null; owner_name: string | null },
  kind: Exclude<PhoneListKind, "akquise">,
): Promise<string | null> {
  const supabase = await createClient();
  let sel = supabase
    .from("phone_lists")
    .select("id")
    .eq("workspace_id", source.workspace_id)
    .eq("list_kind", kind);
  sel = source.created_by_user_id
    ? sel.eq("created_by_user_id", source.created_by_user_id)
    : sel.is("created_by_user_id", null);
  const { data: existing } = await sel.maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from("phone_lists")
    .insert({
      workspace_id: source.workspace_id,
      created_by_user_id: source.created_by_user_id,
      owner_name: source.owner_name,
      name: ROUTING_LABEL[kind],
      list_kind: kind,
    })
    .select("id")
    .single();
  if (error || !created) return null;
  return created.id;
}

/**
 * Wem darf eine neu angelegte Liste gehoeren?
 *
 * `owner_name` ist die Auswertungsachse (`list_owned_by_user()`, `buildOwnScope()`)
 * und matcht auf `profiles.username` INNERHALB der Organisation. Ein Name, der dort
 * kein Mitglied ist, macht die Liste heimatlos: Sie erscheint auf `/telefon` unter
 * einer Person, die es in dieser Organisation nicht gibt, ihre Leads zaehlen in
 * keiner Telefon-RPC mit, und sobald eine Datensicht aktiv ist, faellt sie aus dem
 * Personenfilter — die Detailseite antwortet dann mit 404 auf eine Liste, die es
 * gibt. Genau das passiert einem Plattform-Admin in fremder Organisation: Er ist
 * dort kein `workspace_members`-Eintrag (§2), sein eigener Name ist also nie ein
 * gueltiger Inhaber. Invariante §8 verlangt dasselbe.
 *
 * Der Name kommt deshalb IMMER aus `profiles` und nie aus dem Formular — sonst
 * entscheidet eine Schreibweise im Client darueber, ob die Auswertung greift.
 */
async function resolveListOwner(
  access: AccessContext,
  requestedUserId: string | null,
): Promise<{ userId: string; username: string } | { error: string }> {
  const members = await listDataViewUsers(access.workspace_id);
  if (members.length === 0) {
    return {
      error: `„${access.workspaces.name}" hat noch kein Mitglied. Lege dort zuerst einen Nutzer an — ohne Inhaber wäre die Liste in keiner Auswertung sichtbar.`,
    };
  }
  const wanted = requestedUserId ?? access.user.id;
  const hit = members.find((m) => m.user_id === wanted);
  if (hit) return { userId: hit.user_id, username: hit.username };

  // Nicht-Mitglied angefragt. Fuer den Plattform-Admin in fremder Organisation
  // ist das der Normalfall und keine Fehlbedienung — er muss nur sagen, WEM die
  // Liste gehoert. Deshalb nennt die Meldung die Auswahl statt nur „verboten".
  const names = members.map((m) => m.username).join(", ");
  return {
    error: access.is_foreign_org
      ? `Du bist in „${access.workspaces.name}" kein Mitglied und kannst dort nichts besitzen. Wähle als Inhaber: ${names}.`
      : `Der gewählte Inhaber gehört nicht zu „${access.workspaces.name}". Zur Auswahl stehen: ${names}.`,
  };
}

/** Neue Akquise-Liste anlegen (für den Import; owner kann von auth.uid abweichen). */
export async function createPhoneList(input: {
  name: string;
  /** Nur die user_id — der Anzeigename kommt aus `profiles` (siehe resolveListOwner). */
  ownerUserId: string | null;
}): Promise<{ id?: string; error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  const owner = await resolveListOwner(access, input.ownerUserId);
  if ("error" in owner) return { error: owner.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("phone_lists")
    .insert({
      workspace_id: access.workspace_id,
      created_by_user_id: owner.userId,
      owner_name: owner.username,
      name: input.name.trim() || "Telefonliste",
      list_kind: "akquise",
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Liste anlegen fehlgeschlagen." };
  revalidatePath("/telefon", "page");
  revalidatePath("/", "layout");
  return { id: data.id };
}

/**
 * Skript, Testarm und Ziel-Branche einer Telefonliste pflegen (Migration 0029).
 *
 * Warum an der LISTE und nicht am Lead: `phone_leads.script` existiert zwar,
 * ist aber pro Zeile und damit als Testachse unbrauchbar. Die Liste ist die
 * kleinste Einheit, die ein Setter tatsächlich am Stück abtelefoniert.
 *
 * `script_label` ist dabei das Wichtigste: Jeder CSV-Import legt eine neue
 * Liste an — ohne ein gemeinsames Label zerfällt der Test in so viele Arme wie
 * es Importe gab, jeder mit einer Fallzahl, aus der sich nichts ableiten lässt.
 *
 * Berechtigung: `canAccessPhoneList` prüft Organisation UND Personenscope; ein
 * Mitglied mit Datensicht „nur eigene Daten" kann damit keine fremde Liste
 * umschreiben.
 */
export async function updatePhoneListScript(
  listId: string,
  patch: { script_text?: string | null; script_label?: string | null; target_group?: string | null },
): Promise<{ error?: string }> {
  if (!(await canAccessPhoneList(listId))) return { error: "Keine Berechtigung." };
  const supabase = await createClient();
  const { error } = await supabase.from("phone_lists").update(patch).eq("id", listId);
  if (error) return { error: error.message };

  // Testarm auf die Leads durchstempeln, die noch in dieser Liste liegen
  // (Migration 0030). Maßgeblich für die Auswertung ist der Wert AM LEAD, weil
  // er den Umzug in eine Routing-Liste überlebt. Wer das Label nachträglich
  // setzt, erwartet zu Recht, dass die bereits importierten Leads dazugehören.
  // Bereits abgewanderte Leads bleiben bewusst außen vor: Sie liegen nicht mehr
  // in dieser Liste, und ihr Arm ist nicht mehr zweifelsfrei feststellbar.
  if (patch.script_label !== undefined) {
    await supabase
      .from("phone_leads")
      .update({ script_label: patch.script_label })
      .eq("list_id", listId);
  }

  revalidatePath(`/telefon/${listId}`, "page");
  revalidatePath("/telefon", "page");
  revalidatePath("/analyse", "page");
  return {};
}

/** Formular-Variante für die Telefonlisten-Seite (progressive enhancement, kein Client-State). */
export async function updatePhoneListScriptForm(formData: FormData) {
  const listId = String(formData.get("list_id") ?? "");
  if (!listId) return;
  await updatePhoneListScript(listId, {
    // Leerer Text = Feld geleert, deshalb explizit null statt "" — sonst stünde
    // in der Auswertung ein Testarm namens "".
    script_text: String(formData.get("script_text") ?? "").trim() || null,
    script_label: cleanGroupValue(formData.get("script_label")),
    target_group: cleanGroupValue(formData.get("target_group")),
  });
}

export type PhoneLeadInput = {
  list_id: string;
  decider_name?: string | null;
  company?: string | null;
  phone?: string | null;
  website?: string | null;
  email?: string | null;
  decider_direct_dial?: string | null;
  first_call_at?: string | null;
  call_attempt?: number | null;
  gatekeeper_reached?: "ja" | "nein" | "direkt" | null;
  gatekeeper_attempts?: number | null;
  script?: string | null;
  decider_reached?: boolean | null;
  /** Der Pitch kam durch — seit Migration 0028 getrennt von `decider_reached`. */
  pitch_delivered?: boolean | null;
  callback_at?: string | null;
  answer_sentiment?: "positiv" | "neutral" | "negativ" | null;
  objection_notes?: string | null;
  no_transfer_reason?: string | null;
  no_pitch_reason?: string | null;
  no_appointment_reason?: string | null;
  mailbox?: boolean | null;
  yt_video_link?: string | null;
  target_group?: string | null;
  notes?: string | null;
};

export async function createPhoneLead(input: PhoneLeadInput): Promise<{ id?: string; error?: string }> {
  if (!(await canAccessPhoneList(input.list_id))) return { error: "Keine Berechtigung." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("phone_leads")
    .insert({ ...input, status: "aktiv" })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Anlegen fehlgeschlagen." };
  revalidatePath(`/telefon/${input.list_id}`, "page");
  revalidatePath("/telefon", "page");
  return { id: data.id };
}

export async function updatePhoneLead(
  leadId: string,
  listId: string,
  patch: Partial<PhoneLeadInput>,
): Promise<{ error?: string }> {
  if (!(await canAccessPhoneList(listId))) return { error: "Keine Berechtigung." };
  const supabase = await createClient();
  // callback_at kommt als datetime-local (Berlin-Wandzeit) aus dem Call-Modus.
  if (patch.callback_at) patch = { ...patch, callback_at: berlinInputToIso(patch.callback_at) };
  const { error } = await supabase.from("phone_leads").update(patch).eq("id", leadId).eq("list_id", listId);
  if (error) return { error: error.message };
  revalidatePath(`/telefon/${listId}`, "page");
  revalidatePath("/telefon", "page");
  return {};
}

/**
 * Ergebnis eines Anrufs setzen. Rückruf/Nicht-erreicht verschieben den Lead
 * physisch in die jeweilige Routing-Liste des Owners. Rückruf braucht callback_at.
 *
 * Die vier Outcome-Buttons im Call-Modus SIND das Anruf-Ereignis: jeder Klick
 * ist genau eine Anwahl und wird in `phone_call_attempts` protokolliert
 * (Migration 0028). `attemptNo`/`kind` kommen aus dem Log zurück, damit die UI
 * den Versuchszähler anzeigen kann, ohne ihn selbst zu führen — beides ist
 * optional, weil das Protokollieren fail-soft ist (siehe unten).
 */
export async function setPhoneLeadOutcome(input: {
  leadId: string;
  listId: string;
  outcome: "aktiv" | "rueckruf" | "nicht_erreicht" | "dead";
  callbackAt?: string | null;
}): Promise<{ error?: string; attemptNo?: number; kind?: PhoneCallKind }> {
  if (!(await canAccessPhoneList(input.listId))) return { error: "Keine Berechtigung." };
  if (input.outcome === "rueckruf" && !input.callbackAt) {
    return { error: "Für einen Rückruf ist Datum + Uhrzeit erforderlich." };
  }
  const supabase = await createClient();

  // Lead + Quell-Liste laden (Owner/Workspace für Routing)
  const { data: lead } = await supabase
    .from("phone_leads")
    .select("id, list_id, status, first_call_at, phone_lists!inner(workspace_id, created_by_user_id, owner_name)")
    .eq("id", input.leadId)
    .maybeSingle();
  if (!lead) return { error: "Lead nicht gefunden." };
  const srcList = (lead as unknown as {
    phone_lists: { workspace_id: string; created_by_user_id: string | null; owner_name: string | null };
  }).phone_lists;

  const patch: Record<string, unknown> = { status: input.outcome };
  if (!(lead as { first_call_at?: string | null }).first_call_at) patch.first_call_at = todayLocal();

  if (input.outcome === "rueckruf") {
    patch.callback_at = berlinInputToIso(input.callbackAt);
    const target = await ensurePhoneRoutingList(srcList, "rueckruf");
    if (target) patch.list_id = target;
  } else if (input.outcome === "nicht_erreicht") {
    const target = await ensurePhoneRoutingList(srcList, "nicht_erreicht");
    if (target) patch.list_id = target;
  }
  // 'dead' und 'aktiv' bleiben in der aktuellen Liste.

  const { error } = await supabase.from("phone_leads").update(patch).eq("id", input.leadId);
  if (error) return { error: error.message };

  // Anwahl protokollieren — NACH dem Update, weil logCallAttempt den Lead-Stand
  // als Snapshot liest (Status entscheidet über den Topf, mailbox/gatekeeper/
  // pitch_delivered werden eingefroren). Das Ergebnis ist bewusst nur
  // Zusatzinformation: schlägt der Log-Eintrag fehl (Migration 0028 noch nicht
  // eingespielt, RLS, Netz), bleibt das Outcome trotzdem gespeichert — der
  // Setter sitzt im Telefonat und darf hier nicht vor einer Fehlermeldung landen.
  // 'aktiv' hat im Log keine Entsprechung (CHECK-Constraint) und wird zu
  // 'kein_ergebnis': angerufen wurde trotzdem.
  const logged = await logCallAttempt({
    leadId: input.leadId,
    outcome: input.outcome === "aktiv" ? "kein_ergebnis" : input.outcome,
    // Status VOR dem Update: Der Topf beschreibt, was dieser Anruf WAR, nicht
    // was er ausgeloest hat. Ohne das wuerde der Anruf, in dem ein Rueckruf
    // VEREINBART wird, als 'rueckruf' zaehlen — und der spaeter tatsaechlich
    // gefuehrte Rueckruf als 'folgeanruf'. Genau die beiden Toepfe, die
    // "Nachfassen oder neue Leads?" gegeneinander stellt.
    statusBefore: (lead as { status?: string | null }).status ?? null,
  });

  revalidatePath(`/telefon/${input.listId}`, "page");
  revalidatePath("/telefon", "page");
  revalidatePath("/nachfassen", "page");
  revalidatePath("/", "layout");
  return { attemptNo: logged.attemptNo, kind: logged.kind };
}

/** Ganze Telefonliste löschen (Leads hängen per ON DELETE CASCADE dran). */
export async function deletePhoneList(listId: string): Promise<{ error?: string }> {
  if (!(await canAccessPhoneList(listId))) return { error: "Keine Berechtigung." };
  const supabase = await createClient();
  const { error } = await supabase.from("phone_lists").delete().eq("id", listId);
  if (error) return { error: error.message };
  revalidatePath("/telefon", "page");
  revalidatePath("/", "layout");
  return {};
}

export async function deletePhoneLead(leadId: string, listId: string): Promise<{ error?: string }> {
  if (!(await canAccessPhoneList(listId))) return { error: "Keine Berechtigung." };
  const supabase = await createClient();
  const { error } = await supabase.from("phone_leads").delete().eq("id", leadId).eq("list_id", listId);
  if (error) return { error: error.message };
  revalidatePath(`/telefon/${listId}`, "page");
  revalidatePath("/telefon", "page");
  return {};
}

/** CSV-Import (Google-Maps-Export). Nur Firma/Telefon/Website; personenbezogen. */
export async function importPhoneCsv(
  formData: FormData,
): Promise<{ error?: string; imported?: number; duplicates?: number; total?: number; listId?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Keine Datei erhalten." };

  // Inhaber gegen die MITGLIEDER der aktiven Organisation aufloesen, nicht gegen
  // das Formular. Ohne diesen Schritt stempelt ein Plattform-Admin in fremder
  // Organisation seinen eigenen Namen auf die Liste — siehe resolveListOwner.
  const owner = await resolveListOwner(
    access,
    String(formData.get("owner_user_id") ?? "").trim() || null,
  );
  if ("error" in owner) return { error: owner.error };
  const { userId: ownerUserId, username: ownerName } = owner;

  const listName =
    String(formData.get("list_name") ?? "").trim() ||
    file.name.replace(/\.csv$/i, "").trim() ||
    "Telefonliste";
  // Branche des Imports. Wird als Listen-Default gespeichert UND auf jeden Lead
  // gestempelt: Die Auswertung liest den Lead-Wert (er bleibt maßgeblich, wenn
  // jemand einen Lead später umsortiert), die Liste trägt ihn nur als Vorgabe.
  const targetGroup = cleanGroupValue(formData.get("target_group"));

  const text = await file.text();
  const { rows, totalDataRows } = parsePhoneCsv(text);
  if (rows.length === 0) return { error: "Keine verwertbaren Zeilen (Firma/Telefon) gefunden.", total: totalDataRows };

  const supabase = await createClient();
  const scriptLabel = cleanGroupValue(formData.get("script_label"));

  // Akquise-Liste anlegen
  const { data: list, error: listErr } = await supabase
    .from("phone_lists")
    .insert({
      workspace_id: access.workspace_id,
      created_by_user_id: ownerUserId,
      owner_name: ownerName,
      name: listName,
      list_kind: "akquise",
      target_group: targetGroup,
      script_label: scriptLabel,
    })
    .select("id")
    .single();
  if (listErr || !list) return { error: listErr?.message ?? "Liste anlegen fehlgeschlagen." };

  // Dedup gegen bestehende Telefonnummern des Owners — innerhalb der aktiven
  // Organisation. Ohne den Org-Filter wuerde ein Plattform-Admin gegen die
  // Nummern ALLER Organisationen entduplizieren und Leads faelschlich als
  // Dublette verwerfen.
  const { data: existing } = await supabase
    .from("phone_leads")
    .select("phone")
    .eq("workspace_id", access.workspace_id)
    .eq("created_by_user_id", ownerUserId);
  const seen = new Set(
    (existing ?? []).map((r) => (r.phone ?? "").replace(/[^\d+]/g, "")).filter(Boolean),
  );

  const toInsert: Array<Record<string, unknown>> = [];
  let duplicates = 0;
  for (const r of rows) {
    const norm = (r.phone ?? "").replace(/[^\d+]/g, "");
    if (norm && seen.has(norm)) {
      duplicates++;
      continue;
    }
    if (norm) seen.add(norm);
    toInsert.push({
      list_id: list.id,
      created_by_user_id: ownerUserId,
      company: r.company,
      phone: r.phone,
      website: r.website,
      // Handrecherchierte Listen tragen den Entscheider und oft eine Mail schon
      // in eigenen Spalten. Beides wurde bisher verworfen — im Call-Mode musste
      // es dann jemand ein zweites Mal herausfinden.
      decider_name: r.deciderName,
      email: r.email,
      // Zeilenwert schlägt den Dialog-Wert: Eine gemischte Datei mit
      // `branche`-Spalte soll je Zeile korrekt landen, eine sortenreine Datei
      // ohne Spalte bekommt durchgängig den im Dialog gewählten Wert.
      target_group: cleanGroupValue(r.targetGroup) ?? targetGroup,
      // Testarm am LEAD festschreiben, nicht nur an der Liste (Migration 0030).
      // Der Lead wandert bei „Rückruf"/„Nicht erreicht" physisch in eine
      // Routing-Liste ohne Label — waere der Arm nur an der Liste, fielen
      // ausgerechnet die schlechten Ausgaenge aus dem Test und jedes Skript
      // saehe besser aus als es ist.
      script_label: scriptLabel,
      status: "aktiv",
    });
  }

  // Batched insert (≤500)
  let imported = 0;
  for (let i = 0; i < toInsert.length; i += 500) {
    const chunk = toInsert.slice(i, i + 500);
    const { error } = await supabase.from("phone_leads").insert(chunk);
    if (error) return { error: error.message, imported, duplicates, total: totalDataRows, listId: list.id };
    imported += chunk.length;
  }

  await supabase.from("csv_imports").insert({
    workspace_id: access.workspace_id,
    created_by_user_id: ownerUserId,
    owner_name: ownerName,
    filename: file.name,
    phone_list_id: list.id,
    row_count: totalDataRows,
    imported_count: imported,
    duplicate_count: duplicates,
  });

  revalidatePath("/telefon", "page");
  revalidatePath("/", "layout");
  return { imported, duplicates, total: totalDataRows, listId: list.id };
}
