import type { CSSProperties, ReactNode } from "react";
import {
  CalendarCheck, Coins, Euro, Filter, GitBranch, Handshake, MessageCircle, PhoneCall, TrendingUp, UserRound,
} from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { loadClosingCalls, loadSettingCalls } from "@/lib/analyseData";
import {
  NUM, buildBuckets, bucketOf, closingEffDate, eur, ownerKey, pct, settingEffDate,
  type FunnelModus, type Granularity, type QuelleKey,
} from "@/lib/analyse";
import { berlinDateISO } from "@/lib/apptTime";
import { CHANNELS, channelLabel, channelOf, type ChannelKey } from "@/lib/channels";
import { personOf } from "@/lib/personResolution";
import { AnalyseSection, MigrationHint } from "@/components/analyse/AnalyseSection";
import { MetricTable, StatRow, type MetricRow } from "@/components/analyse/AnalyseTables";
import { BarFunnel, KpiHero, KpiRow } from "@/components/analyse/AnalyseViz";
import { CumulativeProgressChart } from "@/components/analyse/CumulativeProgressChart";

// End-to-End-Funnel: Termine → Shows → Qualifikation → Closings → Shows →
// Gewonnen, dazu der Umsatz je Stufe getrennt nach Akquise-Kanal.
//
// ZÄHLWEISE (`modus`, Filterleiste):
//   kohorte  Die Termine des Zeitraums sind die Grundgesamtheit; ihre Closings
//            zählen dazu, egal wann sie stattfanden. Nur so hängen die Stufen
//            zusammen und die Prozentwerte sind echte Durchlaufquoten.
//   periode  Jede Stufe zählt auf ihrem eigenen Stichtag — die Frage "was ist
//            in diesem Zeitraum passiert". Termine und Closings kommen dann aus
//            verschiedenen Mengen; "Show → Closing" kann über 100 % gehen.
//
// ── Was sich gegenüber der Vorversion geändert hat (und warum) ────────────
// 1) UMSATZ JE STUFE ist jetzt KANALREIN. Vorher gab es eine einzige Kachel
//    „Umsatz pro DM", die nur bei gesetztem Quellenfilter erschien und im
//    Zähler den GESAMTumsatz aller Quellen trug. Sobald mehr als ein Kanal
//    läuft, wurden dort Telefon- und Manuell-Umsätze gegen LinkedIn-DMs
//    verrechnet — die Kennzahl war systematisch zu hoch. Der Umsatz wird
//    deshalb über die Herkunft des Settings (`source_type`) auf den Kanal
//    zurückgeführt; was sich keinem der beiden Volumen-Kanäle zuordnen lässt,
//    steht sichtbar daneben, statt in einem der Blöcke mitzulaufen.
// 2) DIE STUFEN kommen alle aus setting_calls/closing_calls. Vorher mischte
//    der Funnel die Tages-RPCs hinein: die Stufe „Termine" trug in Wahrheit
//    `contacts.appointment_set` (RPC-Spalte `appts`), die Stufe daneben aber
//    gezählte Setting-Zeilen. Zwei Definitionen in einem Trichter — genau der
//    Grund, warum die Werte nicht plausibel wirkten. Die RPCs liefern jetzt
//    nur noch die Nenner der Wert-Kacheln (DMs, Antworten, Anwahlen,
//    Entscheider), wo sie hingehören.
// 3) „Je Nutzer" ist raus (Board: „Ab danach alles raus"). Die Zuordnung je
//    Person bleibt bestehen — sie entscheidet weiterhin, welche Zeilen in die
//    Gesamtsumme laufen.
// 4) ZEITGRENZE „bis heute" (siehe `toEff` unten). Der Funnel wertet nur noch
//    Termine aus, die bereits stattgefunden haben. Ein Termin nächste Woche
//    kann keine Show, keine Qualifizierung und kein Closing haben — er saß als
//    garantierte Null in jeder Durchlassquote und zog den ganzen Trichter nach
//    unten, umso stärker je früher im Monat man schaute. Das ist der Grund,
//    warum die Termin-Zahl hier KLEINER sein darf als im Setting-Tab: dort ist
//    „Termine im Zeitraum" bewusst die volle Menge (Kapazitätsfrage), hier ist
//    es eine Konversionssicht.

type Member = { user_id: string; username: string };

type FunnelStage = { label: string; value: number };

const RANGE_FMT = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

/** "2026-07-01" → "01.07.2026" (lokale Mitternacht, kein UTC-Tagessprung). */
function fmtDay(iso: string): string {
  return RANGE_FMT.format(new Date(`${iso}T00:00:00`));
}

