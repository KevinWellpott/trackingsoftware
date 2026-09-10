// Ablage: was aus dem Funnel gefallen ist — reine Bibliothek (kein
// "use server"/"use client"), Muster recycleCadence.ts.
//
// Die Zugehörigkeit steht in keiner Tabelle, sondern wird in `dropout_lists()`
// (Migration 0033) aus dem Zeilenzustand abgeleitet — eine Ablage-Tabelle wäre
// eine zweite Wahrheit neben `status` und `cancelled_at` und liefe beim ersten
// Statuswechsel auseinander.
//
// ── Rückbau: aus sechs Reitern werden zwei ───────────────────────────────────
// Die sechs Reiter der RPC hatten ihren Sinn, solange der Grund eine FOLGE
// hatte: Er bestimmte die Recycling-Wartezeit und die Kaskade. Beides ist
// gefallen — eine Frist für alle, keine Kaskade. Damit unterscheiden vier der
// sechs Listen nur noch die Art des Endes, und die steht ohnehin auf jeder
// Karte. Vier Reiter für „ist raus" sind genau die Sorte Aufteilung, gegen die
// sich dieser Rückbau richtet.
//
// Was bleibt, sind die beiden Ansichten, die etwas ANDERES sind als der Rest:
//   · Ausgeschieden — alles, was aus dem Funnel gefallen ist, in EINER Liste.
//   · Gesperrt      — das Kontaktverbot. Org-weit sichtbar, deckt als einzige
//                     alle vier Ursprungstabellen ab.
//
// Und eine Liste ist GANZ weg: „Abgesagt, Ersatztermin steht aus" beschreibt
// keinen Endzustand, sondern einen Lead ohne nächsten Termin — also genau den,
// der in der Hauptliste steht und täglich genervt wird. Ein Archivreiter für
// offene Arbeit war schon vorher die Ausnahme (er war der einzige mit einem
// Zähler); jetzt ist er eine zweite, stille Arbeitsliste neben der einen
// richtigen.
//
// Diese Datei hält nur das, was Seite, Board und Server-Action GEMEINSAM
// brauchen: die beiden Ansichten samt ihrer Quellen, die Beschriftung der
// Gründe und die eine Regel, wann ein Recycling überhaupt vorgezogen werden darf.

import { RECYCLE_REASON_LABELS } from "@/lib/recycleCadence";
import { CLOSING_LOST_REASON_LABELS } from "@/lib/types";

/**
 * Die Werte, die die App an `dropout_lists(p_list)` schickt.
 *
 * Die RPC ist eingefroren (Migration 0033) und kennt einen sechsten Wert,
 * `ersatztermin_offen`. Er steht hier bewusst NICHT: Die App fragt ihn nicht
 * mehr ab, seit der Zustand „abgesagt, kein Ersatz" in die Hauptliste gehört.
 * Ein Schlüssel, den niemand sendet, gehört nicht in einen Typ, der beschreibt,
 * was gesendet wird.
 */
export type DropoutSourceList =
  | "abgesagt"
  | "disqualifiziert"
  | "kein_close"
  | "no_show_ohne_antwort"
  | "gesperrt";

/** Die beiden Ansichten der Ablage — `?liste=`. */
export type DropoutListKey = "ausgeschieden" | "gesperrt";

/**
 * Die beiden Termin-Tabellen. Alles außer der Sperrliste kennt nur sie: Absage,
 * Disqualifizierung, Verlust und No-Show sind Ereignisse, die es ausschließlich
 * an einem Termin gibt.
 */
export type DropoutAppointmentEntity = "setting" | "closing";

/**
 * Die beiden Lead-Tabellen — sie erscheinen ausschließlich in der Sperrliste.
 * Gesperrt wird über `recycle_excluded_at`, und das steht auf allen vier
 * Recycling-Tabellen; „Endgültig sperren" ist im Nachfassen-Board für alle vier
 * Ursprünge anklickbar. Blieben sie hier draußen, verschwände ein so gesperrter
 * LinkedIn- oder Telefon-Kontakt aus jeder Ansicht — und ein Kontaktverbot, das
 * niemand sieht, ist keines. Genau das ist der Grund, aus dem diese eine Liste
 * org-weit liefert.
 */
