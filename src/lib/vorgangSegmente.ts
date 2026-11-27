// Status-Segmente der Listen /setting und /closing (Redesign Phase 4).
//
// Reine Funktionen ohne Datenbank, damit die Zuordnung testbar ist. Die
// Listen zeigen dieselben Zeilen wie der Kalender (`buildEvents`,
// src/lib/termine.ts) — nur nach ERGEBNIS geschnitten statt nach Zeit.
//
// ── DER ABGELEITETE ZUSTAND ENTSCHEIDET, NICHT DER STATUS ──────────────────
// `setting_calls.status='offen'` heißt „Termin steht, Ergebnis fehlt" — der
// abgeleitete Zustand `offen` heißt das GEGENTEIL („es steht kein Termin",
// docs §1). Deshalb schneiden die Segmente über `terminZustand()`:
//  · Eine Absage ohne Aussicht oder ein No-Show ohne Antwort lassen den Status
//    unangetastet, sind aber aus dem Funnel gefallen → Segment „Tot" bzw.
//    „Verloren", nicht „Ohne Ergebnis".
//  · Das Segment für Vorgänge ohne Ergebnis heißt deshalb „Ohne Ergebnis" und
//    NICHT „Offen": Auf dieser Seite stünde „Offen" sonst einmal für den
//    gespeicherten Wert und einmal für den abgeleiteten Zustand.
//
// Einzige Ausnahme beim Closing: „Nachfassen" ist ein gespeicherter Status
// ohne eigenen Zustand (`terminZustand` führt ihn als `show`/`verlegt`/…) —
// dafür entscheidet der Status.

import type { TerminZustand } from "@/lib/dranRegel";

export type SettingSegment = "ohne_ergebnis" | "no_show" | "qualifiziert" | "nicht_qualifiziert" | "tot" | "alle";
export type ClosingSegment = "ohne_ergebnis" | "nachfassen" | "gewonnen" | "verloren" | "alle";

export const SETTING_SEGMENTE: readonly { value: SettingSegment; label: string }[] = [
  { value: "ohne_ergebnis", label: "Ohne Ergebnis" },
  { value: "no_show", label: "Nicht erschienen" },
  { value: "qualifiziert", label: "Qualifiziert" },
  { value: "nicht_qualifiziert", label: "Nicht qualifiziert" },
  { value: "tot", label: "Tot" },
  { value: "alle", label: "Alle" },
];

export const CLOSING_SEGMENTE: readonly { value: ClosingSegment; label: string }[] = [
  { value: "ohne_ergebnis", label: "Ohne Ergebnis" },
  { value: "nachfassen", label: "Nachfassen" },
  { value: "gewonnen", label: "Gewonnen" },
  { value: "verloren", label: "Verloren" },
  { value: "alle", label: "Alle" },
];

export function parseSettingSegment(raw: string | null | undefined): SettingSegment {
  return SETTING_SEGMENTE.some((s) => s.value === raw) ? (raw as SettingSegment) : "ohne_ergebnis";
}

export function parseClosingSegment(raw: string | null | undefined): ClosingSegment {
  return CLOSING_SEGMENTE.some((s) => s.value === raw) ? (raw as ClosingSegment) : "ohne_ergebnis";
}

/** In welches Segment gehört ein Erstgespräch? (`alle` ist kein Ziel, sondern die Summe.) */
export function settingSegmentVon(zustand: TerminZustand): Exclude<SettingSegment, "alle"> {
  switch (zustand) {
    case "no_show":
      return "no_show";
    case "qualifiziert":
    case "closing_gelegt":
      return "qualifiziert";
    case "nicht_qualifiziert":
      return "nicht_qualifiziert";
    case "tot":
      return "tot";
    default:
      // verlegt · offen · show — es fehlt ein Ergebnis (Termin steht oder nicht).
      return "ohne_ergebnis";
  }
}

/** In welches Segment gehört ein Closing? */
export function closingSegmentVon(zustand: TerminZustand, status: string): Exclude<ClosingSegment, "alle"> {
  if (zustand === "close") return "gewonnen";
  // `kein_close` umfasst auch die Absage ohne Aussicht und den No-Show ohne
  // Antwort — beides ist aus dem Funnel gefallen, ohne dass ein Status es sagt.
  if (zustand === "kein_close") return "verloren";
  if (status === "nachfassen") return "nachfassen";
  return "ohne_ergebnis";
}
