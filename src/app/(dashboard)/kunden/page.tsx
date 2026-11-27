import Link from "next/link";
import { Betrag } from "@/components/umsatz/Betrag";
import { notFound } from "next/navigation";
import { getAccessContext } from "@/lib/access";
import { berlinDateISO, formatTermin } from "@/lib/apptTime";
import { getInternRechte, loadGeld, loadInternTeam, loadKundenListe } from "@/lib/internData";
import { KUNDEN_STATUS_LABELS, KUNDEN_STATUS_TONE, aufmerksamkeit, istLaufend } from "@/lib/kunden";
import { FINANZ_STATUS_LABELS, datumDe } from "@/lib/umsatz";
import { mitGueltigerPerson, passtZuWer, werAusUrl, werEintraege } from "@/lib/kundenFilter";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Chips } from "@/components/kunden/Nav";
import { KundeAnlegenButton } from "@/components/kunden/KundeAnlegenButton";
import { HerkunftMerken } from "@/components/kunden/Zurueck";

// /kunden: eine Zeile je Kunde mit dem, was man vor dem Meeting wissen muss.
// Nächster Termin, erster Agenda-Punkt, Fortschritt. Die Geldspalte sehen nur
// Admins; für die anderen wird sie gar nicht erst geladen.

export const dynamic = "force-dynamic";

const ZEIGE = ["laufend", "woche", "achtung", "ueberfaellig", "beendet"] as const;
type Zeige = (typeof ZEIGE)[number];