export type DropoutLeadEntity = "linkedin" | "telefon";

/** `dropout_lists.entity_type` — vier Ursprünge, aber nicht in jeder Liste. */
export type DropoutEntity = DropoutAppointmentEntity | DropoutLeadEntity;

export type DropoutListMeta = {
  key: DropoutListKey;
  /** Kurzform für die Umschaltleiste. */
  tab: string;
  /** Ausgeschrieben im Seitenkopf. */
  title: string;
  /** Ein Satz: was in dieser Liste liegt. */
  meta: string;
  /** Woraus die Liste abgeleitet wird — in Worten, hinter dem Info-Icon. */
  derivation: string;
  /**
   * true = diese Liste ignoriert die eingestellte Datensicht und liefert
   * immer org-weit. Gilt genau für die Sperrliste (Begründung dort).
   */
  orgWide?: true;
  /**
   * Woraus die Ansicht entsteht — ein Aufruf von `dropout_lists()` je Eintrag,
   * die Ergebnisse werden entdoppelt zusammengelegt.
   *
   * DIE REIHENFOLGE IST DIE VORRANGKETTE beim Entdoppeln, und sie ist nicht
   * beliebig: Derselbe Termin kann in mehreren Quellen stehen (ein
   * disqualifiziertes Erstgespräch, das später abgesagt wurde, steht in beiden).
   * Vorn steht deshalb, was den aussagekräftigsten Grund mitbringt —
   * `disqualify_reason_code` und `lost_reason_code` vor dem Absagegrund, und
   * ganz hinten der No-Show, für den die RPC gar keinen Grund liefert.
   *
   * Nebeneffekt, auf den `listFeedsRecycling` baut: Damit gewinnt immer die
   * Quelle, deren Status-Zweig auch wirklich ein Recycling speist — ein
   * verlorenes Closing kommt über `kein_close` herein und nicht über die
   * Absage, die beim Closing keinen Zweig hat.
   */
  sources: readonly DropoutSourceList[];
};

/**
 * Zwei Ansichten: erst der Aktenschrank, dann das Verbot. Die Sperrliste steht
 * hinten, weil sie keine Stufe des Funnels ist, sondern eine Anweisung.
 */
export const DROPOUT_LISTS: readonly DropoutListMeta[] = [
  {
    key: "ausgeschieden",
    tab: "Ausgeschieden",
    title: "Ausgeschieden",
    meta: "Aus dem Funnel gefallen — abgesagt, disqualifiziert, verloren oder ohne Antwort.",
    derivation:
      "Vier Endzustände in einer Liste: Termine, die ohne Aussicht abgesagt wurden, Erstgespräche mit dem Ergebnis „Unqualifiziert“ oder „Dead“, verlorene Abschlussgespräche und No-Shows, auf die nie eine Antwort kam. Was davon zutrifft, steht als Kennzeichen auf jeder Karte — der Grund daneben. Getrennte Reiter dafür gab es, solange der Grund die Wartezeit bis zum nächsten Versuch bestimmte; heute gilt eine Frist für alle.",
    sources: ["disqualifiziert", "kein_close", "abgesagt", "no_show_ohne_antwort"],
  },
  {
    key: "gesperrt",
    tab: "Gesperrt",
    title: "Sperrliste",
    meta: "Dauerhaftes Kontaktverbot — org-weit sichtbar, für alle.",
    derivation:
      "Vorgänge mit dauerhaftem Kontaktverbot über alle vier Ursprünge — Setting, Closing, LinkedIn-Kontakt und Telefon-Lead. Diese Liste ignoriert als einzige die eingestellte Datensicht: ein Kontaktverbot, das nur sein Besitzer sieht, ist keines.",
    orgWide: true,
    sources: ["gesperrt"],
  },
];

const LIST_BY_KEY = new Map<string, DropoutListMeta>(DROPOUT_LISTS.map((l) => [l.key, l]));

