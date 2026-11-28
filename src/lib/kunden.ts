// Typen und Beschriftungen der internen Kundenakte (Migration 0047).
// Reines Datenmodul — weder "use client" noch "use server", damit Server- und
// Client-Teil dieselbe Quelle benutzen (Muster settingsStyles.ts).

export type KundenStatus =
  | "onboarding"
  | "aktiv"
  | "pausiert"
  | "abgeschlossen"
  | "gekuendigt"
  | "abgesprungen";

export const KUNDEN_STATUS: readonly KundenStatus[] = [
  "onboarding",
  "aktiv",
  "pausiert",
  "abgeschlossen",
  "gekuendigt",
  "abgesprungen",
];

export const KUNDEN_STATUS_LABELS: Record<KundenStatus, string> = {
  onboarding: "Onboarding",
  aktiv: "Aktiv",
  pausiert: "Pausiert",
  abgeschlossen: "Abgeschlossen",
  gekuendigt: "Gekündigt",
  abgesprungen: "Abgesprungen",
};

/** Ton des Status-Badges. Beendete Kunden stehen grau, nicht rot: ein
 *  abgeschlossenes Programm ist ein Erfolg, kein Fehler. */
export const KUNDEN_STATUS_TONE: Record<KundenStatus, "brand" | "success" | "warning" | "neutral" | "error"> = {
  onboarding: "brand",
  aktiv: "success",
  pausiert: "warning",
  abgeschlossen: "neutral",
  gekuendigt: "neutral",
  abgesprungen: "error",
};

/** Laufende Betreuung — beendete Kunden stehen in der Liste unten. */
export function istLaufend(status: KundenStatus): boolean {
  return status === "onboarding" || status === "aktiv" || status === "pausiert";
}

export type AblageTyp = "vertrag" | "onboarding" | "aufzeichnung" | "material" | "sonstiges";

export const ABLAGE_TYPEN: readonly AblageTyp[] = ["vertrag", "onboarding", "aufzeichnung", "material", "sonstiges"];

export const ABLAGE_TYP_LABELS: Record<AblageTyp, string> = {
  vertrag: "Vertrag",
  onboarding: "Onboarding",
  aufzeichnung: "Aufzeichnung",
  material: "Material",
  sonstiges: "Sonstiges",
};

export const ABLAGE_BUCKET = "kunden-ablage";
export const ABLAGE_MAX_BYTES = 50 * 1024 * 1024;

/** Dateien an Vorlagen (Migration 0052): privater Bucket, Pfad <vorlage_id>/<datei>. */
export const VORLAGEN_BUCKET = "vorlagen-dateien";

export type VorlageDatei = {
  id: string;
  vorlage_id: string;
  titel: string;
  dateiname: string;
  storage_path: string;
  groesse_bytes: number | null;
  mime: string | null;
  created_at: string;
};

/** Dateiname, der in jedem Speicherpfad funktioniert (keine Leer-/Sonderzeichen). */
export function sichererDateiname(name: string): string {
  return name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").slice(-120) || "datei";
}

export type Kunde = {
  id: string;
  closing_call_id: string | null;
  name: string;
  firma: string | null;
  email: string | null;
  telefon: string | null;
  kunden_workspace_id: string | null;
  status: KundenStatus;
  /** EINE Person für alles, immer ein Admin. */
  betreuer_user_id: string | null;
  steckbrief: string | null;
  created_at: string;
  updated_at: string;
};

export type TeamMitglied = { user_id: string; username: string; zuordenbar: boolean };

export type KundenVertrag = {
  kunde_id: string;
  /** Zählt bei jeder Geldänderung hoch (finanz_anwenden). */
  version: number;
  vertragswert: number;
  vertragsstart: string | null;
  laufzeit_monate: number | null;
  zahlungsart: "einmal" | "raten";
  gekuendigt_am: string | null;
  kuendigung_wirksam_zum: string | null;
  kuendigung_grund: string | null;
  abgebrochen_am: string | null;
  abbruch_grund: string | null;
  notiz: string | null;
};

export type KundenRate = {
  id: string;
  kunde_id: string;
  faellig_am: string;
  betrag: number;
  urspruenglich_faellig_am: string | null;
  herkunft_rate_id: string | null;
  erlass: "storniert" | "abgeschrieben" | null;
  erlass_am: string | null;
  erlass_grund: string | null;
  erlass_zahlung_id: string | null;
  notiz: string | null;
  created_at: string;
};

export type KundenZahlung = {
  id: string;
  kunde_id: string;
  eingang_am: string;
  betrag: number;
  art: "zahlung" | "erstattung" | "ruecklastschrift";
  zahlungsweg: string | null;
  notiz: string | null;
  erfasst_von_user_id: string | null;
  created_at: string;
};

export type KundenMeeting = {
  id: string;
  kunde_id: string;
  status: "geplant" | "stattgefunden";
  termin: string | null;
  durchgefuehrt_von_user_id: string | null;
  teilnehmer: string | null;
  themen: string | null;
  ergebnisse: string | null;
  aufzeichnung_url: string | null;
  created_at: string;
};

export type AgendaPunkt = {
  id: string;
  kunde_id: string;
  meeting_id: string;
  text: string;
  besprochen: boolean;
  uebernommen_von: string | null;
  sort_order: number;
  created_at: string;
};

