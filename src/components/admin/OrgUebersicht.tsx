"use client";

// „Organisationen im Blick“ — Aufbau (Überarbeitung 28.11.):
//
//   1. Zeitraum-Schalter Heute · Woche · Monat (`?zeit=`, Vorgabe Woche).
//   2. Fünf Kacheln „Alle Organisationen“: große Zahl des Zeitraums, Soll und
//      Balken — und darunter immer alle drei Zeiträume klein.
//   3. Rangliste: eine Zeile je Organisation, fünf Spalten mit Zahl und
//      Balken, sortierbar je Kennzahl. Ein Klick klappt Heute/Woche/Monat auf.
//   4. Organisationen ohne Aktivität im Monat gesammelt am Ende.
//
// Gold gibt es hier nicht (Gold heißt „du bist dran“); erreicht ist grün,
// sonst ruhig.

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useMemo, useState, useTransition } from "react";
import { ChevronDown, ChevronRight, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Segmented } from "@/components/ui/Segmented";
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
  type Kennzahl,
  type Zaehler,
  type Zeitraum,
} from "@/lib/orgUebersicht";
import type { OrgUebersichtDaten, OrgZeile } from "@/lib/orgUebersichtData";
import { zahl } from "@/lib/zahl";

function parseZeit(raw: string | null): Zeitraum {
  return raw === "tag" || raw === "monat" ? raw : "woche";
}

/** Fortschrittsbalken; ohne Soll keiner. */
function Balken({ grad, breit = false }: { grad: number | null; breit?: boolean }) {
  if (grad == null) return null;
  return (
    <span className="ob-bar" data-breit={breit || undefined} aria-hidden>
      <i data-erreicht={grad >= 1 || undefined} style={{ width: `${Math.min(100, Math.round(grad * 100))}%` }} />
    </span>
  );
}

function Prozent({ grad }: { grad: number | null }) {
  if (grad == null) return null;
  return (
    <span className="ob-pct" data-erreicht={grad >= 1 || undefined}>
      {zahl(Math.round(grad * 100))} %
    </span>
  );
}

// ── Kacheln: alle Organisationen ──────────────────────────────────────────