/**
 * Die alten Reiter-Adressen. Bis zum Rückbau war jede der sechs RPC-Listen eine
 * eigene Ansicht mit eigener URL — die stehen in Lesezeichen und in geteilten
 * Links. Sie führen deshalb weiter auf die Ansicht, in der ihr Inhalt jetzt
 * liegt, statt stumm auf der ersten zu landen (Muster: die abgeklemmten
 * Altrouten, die weiterleiten, statt zu verschwinden).
 *
 * `ersatztermin_offen` ist der eine Fall ohne Nachfolger in der Ablage: Sein
 * Inhalt ist in die Hauptliste gewandert, nicht ins Archiv. Er fällt auf die
 * erste Ansicht zurück — dort steht wenigstens etwas, statt einer Fehlerseite.
 */
const LEGACY_VIEW = new Map<string, DropoutListKey>([
  ["abgesagt", "ausgeschieden"],
  ["disqualifiziert", "ausgeschieden"],
  ["kein_close", "ausgeschieden"],
  ["no_show_ohne_antwort", "ausgeschieden"],
]);

export function isDropoutListKey(value: unknown): value is DropoutListKey {
  return typeof value === "string" && LIST_BY_KEY.has(value);
}

/** Unbekannter oder fehlender Parameter fällt auf die erste Ansicht zurück. */
export function parseDropoutList(value: unknown): DropoutListKey {
  if (isDropoutListKey(value)) return value;
  if (typeof value === "string") {
    const legacy = LEGACY_VIEW.get(value);
    if (legacy) return legacy;
  }
  return DROPOUT_LISTS[0].key;
}

export function dropoutListMeta(key: DropoutListKey): DropoutListMeta {
  return LIST_BY_KEY.get(key) ?? DROPOUT_LISTS[0];
}

/**
 * Was auf der Karte steht, statt eines Reiters: Woher die Zeile kommt.
 *
 * In der zusammengelegten Ansicht ist das die einzige Stelle, an der die vier
 * Endzustände noch auseinandergehalten werden — vorher trug das der Reitername.
 * Ohne diesen Chip stünde ein No-Show ohne Antwort nur mit „Ohne Grund" da (die
 * RPC liefert für ihn gar keinen Grund-Code), und niemand wüsste, warum der
 * Vorgang überhaupt in der Ablage liegt.
 */
export const DROPOUT_SOURCE_LABELS: Record<DropoutSourceList, string> = {
  abgesagt: "Abgesagt",
  disqualifiziert: "Disqualifiziert",
  kein_close: "Kein Close",
  no_show_ohne_antwort: "No-Show ohne Antwort",
  gesperrt: "Gesperrt",
};

/* ------------------------------------------------------------------ *
 * Gründe
 * ------------------------------------------------------------------ */

/** Absagegründe (CHECK aus Migration 0032, beide Termin-Tabellen). */
const CANCEL_REASON_LABELS: Record<string, string> = {
  kein_neuer_termin: "Kein neuer Termin",
  krank: "Krank",
  familiaer: "Familiär",
  beruflich: "Beruflich",
  preis: "Preis",
  sonstiges: "Sonstiges",
};

/** Disqualifizierungsgründe (CHECK aus Migration 0032, nur Erstgespräch). */
const DISQUALIFY_REASON_LABELS: Record<string, string> = {
  geld: "Geld",
  kein_budget: "Kein Budget",
  kein_bedarf: "Kein Bedarf",
  falscher_zeitpunkt: "Falscher Zeitpunkt",
  kein_entscheider: "Kein Entscheider",
  falsche_zielgruppe: "Falsche Zielgruppe",
  keine_zusammenarbeit: "Keine Zusammenarbeit",
  sonstiges: "Sonstiges",
};

/**
 * Die drei Gründe, für die es in KEINER Tabelle einen Code gibt.
 *
 * Ein Erstgespräch kann auf drei Wegen terminal werden, ohne dass eine
 * Grund-Spalte das festhält: abgesagt ohne Aussicht, No-Show ohne Antwort, und
 * (in Bestandsdaten) unqualifiziert ohne nachgepflegten Grund. Genau diese drei
 * Zustände schreibt `recycleReasonCodeFor()` als Recycling-Grund fort — sonst
 * fällt die Wiedervorlage in `recycle_tasks` auf den festverdrahteten Ersatzwert
 * „dead" zurück und die Karte behauptet einen Grund, der nicht stimmt.
 *
 * Die Codes tragen bewusst dieselben Wörter wie die Kennzeichen auf den
 * Ablage-Karten (`DROPOUT_SOURCE_LABELS`): Der Nutzer hat sie dort schon
 * gelesen, und was in der Ablage liegt, heißt in der Wiedervorlage genauso.
 */
