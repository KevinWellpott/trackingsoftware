import type { CSSProperties, ReactNode } from "react";
import { LineChart, Scale, Users } from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { loadClosingCalls, loadSettingCalls, type AnalyseSettingCall } from "@/lib/analyseData";
import { personOf } from "@/lib/personResolution";
import {
  CHANNELS, CHANNEL_NO_VOLUME, channelOf, channelVolumeLabel, hasVolume,
  type Channel, type ChannelKey,
} from "@/lib/channels";
import {
  NUM, bucketOf, buildBuckets, closingEffDate, eur, fmtPct, ownerKey, pct, settingEffDate,
  type Granularity,
} from "@/lib/analyse";
import { AnalyseSection, MigrationHint } from "@/components/analyse/AnalyseSection";
import { ComparisonTable, type ComparisonRow } from "@/components/analyse/ComparisonTable";
import { CumulativeProgressChart } from "@/components/analyse/CumulativeProgressChart";

// Übersicht: eine GROBE Übersicht über den ganzen Funnel — „wie lief es im
// Zeitraum XY absolut". Keine Ursachenforschung, das machen die Fach-Tabs.
//
// Aufbau von oben nach unten:
//   1. Kanal-Matrix — sechs Kennzahlen als Zeilen, Kanäle + Gesamt als Spalten
//   2. kumulierter Verlauf des gemeinsamen Termin-Funnels
//   3. Personen-Tabelle
//
// ── Warum so wenig? ─────────────────────────────────────────────────────────
//
// Vorher standen dieselben sechs Zahlen FÜNFMAL auf dieser Seite: als zwölf
// KPI-Kacheln (zwei Kanalblöcke à sechs), als zwölf Balken im Kanalvergleich,
// als Trichterstufen, in der Gesamtzeile der Personentabelle und als Endpunkte
// der Verlaufskurven — 36 Zahlenträger für sechs Kennzahlen. Wiederholung
// schafft keine Übersicht, sie kostet Scrollweg und zwingt zum Vergleich über
// 300 px Abstand hinweg (die Kachel „Show-Quote LinkedIn" stand eine ganze
// Bildschirmhöhe von „Show-Quote Telefon" entfernt).
//
// Kacheln UND Balken sind deshalb zu EINER Matrix zusammengefallen. Dieselben
// Zahlen, ein Drittel der Höhe — und die Kanäle stehen erstmals nebeneinander
// statt untereinander. Das ist der ursprüngliche Wunsch („visueller direkter
// Vergleich von beiden Kanälen"), den zwei getrennte Kachelreihen nie erfüllen
// konnten: Eine Tabellenzeile IST der Vergleich.
//
// ── Warum der Gesamt-Trichter gelöscht ist ─────────────────────────────────
//
// Es gab hier einen Trichter „Alle Kanäle zusammen" — und es gibt einen zweiten
// im Funnel-Tab. Beide zählen systematisch anders: hier fünf Stufen in
// PERIODENsicht (jede Stufe auf ihrem eigenen Datum), dort sechs Stufen in
// KOHORTENsicht (Closings folgen ihrem Setting). Zwei optisch gleiche Trichter
// mit verschiedenen Zahlen beschädigen das Vertrauen in beide — man weiß nicht
// mehr, welcher lügt. Der alte Kommentar an dieser Sektion begründete den
// zugeklappten Startzustand bereits damit, dass alle Werte darüber ohnehin
// schon stehen; das ist die Begründung fürs Löschen, nicht fürs Zuklappen.
//
// Die Stufe „Mit Ergebnis" ist damit mit verschwunden. Sie war ohnehin kein
// Funnelschritt, sondern der NENNER der Show-Quote — ablesbar bleibt sie als
// Unterzeile in der Show-Quote-Zelle („31 von 44").
//
// ── Warum keine Leitkachel ─────────────────────────────────────────────────
//
// `KpiHero` kann mit `lead` genau eine Zahl auszeichnen (größere Ziffer auf
// Glasfläche). Hier bleibt keine Kachel übrig, die das tragen könnte: Jede der
// sechs Kennzahlen steht in der Matrix bereits je Kanal UND als Gesamtwert —
// eine Kachel darüber wäre das dritte Vorkommen derselben Zahl. Die Rolle des
// Blickfangs übernimmt die Gesamt-Zelle der Umsatz-Zeile (600er Gewicht,
// Erfolgs-Ton). Ein Blickfang, keine Kopie.
//
// ── Zwei Regeln, an denen dieser Tab vorher scheiterte ───────────────────────
//
// (a) KEINE „Kontaktpunkte". Die alte Leitkachel addierte DMs und Erstkontakte
//     zu einer Zahl. 341 stand da wie 341 DMs, war aber die Summe zweier völlig
//     verschiedener Tätigkeiten mit völlig verschiedenen Quoten. Die Regel lebt
//     an zwei Stellen weiter: `ZERO_TOTAL()` friert `volumen` im Gesamtsatz auf
//     `null` ein (es gibt keine Stelle, an der die Summe entstehen KÖNNTE), und
//     die Volumen-Zeile trägt `noTotal` — ihre Gesamt-Zelle sagt „nicht
//     addierbar" statt eine Zahl zu zeigen. Addiert wird erst ab dem Termin, wo
//     beide Kanäle dasselbe Objekt erzeugen (`setting_calls`).
//
// (b) „ABSOLUT im Zeitraum" heißt: der Termin FINDET im Zeitraum statt, nicht
//     „wurde im Zeitraum gebucht". Deshalb läuft jede Termin-Kennzahl über
//     `settingEffDate`/`closingEffDate` (Termindatum, ersatzweise Anlagedatum),
//     nie über `created_at`.
//
// Zwei Personenachsen laufen nebeneinander: Volumen (DMs/Erstkontakte) kommt
// aus den RPCs und hängt am `owner_name` der Liste, Termine/Abschlüsse an
// `personOf` (Zuweisung vor Ersteller, src/lib/personResolution.ts).

