"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Segmented } from "@/components/ui/Segmented";

// Server-getriebener Zeitraum-Umschalter fürs persönliche Dashboard:
// schreibt ?period=… in die URL, die Page rechnet serverseitig neu.

export type DashboardPeriod = "w" | "m" | "j";

const OPTIONS = [
  { value: "w", label: "Woche" },
  { value: "m", label: "Monat" },
  { value: "j", label: "Jahr" },
] as const;

export function PeriodSwitcher({ value }: { value: DashboardPeriod }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  return (
    <div style={{ opacity: isPending ? 0.6 : 1, transition: "opacity var(--transition-fast)" }}>
      <Segmented<DashboardPeriod>
        options={OPTIONS}
        value={value}
        ariaLabel="Zeitraum"
        onChange={(v) => {
          startTransition(() => {
            router.replace(`${pathname}?period=${v}`, { scroll: false });
          });
        }}
      />
    </div>
  );
}