const ABLAGE_REASON_LABELS: Record<string, string> = {
  abgesagt: "Abgesagt",
  no_show_ohne_antwort: "No-Show ohne Antwort",
  unqualifiziert: "Unqualifiziert",
};

/**
 * EINE Nachschlagetabelle über alle vier Grund-Familien.
 *
 * Die RPC liefert je nach Liste mal den Absage-, mal den Disqualifizierungs-,
 * mal den Verlustgrund in derselben Spalte `reason_code` — und bei den beiden
 * Lead-Ursprüngen der Sperrliste den Recycling-Grund (`dead`, `fu_exhausted`),
 * den sonst nur das Nachfassen-Board beschriftet. Vier getrennte Maps hießen,
 * im Board die Liste UND die Termin-Art zu kennen, um einen Code zu
 * beschriften. Das Zusammenlegen ist gefahrlos, weil die mehrfach
 * vorkommenden Codes (preis, kein_bedarf, falsche_zielgruppe, sonstiges) in
 * jeder Familie dasselbe Wort tragen.
 */
export const DROPOUT_REASON_LABELS: Record<string, string> = {
  ...CANCEL_REASON_LABELS,
  ...DISQUALIFY_REASON_LABELS,
  ...RECYCLE_REASON_LABELS,
  ...ABLAGE_REASON_LABELS,
  // Zuletzt: für die Verlustgründe ist diese Map die maßgebliche Quelle.
  ...CLOSING_LOST_REASON_LABELS,
};

/** Beschriftung eines Grund-Codes; ein unbekannter Code wird roh gezeigt,
    statt still als „Sonstiges" verbucht zu werden — sonst verschwände ein
    neuer Code lautlos in einer Sammelzeile. */
export function dropoutReasonLabel(code: string | null): string {
  if (!code) return "Ohne Grund";
  return DROPOUT_REASON_LABELS[code] ?? code;
}

/**
 * Beschriftung des Grund-Badges auf einer Ablage-Karte.
 *
 * `hidden` unterscheidet zwei Zustände, die ohne diese Trennung gleich aussähen
 * und von denen einer eine Falschaussage wäre: „für diesen Vorgang ist kein
 * Grund erfasst" (Ohne Grund) gegen „der Vorgang gehört einer anderen Person,
 * die eingestellte Datensicht zeigt seinen Grund nicht" (Grund nicht sichtbar).
 *
 * Der Fall entsteht ausschließlich in der Sperrliste: Sie ist die einzige
 * Ansicht, die org-weit liefert, während der Nachschlag des Grundes durch die
 * normale Zeilensicherheit läuft. Ausgerechnet dort ist die Falschaussage am
 * teuersten — die Liste beantwortet die Frage „warum darf hier niemand mehr
 * anrufen?".
 */
export function dropoutReasonBadge(code: string | null, hidden: boolean): string {
  if (code) return dropoutReasonLabel(code);
  return hidden ? "Grund nicht sichtbar" : "Ohne Grund";
}

/* ------------------------------------------------------------------ *
 * Darf das Recycling vorgezogen werden?
 * ------------------------------------------------------------------ */

/**
 * Die beiden Codes je Termin-Art, die NIE ein Recycling-Datum bekommen —
 * wörtlich die Regel aus `schedule_recycle()` (Migration 0033). Beim Closing
 * hält ein CHECK sie zusätzlich fest; beim Erstgespräch ist sie bislang nur
 * eine App-Regel, deshalb muss sie hier stehen.
 */
