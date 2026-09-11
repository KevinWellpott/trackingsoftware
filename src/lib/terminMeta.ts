// Geteilte Darstellungs-Metadaten für den Termin-Funnel (Setting + Closing).
// Kalender, Listenansicht und Popover nutzen dieselbe Quelle.

import { TERMIN_ZUSTAND_LABEL, type TerminZustand } from "@/lib/dranRegel";
import type { ClosingCall, SettingCall } from "@/lib/types";

/**
 * Semantik-Ton eines Termins. Er treibt den Status-Pill in Liste und Popover
 * UND den RAHMEN des Kalender-Chips.
 *
 * ── Umkehrung der bisherigen Doktrin ──────────────────────────────────────
 * Bis Runde 1 kodierte die FLÄCHE des Chips den Status und ein Text im Chip
 * den Typ. Weil die Typ-Chips aus der Kopfleiste verschwunden sind (der
 * Auftraggeber: „Setting/Closing auch nicht nötig"), muss der Typ jetzt aus
 * dem Chip selbst ablesbar sein. Deshalb gilt ab hier:
 *
 *   FÜLLUNG  = Typ    (Setting grau, Closing sehr hell)
 *   RAHMEN   = Status (gestrichelt, sobald ein Ergebnis feststeht)
 *
 * Die Semantik der Farben bleibt unverändert: Grün = weitergekommen/gewonnen,
 * Rot = verloren/geplatzt, Gold = Nachfassen nötig, Neutral = noch offen.
 */
export type Tone = "neutral" | "success" | "danger" | "warning" | "info";

export type Pill = { label: string; tone: Tone; color: string; bg: string; border: string };

const NEUTRAL: Omit<Pill, "label"> = {
  tone: "neutral",
  color: "var(--text-secondary)",
  bg: "var(--surface-3)",
  border: "var(--border-default)",
};
const SUCCESS: Omit<Pill, "label"> = {
  tone: "success",
  color: "var(--success-fg)",
  bg: "var(--success-bg)",
  border: "rgb(63 179 127 / 0.28)",
};
const ERROR: Omit<Pill, "label"> = {
  tone: "danger",
  color: "var(--danger-fg)",
  bg: "var(--danger-bg)",
  border: "rgb(214 90 82 / 0.28)",
};
// Einen WARNING-Pill gibt es hier bewusst NICHT mehr: Gold gehört in der
// Arbeitsliste dem Terminfeld (`DRAN_TONE`), und zwar allein — siehe die
// Begründung an ZUSTAND_TONE. Der Ton „warning" lebt weiter als RAHMEN eines
// Kalender-Chips (`outlineFor`), wo er mit keinem goldenen Feld konkurriert.

/**
 * Der Pill EINES abgeleiteten Zustands (`TerminZustand`, src/lib/dranRegel.ts).
 *
 * ── Was hier weggefallen ist und warum ────────────────────────────────────
 * Bis zum Rückbau standen an dieser Stelle zwei Tabellen ROHER Status-Werte
 * (`SETTING_STATUS_META`, `CLOSING_STATUS_META`) plus ein Sonder-Pill für die
 * Absage. Zusammen waren das elf Beschriftungen für einen Bereich, in dem der
 * Auftraggeber genau eine Aussage je Zeile sehen will — und zwei davon logen:
 * „Offen" stand über einem Termin, der längst abgesagt war, und über einem, der
 * nächste Woche stattfindet.
 *
 * Jetzt kommt die Beschriftung aus der Ableitung (dort steht auch, warum
 * „Offen" das Gegenteil des gespeicherten `status='offen'` bedeutet), und diese
 * Datei tut, wofür es sie gibt: Sie ordnet ihr eine Farbe zu. Die Semantik der
 * Farben ist unverändert — Grün weitergekommen/gewonnen, Rot geplatzt/verloren,
 * Neutral steht noch an.
 *
 * ── WARUM DIE ARBEITSMENGE HIER KEIN GOLD MEHR TRÄGT ──────────────────────
 * `offen`, `no_show` und `show` sind die Arbeitsmenge — und genau deshalb
 * leuchtet in ihrer Zeile bereits das TERMINFELD gold (`DRAN_TONE`,
 * src/lib/dranRegel.ts). Trug der Status-Pill dieselben Warn-Tokens, stand in
 * der Vorgabe-Ansicht „Zu tun" zweimal dasselbe Gold in einer Zeile: eine
 * Spalte, in der ALLES gold ist, trägt keine Information.
 *
 * Schlimmer war der zweite Teil: Ein Klick auf „Genervt" nimmt dem Terminfeld
 * das Gold für heute, der Pill drei Spalten weiter blieb gold stehen. Damit
 * behauptete die Zeile weiter „du bist dran", obwohl gerade jemand dran war —
 * und Gold heißt in dieser App ausnahmslos das eine (dranRegel.ts) und in
 * dieser Zeile deshalb nur an einer Stelle (DESIGN.md §3.6, Badge-Budget:
 * höchstens EIN farbiges Element pro Zeile).
 *
 * Verloren geht dabei nichts: „Offen", „Show" und „No-Show" stehen als WORT
 * da, und ob die Zeile heute noch anzufassen ist, sagt das goldene Terminfeld
 * daneben — genauer, als der Pill es je konnte.
 */
