// Zeitfilter und Zeitansichten für /setting und /closing — die Regeln, ohne
// Oberfläche. Alles hängt an der URL (`?zeit= &ab= &von= &bis= &achse=
// &ansicht=`), damit ein Link denselben Ausschnitt zeigt.
//
// Zwei Zeitachsen, weil es zwei Fragen sind (docs §5, „Drei Definitionen von
// Termin“): nach TERMIN („was findet statt / hat stattgefunden“) und nach
// BUCHUNG („was haben wir gelegt“, `created_at`). Alle Tage sind Berliner
// Kalendertage (YYYY-MM-DD).

import { addDaysISO, getISOWeek, weekStart } from "@/lib/dates";

export type ZeitPreset = "alle" | "heute" | "woche" | "monat" | "kommend" | "vergangen" | "zeitraum";
export type Zeitachse = "termin" | "gebucht";
export type ZeitAnsicht = "liste" | "tage" | "wochen";

export const ZEIT_PRESETS: readonly { value: ZeitPreset; label: string }[] = [
  { value: "alle", label: "Alle" },
  { value: "heute", label: "Tag" },
  { value: "woche", label: "Woche" },
  { value: "monat", label: "Monat" },
  { value: "kommend", label: "Kommend" },
  { value: "vergangen", label: "Vergangen" },
  { value: "zeitraum", label: "Zeitraum" },
];

const ISO_TAG = /^\d{4}-\d{2}-\d{2}$/;

export function parseZeitPreset(raw: string | null | undefined): ZeitPreset {
  return ZEIT_PRESETS.some((p) => p.value === raw) ? (raw as ZeitPreset) : "alle";
}
export function parseZeitachse(raw: string | null | undefined): Zeitachse {
  return raw === "gebucht" ? "gebucht" : "termin";
}
export function parseZeitAnsicht(raw: string | null | undefined): ZeitAnsicht {
  return raw === "tage" || raw === "wochen" ? raw : "liste";
}
export function parseTag(raw: string | null | undefined): string | null {
  return raw && ISO_TAG.test(raw) ? raw : null;
}

/** Ein Zeitfenster: `null` an einer Seite heißt offen. Beide `null` = kein Filter. */
export type Fenster = { von: string | null; bis: string | null };

function monatsBeginn(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}
function monatPlus(iso: string, n: number): string {
  const [y, m] = iso.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}-01`;
}

/**
 * Das Fenster eines Presets. `anker` verschiebt Tag/Woche/Monat (Blättern),
 * sonst gilt `today`. „Kommend“ = ab heute, „Vergangen“ = bis gestern.
 */
export function fensterVon(
  preset: ZeitPreset,
  today: string,
  opts: { anker?: string | null; von?: string | null; bis?: string | null } = {},
): Fenster {
  const a = opts.anker ?? today;
  switch (preset) {
    case "heute":
      return { von: a, bis: a };
    case "woche": {
      const s = weekStart(a);
      return { von: s, bis: addDaysISO(s, 6) };
    }
    case "monat":
      return { von: monatsBeginn(a), bis: addDaysISO(monatPlus(a, 1), -1) };
    case "kommend":
      return { von: today, bis: null };
    case "vergangen":
      return { von: null, bis: addDaysISO(today, -1) };
    case "zeitraum": {
      const von = opts.von ?? null;
      const bis = opts.bis ?? null;
      // Vertauschte Eingabe nicht als leere Menge auslegen.
      return von && bis && von > bis ? { von: bis, bis: von } : { von, bis };
    }
    default:
      return { von: null, bis: null };
  }
}

/** Liegt der Tag im Fenster? Ohne Tag (kein Termin) nur, wenn gar nicht gefiltert wird. */
export function imFenster(tag: string | null, f: Fenster): boolean {
  if (f.von == null && f.bis == null) return true;
  if (!tag) return false;
  if (f.von && tag < f.von) return false;
  if (f.bis && tag > f.bis) return false;
  return true;
}

/** Blättern: ein Tag, eine Woche oder ein Monat vor oder zurück. */
export function verschiebeAnker(preset: ZeitPreset, anker: string, schritt: -1 | 1): string {
  if (preset === "heute") return addDaysISO(anker, schritt);
  if (preset === "woche") return addDaysISO(weekStart(anker), 7 * schritt);
  if (preset === "monat") return monatPlus(anker, schritt);
  return anker;
}

export function kannBlaettern(preset: ZeitPreset): boolean {
  return preset === "heute" || preset === "woche" || preset === "monat";
}

const WOCHENTAG = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MONAT = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function kurz(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
}
function wochentag(iso: string): string {
  return WOCHENTAG[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}
function tagLabel(iso: string, today: string): string {
  const rel = iso === today ? "Heute" : iso === addDaysISO(today, 1) ? "Morgen" : iso === addDaysISO(today, -1) ? "Gestern" : null;
  const basis = `${wochentag(iso)} ${kurz(iso)}${iso.slice(0, 4)}`;
  return rel ? `${rel} · ${basis}` : basis;
}

/** Beschriftung des aktuellen Fensters („KW 49 · 30.11.–06.12.2026“). */
export function fensterLabel(preset: ZeitPreset, f: Fenster, today: string): string {
  if (preset === "heute" && f.von) return tagLabel(f.von, today);
  if (preset === "woche" && f.von && f.bis) return `KW ${getISOWeek(f.von)} · ${kurz(f.von)}–${kurz(f.bis)}${f.bis.slice(0, 4)}`;
  if (preset === "monat" && f.von) return `${MONAT[Number(f.von.slice(5, 7)) - 1]} ${f.von.slice(0, 4)}`;
  if (preset === "kommend") return `ab heute (${kurz(today)})`;
  if (preset === "vergangen") return `bis gestern (${kurz(addDaysISO(today, -1))})`;
  if (preset === "zeitraum") {
    if (f.von && f.bis) return `${kurz(f.von)}${f.von.slice(0, 4)} – ${kurz(f.bis)}${f.bis.slice(0, 4)}`;
    if (f.von) return `ab ${kurz(f.von)}${f.von.slice(0, 4)}`;
    if (f.bis) return `bis ${kurz(f.bis)}${f.bis.slice(0, 4)}`;
    return "Zeitraum wählen";
  }
  return "alle Zeiten";
}

/** Gruppenschlüssel einer Zeile in der Zeitansicht; `null` = ohne Datum. */
export function gruppenSchluessel(tag: string | null, ansicht: ZeitAnsicht): string | null {
  if (ansicht === "liste" || !tag) return null;
  return ansicht === "tage" ? tag : weekStart(tag);
}

export function gruppenLabel(schluessel: string | null, ansicht: ZeitAnsicht, today: string): string {
  if (schluessel == null) return "Ohne Datum";
  if (ansicht === "tage") return tagLabel(schluessel, today);
  const ende = addDaysISO(schluessel, 6);
  const diese = weekStart(today) === schluessel ? "Diese Woche · " : "";
  return `${diese}KW ${getISOWeek(schluessel)} · ${kurz(schluessel)}–${kurz(ende)}${ende.slice(0, 4)}`;
}
