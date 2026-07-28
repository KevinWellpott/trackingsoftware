"use client";

import { Segmented } from "@/components/ui/Segmented";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

// Reiter der Listen-Uebersicht. Der Zustand liegt in der URL, damit „Aktiv"
// und „Archiviert" teilbar und ueber den Zurueck-Button erreichbar sind —
// gleiches Muster wie die Termine- und Analyse-Filter.

export type ListenTab = "aktiv" | "archiviert";

export function ListenTabs({ tab, counts }: { tab: ListenTab; counts: { aktiv: number; archiviert: number } }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  return (
    <Segmented<ListenTab>
      options={[
        { value: "aktiv", label: `Aktiv (${counts.aktiv})` },
        { value: "archiviert", label: `Archiviert (${counts.archiviert})` },
      ]}
      value={tab}
      size="md"
      ariaLabel="Listen-Reiter"
      onChange={(v) => {
        const next = new URLSearchParams(sp.toString());
        // "aktiv" ist der Default und bleibt aus der URL heraus.
        if (v === "aktiv") next.delete("tab");
        else next.set("tab", v);
        const qs = next.toString();
        startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
      }}
    />
  );
}
