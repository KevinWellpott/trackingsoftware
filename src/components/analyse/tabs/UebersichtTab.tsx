import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity, BadgeCheck, CalendarCheck, Euro, Eye, Handshake, Layers, LineChart,
  Megaphone, MessageSquare, Phone, Scale, Share2, Users,
} from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { loadClosingCalls, loadSettingCalls, type AnalyseSettingCall } from "@/lib/analyseData";
import { personOf } from "@/lib/personResolution";
import {
  CHANNELS, CHANNEL_NO_VOLUME, channelOf, hasVolume, type Channel, type ChannelKey,
} from "@/lib/channels";
import {
  NUM, bucketOf, buildBuckets, closingEffDate, eur, fmtPct, ownerKey, pct, settingEffDate,
  type Granularity,
} from "@/lib/analyse";
import { AnalyseSection, MigrationHint } from "@/components/analyse/AnalyseSection";
import { ComparisonTable, type ComparisonRow } from "@/components/analyse/ComparisonTable";
import { BarFunnel, KpiHero, KpiRow } from "@/components/analyse/AnalyseViz";
import { CumulativeProgressChart } from "@/components/analyse/CumulativeProgressChart";

// Übersicht: eine GROBE Übersicht über den ganzen Funnel — „wie lief es im
// Zeitraum XY absolut". Keine Ursachenforschung, das machen die Fach-Tabs.
//
// Der Aufbau folgt der Vorgabe des Auftraggebers, von oben nach unten:
//   1. je Akquise-Kanal ein KPI-Block mit denselben sechs Stufen
//   2. dieselben Stufen als Chart, beide Kanäle nebeneinander
//   3. Gesamtübersicht über alle Kanäle
//   4. kumulierter Verlauf (Progress)
//   5. Personen-Tabelle
//
// ── Zwei Regeln, an denen dieser Tab vorher scheiterte ───────────────────────
//
// (a) KEINE „Kontaktpunkte". Die alte Leitkachel addierte DMs und Anwahlen zu
//     einer Zahl. 341 stand da wie 341 DMs, war aber die Summe zweier völlig
//     verschiedener Tätigkeiten mit völlig verschiedenen Quoten. Die Kanäle
//     stehen jetzt getrennt nebeneinander; addiert wird erst ab dem Termin,
//     wo beide Kanäle dasselbe Objekt erzeugen (`setting_calls`).
//
// (b) „ABSOLUT im Zeitraum" heißt: der Termin FINDET im Zeitraum statt, nicht
//     „wurde im Zeitraum gebucht". Deshalb läuft jede Termin-Kennzahl über
//     `settingEffDate`/`closingEffDate` (Termindatum, ersatzweise Anlagedatum),
//     nie über `created_at`.
//
// Zwei Personenachsen laufen nebeneinander: Volumen (DMs/Anwahlen) kommt aus
// den RPCs und hängt am `owner_name` der Liste, Termine/Closings an `personOf`
// (Zuweisung vor Ersteller, src/lib/personResolution.ts).

type Member = { user_id: string; username: string };

const INT = new Intl.NumberFormat("de-DE");
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

// ── Kanal-Beschriftungen ─────────────────────────────────────
// Die Registry führt bewusst nur eine KURZE Stufen-Beschriftung ("DMs" /
// "Calls") — die passt in eine Chart-Achse. Auf einer allein stehenden Kachel
// braucht es die ausformulierte Fassung, und der Auftraggeber hat sie wörtlich
// vorgegeben. Deshalb hier ein OPTIONALER Aufsatz: fehlt ein Kanal in dieser
// Tabelle, greift `volume.stageLabel` aus der Registry — ein neuer Kanal
// braucht hier also nichts.
const VOLUME_KPI_LABEL: Partial<Record<ChannelKey, string>> = {
  linkedin: "DMs rausgeschickt",
  telefon: "Anwahlen",
};

/** Woran das Volumen dieses Kanals hängt — für die Fußnote unter dem Block. */
const VOLUME_NOTE: Partial<Record<ChannelKey, string>> = {
  linkedin: "DMs zählen am Pitch-Tag.",
  telefon: "Anwahlen zählen am Tag des Erstkontakts.",
};

