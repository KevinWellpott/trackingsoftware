"use client";

// „Organisationen im Blick“ — je Organisation eine Karte: fünf Kennzahlen ×
// Heute · Woche · Monat, jeweils Ist und Soll bis heute. Gold gibt es hier
// nicht (Gold heißt „du bist dran“); erreicht ist grün, sonst ruhig.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { speichereOrgRichtwerte } from "@/app/actions/orgRichtwerte";
import {
  KENNZAHLEN,
  ZEITRAEUME,
  aktivImMonat,
  erfuellung,
  sollBisHeute,
  sollGesamt,
  summiere,
  summiereRichtwerte,
  type Richtwerte,
  type Zaehler,
  type Zeitraum,
} from "@/lib/orgUebersicht";
import type { OrgUebersichtDaten, OrgZeile } from "@/lib/orgUebersichtData";
import { zahl } from "@/lib/zahl";

function Zelle({ ist, richtwert, z, today, luecke }: { ist: number; richtwert: number | null; z: Zeitraum; today: string; luecke: boolean }) {
  if (luecke) return <td className="org-blick-zelle">—</td>;
  const soll = sollBisHeute(richtwert, z, today);
  const gesamt = sollGesamt(richtwert, z, today);
  const grad = erfuellung(ist, soll);
  const erreicht = grad != null && grad >= 1;
  return (
    <td
      className="org-blick-zelle"
      title={
        soll == null
          ? "Kein Richtwert hinterlegt"
          : z === "tag"
            ? `Soll heute: ${zahl(soll)}`
            : `Soll bis heute: ${zahl(soll)} · ganzer Zeitraum: ${zahl(gesamt ?? 0)}`
      }
    >
      <span className="org-blick-ist" data-erreicht={erreicht || undefined}>
        {zahl(ist)}
      </span>
      {soll != null && (
        <>
          <span className="org-blick-soll">von {zahl(soll)}</span>
          <span className="org-blick-bar" aria-hidden>
            <i data-erreicht={erreicht || undefined} style={{ width: `${Math.min(100, Math.round((grad ?? 0) * 100))}%` }} />
          </span>
        </>
      )}
    </td>
  );
}

