// Nachrichtenvorlagen: reine Bibliothek (kein "use server"/"use client"),
// Muster src/lib/reminderCascade.ts bzw. src/lib/channels.ts — Katalog,
// Platzhalter und Auflösungskette an EINER Stelle, überall importierbar.
//
// Warum dieses Modul überhaupt: Bis hierher lagen die Nachrichtentexte der App
// auf VIER Speichermodellen nebeneinander — lists.fuN_text (Liste),
// followup_templates (Nutzer, ohne Oberfläche), reminder_settings und
// recycle_settings (Organisation) sowie hartkodierte Texte in
// actions/nachfassen.ts — mit DREI Platzhalter-Dialekten ({name} vs.
// {vorname}/{firma}/{anlass} vs. {vorname}/{firma}/{datum}/{uhrzeit}). Ein
// zwischen zwei Feldern kopierter Text rendert deshalb heute die rohe Klammer,
// ohne Fehlermeldung. Dieses Modul zieht beides zusammen: ein Katalog, ein
// Dialekt, eine Kette.

import { formatTerminParts } from "@/lib/apptTime";

/* ------------------------------------------------------------------ *
 * Katalog
 * ------------------------------------------------------------------ */

/**
 * Die Kaskaden-Stufen sind bewusst EINZELN geschlüsselt (setting_msg_1..3
 * statt eines gemeinsamen "template_setting_reminder"): Die Ausarbeitung
 * zeigt drei verschiedene Texte — "steht noch wie geplant?" / "wird ein cooles
 * Meeting morgen um XY Uhr" / "wollte dir noch einmal den Link durchschicken".
 * Der bisherige Code lieferte für alle drei Stufen dasselbe Feld.
 */
