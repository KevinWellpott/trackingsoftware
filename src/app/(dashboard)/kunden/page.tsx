import Link from "next/link";
import { Betrag } from "@/components/umsatz/Betrag";
import { notFound } from "next/navigation";
import { getAccessContext } from "@/lib/access";
import { berlinDateISO, formatTermin } from "@/lib/apptTime";
import { getInternRechte, loadGeld, loadInternTeam, loadKundenListe } from "@/lib/internData";
import { KUNDEN_STATUS_LABELS, aufmerksamkeit, istLaufend, type KundenStatus } from "@/lib/kunden";
import { FINANZ_STATUS_LABELS, datumDe } from "@/lib/umsatz";
import { mitGueltigerPerson, passtZuWer, werAusUrl, werEintraege } from "@/lib/kundenFilter";
import { PageHeader } from "@/components/ui/PageHeader";
import { InfoPopover } from "@/components/ui/InfoPopover";
import { ownerColor } from "@/lib/ownerColor";
import { ListChecks, Search } from "lucide-react";
import { KundeAnlegenButton } from "@/components/kunden/KundeAnlegenButton";
import { HerkunftMerken } from "@/components/kunden/Zurueck";

// /kunden: eine Zeile je Kunde mit dem, was man vor dem Meeting wissen muss.
// Nächster Termin, erster Agenda-Punkt, Fortschritt. Die Geldspalte sehen nur
// Admins; für die anderen wird sie gar nicht erst geladen.

export const dynamic = "force-dynamic";

