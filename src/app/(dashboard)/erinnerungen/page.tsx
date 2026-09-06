import { getAccessContext } from "@/lib/access";
import { getDueReminderTouches, getReminderSettings } from "@/app/actions/reminders";
import { ErinnerungenBoard } from "@/components/erinnerungen/ErinnerungenBoard";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/PageHeader";

// "Meine Erinnerungen heute": stundengenaue Tagesansicht der Bestätigungs-
// Kaskade (Migration 0031) — bewusst eigenständig, kein Ausbau von
// /nachfassen (dort geht es um Tages-Wiedervorlagen, hier um konkrete
// Uhrzeiten vor einem Termin).

export default async function ErinnerungenPage() {
  const access = await getAccessContext();
  if (!access) return null;

  const canTeamView = access.role === "owner" && access.data_scope === "workspace";
  const [mine, team, settings] = await Promise.all([
    getDueReminderTouches(),
    canTeamView ? getDueReminderTouches({ teamView: true }) : Promise.resolve([]),
    getReminderSettings(),
  ]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <BackLink href="/" label="Dashboard" />

      <PageHeader
        eyebrow="Bestätigung"
        title="Meine Erinnerungen heute"
        meta="Fällige Bestätigungs-Touches vor Setting-, Closing- und Nachfass-Terminen — mit fertigem Text zum Kopieren, kein Auto-Versand."
      />

      <ErinnerungenBoard mine={mine} team={team} settings={settings} canTeamView={canTeamView} />
    </div>
  );
}