export const TEMPLATE_KEYS = [
  // Erstgespräch — Nachricht über den Akquise-Kanal
  "setting_msg_1",
  "setting_msg_2",
  "setting_msg_3",
  // Erstgespräch — Mail-Spur (Phase 2, im Kern weder angeboten noch gerendert)
  "setting_mail_1",
  "setting_mail_2",
  // Closing
  "closing_kickoff",
  "closing_msg_1",
  "closing_msg_2",
  "closing_msg_3",
  // Closing — Mail-Spur (Phase 2)
  "closing_mail_1",
  "closing_mail_2",
  "closing_mail_3",
  // Vereinbarter Nachfass-Kontakt
  "followup_msg_1",
  "followup_msg_2",
  "followup_msg_3",
  // No-Show — zweistufige Kette
  "no_show_setting_1",
  "no_show_setting_2",
  "no_show_closing_1",
  "no_show_closing_2",
  // Kein Close zustande gekommen — zweistufige Kette
  "kein_close_1",
  "kein_close_2",
  // Recycling
  "recycle_linkedin",
  "recycle_telefon",
  "recycle_setting",
  "recycle_closing",
  // LinkedIn-Nachfasssequenz
  "linkedin_fu_1",
  "linkedin_fu_2",
  "linkedin_fu_3",
  // Aufgaben-Texte (bisher hartkodiert, damit erstmals editierbar)
  "telefon_rueckruf",
  "setting_wiedervorlage",
  "closing_wiedervorlage",
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

const TEMPLATE_KEY_SET: ReadonlySet<string> = new Set(TEMPLATE_KEYS);

export function isTemplateKey(value: string): value is TemplateKey {
  return TEMPLATE_KEY_SET.has(value);
}

/**
 * Die Mail-Keys stehen von Anfang an im Katalog, werden im Kern aber weder
 * angeboten noch gerendert — sie sind der Andockpunkt für die auf Phase 2
 * vertagte Mail-Spur. Ein Key ohne Zeile kostet nichts; ein nachträglich
 * eingeführter Key erzwingt eine Migration mitten in laufender Vorlagenpflege.
 */
export const MAIL_TEMPLATE_KEYS: readonly TemplateKey[] = [
  "setting_mail_1",
  "setting_mail_2",
  "closing_mail_1",
  "closing_mail_2",
  "closing_mail_3",
];

export function isMailTemplate(key: TemplateKey): boolean {
  return MAIL_TEMPLATE_KEYS.includes(key);
}

/** Nur diese drei Keys kennen die Ausnahme "Text der Liste" (siehe resolveTemplate). */
export const LIST_SCOPED_KEYS: readonly TemplateKey[] = ["linkedin_fu_1", "linkedin_fu_2", "linkedin_fu_3"];

export type TemplateGroup =
  | "Erstgespräch"
  | "Closing"
  | "Nachfass-Kontakt"
  | "No-Show"
  | "Kein Close"
  | "Recycling"
  | "LinkedIn"
  | "Aufgaben";

/** Gruppe + Beschriftung je Key — die einzige Quelle für den Vorlagen-Editor (M13). */
export const TEMPLATE_META: Record<TemplateKey, { group: TemplateGroup; label: string; hint?: string }> = {
  setting_msg_1: { group: "Erstgespräch", label: "1. Erinnerung", hint: "Bestätigung, mehrere Tage vorher" },
  setting_msg_2: { group: "Erstgespräch", label: "2. Erinnerung", hint: "Vorfreude, am Tag davor" },
  setting_msg_3: { group: "Erstgespräch", label: "3. Erinnerung", hint: "Meeting-Link, kurz vorher" },
  setting_mail_1: { group: "Erstgespräch", label: "1. Erinnerungs-Mail", hint: "Mail-Spur, noch nicht aktiv" },
  setting_mail_2: { group: "Erstgespräch", label: "2. Erinnerungs-Mail", hint: "Mail-Spur, noch nicht aktiv" },

  closing_kickoff: { group: "Closing", label: "Nachricht direkt nach der Qualifizierung" },
  closing_msg_1: { group: "Closing", label: "1. Erinnerung", hint: "Bestätigung, mehrere Tage vorher" },
  closing_msg_2: { group: "Closing", label: "2. Erinnerung", hint: "Vorfreude, am Tag davor" },
  closing_msg_3: { group: "Closing", label: "3. Erinnerung", hint: "Meeting-Link, kurz vorher" },
  closing_mail_1: { group: "Closing", label: "1. Erinnerungs-Mail", hint: "Mail-Spur, noch nicht aktiv" },
  closing_mail_2: { group: "Closing", label: "2. Erinnerungs-Mail", hint: "Mail-Spur, noch nicht aktiv" },
  closing_mail_3: { group: "Closing", label: "3. Erinnerungs-Mail", hint: "Mail-Spur, noch nicht aktiv" },

  followup_msg_1: { group: "Nachfass-Kontakt", label: "1. Erinnerung" },
  followup_msg_2: { group: "Nachfass-Kontakt", label: "2. Erinnerung" },
  followup_msg_3: { group: "Nachfass-Kontakt", label: "3. Erinnerung" },

  no_show_setting_1: { group: "No-Show", label: "Erstgespräch — sofort", hint: "direkt im Termin" },
  no_show_setting_2: { group: "No-Show", label: "Erstgespräch — Tag danach", hint: "wenn keine Antwort kam" },
  no_show_closing_1: { group: "No-Show", label: "Closing — sofort", hint: "direkt im Termin anrufen" },
  no_show_closing_2: { group: "No-Show", label: "Closing — Tag danach", hint: "wenn keine Antwort kam" },

  kein_close_1: { group: "Kein Close", label: "Sofort nach dem Termin" },
  kein_close_2: { group: "Kein Close", label: "Tag danach", hint: "anrufen und schreiben" },

  recycle_linkedin: { group: "Recycling", label: "LinkedIn-Kontakt" },
  recycle_telefon: { group: "Recycling", label: "Telefon-Lead" },
  recycle_setting: { group: "Recycling", label: "Erstgespräch" },
  recycle_closing: { group: "Recycling", label: "Closing" },

  linkedin_fu_1: { group: "LinkedIn", label: "Follow-up 1", hint: "Text der Liste geht vor" },
  linkedin_fu_2: { group: "LinkedIn", label: "Follow-up 2", hint: "Text der Liste geht vor" },
  linkedin_fu_3: { group: "LinkedIn", label: "Follow-up 3", hint: "Text der Liste geht vor" },

  telefon_rueckruf: { group: "Aufgaben", label: "Telefon-Rückruf" },
  setting_wiedervorlage: { group: "Aufgaben", label: "Erstgespräch-Wiedervorlage" },
  closing_wiedervorlage: { group: "Aufgaben", label: "Closing-Wiedervorlage" },
};

/* ------------------------------------------------------------------ *
 * Auslieferungstexte
 * ------------------------------------------------------------------ */

export type TemplateText = { body: string; subject?: string };

/**
 * Die einzige Fundstelle der Standardtexte — bewusst kein SQL-DEFAULT und kein
 * Seeding bei der Anlage einer Organisation. Eine Zeile in `message_templates`
 * entsteht erst, wenn jemand einen Text bewusst ändert; ein geleertes Textfeld
 * löscht sie wieder (Muster setFollowupTemplate). Damit können SQL und TS nicht
 * auseinanderlaufen, und eine Textverbesserung wirkt sofort bei jedem Kunden,
 * der den Text nie angefasst hat.
 */
export const TEMPLATE_DEFAULTS: Record<TemplateKey, TemplateText> = {
  setting_msg_1: { body: "Hi {vorname}, unser Termin am {datum} steht noch wie geplant?" },
  setting_msg_2: { body: "Hi {vorname}, wird ein cooles Meeting morgen um {uhrzeit}." },
  setting_msg_3: {
    body: "Hi {vorname}, unser Termin ist ja gleich — wollte dir noch einmal den Link durchschicken: {link}",
  },
  setting_mail_1: {
    subject: "Unser Termin am {datum}",
    body: "Hallo {vorname},\n\nkurze Erinnerung an unseren Termin morgen um {uhrzeit}.\n\nViele Grüße\n{absender}",
  },
  setting_mail_2: {
    subject: "Gleich geht es los — {uhrzeit}",
    body: "Hallo {vorname},\n\nunser Termin startet in einer Stunde. Hier ist der Link: {link}\n\nViele Grüße\n{absender}",
  },

  closing_kickoff: {
    body: "Hi {vorname}, hat mich gefreut! Wie besprochen halten wir am {datum} um {uhrzeit} fest — ich schicke dir alles Weitere rechtzeitig.",
  },
  closing_msg_1: { body: "Hi {vorname}, der Termin am {datum} steht noch wie geplant?" },
  closing_msg_2: { body: "Hi {vorname}, wird ein cooles Meeting morgen um {uhrzeit}." },
  closing_msg_3: {
    body: "Hi {vorname}, unser Termin ist ja gleich — wollte dir noch einmal den Link durchschicken: {link}",
  },
  closing_mail_1: {
    subject: "Unser Termin am {datum}",
    body: "Hallo {vorname},\n\nich freue mich auf unseren Termin am {datum} um {uhrzeit}.\n\nViele Grüße\n{absender}",
  },
  closing_mail_2: {
    subject: "Erinnerung: morgen um {uhrzeit}",
    body: "Hallo {vorname},\n\nkurze Erinnerung an unseren Termin morgen um {uhrzeit}.\n\nViele Grüße\n{absender}",
  },
  closing_mail_3: {
    subject: "Gleich geht es los — {uhrzeit}",
    body: "Hallo {vorname},\n\nunser Termin startet in einer Stunde. Hier ist der Link: {link}\n\nViele Grüße\n{absender}",
  },

  followup_msg_1: { body: "Hi {vorname}, wie besprochen melde ich mich am {datum} bei dir zurück." },
  followup_msg_2: { body: "Hi {vorname}, wir hatten für morgen um {uhrzeit} gesprochen — passt das noch?" },
  followup_msg_3: { body: "Hi {vorname}, ich melde mich gleich wie vereinbart bei dir." },

  no_show_setting_1: {
    body: "Hi {vorname}, wir waren gerade verabredet — ist etwas dazwischengekommen? Sag gern kurz Bescheid, dann finden wir einen neuen Termin.",
  },
  no_show_setting_2: {
    body: "Hi {vorname}, ich wollte nochmal nachfassen wegen gestern. Passt ein neuer Termin bei dir, oder ist das Thema gerade nicht dran?",
  },
  no_show_closing_1: {
    body: "Hi {vorname}, wir waren gerade verabredet — ist etwas dazwischengekommen? Ich versuche es gleich nochmal telefonisch.",
  },
  no_show_closing_2: {
    body: "Hi {vorname}, ich habe es gestern und heute nicht erreicht. Sag mir gern kurz, ob und wann es bei dir passt.",
  },

  kein_close_1: {
    body: "Hi {vorname}, danke für das Gespräch. Ich fasse dir das Besprochene zusammen — sag mir gern, was du zum Thema {notiz} noch brauchst.",
  },
  kein_close_2: {
    body: "Hi {vorname}, ich wollte nochmal nachhören: Gibt es zu {notiz} noch offene Punkte, oder sollen wir es für den Moment ruhen lassen?",
  },

  recycle_linkedin: {
    body: "Hi {vorname}, wir hatten vor einiger Zeit schon einmal Kontakt — {anlass}. Ist das Thema bei euch inzwischen wieder aktuell?",
  },
  recycle_telefon: {
    body: "Hi {vorname}, wir hatten vor einiger Zeit telefoniert — {anlass}. Passt es gerade besser?",
  },
  recycle_setting: {
    body: "Hi {vorname}, wir hatten vor einiger Zeit ein Gespräch geplant — {anlass}. Sollen wir einen neuen Anlauf nehmen?",
  },
  recycle_closing: {
    body: "Hi {vorname}, wir hatten vor einiger Zeit über eine Zusammenarbeit gesprochen — {anlass}. Wie sieht es bei euch inzwischen aus?",
  },

  linkedin_fu_1: { body: "Hi {name}, hattest du meine Nachricht gesehen?" },
  linkedin_fu_2: { body: "Hi {name}, ich hake nochmal kurz nach — ist das Thema für euch interessant?" },
  linkedin_fu_3: {
    body: "Hi {name}, letzter Versuch von meiner Seite: Soll ich das Thema für dich noch offen halten oder erstmal zur Seite legen?",
  },

  telefon_rueckruf: { body: "Rückruf vereinbart — {firma} anrufen." },
  setting_wiedervorlage: { body: "Erstgespräch wieder aufnehmen — {firma}." },
  closing_wiedervorlage: { body: "Closing nachfassen — {firma}." },
};

/* ------------------------------------------------------------------ *
 * Platzhalter — ein Dialekt statt drei
 * ------------------------------------------------------------------ */

export const PLACEHOLDERS = [
  "vorname",
  "nachname",
  "name",
  "firma",
  "datum",
  "uhrzeit",
  "link",
  "anlass",
  "notiz",
  "kanal",
  "absender",
] as const;

export type Placeholder = (typeof PLACEHOLDERS)[number];

export const PLACEHOLDER_LABELS: Record<Placeholder, string> = {
  vorname: "Vorname des Leads",
  nachname: "Nachname des Leads",
  name: "Wie {vorname} — bleibt für gespeicherte Listen-Texte erhalten",
  firma: "Firma des Leads",
  datum: "Datum des Termins",
  uhrzeit: "Uhrzeit des Termins",
  link: "Meeting-Link",
  anlass: "Anlass der Wiedervorlage",
  notiz: "Erfasster Grund (Absage, Disqualifikation, Verlust)",
  kanal: "Kanal, über den kontaktiert wird",
  absender: "Name der zuständigen Person",
};

export type TemplateContext = {
  leadName?: string | null;
  company?: string | null;
  appointmentAtIso?: string | null;
  link?: string | null;
  anlass?: string | null;
  notiz?: string | null;
  kanal?: string | null;
  absender?: string | null;
};

/** Vorname aus einem vollen Namen — Muster firstName() in actions/nachfassen.ts. */
function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "";
}

