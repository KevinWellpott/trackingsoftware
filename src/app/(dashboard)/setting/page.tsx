import { VorgangListe } from "@/components/vertrieb/VorgangListe";
import { InfoPopover } from "@/components/ui/InfoPopover";
import { PageHeader } from "@/components/ui/PageHeader";
import { TerminBuchenAktion } from "@/components/termine/TerminBuchenAktion";
import { getAccessContext } from "@/lib/access";
import { berlinDateISO } from "@/lib/apptTime";
import { ladeMitglieder, ladeSettings } from "@/lib/vorgaengeData";
import { parseSettingSegment } from "@/lib/vorgangSegmente";

// Alle Erstgespräche, nach Ergebnis geschnitten (Redesign Phase 4). Bis zum
// Redesign leitete diese Route auf /termine weiter; die Detailroute
// /setting/[callId] blieb dabei immer bestehen. Der Kalender beantwortet
// „wann“, diese Liste „wie steht es“ — beide lesen dieselben Zeilen
// (src/lib/vorgaengeData.ts) und dieselbe Ableitung (`buildEvents`).

export const dynamic = "force-dynamic";

export default async function SettingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const access = await getAccessContext();
  if (!access) return null;

  const [settings, members] = await Promise.all([ladeSettings(access), ladeMitglieder(access)]);
  const today = berlinDateISO(new Date().toISOString());

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <PageHeader
        eyebrow="Vertrieb"
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" }}>
            Setting
            <InfoPopover label="Setting: was hier steht" width={380}>
              Alle Erstgespräche, nach Ergebnis geschnitten. „Laufend“ heißt: Es steht ein Termin oder
              keiner, aber noch kein Ergebnis — nicht dasselbe wie der gespeicherte Status „offen“. Abgesagt ohne
              Aussicht und No-Show ohne Antwort stehen unter „Tot“, auch wenn kein Status das sagt. Wen du heute
              anfassen musst, steht unter „Heute“.
            </InfoPopover>
          </span>
        }
        meta="Erstgespräche · 30 min"
        actions={<TerminBuchenAktion />}
      />
      <VorgangListe
        kind="setting"
        settings={settings}
        closings={[]}
        members={members}
        today={today}
        scopeUserId={access.effective_user_id ?? access.user.id}
        canSeeAll={!access.effective_user_id && access.can_switch_view}
        segment={parseSettingSegment(sp.status)}
      />
    </div>
  );
}
