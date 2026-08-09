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

async function canAccessEntity(entity: AssigneeEntity, entityId: string): Promise<boolean> {
  // RLS allein reicht nicht mehr: fuer einen Plattform-Admin ist jede Zeile
  // zugreifbar. Massgeblich ist die aktive Organisation.
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
  if (!(await canAccessEntity(entity, entityId))) return { error: "Keine Berechtigung." };

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

  revalidatePath(`/${entity === "setting_call" ? "setting" : "closing"}/${entityId}`, "page");
  revalidatePath("/termine", "page");
  // Die Zuweisung ist die Personenachse aller Auswertungen — Dashboards und
  // Nachfassen zeigen sonst weiter die alte Verteilung.
  revalidatePath("/", "layout");
  return {};
}