function lastName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function valuesFor(ctx: TemplateContext): Record<Placeholder, string> {
  const parts = ctx.appointmentAtIso ? formatTerminParts(ctx.appointmentAtIso) : null;
  const vorname = firstName(ctx.leadName);
  return {
    vorname,
    nachname: lastName(ctx.leadName),
    // {name} ist ein DAUERHAFTER Alias auf {vorname}: In lists.fuN_text stehen
    // bei echten Kundendaten hunderte gespeicherte {name}-Vorlagen. Fällt der
    // Alias weg, rendern die alle ihren rohen Platzhalter — sichtbar erst beim
    // Kunden, ohne Fehlermeldung.
    name: vorname,
    firma: ctx.company?.trim() ?? "",
    datum: parts?.date ?? "",
    uhrzeit: parts?.time ?? "",
    link: ctx.link?.trim() ?? "",
    anlass: ctx.anlass?.trim() ?? "",
    notiz: ctx.notiz?.trim() ?? "",
    kanal: ctx.kanal?.trim() ?? "",
    absender: ctx.absender?.trim() ?? "",
  };
}

const TOKEN_RE = /\{([A-Za-zÄÖÜäöüß_]+)\}/g;

/**
 * Markiert die Stelle eines Platzhalters, der zu nichts aufgelöst hat. Ein
 * Zeichen, das in echtem Text nicht vorkommt — nur so kann `tidy()` einen
 * verwaisten Rest von normalem Text unterscheiden.
 */