export type KundenAufgabe = {
  id: string;
  kunde_id: string;
  meeting_id: string | null;
  seite: "wir" | "kunde";
  text: string;
  erledigt_am: string | null;
  erledigt_von_user_id: string | null;
  created_at: string;
};

export type KundenCheckliste = {
  id: string;
  kunde_id: string;
  vorlage_id: string | null;
  titel: string;
  created_at: string;
};

export type KundenBaustein = {
  id: string;
  kunde_id: string;
  checkliste_id: string;
  titel: string;
  beschreibung: string | null;
  phase: string | null;
  sort_order: number;
  erledigt_am: string | null;
  erledigt_von_user_id: string | null;
  notiz: string | null;
  vorlage_punkt_id: string | null;
};

export type VorlagePunkt = {
  id: string;
  vorlage_id: string;
  titel: string;
  beschreibung: string | null;
  phase: string | null;
  sort_order: number;
};

export type Vorlage = {
  id: string;
  name: string;
  beschreibung: string | null;
  archiviert_at: string | null;
  punkte: VorlagePunkt[];
};

export type AblageEintrag = {
  id: string;
  kunde_id: string;
  typ: AblageTyp;
  titel: string;
  url: string | null;
  storage_path: string | null;
  dateiname: string | null;
  groesse_bytes: number | null;
  mime: string | null;
  created_by_user_id: string | null;
  created_at: string;
};

export type KundenLogEintrag = {
  id: string;
  bereich: "finanz" | "fulfillment";
  art: string;
  text: string;
  user_id: string | null;
  created_at: string;
};

export function formatBytes(n: number | null): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** Nur http(s) — ein `javascript:`-Link in der Ablage wäre ein Klick vom XSS. */
export function sichereUrl(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Fortschritt der Programm-Checkliste. */
export function bausteinFortschritt(b: readonly { erledigt_am?: string | null }[]): {
  erledigt: number;
  gesamt: number;
} {
  return { erledigt: b.filter((x) => x.erledigt_am).length, gesamt: b.length };
}

// ── Aufmerksamkeit ─────────────────────────────────────────────────────────

export const MEETING_VORLAUF_STUNDEN = 48;
const MEETING_DAUER_MIN = 60;

/**
 * Warum dieser Kunde Aufmerksamkeit braucht. Abgeleitet, nie gespeichert, und
 * immer als Text. `nowMs` kommt vom Server.
 */
export function aufmerksamkeit(
  k: { status: KundenStatus; termin: string | null; agenda: number },
  nowMs: number,
): string[] {
  if (!istLaufend(k.status) || k.status === "pausiert") return [];
  const out: string[] = [];
  if (!k.termin) out.push("Kein Meeting geplant");
  else {
    const bis = Date.parse(k.termin) - nowMs;
    if (bis < -MEETING_DAUER_MIN * 60_000) out.push("Meeting noch nicht abgeschlossen");
    else if (bis < MEETING_VORLAUF_STUNDEN * 3_600_000 && k.agenda === 0) out.push("Meeting ohne Agenda");
  }
  return out;
}

// ── Listen einfügen ────────────────────────────────────────────────────────

/**
 * Eingefügter Text: eine Zeile ist eine Checkbox, „# Titel" beginnt eine Phase.
 * Aufzählungszeichen aus Notion, Word oder Markdown fallen weg.
 */
export function zeilenZuPunkten(text: string): { titel: string; phase: string | null }[] {
  const out: { titel: string; phase: string | null }[] = [];
  let phase: string | null = null;
  for (const roh of (text ?? "").split(/\r?\n/)) {
    const z = roh.trim();
    if (!z) continue;
    const kopf = /^#+(?:\s+(.*))?$/.exec(z);
    if (kopf) {
      phase = kopf[1]?.trim() || null;
      continue;
    }
    const titel = z
      .replace(/^(?:[-*•▪–]|\d{1,2}[.)])\s+/, "")
      .replace(/^(?:\[[ xX]?\]|[☐☑✓✔])\s*/, "")
      .trim();
    if (titel) out.push({ titel, phase });
  }
  return out;
}

/** In Phasen gruppiert, in der Reihenfolge ihres ersten Auftretens. */
export function nachPhase<T extends { phase: string | null }>(rows: readonly T[]): { phase: string | null; rows: T[] }[] {
  const out: { phase: string | null; rows: T[] }[] = [];
  for (const r of rows) {
    const g = out.find((x) => x.phase === r.phase);
    if (g) g.rows.push(r);
    else out.push({ phase: r.phase, rows: [r] });
  }
  return out;
}

/**
 * Verschiebt innerhalb der eigenen Phase (B11) und liefert die Reihenfolge der
 * ganzen Liste. null, wenn es nichts zu verschieben gibt.
 */
export function verschobeneReihenfolge<T extends { id: string; phase: string | null }>(
  rows: readonly T[],
  id: string,
  richtung: -1 | 1,
): string[] | null {
  const gruppen = nachPhase(rows);
  for (const g of gruppen) {
    const i = g.rows.findIndex((r) => r.id === id);
    if (i < 0) continue;
    const j = i + richtung;
    if (j < 0 || j >= g.rows.length) return null;
    [g.rows[i], g.rows[j]] = [g.rows[j], g.rows[i]];
    return gruppen.flatMap((x) => x.rows.map((r) => r.id));
  }
  return null;
}