function addTage(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export default async function KundenPage({ searchParams }: { searchParams: Promise<{ wer?: string; zeige?: string; q?: string }> }) {
  const rechte = await getInternRechte();
  if (rechte.fehler) throw new Error("Rechte nicht prüfbar.");
  if (!rechte.kunden) notFound();
  const [sp, access] = await Promise.all([searchParams, getAccessContext()]);
  if (!access) notFound();

  const [roh, team] = await Promise.all([loadKundenListe(), loadInternTeam()]);
  const kunden = mitGueltigerPerson(roh, team);
  // Der Referenzzeitpunkt kommt vom Server und gilt für die ganze Liste.
  const jetzt = new Date();
  const nowMs = jetzt.getTime();
  const heute = berlinDateISO(jetzt.toISOString());
  const geld = rechte.umsatz ? await loadGeld(kunden, heute) : null;

  const userId = access.user.id;
  const wer = werAusUrl(sp.wer, kunden, team, userId);
  const zeige: Zeige = ZEIGE.find((z) => z === sp.zeige && (z !== "ueberfaellig" || geld)) ?? "laufend";

  const alle = kunden.map((kunde) => ({
    kunde,
    k: geld?.get(kunde.id)?.k ?? null,
    hinweise: aufmerksamkeit(
      { status: kunde.status, termin: kunde.termin, agenda: kunde.agenda.length },
      nowMs,
    ),
  }));
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  // Wer sucht, sucht einen Menschen: über alle Zuständigen und jeden Status.
  const meine = alle.filter((z) => passtZuWer(z.kunde, wer, userId));
  const in7Tagen = addTage(heute, 7);
  const filter: Record<Zeige, (z: (typeof alle)[number]) => boolean> = {
    laufend: (z) => istLaufend(z.kunde.status),
    woche: (z) => {
      if (!z.kunde.termin || !istLaufend(z.kunde.status)) return false;
      const tag = berlinDateISO(z.kunde.termin);
      return tag >= heute && tag <= in7Tagen;
    },
    achtung: (z) => z.hinweise.length > 0,
    // Auch beendete Kunden können noch schulden.
    ueberfaellig: (z) => (z.k?.ueberfaellig ?? 0) > 0,
    beendet: (z) => !istLaufend(z.kunde.status),
  };
  const zeit = (t: string | null) => (t ? Date.parse(t) : Number.MAX_SAFE_INTEGER);
  const gesucht = q.toLocaleLowerCase("de");
  const zeilen = (
    q
      ? alle.filter((z) =>
          [z.kunde.name, z.kunde.firma, z.kunde.email].some((f) => f?.toLocaleLowerCase("de").includes(gesucht)),
        )
      : meine.filter(filter[zeige])
  )
    .sort((a, b) =>
      zeige === "ueberfaellig"
        ? (b.k?.tageUeberfaellig ?? 0) - (a.k?.tageUeberfaellig ?? 0)
        : zeit(a.kunde.termin) - zeit(b.kunde.termin) || a.kunde.name.localeCompare(b.kunde.name, "de"),
    );

  const namen = new Map(team.map((t) => [t.user_id, t.username]));
  const href = (w: string, z: string) => `/kunden?wer=${w}&zeige=${z}`;
  const basis = zeige === "beendet" ? alle.filter(filter.beendet) : zeige === "laufend" ? alle.filter(filter.laufend) : alle.filter(filter[zeige]);
  const anzahl = (z: Zeige) => meine.filter(filter[z]).length;

  return (
    <div className="ks-seite">
      <HerkunftMerken label="Kunden" />
      <PageHeader
        eyebrow="Kundenspace"
        title="Kunden"
        meta={`${alle.filter(filter.laufend).length} in Betreuung`}
        actions={
          <>
            <Link href="/kunden/vorlagen" className="ks-link">
              Vorlagen
            </Link>
            <KundeAnlegenButton team={team} darfZuordnen={rechte.umsatz} />
          </>
        }
      >
        <form action="/kunden" role="search" className="ks-suche">
          <input type="search" name="q" defaultValue={q} key={q} className="ui-input" aria-label="Kunden suchen" placeholder="Name, Firma oder E-Mail suchen" />
          {q && (
            <Link href="/kunden" className="ks-link">
              Suche aufheben
            </Link>
          )}
        </form>
        {!q && (
          <>
        <Chips label="Wessen Kunden" aktiv={wer} eintraege={werEintraege(basis.map((z) => z.kunde), team, userId, (w) => href(w, zeige))} />
        <Chips
          label="Welche Kunden"
          aktiv={zeige}
          eintraege={[
            { key: "laufend", label: "In Betreuung", href: href(wer, "laufend"), zahl: anzahl("laufend") },
            { key: "woche", label: "Meeting in 7 Tagen", href: href(wer, "woche"), zahl: anzahl("woche") },
            { key: "achtung", label: "Braucht Aufmerksamkeit", href: href(wer, "achtung"), zahl: anzahl("achtung"), warnung: true },
            ...(geld
              ? [{ key: "ueberfaellig", label: "Zahlung überfällig", href: href(wer, "ueberfaellig"), zahl: anzahl("ueberfaellig"), warnung: true }]
              : []),
            { key: "beendet", label: "Beendet", href: href(wer, "beendet"), zahl: anzahl("beendet") },
          ]}
        />
          </>
        )}
      </PageHeader>

      <Card padding={0}>
        {zeilen.length === 0 ? (
          <p className="ks-leer">
            {kunden.length === 0
              ? "Noch keine Kunden. Sie entstehen automatisch, sobald ein Closing auf „Gewonnen“ gesetzt wird."
              : q
                ? `Kein Kunde passt zu „${q}“.`
                : "In dieser Ansicht ist nichts."}
          </p>
        ) : (
          <div className="ks-tabelle" data-geld={geld ? "true" : "false"}>
            <div className="ks-tabelle-kopf" aria-hidden="true">
              <span>Kunde</span>
              <span>Nächstes Meeting</span>
              <span>Wird besprochen</span>
              <span>Fulfillment</span>
              {geld && <span>Zahlung</span>}
            </div>
            <ul className="ks-liste-schlicht">
              {zeilen.map(({ kunde, k, hinweise }) => {
                const person = kunde.betreuer_user_id ? namen.get(kunde.betreuer_user_id) : null;
                const f = kunde.bausteine;
                return (
                  <li key={kunde.id}>
                    <Link href={`/kunden/${kunde.id}`} className="ks-tabelle-zeile">
                      <span className="ks-zelle" data-feld="kunde">
                        <span className="ks-name">{kunde.name}</span>
                        <span className="ks-unter">
                          {kunde.firma ? `${kunde.firma} · ` : ""}
                          {person ?? <span className="ks-gold">Niemand zuständig</span>}
                        </span>
                        {kunde.status !== "aktiv" && (
                          <Badge tone={KUNDEN_STATUS_TONE[kunde.status]}>{KUNDEN_STATUS_LABELS[kunde.status]}</Badge>
                        )}
                      </span>
                      <span className="ks-zelle" data-feld="termin">
                        {/* Ohne Termin sagt der Hinweis darunter es schon, außer bei pausierten und beendeten Kunden. */}
                        {kunde.termin ? (
                          <span>{formatTermin(kunde.termin)}</span>
                        ) : (
                          hinweise.length === 0 && <span className="ks-leise">Kein Termin</span>
                        )}
                        {hinweise.map((h) => (
                          <span key={h} className="ks-unter ks-gold">
                            {h}
                          </span>
                        ))}
                        {kunde.letztesMeeting && (
                          <span className="ks-unter">zuletzt {datumDe(berlinDateISO(kunde.letztesMeeting))}</span>
                        )}
                      </span>
                      <span className="ks-zelle" data-feld="agenda" data-leer={kunde.agenda.length ? undefined : "true"}>
                        {kunde.agenda.length ? (
                          <>
                            <span className="ks-zwei-zeilen">{kunde.agenda[0]}</span>
                            {kunde.agenda.length > 1 && <span className="ks-unter">+ {kunde.agenda.length - 1} weitere</span>}
                          </>
                        ) : (
                          <span className="ks-leise">Keine Agenda</span>
                        )}
                      </span>
                      <span className="ks-zelle" data-feld="fortschritt" data-leer={f.gesamt ? undefined : "true"}>
                        {f.gesamt ? (
                          <>
                            <span>
                              {f.erledigt} / {f.gesamt}
                            </span>
                            <span className="progress-track">
                              <span className="progress-fill ks-fortschritt" style={{ display: "block", width: `${(f.erledigt / f.gesamt) * 100}%` }} />
                            </span>
                          </>
                        ) : (
                          <span className="ks-leise">{kunde.checklisten ? "Keine Punkte" : "Keine Checkliste"}</span>
                        )}
                      </span>
                      {geld && (
                        <span className="ks-zelle" data-feld="geld">
                          {!k ? (
                            <span className="ks-gold">Nicht ermittelbar</span>
                          ) : k.ueberfaellig > 0 ? (
                            <>
                              <span className="ks-rot"><Betrag wert={k.ueberfaellig} /> überfällig</span>
                              <span className="ks-unter ks-rot">
                                {k.tageUeberfaellig} {k.tageUeberfaellig === 1 ? "Tag" : "Tage"}
                              </span>
                            </>
                          ) : k.status === "laeuft" && k.naechsteRate ? (
                            <>
                              <span><Betrag wert={k.naechsteRate.rest} /></span>
                              <span className="ks-unter">am {datumDe(k.naechsteRate.faellig_am)}</span>
                            </>
                          ) : (
                            <span className={k.status === "bezahlt" ? "ks-gruen" : k.status.startsWith("plan_") || k.status === "vertrag_fehlt" ? "ks-gold" : "ks-leise"}>
                              {FINANZ_STATUS_LABELS[k.status]}
                            </span>
                          )}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