/** Dezente Status-Badges: Farbe nur als Punkt und Hauch, nie Gold/Orange (28.11.). */
const STATUS_TON: Record<KundenStatus, "blau" | "rot" | "gruen" | undefined> = {
  onboarding: "blau",
  aktiv: "gruen",
  pausiert: undefined,
  abgeschlossen: undefined,
  gekuendigt: undefined,
  abgesprungen: "rot",
};

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

  const reiter: { key: Zeige; label: string; zahl: number }[] = [
    { key: "laufend", label: "In Betreuung", zahl: anzahl("laufend") },
    { key: "woche", label: "Meeting in 7 Tagen", zahl: anzahl("woche") },
    { key: "achtung", label: "Braucht Aufmerksamkeit", zahl: anzahl("achtung") },
    ...(geld ? [{ key: "ueberfaellig" as const, label: "Zahlung überfällig", zahl: anzahl("ueberfaellig") }] : []),
    { key: "beendet", label: "Beendet", zahl: anzahl("beendet") },
  ];
  const personen = werEintraege(basis.map((z) => z.kunde), team, userId, (w) => href(w, zeige));

  return (
    <div className="ks-seite">
      <HerkunftMerken label="Kunden" />
      {/* Überarbeitet am 28.11.: Erklärung im Info-Icon, eine Leiste für
          Reiter, Suche und Personen, eine Tabelle mit fluchtenden Spalten.
          Kein Gold (heißt „du bist dran“) und kein Orange als Status. */}
      <PageHeader
        eyebrow="Kundenspace"
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" }}>
            Kunden
            <InfoPopover label="Was steht hier?" width={360}>
              Eine Zeile je Kunde: nächstes Meeting, was besprochen wird, Fortschritt im Fulfillment
              {geld ? " und der Stand der Zahlungen" : ""}. Kunden entstehen automatisch, sobald ein Closing auf
              „Gewonnen“ gesetzt wird.
            </InfoPopover>
          </span>
        }
        meta={`${alle.filter(filter.laufend).length} in Betreuung`}
        actions={
          <>
            <Link href="/kunden/vorlagen" className="ui-btn" data-variant="secondary" data-size="md">
              <ListChecks size={14} aria-hidden /> Vorlagen
            </Link>
            <KundeAnlegenButton team={team} darfZuordnen={rechte.umsatz} />
          </>
        }
      />

      <div className="kd-leiste">
        {!q && (
          <nav className="kd-reiter" aria-label="Welche Kunden">
            {reiter.map((r) => (
              <Link
                key={r.key}
                href={href(wer, r.key)}
                scroll={false}
                className="kd-reiter-link"
                data-aktiv={r.key === zeige || undefined}
                aria-current={r.key === zeige ? "page" : undefined}
              >
                {r.label}
                <span className="kd-zahl" data-warn={(r.key === "achtung" || r.key === "ueberfaellig") && r.zahl > 0 ? "" : undefined}>
                  {r.zahl}
                </span>
              </Link>
            ))}
          </nav>
        )}
        <form action="/kunden" role="search" className="kd-suche">
          <Search size={14} aria-hidden />
          <input type="search" name="q" defaultValue={q} key={q} aria-label="Kunden suchen" placeholder="Name, Firma oder E-Mail" />
          {q && (
            <Link href="/kunden" className="kd-suche-weg">
              Aufheben
            </Link>
          )}
        </form>
        {!q && personen.length > 1 && (
          <nav className="kd-personen" aria-label="Wessen Kunden">
            {personen.map((p) => (
              <Link
                key={p.key}
                href={p.href}
                scroll={false}
                className="kd-person"
                data-aktiv={p.key === wer || undefined}
                aria-current={p.key === wer ? "page" : undefined}
              >
                {p.label}
                <span>{p.zahl}</span>
              </Link>
            ))}
          </nav>
        )}
      </div>

      <section className="card kd-karte">
        {zeilen.length === 0 ? (
          <p className="kd-leer">
            {kunden.length === 0 ? "Noch keine Kunden." : q ? `Kein Kunde passt zu „${q}“.` : "In dieser Ansicht ist nichts."}
          </p>
        ) : (
          <div className="kd-tabelle" data-geld={geld ? "true" : "false"}>
            <div className="kd-kopf" aria-hidden="true">
              <span>Kunde</span>
              <span>Nächstes Meeting</span>
              <span>Wird besprochen</span>
              <span>Fulfillment</span>
              {geld && <span className="r">Zahlung</span>}
            </div>
            <ul className="kd-liste">
              {zeilen.map(({ kunde, k, hinweise }) => {
                const person = kunde.betreuer_user_id ? namen.get(kunde.betreuer_user_id) : null;
                const f = kunde.bausteine;
                const farbe = ownerColor(kunde.name);
                return (
                  <li key={kunde.id}>
                    <Link href={`/kunden/${kunde.id}`} className="kd-zeile">
                      <span className="kd-zelle kd-kunde">
                        <span className="kd-avatar" style={{ background: farbe.bg, color: farbe.fg }} aria-hidden>
                          {kunde.name.trim().charAt(0).toUpperCase() || "?"}
                        </span>
                        <span className="kd-kunde-text">
                          <span className="kd-name-zeile">
                            <span className="kd-name">{kunde.name}</span>
                            {kunde.status !== "aktiv" && (
                              <span className="kd-badge" data-ton={STATUS_TON[kunde.status]}>
                                {KUNDEN_STATUS_LABELS[kunde.status]}
                              </span>
                            )}
                          </span>
                          <span className="kd-unter">
                            {kunde.firma && <span className="kd-firma">{kunde.firma}</span>}
                            {person ? (
                              <span>{person}</span>
                            ) : (
                              <span className="kd-badge" data-ton="rot">
                                Niemand zuständig
                              </span>
                            )}
                          </span>
                        </span>
                      </span>
                      <span className="kd-zelle" data-feld="termin">
                        {kunde.termin ? (
                          <span className="kd-wert">{formatTermin(kunde.termin)}</span>
                        ) : (
                          hinweise.length === 0 && <span className="kd-leise">Kein Termin</span>
                        )}
                        {hinweise.map((h) => (
                          <span key={h} className="kd-badge" data-ton="rot">
                            {h}
                          </span>
                        ))}
                        {kunde.letztesMeeting && <span className="kd-unter">zuletzt {datumDe(berlinDateISO(kunde.letztesMeeting))}</span>}
                      </span>
                      <span className="kd-zelle" data-feld="agenda">
                        {kunde.agenda.length ? (
                          <>
                            <span className="kd-einzeilig">{kunde.agenda[0]}</span>
                            {kunde.agenda.length > 1 && <span className="kd-unter">+ {kunde.agenda.length - 1} weitere</span>}
                          </>
                        ) : (
                          <span className="kd-leise">Keine Agenda</span>
                        )}
                      </span>
                      <span className="kd-zelle" data-feld="fortschritt">
                        {f.gesamt ? (
                          <span className="kd-fortschritt">
                            <span className="kd-balken" aria-hidden>
                              <i data-voll={f.erledigt >= f.gesamt || undefined} style={{ width: `${(f.erledigt / f.gesamt) * 100}%` }} />
                            </span>
                            <span className="kd-wert tnum">
                              {f.erledigt}/{f.gesamt}
                            </span>
                          </span>
                        ) : (
                          <span className="kd-leise">{kunde.checklisten ? "Keine Punkte" : "Keine Checkliste"}</span>
                        )}
                      </span>
                      {geld && (
                        <span className="kd-zelle r" data-feld="geld">
                          {!k ? (
                            <span className="kd-leise">nicht ermittelbar</span>
                          ) : k.ueberfaellig > 0 ? (
                            <>
                              <span className="kd-wert kd-rot">
                                <Betrag wert={k.ueberfaellig} /> überfällig
                              </span>
                              <span className="kd-unter kd-rot">
                                seit {k.tageUeberfaellig} {k.tageUeberfaellig === 1 ? "Tag" : "Tagen"}
                              </span>
                            </>
                          ) : k.status === "laeuft" && k.naechsteRate ? (
                            <>
                              <span className="kd-wert">
                                <Betrag wert={k.naechsteRate.rest} />
                              </span>
                              <span className="kd-unter">am {datumDe(k.naechsteRate.faellig_am)}</span>
                            </>
                          ) : (
                            <span className="kd-badge" data-ton={k.status === "bezahlt" ? "gruen" : k.status.startsWith("plan_") || k.status === "vertrag_fehlt" ? "rot" : undefined}>
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
      </section>
    </div>
  );
}
