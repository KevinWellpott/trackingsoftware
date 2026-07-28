"use client";

import { deleteListView } from "@/app/actions/listViews";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ViewEditorModal, type ViewOption } from "@/components/listen/ViewEditorModal";
import type { ViewFilters } from "@/lib/listViews";
import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

// Bearbeiten und Loeschen einer Ansicht — Kopfzeile von /ansicht/[viewId].
//
// Loeschen entfernt nur den Knoten (und per Cascade seinen Teilbaum). Kontakte
// und Listen bleiben unberuehrt: eine Ansicht besitzt nichts, sie filtert nur.

export function ViewActions({
  viewId,
  name,
  parentId = null,
  filters = null,
  lists = [],
  parents = [],
}: {
  viewId: string;
  name: string;
  parentId?: string | null;
  filters?: ViewFilters | null;
  lists?: { id: string; name: string }[];
  parents?: ViewOption[];
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function remove() {
    const ok = await confirm({
      title: "Ansicht löschen?",
      message: `„${name}" wird entfernt — samt aller Unterordner. Kontakte und Listen bleiben unverändert.`,
      confirmLabel: "Löschen",
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteListView(viewId);
      if (res.error) return;
      router.push("/listen");
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" className="btn-secondary" onClick={() => setEditing(true)} disabled={isPending}>
        <Pencil size={14} /> Bearbeiten
      </button>
      <button type="button" className="btn-ghost" onClick={remove} disabled={isPending} title="Ansicht löschen">
        <Trash2 size={14} />
      </button>

      {editing && (
        <ViewEditorModal
          open
          onClose={() => setEditing(false)}
          lists={lists}
          parents={parents}
          initial={{ id: viewId, name, parentId, filters }}
        />
      )}
      {dialog}
    </>
  );
}
