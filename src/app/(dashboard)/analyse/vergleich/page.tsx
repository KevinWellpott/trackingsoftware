import type { CSSProperties, ReactNode } from "react";
import { GitCompare, Table } from "lucide-react";
import { getAccessContext, listDataViewUsers } from "@/lib/access";
import { localDateISO } from "@/lib/dates";
import { buildBuckets, parseAnalyseParams } from "@/lib/analyse";
import {
  loadClosingCalls, loadContacts, loadPhoneLeads, loadSettingCalls,
} from "@/lib/analyseData";
import { createClient } from "@/lib/supabase/server";
import { buildFacts } from "@/lib/compare/facts";
import { metricOf, seriesConflicts } from "@/lib/compare/metrics";
import { aggregate, parseSeriesList } from "@/lib/compare/series";
import type { DimensionKey } from "@/lib/compare/model";
import { AnalyseSection } from "@/components/analyse/AnalyseSection";
import { CompareBuilder } from "@/components/analyse/compare/CompareBuilder";
import { CompareChart } from "@/components/analyse/compare/CompareChart";
import { CompareTable } from "@/components/analyse/compare/CompareTable";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/PageHeader";

// Freier Serienvergleich: beliebig viele Kennzahlen, jede mit eigenen Filtern,
// in einem Chart.
//
// Der Auftrag hinter der Seite war nicht „baue diesen einen Vergleich",
// sondern „ich will nicht für jede neue Frage ein neues Element bestellen
// müssen". Deshalb ist hier fast nichts fest verdrahtet: Die Kennzahlen
// stehen als Registry in src/lib/compare/metrics.ts (eine Zeile je Kennzahl),
// die Filterachsen fallen aus den Daten heraus, und die Seite selbst kennt
// weder Kennzahl noch Dimension namentlich.
//
// Datenweg: vier Lader (alle über fetchAllRows) → ein Fakten-Mapper → eine
// Aggregation je Serie. Gerechnet wird auf dem SERVER; der Client bekommt nur
// die fertigen Punkte. Deshalb liegt der komplette Zustand in der URL — ein
// Serienwechsel ist eine Navigation, kein Client-State, und der Link taugt
// zum Weitergeben.

export const dynamic = "force-dynamic";

