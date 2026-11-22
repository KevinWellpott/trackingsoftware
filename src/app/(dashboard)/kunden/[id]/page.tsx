import Link from "next/link";
import { notFound } from "next/navigation";
import { getAccessContext } from "@/lib/access";
import { berlinDateISO, formatTermin } from "@/lib/apptTime";
import { getInternRechte, loadGeld, loadInternTeam, loadKundenAkte, loadVorlagen } from "@/lib/internData";
import { KUNDEN_STATUS_LABELS, KUNDEN_STATUS_TONE, aufmerksamkeit } from "@/lib/kunden";
import { datumDe, formatEur } from "@/lib/umsatz";
import { geldSicht } from "@/lib/geldSicht";
import { PageHeader } from "@/components/ui/PageHeader";
import { BackLink } from "@/components/ui/BackLink";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { Reiter } from "@/components/kunden/Nav";
import { KontaktLinks } from "@/components/kunden/Kontakt";
import { KundeLoeschen } from "@/components/kunden/KundeLoeschen";
import { NaechstesMeeting } from "@/components/kunden/NaechstesMeeting";
import { AufgabenKarte } from "@/components/kunden/AufgabenKarte";
import { ChecklistenKompakt } from "@/components/kunden/ChecklistenKompakt";
import { FulfillmentPanel } from "@/components/kunden/FulfillmentPanel";
import { MeetingsPanel, ProtokollInhalt } from "@/components/kunden/MeetingsPanel";
import { AblagePanel } from "@/components/kunden/AblagePanel";
import { StammdatenKarte, SteckbriefKarte, ZustaendigSelect } from "@/components/kunden/Stammdaten";
import { FinanzPanel } from "@/components/umsatz/FinanzPanel";
import { GeldKarte } from "@/components/umsatz/GeldKarte";

// Die Kundenakte. Wer ein Meeting übernimmt, sieht ohne Scrollen: Termin,
// Agenda, offene Aufgaben. Das Geld steht als Karte daneben.
//
// „Zahlungen" gibt es nur mit Finanzrechten; ohne sie fällt `?tab=zahlungen`
// still auf den Überblick zurück.

export const dynamic = "force-dynamic";

const TABS = [
  { key: "ueberblick", label: "Überblick" },
  { key: "meetings", label: "Meetings" },
  { key: "fulfillment", label: "Fulfillment" },
  { key: "zahlungen", label: "Zahlungen", finanz: true },
  { key: "ablage", label: "Ablage" },
  { key: "verlauf", label: "Verlauf" },
] as const;

