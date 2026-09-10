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
  | "Setting"
  | "Closing"
  | "Nachfass-Kontakt"
  | "No-Show"
  | "Kein Close"
  | "Recycling"
  | "LinkedIn"
  | "Aufgaben";

/**
 * Welche Platzhalter eine Vorlage füllen KANN — je Schlüssel, nicht global.
 *
 * `template_catalog.placeholders` (Migration 0031) pflegt dieselbe Angabe in
 * der Datenbank, wird aber von keiner Zeile Code gelesen; der Editor bot
 * deshalb allen 31 Vorlagen dieselben elf Platzhalter an. Wer in
 * `setting_msg_1` ein `{notiz}` schrieb, kam durch die Prüfung, und beim
 * Rendern verschwand der Platzhalter lautlos — der Gedankenstrich davor blieb
 * stehen („wegen — steht unser Termin"). Zu unauffällig zum Bemerken,
 * auffällig genug zum Rausgehen.
 *
 * Maßgeblich ist, was der jeweilige RENDERPFAD tatsächlich übergibt — nicht,
 * was der Katalog aufzählt. An zwei Stellen laufen beide auseinander, jeweils
 * mit Absicht:
 *   • Die Sets hier sind an mehreren Stellen GRÖSSER (etwa {absender} und
 *     {kanal} in jeder Kaskaden-Stufe): Die Renderer füllen sie, eine Warnung
 *     dafür wäre falsch — und eine Warnung, die auch dann erscheint, wenn
 *     alles stimmt, bringt man sich schnell bei zu übersehen.
 *   • Bei `kein_close_1/2` sind sie KLEINER: Der Katalog nennt dort {notiz},
 *     der No-Close-Pfad läuft aber über die beiden Touch-Renderer, und die
 *     übergeben keins. Da irrt der Katalog (0031 ist eingefroren, das ist erst
 *     mit einer neuen Migration zu korrigieren und bleibt folgenlos, solange
 *     die Spalte niemand liest).
 */
const P_LEAD = ["vorname", "nachname", "name", "firma"] as const;
/** Wiedervorlage-Aufgaben: Lead + Fälligkeitstag + zuständige Person. */
const P_AUFGABE = [...P_LEAD, "datum", "uhrzeit", "absender"] as const;
/** Telefon-Rückruf — wie eine Aufgabe, zusätzlich mit festem Kanal. */
const P_RUECKRUF = [...P_AUFGABE, "kanal"] as const;
/** Kaskaden- und Ketten-Stufen: was ErinnerungenBoard und CascadePanel übergeben. */
const P_TOUCH = [...P_AUFGABE, "link", "kanal"] as const;
/** LinkedIn-Nachfassen: kein Termin, also weder Datum noch Uhrzeit noch Link. */
const P_LINKEDIN = [...P_LEAD, "absender"] as const;
/** Recycling: kein Termin, dafür Anlass und der Freitext neben dem Grund. */
const P_RECYCLING = [...P_LEAD, "anlass", "notiz"] as const;

type TemplateMeta = {
  group: TemplateGroup;
  label: string;
  hint?: string;
  placeholders: readonly Placeholder[];
};

