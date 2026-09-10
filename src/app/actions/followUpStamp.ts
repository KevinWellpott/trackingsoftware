"use server";

// Die Schreibpfade der Arbeitsliste — drei Handgriffe je Zeile.
//
// Zwei davon gibt es ohne den Rückbau nicht (der Ein-Klick-Stempel „Genervt"
// und das Beenden einer Zeile), der dritte RUFT DIE VORHANDENEN ACTIONS
// (`rescheduleSetting`, `updateClosingCall`, `setSettingOutcome`,
// `setClosingOutcome`) statt sie nachzubauen: Dort hängen Folgen dran —
// Quell-Datensatz nachziehen, Ergebnis zurücksetzen, Recycling einplanen,
// Erinnerungen entwerten —, und eine zweite Formulierung derselben Sache wäre
// genau der Ballast, gegen den dieser Umbau sich richtet.

import { revalidatePath } from "next/cache";

import { getAccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { updateClosingCall, setClosingOutcome } from "@/app/actions/closingCalls";
import { rescheduleSetting, setSettingOutcome } from "@/app/actions/settingCalls";
import { berlinInputToIso } from "@/lib/apptTime";

export type TerminArt = "setting" | "closing";

const TABELLE: Record<TerminArt, "setting_calls" | "closing_calls"> = {
  setting: "setting_calls",
  closing: "closing_calls",
};

/**
 * Gehört die Zeile zur AKTIVEN Organisation?
 *
 * Nicht „RLS hat sie durchgelassen": Für einen Plattform-Admin lässt RLS jede
 * Zeile durch (docs §2). Wortgleich zu `canAccessSettingCall` /
 * `canAccessClosingCall` in den beiden Termin-Actions.
 */
async function gehoertZurOrg(art: TerminArt, id: string): Promise<boolean> {
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

/**
 * Der Stempel: „Ich habe den heute genervt." — die Entsprechung des
 * LinkedIn-FU-Chips.
 *
 * Er schreibt in `follow_up_last_contacted_at` / `_by_user_id` (Migration
 * 0041). Die Zeile wird dadurch ruhig und leuchtet morgen wieder — WIE genervt
 * wurde, interessiert bewusst niemanden: „DM, Anruf, WhatsApp, Mail,
 * Brieftaube". Es gibt deshalb keinen Kanal, keine Stufe, keinen Text.
 *
 * DER STEMPLER IST EIN AUDIT-FELD, keine Zuständigkeit (docs §2): Wer geklickt
 * hat, ist nicht zwingend der, dem der Termin gehört — ein Owner mit Team-Sicht
 * arbeitet die Liste eines Kollegen ab, ein Plattform-Admin die einer fremden
 * Organisation. Geschrieben wird deshalb `access.user.id` (die real angemeldete
 * Person), NICHT `effective_user_id` (die eingestellte Datensicht). Genau
 * diesen Fehler hatte `created_by_user_id` bis Migration 0028.
 *
 * SOLANGE 0041 NICHT EINGESPIELT IST, scheitert das UPDATE mit PGRST204 („column
 * ... does not exist"). Das darf nicht als rohe Postgres-Meldung beim Nutzer
 * landen, und es ist auch keine Fehlbedienung — deshalb der eigene Satz. Die
 * LESENDE Seite ist davon nicht betroffen: Die Termine-Seite lädt mit
 * `select("*")` und bekommt dann schlicht zwei Felder weniger (siehe
 * `WithCancellation` in src/lib/termine.ts).
 */
export async function markFollowUpContacted(
  art: TerminArt,
  id: string,
): Promise<{ error?: string; at?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (art !== "setting" && art !== "closing") return { error: "Unbekannte Termin-Art." };
  if (typeof id !== "string" || !id) return { error: "Nicht gefunden." };
  if (!(await gehoertZurOrg(art, id))) return { error: "Keine Berechtigung." };

  const at = new Date().toISOString();
  const supabase = await createClient();
  const { error } = await supabase
    .from(TABELLE[art])
    .update({
      follow_up_last_contacted_at: at,
      follow_up_last_contacted_by_user_id: access.user.id,
    })
    .eq("id", id)
    .eq("workspace_id", access.workspace_id);

  if (error) {
    if (/follow_up_last_contacted/.test(error.message)) {
      return { error: "Der Nachfass-Stempel fehlt in der Datenbank — Migration 0041 ist noch nicht eingespielt." };
    }
    return { error: error.message };
  }

  revalidatePath("/termine", "page");
  revalidatePath(art === "setting" ? `/setting/${id}` : `/closing/${id}`, "page");
  revalidatePath("/", "layout");
  return { at };
}

/**
 * „Neuen Termin ansetzen" — der gute Ausgang: Danach ist die Zeile versorgt und
 * verschwindet aus der Arbeitsmenge.
 *
 * Das Datum schreiben die VORHANDENEN Actions. Was diese hier davor erledigt,
 * ist der eine Schritt, den keine von ihnen kennt:
 *
 * ── `revived_at` — die Absage für überholt erklären ───────────────────────
 * Eine Absage lässt `appointment_at` stehen (docs §3). Aus `cancelled_at` und
 * dem Datum allein ist deshalb „abgesagt, altes Datum steht noch drin" nicht
 * von „abgesagt, danach neu terminiert" zu unterscheiden — man sagt ja ab,
 * BEVOR der Termin ist. Ohne ein drittes Signal bliebe ein neu terminierter
 * Lead für immer in der Arbeitsliste stehen und würde täglich gemahnt.
 *
 * Das dritte Signal gibt es seit Migration 0032 und es hieß bis heute nur
 * niemand: `revived_at` war „als Feld vorbereitet und als Bedienschritt offen"
 * (docs §3). Dies ist der Bedienschritt. Der Vorteil gegenüber dem
 * naheliegenden Weg — `cancelled_at` einfach wieder nullen — ist, dass NICHTS
 * VERLOREN GEHT: Die Absage bleibt in der Absagequote (docs §5), die
 * Ablage-Liste „Ersatztermin steht aus" nimmt die Zeile von allein heraus (ihr
 * Riegel ist genau dieses Feld), und das Recycling fasst sie nicht mehr an.
 *
 * ── Die bekannte Lücke: ein ABGESAGTES Closing ────────────────────────────
 * `updateClosingCall` weist ein neues `call_at` auf einer abgesagten Zeile ab
 * (CANCELLED_MOVE_HINT) und prüft dabei `cancelled_at`, nicht `revived_at`. Die
 * Meldung geht deshalb unverändert an den Nutzer; der Weg bleibt „Kein Close"
 * oder die Detailseite. Der Riegel steht in einer fremden Datei und wird hier
 * NICHT umgangen — ein `security definer`-artiger Seitenweg um die Prüfung
 * eines anderen Moduls wäre der teurere Fehler.
 */
export async function setNeuerTermin(
  art: TerminArt,
  id: string,
  /** Berlin-Wandzeit ("2026-09-21T10:00") — dasselbe Format wie überall. */
  berlinInput: string,
): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (art !== "setting" && art !== "closing") return { error: "Unbekannte Termin-Art." };
  if (typeof id !== "string" || !id) return { error: "Nicht gefunden." };
  if (!(await gehoertZurOrg(art, id))) return { error: "Keine Berechtigung." };

  const supabase = await createClient();
  const { data } = await supabase
    .from(TABELLE[art])
    .select("cancelled_at, revived_at")
    .eq("id", id)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();
  const vorher = data as { cancelled_at: string | null; revived_at: string | null } | null;

  // Nur beim ERSTEN Mal stempeln — danach ist der Zeitpunkt Historie (Muster
  // `wasCancelled` in `cancelAppointment`).
  if (vorher?.cancelled_at && !vorher.revived_at) {
    const { error } = await supabase
      .from(TABELLE[art])
      .update({ revived_at: new Date().toISOString() })
      .eq("id", id)
      .eq("workspace_id", access.workspace_id);
    if (error) return { error: error.message };
  }

  if (art === "setting") {
    // `rescheduleSetting` und nicht `moveSettingAppointment`: Ein neuer Termin
    // für jemanden, der in der Luft liegt, ist ein FRISCHER ANLAUF — Status
    // zurück auf „offen", Show-Status und Wiedervorlage weg. Sie ist außerdem
    // die einzige der beiden, die auf einer abgesagten Zeile überhaupt arbeitet.
    return rescheduleSetting(id, berlinInput);
  }
  const iso = berlinInputToIso(berlinInput);
  if (!iso) return { error: "Bitte Datum und Uhrzeit für den neuen Termin angeben." };
  return updateClosingCall(id, { call_at: iso });
}

/**
 * „Als tot markieren" — der eine Weg, eine Zeile ohne neuen Termin von der
 * Liste zu nehmen.
 *
 * Beide Zweige rufen die vorhandene Ergebnis-Action, statt selbst zu schreiben:
 * An einem Ergebnis hängen Folgen (Recycling-Datum, Entwerten offener
 * Erinnerungen, Revalidierung), und die gehören nicht in eine zweite Kopie.
 *
 * SETTING → `dead`. Der vorhandene Status-Wert, wie vom Auftraggeber verlangt;
 * `setSettingOutcome` verlangt dafür keinen Grund.
 *
 * CLOSING → `verloren` („Kein Close"). `closing_calls` kennt kein `dead`, und
 * `setClosingOutcome` besteht auf einem `lost_reason_code`. Den fragt die neue
 * Oberfläche nicht mehr ab — der Grundkatalog ist Teil des Überbaus, der hier
 * fällt. Geschickt wird deshalb `sonstiges`, und das ist keine Notlüge, sondern
 * die zutreffende Angabe: Es bedeutet „kein bestimmter Grund erfasst", genau
 * wie in dem Bestand, den Migration 0029 pauschal darauf gesetzt hat (docs §4).
 * Der praktische Gewinn ist das Recycling: `schedule_recycle()` wählt für
 * `sonstiges` den konservativen Mittelwert (`days_sonstiges`, 120 Tage) — ein
 * Direkt-UPDATE auf `status` hätte den Lead dagegen ohne Wiedervorlage
 * verschwinden lassen, und „Recycling bleibt" war die Ansage.
 */
export async function markTerminDead(art: TerminArt, id: string): Promise<{ error?: string }> {
  if (art !== "setting" && art !== "closing") return { error: "Unbekannte Termin-Art." };
  if (typeof id !== "string" || !id) return { error: "Nicht gefunden." };

  const res =
    art === "setting"
      ? await setSettingOutcome({ settingId: id, outcome: "dead" })
      : await setClosingOutcome({ closingId: id, outcome: "verloren", lostReasonCode: "sonstiges" });
  if (res.error) return { error: res.error };

  revalidatePath("/termine", "page");
  return {};
}