function Kachel({
  k,
  zaehler,
  richtwert,
  zeit,
  today,
  luecke,
}: {
  k: (typeof KENNZAHLEN)[number];
  zaehler: Zaehler;
  richtwert: number | null;
  zeit: Zeitraum;
  today: string;
  luecke: boolean;
}) {
  const ist = zaehler[k.key][zeit];
  const soll = sollBisHeute(richtwert, zeit, today);
  const grad = luecke ? null : erfuellung(ist, soll);
  return (
    <div className="glass-card ob-kachel" title={k.hinweis}>
      <div className="ob-kachel-kopf">
        <span className="eyebrow">{k.label}</span>
        <Prozent grad={grad} />
      </div>
      <div className="ob-kachel-zahl" data-erreicht={(grad != null && grad >= 1) || undefined}>
        {luecke ? "—" : zahl(ist)}
      </div>
      <div className="ob-kachel-soll">
        {soll == null ? "kein Richtwert" : `Soll bis heute ${zahl(soll)}`}
        {soll != null && zeit !== "tag" && <> · ganz {zahl(sollGesamt(richtwert, zeit, today) ?? 0)}</>}
      </div>
      <Balken grad={grad} breit />
      <div className="ob-kachel-drei">
        {ZEITRAEUME.map((t) => (
          <span key={t.key} data-aktiv={t.key === zeit || undefined}>
            <small>{t.label}</small>
            {luecke ? "—" : zahl(zaehler[k.key][t.key])}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Detail einer Organisation: Heute · Woche · Monat ─────────────────────

function Detail({ org, today, luecken }: { org: OrgZeile; today: string; luecken: string[] }) {
  return (
    <div className="ob-detail">
      {KENNZAHLEN.map((k) => (
        <div key={k.key} className="ob-detail-k">
          <div className="ob-detail-label">
            {k.label}
            <small>{org.richtwerte[k.key] == null ? "kein Richtwert" : `${zahl(org.richtwerte[k.key]!)} pro Arbeitstag`}</small>
          </div>
          {ZEITRAEUME.map((t) => {
            const ist = org.zaehler[k.key][t.key];
            const soll = sollBisHeute(org.richtwerte[k.key], t.key, today);
            const grad = luecken.includes(k.key) ? null : erfuellung(ist, soll);
            return (
              <div key={t.key} className="ob-detail-zelle">
                <small>{t.label}</small>
                <strong data-erreicht={(grad != null && grad >= 1) || undefined}>{luecken.includes(k.key) ? "—" : zahl(ist)}</strong>
                {soll != null && <span>von {zahl(soll)}</span>}
                <Balken grad={grad} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Richtwerte-Dialog ─────────────────────────────────────────────────────

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

// ── Seite ─────────────────────────────────────────────────────────────────

/** Wie viele Kennzahlen mit Richtwert sind im Zeitraum erreicht? */
function imPlan(o: OrgZeile, zeit: Zeitraum, today: string, luecken: string[]): { erreicht: number; von: number } {
  let erreicht = 0;
  let von = 0;
  for (const k of KENNZAHLEN) {
    if (luecken.includes(k.key)) continue;
    const g = erfuellung(o.zaehler[k.key][zeit], sollBisHeute(o.richtwerte[k.key], zeit, today));
    if (g == null) continue;
    von += 1;
    if (g >= 1) erreicht += 1;
  }
  return { erreicht, von };
}

function initialen(name: string): string {
  const teile = name.trim().split(/\s+/).filter(Boolean);
  return ((teile[0]?.[0] ?? "") + (teile[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function OrgUebersicht({ orgs, today, richtwerteVerfuegbar, luecken }: OrgUebersichtDaten) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const zeit = parseZeit(sp.get("zeit"));
  const [sortierung, setSortierung] = useState<Kennzahl>("anwahlen");
  const [offen, setOffen] = useState<OrgZeile | null>(null);
  const [aufgeklappt, setAufgeklappt] = useState<Set<string>>(new Set());
  const alleIds = useMemo(() => orgs.map((o) => o.id), [orgs]);

  const setZeit = (v: Zeitraum) => {
    const next = new URLSearchParams(sp.toString());
    if (v === "woche") next.delete("zeit");
    else next.set("zeit", v);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const { aktiv, ruhig } = useMemo(() => {
    const a = orgs.filter((o) => o.eigene || aktivImMonat(o.zaehler));
    a.sort(
      (x, y) =>
        y.zaehler[sortierung][zeit] - x.zaehler[sortierung][zeit] ||
        Number(y.eigene) - Number(x.eigene) ||
        x.name.localeCompare(y.name, "de"),
    );
    return { aktiv: a, ruhig: orgs.filter((o) => !a.includes(o)) };
  }, [orgs, sortierung, zeit]);

  const gesamt = useMemo(() => summiere(orgs.map((o) => o.zaehler)), [orgs]);
  const gesamtRichtwerte = useMemo(() => summiereRichtwerte(orgs.map((o) => o.richtwerte)), [orgs]);
  const imPlanAnzahl = aktiv.filter((o) => {
    const p = imPlan(o, zeit, today, luecken);
    return p.von > 0 && p.erreicht === p.von;
  }).length;
  const mitRichtwert = aktiv.filter((o) => imPlan(o, zeit, today, luecken).von > 0).length;

  const toggle = (id: string) =>
    setAufgeklappt((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
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

      {/* ── Zeitraum ── */}
      <div className="ob-leiste">
        <Segmented
          options={ZEITRAEUME.map((t) => ({ value: t.key, label: t.label }))}
          value={zeit}
          onChange={setZeit}
          ariaLabel="Zeitraum"
        />
        <span className="ob-leiste-text">
          {mitRichtwert > 0
            ? `${imPlanAnzahl} von ${mitRichtwert} Organisationen mit Richtwerten liegen überall im Plan`
            : "Noch keine Richtwerte — über „Richtwerte“ an einer Organisation eintragen."}
        </span>
      </div>

      {/* ── Alle Organisationen ── */}
      <section aria-label="Alle Organisationen" className="ob-kacheln">
        {KENNZAHLEN.map((k) => (
          <Kachel
            key={k.key}
            k={k}
            zaehler={gesamt}
            richtwert={gesamtRichtwerte[k.key]}
            zeit={zeit}
            today={today}
            luecke={luecken.includes(k.key)}
          />
        ))}
      </section>

      {/* ── Rangliste ── */}
      <section className="card ob-rangliste">
        <header className="ob-kopf">
          <h2>Organisationen</h2>
          <span>
            {aktiv.length} aktiv · sortiert nach {KENNZAHLEN.find((k) => k.key === sortierung)?.label} ({ZEITRAEUME.find((t) => t.key === zeit)?.label})
          </span>
        </header>
        <div className="table-scroll">
          <table className="ob-tabelle">
            <thead>
              <tr>
                <th scope="col">Organisation</th>
                {KENNZAHLEN.map((k) => (
                  <th key={k.key} scope="col" className="r" data-sortiert={sortierung === k.key || undefined} aria-sort={sortierung === k.key ? "descending" : undefined}>
                    <button type="button" onClick={() => setSortierung(k.key)} data-aktiv={sortierung === k.key || undefined} title={k.hinweis}>
                      {k.label}
                      {sortierung === k.key && <ChevronDown size={12} aria-hidden />}
                    </button>
                  </th>
                ))}
                <th scope="col" className="r">
                  <span className="sr-only">Aktion</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {aktiv.map((o) => {
                const plan = imPlan(o, zeit, today, luecken);
                const auf = aufgeklappt.has(o.id);
                return (
                  <Fragment key={o.id}>
                    <tr className="ob-zeile" data-auf={auf || undefined}>
                      <th scope="row">
                        <button type="button" className="ob-org" onClick={() => toggle(o.id)} aria-expanded={auf}>
                          {auf ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                          <span className="ob-avatar" aria-hidden>
                            {initialen(o.name)}
                          </span>
                          <span className="ob-org-text">
                            <span className="ob-org-name">
                              {o.name}
                              {o.eigene && <em>eigene</em>}
                            </span>
                            <small data-voll={(plan.von > 0 && plan.erreicht === plan.von) || undefined}>
                              {plan.von > 0 ? `${plan.erreicht} von ${plan.von} im Plan` : "ohne Richtwerte"}
                            </small>
                          </span>
                        </button>
                      </th>
                      {KENNZAHLEN.map((k) => {
                        const ist = o.zaehler[k.key][zeit];
                        const soll = sollBisHeute(o.richtwerte[k.key], zeit, today);
                        const lk = luecken.includes(k.key);
                        const grad = lk ? null : erfuellung(ist, soll);
                        return (
                          <td key={k.key} className="ob-zelle" data-sortiert={sortierung === k.key || undefined}>
                            <strong data-erreicht={(grad != null && grad >= 1) || undefined} data-null={(!lk && ist === 0) || undefined}>
                              {lk ? "—" : zahl(ist)}
                            </strong>
                            {soll != null && <span>/ {zahl(soll)}</span>}
                            <Balken grad={grad} />
                          </td>
                        );
                      })}
                      <td className="r ob-aktion">
                        <Button size="sm" variant="ghost" icon={<SlidersHorizontal size={13} />} onClick={() => setOffen(o)} title="Richtwerte">
                          <span className="hide-on-mobile">Richtwerte</span>
                        </Button>
                      </td>
                    </tr>
                    {auf && (
                      <tr className="ob-detail-zeile">
                        <td colSpan={KENNZAHLEN.length + 2}>
                          <Detail org={o} today={today} luecken={luecken} />
                          <div className="ob-detail-fuss">
                            <Link href={`/admin/org/${o.id}`} className="ui-btn" data-variant="ghost" data-size="sm">
                              Organisation verwalten
                            </Link>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {ruhig.length > 0 && (
        <section className="card ob-rangliste">
          <header className="ob-kopf">
            <h2>Ohne Aktivität diesen Monat</h2>
            <span>{ruhig.length}</span>
          </header>
          <ul className="ob-ruhig">
            {ruhig.map((o) => (
              <li key={o.id}>
                <span className="ob-avatar" aria-hidden>
                  {initialen(o.name)}
                </span>
                <span className="ob-org-name">{o.name}</span>
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

