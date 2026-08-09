import { GitCompare, Table } from "lucide-react";
import { getAccessContext, listDataViewUsers } from "@/lib/access";
import { localDateISO } from "@/lib/dates";
import { buildBuckets, parseAnalyseParams } from "@/lib/analyse";
import {
  loadClosingCalls, loadContacts, loadPhoneLeads, loadSettingCalls,
} from "@/lib/analyseData";
import { createClient } from "@/lib/supabase/server";
import { buildFacts } from "@/lib/compare/facts";
import { aggregate, parseSeriesList } from "@/lib/compare/series";
import type { DimensionKey } from "@/lib/compare/model";
import { AnalyseSection } from "@/components/analyse/AnalyseSection";
import { Footnote } from "@/components/analyse/AnalyseTables";
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
        <AnalyseSection title="Verlauf" icon={GitCompare} meta={`${buckets.length} Perioden`}>
          <CompareChart
            buckets={buckets}
            series={series.map((s, i) => ({
              key: `s${i}`,
              label: s.label,
              color: s.color,
              format: s.metric.format,
              points: s.points,
            }))}
          />
          <Footnote>
            Mengen und Beträge stehen auf der linken Achse, Quoten (gestrichelt) auf der rechten. Perioden ohne
            Nenner bleiben eine Lücke statt einer 0 — &bdquo;keine Basis&ldquo; ist kein Nullwert. Wert-Kennzahlen wie
            &bdquo;Umsatz pro DM&ldquo; sind Perioden-Kennzahlen: Der Deal von heute stammt aus einer DM von vor
            Wochen, Zähler und Nenner liegen also im selben Fenster, aber nicht in derselben Kohorte.
          </Footnote>
        </AnalyseSection>
      </div>

      <div className="fade-up" style={{ animationDelay: "80ms" }}>
        <AnalyseSection title="Gegenüberstellung" icon={Table} meta="Δ bezieht sich auf die erste Serie">
          <CompareTable series={series} />
          <Footnote>
            &bdquo;Gesamt&ldquo; ist bei Mengen die Summe und bei Quoten die gewichtete Quote über den ganzen Zeitraum
            (Summe ÷ Summe) — nicht der Mittelwert der Perioden-Quoten, in dem ein Tag mit einem Termin so viel
            zählte wie einer mit vierzig. &bdquo;Ø je Periode&ldquo; gibt es deshalb nur für Mengen. Die Personen-Achse
            ist überall dieselbe: bei Terminen die zuständige Person (Zuweisung vor Ersteller), bei DMs und
            Anwahlen der Besitzer der Liste.
          </Footnote>
        </AnalyseSection>
      </div>
    </div>
  );
}