type Member = { user_id: string; username: string };

const INT = new Intl.NumberFormat("de-DE");
const DEC1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const OHNE = "Ohne Zuordnung";

/** "2026-07-31" → "31.07.2026" (ohne Date-Parsing, kein UTC-Tagessprung). */
function deDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// ── Bausteine für die Info-Popover ───────────────────────────
// Die Erklärtexte standen früher als <Footnote> unter jeder Sektion. Sie sind
// fachlich unverzichtbar (Nenner, Kohorten, Datenlücken), beim täglichen Lesen
// aber im Weg — deshalb hängen sie jetzt am `info`-Prop der Sektion.

/**
 * Absätze im Popover. Grid mit Gap statt <p>-Rändern: Ränder des ersten und
 * letzten Absatzes addierten sich sonst auf das Padding des Popovers.
 */
function InfoBody({ children }: { children: ReactNode }) {
  return <div style={{ display: "grid", gap: "var(--sp-4)" }}>{children}</div>;
}

/**
 * Hervorhebung im Fließtext. Eigenes <strong>, weil der Browser-Default 700
 * wiegt — über der Obergrenze des Design-Systems (max. 600).
 */
function B({ children }: { children: ReactNode }) {
  return <strong style={{ fontWeight: 600 }}>{children}</strong>;
}

// Nur die Spalten, die dieser Tab liest. Die RPCs liefern mehr (Antworten,
// Termine, Gatekeeper …) — die Termin-Stufen kommen hier aber aus
// `setting_calls`, weil nur die den Kanal und das Termindatum kennen.
type OwnerDayRow = { owner_name: string | null; day: string; dms: number | string | null };
type PhoneDayRow = { owner_name: string | null; day: string; calls: number | string | null };

/**
 * Woran das Volumen dieses Kanals hängt — für den Erklärtext der Matrix.
 *
 * „Erstkontakte", nicht „Anwahlen": Die Stufe zählt FIRMEN mit erstem Anruf
 * (`phone_leads.first_call_at`), nicht Wählversuche. Das Wort „Anwahlen" ist
 * seit dem Anruf-Log für die Ereignis-Ebene reserviert (siehe Kommentar an
 * `ChannelVolume` in src/lib/channels.ts).
 */
const VOLUME_NOTE: Partial<Record<ChannelKey, string>> = {
  linkedin: "DMs zählen am Pitch-Tag.",
  telefon: "Erstkontakte zählen am Tag des ersten Anrufs.",
};

/**
 * DB-Wert → Registry-Schlüssel. Unbekannte oder leere Werte landen bei
 * "sonstige" — genau der Topf, in den `channelLabel()` sie ohnehin beschriftet.
 */
function channelKeyOf(source: string | null | undefined): ChannelKey {
  return channelOf(source)?.key ?? "sonstige";
}

// ── Kennzahl-Satz je Kanal ───────────────────────────────────
/**
 * Die sechs Stufen aus der Vorgabe plus die beiden Nenner, aus denen sich die
 * Quoten ergeben. Ein Satz für Kanäle UND für die Gesamtsumme — dieselbe Form
 * heißt: Eine Matrix-Zeile kann Kanal- und Gesamtspalte mit derselben Funktion
 * lesen, und die Spalten können gar nicht auseinanderlaufen.
 */
type ChannelStats = {
  /**
   * Akquise-Volumen (DMs/Erstkontakte). `null` = für diesen Kanal gibt es diese
   * Stufe strukturell nicht (Ads, Social Media, Sonstige starten beim Termin)
   * — angezeigt als „—", nie als 0. Eine 0 läse sich wie „nichts getan".
   */
  volumen: number | null;
  termine: number;
  /** Termine mit gesetztem `show_status` — der Nenner der Show-Quote. */
  entschieden: number;
  shows: number;
  quali: number;
  closings: number;
  revenue: number;
};

const ZERO_STATS = () => ({ termine: 0, entschieden: 0, shows: 0, quali: 0, closings: 0, revenue: 0 });

/** Kennzahl-Satz eines Kanals; ob es ein Volumen gibt, entscheidet die Registry. */
const ZERO_CHANNEL = (key: string): ChannelStats => ({ volumen: hasVolume(key) ? 0 : null, ...ZERO_STATS() });

/**
 * Gesamtsatz über alle Kanäle. `volumen` bleibt hier für immer `null` — das ist
 * Regel (a) vom Kopf dieser Datei, in den Typ gegossen: es gibt keine Stelle im
 * Code, an der DMs und Erstkontakte zu einer Zahl werden könnten.
 */
