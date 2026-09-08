// Ablage: die sechs „gesonderten Listen" aus dem Konzept — reine Bibliothek
// (kein "use server"/"use client"), Muster recycleCadence.ts.
//
// Die Ausarbeitung nennt an vier Stellen eine „gesonderte Liste"; der
// Auftraggeber hat daraus EINEN Bereich gemacht, der jede Liste in einer
// eigenen Ansicht zeigt (ENTSCHEIDUNGEN.md #7). Die Zugehörigkeit steht in
// keiner Tabelle, sondern wird in `dropout_lists()` (Migration 0033) aus dem
// Zeilenzustand abgeleitet — eine Ablage-Tabelle wäre eine zweite Wahrheit
// neben `status` und `cancelled_at` und liefe beim ersten Statuswechsel
// auseinander.
//
// Diese Datei hält nur das, was Seite, Board und Server-Action GEMEINSAM
// brauchen: die Liste der Listen, die Beschriftung der Gründe und die eine
// Regel, wann ein Recycling überhaupt vorgezogen werden darf.

import { RECYCLE_REASON_LABELS } from "@/lib/recycleCadence";
import { CLOSING_LOST_REASON_LABELS } from "@/lib/types";

/** Die sechs Werte, die `dropout_lists(p_list)` akzeptiert. */
export type DropoutListKey =
  | "abgesagt"
  | "ersatztermin_offen"
  | "disqualifiziert"
  | "kein_close"
  | "no_show_ohne_antwort"
  | "gesperrt";

/**
 * Die beiden Termin-Tabellen. Fünf der sechs Listen kennen nur sie: Absage,
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
  /** Woraus die Liste abgeleitet wird — wortgleich zur RPC, hinter dem Info-Icon. */
  derivation: string;
  /**
   * true = diese Liste ignoriert die eingestellte Datensicht und liefert
   * immer org-weit. Gilt genau für die Sperrliste (Begründung dort).
   */
  orgWide?: true;
};

/**
 * Reihenfolge = Weg durch den Funnel: erst die abgesagten Termine, dann die
 * beiden Stellen, an denen ein Gespräch stattfand und nichts wurde, dann der
 * No-Show — und ganz am Ende die Sperrliste, die keine Stufe ist, sondern ein
 * Verbot.
 */
export const DROPOUT_LISTS: readonly DropoutListMeta[] = [
  {
    key: "abgesagt",
    tab: "Abgesagt",
    title: "Abgesagt ohne Aussicht",
    meta: "Termin abgesagt, ein neuer ist nicht in Sicht.",
    derivation:
      "Termine mit gesetztem Absagegrund, deren Aussicht auf „ohne Aussicht“ steht (cancel_outlook). Ein abgesagter Termin behält seinen Status — die Absage steht in eigenen Feldern, damit er aus dem Nenner der Show-Quote fällt, statt sie zu verfälschen.",
  },
  {
    key: "ersatztermin_offen",
    tab: "Ersatztermin offen",
    title: "Abgesagt, Ersatztermin steht aus",
    meta: "Abgesagt mit Aussicht auf einen neuen Termin — der aber noch nicht steht.",
    derivation:
      "Absagen mit Aussicht „neuer Termin“, bei denen noch kein Ersatz eingetragen ist (revived_at ist leer). Sobald der Ersatztermin steht, verschwindet die Zeile hier und die Kaskade startet neu (ENTSCHEIDUNGEN.md #9).",
  },
  {
    key: "disqualifiziert",
    tab: "Disqualifiziert",
    title: "Disqualifiziert",
    meta: "Erstgespräch geführt, Lead passt nicht: unqualifiziert oder dead.",
    derivation:
      "Erstgespräche im Status „unqualifiziert“ oder „dead“. Der Grund steht als Code (Statistik) neben dem Freitext (Gedächtnis) — nur über den Code lässt sich zählen, woran es lag.",
  },
  {
    key: "kein_close",
    tab: "Kein Close",
    title: "Kein Close",
    meta: "Abschlussgespräch geführt, Deal verloren.",
    derivation:
      "Closings im Status „verloren“. Derselbe Verlustgrund-Code bestimmt die Recycling-Wartezeit — „Timing“ lohnt nach Wochen erneut, „Vertrauen“ erst nach Monaten, „Falsche Zielgruppe“ und „Kein Fit“ nie.",
  },
  {
    key: "no_show_ohne_antwort",
    tab: "No-Show",
    title: "No-Show ohne Antwort",
    meta: "Nicht erschienen — und auf keinen der Nachfass-Kontakte reagiert.",
    derivation:
      "Termine mit No-Show, deren Ausgang als „ohne Antwort“ festgehalten wurde. Wer geantwortet oder einen Ersatztermin bekommen hat, steht bewusst nicht hier: das sind die beiden anderen Ausgänge desselben Feldes.",
  },
  {
    key: "gesperrt",
    tab: "Gesperrt",
    title: "Sperrliste",
    meta: "Dauerhaftes Kontaktverbot — org-weit sichtbar, für alle.",
    derivation:
      "Vorgänge mit gesetztem Ausschluss (recycle_excluded_at) über alle vier Recycling-Tabellen — Erstgespräch, Closing, LinkedIn-Kontakt und Telefon-Lead. Diese Liste ignoriert als einzige die eingestellte Datensicht: ein Kontaktverbot, das nur sein Besitzer sieht, ist keines.",
    orgWide: true,
  },
];