// ── Info-Texte ───────────────────────────────────────────────
// Die Methodik-Erklärungen standen bis hierher als Fußnote unter jeder
// Sektion und verlängerten sie dauerhaft um drei bis sechs Zeilen. Sie liegen
// jetzt hinter dem Info-Icon am Sektionstitel — dieselbe Information, aber
// dort abrufbar, wo die Frage entsteht.
//
// `InfoText` setzt nur die Absätze; Schriftgröße und Farbe bringt das Popover
// mit (InfoPopover). Der Abstand kommt über `gap`, damit der letzte Absatz
// unten keinen überzähligen Rand gegen die Polsterung des Popovers setzt.
function InfoText({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>{children}</div>;
}

const INFO_P: CSSProperties = { margin: 0 };
const INFO_STRONG: CSSProperties = { fontWeight: 600 };

// Zeilen ohne auflösbare Person werden sichtbar gemacht statt verworfen —
// sonst fehlten sie auch in der Gesamtsumme, und der Funnel zeigte weniger
// Termine an, als es gibt (konsistent zum Übersicht-Tab).
const OHNE = "Ohne Zuordnung";

/** Sammelschlüssel für Closings, deren Setting fehlt (gelöscht/Altbestand). */
const OHNE_SETTING = "ohne";

type OwnerDayRow = {
  owner_name: string | null;
  dms: number | string | null;
  answers: number | string | null;
  appts: number | string | null;
};

type PhoneDayRow = {
  owner_name: string | null;
  calls: number | string | null;
  decider_reached: number | string | null;
  appointments: number | string | null;
};

/** Die sechs Stufen — je Person und in Summe dieselbe Form. */
type Person = {
  termine: number;
  shows: number;
  /** Termine mit erfasstem `show_status` — der Nenner der Show-Quote. */
  entschieden: number;
  quali: number;
  closings: number;
  closingShows: number;
  won: number;
  revenue: number;
};

const ZERO = (): Person => ({
  termine: 0,
  shows: 0,
  entschieden: 0,
  quali: 0,
  closings: 0,
  closingShows: 0,
  won: 0,
  revenue: 0,
});

/**
 * Ein Setting gilt als qualifiziert, wenn der Lead da war und es weiterging.
 *
 * Definition wortgleich aus dem Setting-Tab übernommen (`isQualified` in
 * SettingTab.tsx) — bewusst nicht neu erfunden, sonst zeigte dieselbe
 * Kennzahl an zwei Stellen zwei Zahlen. Sie gehört mittelfristig nach
 * src/lib/analyse.ts; die Datei liegt in einem anderen Paket.
 */
function isQualified(r: { show_status: "show" | "no_show" | null; status: string }): boolean {
  return r.show_status === "show" && (r.status === "qualifiziert" || r.status === "closing_gelegt");
}

/** DB-Wert → Registry-Schlüssel; Unbekanntes/Leeres landet unter „sonstige". */
function channelKeyOf(sourceType: string | null | undefined): ChannelKey {
  return channelOf(sourceType)?.key ?? "sonstige";
}

/**
 * Die Wörter der beiden Wert-Kacheln je Kanal: die Einheit des Volumens
 * (Einzahl, „pro DM" statt „pro DMs") und die Reaktions-Stufe darüber.
 *
 * Bewusst hier und nicht in der Kanal-Registry: `ChannelVolume` kennt nur den
 * Plural der Volumen-Stufe („DMs"/„Calls") und gar keine Reaktions-Stufe.
 * Vorschlag fürs nächste Paket, das channels.ts anfasst — dort gehören
 * `unitLabel` und `reachLabel` neben `stageLabel`.
 */
const STAGE_WORDS: Record<string, { unit: string; reach: string }> = {
  linkedin: { unit: "DM", reach: "Antwort" },
  telefon: { unit: "Anwahl", reach: "Entscheider" },
};

type VolumeChannel = { key: "linkedin" | "telefon"; label: string; unit: string; reach: string };

/**
 * Die beiden Kanäle mit eigenem Akquise-Volumen (LinkedIn, Telefon) — genau
 * die, für die es eine Stufe VOR dem Termin gibt. Aus der Registry statt aus
 * einer Literal-Liste: ein dritter Kanal mit eigener Volumen-Tabelle bekommt
 * seinen Block dann automatisch, sobald er in STAGE_WORDS steht.
 */
const VOLUME_CHANNELS: VolumeChannel[] = CHANNELS.filter((c) => c.volume !== null).map((c) => ({
  key: c.key as "linkedin" | "telefon",
  label: c.label,
  unit: STAGE_WORDS[c.key]?.unit ?? c.volume!.stageLabel,
  reach: STAGE_WORDS[c.key]?.reach ?? "Reaktion",
}));

export async function FunnelTab({
  access,
  from,
  to,
  selectedMembers,
  canCompare,
  allSelected,
  quelle,
  modus,
  granularity,
}: {
  access: AccessContext;
  from: string;
  to: string;
  selectedMembers: Member[];
  canCompare: boolean;
  /** Keine explizite Personenauswahl — nur dann ist die "Ohne"-Zeile sinnvoll. */
  allSelected: boolean;
  quelle: QuelleKey;
  modus: FunnelModus;
  prevFrom?: string;
  prevTo?: string;
  granularity?: Granularity;
}) {
  const supabase = await createClient();
  const eff = canCompare ? null : access.user.id;

  // ── Zeitgrenze: nur, was schon stattgefunden hat ─────────────
  // Ein Trichter misst Durchlauf. Termine, die noch bevorstehen, haben
  // zwangsläufig kein Ergebnis — sie stehen als Null in Zähler UND Nenner
  // jeder Durchlassquote und machen den laufenden Monat systematisch
  // schlechter, je weiter er noch vor einem liegt. Die effektive Obergrenze
  // des Fensters ist deshalb min(bis, heute); dieselbe Regel, mit der der
  // Ziel-Abgleich der Übersicht nur bis heute rechnet.
  //
  // Sichtbar wird das gewählte Fenster trotzdem in der Meta-Zeile — sonst
  // wunderte man sich, warum der Funnel weniger Termine zeigt als der
  // Setting-Tab (dort ist die volle Menge gewollt: Kapazität, nicht Konversion).
  //
  // „heute" kommt über den Berliner Kalendertag (`berlinDateISO`), nicht über
  // die Server-Uhr: Auf Vercel läuft der Prozess in UTC, und der gesamte
  // Analysebereich bucketet über Berlin-Tage.
  const heute = berlinDateISO(new Date().toISOString());
  const toEff = to < heute ? to : heute;
  /** Das gewählte Fenster reicht in die Zukunft und wurde beschnitten. */
  const clamped = toEff < to;
  /** Im gewählten Fenster hat noch kein einziger Tag stattgefunden. */
  const futureOnly = from > toEff;

  const [liRes, phoneRes, settingRows, closingRows] = await Promise.all([
    supabase.rpc("rpc_owner_day_metrics", {
      p_workspace_id: access.workspace_id,
      p_from: from,
      // Auch die Nenner der Wert-Kacheln laufen über das beschnittene Fenster —
      // sonst stünde ein Umsatz aus stattgefundenen Terminen gegen ein
      // Akquise-Volumen aus einem längeren Zeitraum.
      p_to: toEff,
      p_effective_user_id: eff,
    }),
    supabase.rpc("rpc_phone_day_metrics", {
      p_workspace_id: access.workspace_id,
      p_from: from,
      p_to: toEff,
      p_effective_user_id: eff,
    }),
    loadSettingCalls(supabase, access, canCompare),
    loadClosingCalls(supabase, access, canCompare),
  ]);

  if (quelle === "telefon" && phoneRes.error) {
    return <MigrationHint>Telefon-Analyse benötigt die neueste Datenbank-Migration (0013).</MigrationHint>;
  }

  const nameByOwnerKey = new Map<string, string>();
  for (const m of selectedMembers) nameByOwnerKey.set(ownerKey(m.username), m.username);
  const nameById = new Map(selectedMembers.map((m) => [m.user_id, m.username]));

  // Die Aufschlüsselung je Person rendert nicht mehr — sie entscheidet aber
  // weiterhin, WELCHE Zeilen in die Gesamtsumme laufen (Personenfilter, plus
  // die "Ohne Zuordnung"-Zeilen bei freier Auswahl).
  const people = new Map<string, Person>();
  const ensure = (name: string): Person => {
    let p = people.get(name);
    if (!p) {
      p = ZERO();
      people.set(name, p);
    }
    return p;
  };
  for (const m of selectedMembers) ensure(m.username);

  /** Listen-Owner einer RPC-Zeile → Topf; unbekannt → "Ohne" bzw. verworfen. */
  const resolveOwner = (owner: string | null): string | null => {
    const hit = nameByOwnerKey.get(ownerKey(owner));
    if (hit) return hit;
    // Bei aktivem Personenfilter gehört Fremdes/Unzugeordnetes nicht ins Bild.
    return allSelected ? OHNE : null;
  };

  /**
   * Zuständige Person einer Termin-Zeile → Topf. `personOf` ist die
   * Fachlichkeit (Zuweisung vor Ersteller), nicht das Audit-Feld
   * `created_by_user_id` — siehe src/lib/personResolution.ts.
   */
  const resolvePerson = (row: { assigned_user_id: string | null; created_by_user_id: string | null }): string | null => {
    const uid = personOf(row);
    const hit = uid ? nameById.get(uid) : undefined;
    if (hit) return hit;
    return allSelected ? OHNE : null;
  };

  // ── Nenner der Wert-Kacheln (aus den Tages-RPCs) ─────────────
  // Nur diese vier Zahlen kommen aus den RPCs: Akquise-Volumen und Reaktion je
  // Kanal. Sie sind zwangsläufig zeitraumbezogen (die RPC filtert auf
  // Pitch- bzw. Erstkontakt-Tag) — daher der Warnabsatz zur Perioden-Kennzahl
  // im Info-Text von „Wo kommt der Umsatz her?".
  const volume = {
    linkedin: { total: 0, reach: 0 },
    telefon: { total: 0, reach: 0 },
  };
  for (const r of (liRes.error ? [] : ((liRes.data ?? []) as OwnerDayRow[]))) {
    if (!resolveOwner(r.owner_name)) continue;
    volume.linkedin.total += NUM(r.dms);
    volume.linkedin.reach += NUM(r.answers);
  }
  for (const r of (phoneRes.error ? [] : ((phoneRes.data ?? []) as PhoneDayRow[]))) {
    if (!resolveOwner(r.owner_name)) continue;
    volume.telefon.total += NUM(r.calls);
    volume.telefon.reach += NUM(r.decider_reached);
  }

  // ── Kanal-Zellen ────────────────────────────────────────────
  // Bewusst UNABHÄNGIG vom Quellenfilter: Die Wert-Kacheln sollen beide Kanäle
  // immer nebeneinander zeigen, sonst ist der Vergleich eine Frage der
  // Filterstellung. Zeitraum, Zählweise und Personenfilter gelten sehr wohl.
  // `entschieden` = Termine mit erfasstem show_status (Nenner der Show-Quote).
  type Cell = { termine: number; shows: number; entschieden: number; quali: number; closings: number; closingShows: number; won: number; revenue: number };
  const cells = new Map<string, Cell>();
  const cellFor = (key: string): Cell => {
    let c = cells.get(key);
    if (!c) {
      c = { termine: 0, shows: 0, entschieden: 0, quali: 0, closings: 0, closingShows: 0, won: 0, revenue: 0 };
      cells.set(key, c);
    }
    return c;
  };

  // ── Buckets für den Fortschritts-Chart ───────────────────────
  // Ebenfalls über das beschnittene Fenster: leere Zukunfts-Buckets läsen sich
  // in einer kumulierten Kurve wie ein abrupter Stillstand.
  const buckets = buildBuckets(from, toEff, granularity);
  const byBucket = {
    termine: {} as Record<string, number>,
    shows: {} as Record<string, number>,
    quali: {} as Record<string, number>,
    closings: {} as Record<string, number>,
    won: {} as Record<string, number>,
  };
  const addBucket = (map: Record<string, number>, day: string, n = 1): void => {
    if (n === 0) return;
    const k = bucketOf(day, from, toEff, granularity);
    map[k] = (map[k] ?? 0) + n;
  };

  // ── Setting-Calls ───────────────────────────────────────────
  // `channelOfSetting` deckt ALLE Settings ab, auch die außerhalb des
  // Fensters: in der Periodensicht kann ein Closing zu einem älteren Termin
  // gehören, und ohne diesen Eintrag landete sein Umsatz fälschlich unter
  // "Ohne Setting-Bezug" statt beim Kanal.
  const channelOfSetting = new Map<string, ChannelKey>();
  // Die Kohorte: Setting-ID → Person + Tag + Kanal. Was hier fehlt, gehört
  // nicht zum Zeitraum. Bewusst OHNE Quellenfilter — der greift erst beim
  // Funnel, damit die Kanal-Zellen vollständig bleiben.
  const cohort = new Map<string, { name: string; day: string; channel: ChannelKey }>();

  for (const r of settingRows) {
    const channel = channelKeyOf(r.source_type);
    channelOfSetting.set(r.id, channel);

    // `toEff` statt `to`: ein Termin, der erst noch ansteht, gehört nicht in
    // eine Konversionsrechnung (siehe Zeitgrenze oben).
    const day = settingEffDate(r);
    if (day < from || day > toEff) continue;
    const name = resolvePerson(r);
    if (!name) continue;

    const show = r.show_status === "show";
    const quali = isQualified(r);
    cohort.set(r.id, { name, day, channel });

    const cell = cellFor(channel);
    cell.termine += 1;
    if (show) cell.shows += 1;
    // Nenner der Show-Quote: nur Termine MIT erfasstem Ergebnis — identisch zu
    // Setting- und Uebersichtstab. Gegen alle Termine gerechnet saehe dieselbe
    // Kennzahl hier anders aus als dort.
    if (r.show_status === "show" || r.show_status === "no_show") cell.entschieden += 1;
    if (quali) cell.quali += 1;

    // Der Funnel darunter folgt dem Quellenfilter, die Kacheln oben nicht.
    if (quelle !== "alle" && channel !== quelle) continue;

    const p = ensure(name);
    p.termine += 1;
    if (show) p.shows += 1;
    if (quali) p.quali += 1;
    addBucket(byBucket.termine, day);
    if (show) addBucket(byBucket.shows, day);
    if (quali) addBucket(byBucket.quali, day);
  }

  // ── Closing-Calls ───────────────────────────────────────────
  for (const r of closingRows) {
    // Zeitgrenze, die in BEIDEN Zählweisen gilt: Ein Abschlussgespräch, das
    // erst nächste Woche stattfindet, hat keinen Show-Status und kein
    // Ergebnis. In der Periodensicht fängt `toEff` das unten ohnehin ab; in
    // der Kohortensicht gibt es gar keine Obergrenze für das Closing-Datum
    // (das Closing folgt seinem Termin) — dort ist dies die einzige Bremse.
    if (closingEffDate(r) > heute) continue;

    const inCohort = r.setting_call_id ? cohort.get(r.setting_call_id) : undefined;

    let name: string | null;
    let day: string;
    let channel: string;

    if (modus === "kohorte") {
      // Das Closing folgt seinem Setting: Es zählt genau dann, wenn dieses
      // Setting zur Kohorte gehört — unabhängig vom Closing-Datum. Auch
      // Person, Kanal und Bucket kommen vom Setting, sonst risse eine Zeile
      // auseinander (Termin bei A, Abschluss bei B) und die Durchlaufquote
      // wäre wieder unecht.
      if (!inCohort) continue;
      name = inCohort.name;
      day = inCohort.day;
      channel = inCohort.channel;
    } else {
      day = closingEffDate(r);
      if (day < from || day > toEff) continue;
      name = resolvePerson(r);
      if (!name) continue;
      channel = (r.setting_call_id ? channelOfSetting.get(r.setting_call_id) : null) ?? OHNE_SETTING;
    }

    const show = r.show_status === "show";
    const won = r.status === "gewonnen";
    const vol = won ? NUM(r.deal_volume) : 0;

    const cell = cellFor(channel);
    cell.closings += 1;
    if (show) cell.closingShows += 1;
    if (won) {
      cell.won += 1;
      cell.revenue += vol;
    }

    if (quelle !== "alle" && channel !== quelle) continue;

    const p = ensure(name);
    p.closings += 1;
    if (show) p.closingShows += 1;
    if (won) {
      p.won += 1;
      p.revenue += vol;
    }
    addBucket(byBucket.closings, day);
    if (won) addBucket(byBucket.won, day);
  }

  // ── Gesamt über die gewählten Personen ───────────────────────
  const names = selectedMembers.map((m) => m.username);
  const ohne = people.get(OHNE);
  if (ohne && (ohne.termine > 0 || ohne.closings > 0)) names.push(OHNE);

  const sum = ZERO();
  for (const name of names) {
    const p = people.get(name) ?? ZERO();
    sum.termine += p.termine;
    sum.shows += p.shows;
    sum.quali += p.quali;
    sum.closings += p.closings;
    sum.closingShows += p.closingShows;
    sum.won += p.won;
    sum.revenue += p.revenue;
  }

  // ── Die sechs Stufen ─────────────────────────────────────────
  // Labels sind eindeutig ("Shows" kommt zweimal vor) — der BarFunnel nimmt
  // das Label als React-Key, und zwei gleiche Stufen wären ein doppelter Key.
  const totalStages: FunnelStage[] = [
    { label: "Termine Setting", value: sum.termine },
    { label: "Shows Setting", value: sum.shows },
    { label: "Qualifiziert", value: sum.quali },
    { label: "Termine Closing", value: sum.closings },
    { label: "Shows Closing", value: sum.closingShows },
    { label: "Gewonnen", value: sum.won },
  ];

  // ── Umsatz je Kanal ─────────────────────────────────────────
  const revenueOf = (key: string): number => cells.get(key)?.revenue ?? 0;
  const totalRevenueAll = [...cells.values()].reduce((acc, c) => acc + c.revenue, 0);
  const restRevenue = totalRevenueAll - revenueOf("linkedin") - revenueOf("telefon");

  /** Umsatz je Stufe; ohne Basis `null` — eine 0 läse sich wie „bringt nichts". */
  const perValue = (revenue: number, basis: number): number | null =>
    basis === 0 ? null : Math.round(revenue / basis);

  type Tile = { label: string; value: number | null; icon: ReactNode };

  /** Die vier Wert-Kacheln eines Volumen-Kanals. */
  const tilesFor = (channel: VolumeChannel): Tile[] => {
    const cell = cells.get(channel.key);
    const revenue = cell?.revenue ?? 0;
    const vol = volume[channel.key];
    return [
      {
        label: `Umsatz pro ${channel.unit}`,
        value: perValue(revenue, vol.total),
        icon: channel.key === "linkedin" ? <Euro size={15} /> : <PhoneCall size={15} />,
      },
      {
        label: `Umsatz pro ${channel.reach}`,
        value: perValue(revenue, vol.reach),
        icon: channel.key === "linkedin" ? <MessageCircle size={15} /> : <UserRound size={15} />,
      },
      {
        label: "Umsatz pro Setting",
        value: perValue(revenue, cell?.termine ?? 0),
        icon: <CalendarCheck size={15} />,
      },
      {
        label: "Umsatz pro Closing",
        value: perValue(revenue, cell?.closings ?? 0),
        icon: <Handshake size={15} />,
      },
    ];
  };

  const quelleLabel = quelle === "alle" ? "Alle Quellen" : channelLabel(quelle);
  const modusLabel = modus === "kohorte" ? "Kohorte" : "Periode";
  // Die Zeitgrenze steht IN der Meta-Zeile, nicht nur im Info-Text: Sie ist der
  // Grund, warum dieselbe Woche hier weniger Termine zeigt als im Setting-Tab,
  // und diese Frage stellt sich beim Lesen der Zahl — nicht erst beim Klick.
  const windowLabel = futureOnly
    ? `${fmtDay(from)} – ${fmtDay(to)} · noch kein Termin stattgefunden`
    : `${fmtDay(from)} – ${fmtDay(toEff)}${clamped ? " · nur bis heute" : ""}`;
  const rangeMeta = `${windowLabel} · ${quelleLabel} · ${modusLabel}`;

  // Ein Satz, der die Zählweise erklärt — ohne den steht der Umschalter da wie
  // ein Schalter ohne Beschriftung.
  const modusHint =
    modus === "kohorte" ? (
      <>
        <strong style={INFO_STRONG}>Kohorte:</strong> Gezählt werden die Termine aus diesem Zeitraum und das,
        was daraus geworden ist — ein Abschlussgespräch zählt zu seinem Termin, auch wenn es erst später
        stattfand. Die Prozentwerte zwischen den Stufen sagen also: Wie viel von diesen Terminen ist wirklich
        durchgelaufen?
      </>
    ) : (
      <>
        <strong style={INFO_STRONG}>Periode:</strong> Jede Stufe zählt, was in diesem Zeitraum stattgefunden
        hat. Ein Abschlussgespräch kann dabei zu einem Termin von davor gehören — die Prozentwerte zwischen
        den Stufen vergleichen deshalb zwei verschiedene Gruppen und können über 100 % liegen. Für
        &bdquo;Wie viel läuft durch?&ldquo; ist Kohorte die richtige Zählweise.
      </>
    );

  /**
   * Die Zeitgrenze als Info-Absatz. Bewusst in JEDER Sektion, die Stufen zeigt
   * (Trichter, Fortschritt, Quellen-Matrix): Wer unten in der Matrix sitzt und
   * sich über die Termin-Zahl wundert, soll nicht erst nach oben scrollen
   * müssen, um zu verstehen, warum sie kleiner ist als im Setting-Tab.
   */
  const zeitgrenzeInfo = (
    <p style={INFO_P}>
      <strong style={INFO_STRONG}>Nur stattgefundene Termine.</strong> Ein Termin, der erst noch ansteht, kann
      keine Show, keine Qualifizierung und kein Closing haben — er stünde als garantierte Null in jeder
      Durchlassquote. Der Funnel schneidet das Fenster deshalb bei heute ab
      {clamped ? <> (hier: bis {fmtDay(toEff)} statt {fmtDay(to)})</> : null}. Im Setting-Tab und in der
      Übersicht ist &bdquo;Termine im Zeitraum&ldquo; bewusst die volle Zahl inklusive der anstehenden — das
      ist dort eine Kapazitätsfrage. Deshalb dürfen beide Tabs für denselben Zeitraum verschiedene
      Termin-Zahlen zeigen.
    </p>
  );

  // ── Quellen-Matrix (nur ohne Quellen-Filter — sonst bliebe eine Zeile) ──
  const matrixBase = [...cells.values()].reduce((acc, c) => acc + c.termine, 0);
  const matrixRows: MetricRow[] = [...cells.entries()]
    .filter(([, c]) => c.termine > 0 || c.closings > 0)
    .sort((a, b) => b[1].revenue - a[1].revenue || b[1].termine - a[1].termine)
    .map(([key, c]) => ({
      key,
      label: key === OHNE_SETTING ? "Ohne Setting-Bezug" : channelLabel(key),
      // Anteil gegen die Kanal-Summe, nicht gegen den (quellengefilterten)
      // Funnel — sonst hinge der Balken an einem Filter, den die Tabelle gar
      // nicht anwendet.
      share: matrixBase === 0 ? null : c.termine / matrixBase,
      values: {
        termine: c.termine,
        showRate: pct(c.shows, c.entschieden),
        quali: c.quali,
        closings: c.closings,
        closingRate: pct(c.closings, c.shows),
        won: c.won,
        winRate: pct(c.won, c.shows),
        revenue: c.revenue,
      },
    }));
  const matrixTotal = [...cells.values()].reduce(
    (acc, c) => {
      acc.termine += c.termine;
      acc.shows += c.shows;
      acc.entschieden += c.entschieden;
      acc.quali += c.quali;
      acc.closings += c.closings;
      acc.won += c.won;
      acc.revenue += c.revenue;
      return acc;
    },
    { termine: 0, shows: 0, entschieden: 0, quali: 0, closings: 0, won: 0, revenue: 0 },
  );

  return (
    <>
      {/* ── Umsatz je Stufe, je Kanal ──────────────────────────── */}
      {VOLUME_CHANNELS.map((channel, blockIndex) => (
        <div key={channel.key} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-4)", flexWrap: "wrap" }}>
            <span className="eyebrow eyebrow-muted">Umsatz je Stufe · {channel.label}</span>
            <span
              style={{
                fontSize: "var(--fs-xs)",
                color: "var(--text-subtle)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {eur(revenueOf(channel.key))} aus {(cells.get(channel.key)?.won ?? 0).toLocaleString("de-DE")} Abschlüssen
            </span>
          </div>
          <KpiRow>
            {tilesFor(channel).map((t, i) => (
              <KpiHero
                key={t.label}
                label={t.label}
                value={t.value}
                format="eur"
                tone={t.value !== null && t.value > 0 ? "success" : "default"}
                icon={t.icon}
                index={blockIndex * 4 + i}
              />
            ))}
          </KpiRow>
        </div>
      ))}

      {/* ── Umsatz-Herkunft ────────────────────────────────────── */}
      {/* Vier Zahlen in einer Zeile — die bleiben offen, aber zuklappbar:
          wer nur den Trichter darunter braucht, wird sie los. */}
      <div className="fade-up" style={{ animationDelay: "200ms" }}>
        <AnalyseSection
          title="Wo kommt der Umsatz her?"
          icon={Coins}
          meta={rangeMeta}
          collapsible
          info={
            <InfoText>
              <p style={INFO_P}>
                Die Kacheln oben zeigen <strong style={INFO_STRONG}>immer beide Kanäle</strong> — unabhängig vom
                Quellenfilter, sonst wäre der Vergleich eine Frage der Filterstellung.
              </p>
              <p style={INFO_P}>
                Der Umsatz wird über die Herkunft des Termins (<code>source_type</code>) auf den Kanal
                zurückgeführt. Alles ohne LinkedIn- oder Telefon-Herkunft (manuell, Ads, Social, Inbound,
                Website, Closings ohne Setting) steht als &bdquo;Andere Quellen&ldquo; daneben und läuft in
                keinem der beiden Blöcke mit — nur so summieren sich die Kanäle auf den Gesamtumsatz.
              </p>
              <p style={INFO_P}>
                <strong style={INFO_STRONG}>Vorsicht bei der Interpretation:</strong> Zähler und Nenner liegen
                zwangsläufig in verschiedenen Zeiträumen — die DM, aus der im August ein Deal wurde, ging im
                Juni raus. Das ist eine <em>Perioden</em>-Kennzahl: Sie beantwortet &bdquo;wie viel Umsatz stand
                diesem Zeitraum wie viel Aufwand gegenüber&ldquo;, nicht &bdquo;was hat diese DM
                eingebracht&ldquo;. Bei schwankendem Volumen springt der Wert stark; für eine Aussage braucht es
                mehrere Perioden nebeneinander.
              </p>
            </InfoText>
          }
        >
          <StatRow
            items={[
              { label: "LinkedIn", value: eur(revenueOf("linkedin")) },
              { label: "Telefon", value: eur(revenueOf("telefon")) },
              { label: "Andere Quellen", value: eur(restRevenue) },
              { label: "Gesamt", value: eur(totalRevenueAll), tone: "success" },
            ]}
          />
        </AnalyseSection>
      </div>

      {/* ── Funnel Gesamt ──────────────────────────────────────────
             NICHT zuklappbar: Der Trichter ist der Tab. Eine Sektion, die man
             wegklappen kann, wäre hier ein Weg, die Seite leer zu machen. */}
      <div className="fade-up" style={{ animationDelay: "240ms" }}>
        <AnalyseSection
          title="Funnel Gesamt"
          icon={Filter}
          meta={rangeMeta}
          info={
            <InfoText>
              <p style={INFO_P}>{modusHint}</p>
              {zeitgrenzeInfo}
              <p style={INFO_P}>
                Alle sechs Stufen kommen aus <code>setting_calls</code> und <code>closing_calls</code>;
                &bdquo;Qualifiziert&ldquo; ist dieselbe Definition wie im Setting-Tab (erschienen <em>und</em>{" "}
                Status qualifiziert bzw. Closing gelegt). Die Kacheln oben stammen aus derselben Menge, ihre
                Nenner (DMs, Antworten, Anwahlen, Entscheider) dagegen aus den Tages-RPCs.
              </p>
            </InfoText>
          }
        >
          <BarFunnel stages={totalStages} trailing={{ label: "Umsatz", value: eur(sum.revenue) }} />
        </AnalyseSection>
      </div>

      {/* ── Fortschritt im Zeitraum ──────────────────────────────
             Startet zugeklappt: ein Verlaufs-Chart beantwortet keine Frage,
             die man beim Öffnen der Seite stellt — er beantwortet die zweite. */}
      <div className="fade-up" style={{ animationDelay: "270ms" }}>
        <AnalyseSection
          title="Fortschritt"
          icon={TrendingUp}
          meta="kumuliert über den Zeitraum"
          collapsible
          defaultOpen={false}
          info={
            <InfoText>
              <p style={INFO_P}>
                Die Kurven kumulieren über den Zeitraum — die Linie steigt also, solange etwas dazukommt, und
                läuft flach, wenn nichts passiert.
              </p>
              <p style={INFO_P}>
                {modus === "kohorte"
                  ? "Zählweise Kohorte: Closings und Abschlüsse liegen im Bucket ihres Termins, nicht in dem des Abschlussgesprächs — sonst liefe die Kurve der Kohorte davon."
                  : "Zählweise Periode: Jede Stufe liegt im Bucket ihres eigenen Stichtags."}
              </p>
              {zeitgrenzeInfo}
            </InfoText>
          }
        >
          <CumulativeProgressChart
            buckets={buckets}
            series={[
              { key: "termine", label: "Termine", kind: "count", values: byBucket.termine, defaultOn: true },
              { key: "shows", label: "Shows", kind: "count", values: byBucket.shows },
              { key: "quali", label: "Qualifiziert", kind: "count", values: byBucket.quali },
              { key: "closings", label: "Closings", kind: "count", values: byBucket.closings },
              { key: "won", label: "Gewonnen", kind: "count", values: byBucket.won, defaultOn: true },
              { key: "winRate", label: "Win-Rate", kind: "rate", values: byBucket.won, denominator: byBucket.closings },
            ]}
            rangeLabel={`${fmtDay(from)} – ${fmtDay(toEff)}`}
          />
        </AnalyseSection>
      </div>

      {/* ── Quellen-Matrix ─────────────────────────────────────── */}
      {quelle === "alle" && matrixRows.length > 0 && (
        <div className="fade-up" style={{ animationDelay: "300ms" }}>
          {/* Startet offen: die einzige Tabelle des Tabs und die Antwort auf
              „welcher Kanal trägt den Trichter" — dieselbe Rangordnung wie der
              Trichter selbst, nur aufgeschlüsselt. */}
          <AnalyseSection
            title="Je Quelle"
            icon={GitBranch}
            meta="derselbe Trichter, aufgeschlüsselt nach Herkunft"
            collapsible
            info={
              <InfoText>
                <p style={INFO_P}>
                  Show-Quote gegen die Termine mit erfasstem Ergebnis, Abschlussrate gegen die erschienenen
                  Closings — dieselben Nenner wie im Setting- und Closing-Tab, damit dieselbe Kennzahl nicht je
                  nach Tab einen anderen Wert zeigt.
                </p>
                <p style={INFO_P}>
                  Die Tabelle folgt derselben Zählweise wie der Trichter oben ({modusLabel}) und ist wie die
                  Kacheln unabhängig vom Quellenfilter aufgebaut.
                </p>
                {zeitgrenzeInfo}
              </InfoText>
            }
          >
            <MetricTable
              label="Quelle"
              columns={[
                { key: "termine", label: "Termine", format: "int" },
                { key: "showRate", label: "Show-Quote", format: "pct" },
                { key: "quali", label: "Quali", format: "int" },
                { key: "closings", label: "Closings", format: "int" },
                { key: "closingRate", label: "Show → Closing", format: "pct" },
                { key: "won", label: "Gewonnen", format: "int" },
                { key: "winRate", label: "Closing → Win", format: "pct" },
                { key: "revenue", label: "Umsatz", format: "eur", emphasis: true },
              ]}
              rows={matrixRows}
              total={{
                termine: matrixTotal.termine,
                showRate: pct(matrixTotal.shows, matrixTotal.entschieden),
                quali: matrixTotal.quali,
                closings: matrixTotal.closings,
                closingRate: pct(matrixTotal.closings, matrixTotal.shows),
                won: matrixTotal.won,
                winRate: pct(matrixTotal.won, matrixTotal.shows),
                revenue: matrixTotal.revenue,
              }}
              minWidth={820}
            />
          </AnalyseSection>
        </div>
      )}
    </>
  );
}