/** Rein dekorativ; unbekannte Kanäle bekommen das Sammel-Icon. */
const CHANNEL_ICON: Partial<Record<ChannelKey, LucideIcon>> = {
  linkedin: MessageSquare,
  telefon: Phone,
  social_media: Share2,
  ads: Megaphone,
};

function volumeUnit(c: Channel): string | null {
  return VOLUME_KPI_LABEL[c.key] ?? c.volume?.stageLabel ?? null;
}

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
 * heißt: was im Kanalvergleich steht, steht in der Gesamtübersicht genauso.
 */
type ChannelStats = {
  /**
   * Akquise-Volumen (DMs/Anwahlen). `null` = für diesen Kanal gibt es diese
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
 * Code, an der DMs und Anwahlen zu einer Zahl werden könnten.
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

// ── Kanalvergleich (Chart) ───────────────────────────────────
// Eine Stufe = ein Block, darin ein Balken je Kanal. Bewusst nicht als
// gruppiertes Recharts-Balkendiagramm: die sechs Stufen haben drei Einheiten
// (Menge, Prozent, Euro) und Größenordnungen von 12 bis 340. In einer
// gemeinsamen Skala wären fünf der sechs Stufen platte Nulllinien. Skaliert
// wird deshalb INNERHALB der Stufe — und genau dort findet der Vergleich statt,
// den der Auftraggeber sehen will („Telefon vs. LinkedIn auf derselben Stufe").

type StageFormat = "int" | "pct" | "eur";

type CompareStage = {
  key: string;
  label: string;
  format: StageFormat;
  /** Wert eines Kanals; `null` = für diesen Kanal strukturell nicht vorhanden. */
  value: (s: ChannelStats) => number | null;
  /** Gesamtwert über alle Kanäle. */
  total: number | null;
  /** `true` = eine Summe wäre sachlich falsch (siehe Regel (a) oben). */
  noTotal?: boolean;
  /** Einheit hinter dem Wert, je Kanal verschieden (nur Volumen-Stufe). */
  unitOf?: (c: Channel) => string | null;
};

function fmtStage(v: number | null, format: StageFormat): string {
  if (v === null) return CHANNEL_NO_VOLUME;
  if (format === "pct") return fmtPct(v);
  if (format === "eur") return eur(v);
  return INT.format(v);
}

