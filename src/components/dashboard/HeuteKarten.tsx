import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { formatTerminParts } from "@/lib/apptTime";
import type { NachfassAnzeige } from "@/lib/nachfassenData";
import { GRUPPEN_LABEL, type NachfassGruppe } from "@/lib/nachfassRegel";
import type { TerminEvent } from "@/lib/termine";

// Zwei Karten der Übersicht (Redesign Phase 6): „Heute dran" — die ersten
// Einträge aus dem Nachfass-Eingang, in seiner Reihenfolge — und „Heute im
// Kalender". Beide rechnen nichts selbst: Die Einträge kommen aus
// `ladeNachfassen` + `gruppiere` (derselbe Weg wie Seite und Badge), die
// Termine aus `buildEvents`.

export type HeuteDranEintrag = { e: NachfassAnzeige; gruppe: NachfassGruppe };

export function HeuteDranKarte({
  eintraege,
  gesamt,
  vollstaendig,
}: {
  /** Bereits gekürzt, in der Reihenfolge des Eingangs. */
  eintraege: HeuteDranEintrag[];
  /** Die Badge-Zahl — überfällig + heute + „Ergebnis fehlt". `null` = nicht ermittelbar. */
  gesamt: number | null;
  vollstaendig: boolean;
}) {
  return (
    <section className="card dash-card">
      <header className="dash-card-head">
        <h2>Heute dran</h2>
        <span className="dash-meta">{gesamt === null ? "—" : `${gesamt.toLocaleString("de-DE")} fällig`}</span>
        <Link href="/nachfassen" className="dash-more">
          Alle <ArrowRight size={13} aria-hidden />
        </Link>
      </header>
      {!vollstaendig ? (
        <p className="dash-leer">Der Eingang ließ sich gerade nicht vollständig laden — „Heute“ zeigt den Stand.</p>
      ) : eintraege.length === 0 ? (
        <p className="dash-leer">Niemand fällig. Wer offen ist, wartet auf seinen nächsten Kontakt.</p>
      ) : (
        <ul className="dash-list">
          {eintraege.map(({ e, gruppe }) => (
            <li key={e.key}>
              <Link href="/nachfassen" className="dash-row">
                <span className="dran-mark" data-dran="true" aria-hidden />
                <span className="line1">
                  <span className="nm">{e.name}</span>
                  {e.firma && <span className="co">{e.firma}</span>}
                </span>
                <span className="dash-sub">{e.kontext}</span>
                <span className="dash-side" data-ton={gruppe === "heute" ? undefined : "dran"}>
                  {GRUPPEN_LABEL[gruppe]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const ART = { setting: "Setting · 30 min", closing: "Closing · 60 min" } as const;

export function HeuteImKalenderKarte({ termine }: { termine: TerminEvent[] }) {
  return (
    <section className="card dash-card">
      <header className="dash-card-head">
        <h2>Heute im Kalender</h2>
        <span className="dash-meta">{termine.length.toLocaleString("de-DE")}</span>
        <Link href="/termine?view=tag" className="dash-more">
          Kalender <ArrowRight size={13} aria-hidden />
        </Link>
      </header>
      {termine.length === 0 ? (
        <p className="dash-leer">Heute steht kein Termin an.</p>
      ) : (
        <ul className="agenda">
          {termine.map((t) => {
            const zeit = formatTerminParts(t.at)?.time ?? "—";
            return (
              <li key={t.id} data-dimmed={t.cancelled || t.terminal ? "true" : undefined}>
                <span className="agenda-tm">{zeit}</span>
                <Link href={`${t.href}`} className="agenda-main">
                  <span className="nm">{t.company || t.title}</span>
                  <span className="co">
                    <span className="agenda-art" data-kind={t.kind}>
                      {ART[t.kind]}
                    </span>
                    {t.meetingKind === "telefon" ? " · Telefon" : t.meetLink ? " · Link" : ""}
                    {t.company ? ` · ${t.title}` : ""}
                  </span>
                </Link>
                {t.cancelled ? (
                  <span className="badge">Abgesagt</span>
                ) : t.erinnerungsStufen ? (
                  <span className="marks" aria-label="Die zwei Erinnerungen vor dem Termin">
                    {t.erinnerungsStufen.map((s) => (
                      <span key={s.nr} className="mk" data-stand={s.stand} title={`${s.nr === 1 ? "Vortag" : "1 Stunde vorher"}: ${s.stand}`}>
                        {s.nr}.
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="faint">{t.statusPill.label}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
