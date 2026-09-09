import { notFound } from "next/navigation";
import { getAccessContext } from "@/lib/access";
import { getLeadDossier } from "@/app/actions/leadDossier";
import { DOSSIER_ENTITY_LABELS, isDossierEntityKind } from "@/lib/leadDossier";
import { LeadDossierEmpty, LeadDossierPanel } from "@/components/lead/LeadDossierPanel";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/PageHeader";

// Das Lead-Dossier unter eigener Adresse: /lead/<art>/<id>.
//
// Die Art gehört in den Pfad, nicht in einen Query-Parameter: Dieselbe UUID
// kann es in `contacts` und in `setting_calls` geben, und ohne die Art wüsste
// die Seite nicht, welche Tabelle sie zuerst fragen soll — sie müsste raten
// oder alle vier durchprobieren.
//
// Die Route ist bewusst eigenständig und nicht nur ein Panel: Ein Dossier ist
// das, was man vor einem Anruf auf einen zweiten Bildschirm legt und in den
// Chat schickt. Die Panel-Fassung (LeadDossierSheet) rendert dieselbe
// Komponente über einem Board.

export const dynamic = "force-dynamic";

export default async function LeadDossierPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await params;
  if (!isDossierEntityKind(kind)) notFound();

  const access = await getAccessContext();
  if (!access) return null;

  const result = await getLeadDossier(kind, id);
  const dossier = result.dossier;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <BackLink href="/nachfassen" label="Nachfassen" />

      <PageHeader
        eyebrow="Lead-Dossier"
        title={dossier?.name ?? "Lead-Dossier"}
        meta={
          dossier
            ? `Alles zu diesem Lead an einer Stelle — für das Gespräch, nicht für die Statistik. ` +
              `Einstieg über den ${DOSSIER_ENTITY_LABELS[kind]}.`
            : `Einstieg über den ${DOSSIER_ENTITY_LABELS[kind]}.`
        }
      />

      {dossier ? (
        <LeadDossierPanel dossier={dossier} />
      ) : (
        <LeadDossierEmpty available={result.available} error={result.error} />
      )}
    </div>
  );
}