const NEVER_RECYCLE: Record<DropoutEntity, readonly string[]> = {
  setting: ["falsche_zielgruppe", "keine_zusammenarbeit"],
  closing: ["falsche_zielgruppe", "kein_fit"],
  // LinkedIn- und Telefon-Leads tragen keinen Grund-Code, an dem ein
  // Recycling-Verbot hinge — ihr `recycle_reason_code` sagt nur, WIE der Lead
  // terminal wurde. Sie erscheinen ohnehin nur in der Sperrliste, wo bereits
  // `excluded` jede Wiedervorlage abweist.
  linkedin: [],
  telefon: [],
};

/**
 * Speist eine Zeile aus DIESER Quelle überhaupt einen Zweig von `recycle_tasks`?
 *
 * `recycle_tasks` prüft je Zweig den STATUS, nicht die Ablage-Zugehörigkeit:
 * Erstgespräche kommen über „dead/unqualifiziert", „No-Show ohne Antwort" oder
 * „abgesagt ohne Aussicht" hinein, Closings ausschließlich über „verloren".
 * Ein vorgezogenes Datum auf einer Zeile daneben wäre unsichtbar — die Aufgabe
 * tauchte in „Nachfassen" nie auf, und niemand wüsste, warum.
 *
 * Gefragt wird nach der QUELLE der Zeile, nicht nach der Ansicht: Seit die vier
 * Endzustände in einer Liste stehen, ist die Antwort innerhalb einer Ansicht
 * nicht mehr einheitlich — ein abgesagtes Closing und ein verlorenes liegen
 * nebeneinander, und nur das verlorene speist einen Zweig.
 *
 * Die beiden Lead-Ursprünge stehen nur in der Sperrliste, und die speist
 * ohnehin nichts — für sie ist die Antwort immer `false`.
 */
export function listFeedsRecycling(source: DropoutSourceList, entity: DropoutEntity): boolean {
  if (source === "gesperrt") return false;
  if (entity === "linkedin" || entity === "telefon") return false;
  return entity === "closing"
    ? source === "kein_close"
    : source === "abgesagt" || source === "disqualifiziert" || source === "no_show_ohne_antwort";
}

/**
 * Der Grund, unter dem ein vorgezogener Vorgang in der Wiedervorlage steht.
 *
 * `null` = kein Grund ableitbar; dann bleibt die Spalte unangetastet und der
 * Ersatzwert der Abfrage greift.
 *
 * Warum das hier überhaupt gerechnet wird: „Recycling vorziehen" schreibt das
 * Datum direkt, ohne `schedule_recycle()` — die RPC rechnet die grundabhängige
 * Wartezeit ab heute NEU aus und ist damit das Gegenteil von „vorziehen".
 * Damit fällt aber auch der Grund-Stempel weg, den sie sonst nebenbei setzt.
 * Ohne ihn steht die Karte in „Nachfassen" unter dem festverdrahteten
 * Ersatzwert „dead" — ein abgesagtes Erstgespräch liest sich dann als toter
 * Lead, und dieselbe falsche Zeile taucht in der Grund-Tabelle des
 * Analyse-Bereichs wieder auf.
 *
 * Der Grund kommt AUS DER ZEILE, nie vom Aufrufer — dieselbe Regel, aus der
 * `schedule_recycle()` seit Migration 0033 seinen Grund selbst liest, statt ihn
 * sich als Argument schicken zu lassen.
 *
 * Reihenfolge wie in `schedule_recycle()`: der Status geht vor, weil ein
 * geführtes Gespräch mehr über den Lead sagt als seine Absage.
 */
export function recycleReasonCodeFor(row: {
  entity: DropoutAppointmentEntity;
  status: string | null;
  cancelOutlook?: string | null;
  noShowResolution?: string | null;
  disqualifyReasonCode?: string | null;
  lostReasonCode?: string | null;
}): string | null {
  if (row.entity === "closing") {
    // Beim Closing genügt der Verlustgrund: Fehlt er, greift in der Abfrage
    // ohnehin `lost_reason_code` und zuletzt „Sonstiges" — dort gibt es den
    // falschen Ersatzwert „dead" gar nicht.
    return row.lostReasonCode ?? null;
  }
  if (row.status === "dead" || row.status === "unqualifiziert") {
    return row.disqualifyReasonCode ?? row.status;
  }
  if (row.noShowResolution === "ohne_antwort") return "no_show_ohne_antwort";
  if (row.cancelOutlook === "ohne_aussicht") return "abgesagt";
  return null;
}