const ZUSTAND_TONE: Record<TerminZustand, Omit<Pill, "label">> = {
  // Versorgt — ein Termin steht. Neutral heißt in diesem Bereich unverändert
  // „steht noch an", und nichts anderes ist gemeint.
  verlegt: NEUTRAL,
  offen: NEUTRAL,
  no_show: NEUTRAL,
  show: NEUTRAL,
  // Weiter, nicht fertig: Die Arbeit hängt ab hier an der Closing-Zeile.
  qualifiziert: SUCCESS,
  closing_gelegt: SUCCESS,
  nicht_qualifiziert: ERROR,
  tot: ERROR,
  close: SUCCESS,
  kein_close: ERROR,
};

export function zustandPill(zustand: TerminZustand): Pill {
  return { label: TERMIN_ZUSTAND_LABEL[zustand], ...ZUSTAND_TONE[zustand] };
}

/**
 * Rahmen-Beschreibung eines Kalender-Chips.
 *
 * `dashed` = es steht ein Ergebnis fest. Ein durchgezogener Rahmen heißt
 * ausschließlich „steht noch an" — damit ist die wichtigste Frage der
 * Wochenplanung („was kommt noch?") ohne Farbverständnis beantwortbar.
 *
 * `dimmed` = abgeschlossen und aus der Planung raus. Das ersetzt den früheren
 * „Versteckte"-Schalter: Statt Termine lautlos verschwinden zu lassen, werden
 * sie zurückgenommen, bleiben aber sichtbar und anklickbar.
 */
export type EventOutline = { tone: Tone; dashed: boolean; dimmed: boolean };

/** Anwesenheit — `null` heisst „noch nicht eingetragen", nicht „nicht da". */
export type ShowStatus = "show" | "no_show" | null;

const OPEN: EventOutline = { tone: "neutral", dashed: false, dimmed: false };

/**
 * Rahmen eines SETTING-Chips.
 *
 * Zwei Felder, die auseinanderlaufen können (docs §4): `status` trägt das
 * Ergebnis, `show_status` die Anwesenheit. Der „Erschienen"-Schalter im
 * Setting-Editor setzt bewusst NUR `show_status` — ein geplatzter Termin, an
 * dem noch niemand das Ergebnis gepflegt hat, steht deshalb auf
 * `status='offen'` + `show_status='no_show'` und sähe ohne die Sonderprüfung
 * unten aus wie ein ganz normal anstehender Termin.
 *
 * Umgekehrt gilt: sobald ein Ergebnis eingetragen ist, GEWINNT DER STATUS.
 * `dead` etwa lässt `show_status` bewusst stehen (der Lead kann erschienen
 * gewesen sein) — das Ergebnis ist trotzdem „tot".
 *
 * Die beiden im Auftraggeber-Feedback nicht genannten Status:
 *  · `qualifiziert` — Altbestand. Das UI vergibt ihn nicht mehr (der Klick
 *    legt direkt das Closing an, siehe types.ts). Er sagt dasselbe wie
 *    `closing_gelegt` und bekommt deshalb dieselbe Farbe; eine eigene wäre
 *    eine Unterscheidung, die niemand mehr herstellen kann.
 *  · `dead` — abgebrochen, nicht bloß geplatzt. Gleiche Warnfarbe wie
 *    No-Show (beides „hier kommt nichts mehr"), aber `dimmed`: Ein toter Lead
 *    darf die Woche optisch nicht dominieren. Bewusst NICHT ausgeblendet —
 *    genau das war die Falle des alten „Versteckt"-Schalters.
 */