const ZERO_TOTAL = (): ChannelStats => ({ volumen: null, ...ZERO_STATS() });

/**
 * Show-Quote — die Definition dieses Tabs.
 *
 * Zähler: Termine mit `show_status='show'`. Nenner: Termine mit ERFASSTEM
 * Ergebnis (show oder no_show). Noch offene Termine stehen in keinem von
 * beiden; in einem laufenden Zeitraum liegt die Hälfte der Termine noch in der
 * Zukunft, und die zählten sonst wie Nichterscheinen.
 *
 * Bewusst NICHT (mehr) gegen `no_show_count`: dieser Zähler summiert EREIGNISSE
 * aus Neuterminierungen auf eine Menge von DATENSÄTZEN — Zähler und Nenner
 * hatten verschiedene Einheiten, und die gezählten Ereignisse lagen teils vor
 * dem Zeitraum. Beides verträgt sich nicht mit „absolut im Zeitraum".
 */
function showRateOf(s: ChannelStats): number | null {
  return pct(s.shows, s.entschieden);
}

/** Quali-Quote — Definition 1:1 aus dem Setting-Tab (`isQualified` / shows). */
function qualiRateOf(s: ChannelStats): number | null {
  return pct(s.quali, s.shows);
}

/** Ein Setting gilt als qualifiziert, wenn der Lead da war und es weiterging. */
function isQualified(r: AnalyseSettingCall): boolean {
  return r.show_status === "show" && (r.status === "qualifiziert" || r.status === "closing_gelegt");
}

/** Verbucht einen Termin in einem Kennzahl-Satz (Kanal oder Gesamt). */
function addSetting(t: ChannelStats, r: AnalyseSettingCall): void {
  t.termine += 1;
  // `show_status` ist bei "offen"/"dead" bewusst NULL (docs §4) — solche
  // Termine haben schlicht noch kein Ergebnis und gehören in keine Quote.
  if (r.show_status) t.entschieden += 1;
  if (r.show_status === "show") t.shows += 1;
  if (isQualified(r)) t.quali += 1;
}

/** %-Änderung vs. Vorperiode; Vorwert 0 → null (kein Wachstum aus dem Nichts). */
function deltaPct(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

/** Prozentpunkt-Differenz zweier Quoten; fehlende Basis → null. */
function ppDelta(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null) return null;
  return Math.round((cur - prev) * 10) / 10;
}

// ── Kanal-Matrix ─────────────────────────────────────────────
// Kennzahlen als Zeilen, Kanäle + Gesamt als Spalten. Ersetzt zwei
// Kachelblöcke UND den Balken-Kanalvergleich: dieselben Zahlen, dieselbe
// Aussage, aber der Vergleich zweier Kanäle ist ein Blick nach rechts statt
// ein Scroll über eine Bildschirmhöhe.
//
// Warum Tabelle statt Balken: Die sechs Kennzahlen haben drei Einheiten (Menge,
// Prozent, Euro) und Größenordnungen von 12 bis 340. Eine gemeinsame Balken-
// skala gibt es dafür nicht — die Balkenfassung skalierte deshalb je Stufe neu,
// was jede Stufe zu einem eigenen Diagramm machte. Ein Balken, der nur mit
// seinen zwei Nachbarn vergleichbar ist, ist eine teure Zahl. Zahlen mit
// tabular-nums untereinander leisten dasselbe auf einem Viertel der Fläche.

type MetricFmt = "int" | "pct" | "eur";

type MatrixMetric = {
  key: string;
  label: string;
  fmt: MetricFmt;
  /** Wert aus einem Kennzahl-Satz — dieselbe Funktion für Kanal und Gesamt. */
  of: (s: ChannelStats) => number | null;
  /** Einheit hinter der Zahl; nur die Volumen-Zeile hat je Kanal eine eigene. */
  unitOf?: (c: Channel) => string | null;
  /** Zähler/Nenner unter der Zahl — erst damit ist eine Quote überprüfbar. */
  note?: (s: ChannelStats) => string | null;
  /** `true` = eine Summe wäre sachlich falsch (Regel (a) im Dateikopf). */
  noTotal?: boolean;
  /** Erfolgs-Ton in der Gesamt-Zelle — genau einmal vergeben (Umsatz). */
  accentTotal?: boolean;
};

/**
 * Die sechs Zeilen. Reihenfolge = Funnel-Reihenfolge: was man tut, was daraus
 * wird, wie gut es lief, was am Ende herauskommt.
 */