/* ------------------------------------------------------------------ *
 * Darf der Vorgang zurückgeholt werden? (Entscheidung K10)
 * ------------------------------------------------------------------ */

export type ReviveGate = {
  entity: DropoutEntity;
  /** `revived_at` gesetzt — es gibt bereits einen Nachfolge-Termin. */
  revived: boolean;
  /** `recycle_excluded_at` gesetzt. */
  excluded: boolean;
};

/**
 * `null` = „Neuen Termin ansetzen" ist möglich, sonst der Satz, der es sperrt.
 *
 * Dieselbe Bauform wie `recycleBlockedReason`: EINE Funktion für die Anzeige
 * (Knopf weg, Satz darunter oder am Fuß) und für die Ausführung — die
 * Server-Action prüft trotzdem selbst, weil sie per direktem POST erreichbar
 * ist. Deshalb ist der Rückgabewert ein ganzer Satz und kein Code: Er steht
 * genauso auf der Karte wie in der Fehlermeldung der Action.
 *
 * Die drei Riegel haben je einen eigenen Grund:
 *  · LinkedIn-Kontakte und Telefon-Leads können gar nicht Vorgänger sein — die
 *    Rückhol-Verweise aus 0032 (`revived_from_setting_call_id` /
 *    `revived_from_closing_call_id`) zeigen ausschließlich auf die beiden
 *    Termin-Tabellen. Für einen Lead ist der Weg zurück ein Termin aus seiner
 *    Liste heraus, nicht diese Aktion.
 *  · Ein gesperrter Vorgang darf keinen neuen Termin bekommen, sonst wäre das
 *    Kontaktverbot durch einen Klick daneben ausgehebelt.
 *  · Zweimal zurückholen ergäbe zwei Nachfolger für eine Vorgängerzeile — die
 *    Kette wäre nicht mehr eindeutig lesbar, und das Dossier zeigte zwei
 *    „zweite Anläufe" nebeneinander.
 */
export function reviveBlockedReason(gate: ReviveGate): string | null {
  if (gate.entity === "linkedin" || gate.entity === "telefon") {
    return "Nur für Termine lässt sich ein neuer ansetzen — ein Lead bekommt seinen Termin aus seiner Liste heraus.";
  }
  if (gate.excluded) {
    return "Dauerhaft gesperrt — ein neuer Termin widerspräche der Sperre.";
  }
  if (gate.revived) {
    // Sagt bewusst mehr als der Badge „Neuer Termin angesetzt" oben auf der
    // Karte: Der Badge nennt den Zustand, dieser Satz die FOLGE — und die
    // Folge ist der Grund, aus dem der Knopf daneben fehlt.
    return "Der neue Termin steht bereits — einen zweiten setzt die Ablage zu demselben Vorgang nicht an.";
  }
  return null;
}

/**
 * Lässt sich in dieser Ansicht ÜBERHAUPT etwas anstoßen — ein neuer Termin oder
 * eine vorgezogene Wiedervorlage?
 *
 * Die Frage ist deshalb eine einzige, weil sie in der Sperrliste EINE Antwort
 * hat: `dropout_lists('gesperrt')` liefert ausschließlich Zeilen mit gesetztem
 * Kontaktverbot, und das schlägt beide Aktionen zugleich. Gilt ein Grund für
 * jede Zeile der Ansicht, steht er einmal am Fuß des Boards statt auf zwanzig
 * Karten; in „Ausgeschieden" hängt er dagegen an der einzelnen Zeile und gehört
 * auf die betroffene Karte.
 *
 * Dieselbe Antwort entscheidet, ob der Fußtext die Aktionen überhaupt erklärt:
 * Eine Erläuterung zu einer Aktion, die auf keiner Karte angeboten wird, ist
 * schlimmer als keine — sie lässt den Nutzer nach einem Knopf suchen.
 */
export function listAllowsRevive(list: DropoutListKey): boolean {
  return list !== "gesperrt";
}

