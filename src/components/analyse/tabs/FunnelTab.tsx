import type { CSSProperties, ReactNode } from "react";
import {
  CalendarCheck, CalendarX, Coins, Euro, Filter, GitBranch, Handshake, MessageCircle, PhoneCall, TrendingUp,
  UserRound,
} from "lucide-react";
import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { loadClosingCalls, loadSettingCalls } from "@/lib/analyseData";
import {
  NUM, buildBuckets, bucketOf, channelKeyOf, closingEffDate, eur, fmtPct, ownerKey, pct, settingEffDate,
  type FunnelModus, type Granularity, type QuelleKey,
} from "@/lib/analyse";
import { berlinDateISO } from "@/lib/apptTime";
import { CHANNELS, channelLabel } from "@/lib/channels";
import { dropoutReasonLabel } from "@/lib/dropoutLists";
import { personOf } from "@/lib/personResolution";
import { AnalyseSection, MigrationHint } from "@/components/analyse/AnalyseSection";
import { Footnote, MetricTable, StatRow, type MetricRow } from "@/components/analyse/AnalyseTables";
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
//    nur noch die Nenner der Wert-Kacheln (DMs, Antworten, Erstkontakte,
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
//
// ── Angleichung an die neue Begriffs- und Gestaltungslinie ────────────────
// 5) DAS WORT „ANWAHLEN" IST RAUS. Die Volumen-Stufe des Telefon-Kanals heißt
//    jetzt überall „Erstkontakte" (Firmen mit erstem Anruf), weil „Anwahlen"
//    seit dem Anruf-Log die Ereignis-Ebene meint, auf der derselbe Lead
//    mehrfach zählt. Bis hierher zeigten Telefon-Tab und Funnel zwei
//    verschiedene Zahlen unter demselben Wort. Das Wort kommt deshalb aus der
//    Kanal-Registry (`volume.unitLabel`) statt aus einer lokalen Wortliste —
//    genau die Doppelung, die die Registry abschaffen soll.
// 6) KEINE LEITZAHL-KACHEL (`KpiHero lead`). Der Tab beginnt mit zwei
//    symmetrischen Kanal-Blöcken; eine hervorgehobene Kachel stellte einen
//    der beiden Kanäle typografisch über den anderen, obwohl der Vergleich
//    der ganze Zweck des Aufbaus ist. Dazu ist jede dieser Kacheln ein
//    Verhältnis, dessen Zähler und Nenner in verschiedenen Zeiträumen liegen
//    (siehe Info-Text unten) — die wackeligste Zahl des Tabs taugt nicht als
//    seine Kernaussage. Die trägt der Trichter, der seinen Umsatz ohnehin als
//    eigene Abschlusskarte führt. Stattdessen bekommt jeder Block seine
//    Bezugsgröße in die Kopfzeile: „aus N Abschlüssen · Basis M DMs".
// 7) DER QUELLENFILTER GILT JETZT AUCH OBEN. Er ließ die Wert-Kacheln
//    unberührt — ein Filter, der die halbe Seite nicht anfasst, liest sich
//    als Defekt. Gefiltert bleibt jetzt genau der gewählte Kanal stehen; hat
//    er kein eigenes Akquise-Volumen (Ads, Social Media, Manuell …), bleiben
//    die zwei Kacheln, die es für ihn gibt. Nicht folgen kann nur die
//    Umsatz-Herkunft: Eine Aufteilung auf die Kanäle muss sich auf den
//    Gesamtumsatz summieren, sonst ist „Gesamt" nicht das Gesamt. Diese eine
//    Sektion sagt das in ihrer Meta-Zeile.
// 8) DIE QUELLEN-TABELLE ist ab jetzt die einzige Quellen-Aufschlüsselung des
//    Analysebereichs (die im Closing-Tab entfällt). Sie zeigt fünf statt acht
//    Spalten und muss zwei Aufgaben zugleich tragen:
//    • die volle Kette Termin → Show → Closing → Gewonnen → Umsatz, die es
//      nur hier gibt, und
//    • die FREITEXT-Quelle, die es nur in der gelöschten Tabelle gab. Ohne
//      sie wäre „Umsatz je Freitext-Quelle" ersatzlos verloren: Der
//      Setting-Tab löst den Freitext zwar auf, endet aber bei „Zu Closing".
//    Gruppiert wird deshalb nach `source_detail`, wo einer da ist, sonst nach
//    `source_type` — die Regel des Setting-Tabs, inklusive case-insensitiver
//    Normalisierung (siehe `srcOf`). Gegen die dadurch mögliche Zeilenflut
//    steht eine Sammelzeile, keine Mindestmenge (Begründung dort).
//
// ── Absagen (Entscheidung K5) ─────────────────────────────────────────────
// 9) ABGESAGTE TERMINE ZÄHLEN HIER NICHT MEHR MIT. Seit dem Nachfassen-Umbau
//    trägt ein abgesagter Termin `cancelled_at`; sein `show_status` bleibt
//    leer. Für die Show- und die Quali-Quote fiel er damit von selbst aus dem
//    Nenner — nicht aber aus den STUFEN dieses Trichters, wo „Termine Setting"
//    eine reine Menge ist. Eine Absage stand dort als garantierte Null in jeder
//    Durchlaufquote: Ab dem Deploy wäre jede Quote gesunken, ohne dass sich am
//    Vertrieb etwas geändert hätte — derselbe Zahlensprung, vor dem docs §5
//    warnt. Der Funnel misst Konversion und schließt sie deshalb aus.
//    Übersicht, Setting-Tab und Kalender behalten sie: dort ist die Frage
//    Kapazität („wie viele Termine standen im Kalender"), und die beantwortet
//    ein abgesagter Termin sehr wohl.
//    Damit die Zahl nicht verschwindet, sondern SICHTBAR wird, steht sie als
//    eigene Sektion „Absagen" unter dem Trichter — mitsamt dem Nenner, der die
//    Brücke zwischen beiden Tabs schlägt (siehe `cancelInfo`).

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