const EMPTY_MARK = String.fromCharCode(0);

/** Verbindungswörter, die ohne ihr Bezugswort sinnlos werden. */
const CONNECTORS = "von|bei|für|aus|in|mit|zu|an|nach|über|um";

/**
 * Aufräumen, nachdem leere Platzhalter weggefallen sind. Ohne diesen Schritt
 * ergibt "Hallo {vorname} von {firma}," bei fehlender Firma wörtlich
 * "Hallo dir von ,". Bewusst gelöst durch Normalisieren statt durch eine
 * zweite Vorlagensyntax mit optionalen Blöcken — die vergrößerte genau die
 * Oberfläche, die dieses Modul zusammenzieht.
 *
 * Entscheidend ist, dass ein Verbindungswort NUR zusammen mit dem leer
 * gefallenen Platzhalter verschwindet, zu dem es gehört. Eine frühere Fassung
 * strich jedes Verbindungswort vor einem Satzzeichen — und traf damit
 * ausgerechnet die abgetrennte deutsche Vorsilbe: aus "ich bringe die
 * Unterlagen mit." wurde "ich bringe die Unterlagen.", lautlos und in jedem
 * selbst geschriebenen Text.
 */
function tidy(text: string): string {
  return text
    // Verbindungswort samt dem leeren Platzhalter, an dem es hing
    .replace(new RegExp(`\\s*\\b(?:${CONNECTORS})\\b\\s*${EMPTY_MARK}`, "gi"), "")
    // Übrige leere Platzhalter
    .replace(new RegExp(`\\s*${EMPTY_MARK}`, "g"), "")
    // Leerzeichen vor Satzzeichen
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    // Doppelte Satzzeichen, die durch den Wegfall entstanden sind
    .replace(/([,;:])\s*\1+/g, "$1")
    // Mehrfache Leerzeichen einkochen, Zeilenumbrüche erhalten
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Platzhalter füllen. Ersetzt wird CASE-INSENSITIV — bisher blieb ein
 * versehentliches {Vorname} wörtlich stehen und ging so an den Lead raus.
 * Unbekannte Token bleiben unangetastet, damit ein Tippfehler sichtbar wird,
 * statt still zu verschwinden; validateTemplate() meldet sie im Editor.
 */
export function renderTemplate(template: string, ctx: TemplateContext): string {
  const values = valuesFor(ctx);
  const filled = template.replace(TOKEN_RE, (match, rawToken: string) => {
    const token = rawToken.toLowerCase() as Placeholder;
    if (!(token in values)) return match;
    // Leere Werte hinterlassen eine Marke statt eines Leerstrings, damit
    // `tidy()` gleich danach unterscheiden kann, ob ein Verbindungswort
    // tatsaechlich verwaist ist oder einfach zum Satz gehoert.
    return values[token] || EMPTY_MARK;
  });
  return tidy(filled);
}

/** Im Editor verwendete Prüfung: welche Token kennt die App nicht? */
export function validateTemplate(template: string): { unknownTokens: string[] } {
  const unknown = new Set<string>();
  for (const match of template.matchAll(TOKEN_RE)) {
    const token = match[1].toLowerCase();
    if (!(PLACEHOLDERS as readonly string[]).includes(token)) unknown.add(match[1]);
  }
  return { unknownTokens: [...unknown] };
}

/* ------------------------------------------------------------------ *
 * Auflösungskette
 * ------------------------------------------------------------------ */

export type TemplateSource = "liste" | "persoenlich" | "organisation" | "auslieferung";

export const TEMPLATE_SOURCE_LABELS: Record<TemplateSource, string> = {
  liste: "Text dieser Liste",
  persoenlich: "Deine Vorlage",
  organisation: "Standard der Organisation",
  auslieferung: "Auslieferungstext",
};

/**
 * Die Vorlagen EINER Person: `own` sind ihre persönlichen Übersteuerungen,
 * `org` der Standard der Organisation (user_id is null). Geladen wird das
 * gebündelt je Absender, weil auf /erinnerungen jede Karte gegen die Vorlagen
 * IHRER zuständigen Person rendert — ein Owner in der Team-Ansicht sähe sonst
 * seine eigenen Texte unter fremden Namen.
 */
export type TemplateBundle = {
  own: Partial<Record<TemplateKey, TemplateText>>;
  org: Partial<Record<TemplateKey, TemplateText>>;
};

export const EMPTY_TEMPLATE_BUNDLE: TemplateBundle = { own: {}, org: {} };

export type ResolvedTemplate = { body: string; subject: string | null; source: TemplateSource };

function usable(text: TemplateText | undefined): TemplateText | null {
  return text && text.body.trim() ? text : null;
}

/**
 * Vorrangkette — genau eine Implementierung für die ganze App:
 *
 *   1. Text der Liste   (nur linkedin_fu_1..3, siehe unten)
 *   2. persönlich       (message_templates, user_id = Absender)
 *   3. Organisation     (message_templates, user_id is null)
 *   4. Auslieferung     (TEMPLATE_DEFAULTS)
 *
 * Die Listen-Stufe ist die EINZIGE Ausnahme von der zweistufigen Kette und
 * gilt ausschließlich für die LinkedIn-Nachfasssequenz: Dieser Text gehört
 * fachlich zum Pitch-Text derselben Liste und wird im Listen-Editor gepflegt.
 * `source` wird bis in die Oberfläche durchgereicht und dort als Badge
 * angezeigt — eine wirkende Vorlage kann damit nicht mehr unsichtbar sein.
 */
export function resolveTemplate(
  key: TemplateKey,
  bundle: TemplateBundle | null | undefined,
  listText?: string | null,
): ResolvedTemplate {
  if (LIST_SCOPED_KEYS.includes(key) && listText?.trim()) {
    return { body: listText.trim(), subject: null, source: "liste" };
  }

  const own = usable(bundle?.own?.[key]);
  if (own) return { body: own.body, subject: own.subject ?? null, source: "persoenlich" };

  const org = usable(bundle?.org?.[key]);
  if (org) return { body: org.body, subject: org.subject ?? null, source: "organisation" };

  const fallback = TEMPLATE_DEFAULTS[key];
  return { body: fallback.body, subject: fallback.subject ?? null, source: "auslieferung" };
}

/** Auflösen und in einem Schritt rendern — der Normalfall in den Boards. */
export function renderResolved(
  key: TemplateKey,
  bundle: TemplateBundle | null | undefined,
  ctx: TemplateContext,
  listText?: string | null,
): { body: string; subject: string | null; source: TemplateSource } {
  const resolved = resolveTemplate(key, bundle, listText);
  return {
    body: renderTemplate(resolved.body, ctx),
    subject: resolved.subject ? renderTemplate(resolved.subject, ctx) : null,
    source: resolved.source,
  };
}