const METRICS: MatrixMetric[] = [
  {
    key: "volumen",
    label: "Akquise-Volumen",
    fmt: "int",
    of: (s) => s.volumen,
    // Einheit aus der Registry, nicht aus einer Liste hier: Telefon heißt
    // „Erstkontakte" (Firmen mit erstem Anruf), nicht „Anwahlen" (Wählversuche).
    unitOf: (c) => channelVolumeLabel(c.key),
    noTotal: true,
  },
  { key: "termine", label: "Settingtermine", fmt: "int", of: (s) => s.termine },
  {
    key: "show",
    label: "Show-Quote",
    fmt: "pct",
    of: showRateOf,
    // Erbt die Rolle der gelöschten Trichterstufe „Mit Ergebnis": ohne den
    // Nenner ist „100 %" bei einem einzigen Termin nicht von echten 100 %
    // unterscheidbar.
    note: (s) => (s.entschieden === 0 ? null : `${INT.format(s.shows)} von ${INT.format(s.entschieden)}`),
  },
  {
    key: "quali",
    label: "Quali-Quote",
    fmt: "pct",
    of: qualiRateOf,
    note: (s) => (s.shows === 0 ? null : `${INT.format(s.quali)} von ${INT.format(s.shows)}`),
  },
  { key: "closings", label: "Closingtermine", fmt: "int", of: (s) => s.closings },
  { key: "umsatz", label: "Umsatz", fmt: "eur", of: (s) => s.revenue, accentTotal: true },
];

function fmtMetric(v: number | null, fmt: MetricFmt): string {
  if (v === null) return CHANNEL_NO_VOLUME;
  if (fmt === "pct") return fmtPct(v);
  if (fmt === "eur") return eur(v);
  return INT.format(v);
}

// Kopfzeile identisch zu ComparisonTable/MetricTable (COMPONENTS.md §6) — die
// Personen-Tabelle steht auf derselben Seite darunter, zwei Kopfzeilen-Stile
// läsen sich als zwei Systeme.
const HEAD_STYLE: CSSProperties = {
  height: "var(--h-row)",
  fontSize: "var(--fs-xs)",
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "var(--ls-eyebrow)",
  color: "var(--text-muted)",
  padding: "0 var(--sp-5)",
  background: "var(--surface-1)",
  whiteSpace: "nowrap",
};

const CELL_PAD = "var(--sp-4) var(--sp-5)";