/** Gruppe + Beschriftung + gültige Platzhalter je Key — die einzige Quelle für den Vorlagen-Editor. */
export const TEMPLATE_META: Record<TemplateKey, TemplateMeta> = {
  setting_msg_1: { group: "Setting", label: "1. Erinnerung", hint: "Bestätigung, mehrere Tage vorher", placeholders: P_TOUCH },
  setting_msg_2: { group: "Setting", label: "2. Erinnerung", hint: "Vorfreude, am Tag davor", placeholders: P_TOUCH },
  setting_msg_3: { group: "Setting", label: "3. Erinnerung", hint: "kurz vorher, mit Meeting-Link", placeholders: P_TOUCH },
  setting_mail_1: { group: "Setting", label: "1. Erinnerungs-Mail", hint: "Mail-Spur, noch nicht aktiv", placeholders: P_TOUCH },
  setting_mail_2: { group: "Setting", label: "2. Erinnerungs-Mail", hint: "Mail-Spur, noch nicht aktiv", placeholders: P_TOUCH },

  closing_kickoff: { group: "Closing", label: "Nachricht direkt nach der Qualifizierung", placeholders: P_TOUCH },
  closing_msg_1: { group: "Closing", label: "1. Erinnerung", hint: "Bestätigung, mehrere Tage vorher", placeholders: P_TOUCH },
  closing_msg_2: { group: "Closing", label: "2. Erinnerung", hint: "Vorfreude, am Tag davor", placeholders: P_TOUCH },
  closing_msg_3: { group: "Closing", label: "3. Erinnerung", hint: "kurz vorher, mit Meeting-Link", placeholders: P_TOUCH },
  closing_mail_1: { group: "Closing", label: "1. Erinnerungs-Mail", hint: "Mail-Spur, noch nicht aktiv", placeholders: P_TOUCH },
  closing_mail_2: { group: "Closing", label: "2. Erinnerungs-Mail", hint: "Mail-Spur, noch nicht aktiv", placeholders: P_TOUCH },
  closing_mail_3: { group: "Closing", label: "3. Erinnerungs-Mail", hint: "Mail-Spur, noch nicht aktiv", placeholders: P_TOUCH },

  followup_msg_1: { group: "Nachfass-Kontakt", label: "1. Erinnerung", placeholders: P_TOUCH },
  followup_msg_2: { group: "Nachfass-Kontakt", label: "2. Erinnerung", placeholders: P_TOUCH },
  followup_msg_3: { group: "Nachfass-Kontakt", label: "3. Erinnerung", placeholders: P_TOUCH },

  no_show_setting_1: { group: "No-Show", label: "Setting — sofort", hint: "direkt im Termin", placeholders: P_TOUCH },
  no_show_setting_2: { group: "No-Show", label: "Setting — Tag danach", hint: "wenn keine Antwort kam", placeholders: P_TOUCH },
  no_show_closing_1: { group: "No-Show", label: "Closing — sofort", hint: "direkt im Termin anrufen", placeholders: P_TOUCH },
  no_show_closing_2: { group: "No-Show", label: "Closing — Tag danach", hint: "wenn keine Antwort kam", placeholders: P_TOUCH },

  kein_close_1: { group: "Kein Close", label: "Sofort nach dem Termin", placeholders: P_TOUCH },
  kein_close_2: { group: "Kein Close", label: "Tag danach", hint: "anrufen und schreiben", placeholders: P_TOUCH },

  recycle_linkedin: { group: "Recycling", label: "LinkedIn-Kontakt", placeholders: P_RECYCLING },
  recycle_telefon: { group: "Recycling", label: "Telefon-Lead", placeholders: P_RECYCLING },
  recycle_setting: { group: "Recycling", label: "Setting", placeholders: P_RECYCLING },
  recycle_closing: { group: "Recycling", label: "Closing", placeholders: P_RECYCLING },

  linkedin_fu_1: { group: "LinkedIn", label: "Follow-up 1", hint: "Text der Liste geht vor", placeholders: P_LINKEDIN },
  linkedin_fu_2: { group: "LinkedIn", label: "Follow-up 2", hint: "Text der Liste geht vor", placeholders: P_LINKEDIN },
  linkedin_fu_3: { group: "LinkedIn", label: "Follow-up 3", hint: "Text der Liste geht vor", placeholders: P_LINKEDIN },

  telefon_rueckruf: { group: "Aufgaben", label: "Telefon-Rückruf", placeholders: P_RUECKRUF },
  setting_wiedervorlage: { group: "Aufgaben", label: "Setting-Wiedervorlage", placeholders: P_AUFGABE },
  closing_wiedervorlage: { group: "Aufgaben", label: "Closing-Wiedervorlage", placeholders: P_AUFGABE },
};

/* ------------------------------------------------------------------ *
 * Auslieferungstexte
 * ------------------------------------------------------------------ */

export type TemplateText = { body: string; subject?: string };

