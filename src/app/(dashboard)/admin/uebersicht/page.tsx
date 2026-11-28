import { redirect } from "next/navigation";
import { OrgUebersicht } from "@/components/admin/OrgUebersicht";
import { InfoPopover } from "@/components/ui/InfoPopover";
import { PageHeader } from "@/components/ui/PageHeader";
import { ladeOrgUebersicht } from "@/lib/orgUebersichtData";

// Plattform-Ebene: was jede Organisation heute, diese Woche und diesen Monat
// getan hat — gegen Titans Richtwerte. Nur Plattform-Admins; geprüft im
// Server Component wie /admin, kein Verlass auf versteckte Navigation.

export const dynamic = "force-dynamic";

export default async function OrgUebersichtPage() {
  const daten = await ladeOrgUebersicht();
  if (!daten) redirect("/");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <PageHeader
        eyebrow="Plattform"
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" }}>
            Organisationen im Blick
            <InfoPopover label="Was hier zählt" width={420}>
              Heute · Woche ab Montag · Monat ab dem 1., jeweils bis jetzt. Anwahlen = jeder Wählversuch aus dem
              Anruf-Log. LinkedIn-Pitches nach Pitch-Datum. Termine gelegt = neu gebuchte Erstgespräche nach dem
              Tag der Buchung. Settings und Closings = Termine im Zeitraum, die schon begonnen haben, ohne Absagen.
              Das Soll ist der Richtwert pro Arbeitstag mal die Arbeitstage (Mo–Fr) bis heute; Feiertage zählen mit.
            </InfoPopover>
          </span>
        }
        meta={`Stand ${daten.stand} Uhr · Soll = Richtwert × Arbeitstage bis heute`}
      />
      <OrgUebersicht {...daten} />
    </div>
  );
}