const VALUE_CELL: CSSProperties = {
  padding: CELL_PAD,
  textAlign: "right",
  verticalAlign: "top",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

/**
 * Vorperioden-Veränderung als kleine Zeile unter dem Wert.
 *
 * Kein Delta-Chip wie auf den alten Kacheln: 18 gefüllte Pillen in einer
 * Tabelle sind ein Muster, kein Wert. Vorzeichen + Einheit tragen die Aussage,
 * die Farbe verstärkt sie nur (nie Farbe allein). `null` erzeugt gar keine
 * Zeile — eine Zeile mit „—" wäre eine Behauptung über nichts.
 */
function DeltaLine({ value, unit }: { value: number | null; unit: "%" | "pp" }) {
  if (value === null) return null;
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  const color =
    value === 0 ? "var(--text-subtle)" : value > 0 ? "var(--success-fg)" : "var(--danger-fg)";
  return (
    <span
      style={{
        display: "block",
        marginTop: 2,
        fontSize: "var(--fs-2xs)",
        fontWeight: 500,
        color,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {sign}
      {DEC1.format(Math.abs(value))} {unit}
    </span>
  );
}

function MatrixCell({
  metric,
  cur,
  prev,
  unit,
  total = false,
}: {
  metric: MatrixMetric;
  cur: ChannelStats;
  prev: ChannelStats;
  /** Einheit hinter der Zahl (nur Volumen-Zeile). */
  unit?: string | null;
  /** Gesamt-Spalte: kräftigeres Gewicht, und `noTotal` greift nur hier. */
  total?: boolean;
}) {
  if (total && metric.noTotal) {
    return (
      <td style={VALUE_CELL}>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>nicht addierbar</span>
      </td>
    );
  }

  const v = metric.of(cur);
  const p = metric.of(prev);
  // Quoten vergleichen sich in Prozentpunkten, Mengen und Euro relativ. Eine
  // Show-Quote, die von 40 % auf 44 % steigt, ist „+4 pp" — „+10 %" wäre zwar
  // rechnerisch richtig, meint aber etwas anderes.
  const delta = metric.fmt === "pct" ? ppDelta(v, p) : v === null || p === null ? null : deltaPct(v, p);
  const note = v === null ? null : (metric.note?.(cur) ?? null);

  return (
    <td style={VALUE_CELL}>
      <span
        style={{
          fontSize: "var(--fs-base)",
          fontWeight: total ? 600 : 500,
          color:
            v === null
              ? "var(--text-subtle)"
              : // Erfolgs-Ton nur, wenn auch etwas da ist: ein grünes „0 €"
                // behauptet einen Erfolg, den es nicht gibt.
                total && metric.accentTotal && v > 0
                ? "var(--success-fg)"
                : "var(--text-primary)",
        }}
      >
        {fmtMetric(v, metric.fmt)}
        {v !== null && unit && (
          <span style={{ fontWeight: 400, color: "var(--text-subtle)" }}> {unit}</span>
        )}
      </span>
      {note && (
        <span style={{ display: "block", marginTop: 2, fontSize: "var(--fs-2xs)", color: "var(--text-subtle)" }}>
          {note}
        </span>
      )}
      <DeltaLine value={delta} unit={metric.fmt === "pct" ? "pp" : "%"} />
    </td>
  );
}

function ChannelMatrix({
  channels,
  cur,
  prv,
  curAll,
  prvAll,
}: {
  channels: Channel[];
  cur: Map<string, ChannelStats>;
  prv: Map<string, ChannelStats>;
  curAll: ChannelStats;
  prvAll: ChannelStats;
}) {
  const statsOf = (m: Map<string, ChannelStats>, key: string): ChannelStats =>
    m.get(key) ?? ZERO_CHANNEL(key);

  return (
    <div className="table-scroll" style={{ overflowX: "auto" }}>
      <table style={{ minWidth: 640, width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...HEAD_STYLE, textAlign: "left" }}>Kennzahl</th>
            {channels.map((c) => (
              <th key={c.key} style={{ ...HEAD_STYLE, textAlign: "right" }}>
                {/* Kanal-Dot (COMPONENTS.md §4.3): dieselbe Registry-Farbe wie
                    im Verlaufs-Chart und in den Fach-Tabs. */}
                <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}>
                  <span
                    aria-hidden
                    style={{ width: 8, height: 8, borderRadius: "50%", background: c.color, flexShrink: 0 }}
                  />
                  {c.label}
                </span>
              </th>
            ))}
            <th style={{ ...HEAD_STYLE, textAlign: "right", color: "var(--text-secondary)" }}>Gesamt</th>
          </tr>
        </thead>
        <tbody>
          {METRICS.map((m) => (
            <tr key={m.key} className="funnel-matrix-row" style={{ borderTop: "1px solid var(--border-subtle)" }}>
              <th
                scope="row"
                style={{
                  padding: CELL_PAD,
                  textAlign: "left",
                  verticalAlign: "top",
                  fontSize: "var(--fs-base)",
                  fontWeight: 500,
                  color: "var(--text-primary)",
                  whiteSpace: "nowrap",
                }}
              >
                {m.label}
              </th>
              {channels.map((c) => (
                <MatrixCell
                  key={c.key}
                  metric={m}
                  cur={statsOf(cur, c.key)}
                  prev={statsOf(prv, c.key)}
                  unit={m.unitOf?.(c) ?? null}
                />
              ))}
              <MatrixCell metric={m} cur={curAll} prev={prvAll} total />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Personen-Achse ───────────────────────────────────────────
/**
 * Bewusst nur fünf Zahlen je Person: Input (DMs, Erstkontakte), das gemeinsame
 * Ergebnis beider Kanäle (Termine) und das Resultat (Gewonnen, Umsatz).
 *
 * „Shows" und „Closings" sind raus. Shows ohne seinen Nenner beantwortet
 * nichts — 12 Shows sind bei 14 Terminen stark und bei 40 Terminen ein Problem,
 * und die Show-Quote steht eine Sektion höher je Kanal. Closings ist eine
 * Zwischenstufe direkt neben „Gewonnen" und „Umsatz": Wer viele Closings und
 * keinen Umsatz hat, fällt in genau diesen beiden Spalten auf. Was bleibt, löst
 * eine Handlung aus (mehr Akquise / mehr Termine / Abschlussgespräche üben).
 */
type Person = {
  dms: number;
  calls: number;
  termine: number;
  won: number;
  revenue: number;
};

const ZERO_PERSON = (): Person => ({ dms: 0, calls: 0, termine: 0, won: 0, revenue: 0 });

export async function UebersichtTab({
  access,
  from,
  to,
  prevFrom,
  prevTo,
  granularity,
  selectedMembers,
  canCompare,
  allSelected,
}: {
  access: AccessContext;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  /**
   * Kommt aus dem gemeinsamen Prop-Bündel der Seite und wird hier nicht mehr
   * gebraucht, seit der Ziel-Abgleich (Soll/Ist) raus ist — der brauchte
   * „heute", um einem laufenden Monat nicht seine Zukunft als Rückstand
   * anzurechnen. Der Prop bleibt deklariert, damit `{...common}` weiter passt.
   */
  today?: string;
  granularity: Granularity;
  selectedMembers: Member[];
  canCompare: boolean;
  allSelected: boolean;
}) {
  const supabase = await createClient();
  const eff = canCompare ? null : access.user.id;
  const rpcArgs = { p_workspace_id: access.workspace_id, p_effective_user_id: eff };

  const [liRes, liPrevRes, phRes, phPrevRes, settings, closings] = await Promise.all([
    supabase.rpc("rpc_owner_day_metrics", { ...rpcArgs, p_from: from, p_to: to }),
    supabase.rpc("rpc_owner_day_metrics", { ...rpcArgs, p_from: prevFrom, p_to: prevTo }),
    supabase.rpc("rpc_phone_day_metrics", { ...rpcArgs, p_from: from, p_to: to }),
    supabase.rpc("rpc_phone_day_metrics", { ...rpcArgs, p_from: prevFrom, p_to: prevTo }),
    loadSettingCalls(supabase, access, canCompare),
    loadClosingCalls(supabase, access, canCompare),
  ]);

  if (liRes.error) {
    return <MigrationHint>Die Übersicht benötigt die Kennzahl-RPCs aus den Migrationen 0013/0015.</MigrationHint>;
  }

  const buckets = buildBuckets(from, to, granularity);

  const nameByKey = new Map<string, string>();
  for (const m of selectedMembers) nameByKey.set(ownerKey(m.username), m.username);
  const nameById = new Map(selectedMembers.map((m) => [m.user_id, m.username]));

  const people = new Map<string, Person>();
  const ensure = (name: string): Person => {
    let p = people.get(name);
    if (!p) {
      p = ZERO_PERSON();
      people.set(name, p);
    }
    return p;
  };
  for (const m of selectedMembers) ensure(m.username);

  // Aktuelles Fenster und Vorperiode laufen durch dieselben Schleifen; die
  // Fenster sind disjunkt, deshalb reicht ein Ziel-Container je Zeile.
  const cur = new Map<string, ChannelStats>();
  const prv = new Map<string, ChannelStats>();
  // Gesamtsummen beider Fenster. Der Vorperioden-Gesamtsatz existiert, seit die
  // Gesamt-Spalte der Matrix eine Veränderung zeigt — gerechnet wird er mit
  // denselben Funktionen wie `curAll`, nur auf dem anderen Fenster.
  const curAll = ZERO_TOTAL();
  const prvAll = ZERO_TOTAL();

  const statsIn = (m: Map<string, ChannelStats>, key: string): ChannelStats => {
    let s = m.get(key);
    if (!s) {
      s = ZERO_CHANNEL(key);
      m.set(key, s);
    }
    return s;
  };

  // Zuwächse je Bucket für den kumulierten Verlauf (die Kumulation macht die
  // Chart-Komponente selbst — sie kennt dadurch keine einzige Kennzahl).
  const termineByBucket: Record<string, number> = {};
  const showsByBucket: Record<string, number> = {};
  const closingsByBucket: Record<string, number> = {};

  // ── Akquise-Volumen aus den Tages-RPCs ───────────────────────
  // Die einzige Stelle, die nicht kanal-generisch sein kann: LinkedIn zählt in
  // `contacts`, Telefon in `phone_leads` — zwei Tabellen, zwei RPCs. Die
  // Registry sagt, OB ein Kanal ein Volumen hat; WOHER die Zahl kommt, steht
  // hier.
  const resolveOwner = (owner: string | null): string | null => {
    const hit = nameByKey.get(ownerKey(owner));
    if (hit) return hit;
    return allSelected ? OHNE : null;
  };

  const liVolume = statsIn(cur, "linkedin");
  const phVolume = statsIn(cur, "telefon");

  for (const r of (liRes.data ?? []) as OwnerDayRow[]) {
    const name = resolveOwner(r.owner_name);
    if (!name) continue;
    const dms = NUM(r.dms);
    ensure(name).dms += dms;
    liVolume.volumen = (liVolume.volumen ?? 0) + dms;
  }

  for (const r of (phRes.error ? [] : ((phRes.data ?? []) as PhoneDayRow[]))) {
    const name = resolveOwner(r.owner_name);
    if (!name) continue;
    const calls = NUM(r.calls);
    ensure(name).calls += calls;
    phVolume.volumen = (phVolume.volumen ?? 0) + calls;
  }

  const liPrevVolume = statsIn(prv, "linkedin");
  const phPrevVolume = statsIn(prv, "telefon");
  for (const r of (liPrevRes.error ? [] : ((liPrevRes.data ?? []) as OwnerDayRow[]))) {
    if (!resolveOwner(r.owner_name)) continue;
    liPrevVolume.volumen = (liPrevVolume.volumen ?? 0) + NUM(r.dms);
  }
  for (const r of (phPrevRes.error ? [] : ((phPrevRes.data ?? []) as PhoneDayRow[]))) {
    if (!resolveOwner(r.owner_name)) continue;
    phPrevVolume.volumen = (phPrevVolume.volumen ?? 0) + NUM(r.calls);
  }

  // ── Setting-Calls ────────────────────────────────────────────
  // Die Kanal-Zuordnung wird für ALLE Zeilen gemerkt, nicht nur für die im
  // Zeitraum: ein Closing im Zeitraum kann an einem Setting von vorletzter
  // Woche hängen und erbt von dort seinen Kanal.
  const settingChannel = new Map<string, ChannelKey>();

  for (const r of settings) {
    const ck = channelKeyOf(r.source_type);
    settingChannel.set(r.id, ck);

    const day = settingEffDate(r);
    // `nameById` kennt nur die ausgewählten Mitglieder — kein Treffer heißt
    // also "abgewählt" oder "nicht mehr in der Organisation".
    const uid = personOf(r);
    const name = uid ? nameById.get(uid) : undefined;
    if (!name && !allSelected) continue;

    const inPrev = day >= prevFrom && day <= prevTo;
    const inCur = day >= from && day <= to;
    if (!inPrev && !inCur) continue;

    addSetting(statsIn(inPrev ? prv : cur, ck), r);
    addSetting(inPrev ? prvAll : curAll, r);
    if (!inCur) continue;

    const p = ensure(name ?? OHNE);
    p.termine += 1;

    const bk = bucketOf(day, from, to, granularity);
    termineByBucket[bk] = (termineByBucket[bk] ?? 0) + 1;
    if (r.show_status === "show") showsByBucket[bk] = (showsByBucket[bk] ?? 0) + 1;
  }

  // ── Closing-Calls ────────────────────────────────────────────
  // Ohne `setting_call_id` (z. B. nach einem Org-Umzug gekappt) lässt sich kein
  // Kanal bestimmen — solche Closings zählen nur in der Gesamtspalte, sonst
  // wären sie einem Kanal angedichtet. Deshalb kann die Summe der Kanalspalten
  // kleiner sein als „Gesamt"; der Erklärtext der Matrix nennt die Zahl.
  let closingsOhneKanal = 0;

  for (const r of closings) {
    const day = closingEffDate(r);
    const uid = personOf(r);
    const name = uid ? nameById.get(uid) : undefined;
    if (!name && !allSelected) continue;

    const inPrev = day >= prevFrom && day <= prevTo;
    const inCur = day >= from && day <= to;
    if (!inPrev && !inCur) continue;

    const won = r.status === "gewonnen";
    const vol = won ? NUM(r.deal_volume) : 0;
    const ck = r.setting_call_id ? settingChannel.get(r.setting_call_id) : undefined;

    if (ck) {
      const s = statsIn(inPrev ? prv : cur, ck);
      s.closings += 1;
      s.revenue += vol;
    }
    const all = inPrev ? prvAll : curAll;
    all.closings += 1;
    all.revenue += vol;
    if (!inCur) continue;
    if (!ck) closingsOhneKanal += 1;

    const p = ensure(name ?? OHNE);
    if (won) {
      p.won += 1;
      p.revenue += vol;
    }

    const bk = bucketOf(day, from, to, granularity);
    closingsByBucket[bk] = (closingsByBucket[bk] ?? 0) + 1;
  }

  // ── Kanäle, die gezeigt werden ───────────────────────────────
  // Die beiden Akquise-Kanäle stehen immer da — sie SIND der Vergleich, auch
  // wenn einer im Zeitraum bei null liegt. Alle übrigen erscheinen, sobald sie
  // im Zeitraum etwas beitragen; so wächst die Matrix mit Ads, Social Media
  // & Co. mit, ohne heute vier leere Spalten zu zeigen.
  const volumeChannels: Channel[] = CHANNELS.filter((c) => c.volume !== null);
  const matrixChannels: Channel[] = CHANNELS.filter((c) => {
    if (c.volume !== null) return true;
    const s = cur.get(c.key);
    return s != null && (s.termine > 0 || s.closings > 0 || s.revenue > 0);
  });

  // ── Personen-Tabelle ─────────────────────────────────────────
  const names = selectedMembers.map((m) => m.username);
  const ohne = people.get(OHNE);
  // Die Prüfung nennt genau die Spalten, die die Tabelle zeigt: Eine Zeile
  // „Ohne Zuordnung" mit fünf Nullen wäre eine Zeile über nichts.
  if (ohne && (ohne.dms > 0 || ohne.calls > 0 || ohne.termine > 0 || ohne.won > 0 || ohne.revenue > 0)) {
    names.push(OHNE);
  }

  const personRows: ComparisonRow[] = names.map((name) => {
    const p = people.get(name) ?? ZERO_PERSON();
    return {
      name,
      values: { dms: p.dms, calls: p.calls, termine: p.termine, won: p.won, revenue: p.revenue },
    };
  });

  // Fußzeile der Personen-Tabelle: die Summe über die gezeigten Zeilen, nicht
  // die Kanal-Gesamtsumme — sonst stünde dort mehr, als in der Tabelle steht.
  const personTotal = { dms: 0, calls: 0, termine: 0, won: 0, revenue: 0 };
  for (const name of names) {
    const p = people.get(name) ?? ZERO_PERSON();
    personTotal.dms += p.dms;
    personTotal.calls += p.calls;
    personTotal.termine += p.termine;
    personTotal.won += p.won;
    personTotal.revenue += p.revenue;
  }

  const rangeLabel = `${deDate(from)} – ${deDate(to)}`;
  const volumeNotes = volumeChannels.map((c) => VOLUME_NOTE[c.key]).filter(Boolean).join(" ");

  return (
    <>
      {/* ══ 1 · Kanal-Matrix ══
          Bleibt offen: Das ist der Tab. Alles, was hier früher als Kacheln,
          Balken und Trichter dreimal stand, steht jetzt einmal. */}
      <div className="fade-up">
        <AnalyseSection
          title="Kanäle im direkten Vergleich"
          icon={Scale}
          meta={rangeLabel}
          collapsible
          info={
            <InfoBody>
              <span>
                {volumeNotes} Settingtermine, Closingtermine und Umsatz zählen dagegen an ihrem eigenen Termindatum —
                sie <em>finden</em> im Zeitraum statt, unabhängig davon, wann sie gebucht wurden.
              </span>
              <span>
                <B>Show-Quote</B> = Termine mit &bdquo;erschienen&ldquo; ÷ Termine mit erfasstem Ergebnis; die kleine
                Zeile darunter nennt beide Zahlen. Noch offene Termine stehen in keiner von beiden, sonst sähe jeder
                laufende Zeitraum wie ein Einbruch aus. <B>Quali-Quote</B> = qualifizierte Termine ÷ Shows
                (erschienen <em>und</em> Status &bdquo;qualifiziert&ldquo;/&bdquo;Closing gelegt&ldquo;), Definition
                wie im Setting-Tab.
              </span>
              <span>
                Die kleine farbige Zeile in jeder Zelle ist die Veränderung zur Vorperiode: Mengen und Umsatz relativ
                in %, Quoten in Prozentpunkten (pp). Ohne Vergleichswert steht dort nichts.
              </span>
              <span>
                Kanäle ohne eigene Akquise (Ads, Social Media, Sonstige) zeigen beim Volumen &bdquo;—&ldquo; statt 0 —
                dort beginnt der Funnel erst beim Termin. Addiert wird das Volumen nie: DMs und Erstkontakte sind zwei
                verschiedene Tätigkeiten, ihre Summe wäre eine Zahl ohne Einheit.
              </span>
              <span>
                Zu welchem Kanal ein Termin gehört, entscheidet seine Quelle (<code>setting_calls.source_type</code>);
                Abschlüsse erben den Kanal von ihrem Settingtermin.
                {closingsOhneKanal > 0 && (
                  <>
                    {" "}
                    {INT.format(closingsOhneKanal)} Closing(s) im Zeitraum haben keinen Settingtermin mehr und stehen
                    deshalb nur in der Gesamt-Spalte — die Kanalspalten ergeben zusammen weniger als &bdquo;Gesamt&ldquo;.
                  </>
                )}
              </span>
            </InfoBody>
          }
        >
          <ChannelMatrix channels={matrixChannels} cur={cur} prv={prv} curAll={curAll} prvAll={prvAll} />
        </AnalyseSection>
      </div>

      {/* ══ 2 · Verlauf ══
          Startet zu: Der Verlauf beantwortet „wann im Zeitraum lief was" —
          eine Detailfrage. Die Endstände derselben Serien stehen oben. */}
      <div className="fade-up" style={{ animationDelay: "60ms" }}>
        <AnalyseSection
          title="Fortschritt im Zeitraum"
          icon={LineChart}
          meta="kumuliert"
          collapsible
          defaultOpen={false}
        >
          <CumulativeProgressChart
            buckets={buckets}
            // Drei Serien statt sechs. DMs, Erstkontakte und Umsatz sind raus:
            // Sie liegen um den Faktor 10 bis 1.000 über den Terminzahlen — in
            // einer gemeinsamen Achse wird jede Terminkurve zur Nulllinie, und
            // die Umschalterei, mit der man das umging, war Arbeit für den
            // Leser. Was bleibt, ist der gemeinsame Termin-Funnel: drei Serien
            // derselben Größenordnung, die man ohne Klick zusammen liest.
            // Akquise-Volumen und Umsatz im Verlauf zeigen die Kanal-Tabs.
            series={[
              { key: "termine", label: "Settingtermine", kind: "count", values: termineByBucket, defaultOn: true },
              { key: "shows", label: "Shows", kind: "count", values: showsByBucket, defaultOn: true },
              { key: "closings", label: "Closingtermine", kind: "count", values: closingsByBucket, defaultOn: true },
            ]}
            rangeLabel={rangeLabel}
            note="Jede Stufe zählt an ihrem eigenen Termindatum — ein Closing dieser Woche kann zu einem Termin von letztem Monat gehören. Die Kurven laufen deshalb nebeneinander her, sie sind keine Kohorte."
          />
        </AnalyseSection>
      </div>

      {/* ══ 3 · Personen ══ */}
      {canCompare && (
        <div className="fade-up" style={{ animationDelay: "120ms" }}>
          {/* Bleibt offen: die zweite Kernachse dieses Tabs (Kanal × Person).
              Wer die Übersicht als Teamleitung öffnet, sucht genau diese
              Tabelle. */}
          <AnalyseSection
            title="Personen"
            icon={Users}
            meta="Akquise → Termin → Abschluss"
            collapsible
            info={
              <InfoBody>
                <span>
                  DMs und Erstkontakte hängen am Besitzer der Liste, Termine und Abschlüsse an der Zuweisung des
                  Termins.
                </span>
                <span>
                  Wer den Datensatz angelegt hat, zählt nur, solange keine Zuweisung gesetzt ist — ein Termin, den
                  jemand für eine Kollegin bucht, zählt bei ihr.
                </span>
                <span>
                  Fünf Spalten mit Absicht: zwei für den Einsatz, eine für das gemeinsame Ergebnis beider Kanäle, zwei
                  für das Resultat. <B>Shows</B> und <B>Closings</B> standen hier früher dazwischen — Shows ohne seinen
                  Nenner sagt nichts (12 von 14 ist stark, 12 von 40 ist ein Problem), und Closings ist die Stufe
                  direkt vor &bdquo;Gewonnen&ldquo;. Die Show-Quote je Kanal steht in der Matrix oben.
                </span>
              </InfoBody>
            }
          >
            <ComparisonTable
              columns={[
                { key: "dms", label: "DMs", format: "int" },
                { key: "calls", label: "Erstkontakte", format: "int" },
                { key: "termine", label: "Termine", format: "int" },
                { key: "won", label: "Gewonnen", format: "int" },
                { key: "revenue", label: "Umsatz", format: "eur" },
              ]}
              rows={personRows}
              average={personTotal}
              averageLabel="Gesamt"
            />
          </AnalyseSection>
        </div>
      )}
    </>
  );
}
