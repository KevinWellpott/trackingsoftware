"use server";

import { getAccessContext, ownScopeFilter } from "@/lib/access";
import { descendantIds, parseViewFilters, type ViewFilters, type ViewRow } from "@/lib/listViews";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// CRUD fuer Smart Views. Rein additiv — es wird keine bestehende Tabelle
// angefasst; eine Ansicht ist eine zusaetzliche Sicht auf `contacts`.

export type ViewInput = {
  name: string;
  parentId?: string | null;
  /** null = reiner Ordner. */
  filters?: ViewFilters | null;
};

/** Alle Ansichten im Scope — Grundlage fuer Baum, Editor und Zyklusschutz. */
export async function listViewRows(): Promise<ViewRow[]> {
  const access = await getAccessContext();
  if (!access) return [];
  const supabase = await createClient();

  let q = supabase
    .from("list_views")
    .select("id, name, parent_id, sort_order, filters")
    .eq("workspace_id", access.workspace_id)
    .order("sort_order", { ascending: true });
  const scope = ownScopeFilter(access);
  if (scope) q = q.or(scope);

  const { data } = await q;
  return (data ?? []) as ViewRow[];
}

function revalidateViews(viewId?: string) {
  // Der Baum haengt im Dashboard-Layout (Sidebar).
  revalidatePath("/", "layout");
  revalidatePath("/listen", "page");
  if (viewId) revalidatePath(`/ansicht/${viewId}`, "page");
}

export async function createListView(
  input: ViewInput,
): Promise<{ error?: string; viewId?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  const name = input.name.trim();
  if (!name) return { error: "Bitte einen Namen angeben." };

  const supabase = await createClient();

  // Elternteil muss im eigenen Scope liegen — sonst haengte man einen Knoten
  // unter etwas, das man gar nicht sehen darf.
  if (input.parentId) {
    const rows = await listViewRows();
    if (!rows.some((r) => r.id === input.parentId)) return { error: "Übergeordneter Ordner nicht gefunden." };
  }

  // Ans Ende der Geschwister sortieren.
  const siblings = (await listViewRows()).filter((r) => (r.parent_id ?? null) === (input.parentId ?? null));
  const sortOrder = siblings.reduce((max, r) => Math.max(max, r.sort_order), -1) + 1;

  const { data, error } = await supabase
    .from("list_views")
    .insert({
      workspace_id: access.workspace_id,
      parent_id: input.parentId ?? null,
      name,
      sort_order: sortOrder,
      filters: input.filters ?? null,
      created_by_user_id: access.user.id,
      // Wie bei Listen: bei eingeschraenkter Datensicht immer die eigene Person.
      owner_name: access.data_scope === "own" ? access.username : (access.effective_username ?? access.username),
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Ansicht konnte nicht angelegt werden." };
  revalidateViews();
  return { viewId: data.id };
}

export async function updateListView(
  viewId: string,
  patch: { name?: string; parentId?: string | null; filters?: ViewFilters | null },
): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };

  const rows = await listViewRows();
  if (!rows.some((r) => r.id === viewId)) return { error: "Ansicht nicht gefunden." };

  if (patch.parentId !== undefined && patch.parentId !== null) {
    if (patch.parentId === viewId) return { error: "Ein Ordner kann nicht in sich selbst liegen." };
    if (!rows.some((r) => r.id === patch.parentId)) return { error: "Übergeordneter Ordner nicht gefunden." };
    // Zyklusschutz: das Ziel darf kein Nachfahre sein, sonst haengt sich der
    // Teilbaum von der Wurzel ab und kreist in sich selbst.
    if (descendantIds(rows, viewId).has(patch.parentId)) {
      return { error: "Ein Ordner kann nicht in einen seiner eigenen Unterordner verschoben werden." };
    }
  }

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return { error: "Bitte einen Namen angeben." };
    update.name = name;
  }
  if (patch.parentId !== undefined) update.parent_id = patch.parentId;
  if (patch.filters !== undefined) update.filters = patch.filters;
  if (Object.keys(update).length === 0) return {};

  const supabase = await createClient();
  const { error } = await supabase.from("list_views").update(update).eq("id", viewId);
  if (error) return { error: error.message };

  revalidateViews(viewId);
  return {};
}

export async function deleteListView(viewId: string): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };

  const rows = await listViewRows();
  if (!rows.some((r) => r.id === viewId)) return { error: "Ansicht nicht gefunden." };

  const supabase = await createClient();
  // Der Fremdschluessel steht auf `on delete cascade` — der Teilbaum geht mit.
  // Kontakte und Listen bleiben unberuehrt: eine Ansicht besitzt nichts.
  const { error } = await supabase.from("list_views").delete().eq("id", viewId);
  if (error) return { error: error.message };

  revalidateViews();
  return {};
}

/** Filter einer Ansicht laden (geprueft). */
export async function getListView(
  viewId: string,
): Promise<{ id: string; name: string; filters: ViewFilters | null } | null> {
  const rows = await listViewRows();
  const row = rows.find((r) => r.id === viewId);
  if (!row) return null;
  return { id: row.id, name: row.name, filters: parseViewFilters(row.filters) };
}
