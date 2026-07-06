"use client";

import { updateList } from "@/app/actions/lists";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function ArchiveListButton ({ listId }: { listId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { confirm, dialog } = useConfirm();

  async function archive () {
    const ok = await confirm({
      title: "Liste archivieren?",
      message:
        "Die Liste verschwindet aus der Navigation, Daten bleiben in der DB (kann später per SQL wiederhergestellt werden).",
      confirmLabel: "Archivieren",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      await updateList(listId, { archived_at: new Date().toISOString() });
      router.push("/");
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={archive}
        disabled={pending}
        className="btn-secondary"
        style={{ opacity: pending ? 0.5 : 1, fontSize: "0.875rem" }}
      >
        {pending ? "Archivieren…" : "Liste archivieren"}
      </button>
      {dialog}
    </>
  );
}