// Die Erklaertexte stehen hinter dem Info-Icon der Sektion, nicht als Fussnote
// darunter: Vier Zeilen Methodik unter jedem Element sind beim ersten Lesen
// wertvoll und danach jeden Tag im Weg. Die Vorgabe des Auftraggebers gilt fuer
// den gesamten Analysebereich („Info-Texte als Pop-up, nicht konstant da").
function InfoText({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>{children}</div>;
}
const INFO_P: CSSProperties = { margin: 0 };
const INFO_STRONG: CSSProperties = { fontWeight: 600 };

export default async function VergleichPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const access = await getAccessContext();
  if (!access) return null;

  // `s` ist ein MEHRFACH-Parameter (eine Serie je Vorkommen) — alle anderen
  // Parameter sind einwertig und gehen flach an den bestehenden Parser.
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) flat[k] = Array.isArray(v) ? v[0] : v;
  const rawSeries = Array.isArray(sp.s) ? sp.s : sp.s ? [sp.s] : [];

  const today = localDateISO();
  const params = parseAnalyseParams(flat, today);
  const canCompare = access.can_switch_view;

  // Ohne Vergleichsrecht gibt es genau eine Person — die Lader filtern
  // serverseitig ohnehin auf sie, das Personen-Dropdown zeigt dann nur sie.
  const members = canCompare
    ? (await listDataViewUsers(access.workspace_id)).map((m) => ({ user_id: m.user_id, username: m.username }))
    : [{ user_id: access.user.id, username: access.username }];

  const supabase = await createClient();
  const [contacts, phoneLeads, settings, closings] = await Promise.all([
    loadContacts(supabase, access, canCompare, params.from, params.to),
    loadPhoneLeads(supabase, access, canCompare),
    loadSettingCalls(supabase, access, canCompare),
    loadClosingCalls(supabase, access, canCompare),
  ]);

  const { facts, options } = buildFacts({ contacts, phoneLeads, settings, closings, members });

  const buckets = buildBuckets(params.from, params.to, params.g);
  const specs = parseSeriesList(rawSeries);

  // Dimensionswert → Anzeigetext. Ein unbekannter Wert (alter Link, gelöschte
  // Liste) bleibt sichtbar stehen, statt still zu verschwinden: die Serie ist
  // dann leer, und man sieht warum.
  const labelIndex = new Map<string, string>();
  for (const dim of Object.keys(options) as DimensionKey[]) {
    for (const o of options[dim]) labelIndex.set(`${dim}:${o.value}`, o.label);
  }
  const series = aggregate(facts, specs, buckets, params.from, params.to, params.g, (dim, value) =>
    labelIndex.get(`${dim}:${value}`) ?? value,
  );

  // Strukturell unmoegliche Kombinationen (Kennzahl × Filterwert). Der Chart
  // zeigt sie im Leerzustand statt des generischen „Zeitraum vergroessern" —
  // ein Rat, der hier nie hilft. Doppelte Gruende (zwei Serien, derselbe
  // Fehler) faellt das Set heraus.
  const emptyReasons = [
    ...new Set(
      specs.flatMap((spec) => {
        const m = metricOf(spec.metric);
        return m ? seriesConflicts(m, spec.filters).map((c) => c.reason) : [];
      }),
    ),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
        <BackLink href="/analyse" label="Zur Analyse" />
        <PageHeader
          eyebrow="Auswertung"
          title="Vergleich"
          meta="Beliebige Kennzahlen gegeneinander — Kanäle, Personen, Listen, Zielgruppen, Skripte."
        />
      </div>

      <CompareBuilder
        specs={specs}
        colors={series.map((s) => s.color)}
        options={options}
        rangeKey={params.rangeKey}
        from={params.from}
        to={params.to}
        granularity={params.g}
      />

      <div className="fade-up">
        <AnalyseSection
          title="Verlauf"
          icon={GitCompare}
          meta={`${buckets.length} Perioden`}
          info={
            <InfoText>
              <p style={INFO_P}>
                <strong style={INFO_STRONG}>Zwei Achsen.</strong> Mengen und Beträge liegen links, Quoten rechts
                — sonst drückten 400 Termine jede Quote platt auf die Nulllinie. Gestrichelt = Quote, durchgezogen
                = Menge.
              </p>
              <p style={INFO_P}>
                <strong style={INFO_STRONG}>Warum bricht eine Linie ab?</strong> Weil in dieser Periode der Nenner
                fehlte. Eine 0 stünde dort für &bdquo;gemessen und nichts gefunden&ldquo;; richtig ist aber
                &bdquo;keine Basis, also nicht messbar&ldquo; — und das ist eine Lücke.
              </p>
              <p style={INFO_P}>
                <strong style={INFO_STRONG}>Warum springt &bdquo;Umsatz pro DM&ldquo; so?</strong> Weil Zähler und
                Nenner nicht aus derselben Kohorte stammen: Der Deal von heute geht auf eine DM von vor Wochen
                zurück. Alle Wert-Kennzahlen sind solche Perioden-Kennzahlen — bei schwankendem Volumen taugen sie
                als Trend, nicht als Stückpreis.
              </p>
            </InfoText>
          }
        >
          <CompareChart
            buckets={buckets}
            series={series.map((s, i) => ({
              key: `s${i}`,
              label: s.label,
              color: s.color,
              format: s.metric.format,
              points: s.points,
            }))}
            notes={emptyReasons}
          />
        </AnalyseSection>
      </div>

      <div className="fade-up" style={{ animationDelay: "80ms" }}>
        <AnalyseSection
          title="Gegenüberstellung"
          icon={Table}
          meta="Δ bezieht sich auf die erste Serie"
          info={
            <InfoText>
              <p style={INFO_P}>
                <strong style={INFO_STRONG}>Gesamt</strong> ist bei Mengen die Summe, bei Quoten Summe ÷ Summe
                über den ganzen Zeitraum. Bewusst nicht der Mittelwert der Perioden-Quoten: darin zählte ein Tag
                mit einem Termin so viel wie einer mit vierzig.
              </p>
              <p style={INFO_P}>
                <strong style={INFO_STRONG}>Ø je Periode</strong> steht deshalb nur bei Mengen. Bei einer Quote
                wäre er entweder dasselbe wie &bdquo;Gesamt&ldquo; oder genau jener ungewichtete Mittelwert.
              </p>
              <p style={INFO_P}>
                <strong style={INFO_STRONG}>Wem eine Zahl zugerechnet wird:</strong> bei Terminen und Abschlüssen
                der zuständigen Person (Zuweisung vor Ersteller), bei DMs und Erstkontakten dem Besitzer der Liste. Die
                Personen-Achse meint damit über alle Kennzahlen hinweg dieselbe Person.
              </p>
            </InfoText>
          }
        >
          <CompareTable series={series} />
        </AnalyseSection>
      </div>
    </div>
  );
}