/**
 * Die einzige Fundstelle der Standardtexte — bewusst kein SQL-DEFAULT und kein
 * Seeding bei der Anlage einer Organisation. Eine Zeile in `message_templates`
 * entsteht erst, wenn jemand einen Text bewusst ändert; ein geleertes Textfeld
 * löscht sie wieder (so halten es die beiden Actions in
 * app/actions/messageTemplates.ts). Damit können SQL und TS nicht
 * auseinanderlaufen, und eine Textverbesserung wirkt sofort bei jedem Kunden,
 * der den Text nie angefasst hat.
 *
 * REGEL für jeden Text hier: Vor einem optionalen Platzhalter darf kein
 * TRENNER stehen, den `tidy()` nicht mitnehmen kann — kein Gedankenstrich, kein
 * Doppelpunkt, keine zusammengezogene Präposition ("am", "zum", "beim"), die
 * nicht in CONNECTORS steht. `tidy()` räumt nur Verbindungswörter aus der
 * CONNECTORS-Liste weg; alles andere bleibt sichtbar stehen. „Erstgespräch
 * wieder aufnehmen — {firma}." wurde ohne Firma wörtlich zu „Erstgespräch
 * wieder aufnehmen —.", „unser Termin am {datum}" ohne Termin zu „unser Termin
 * am". Deshalb sitzt der optionale Wert hier überall entweder hinter einem
 * Verbindungswort (mit/bei/für/zu/um …) oder hinter einem abgeschlossenen Satz.
 * Der Test „kein Auslieferungstext lässt einen Trenner zurück" hält das fest.
 *
 * Genau EINE Ausnahme: {anlass} in den vier Recycling-Texten steht hinter einem
 * Gedankenstrich. Der Wert kann dort nicht leer werden — `renderRecycleTemplate`
 * fällt immer auf RECYCLE_REASON_FALLBACK_HINT zurück —, und die Anlass-Texte
 * sind kleingeschriebene Teilsätze ("vielleicht passt der Zeitpunkt inzwischen
 * besser"), die genau diesen Platz brauchen.
 */
