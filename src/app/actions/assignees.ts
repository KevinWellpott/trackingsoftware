"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { revalidatePath } from "next/cache";

// Fachliche Zuordnung eines Setting-/Closing-Calls: genau EINE Person.
//
// Geschrieben wird direkt auf `assigned_user_id`. Die alte Tabelle
// `call_assignees` bleibt bestehen (Migration 0026/0027 fassen sie an), wird
// aber nicht mehr beschrieben: Sie ist polymorph (entity_type/entity_id) und
// hat deshalb keinen Fremdschluessel, den PostgREST einbetten koennte — jede
// Auswertung braeuchte einen zweiten Volldurchlauf plus JS-Join
// (Migration 0028 §1).

export type AssigneeEntity = "setting_call" | "closing_call";

/**
 * Liegt der Termin in der AKTIVEN Organisation?
 *
 * RLS allein reicht nicht: fuer einen Plattform-Admin ist jede Zeile
 * zugreifbar. Massgeblich ist die aktive Organisation, nicht die Sichtbarkeit.
 *
 * Gelesen wird nur die `id`. Bis zum Rueckbau kam `created_by_user_id` mit,
 * weil die Zuweisung „Niemand" die offenen Erinnerungen auf den Ersteller
 * umschreiben musste; Erinnerungen gibt es nicht mehr, und der Ersteller
 * interessiert hier niemanden.
 */
