import { notFound } from "next/navigation";
import { getInternRechte, loadVorlageDateien, loadVorlagen } from "@/lib/internData";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { BackLink } from "@/components/ui/BackLink";
import { Chips } from "@/components/kunden/Nav";
import { VorlageAnlegenButton, VorlagenEditor } from "@/components/kunden/VorlagenEditor";
import { VorlagenDateien } from "@/components/kunden/VorlagenDateien";

// Fulfillment-Vorlagen. Beliebig viele, ein Kunde kann mehrere bekommen (F1).

export const dynamic = "force-dynamic";

export default async function VorlagenPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const rechte = await getInternRechte();
  if (rechte.fehler) throw new Error("Rechte nicht prüfbar.");
  if (!rechte.kunden) notFound();
  const [sp, vorlagen] = await Promise.all([searchParams, loadVorlagen()]);

  const sortiert = [...vorlagen].sort((a, b) => Number(!!a.archiviert_at) - Number(!!b.archiviert_at));
  const aktiv = sortiert.find((v) => v.id === sp.id) ?? sortiert[0] ?? null;
  const dateien = aktiv ? await loadVorlageDateien(aktiv.id) : null;

  return (
    <div className="ks-seite" data-schmal="true">
      <BackLink href="/kunden" label="Kunden" />
      <PageHeader
        eyebrow="Kundenspace"
        title="Vorlagen"
        meta="Beim Zuweisen bekommt der Kunde eine eigene Kopie."
        actions={<VorlageAnlegenButton />}
      >
        {sortiert.length > 0 && (
          <Chips
            label="Vorlage wählen"
            aktiv={aktiv?.id ?? ""}
            eintraege={sortiert.map((v) => ({
              key: v.id,
              label: v.archiviert_at ? `${v.name} (archiviert)` : v.name,
              href: `/kunden/vorlagen?id=${v.id}`,
              zahl: v.punkte.length,
            }))}
          />
        )}
      </PageHeader>

      {aktiv ? (
        <>
          <VorlagenEditor key={`${aktiv.id}:${aktiv.name}`} vorlage={aktiv} />
          {/* Dateien an der Vorlage (Migration 0052, 28.11.) */}
          <VorlagenDateien vorlageId={aktiv.id} dateien={dateien?.dateien ?? []} verfuegbar={dateien?.verfuegbar ?? false} />
        </>
      ) : (
        <Card>
          <p className="ks-leise">Noch keine Vorlage. Leg eine an und füg euren Ablauf als Liste ein, eine Zeile je Checkbox.</p>
        </Card>
      )}
    </div>
  );
}
