import { VorgangListe } from "@/components/vertrieb/VorgangListe";
import { InfoPopover } from "@/components/ui/InfoPopover";
import { PageHeader } from "@/components/ui/PageHeader";
import { getAccessContext } from "@/lib/access";
import { berlinDateISO } from "@/lib/apptTime";
import { ladeClosings, ladeMitglieder } from "@/lib/vorgaengeData";
import { parseClosingSegment } from "@/lib/vorgangSegmente";

// Alle Abschlussgespräche, nach Ergebnis geschnitten (Redesign Phase 4). Siehe
// /setting — dieselbe Liste für die andere Termin-Tabelle. Die Detailroute
// /closing/[callId] bleibt unverändert.

export const dynamic = "force-dynamic";

export default async function ClosingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const access = await getAccessContext();
  if (!access) return null;

  const [closings, members] = await Promise.all([ladeClosings(access), ladeMitglieder(access)]);
  const today = berlinDateISO(new Date().toISOString());

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <PageHeader
        eyebrow="Vertrieb"
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" }}>
            Closing
            <InfoPopover label="Closing: was hier steht" width={380}>
              Alle Abschlussgespräche, nach Ergebnis geschnitten. „Verloren“ umfasst auch abgesagte Closings ohne
              Aussicht und No-Shows ohne Antwort — beide sind aus dem Funnel gefallen, ohne dass ein Status es
              sagt. „Nachfassen“ sind Closings, bei denen ein weiterer Kontakt vereinbart ist.
            </InfoPopover>
          </span>
        }
        meta="Abschlussgespräche · 60 min"
      />
      <VorgangListe
        kind="closing"
        settings={[]}
        closings={closings}
        members={members}
        today={today}
        scopeUserId={access.effective_user_id ?? access.user.id}
        canSeeAll={!access.effective_user_id && access.can_switch_view}
        segment={parseClosingSegment(sp.status)}
      />
    </div>
  );
}