async function belongsToWorkspace(entity: AssigneeEntity, entityId: string): Promise<boolean> {
  const access = await getAccessContext();
  if (!access) return false;
  const supabase = await createClient();
  const table = entity === "setting_call" ? "setting_calls" : "closing_calls";
  const { data } = await supabase
    .from(table)
    .select("id")
    .eq("id", entityId)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();
  return Boolean(data);
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Gehoert dieses Konto zur Organisation?
 *
 * Ein Plattform-Admin ist in einer Kunden-Organisation bewusst KEIN Mitglied
 * (docs §2) — er faellt hier also zu Recht durch, denn eine Zuweisung auf ihn
 * waere in den Kundendaten genauso unauffindbar wie die auf ein geloeschtes
 * Konto.
 */
async function isMember(supabase: Supabase, workspaceId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * Zuweisung setzen — `null` bedeutet „Niemand"; die Auswertungen fallen dann
 * auf `created_by_user_id` zurueck (`personOf`, src/lib/personResolution.ts).
 *
 * Umverteilen ist Admin-Sache (Owner mit workspace-weiter Datensicht). Die
 * Pruefung steht hier und nicht nur in der Oberflaeche: Server Actions sind
 * per direktem POST erreichbar. Sie ist zugleich ein Selbstschutz — wer sich
 * mit `data_scope='own'` einen Termin wegnimmt, verliert durch RLS den Zugriff
 * darauf und koennte ihn nicht zurueckholen.
 */
export async function setAssignee(
  entity: AssigneeEntity,
  entityId: string,
  userId: string | null,
): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (!access.can_switch_view) return { error: "Keine Berechtigung." };
  if (!(await belongsToWorkspace(entity, entityId))) return { error: "Keine Berechtigung." };

  const supabase = await createClient();

  // Der DB-Guard aus Migration 0028 §11 greift bewusst nur beim Org-Umzug.
  // Ohne diese Pruefung koennte hier eine Zuweisung ueber die Org-Grenze
  // entstehen — die Zeile waere danach fuer niemanden mehr auffindbar.
  //
  // „Niemand" (userId = null) braucht KEINE Pruefung, und das ist eine
  // Korrektur: Hier stand ein Zweig, der „Niemand" verweigerte, sobald der
  // Ersteller die Organisation verlassen hatte — begruendet damit, dass der
  // Trigger `reminder_touches_ws_guard` sonst die offenen Erinnerungen des
  // Termins entwertet haette. Erinnerungen gibt es seit dem Rueckbau nicht
  // mehr; uebrig blieb ein Riegel, der einem Owner ausgerechnet den Termin
  // eines Ausgezogenen nicht mehr freigeben liess — mit einer Begruendung, die
  // ins Leere zeigte. `assigned_user_id = null` verletzt auch keine Invariante:
  // §8 prueft nur, dass eine GESETZTE Zuweisung auf ein Mitglied zeigt.
  if (userId && !(await isMember(supabase, access.workspace_id, userId))) {
    return { error: "Nutzer gehört nicht zu dieser Organisation." };
  }

  const table = entity === "setting_call" ? "setting_calls" : "closing_calls";
  const { error } = await supabase
    .from(table)
    .update({ assigned_user_id: userId })
    .eq("id", entityId)
    .eq("workspace_id", access.workspace_id);
  if (error) return { error: error.message };

  // Hier folgte bis zum Rueckbau ein zweites UPDATE auf `reminder_touches` samt
  // `revalidatePath("/erinnerungen")` — es zog die offenen Erinnerungen des
  // Termins auf die neue Person nach. Die Tabelle bleibt stehen (Muster
  // `call_assignees`, docs §3), aber sie hat keinen Leser mehr, und
  // /erinnerungen leitet nur noch weiter. Ein Roundtrip und eine
  // Revalidierung je Zuweisung fuer eine Spalte, die niemand liest.

  revalidatePath(`/${entity === "setting_call" ? "setting" : "closing"}/${entityId}`, "page");
  revalidatePath("/termine", "page");
  // Die Zuweisung ist die Personenachse aller Auswertungen — Dashboards und
  // Nachfassen zeigen sonst weiter die alte Verteilung.
  revalidatePath("/", "layout");
  return {};
}

/**
 * „Durchgeführt von" setzen — wer das Gespräch GEFÜHRT hat (Migration 0042).
 * `null` = noch nicht eingetragen.
 *
 * Das ist die zweite Personenfrage an einem Termin und bewusst eine andere als
 * die Zuweisung: Die Zuweisung sagt, wer erinnert und nervt (wer den Termin
 * gelegt hat), dieses Feld, wer am Tisch saß. In der Analyse zählt es vor der
 * Zuweisung (`gespraechsPersonOf`), und einen erschienenen Lead ohne Ergebnis
 * bekommt diese Person in ihre Arbeitsliste (`erinnererOf`).
 *
 * ANDERS ALS `setAssignee` darf das JEDES Mitglied mit Zugriff auf die Zeile:
 * „ein Feld, wo wir eintragen, wer den Termin gemacht hat" — wer das Closing
 * geführt hat, trägt sich selbst ein, ohne einen Owner darum bitten zu müssen.
 * Die Zielperson muss trotzdem Mitglied der aktiven Organisation sein; der
 * Guard aus 0042 nullte eine Zuweisung über die Org-Grenze ohnehin, dann sähe
 * der Nutzer eine gespeicherte Auswahl, die in der Datenbank leer ist.
 *
 * SOLANGE 0042 NICHT EINGESPIELT IST, scheitert das UPDATE an der fehlenden
 * Spalte — dafür der eigene Satz statt einer rohen Postgres-Meldung (Muster
 * `markFollowUpContacted`).
 */
export async function setConductedBy(
  entity: AssigneeEntity,
  entityId: string,
  userId: string | null,
): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (entity !== "setting_call" && entity !== "closing_call") return { error: "Unbekannte Termin-Art." };
  if (!(await belongsToWorkspace(entity, entityId))) return { error: "Keine Berechtigung." };

  const supabase = await createClient();
  if (userId && !(await isMember(supabase, access.workspace_id, userId))) {
    return { error: "Nutzer gehört nicht zu dieser Organisation." };
  }

  const table = entity === "setting_call" ? "setting_calls" : "closing_calls";
  const { error } = await supabase
    .from(table)
    .update({ conducted_by_user_id: userId })
    .eq("id", entityId)
    .eq("workspace_id", access.workspace_id);
  if (error) {
    if (/conducted_by_user_id/.test(error.message)) {
      return { error: "Das Feld „Durchgeführt von“ fehlt in der Datenbank — Migration 0042 ist noch nicht eingespielt." };
    }
    return { error: error.message };
  }

  revalidatePath(`/${entity === "setting_call" ? "setting" : "closing"}/${entityId}`, "page");
  revalidatePath("/termine", "page");
  // Zählt in der Analyse und im Team-Dashboard — beide zeigen sonst die alte
  // Verteilung.
  revalidatePath("/", "layout");
  return {};
}
