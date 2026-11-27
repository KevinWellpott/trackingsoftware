import { NoShowsBoard } from "@/components/vertrieb/NoShowsBoard";
import { InfoPopover } from "@/components/ui/InfoPopover";
import { PageHeader } from "@/components/ui/PageHeader";
import { getAccessContext } from "@/lib/access";
import { berlinDateISO } from "@/lib/apptTime";
import { ladeSettingNoShows } from "@/lib/noShowsData";
import { ladeClosings, ladeMitglieder } from "@/lib/vorgaengeData";

// Wer ist nicht erschienen? (Redesign Phase 4, Gruppe „Vertrieb“.) Die
// Regeln stehen in src/lib/noShowsData.ts; die Seite zählt nichts selbst und
// trägt deshalb auch kein Navigations-Abzeichen (docs §5.4: ein Zähler muss
// exakt die Menge der Seite zählen).

export const dynamic = "force-dynamic";

export default async function NoShowsPage() {
  const access = await getAccessContext();
  if (!access) return null;

  const [settingNoShows, closings, members] = await Promise.all([
    ladeSettingNoShows(access),
    ladeClosings(access),
    ladeMitglieder(access),
  ]);
  const today = berlinDateISO(new Date().toISOString());

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <PageHeader
        eyebrow="Vertrieb"
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" }}>
            No-Shows
            <InfoPopover label="No-Shows: was hier steht" width={400}>
              Erstgespräche und Closings, bei denen der Lead nicht erschienen ist und noch kein neuer Termin steht.
              Beim Erstgespräch siehst du nur, was du selbst gelegt hast und was in deiner Liste steht — je Lead das
              jüngste Erstgespräch. Direkt gebuchte Termine (Ads, Social Media) ohne Liste stehen hier, wenn du sie
              gelegt hast. Ein neuer Termin oder „Tot“ nimmt die Zeile heraus; tägliches Nachfassen läuft über
              „Heute“.
            </InfoPopover>
          </span>
        }
        meta="Erstgespräch · Closing"
      />
      <NoShowsBoard
        settings={settingNoShows.settings}
        herkunft={settingNoShows.herkunft}
        closings={closings}
        members={members}
        today={today}
        scopeUserId={access.effective_user_id ?? access.user.id}
        canSeeAll={!access.effective_user_id && access.can_switch_view}
      />
    </div>
  );
}