function settingOutline(status: SettingCall["status"], show: ShowStatus): EventOutline {
  switch (status) {
    case "no_show":
      return { tone: "danger", dashed: true, dimmed: false };
    case "unqualifiziert":
      // Nicht `dimmed`, aus demselben Grund wie bei den terminalen Closings:
      // Der Status steht in TERMINAL_SETTING_STATUS, der Chip nimmt ihn über
      // `data-terminal` bereits zurück. Beides zusammen wäre doppelt.
      return { tone: "warning", dashed: true, dimmed: false };
    case "qualifiziert":
    case "closing_gelegt":
      return { tone: "success", dashed: true, dimmed: false };
    case "dead":
      return { tone: "danger", dashed: true, dimmed: true };
    default:
      // Ergebnis offen: nur die Anwesenheit kann noch etwas sagen.
      return show === "no_show" ? { tone: "danger", dashed: true, dimmed: false } : OPEN;
  }
}

/**
 * Rahmen eines CLOSING-Chips.
 *
 * `closing_calls` kennt KEINEN No-Show-Status (docs §4) — die Information
 * steckt allein in `show_status`. Ein geplatztes Closing fällt deshalb in
 * denselben Topf wie „nachfassen": Gold heißt hier „hat nicht stattgefunden
 * bzw. ist noch nicht entschieden — da muss jemand ran". Genau die Farbe hat
 * der Auftraggeber für den Closing-No-Show verlangt; `nachfassen` (im Feedback
 * nicht genannt) teilt sie, weil beides dieselbe Handlung auslöst.
 */
function closingOutline(status: ClosingCall["status"], show: ShowStatus): EventOutline {
  switch (status) {
    // Nicht `dimmed`: gewonnen/verloren stehen bereits in
    // TERMINAL_CLOSING_STATUS und werden vom Chip über `data-terminal`
    // zurückgenommen. Beides zusammen wäre doppelte Abblendung.
    case "gewonnen":
      return { tone: "success", dashed: true, dimmed: false };
    case "verloren":
      return { tone: "danger", dashed: true, dimmed: false };
    case "nachfassen":
      return { tone: "warning", dashed: true, dimmed: false };
    default:
      return show === "no_show" ? { tone: "warning", dashed: true, dimmed: false } : OPEN;
  }
}

/**
 * Rahmen eines ABGESAGTEN Termins — bewusst kein neues Muster, sondern
 * dieselben drei Schalter wie überall: Rot heißt „geplatzt", gestrichelt
 * „daran ändert sich nichts mehr", abgeblendet „aus der Planung raus". Es ist
 * exakt das Tripel, das ein `dead`-Setting trägt, und das ist die richtige
 * Aussage: Der Termin findet nicht statt.
 *
 * Ob ein Ersatztermin folgt (`cancel_outlook`), steht hier bewusst NICHT im
 * Chip. Das ist keine Eigenschaft dieses Termins mehr, sondern eine offene
 * Aufgabe — und offene Aufgaben stehen in der Terminliste, wo ein abgesagter
 * Termin ohne Ersatz als „Offen" wieder auftaucht und täglich leuchtet
 * (src/lib/dranRegel.ts). Zwei Rot-Töne für eine Absage wären eine
 * Unterscheidung, die im Kalender niemand nachschlagen kann.
 *
 * Die Begründung zeigte bis zum Rückbau auf eine eigene Ablage-Ansicht samt
 * Navigations-Zähler. Beides ist gefallen: Ein Archivreiter für offene Arbeit
 * war die Ausnahme, die die eine Arbeitsliste unterlaufen hat.
 */
const CANCELLED: EventOutline = { tone: "danger", dashed: true, dimmed: true };

export function outlineFor(
  kind: "setting" | "closing",
  status: string,
  show: ShowStatus,
  /** `cancelled_at` gesetzt — schlägt jeden Status, der Termin fällt aus. */
  cancelled = false,
): EventOutline {
  if (cancelled) return CANCELLED;
  return kind === "setting"
    ? settingOutline(status as SettingCall["status"], show)
    : closingOutline(status as ClosingCall["status"], show);
}

