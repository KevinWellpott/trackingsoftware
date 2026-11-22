import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getAccessContext } from "@/lib/access";
import { berlinDateISO } from "@/lib/apptTime";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import {
  getInternRechte,
  loadErinnerungen,
  loadGeld,
  loadInternTeam,
  loadKosten,
  loadKundenKurz,
  loadRuecklageProzent,
} from "@/lib/internData";
import { istMonat, monatLabel, monatPlus } from "@/lib/finanzen";
import { mitGueltigerPerson, passtZuWer, werAusUrl, werEintraege } from "@/lib/kundenFilter";
import { PageHeader } from "@/components/ui/PageHeader";
import { Chips, Reiter } from "@/components/kunden/Nav";
import { GesamtAnsicht } from "@/components/umsatz/GesamtAnsicht";
import { MonatAnsicht } from "@/components/umsatz/MonatAnsicht";
import { UeberfaelligAnsicht } from "@/components/umsatz/UeberfaelligAnsicht";
import { VertraegeAnsicht } from "@/components/umsatz/VertraegeAnsicht";
import { KostenPanel } from "@/components/umsatz/KostenPanel";

// /umsatz: der eigene Geld-Tab des Kundenspace, nur für Admins.
//
// Vorgabe der Personenachse ist hier „Alle": „Wer ist überfällig?" ist eine
// Frage an die Firma. „Meine" ist einen Klick entfernt.

export const dynamic = "force-dynamic";

const ANSICHTEN = [
  { key: "gesamt", label: "Gesamt", monat: true, wer: false },
  { key: "monat", label: "Monat", monat: true, wer: true },
  { key: "ueberfaellig", label: "Überfällig", monat: false, wer: true },
  { key: "vertraege", label: "Verträge", monat: false, wer: true },
  { key: "kosten", label: "Kosten", monat: true, wer: false },
] as const;

export default async function UmsatzPage({
  searchParams,
}: {
  searchParams: Promise<{ ansicht?: string; monat?: string; wer?: string }>;
}) {
  const rechte = await getInternRechte();
  if (rechte.fehler) throw new Error("Rechte nicht prüfbar.");
  if (!rechte.umsatz) notFound();
  const [sp, access] = await Promise.all([searchParams, getAccessContext()]);
  if (!access) notFound();

  const ansicht = ANSICHTEN.find((a) => a.key === sp.ansicht) ?? ANSICHTEN[0];
  const heute = berlinDateISO(new Date().toISOString());
  const heuteMonat = heute.slice(0, 7);
  const monat = istMonat(sp.monat) ? sp.monat! : heuteMonat;
  const brauchtKosten = ansicht.key === "gesamt" || ansicht.key === "kosten";

  const [rohKunden, team, kosten, prozent] = await Promise.all([
    loadKundenKurz(),
    loadInternTeam(),
    brauchtKosten ? loadKosten() : Promise.resolve(null),
    ansicht.key === "gesamt" ? loadRuecklageProzent() : Promise.resolve(0),
  ]);
  const kunden = mitGueltigerPerson(rohKunden, team);
  const [geld, erinnerungen] = await Promise.all([
    loadGeld(kunden, heute),
    ansicht.key === "ueberfaellig" ? loadErinnerungen() : Promise.resolve(null),
  ]);

  const userId = access.user.id;
  const wer = ansicht.wer ? werAusUrl(sp.wer, kunden, team, userId, "alle") : "alle";
  const alle = [...geld.values()];
  const erlaubt = new Set(kunden.filter((k) => passtZuWer(k, wer, userId)).map((k) => k.id));
  const sichtbar = alle.filter((g) => erlaubt.has(g.id));

  const person = new Map(team.map((t) => [t.user_id, t.username]));
  const namen = new Map<string, string>();
  for (const k of kunden) {
    const n = k.betreuer_user_id ? person.get(k.betreuer_user_id) : undefined;
    if (n) namen.set(k.id, n);
  }

  // B16: Ein Closing, das nicht mehr gewonnen ist, lässt den Kunden stehen. Das soll auffallen.
  const nichtMehrGewonnen = new Set<string>();
  if (ansicht.key === "vertraege") {
    const mitClosing = kunden.filter((k) => k.closing_call_id);
    if (mitClosing.length) {
      const supabase = await createClient();
      const gewonnen = await fetchAllRows<{ id: string }>(
        (from, to) =>
          supabase
            .from("closing_calls")
            .select("id")
            .eq("workspace_id", access.workspace_id)
            .eq("status", "gewonnen")
            .order("id")
            .range(from, to) as never,
      );
      const ids = new Set(gewonnen.map((c) => c.id));
      for (const k of mitClosing) if (!ids.has(k.closing_call_id!)) nichtMehrGewonnen.add(k.id);
    }
  }

  const href = (p: { ansicht?: string; monat?: string; wer?: string }) =>
    `/umsatz?${new URLSearchParams({ ansicht: ansicht.key, monat, wer, ...p }).toString()}`;
  const anzahlSpaet = alle.filter((g) => g.k.ueberfaellig > 0).length;

  return (
    <div className="ks-seite">
      <PageHeader
        eyebrow="Kundenspace"
        title="Umsatz"
        meta="Netto. Nur für Admins sichtbar."
        actions={
          ansicht.monat ? (
            <nav className="ks-monatswahl" aria-label="Monat wählen">
              <Link href={href({ monat: monatPlus(monat, -1) })} scroll={false} aria-label="Monat zurück" className="ks-chip">
                <ChevronLeft size={15} aria-hidden />
              </Link>
              <span aria-live="polite">{monatLabel(monat)}</span>
              <Link href={href({ monat: monatPlus(monat, 1) })} scroll={false} aria-label="Monat vor" className="ks-chip">
                <ChevronRight size={15} aria-hidden />
              </Link>
              {monat !== heuteMonat && (
                <Link href={href({ monat: heuteMonat })} scroll={false} className="ks-chip">
                  Heute
                </Link>
              )}
            </nav>
          ) : undefined
        }
      >
        <Reiter
          label="Ansichten"
          aktiv={ansicht.key}
          eintraege={ANSICHTEN.map((a) => ({
            key: a.key,
            label: a.label,
            href: href({ ansicht: a.key }),
            zahl: a.key === "ueberfaellig" ? anzahlSpaet : null,
          }))}
        />
        {ansicht.wer && (
          <Chips label="Wessen Kunden" aktiv={wer} eintraege={werEintraege(kunden, team, userId, (w) => href({ wer: w }))} />
        )}
      </PageHeader>

      {ansicht.key === "gesamt" && kosten && (
        <GesamtAnsicht geld={alle} kosten={kosten} prozent={prozent} monat={monat} heute={heute} namen={namen} />
      )}
      {ansicht.key === "monat" && <MonatAnsicht geld={sichtbar} monat={monat} heute={heute} />}
      {ansicht.key === "ueberfaellig" && erinnerungen && (
        <UeberfaelligAnsicht
          geld={sichtbar}
          heute={heute}
          namen={namen}
          kontakte={new Map(kunden.map((k) => [k.id, { telefon: k.telefon, email: k.email }]))}
          erinnerungen={erinnerungen}
          personen={person}
        />
      )}
      {ansicht.key === "vertraege" && (
        <VertraegeAnsicht geld={sichtbar} heute={heute} namen={namen} nichtMehrGewonnen={nichtMehrGewonnen} />
      )}
      {ansicht.key === "kosten" && kosten && <KostenPanel kosten={kosten} monat={monat} />}
    </div>
  );
}