/**
 * Die Zähler der VORGÄNGERZEILE in einem Satzteil.
 *
 * Warum sie überhaupt sichtbar sein müssen: Ein zurückgeholter Vorgang startet
 * bewusst mit `reschedule_count = 0` („frischer Anlauf", Entscheidung E9) —
 * damit ist die Verschiebe-Obergrenze aus E6 durch Absagen-und-Zurückholen
 * umgehbar. Der Zähler wird deshalb NICHT übernommen (das änderte rückwirkend
 * die Bedeutung von E6), sondern die Historie danebengestellt: „diesen Lead
 * gab es schon einmal, und er hat damals dreimal verschoben."
 *
 * `null` = beide Zähler stehen auf 0, es gibt nichts zu berichten; dann bleibt
 * die Zeile in der Karte weg, statt „0× verschoben" zu behaupten.
 * `noShowCount === null` heißt „gibt es an dieser Tabelle nicht" —
 * `closing_calls` führt keinen No-Show-Zähler (nur `setting_calls`, Migration
 * 0018).
 */
export function lineageCounterSummary(rescheduleCount: number, noShowCount: number | null): string | null {
  const parts: string[] = [];
  if (rescheduleCount > 0) parts.push(`${rescheduleCount}× verschoben`);
  if (noShowCount != null && noShowCount > 0) parts.push(`${noShowCount}× nicht erschienen`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export type RecycleGate = {
  entity: DropoutEntity;
  /** `recycle_excluded_at` gesetzt. */
  excluded: boolean;
  /** `revived_at` gesetzt — der Lead ist auf anderem Weg zurück im Funnel. */
  revived: boolean;
  /** `recycle_responded_at` gesetzt. */
  responded: boolean;
  /** Der Code, an dem die Wartezeit hängt (Verlust- bzw. Disqualifizierungsgrund). */
  reasonCode: string | null;
  attemptCount: number;
  maxAttempts: number;
  /** Erfüllt die Zeile den Status-Zweig von `recycle_tasks`? (s. `listFeedsRecycling`) */
  inRecycleBranch: boolean;
};

/**
 * `null` = „Jetzt wieder anschreiben" ist möglich, sonst der Satz, der es
 * sperrt.
 *
 * Bewusst EINE Funktion für Anzeige und Ausführung: Das Board lässt den Knopf
 * damit aus demselben Grund weg, aus dem die Server-Action ihn verweigern würde
 * — und die Action prüft trotzdem selbst, weil sie per direktem POST erreichbar
 * ist und ein fehlender Knopf kein Schutz wäre.
 */
export function recycleBlockedReason(gate: RecycleGate): string | null {
  if (gate.excluded) {
    return "Dauerhaft gesperrt — eine Wiedervorlage widerspräche der Sperre.";
  }
  if (gate.revived) {
    return "Der Vorgang ist bereits zurück im Funnel.";
  }
  if (gate.responded) {
    return "Der Lead hat auf einen Recycling-Versuch schon reagiert.";
  }
  if (gate.reasonCode && NEVER_RECYCLE[gate.entity].includes(gate.reasonCode)) {
    return `„${dropoutReasonLabel(gate.reasonCode)}“ bekommt bewusst nie eine Wiedervorlage.`;
  }
  if (gate.attemptCount >= gate.maxAttempts) {
    // Der Satz nennt den ORT der Zahl, nicht nur die Zahl: Der Deckel ist eine
    // harte Grenze — `recycle_attempt()` (Migration 0033) räumt beim Erreichen
    // das Wiedervorlage-Datum ab, der Lead kommt nie wieder von selbst hoch.
    // Ohne den Zusatz stand hier eine Grenze ohne Adresse, und genau so hat sie
    // den ganzen Rückbau über unsichtbar weitergewirkt.
    return `Der Deckel von ${gate.maxAttempts} Versuchen ist erreicht — die Zahl steht in den Einstellungen unter „Pipeline“.`;
  }
  if (!gate.inRecycleBranch) {
    return "Dieser Vorgang speist keinen Zweig des Recyclings — eine Wiedervorlage bliebe unsichtbar.";
  }
  return null;
}