/**
 * Abgeschlossene Termine: nicht mehr verschiebbar.
 *
 * Maßgeblich ist die Frage, die auch `setSettingOutcome` stellt: Beendet das
 * Ergebnis den Vorgang? `unqualifiziert` tut das ebenso wie `dead` — beide sind
 * „tote Enden" (docs §1), beide planen ein Recycling-Datum statt eines nächsten
 * Termins. Dass hier bis hierher nur `dead` stand, machte ausgerechnet den
 * häufigeren der beiden Fälle ziehbar: Ein Zug im Kalender gab einem
 * disqualifizierten Lead einen neuen Termin — und holte ihn damit in die
 * Arbeitsliste zurück, aus der ihn das Ergebnis gerade genommen hatte.
 *
 * Bewusst NICHT dabei: `no_show` (der Vorgang geht weiter — ein Ersatztermin
 * ist der Normalfall), `qualifiziert`/`closing_gelegt` (der Vorgang ist ins
 * Closing gewandert, das Erstgespräch selbst ist nicht das tote Ende) und beim
 * Closing `nachfassen` (dasselbe Argument: da muss noch jemand ran).
 */
export const TERMINAL_SETTING_STATUS: readonly SettingCall["status"][] = ["unqualifiziert", "dead"];
export const TERMINAL_CLOSING_STATUS: readonly ClosingCall["status"][] = ["gewonnen", "verloren"];

/**
 * Rohwert → abgeleiteter Zustand, aber NUR für die vier terminalen Status.
 *
 * Bewusst keine vollständige Abbildung: Für alles andere reicht der Status gar
 * nicht aus, um den Zustand zu bestimmen — dort entscheiden Termin, Absage und
 * `show_status` mit (`terminZustand()` in src/lib/dranRegel.ts). Eine
 * vollständige Tabelle hier wäre eine zweite, ärmere Ableitung neben der
 * richtigen, und sie stünde ausgerechnet in der Datei, aus der die Farben
 * kommen.
 */
const TERMINALER_ZUSTAND: Record<string, TerminZustand> = {
  unqualifiziert: "nicht_qualifiziert",
  dead: "tot",
  gewonnen: "close",
  verloren: "kein_close",
};

/**
 * Der Satz, den ein abgesagter Termin bekommt, wenn ihn jemand verschieben
 * will — an EINER Stelle, weil ihn drei Riegel aussprechen: der Kalender-Zug,
 * `postponeAppointment` und `moveSettingAppointment` (beide
 * src/app/actions/settingCalls.ts). Er steht hier und nicht in der Action, weil
 * ein `"use server"`-Modul nur async Funktionen exportieren darf — eine
 * Konstante könnte dort gar nicht mitkommen, und drei Abschriften wären drei
 * Regeln, die auseinanderlaufen.
 */
export const CANCELLED_MOVE_HINT =
  "Der Termin ist abgesagt — bitte einen neuen Termin anlegen statt zu verschieben.";

/**
 * Warum dieser Termin nicht verschoben werden darf — `null` heißt: er darf.
 *
 * Der RÜCKGABEWERT ist der Punkt, nicht das Boolean dahinter: Ein Riegel, der
 * einen Zug wortlos abprallen lässt, sieht aus wie ein Fehler der App, und der
 * Nutzer probiert es dreimal. Der Text für die Absage ist derselbe, den auch
 * die beiden Server-Riegel zurückgeben (`CANCELLED_MOVE_HINT`).
 *
 * Die Absage steht vor dem Status, weil sie ihn nicht anfasst (docs §3): Ein
 * abgesagtes, aber noch offenes Erstgespräch trägt weiter `status='offen'` —
 * wer nur den Status prüft, hält es für einen ganz normal anstehenden Termin.
 */
export function moveLockReason(
  kind: "setting" | "closing",
  status: string,
  cancelled: boolean,
): string | null {
  if (cancelled) return CANCELLED_MOVE_HINT;
  const terminal =
    kind === "setting"
      ? TERMINAL_SETTING_STATUS.includes(status as SettingCall["status"])
      : TERMINAL_CLOSING_STATUS.includes(status as ClosingCall["status"]);
  if (!terminal) return null;
  // Die Beschriftung kommt aus derselben Quelle wie der Pill in der Liste —
  // sonst nennt der Riegel ein Ergebnis beim alten Namen („Unqualifiziert"),
  // während die Zeile daneben den neuen trägt („Nicht qualifiziert").
  const label = TERMIN_ZUSTAND_LABEL[TERMINALER_ZUSTAND[status] ?? "tot"];
  return `${kind === "setting" ? "Das Erstgespräch" : "Das Closing"} steht auf „${label}“ — ein neuer Zeitpunkt ändert daran nichts.`;
}

export const EUR_FMT = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