export const TEMPLATE_DEFAULTS: Record<TemplateKey, TemplateText> = {
  setting_msg_1: { body: "Hi {vorname}, unser Termin für {datum} steht noch wie geplant?" },
  setting_msg_2: { body: "Hi {vorname}, wird ein cooles Meeting morgen um {uhrzeit}." },
  // Kein Satz über den Link, sondern der Link als Anhang: Ein Erstgespräch mit
  // meeting_kind='telefon' hat gar keinen meet_link (die Rufnummer steht in
  // setting_calls.phone und ist kein Platzhalter), und seit Migration 0029 ist
  // Telefon eine gleichberechtigte Termin-Art. „wollte dir noch einmal den Link
  // durchschicken." ging dort ohne Link raus — der Satz blieb, der Gegenstand
  // fehlte. So trägt der Text beide Termin-Arten, und mit Link steht er
  // trotzdem drin.
  setting_msg_3: {
    body: "Hi {vorname}, es geht gleich um {uhrzeit} los — bis dann! {link}",
  },
  setting_mail_1: {
    subject: "Unser Termin für {datum}",
    body: "Hallo {vorname},\n\nkurze Erinnerung an unseren Termin morgen um {uhrzeit}.\n\nViele Grüße\n{absender}",
  },
  setting_mail_2: {
    subject: "Es geht gleich los um {uhrzeit}",
    body: "Hallo {vorname},\n\nunser Termin startet in einer Stunde. {link}\n\nViele Grüße\n{absender}",
  },

  closing_kickoff: {
    body: "Hi {vorname}, hat mich gefreut! Der Termin für {datum} um {uhrzeit} steht — ich schicke dir alles Weitere rechtzeitig.",
  },
  closing_msg_1: { body: "Hi {vorname}, der Termin für {datum} steht noch wie geplant?" },
  closing_msg_2: { body: "Hi {vorname}, wird ein cooles Meeting morgen um {uhrzeit}." },
  // Wie setting_msg_3 (s. o.): der Link als Anhang statt als Ankündigung.
  closing_msg_3: {
    body: "Hi {vorname}, es geht gleich um {uhrzeit} los — bis dann! {link}",
  },
  closing_mail_1: {
    subject: "Unser Termin für {datum}",
    body: "Hallo {vorname},\n\nich freue mich auf unseren Termin für {datum} um {uhrzeit}.\n\nViele Grüße\n{absender}",
  },
  closing_mail_2: {
    subject: "Erinnerung: morgen um {uhrzeit}",
    body: "Hallo {vorname},\n\nkurze Erinnerung an unseren Termin morgen um {uhrzeit}.\n\nViele Grüße\n{absender}",
  },
  closing_mail_3: {
    subject: "Es geht gleich los um {uhrzeit}",
    body: "Hallo {vorname},\n\nunser Termin startet in einer Stunde. {link}\n\nViele Grüße\n{absender}",
  },

  followup_msg_1: { body: "Hi {vorname}, wie besprochen melde ich mich {datum} bei dir zurück." },
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

  // Beide Texte benutzten früher {notiz} — den füllt auf diesem Weg niemand:
  // Die No-Close-Kette läuft über die beiden Touch-Renderer, und die übergeben
  // Lead, Firma, Termin, Link, Kanal und Absender, aber keine Notiz. Gerendert
  // stand da „…was du noch brauchst." — es ging nur deshalb grammatisch gut,
  // weil „zu" in CONNECTORS steht. Statt den Platzhalter zu füllen (der Grund
  // ist an dieser Stelle noch gar nicht erfasst) sagen die Texte dasselbe ohne
  // ihn.
  kein_close_1: {
    body: "Hi {vorname}, danke für das Gespräch. Ich fasse dir das Besprochene gleich noch einmal zusammen — sag mir gern, was du für deine Entscheidung noch brauchst.",
  },
  kein_close_2: {
    body: "Hi {vorname}, ich wollte nochmal nachhören: Gibt es aus unserem Gespräch noch offene Punkte, oder sollen wir es für den Moment ruhen lassen?",
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

  telefon_rueckruf: { body: "Rückruf vereinbart — jetzt bei {firma} anrufen." },
  setting_wiedervorlage: { body: "Erstgespräch mit {firma} wieder aufnehmen." },
  closing_wiedervorlage: { body: "Closing bei {firma} nachfassen." },
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

/**
 * Alles zwischen zwei geschweiften Klammern gilt als Platzhalter-VERSUCH — auch
 * das, was nicht wie ein gültiger Name aussieht. Das engere Muster
 * (`[A-Za-zÄÖÜäöüß_]+`) übersah ausgerechnet die beiden häufigsten Vertipper:
 * `{vorname2}` (Ziffer) und `{ vorname }` (Leerzeichen). Beide wurden weder
 * ersetzt NOCH gemeldet und gingen wörtlich an den Lead — der stillste
 * Fehlerweg von allen. Ersetzt wird weiterhin nur, was exakt einem bekannten
 * Platzhalter entspricht (`renderTemplate`); alles andere bleibt sichtbar
 * stehen und wird von `validateTemplate()` gemeldet.
 *
 * Ohne Zeilenumbruch im Token: Eine vergessene schließende Klammer soll nicht
 * den halben Mailtext als ein Token verschlucken.
 */
const TOKEN_RE = /\{([^{}\n]*)\}/g;

/**
 * Markiert die Stelle eines Platzhalters, der zu nichts aufgelöst hat. Ein
 * Zeichen, das in echtem Text nicht vorkommt — nur so kann `tidy()` einen
 * verwaisten Rest von normalem Text unterscheiden.
 */
const EMPTY_MARK = String.fromCharCode(0);

/** Verbindungswörter, die ohne ihr Bezugswort sinnlos werden. */
const CONNECTORS = "von|bei|für|aus|in|mit|zu|an|nach|über|um";

/**
 * Wortzeichen EINSCHLIESSLICH Umlauten — der Ersatz für `\b`.
 *
 * `\b` ist in JavaScript ohne `u`-Flag ASCII-basiert, und auch mit `u`-Flag
 * bleibt es das: `ü` gilt dort als Nicht-Wortzeichen. Zwischen einem
 * Leerzeichen und einem `ü` liegt damit keine Wortgrenze, und `\büber\b` griff
 * schlicht NIE — „über" war der einzige der elf Verbinder, den `tidy()` stehen
 * ließ. Aus „Frage über {firma}." wurde ohne Firma wörtlich „Frage über.",
 * während alle zehn anderen sauber zu „Frage." kollabierten. Auslieferungstexte
 * traf das nicht, jeden selbst geschriebenen Listen-, Organisations- und
 * Nutzertext aber schon — also genau die Menge, für die CONNECTORS existiert.
 *
 * Lookarounds statt `\b` lösen das, ohne die Gegenrichtung zu opfern: „Umsatz"
 * darf sein „Um" nicht verlieren und „zufrieden" nicht sein „zu".
 */
const WORD_CHAR = "A-Za-zÄÖÜäöüß0-9_";

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
    .replace(
      new RegExp(`\\s*(?<![${WORD_CHAR}])(?:${CONNECTORS})(?![${WORD_CHAR}])\\s*${EMPTY_MARK}`, "gi"),
      "",
    )
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

/**
 * Zwei Listen statt einer, weil die beiden Fehler verschieden AUSGEHEN und
 * deshalb verschieden klingen müssen:
 *   • unbekannt   → geht mit Klammer wörtlich an den Lead raus (sichtbar)
 *   • nicht gefüllt → verschwindet lautlos und lässt den Trenner davor stehen
 */
export type TemplateIssues = {
  /** Token, das die App überhaupt nicht kennt. */
  unknownTokens: string[];
  /** Token, das die App kennt — nur füllt dieser Vorlagenpfad es nie. */
  unsupportedTokens: string[];
};

/**
 * Im Editor verwendete Prüfung. MIT Vorlagenschlüssel prüft sie zusätzlich
 * gegen `TEMPLATE_META[key].placeholders`, ohne ihn nur global.
 *
 * Alle heutigen Aufrufer übergeben den Schlüssel (Editor und Schreib-Action);
 * der schlüssellose Zweig ist die Tür für einen freien Text ohne Katalog-Eintrag
 * — der Nachfass-Text einer Liste wäre der Kandidat, dessen Editor prüft heute
 * aber gar nicht. Er steht bewusst offen, weil die globale Prüfung für so einen
 * Text die einzig mögliche ist: Ohne Schlüssel gibt es kein Platzhalter-Set.
 */
export function validateTemplate(template: string, key?: TemplateKey): TemplateIssues {
  const allowed = key ? new Set<string>(TEMPLATE_META[key].placeholders) : null;
  const unknown = new Set<string>();
  const unsupported = new Set<string>();
  for (const match of template.matchAll(TOKEN_RE)) {
    const raw = match[1];
    // „{}" ist keine Absicht, sondern eine Klammer im Fließtext.
    if (!raw.trim()) continue;
    const token = raw.toLowerCase();
    if (!(PLACEHOLDERS as readonly string[]).includes(token)) unknown.add(raw);
    else if (allowed && !allowed.has(token)) unsupported.add(token);
  }
  return { unknownTokens: [...unknown], unsupportedTokens: [...unsupported] };
}

/**
 * Der Beispiel-Lead der Editor-Vorschau. Fest verdrahtet und VOLLSTÄNDIG
 * gefüllt: Die Vorschau soll zeigen, wie der Text beim Lead aussieht — was
 * ohne Wert passiert, sagt die Warnung am Feld. Ein halb leeres Beispiel ließe
 * beides ununterscheidbar aussehen.
 *
 * 17.07. ist ein Donnerstag, die Uhrzeit steht in Berliner Wandzeit (14:00 =
 * 12:00 UTC im Sommer) — die Beschriftung über der Vorschau (PREVIEW_LABEL)
 * nennt beides wörtlich.
 */
export const PREVIEW_EXAMPLE: TemplateContext = {
  leadName: "Max Meier",
  company: "Muster GmbH",
  appointmentAtIso: "2025-07-17T12:00:00.000Z",
  link: "https://meet.example.com/abc-defg-hij",
  anlass: "vielleicht passt der Zeitpunkt inzwischen besser",
  notiz: "Budget",
  kanal: "LinkedIn",
  absender: "Simon",
};

/**
 * Die Beschriftung über der Vorschau — hier und nicht in der Karte, weil sie
 * PREVIEW_EXAMPLE wörtlich zitiert: Wer den Beispiel-Lead ändert und die
 * Beschriftung vergisst, behauptet über der Vorschau einen Namen, der darin
 * nicht vorkommt. Nebeneinander liegend hält ein Test beide zusammen
 * (tests/messageTemplates.test.ts).
 *
 * Beide Hälften tragen: „Wirkt bei dir" sagt, dass hier der Text der
 * GEWINNENDEN Ebene steht (das Badge daneben nennt welche) — nicht zwingend
 * der eigene Entwurf; der Rest nennt die Beispielwerte, damit niemand die
 * erfundenen Daten für echte hält. Ohne die erste Hälfte hing die ganze
 * Information am Badge.
 */
export const PREVIEW_LABEL = "Wirkt bei dir — Beispiel: Max Meier, Muster GmbH, Do 17.07., 14:00";

/**
 * Übersetzt den einen Datenbankfehler, den der Vorlagen-Editor im Alltag
 * auslösen kann. Der Schreibpfad liest erst und schreibt dann — die beiden
 * Unique-Indizes aus Migration 0031 sind PARTIELL, ein `upsert` fände keinen
 * Arbiter. Zwischen Lesen und Schreiben kann eine zweite Sitzung dieselbe
 * Vorlage anlegen; Postgres wirft dann 23505, und ohne Übersetzung stand
 * „duplicate key value violates unique constraint uq_message_templates_org"
 * als Feldfehler unter dem Textfeld.
 *
 * Alles andere bleibt wörtlich stehen: Eine erfundene Übersetzung ließe
 * RLS-Verweigerung und fehlende Migration gleich aussehen.
 */
export function templateWriteErrorMessage(error: { code?: string | null; message: string }): string {
  if (error.code === "23505") {
    return "Diese Vorlage wurde gerade an anderer Stelle gespeichert. Lade die Seite neu — dann steht der aktuelle Text im Feld und du kannst deine Änderung noch einmal eintragen.";
  }
  return error.message;
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
 * Der Betreff läuft SEPARAT durch dieselbe Kette — und das ist kein Detail:
 * Der Editor hat für den Betreff bis heute gar kein Feld, eine persönliche
 * Mail-Vorlage ohne Betreff ist also der Normalfall. Hing der Betreff am
 * Fundort des Textes, verlor genau dieser Normalfall den Betreff der Ebene
 * darunter, und die Mail ginge betrefflos raus. Heute folgenlos (die Mail-Spur
 * ist abgeschaltet), beim Aktivieren von Phase 2 nicht mehr.
 */
function resolveSubject(key: TemplateKey, bundle: TemplateBundle | null | undefined): string | null {
  for (const candidate of [bundle?.own?.[key]?.subject, bundle?.org?.[key]?.subject, TEMPLATE_DEFAULTS[key].subject]) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return null;
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
  // `source` beschreibt den TEXT — er trägt die Nachricht und steht als Badge
  // im Editor. Der Betreff kommt unabhängig davon (resolveSubject).
  const subject = resolveSubject(key, bundle);

  if (LIST_SCOPED_KEYS.includes(key) && listText?.trim()) {
    return { body: listText.trim(), subject, source: "liste" };
  }

  const own = usable(bundle?.own?.[key]);
  if (own) return { body: own.body, subject, source: "persoenlich" };

  const org = usable(bundle?.org?.[key]);
  if (org) return { body: org.body, subject, source: "organisation" };

  return { body: TEMPLATE_DEFAULTS[key].body, subject, source: "auslieferung" };
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