export default async function KundenAktePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const rechte = await getInternRechte();
  if (rechte.fehler) throw new Error("Rechte nicht prüfbar.");
  if (!rechte.kunden) notFound();
  const [{ id }, sp, access] = await Promise.all([params, searchParams, getAccessContext()]);
  if (!access || !/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const tabs = TABS.filter((t) => !("finanz" in t) || rechte.umsatz);
  const tab = tabs.find((t) => t.key === sp.tab)?.key ?? "ueberblick";

  const jetzt = new Date();
  const heute = berlinDateISO(jetzt.toISOString());

  const [akte, team, vorlagen] = await Promise.all([
    loadKundenAkte(id),
    loadInternTeam(),
    tab === "fulfillment" ? loadVorlagen() : Promise.resolve([]),
  ]);
  if (!akte) notFound();

  const { kunde, geplant } = akte;
  const geld = rechte.umsatz ? ((await loadGeld([kunde], heute, id)).get(id) ?? null) : null;
  const namen = Object.fromEntries(team.map((t) => [t.user_id, t.username]));
  const agenda = akte.punkte.filter((p) => p.meeting_id === geplant.id);
  const offen = akte.bausteine.filter((b) => !b.erledigt_am);
  const letztes = akte.protokolle[0] ?? null;
  const hinweise = aufmerksamkeit(
    { status: kunde.status, termin: geplant.termin, agenda: agenda.length },
    jetzt.getTime(),
  );
  const zustaendig = kunde.betreuer_user_id ? namen[kunde.betreuer_user_id] : null;
  const closing = akte.closing;

  const zahl: Record<string, number> = {
    meetings: akte.protokolle.length,
    fulfillment: offen.length,
    ablage: akte.ablage.length,
  };

  return (
    <div className="ks-seite">
      <BackLink href="/kunden" label="Kunden" />
      <PageHeader
        eyebrow="Kundenakte"
        title={kunde.name}
        meta={
          <span className="ks-marken">
            <Badge tone={KUNDEN_STATUS_TONE[kunde.status]}>{KUNDEN_STATUS_LABELS[kunde.status]}</Badge>
            {geld && geld.k.ueberfaellig > 0 && (
              <Link href={`/kunden/${id}?tab=zahlungen`} className="ks-marke-link">
                <Badge tone="error">
                  {formatEur(geld.k.ueberfaellig)} · {geld.k.tageUeberfaellig} {geld.k.tageUeberfaellig === 1 ? "Tag" : "Tage"} überfällig
                </Badge>
              </Link>
            )}
            {kunde.firma && <span>{kunde.firma}</span>}
            <KontaktLinks telefon={kunde.telefon} email={kunde.email} />
            {!rechte.umsatz && <span>{zustaendig ? `Zuständig: ${zustaendig}` : "Niemand zuständig"}</span>}
          </span>
        }
        actions={
          rechte.umsatz ? (
            <ZustaendigSelect key={kunde.betreuer_user_id ?? "_"} kundeId={id} wert={kunde.betreuer_user_id} team={team} />
          ) : undefined
        }
      >
        <Reiter
          label="Bereiche der Akte"
          aktiv={tab}
          eintraege={tabs.map((t) => ({
            key: t.key,
            label: t.label,
            href: t.key === "ueberblick" ? `/kunden/${id}` : `/kunden/${id}?tab=${t.key}`,
            zahl: zahl[t.key] ?? null,
          }))}
        />
      </PageHeader>

      {closing && closing.status !== "gewonnen" && (
        <p className="ks-warnung">
          Das Closing zu diesem Kunden steht nicht mehr auf „Gewonnen“. Bitte Status und Vertrag prüfen.
        </p>
      )}

      {tab === "ueberblick" && (
        <div className="ks-akte">
          <div className="ks-stapel">
            <NaechstesMeeting
              key={geplant.id}
              kundeId={id}
              kundeName={kunde.name}
              meeting={geplant}
              punkte={agenda}
              offeneBausteine={offen}
              team={team}
              currentUserId={access.user.id}
              hinweise={hinweise}
            />
            <AufgabenKarte
              kundeId={id}
              heute={heute}
              aufgaben={akte.aufgaben.map((a) => ({ ...a, seit: berlinDateISO(a.created_at) }))}
            />
            <ChecklistenKompakt kundeId={id} checklisten={akte.checklisten} bausteine={akte.bausteine} heute={heute} />
            <Card>
              <CardHeader
                title="Letztes Meeting"
                meta={
                  letztes
                    ? [formatTermin(letztes.termin), letztes.durchgefuehrt_von_user_id ? namen[letztes.durchgefuehrt_von_user_id] : null]
                        .filter(Boolean)
                        .join(" · ")
                    : undefined
                }
              />
              {letztes ? (
                <ProtokollInhalt meeting={letztes} punkte={akte.punkte} aufgaben={akte.aufgaben} />
              ) : (
                <p className="ks-leise">Noch kein Protokoll.</p>
              )}
            </Card>
          </div>
          <div className="ks-stapel">
            {geld && <GeldKarte geld={geld} heute={heute} />}
            <SteckbriefKarte key={`s:${kunde.steckbrief ?? ""}`} kunde={kunde} />
            <StammdatenKarte
              key={`d:${JSON.stringify([kunde.name, kunde.firma, kunde.email, kunde.telefon, kunde.status, kunde.kunden_workspace_id])}`}
              kunde={kunde}
              orgs={access.is_platform_admin ? access.available_workspaces.filter((o) => o.id !== access.workspace_id) : []}
              kundenOrg={akte.kundenOrg}
              darfZuordnen={rechte.umsatz}
              closing={
                // Das Closing zeigt das Deal-Volumen, deshalb kein Weg dorthin ohne Finanzrechte.
                closing && rechte.umsatz
                  ? { id: closing.id, label: closing.call_at ? `Closing ${datumDe(berlinDateISO(closing.call_at))}` : "Zum Closing" }
                  : null
              }
            />
            {geld && geld.zahlungen.length === 0 && <KundeLoeschen id={id} name={kunde.name} />}
          </div>
        </div>
      )}

      {tab === "meetings" && (
        <MeetingsPanel
          kundeId={id}
          protokolle={akte.protokolle}
          punkte={akte.punkte}
          aufgaben={akte.aufgaben}
          team={team}
          currentUserId={access.user.id}
        />
      )}
      {tab === "fulfillment" && (
        <FulfillmentPanel kundeId={id} checklisten={akte.checklisten} bausteine={akte.bausteine} vorlagen={vorlagen} namen={namen} />
      )}
      {tab === "zahlungen" &&
        (geld ? (
          <FinanzPanel geld={geldSicht(geld)} vereinbarungen={[...geld.vereinbarungen]} heute={heute} personen={namen} />
        ) : (
          <p className="ks-warnung">Die Zahlungen dieses Kunden sind nicht ermittelbar.</p>
        ))}
      {tab === "ablage" && <AblagePanel kundeId={id} eintraege={akte.ablage} namen={namen} mitVertraegen={rechte.umsatz} />}
      {tab === "verlauf" && (
        <Card>
          {akte.log.length === 0 ? (
            <p className="ks-leise">Noch keine Einträge.</p>
          ) : (
            <ul className="ks-liste-schlicht">
              {akte.log.map((l) => (
                <li key={l.id} className="ks-buchung">
                  <span>
                    {l.text}
                    <span className="ks-herkunft">
                      {[formatTermin(l.created_at), l.user_id ? namen[l.user_id] : "System"].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {l.bereich === "finanz" && <Badge tone="neutral">Finanzen</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