/**
 * Die sechs Stufen — je Person und in Summe dieselbe Form.
 *
 * Ohne `entschieden`: Der Trichter zeigt Mengen, keine Show-Quote. Das Feld
 * stand hier, wurde aber nie gefüllt und nie gelesen — der Nenner der
 * Show-Quote gehört zur Quellen-Ebene (`SrcCell`), wo die Quote auch steht.
 */
type Person = {
  termine: number;
  shows: number;
  quali: number;
  closings: number;
  closingShows: number;
  won: number;
  revenue: number;
};

const ZERO = (): Person => ({
  termine: 0,
  shows: 0,
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

/** Eine Zeile der Quellen-Tabelle: Freitext-Ursprung, sonst Kanal. */
type Src = {
  key: string;
  label: string;
  /** Zweite Zeile unter dem Label — der Kanal hinter dem Freitext. */
  sub: string | null;
  /** Kanal-Schlüssel; entscheidet, ob die Zeile im Quellenfilter bleibt. */
  channel: string;
};

/**
 * Herkunft eines Termins für die Quellen-Tabelle: `source_detail` schlägt
 * `source_type`.
 *
 * Diese Regel kam bisher aus dem Closing-Tab, dessen Quellen-Tabelle entfällt
 * — ohne sie ginge sie verloren. Sie trägt: Der Freitext ist der ECHTE
 * Ursprung, und ohne ihn fallen alle manuell gebuchten Termine in eine
 * Sammelzeile, die im Umsatz-Ranking regelmäßig oben steht und nichts erklärt
 * („Empfehlung" und „Bestandskunde" sind zwei Quellen, nicht eine).
 * Case-insensitiv zusammengefasst; angezeigt wird die zuerst gesehene
 * Schreibweise.
 *
 * Der Schlüssel enthält den Kanal — anders als im Closing-Tab. Grund: Der
 * Quellenfilter arbeitet auf Kanal-Ebene, und eine Zeile, in der zwei Kanäle
 * stecken, wäre entweder falsch gefiltert oder falsch gezählt. Derselbe
 * Freitext unter zwei Kanälen ergibt deshalb zwei Zeilen, die ihren Kanal
 * sichtbar untereinander tragen.
 */
function srcOf(r: { source_type: string | null | undefined; source_detail: string | null }): Src {
  const channel = channelKeyOf(r.source_type);
  const detail = (r.source_detail ?? "").trim();
  if (detail) {
    return {
      key: `d:${channel}:${detail.toLowerCase()}`,
      label: detail,
      sub: channelLabel(r.source_type),
      channel,
    };
  }
  return { key: `t:${channel}`, label: channelLabel(r.source_type), sub: null, channel };
}

/**
 * Closing ohne verknüpftes Setting: kein Fehler, sondern ein direkt angelegtes
 * oder beim Organisations-Umzug gekapptes Abschlussgespräch. Es hat keine
 * Herkunft und fällt deshalb auch aus jedem Quellenfilter heraus.
 */
const SRC_OHNE: Src = { key: OHNE_SETTING, label: "Ohne Setting-Bezug", sub: null, channel: OHNE_SETTING };

/**
 * Die Reaktions-Stufe je Kanal — die Zwischenstufe zwischen Ansprache und
 * Termin: eine Antwort auf die DM, ein erreichter Entscheider am Telefon.
 *
 * Das ist der Rest der früheren lokalen Wortliste, und er bleibt bewusst
 * lokal: Eine Reaktions-Stufe kennt die Kanal-Registry nicht (`ChannelVolume`
 * beschreibt nur das Akquise-Volumen), und es gibt sie in keinem anderen Tab.
 * Die Volumen-Wörter dagegen sind hier weg — sie kamen doppelt vor und
 * nannten die Telefon-Stufe „Anwahl", was seit dem Anruf-Log die
 * Ereignis-Ebene meint (derselbe Lead zählt dort mehrfach). Gemeint ist die
 * Firmen-Ebene: „Erstkontakt", und dieses Wort steht jetzt genau einmal, in
 * `CHANNELS[].volume.unitLabel`.
 */
const REACH_LABEL: Record<string, string> = {
  linkedin: "Antwort",
  telefon: "Entscheider",
};

type VolumeChannel = {
  key: "linkedin" | "telefon";
  label: string;
  /** Einzahl für die Verhältnis-Kachel („Umsatz pro DM"/„pro Erstkontakt"). */
  unit: string;
  /** Mehrzahl für die Bezugsgröße in der Block-Kopfzeile („Basis 1.234 DMs"). */
  stage: string;
  reach: string;
};

/**
 * Die beiden Kanäle mit eigenem Akquise-Volumen (LinkedIn, Telefon) — genau
 * die, für die es eine Stufe VOR dem Termin gibt. Aus der Registry statt aus
 * einer Literal-Liste: ein dritter Kanal mit eigener Volumen-Tabelle bekommt
 * seinen Block automatisch, sobald er dort ein `volume` trägt.
 */
const VOLUME_CHANNELS: VolumeChannel[] = CHANNELS.filter((c) => c.volume !== null).map((c) => ({
  key: c.key as "linkedin" | "telefon",
  label: c.label,
  unit: c.volume!.unitLabel,
  stage: c.volume!.stageLabel,
  reach: REACH_LABEL[c.key] ?? "Reaktion",
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
  // Die Kanal-Ebene: Sie trägt die kanalreinen Wert-Kacheln und die
  // Umsatz-Herkunft. Beide werden über ALLE Kanäle gefüllt, unabhängig vom
  // Quellenfilter — die Aufteilung muss sich auf den Gesamtumsatz summieren,
  // und die Kacheln greifen sich daraus den Block, den der Filter zeigt.
  // Zeitraum, Zählweise und Personenfilter gelten sehr wohl.
  // Bewusst nur diese vier Felder: Die Stufen-Details (Shows, Nenner der
  // Show-Quote) hängen an der feineren Quellen-Ebene direkt darunter.
  type Cell = { termine: number; closings: number; won: number; revenue: number };
  const cells = new Map<string, Cell>();
  const cellFor = (key: string): Cell => {
    let c = cells.get(key);
    if (!c) {
      c = { termine: 0, closings: 0, won: 0, revenue: 0 };
      cells.set(key, c);
    }
    return c;
  };

  // ── Quellen-Zellen ──────────────────────────────────────────
  // Eine Ebene feiner als der Kanal: je Freitext-Ursprung eine Zeile (siehe
  // `srcOf`). Basis der Quellen-Tabelle — und der Grund, warum sie die Aufgabe
  // der gelöschten Closing-Tabelle mitträgt.
  // `entschieden` = Termine mit erfasstem show_status (Nenner der Show-Quote).
  type SrcCell = {
    label: string;
    sub: string | null;
    channel: string;
    termine: number;
    shows: number;
    entschieden: number;
    closings: number;
    won: number;
    revenue: number;
  };
  const srcCells = new Map<string, SrcCell>();
  const srcFor = (s: Src): SrcCell => {
    let c = srcCells.get(s.key);
    if (!c) {
      c = {
        label: s.label,
        sub: s.sub,
        channel: s.channel,
        termine: 0,
        shows: 0,
        entschieden: 0,
        closings: 0,
        won: 0,
        revenue: 0,
      };
      srcCells.set(s.key, c);
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
    // Nenner der Abschlussrate: erschienene Closings, nicht alle. Deckungsgleich
    // mit Closing-Tab und Vergleichsseite — dieselbe Kennzahl darf nicht je nach
    // Ansicht einen anderen Nenner haben.
    closingShows: {} as Record<string, number>,
    won: {} as Record<string, number>,
  };
  const addBucket = (map: Record<string, number>, day: string, n = 1): void => {
    if (n === 0) return;
    const k = bucketOf(day, from, toEff, granularity);
    map[k] = (map[k] ?? 0) + n;
  };

  // ── Absagen (Entscheidung K5) ───────────────────────────────
  // Zwei getrennte Töpfe, weil Setting- und Closing-Absagen verschiedene
  // Grundgesamtheiten haben — eine gemeinsame Quote mischte zwei Nenner.
  //
  // NENNER = ALLE Termine des Fensters, abgesagte EINGESCHLOSSEN. Das ist der
  // einzige ehrliche Nenner: Eine Absage kann jeden geplanten Termin treffen,
  // und nur so gilt „Trichter-Termine + Absagen = Termine im Setting-Tab" —
  // die Absagequote ist damit genau die Brücke zwischen den beiden Zahlen, die
  // sich zwischen den Tabs unterscheiden. Der naheliegende Nenner „Termine mit
  // erfasstem Ergebnis" (wie bei der Show-Quote) wäre hier strukturell falsch:
  // ein abgesagter Termin bekommt NIE ein show_status und stünde nie im
  // eigenen Nenner — die Quote wäre konstant 0 %.
  //
  // Beide Töpfe zählen auf dem eigenen Termindatum, also in PERIODENsicht,
  // unabhängig vom Zählweise-Umschalter: Eine Absage ist ein Ereignis des
  // Termins, nicht seiner Kohorte. Für Settings ist das ohnehin dieselbe
  // Menge; für Closings sagt es die Meta-Zeile.
  type CancelAgg = {
    total: number;
    cancelled: number;
    ohneAussicht: number;
    neuerTermin: number;
  };
  const ZERO_CANCEL = (): CancelAgg => ({ total: 0, cancelled: 0, ohneAussicht: 0, neuerTermin: 0 });
  const cancelSetting = ZERO_CANCEL();
  const cancelClosing = ZERO_CANCEL();
  /** Absagegründe über BEIDE Termin-Arten — der CHECK ist derselbe (0032). */
  const cancelReasons = new Map<string, number>();

  const addCancel = (
    agg: CancelAgg,
    r: { cancelled_at: string | null; cancel_outlook: string | null; cancel_reason_code: string | null },
  ): void => {
    agg.total += 1;
    if (!r.cancelled_at) return;
    agg.cancelled += 1;
    if (r.cancel_outlook === "ohne_aussicht") agg.ohneAussicht += 1;
    else if (r.cancel_outlook === "neuer_termin") agg.neuerTermin += 1;
    const code = r.cancel_reason_code ?? "";
    cancelReasons.set(code, (cancelReasons.get(code) ?? 0) + 1);
  };

  /**
   * Älteste erfasste Absage überhaupt — ohne Zeitraum- und ohne Personenfilter,
   * über beide Tabellen. Ohne diesen Anker läse sich ein Fenster von VOR dem
   * Umbau wie „es wurde nie abgesagt", obwohl es damals schlicht kein Feld
   * dafür gab: Es gibt bewusst keinen Backfill. Muster: `firstCalledAt` im
   * Anruf-Log (src/lib/phoneAttemptsData.ts).
   */
  const earliestCancel = (rows: { cancelled_at: string | null }[], start: string | null): string | null =>
    rows.reduce<string | null>(
      (min, r) => (r.cancelled_at && (min === null || r.cancelled_at < min) ? r.cancelled_at : min),
      start,
    );
  const firstCancelledAt = earliestCancel(closingRows, earliestCancel(settingRows, null));

  // ── Setting-Calls ───────────────────────────────────────────
  // `srcOfSetting` deckt ALLE Settings ab, auch die außerhalb des Fensters: in
  // der Periodensicht kann ein Closing zu einem älteren Termin gehören, und
  // ohne diesen Eintrag landete sein Umsatz fälschlich unter "Ohne
  // Setting-Bezug" statt bei seiner Quelle.
  const srcOfSetting = new Map<string, Src>();
  // Die Kohorte: Setting-ID → Person + Tag + Herkunft. Was hier fehlt, gehört
  // nicht zum Zeitraum. Bewusst OHNE Quellenfilter — der greift erst beim
  // Funnel, damit Kanal- und Quellen-Zellen vollständig bleiben.
  const cohort = new Map<string, { name: string; day: string; src: Src }>();

  for (const r of settingRows) {
    const src = srcOf(r);
    const channel = src.channel;
    srcOfSetting.set(r.id, src);

    // `toEff` statt `to`: ein Termin, der erst noch ansteht, gehört nicht in
    // eine Konversionsrechnung (siehe Zeitgrenze oben).
    const day = settingEffDate(r);
    if (day < from || day > toEff) continue;
    const name = resolvePerson(r);
    if (!name) continue;

    // Absagequote ZUERST — ihr Nenner ist die volle Menge, also auch der
    // Termin, den die Zeile darunter gerade aus dem Trichter nimmt.
    if (quelle === "alle" || channel === quelle) addCancel(cancelSetting, r);
    // Ab hier läuft nur noch, was wirklich stattgefunden hat oder ansteht:
    // Ein abgesagter Termin hat weder Show noch Qualifizierung noch Closing und
    // stünde als garantierte Null in jeder Durchlaufquote (Punkt 9 oben).
    if (r.cancelled_at) continue;

    const show = r.show_status === "show";
    const quali = isQualified(r);
    cohort.set(r.id, { name, day, src });

    cellFor(channel).termine += 1;

    const sc = srcFor(src);
    sc.termine += 1;
    if (show) sc.shows += 1;
    // Nenner der Show-Quote: nur Termine MIT erfasstem Ergebnis — identisch zu
    // Setting- und Uebersichtstab. Gegen alle Termine gerechnet saehe dieselbe
    // Kennzahl hier anders aus als dort.
    if (r.show_status === "show" || r.show_status === "no_show") sc.entschieden += 1;

    // Der Funnel darunter folgt dem Quellenfilter; Kanal- und Quellen-Zellen
    // oben bleiben vollständig und werden erst beim Rendern zugeschnitten.
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

    // Absagequote der Closings: immer auf dem eigenen Termindatum, auch in der
    // Kohortensicht (Begründung bei `cancelSetting`). Die Herkunft kommt über
    // das Setting, damit der Quellenfilter greift wie überall sonst.
    const cancelDay = closingEffDate(r);
    if (cancelDay >= from && cancelDay <= toEff) {
      const cancelChannel =
        ((r.setting_call_id ? srcOfSetting.get(r.setting_call_id) : null) ?? SRC_OHNE).channel;
      if (resolvePerson(r) && (quelle === "alle" || cancelChannel === quelle)) {
        addCancel(cancelClosing, r);
      }
    }
    if (r.cancelled_at) continue;

    const inCohort = r.setting_call_id ? cohort.get(r.setting_call_id) : undefined;

    let name: string | null;
    let day: string;
    let src: Src;

    if (modus === "kohorte") {
      // Das Closing folgt seinem Setting: Es zählt genau dann, wenn dieses
      // Setting zur Kohorte gehört — unabhängig vom Closing-Datum. Auch
      // Person, Herkunft und Bucket kommen vom Setting, sonst risse eine Zeile
      // auseinander (Termin bei A, Abschluss bei B) und die Durchlaufquote
      // wäre wieder unecht.
      if (!inCohort) continue;
      name = inCohort.name;
      day = inCohort.day;
      src = inCohort.src;
    } else {
      day = closingEffDate(r);
      if (day < from || day > toEff) continue;
      name = resolvePerson(r);
      if (!name) continue;
      src = (r.setting_call_id ? srcOfSetting.get(r.setting_call_id) : null) ?? SRC_OHNE;
    }

    const channel = src.channel;
    const show = r.show_status === "show";
    const won = r.status === "gewonnen";
    const vol = won ? NUM(r.deal_volume) : 0;

    const cell = cellFor(channel);
    cell.closings += 1;
    if (won) {
      cell.won += 1;
      cell.revenue += vol;
    }

    const sc = srcFor(src);
    sc.closings += 1;
    if (won) {
      sc.won += 1;
      sc.revenue += vol;
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
    if (show) addBucket(byBucket.closingShows, day);
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

  /**
   * Ein Kachel-Block. `volume === null` heißt: Für diese Quelle beginnt der
   * Funnel erst beim Termin — es gibt keine Tabelle mit „so viele haben wir
   * angesprochen" (Ads, Social Media, Manuell …).
   */
  type TileBlock = { key: string; label: string; volume: VolumeChannel | null };

  /**
   * Hier greift der Quellenfilter — bis hierher tat er das nicht, und ein
   * Filter, der die halbe Seite unberührt lässt, liest sich als Defekt.
   *
   * Ohne Filter: die beiden Kanäle mit eigenem Akquise-Volumen nebeneinander,
   * damit der Vergleich nicht von der Filterstellung abhängt. Mit Filter:
   * genau der gewählte Kanal — wer „Telefon" wählt, will nicht daneben die
   * LinkedIn-Kacheln lesen. Für einen Kanal ohne eigenes Volumen bleiben die
   * zwei Kacheln, die es für ihn gibt; die LinkedIn- und Telefon-Kacheln unter
   * einem Ads-Filter wären keine Vergleichsgröße, sondern die falsche Antwort.
   */
  const tileBlocks: TileBlock[] =
    quelle === "alle"
      ? VOLUME_CHANNELS.map((c) => ({ key: c.key, label: c.label, volume: c }))
      : [
          {
            key: quelle,
            label: channelLabel(quelle),
            volume: VOLUME_CHANNELS.find((c) => c.key === quelle) ?? null,
          },
        ];

  /** Die Wert-Kacheln eines Blocks: vier mit Akquise-Volumen, sonst zwei. */
  const tilesFor = (block: TileBlock): Tile[] => {
    const cell = cells.get(block.key);
    const revenue = cell?.revenue ?? 0;
    const tiles: Tile[] = [];

    if (block.volume) {
      const vol = volume[block.volume.key];
      const isLinkedIn = block.volume.key === "linkedin";
      tiles.push({
        label: `Umsatz pro ${block.volume.unit}`,
        value: perValue(revenue, vol.total),
        icon: isLinkedIn ? <Euro size={15} /> : <PhoneCall size={15} />,
      });
      tiles.push({
        label: `Umsatz pro ${block.volume.reach}`,
        value: perValue(revenue, vol.reach),
        icon: isLinkedIn ? <MessageCircle size={15} /> : <UserRound size={15} />,
      });
    }

    tiles.push({
      label: "Umsatz pro Setting",
      value: perValue(revenue, cell?.termine ?? 0),
      icon: <CalendarCheck size={15} />,
    });
    tiles.push({
      label: "Umsatz pro Closing",
      value: perValue(revenue, cell?.closings ?? 0),
      icon: <Handshake size={15} />,
    });
    return tiles;
  };

  /**
   * Die Bezugsgröße eines Blocks in einer Zeile — acht gleich große
   * Eurobeträge ohne Nenner sagen nichts: „12 € pro DM" ist über 30 DMs eine
   * Zufallszahl und über 3.000 eine Aussage. Deshalb steht die Basis in der
   * Kopfzeile, statt eine der Kacheln zur Leitzahl zu erklären (siehe Punkt 6
   * im Kopfkommentar).
   */
  const blockBasis = (block: TileBlock): string => {
    const won = (cells.get(block.key)?.won ?? 0).toLocaleString("de-DE");
    const head = `${eur(revenueOf(block.key))} aus ${won} Abschlüssen`;
    if (!block.volume) return `${head} · keine Stufe vor dem Termin`;
    const vol = volume[block.volume.key];
    return `${head} · Basis ${vol.total.toLocaleString("de-DE")} ${block.volume.stage}`;
  };

  const quelleLabel = quelle === "alle" ? "Alle Quellen" : channelLabel(quelle);
  const modusLabel = modus === "kohorte" ? "Kohorte" : "Periode";

  // ── Absagen: Kennzahlen und Ehrlichkeit über die Datenlage ───
  const cancelTotal = cancelSetting.cancelled + cancelClosing.cancelled;
  /**
   * Deckt der Zeitraum die Erfassung überhaupt ab? Vor dem Umbau gab es das
   * Feld nicht — dort heißt „keine Absage" nicht „niemand hat abgesagt",
   * sondern „wurde damals nicht erfasst". Eine 0 % wäre an dieser Stelle eine
   * Falschaussage, deshalb `null` (die Anzeige zeigt „—") plus eine Zeile mit
   * dem Grund. Wortgleiches Muster: die Leitkachel „Anwahlen" im Telefon-Tab.
   */
  const cancelStartDay = firstCancelledAt ? berlinDateISO(firstCancelledAt) : null;
  const cancelCovers = cancelStartDay !== null && cancelStartDay <= to;
  const cancelNote = !cancelCovers
    ? cancelStartDay === null
      ? "bisher keine Absage erfasst — die Felder dafür gibt es erst seit dem Nachfassen-Umbau, und es gibt keinen Backfill."
      : `Absagen werden erst seit dem ${fmtDay(cancelStartDay)} erfasst; dieser Zeitraum liegt davor.`
    : cancelStartDay > from
      ? `Absagen sind erst ab dem ${fmtDay(cancelStartDay)} erfasst — für die Tage davor steht im Zähler zwangsläufig nichts.`
      : null;
  const settingCancelRate = cancelCovers ? pct(cancelSetting.cancelled, cancelSetting.total) : null;
  const closingCancelRate = cancelCovers ? pct(cancelClosing.cancelled, cancelClosing.total) : null;

  const cancelReasonRows: MetricRow[] = [...cancelReasons.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de"))
    .map(([code, n]) => ({
      key: code || "ohne",
      // Ein unbekannter Code wird roh gezeigt statt still als „Sonstiges"
      // verbucht — dieselbe Regel wie in der Ablage.
      label: code ? dropoutReasonLabel(code) : "Ohne Angabe",
      share: cancelTotal === 0 ? null : n / cancelTotal,
      values: { n },
    }));

  /**
   * Der Zusatz in jeder Meta-Zeile, die eine Trichterstufe zeigt. Er steht da
   * IMMER, auch bei null Absagen: Er beschreibt die Definition, nicht den
   * Befund — und eine unerklärte Abweichung zwischen zwei Tabs ist schlimmer
   * als beide Varianten.
   */
  const ohneAbsagen =
    cancelTotal > 0 ? ` · ohne ${cancelTotal.toLocaleString("de-DE")} Absagen` : " · ohne Absagen";
  // Die Zeitgrenze steht IN der Meta-Zeile, nicht nur im Info-Text: Sie ist der
  // Grund, warum dieselbe Woche hier weniger Termine zeigt als im Setting-Tab,
  // und diese Frage stellt sich beim Lesen der Zahl — nicht erst beim Klick.
  const windowLabel = futureOnly
    ? `${fmtDay(from)} – ${fmtDay(to)} · noch kein Termin stattgefunden`
    : `${fmtDay(from)} – ${fmtDay(toEff)}${clamped ? " · nur bis heute" : ""}`;
  const rangeMeta = `${windowLabel} · ${quelleLabel} · ${modusLabel}${ohneAbsagen}`;
  /**
   * Meta-Zeile der einen Sektion, die dem Quellenfilter NICHT folgen kann:
   * „Wo kommt der Umsatz her?" teilt den Gesamtumsatz auf die Kanäle auf. Mit
   * gesetztem Filter bliebe eine Aufteilung mit einem einzigen Summanden, und
   * „Gesamt" wäre nicht mehr das Gesamt. Statt den Widerspruch unkommentiert
   * stehen zu lassen — der Filter sagt „Telefon", die Zeile zeigt
   * LinkedIn-Umsatz —, sagt die Sektion selbst, dass er hier nicht gilt.
   */
  const alleQuellenMeta = `${windowLabel} · ${modusLabel} · alle Quellen${
    quelle === "alle" ? "" : " (Filter gilt hier nicht)"
  }`;

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

  /**
   * Der Absagen-Ausschluss, ebenfalls in JEDER Sektion mit Trichterstufen. Er
   * ist der ZWEITE Grund, warum die Termin-Zahl hier kleiner sein darf als im
   * Setting-Tab — wer nur die Zeitgrenze liest, hält die verbleibende Differenz
   * für einen Fehler.
   */
  const absagenInfo = (
    <p style={INFO_P}>
      <strong style={INFO_STRONG}>Ohne abgesagte Termine.</strong> Ein abgesagter Termin
      (<code>cancelled_at</code>) hat nie stattgefunden: keine Show, keine Qualifizierung, kein Closing. Als
      Stufe mitgezählt wäre er eine garantierte Null in jeder Durchlaufquote — jede Quote wäre ab dem Tag
      gesunken, an dem die Absage-Erfassung anlief, ohne dass sich am Vertrieb etwas geändert hätte.
      Übersicht, Setting-Tab und Kalender behalten sie dagegen: Dort ist die Frage, wie viele Termine im
      Kalender standen (Kapazität), und die beantwortet auch ein abgesagter Termin. Wie groß der Unterschied
      ist, steht in der Sektion &bdquo;Absagen&ldquo;.
    </p>
  );

  // ── Quellen-Tabelle ─────────────────────────────────────────
  // Sichtbar sind die Quellen des aktiven Filters — Anteilsbalken und
  // Gesamtzeile rechnen deshalb über genau die Zeilen, die auch dastehen.
  // Eine Gesamtzeile, die mehr summiert als die Tabelle zeigt, wäre der
  // nächste Widerspruch derselben Art.
  const srcVisible = [...srcCells.entries()]
    .filter(([, c]) => (c.termine > 0 || c.closings > 0) && (quelle === "alle" || c.channel === quelle))
    .sort((a, b) => b[1].revenue - a[1].revenue || b[1].termine - a[1].termine);

  const matrixBase = srcVisible.reduce((acc, [, c]) => acc + c.termine, 0);

  // ── Zeilenzahl: Sammelzeile statt Mindestmenge ──────────────
  // Mit der Freitext-Auflösung kann die Tabelle beliebig lang werden — jede
  // Schreibweise von „Empfehlung Meier" ist eine eigene Zeile.
  //
  // Bewusst eine Sammelzeile und KEINE Mindestmenge (wie `min` im Listen-Tab):
  // Diese Tabelle ist nach Umsatz sortiert, und eine Mindestmenge („erst ab 5
  // Terminen") verschluckte ausgerechnet die Zeile, für die es diese
  // Auswertung gibt — eine Quelle mit einem Termin und einem 20.000-€-Deal.
  // Die Sammelzeile verliert keinen Euro und hält die Gesamtzeile gleich der
  // Summe des Sichtbaren.
  const MAX_SOURCE_ROWS = 8;

  // „Ohne Setting-Bezug" zählt nicht gegen das Limit und wandert nie in die
  // Sammelzeile: Das ist keine Quelle, sondern der Hinweis, dass diese Zahlen
  // zu keiner gehören — unter „Übrige Quellen" wäre er als eine ausgewiesen.
  const shownSrc: [string, SrcCell][] = [];
  const restSrc: [string, SrcCell][] = [];
  let shownCount = 0;
  for (const entry of srcVisible) {
    if (entry[0] === OHNE_SETTING || shownCount < MAX_SOURCE_ROWS) {
      shownSrc.push(entry);
      if (entry[0] !== OHNE_SETTING) shownCount += 1;
      continue;
    }
    restSrc.push(entry);
  }
  // Eine einzelne Restzeile bleibt sie selbst: „Übrige Quellen (1)" versteckt
  // einen Namen und spart keine Zeile.
  if (restSrc.length === 1) shownSrc.push(...restSrc.splice(0, 1));

  const matrixRows: MetricRow[] = shownSrc.map(([key, c]) => ({
    key,
    label: c.label,
    // Der Kanal unter dem Freitext: „Empfehlung" allein sagt nicht, über
    // welchen Weg der Termin entstanden ist.
    sub: c.sub,
    share: matrixBase === 0 ? null : c.termine / matrixBase,
    values: {
      termine: c.termine,
      showRate: pct(c.shows, c.entschieden),
      closings: c.closings,
      won: c.won,
      revenue: c.revenue,
    },
  }));

  if (restSrc.length > 0) {
    const rest = restSrc.reduce(
      (acc, [, c]) => {
        acc.termine += c.termine;
        acc.shows += c.shows;
        acc.entschieden += c.entschieden;
        acc.closings += c.closings;
        acc.won += c.won;
        acc.revenue += c.revenue;
        return acc;
      },
      { termine: 0, shows: 0, entschieden: 0, closings: 0, won: 0, revenue: 0 },
    );
    matrixRows.push({
      key: "rest",
      label: "Übrige Quellen",
      sub: `${restSrc.length} Quellen unterhalb der Top ${MAX_SOURCE_ROWS}`,
      share: matrixBase === 0 ? null : rest.termine / matrixBase,
      values: {
        termine: rest.termine,
        showRate: pct(rest.shows, rest.entschieden),
        closings: rest.closings,
        won: rest.won,
        revenue: rest.revenue,
      },
    });
  }
  const matrixTotal = srcVisible.reduce(
    (acc, [, c]) => {
      acc.termine += c.termine;
      acc.shows += c.shows;
      acc.entschieden += c.entschieden;
      acc.closings += c.closings;
      acc.won += c.won;
      acc.revenue += c.revenue;
      return acc;
    },
    { termine: 0, shows: 0, entschieden: 0, closings: 0, won: 0, revenue: 0 },
  );

  return (
    <>
      {/* ── Umsatz je Stufe, je Kanal ────────────────────────────
             KEINE Kachel trägt `lead`: Die Blöcke stehen als Vergleich
             nebeneinander, und die Leitzahl-Auszeichnung würde einen der
             Kanäle über den anderen stellen (Begründung: Punkt 6 oben). Die
             Kernaussage des Tabs ist der Trichter. */}
      {tileBlocks.map((block, blockIndex) => (
        <div key={block.key} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-4)", flexWrap: "wrap" }}>
            <span className="eyebrow eyebrow-muted">Umsatz je Stufe · {block.label}</span>
            <span
              style={{
                fontSize: "var(--fs-xs)",
                color: "var(--text-subtle)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {blockBasis(block)}
            </span>
          </div>
          <KpiRow>
            {tilesFor(block).map((t, i) => (
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
          meta={alleQuellenMeta}
          collapsible
          info={
            <InfoText>
              <p style={INFO_P}>
                Diese vier Zahlen zeigen <strong style={INFO_STRONG}>immer alle Quellen</strong> — als einzige
                Sektion des Tabs. Sie teilen den Gesamtumsatz auf; mit gesetztem Quellenfilter bliebe eine
                Aufteilung mit einem einzigen Summanden übrig, und &bdquo;Gesamt&ldquo; wäre nicht mehr das
                Gesamt. Alles andere auf dieser Seite folgt dem Filter.
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
              {absagenInfo}
              <p style={INFO_P}>
                Alle sechs Stufen kommen aus <code>setting_calls</code> und <code>closing_calls</code>;
                &bdquo;Qualifiziert&ldquo; ist dieselbe Definition wie im Setting-Tab (erschienen <em>und</em>{" "}
                Status qualifiziert bzw. Closing gelegt). Die Kacheln oben stammen aus derselben Menge, ihre
                Nenner (DMs, Antworten, Erstkontakte, Entscheider) dagegen aus den Tages-RPCs.
                &bdquo;Erstkontakte&ldquo; sind Firmen mit erstem Anruf — nicht die Wählversuche aus dem
                Anruf-Log, die im Telefon-Tab als &bdquo;Anwahlen&ldquo; stehen und denselben Lead mehrfach
                zählen.
              </p>
            </InfoText>
          }
        >
          <BarFunnel stages={totalStages} trailing={{ label: "Umsatz", value: eur(sum.revenue) }} />
        </AnalyseSection>
      </div>

      {/* ── Absagen ──────────────────────────────────────────────
             Steht direkt UNTER dem Trichter, nicht irgendwo weiter unten: Sie
             ist die Erklärung für die Zahl, die man gerade gelesen hat. Eine
             ausgeschlossene Größe, die nirgends mehr auftaucht, ist aus Sicht
             des Lesers verschwunden — und eine verschwundene Zahl ist genauso
             schlimm wie eine verfälschte. Startet zugeklappt: Die Kernaussage
             steht in der Meta-Zeile. */}
      <div className="fade-up" style={{ animationDelay: "255ms" }}>
        <AnalyseSection
          title="Absagen"
          icon={CalendarX}
          meta={
            cancelCovers
              ? `${fmtPct(settingCancelRate)} der Settingtermine · ${cancelTotal.toLocaleString("de-DE")} Absagen`
              : "noch keine Absagen erfasst"
          }
          collapsible
          defaultOpen={false}
          info={
            <InfoText>
              <p style={INFO_P}>
                <strong style={INFO_STRONG}>Absagequote = abgesagte Termine ÷ ALLE Termine des Zeitraums</strong>{" "}
                — abgesagte eingeschlossen. Das ist der einzige ehrliche Nenner: Eine Absage kann jeden
                geplanten Termin treffen, und nur so gilt &bdquo;Termine im Trichter + Absagen = Termine im
                Setting-Tab&ldquo;. Diese Quote ist damit genau die Brücke zwischen den beiden Zahlen, die
                sich zwischen den Tabs unterscheiden.
              </p>
              <p style={INFO_P}>
                Der Nenner der Show-Quote (&bdquo;Termine mit erfasstem Ergebnis&ldquo;) taugt hier
                <strong style={INFO_STRONG}> nicht</strong>: Ein abgesagter Termin bekommt nie ein
                Erschienen-Kennzeichen, stünde also nie im eigenen Nenner — die Quote läge konstant bei 0 %.
              </p>
              <p style={INFO_P}>
                Beide Quoten zählen auf dem eigenen Termindatum, also in <em>Periodensicht</em> — unabhängig
                vom Zählweise-Umschalter oben. Eine Absage ist ein Ereignis des Termins, nicht seiner Kohorte.
                Für die Settingtermine ist das ohnehin dieselbe Menge; bei den Closings kann die Zahl in der
                Kohortensicht deshalb neben dem Trichter stehen, statt sich mit ihm zu addieren.
              </p>
              <p style={INFO_P}>
                <strong style={INFO_STRONG}>Ohne Aussicht</strong> heißt: kein Ersatztermin in Sicht — der Lead
                geht in die Ablage und später ins Recycling. <strong style={INFO_STRONG}>Neuer Termin</strong>{" "}
                heißt: verschoben, der Vorgang bleibt in der Terminliste. Zwei sehr verschiedene Ereignisse unter
                einem Wort, deshalb stehen sie getrennt.
              </p>
            </InfoText>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
            <StatRow
              items={[
                {
                  label: "Absagequote Setting",
                  value: fmtPct(settingCancelRate),
                  tone: settingCancelRate !== null && settingCancelRate >= 20 ? "warning" : "default",
                },
                {
                  label: "Absagequote Closing",
                  value: fmtPct(closingCancelRate),
                  tone: closingCancelRate !== null && closingCancelRate >= 20 ? "warning" : "default",
                },
                {
                  label: "Ohne Aussicht",
                  value: cancelCovers
                    ? (cancelSetting.ohneAussicht + cancelClosing.ohneAussicht).toLocaleString("de-DE")
                    : "—",
                },
                {
                  label: "Neuer Termin",
                  value: cancelCovers
                    ? (cancelSetting.neuerTermin + cancelClosing.neuerTermin).toLocaleString("de-DE")
                    : "—",
                },
              ]}
            />
            <div>
              <div className="eyebrow eyebrow-muted" style={{ marginBottom: "var(--sp-5)" }}>
                Warum abgesagt wurde
                {/* Nenner beider Quoten offen hinschreiben — eine Quote ohne
                    ihre Basis ist bei kleinen Mengen eine Zufallszahl. */}
                {cancelCovers && ` · Basis ${cancelSetting.total.toLocaleString("de-DE")} Setting- und ${cancelClosing.total.toLocaleString("de-DE")} Closingtermine`}
              </div>
              <MetricTable
                label="Grund"
                columns={[{ key: "n", label: "Absagen", format: "int", emphasis: true }]}
                rows={cancelReasonRows}
                minWidth={320}
                emptyHint={
                  cancelCovers
                    ? "Im Zeitraum wurde kein Termin abgesagt."
                    : "Für diesen Zeitraum gibt es noch keine Absage-Erfassung."
                }
              />
            </div>
            {/* Muster Anruf-Log: „leer" heißt hier „gab es damals noch nicht",
                nicht „niemand hat abgesagt". Ohne diesen Satz läse sich eine
                0 % als Erfolg, obwohl sie nur das Deploy-Datum beschreibt. */}
            {cancelNote && <Footnote>{cancelNote}</Footnote>}
          </div>
        </AnalyseSection>
      </div>

      {/* ── Fortschritt im Zeitraum ──────────────────────────────
             Startet zugeklappt: ein Verlaufs-Chart beantwortet keine Frage,
             die man beim Öffnen der Seite stellt — er beantwortet die zweite. */}
      <div className="fade-up" style={{ animationDelay: "270ms" }}>
        <AnalyseSection
          title="Fortschritt"
          icon={TrendingUp}
          // Der Quellenfilter steht auch hier in der Meta-Zeile: Die Kurven
          // folgen ihm, und ohne den Hinweis wirkte eine gefilterte Kurve wie
          // ein Einbruch statt wie ein Ausschnitt.
          meta={`kumuliert · ${quelleLabel}${ohneAbsagen}`}
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
              {absagenInfo}
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
              { key: "winRate", label: "Abschlussrate", kind: "rate", values: byBucket.won, denominator: byBucket.closingShows },
            ]}
            rangeLabel={`${fmtDay(from)} – ${fmtDay(toEff)}`}
          />
        </AnalyseSection>
      </div>

      {/* ── Quellen-Tabelle ────────────────────────────────────────
             Ab zwei Zeilen: Eine einzelne Zeile wiederholte nur den Trichter
             darüber, mit Gesamtzeile darunter sogar zweimal. Der frühere
             Schnitt („nur ohne Quellenfilter") stammte aus derselben
             Überlegung, verlor aber die Aufschlüsselung eines gefilterten
             Kanals in seine Freitext-Quellen — genau das, was diese Tabelle
             seit dem Wegfall der Closing-Tabelle leisten muss. */}
      {matrixRows.length > 1 && (
        <div className="fade-up" style={{ animationDelay: "300ms" }}>
          {/* Startet offen: die einzige Tabelle des Tabs und die Antwort auf
              „welche Quelle trägt den Trichter" — dieselbe Rangordnung wie der
              Trichter selbst, nur aufgeschlüsselt. */}
          <AnalyseSection
            title="Je Quelle"
            icon={GitBranch}
            meta={`derselbe Trichter, aufgeschlüsselt nach Herkunft${ohneAbsagen}`}
            collapsible
            info={
              <InfoText>
                <p style={INFO_P}>
                  Aufgeschlüsselt nach dem Freitext-Ursprung (<code>source_detail</code>), wo einer hinterlegt
                  ist — sonst nach dem Kanal. Ohne diesen Schritt lägen alle manuell gebuchten Termine in einer
                  Sammelzeile, die im Umsatz-Ranking meist oben steht und nichts erklärt:
                  &bdquo;Empfehlung&ldquo; und &bdquo;Bestandskunde&ldquo; sind zwei Quellen, nicht eine. Die
                  zweite Zeile unter dem Namen nennt den Kanal, über den der Termin lief. Zeilen ohne
                  verknüpftes Setting stehen unter &bdquo;Ohne Setting-Bezug&ldquo; — kein Fehler, sondern ein
                  direkt angelegtes oder beim Organisations-Umzug gekapptes Closing.
                </p>
                <p style={INFO_P}>
                  <strong style={INFO_STRONG}>Nur eine Prozentzahl, und die hat einen bekannten Nenner:</strong>{" "}
                  Die Show-Quote rechnet gegen die Termine mit erfasstem Ergebnis, wie im Setting-Tab. Die
                  früheren Spalten &bdquo;Show → Closing&ldquo; und &bdquo;Closing → Win&ldquo; standen daneben
                  und rechneten gegen andere Nenner — drei Prozentzahlen nebeneinander, die man nicht
                  vergleichen kann. Der Durchlauf zwischen den Stufen steht im Trichter oben, wo er hingehört.
                  Abschlussrate und Umsatz je Gespräch stehen als Mengen in derselben Zeile: Gewonnen gegen
                  Closings, Umsatz gegen Closings.
                </p>
                <p style={INFO_P}>
                  Die Tabelle folgt derselben Zählweise wie der Trichter ({modusLabel}) und demselben
                  Quellenfilter; Anteilsbalken und Gesamtzeile rechnen über genau die Zeilen, die hier stehen.
                  Ab {MAX_SOURCE_ROWS} Quellen sammelt eine Zeile &bdquo;Übrige Quellen&ldquo; den Rest ein —
                  keine Mindestmenge, weil sonst gerade die kleine Quelle mit dem großen Abschluss wegfiele.
                </p>
                {zeitgrenzeInfo}
                {absagenInfo}
              </InfoText>
            }
          >
            <MetricTable
              label="Quelle"
              // Fünf Spalten, links nach rechts eine Erzählung: wie viel kam
              // rein (Termine), wie viel davon war echt (Show-Quote), wie weit
              // kam es (Closings), was wurde daraus (Gewonnen, Umsatz). Damit
              // passt die Tabelle auf einen 13-Zoll-Laptop, ohne zu scrollen.
              columns={[
                { key: "termine", label: "Termine", format: "int" },
                { key: "showRate", label: "Show-Quote", format: "pct" },
                { key: "closings", label: "Closings", format: "int" },
                { key: "won", label: "Gewonnen", format: "int" },
                { key: "revenue", label: "Umsatz", format: "eur", emphasis: true },
              ]}
              rows={matrixRows}
              total={{
                termine: matrixTotal.termine,
                showRate: pct(matrixTotal.shows, matrixTotal.entschieden),
                closings: matrixTotal.closings,
                won: matrixTotal.won,
                revenue: matrixTotal.revenue,
              }}
              minWidth={560}
            />
          </AnalyseSection>
        </div>
      )}
    </>
  );
}
