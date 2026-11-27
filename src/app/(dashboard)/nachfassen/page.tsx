import { NachfassEingang } from "@/components/nachfassen/NachfassEingang";
import { BackLink } from "@/components/ui/BackLink";
import { InfoPopover } from "@/components/ui/InfoPopover";
import { PageHeader } from "@/components/ui/PageHeader";
import { ladeNachfassen } from "@/lib/nachfassenData";
import { parseFilter, parseReiter } from "@/lib/nachfassRegel";

// Der Nachfass-Eingang (docs/nachfassen-umbau/PLAN-nachfass-eingang.md): EIN
// Ort für alles, was heute einen Kontakt braucht. Route, Datei und
// `?from=nachfassen` behalten ihren Namen — Lesezeichen und der Rückweg der
// Detailseiten hängen daran.

export const dynamic = "force-dynamic";

export default async function NachfassenPage({
  searchParams,
}: {
  searchParams: Promise<{ reiter?: string; quelle?: string; wer?: string }>;
}) {
  const sp = await searchParams;
  const daten = await ladeNachfassen(sp.wer === "alle" ? "alle" : "mein");
  if (!daten) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <BackLink href="/" label="Dashboard" />
      <PageHeader
        eyebrow="Meine Arbeit"
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" }}>
            Nachfassen
            <InfoPopover label="Nachfassen: was hier steht" width={400}>
              Wen musst du heute kontaktieren? Termine ohne nächsten Schritt (kein Termin, nicht erschienen,
              erschienen ohne Ergebnis, Closing auf „Nachfassen“), Telefon-Rückrufe und Recycling-Leads, deren
              Wartezeit abgelaufen ist. Jeder Eintrag hat ein Datum für den nächsten Kontakt — ohne Datum ist er
              sofort fällig. Nach jedem Kontakt: Ergebnis eintragen, nächstes Datum wählen. Raus kommt ein
              Vorgang nur durch einen neuen Termin, als tot oder gesperrt — nie durch Zeit.
            </InfoPopover>
          </span>
        }
      />
      <NachfassEingang {...daten} reiter={parseReiter(sp.reiter)} filter={parseFilter(sp.quelle)} />
    </div>
  );
}