function ChannelCompare({
  channels,
  stages,
  statsOf,
}: {
  channels: Channel[];
  stages: CompareStage[];
  statsOf: (key: string) => ChannelStats;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-7)" }}>
      {stages.map((st) => {
        // Quoten haben eine natürliche Obergrenze, Mengen und Euro nicht —
        // dort ist der Kanal mit dem größten Wert der volle Balken.
        const values = channels.map((c) => st.value(statsOf(c.key)));
        const max = st.format === "pct" ? 100 : Math.max(...values.map((v) => v ?? 0), 0);

        return (
          <div key={st.key}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: "var(--sp-4)",
                marginBottom: "var(--sp-4)",
              }}
            >
              <span className="eyebrow eyebrow-muted">{st.label}</span>
              <span
                style={{
                  fontSize: "var(--fs-xs)",
                  color: "var(--text-subtle)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {st.noTotal ? "je Kanal eigene Einheit" : `gesamt ${fmtStage(st.total, st.format)}`}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
              {channels.map((c, i) => {
                const v = values[i];
                // Ein Wert > 0 bekommt immer einen sichtbaren Rest-Balken,
                // sonst verschwindet „1 von 340" optisch auf 0.
                const width = v === null || v <= 0 || max <= 0 ? 0 : Math.max((v / max) * 100, 2);
                const unit = st.unitOf?.(c) ?? null;
                return (
                  <div
                    key={c.key}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(64px, 104px) minmax(0, 1fr) minmax(72px, auto)",
                      alignItems: "center",
                      columnGap: "var(--sp-4)",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "var(--sp-3)",
                        minWidth: 0,
                        fontSize: "var(--fs-xs)",
                        color: "var(--text-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span
                        aria-hidden
                        style={{ width: 8, height: 8, borderRadius: "50%", background: c.color, flexShrink: 0 }}
                      />
                      {c.label}
                    </span>
                    <div style={{ height: 8, borderRadius: 99, background: "var(--surface-3)", overflow: "hidden" }}>
                      {width > 0 && (
                        <div
                          aria-hidden
                          style={{ height: "100%", width: `${width}%`, borderRadius: 99, background: c.color }}
                        />
                      )}
                    </div>
                    <span
                      style={{
                        textAlign: "right",
                        fontSize: "var(--fs-sm)",
                        fontWeight: 500,
                        color: v === null ? "var(--text-subtle)" : "var(--text-primary)",
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {fmtStage(v, st.format)}
                      {v !== null && unit && (
                        <span style={{ color: "var(--text-subtle)", fontWeight: 400 }}> {unit}</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Personen-Achse ───────────────────────────────────────────

type Person = {
  dms: number;
  calls: number;
  termine: number;
  shows: number;
  closings: number;
  won: number;
  revenue: number;
};

const ZERO_PERSON = (): Person => ({ dms: 0, calls: 0, termine: 0, shows: 0, closings: 0, won: 0, revenue: 0 });

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
  // Gesamtsumme nur fürs aktuelle Fenster — die Vorperiode liefert
  // ausschließlich die Delta-Badges der Kacheln, und die hängen am Kanal.
  const curAll = ZERO_TOTAL();

  const statsIn = (m: Map<string, ChannelStats>, key: string): ChannelStats => {
    let s = m.get(key);
    if (!s) {
      s = ZERO_CHANNEL(key);
      m.set(key, s);
    }
    return s;
  };
  const statsOf = (key: string): ChannelStats => cur.get(key) ?? ZERO_CHANNEL(key);

  // Zuwächse je Bucket für den kumulierten Verlauf (die Kumulation macht die
  // Chart-Komponente selbst — sie kennt dadurch keine einzige Kennzahl).
  const dmsByBucket: Record<string, number> = {};
  const callsByBucket: Record<string, number> = {};
  const termineByBucket: Record<string, number> = {};
  const showsByBucket: Record<string, number> = {};
  const closingsByBucket: Record<string, number> = {};
  const revenueByBucket: Record<string, number> = {};

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
    const bk = bucketOf(r.day, from, to, granularity);
    dmsByBucket[bk] = (dmsByBucket[bk] ?? 0) + dms;
  }

  for (const r of (phRes.error ? [] : ((phRes.data ?? []) as PhoneDayRow[]))) {
    const name = resolveOwner(r.owner_name);
    if (!name) continue;
    const calls = NUM(r.calls);
    ensure(name).calls += calls;
    phVolume.volumen = (phVolume.volumen ?? 0) + calls;
    const bk = bucketOf(r.day, from, to, granularity);
    callsByBucket[bk] = (callsByBucket[bk] ?? 0) + calls;
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
    if (!inCur) continue;
    addSetting(curAll, r);

    const p = ensure(name ?? OHNE);
    p.termine += 1;
    if (r.show_status === "show") p.shows += 1;

    const bk = bucketOf(day, from, to, granularity);
    termineByBucket[bk] = (termineByBucket[bk] ?? 0) + 1;
    if (r.show_status === "show") showsByBucket[bk] = (showsByBucket[bk] ?? 0) + 1;
  }

  // ── Closing-Calls ────────────────────────────────────────────
  // Ohne `setting_call_id` (z. B. nach einem Org-Umzug gekappt) lässt sich kein
  // Kanal bestimmen — solche Closings zählen nur in der Gesamtübersicht, sonst
  // wären sie einem Kanal angedichtet.
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
    if (!inCur) continue;
    if (!ck) closingsOhneKanal += 1;
    curAll.closings += 1;
    curAll.revenue += vol;

    const p = ensure(name ?? OHNE);
    p.closings += 1;
    if (won) {
      p.won += 1;
      p.revenue += vol;
    }

    const bk = bucketOf(day, from, to, granularity);
    closingsByBucket[bk] = (closingsByBucket[bk] ?? 0) + 1;
    if (vol > 0) revenueByBucket[bk] = (revenueByBucket[bk] ?? 0) + vol;
  }

  // ── Kanäle, die gezeigt werden ───────────────────────────────
  // Die beiden Akquise-Kanäle stehen immer da — sie SIND der Vergleich, auch
  // wenn einer im Zeitraum bei null liegt. Alle übrigen erscheinen, sobald sie
  // im Zeitraum etwas beitragen; so wächst der Vergleich mit Ads, Social Media
  // & Co. mit, ohne heute sechs leere Zeilen zu zeigen.
  const volumeChannels: Channel[] = CHANNELS.filter((c) => c.volume !== null);
  const compareChannels: Channel[] = CHANNELS.filter((c) => {
    if (c.volume !== null) return true;
    const s = cur.get(c.key);
    return s != null && (s.termine > 0 || s.closings > 0 || s.revenue > 0);
  });

  const compareStages: CompareStage[] = [
    {
      key: "volumen",
      label: "Akquise-Volumen",
      format: "int",
      value: (s) => s.volumen,
      total: null,
      // Regel (a): DMs und Anwahlen sind zwei Tätigkeiten. Eine Summe daraus
      // war die alte „Kontaktpunkte"-Zahl, die sich wie DMs las.
      noTotal: true,
      unitOf: volumeUnit,
    },
    { key: "termine", label: "Settingtermine", format: "int", value: (s) => s.termine, total: curAll.termine },
    { key: "show", label: "Show-Quote", format: "pct", value: showRateOf, total: showRateOf(curAll) },
    { key: "quali", label: "Quali-Quote", format: "pct", value: qualiRateOf, total: qualiRateOf(curAll) },
    { key: "closings", label: "Closingtermine", format: "int", value: (s) => s.closings, total: curAll.closings },
    { key: "umsatz", label: "Umsatz", format: "eur", value: (s) => s.revenue, total: curAll.revenue },
  ];

  // ── Personen-Tabelle ─────────────────────────────────────────
  const names = selectedMembers.map((m) => m.username);
  const ohne = people.get(OHNE);
  if (ohne && (ohne.dms > 0 || ohne.calls > 0 || ohne.termine > 0 || ohne.closings > 0)) names.push(OHNE);

  const personRows: ComparisonRow[] = names.map((name) => {
    const p = people.get(name) ?? ZERO_PERSON();
    return {
      name,
      values: {
        dms: p.dms,
        calls: p.calls,
        termine: p.termine,
        shows: p.shows,
        closings: p.closings,
        won: p.won,
        revenue: p.revenue,
      },
    };
  });

  // Fußzeile der Personen-Tabelle: die Summe über die gezeigten Zeilen, nicht
  // die Kanal-Gesamtsumme — sonst stünde dort mehr, als in der Tabelle steht.
  const personTotal = { dms: 0, calls: 0, termine: 0, shows: 0, closings: 0, won: 0, revenue: 0 };
  for (const name of names) {
    const p = people.get(name) ?? ZERO_PERSON();
    personTotal.dms += p.dms;
    personTotal.calls += p.calls;
    personTotal.termine += p.termine;
    personTotal.shows += p.shows;
    personTotal.closings += p.closings;
    personTotal.won += p.won;
    personTotal.revenue += p.revenue;
  }

  const rangeLabel = `${deDate(from)} – ${deDate(to)}`;

  return (
    <>
      {/* ══ 1 · KPI-Block je Akquise-Kanal ══
          Zwei Blöcke mit identischer Kachelreihe statt einer gemischten Reihe:
          dieselbe Stufe steht in beiden Blöcken an derselben Stelle, damit man
          die Kanäle mit dem Auge vergleichen kann. */}
      {volumeChannels.map((c, blockIndex) => {
        const s = statsOf(c.key);
        const p = prv.get(c.key) ?? ZERO_CHANNEL(c.key);
        const Icon = CHANNEL_ICON[c.key] ?? Activity;
        return (
          <div key={c.key} className="fade-up" style={{ animationDelay: `${blockIndex * 60}ms` }}>
            {/* Zuklappbar, aber offen: Die Kachelreihen SIND die Kernzahlen der
                Seite. Der Griff dient hier nur dazu, den Kanal wegzuklappen,
                den man selbst nicht bespielt. */}
            <AnalyseSection
              title={c.label}
              icon={Icon}
              meta="Akquise → Termin → Abschluss"
              collapsible
              info={
                <InfoBody>
                  <span>
                    {VOLUME_NOTE[c.key]} Settingtermine, Closingtermine und Umsatz zählen dagegen an ihrem eigenen
                    Termindatum — sie <em>finden</em> im Zeitraum statt, unabhängig davon, wann sie gebucht wurden.
                  </span>
                  <span>
                    Zu welchem Kanal ein Termin gehört, entscheidet seine Quelle
                    (<code>setting_calls.source_type</code>); Abschlüsse erben den Kanal von ihrem Settingtermin.
                  </span>
                </InfoBody>
              }
            >
              <KpiRow>
                <KpiHero
                  label={volumeUnit(c) ?? "Akquise"}
                  value={s.volumen}
                  delta={deltaPct(s.volumen ?? 0, p.volumen ?? 0)}
                  icon={<Icon size={15} />}
                  index={0}
                />
                <KpiHero
                  label="Settingtermine"
                  value={s.termine}
                  delta={deltaPct(s.termine, p.termine)}
                  icon={<CalendarCheck size={15} />}
                  index={1}
                />
                <KpiHero
                  label="Show-Quote"
                  value={showRateOf(s)}
                  format="pct"
                  delta={ppDelta(showRateOf(s), showRateOf(p))}
                  deltaLabel="vs. Vorperiode (pp)"
                  icon={<Eye size={15} />}
                  index={2}
                />
                <KpiHero
                  label="Quali-Quote"
                  value={qualiRateOf(s)}
                  format="pct"
                  delta={ppDelta(qualiRateOf(s), qualiRateOf(p))}
                  deltaLabel="vs. Vorperiode (pp)"
                  icon={<BadgeCheck size={15} />}
                  index={3}
                />
                <KpiHero
                  label="Closingtermine"
                  value={s.closings}
                  delta={deltaPct(s.closings, p.closings)}
                  icon={<Handshake size={15} />}
                  index={4}
                />
                <KpiHero
                  label="Umsatz"
                  value={s.revenue}
                  format="eur"
                  delta={deltaPct(s.revenue, p.revenue)}
                  tone="success"
                  icon={<Euro size={15} />}
                  index={5}
                />
              </KpiRow>
            </AnalyseSection>
          </div>
        );
      })}

      {/* ══ 2 · Kanalvergleich ══
          Bleibt offen: Das ist die zentrale Vergleichstabelle des Tabs — sie
          beantwortet die Frage, für die man die Übersicht öffnet. */}
      <div className="fade-up" style={{ animationDelay: "180ms" }}>
        <AnalyseSection
          title="Kanäle im direkten Vergleich"
          icon={Scale}
          meta={rangeLabel}
          collapsible
          info={
            <InfoBody>
              <span>
                Jede Stufe ist für sich skaliert: Der längste Balken ist der beste Kanal <em>dieser</em> Stufe,
                nicht der größte Wert der Seite.
              </span>
              <span>
                <B>Show-Quote</B> = Termine mit &bdquo;erschienen&ldquo; ÷ Termine mit erfasstem Ergebnis. Noch
                offene Termine stehen in keinem der beiden Werte, sonst sähe jeder laufende Zeitraum wie ein
                Einbruch aus. <B>Quali-Quote</B> = qualifizierte Termine ÷ Shows (erschienen <em>und</em> Status
                &bdquo;qualifiziert&ldquo;/&bdquo;Closing gelegt&ldquo;), Definition wie im Setting-Tab.
              </span>
              <span>
                Kanäle ohne eigene Akquise (Ads, Social Media, Sonstige) zeigen beim Volumen &bdquo;—&ldquo; statt
                0 — dort beginnt der Funnel erst beim Termin. Addiert wird das Volumen nie: DMs und Anwahlen sind
                zwei verschiedene Tätigkeiten.
              </span>
            </InfoBody>
          }
        >
          <ChannelCompare channels={compareChannels} stages={compareStages} statsOf={statsOf} />
        </AnalyseSection>
      </div>

      {/* ══ 3 · Gesamtübersicht über alle Kanäle ══
          Startet zu: Die Gesamtwerte jeder Stufe stehen bereits als
          „gesamt …" im Kanalvergleich darüber. Der Trichter zeigt sie nur
          zusätzlich als Form — das ist eine Nachfrage, kein Erstblick. */}
      <div className="fade-up" style={{ animationDelay: "240ms" }}>
        <AnalyseSection
          title="Alle Kanäle zusammen"
          icon={Layers}
          meta="gemeinsamer Termin-Funnel"
          collapsible
          defaultOpen={false}
          info={
            <InfoBody>
              <span>
                Der Trichter beginnt beim Termin, nicht bei der Akquise: DMs und Anwahlen ließen sich nur addieren,
                indem man zwei Tätigkeiten zu einer Zahl macht.
              </span>
              <span>
                &bdquo;Mit Ergebnis&ldquo; steht bewusst dazwischen — von dort aus sind die beiden nächsten
                Durchlassquoten exakt die Show- und die Quali-Quote der Kacheln oben.
              </span>
              <span>
                Jede Stufe zählt auf ihrem eigenen Datum. Der Schritt zu den Closingterminen ist deshalb keine
                Kohortenquote (ein Closing dieser Woche kann zu einem Termin von letztem Monat gehören) — dafür gibt
                es den Funnel-Tab.
              </span>
              {closingsOhneKanal > 0 && (
                <span>
                  {INT.format(closingsOhneKanal)} Closing(s) ohne Setting-Bezug stehen nur hier, in keinem Kanal.
                </span>
              )}
            </InfoBody>
          }
        >
          <BarFunnel
            stages={[
              { label: "Settingtermine", value: curAll.termine },
              { label: "Mit Ergebnis", value: curAll.entschieden },
              { label: "Shows", value: curAll.shows },
              { label: "Qualifiziert", value: curAll.quali },
              { label: "Closingtermine", value: curAll.closings },
            ]}
            trailing={{ label: "Umsatz", value: eur(curAll.revenue) }}
          />
        </AnalyseSection>
      </div>

      {/* ══ 4 · Verlauf ══
          Startet zu: Der Verlauf beantwortet „wann im Zeitraum lief was" —
          eine Detailfrage. Die Endstände derselben Serien stehen oben. */}
      <div className="fade-up" style={{ animationDelay: "300ms" }}>
        <AnalyseSection
          title="Fortschritt im Zeitraum"
          icon={LineChart}
          meta="kumuliert"
          collapsible
          defaultOpen={false}
        >
          <CumulativeProgressChart
            buckets={buckets}
            // Reihenfolge = Farbreihenfolge: DMs und Anwahlen bekommen damit
            // dieselben Farb-Slots wie LinkedIn und Telefon in der Registry —
            // die Kurven passen ohne Umdenken zu den Balken darüber.
            series={[
              { key: "dms", label: "DMs", kind: "count", values: dmsByBucket },
              { key: "anwahlen", label: "Anwahlen", kind: "count", values: callsByBucket },
              { key: "termine", label: "Settingtermine", kind: "count", values: termineByBucket, defaultOn: true },
              { key: "shows", label: "Shows", kind: "count", values: showsByBucket, defaultOn: true },
              { key: "closings", label: "Closingtermine", kind: "count", values: closingsByBucket, defaultOn: true },
              { key: "umsatz", label: "Umsatz (€)", kind: "count", values: revenueByBucket },
            ]}
            rangeLabel={rangeLabel}
            note="DMs, Anwahlen und Umsatz liegen um Größenordnungen über den Terminzahlen — zusammen in einer Kurve wird die kleinere Serie flach. Deshalb sind sie einzeln zuschaltbar."
          />
        </AnalyseSection>
      </div>

      {/* ══ 5 · Personen ══ */}
      {canCompare && (
        <div className="fade-up" style={{ animationDelay: "360ms" }}>
          {/* Bleibt offen: die zweite Kernachse dieses Tabs (Kanal × Person).
              Wer die Übersicht als Teamleitung öffnet, sucht genau diese
              Tabelle. */}
          <AnalyseSection
            title="Personen"
            icon={Users}
            meta="ganzer Funnel je Mitglied"
            collapsible
            info={
              <InfoBody>
                <span>
                  DMs und Anwahlen hängen am Besitzer der Liste, Termine und Abschlüsse an der Zuweisung des
                  Termins.
                </span>
                <span>
                  Wer den Datensatz angelegt hat, zählt nur, solange keine Zuweisung gesetzt ist — ein Termin, den
                  jemand für eine Kollegin bucht, zählt bei ihr.
                </span>
              </InfoBody>
            }
          >
            <ComparisonTable
              columns={[
                { key: "dms", label: "DMs", format: "int" },
                { key: "calls", label: "Anwahlen", format: "int" },
                { key: "termine", label: "Termine", format: "int" },
                { key: "shows", label: "Shows", format: "int" },
                { key: "closings", label: "Closings", format: "int" },
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