const LIST_BY_KEY = new Map<string, DropoutListMeta>(DROPOUT_LISTS.map((l) => [l.key, l]));

export function isDropoutListKey(value: unknown): value is DropoutListKey {
  return typeof value === "string" && LIST_BY_KEY.has(value);
}

/** Unbekannter oder fehlender Parameter fällt auf die erste Liste zurück. */
export function parseDropoutList(value: unknown): DropoutListKey {
  return isDropoutListKey(value) ? value : DROPOUT_LISTS[0].key;
}

export function dropoutListMeta(key: DropoutListKey): DropoutListMeta {
  return LIST_BY_KEY.get(key) ?? DROPOUT_LISTS[0];
}

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
 * Speist diese Liste überhaupt einen Zweig von `recycle_tasks`?
 *
 * `recycle_tasks` prüft je Zweig den STATUS, nicht die Ablage-Zugehörigkeit:
 * Erstgespräche kommen über „dead/unqualifiziert", „No-Show ohne Antwort" oder
 * „abgesagt ohne Aussicht" hinein, Closings ausschließlich über „verloren".
 * Ein vorgezogenes Datum auf einer Zeile daneben wäre unsichtbar — die Aufgabe
 * tauchte in „Nachfassen" nie auf, und niemand wüsste, warum.
 *
 * Die beiden Lead-Ursprünge stehen nur in der Sperrliste, und die speist
 * ohnehin nichts — für sie ist die Antwort immer `false`.
 */
export function listFeedsRecycling(list: DropoutListKey, entity: DropoutEntity): boolean {
  if (list === "gesperrt" || list === "ersatztermin_offen") return false;
  if (entity === "linkedin" || entity === "telefon") return false;
  return entity === "closing"
    ? list === "kein_close"
    : list === "abgesagt" || list === "disqualifiziert" || list === "no_show_ohne_antwort";
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
 * `null` = „Recycling vorziehen" ist möglich, sonst der Satz, der es sperrt.
 *
 * Bewusst EINE Funktion für Anzeige und Ausführung: Das Board schaltet den
 * Knopf damit aus demselben Grund ab, aus dem die Server-Action ihn verweigern
 * würde — und die Action prüft trotzdem selbst, weil sie per direktem POST
 * erreichbar ist und der Knopf-Zustand kein Schutz wäre.
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
    return `Der Deckel von ${gate.maxAttempts} Versuchen ist erreicht.`;
  }
  if (!gate.inRecycleBranch) {
    return "Dieser Vorgang speist keinen Zweig von „Nachfassen“ — eine Wiedervorlage bliebe unsichtbar.";
  }
  return null;
}
