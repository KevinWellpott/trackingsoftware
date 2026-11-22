import { Badge } from "@/components/ui/Badge";
import { RATEN_ZUSTAND_LABELS, ZUSTAND_TONE, datumDe, type VerteilteRate } from "@/lib/umsatz";

/** Zustand einer Rate, immer mit Text: Tage, gebrochene Vereinbarung, Zusage. */
export function RatenMarken({ rate, zusage }: { rate: VerteilteRate; zusage: { auf: string; gebrochen: boolean } | null }) {
  return (
    <span className="ks-marken">
      <Badge tone={ZUSTAND_TONE[rate.zustand]}>
        {rate.zustand === "ueberfaellig"
          ? `${rate.tage} ${rate.tage === 1 ? "Tag" : "Tage"} überfällig`
          : RATEN_ZUSTAND_LABELS[rate.zustand]}
      </Badge>
      {rate.vereinbarungGebrochen && <Badge tone="warning">Vereinbarung gebrochen</Badge>}
      {zusage && (
        <Badge tone={zusage.gebrochen ? "warning" : "info"}>
          {zusage.gebrochen ? `Zusage gebrochen (${datumDe(zusage.auf)})` : `zugesagt ${datumDe(zusage.auf)}`}
        </Badge>
      )}
    </span>
  );
}
