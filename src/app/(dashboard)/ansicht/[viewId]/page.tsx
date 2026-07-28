import { listViewRows } from "@/app/actions/listViews";
import { ListBoardV2 } from "@/components/ListBoardV2";
import { ViewActions } from "@/components/listen/ViewActions";
import { EmptyState, PageHeader } from "@/components/ui/PageHeader";
import { getAccessContext, ownScopeFilter } from "@/lib/access";
import { localDateISO } from "@/lib/dates";
import {
  viewFilterOps,
  buildViewTree,
  descendantIds,
  describeFilters,
  hasAnyFilter,
  parseViewFilters,
  type ViewNode,
} from "@/lib/listViews";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { LIST_CONTACT_COLUMNS, type ListContact } from "@/lib/types";
import { FolderOpen } from "lucide-react";
import { notFound } from "next/navigation";
import Link from "next/link";

// Smart View: eine gespeicherte Filter-Abfrage ueber ALLE Listen im Scope.
//
// Ein Knoten ohne Filter ist ein reiner Ordner — der zeigt hier seine
// Unterordner statt einer Kontaktliste.
//
// Die Kontakte kommen aus mehreren Listen, deshalb bekommt ListBoardV2
// `listId={null}`: es gaebe kein eindeutiges Ziel fuer neue Kontakte. Alles
// andere (Bearbeiten, Termin, Blockieren, Loeschen) laeuft ueber die
// list_id des jeweiligen Kontakts und funktioniert unveraendert.

export const dynamic = "force-dynamic";

export default async function AnsichtPage({ params }: { params: Promise<{ viewId: string }> }) {
  const { viewId } = await params;

  const access = await getAccessContext();
  if (!access) notFound();

  const rows = await listViewRows();
  const row = rows.find((r) => r.id === viewId);
  if (!row) notFound();
  const view = { id: row.id, name: row.name, filters: parseViewFilters(row.filters) };

  // Waehlbare Elternknoten: alles ausser dem Knoten selbst und seinen
  // Nachfahren — sonst haengte man den Teilbaum unter sich selbst.
  const forbidden = descendantIds(rows, viewId);
  forbidden.add(viewId);
  const parents = flattenForSelect(buildViewTree(rows)).filter((p) => !forbidden.has(p.id));

  const supabase = await createClient();
  const today = localDateISO();

  // Sichtbare Listen bilden die Obergrenze der Ansicht. Auch wenn in den
  // Filtern eine fremde Liste stuende, kaeme sie hier nicht durch.
  let listsQuery = supabase
    .from("lists")
    .select("id, name")
    .eq("workspace_id", access.workspace_id)
    .is("archived_at", null);
  const scope = ownScopeFilter(access);
  if (scope) listsQuery = listsQuery.or(scope);
  const { data: listRows } = await listsQuery;
  const allowedLists = (listRows ?? []).map((l) => ({ id: l.id as string, name: l.name as string }));
  const allowedListIds = allowedLists.map((l) => l.id);

  // Ordner (kein Filter) → Unterordner zeigen statt Kontakte laden.
  if (!hasAnyFilter(view.filters)) {
    const children = rows
      .filter((r) => r.parent_id === viewId)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "de"));

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
        <PageHeader
          eyebrow="Ordner"
          title={view.name}
          meta={`${children.length} ${children.length === 1 ? "Eintrag" : "Einträge"}`}
          actions={
            <ViewActions
              viewId={viewId}
              name={view.name}
              parentId={row.parent_id}
              filters={view.filters}
              lists={allowedLists}
              parents={parents}
            />
          }
        />
        {children.length === 0 ? (
          <EmptyState
            icon={<FolderOpen size={28} style={{ color: "var(--text-disabled)" }} />}
            message="Dieser Ordner ist leer. Lege in der Seitenleiste eine Ansicht darin an."
          />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "var(--sp-6)" }}>
            {children.map((c) => (
              <Link key={c.id} href={`/ansicht/${c.id}`} style={{ textDecoration: "none" }} className="organic-list-card-link">
                <div className="card organic-list-card" style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
                  <FolderOpen size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                  <span style={{ fontSize: "var(--fs-base)", fontWeight: 500, color: "var(--text-primary)" }}>{c.name}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  const ops = viewFilterOps(view.filters, allowedListIds, today);

  const contacts = allowedListIds.length
    ? ((await fetchAllRows<unknown>((from, to) => {
        let q = supabase.from("contacts").select(LIST_CONTACT_COLUMNS);
        for (const op of ops) {
          if (op.op === "in") q = q.in(op.column, op.values);
          else if (op.op === "eq") q = q.eq(op.column, op.value);
          else if (op.op === "isNull") q = q.is(op.column, null);
          else if (op.op === "notNull") q = q.not(op.column, "is", null);
          else if (op.op === "notIsTrue") q = q.not(op.column, "is", true);
          else if (op.op === "gte") q = q.gte(op.column, op.value);
          else if (op.op === "lte") q = q.lte(op.column, op.value);
          else q = q.or(op.expr);
        }
        return q
          .order("pitched_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to);
      })) as unknown as ListContact[])
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <PageHeader
        eyebrow="Ansicht"
        title={view.name}
        meta={`${contacts.length.toLocaleString("de-DE")} Kontakte · ${describeFilters(view.filters, allowedListIds.length)}`}
        actions={
          <ViewActions
            viewId={viewId}
            name={view.name}
            parentId={row.parent_id}
            filters={view.filters}
            lists={allowedLists}
            parents={parents}
          />
        }
      />
      <ListBoardV2 listId={null} contacts={contacts} />
    </div>
  );
}

/** Baum → flache Liste mit Tiefe, damit das Dropdown die Hierarchie zeigt. */
function flattenForSelect(nodes: ViewNode[], depth = 0): { id: string; name: string; depth: number }[] {
  return nodes.flatMap((n) => [{ id: n.id, name: n.name, depth }, ...flattenForSelect(n.children, depth + 1)]);
}