function Tabelle({ zaehler, richtwerte, today, luecken }: { zaehler: Zaehler; richtwerte: Richtwerte; today: string; luecken: string[] }) {
  return (
    <div className="table-scroll">
      <table className="org-blick-tabelle">
        <thead>
          <tr>
            <th scope="col">Kennzahl</th>
            {ZEITRAEUME.map((t) => (
              <th key={t.key} scope="col" className="r">
                {t.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {KENNZAHLEN.map((k) => (
            <tr key={k.key}>
              <th scope="row" title={k.hinweis}>
                {k.label}
                {richtwerte[k.key] != null && <span className="org-blick-rw">{zahl(richtwerte[k.key]!)}/Tag</span>}
              </th>
              {ZEITRAEUME.map((t) => (
                <Zelle
                  key={t.key}
                  ist={zaehler[k.key][t.key]}
                  richtwert={richtwerte[k.key]}
                  z={t.key}
                  today={today}
                  luecke={luecken.includes(k.key)}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RichtwerteDialog({
  org,
  alleIds,
  verfuegbar,
  onClose,
}: {
  org: OrgZeile;
  alleIds: string[];
  verfuegbar: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [werte, setWerte] = useState<Record<string, string>>(() =>
    Object.fromEntries(KENNZAHLEN.map((k) => [k.key, org.richtwerte[k.key] == null ? "" : String(org.richtwerte[k.key])])),
  );
  const [fuerAlle, setFuerAlle] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const speichern = () =>
    start(async () => {
      setFehler(null);
      const res = await speichereOrgRichtwerte({ workspaceIds: fuerAlle ? alleIds : [org.id], werte });
      if (res.error) {
        setFehler(res.error);
        return;
      }
      router.refresh();
      onClose();
    });

  return (
    <Modal open onClose={onClose} title={`Richtwerte · ${org.name}`} subtitle="Pro Arbeitstag (Mo–Fr). Leer = kein Richtwert." width={420}>
      <form
        style={{ display: "grid", gap: "var(--sp-5)" }}
        onSubmit={(ev) => {
          ev.preventDefault();
          speichern();
        }}
      >
        {!verfuegbar && (
          <div style={{ color: "var(--warning-fg)", fontSize: "var(--fs-sm)" }}>
            Migration 0051 ist noch nicht eingespielt — Speichern geht erst danach.
          </div>
        )}
        {KENNZAHLEN.map((k) => (
          <label key={k.key} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 120px", alignItems: "center", gap: "var(--sp-4)" }}>
            <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-secondary)" }}>{k.label}</span>
            <input
              className="ui-input"
              inputMode="numeric"
              pattern="[0-9]*"
              value={werte[k.key]}
              onChange={(ev) => setWerte((w) => ({ ...w, [k.key]: ev.target.value }))}
              placeholder="—"
              aria-label={`${k.label} pro Arbeitstag`}
              style={{ textAlign: "right", fontSize: 16 }}
            />
          </label>
        ))}
        <p style={{ margin: 0, fontSize: "var(--fs-xs)", color: "var(--text-muted)", lineHeight: 1.5 }}>
          Woche und Monat rechnen den Richtwert mal die Arbeitstage bis heute — am Mittwoch zählt die Woche drei Tage.
        </p>
        <label style={{ display: "flex", gap: "var(--sp-3)", alignItems: "center", fontSize: "var(--fs-sm)" }}>
          <input type="checkbox" checked={fuerAlle} onChange={(ev) => setFuerAlle(ev.target.checked)} />
          Für alle {alleIds.length} Organisationen übernehmen
        </label>
        {fehler && <div style={{ color: "var(--danger-fg)", fontSize: "var(--fs-sm)" }}>{fehler}</div>}
        <div style={{ display: "flex", gap: "var(--sp-3)", justifyContent: "flex-end" }}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            {fuerAlle ? "Für alle speichern" : "Speichern"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function OrgUebersicht({ orgs, today, richtwerteVerfuegbar, luecken }: OrgUebersichtDaten) {
  const [offen, setOffen] = useState<OrgZeile | null>(null);
  const alleIds = useMemo(() => orgs.map((o) => o.id), [orgs]);

  const { aktiv, ruhig } = useMemo(() => {
    const monat = (o: OrgZeile) => KENNZAHLEN.reduce((n, k) => n + o.zaehler[k.key].monat, 0);
    const a = orgs.filter((o) => o.eigene || aktivImMonat(o.zaehler));
    a.sort((x, y) => Number(y.eigene) - Number(x.eigene) || monat(y) - monat(x) || x.name.localeCompare(y.name, "de"));
    return { aktiv: a, ruhig: orgs.filter((o) => !a.includes(o)) };
  }, [orgs]);

  const gesamt = useMemo(() => summiere(orgs.map((o) => o.zaehler)), [orgs]);
  const gesamtRichtwerte = useMemo(() => summiereRichtwerte(orgs.map((o) => o.richtwerte)), [orgs]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-7)" }}>
      {luecken.length > 0 && (
        <div className="card" style={{ padding: "var(--sp-6)", color: "var(--danger-fg)", fontSize: "var(--fs-sm)" }}>
          Ein Teil der Zahlen ließ sich nicht laden ({luecken.map((l) => KENNZAHLEN.find((k) => k.key === l)?.label ?? l).join(", ")}) —
          dort steht „—“, nicht 0. Bitte neu laden.
        </div>
      )}
      {!richtwerteVerfuegbar && (
        <div className="card" style={{ padding: "var(--sp-6)", color: "var(--warning-fg)", fontSize: "var(--fs-sm)" }}>
          Die Richtwerte fehlen noch in der Datenbank (Migration 0051). Die Übersicht zeigt bis dahin nur das Ist.
        </div>
      )}

      <section className="glass-card org-blick-karte">
        <header className="org-blick-kopf">
          <h2>Alle Organisationen</h2>
          <span className="org-blick-meta">{orgs.length} Organisationen · Soll = Summe der Richtwerte</span>
        </header>
        <Tabelle zaehler={gesamt} richtwerte={gesamtRichtwerte} today={today} luecken={luecken} />
      </section>

      <div className="org-blick-raster">
        {aktiv.map((o) => (
          <section key={o.id} className="card org-blick-karte">
            <header className="org-blick-kopf">
              <h2>
                {o.name}
                {o.eigene && <span className="org-blick-eigene">eigene</span>}
              </h2>
              <span style={{ display: "inline-flex", gap: "var(--sp-2)", marginLeft: "auto" }}>
                <Button size="sm" variant="ghost" icon={<SlidersHorizontal size={13} />} onClick={() => setOffen(o)}>
                  Richtwerte
                </Button>
                <Link href={`/admin/org/${o.id}`} className="ui-btn" data-variant="ghost" data-size="sm">
                  Verwalten
                </Link>
              </span>
            </header>
            <Tabelle zaehler={o.zaehler} richtwerte={o.richtwerte} today={today} luecken={luecken} />
          </section>
        ))}
      </div>

      {ruhig.length > 0 && (
        <section className="card org-blick-karte">
          <header className="org-blick-kopf">
            <h2>Ohne Aktivität diesen Monat</h2>
            <span className="org-blick-meta">{ruhig.length}</span>
          </header>
          <ul className="org-blick-ruhig">
            {ruhig.map((o) => (
              <li key={o.id}>
                <span>{o.name}</span>
                <Button size="sm" variant="ghost" icon={<SlidersHorizontal size={13} />} onClick={() => setOffen(o)}>
                  Richtwerte
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {offen && (
        <RichtwerteDialog org={offen} alleIds={alleIds} verfuegbar={richtwerteVerfuegbar} onClose={() => setOffen(null)} />
      )}
    </div>
  );
}
