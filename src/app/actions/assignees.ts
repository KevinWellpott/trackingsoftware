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
 * Zugriff pruefen UND den Ersteller mitlesen.
 *
 * RLS allein reicht nicht: fuer einen Plattform-Admin ist jede Zeile
 * zugreifbar. Massgeblich ist die aktive Organisation.
 *
 * `created_by_user_id` kommt mit, weil die Zuweisung „Niemand" die Erinnerungen
 * genau dorthin ziehen muss — das ist der Wert, den `personOf()` danach
 * liefert. Ein zweiter Roundtrip dafuer waere dieselbe Zeile ein zweites Mal.
 */
async function loadEntity(
  entity: AssigneeEntity,
  entityId: string,
): Promise<{ created_by_user_id: string | null } | null> {
  const access = await getAccessContext();
  if (!access) return null;
  const supabase = await createClient();
  const table = entity === "setting_call" ? "setting_calls" : "closing_calls";
  const { data } = await supabase
    .from(table)
    .select("id, created_by_user_id")
    .eq("id", entityId)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();
  return (data as { created_by_user_id: string | null } | null) ?? null;
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
  const row = await loadEntity(entity, entityId);
  if (!row) return { error: "Keine Berechtigung." };

  const supabase = await createClient();

  // Der DB-Guard aus Migration 0028 §11 greift bewusst nur beim Org-Umzug.
  // Ohne diese Pruefung koennte hier eine Zuweisung ueber die Org-Grenze
  // entstehen — die Zeile waere danach fuer niemanden mehr auffindbar.
  if (userId) {
    const { data: member } = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", access.workspace_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!member) return { error: "Nutzer gehört nicht zu dieser Organisation." };
  }

  const table = entity === "setting_call" ? "setting_calls" : "closing_calls";
  const { error } = await supabase
    .from(table)
    .update({ assigned_user_id: userId })
    .eq("id", entityId)
    .eq("workspace_id", access.workspace_id);
  if (error) return { error: error.message };

  // Offene Erinnerungen ziehen mit. Ihr `assigned_user_id` ist ein Snapshot,
  // damit eine spaetere Umverteilung die Historie nicht umschreibt — genau
  // deshalb bleiben ERLEDIGTE und entwertete Touches unangetastet. Fuer noch
  // offene, zukuenftige Touches waere derselbe Snapshot aber ein Fehler: der
  // Termin gehoerte Person B, die Erinnerungen haengen weiter bei A, und bei
  // `data_scope='own'` bekommt B sie nie zu sehen.
  //
  // Fail-soft wie alle Kaskaden-Pfade: eine misslungene Nachfuehrung darf die
  // Zuweisung selbst nicht zurueckdrehen.
  //
  // „Niemand" (userId = null) ist dabei KEIN Sonderfall, sondern der wichtigste:
  // Der Termin faellt danach ueber `personOf()` auf seinen Ersteller zurueck —
  // genau dorthin muessen die Erinnerungen mit. Standen sie weiter beim
  // bisherigen Zustaendigen, sah dieser bei `data_scope='own'` eine Karte ohne
  // Lead-Namen (der Termin selbst ist ihm durch die RLS entzogen), waehrend der
  // Ersteller sie nie zu Gesicht bekaeme. Die Spalte bleibt dabei belegt: der
  // Trigger `reminder_touches_require_assignee` greift nur beim INSERT, aber
  // eine Erinnerung ohne Zustaendige ist eine, die niemand sieht.
  const touchAssignee = userId ?? row.created_by_user_id;
  if (touchAssignee) {
    const entityType = entity === "setting_call" ? "setting" : "closing";
    const types = entityType === "setting" ? ["setting"] : ["closing", "closing_followup"];
    const { error: touchError } = await supabase
      .from("reminder_touches")
      .update({ assigned_user_id: touchAssignee })
      .eq("workspace_id", access.workspace_id)
      .eq("entity_id", entityId)
      .in("entity_type", types)
      .is("superseded_at", null)
      .is("done_at", null);
    if (touchError) console.error("setAssignee: Erinnerungen nicht nachgefuehrt", touchError);
    revalidatePath("/erinnerungen", "page");
  }

  revalidatePath(`/${entity === "setting_call" ? "setting" : "closing"}/${entityId}`, "page");
  revalidatePath("/termine", "page");
  // Die Zuweisung ist die Personenachse aller Auswertungen — Dashboards und
  // Nachfassen zeigen sonst weiter die alte Verteilung.
  revalidatePath("/", "layout");
  return {};
}
