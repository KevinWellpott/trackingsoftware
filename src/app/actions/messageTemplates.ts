"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { isMailTemplate, isTemplateKey, validateTemplate } from "@/lib/messageTemplates";

// Schreibpfad des Vorlagen-Editors (/settings). Gelesen wird über
// getTemplateBundles() in actions/reminders.ts — diese Datei fasst nur an, was
// die Oberfläche ändert.
//
// Zwei Ebenen, zwei Actions. Beide folgen wörtlich dem Muster von
// setFollowupTemplate (actions/templates.ts): Ein LEERER Text löscht die
// eigene Zeile, statt einen leeren String zu speichern — der Text fällt damit
// eine Ebene höher zurück (persönlich → Organisation → Auslieferungstext).
// Ein gespeicherter Leerstring wäre etwas anderes: eine Vorlage, die eine
// leere Nachricht erzwingt. Der CHECK `btrim(body) <> ''` aus Migration 0031
// verbietet ihn ohnehin.
//
// Die Auslieferungstexte stehen ausschließlich in TEMPLATE_DEFAULTS
// (src/lib/messageTemplates.ts) und werden hier NIE geschrieben: Eine Zeile
// entsteht erst, wenn jemand einen Text bewusst ändert. Nur so erreicht eine
// spätere Textverbesserung jeden Kunden, der den Text nie angefasst hat.

export type TemplateWriteResult = {
  error?: string;
  /** true = die Zeile wurde gelöscht, es gilt wieder die Ebene darüber. */
  cleared?: boolean;
  /** Vom Nutzer getippte Token, die die App nicht kennt — Warnung, kein Fehler. */
  unknownTokens?: string[];
};

// Großzügig, aber endlich: Ohne Grenze landet ein versehentlich eingefügtes
// Dokument in einer Spalte, die auf jeder Erinnerungs-Karte gerendert wird.
const MAX_BODY = 4000;
const MAX_SUBJECT = 200;

type TemplateLevel = "org" | "own";

async function saveTemplate(
  level: TemplateLevel,
  key: string,
  body: string,
  subject?: string | null,
): Promise<TemplateWriteResult> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };

  if (!isTemplateKey(key)) return { error: "Unbekannte Vorlage." };

  // Die Mail-Spur ist auf Phase 2 vertagt: Die Keys stehen im Katalog, die
  // Kaskadenstufen sind in 0034 abgeschaltet, und der Kern rendert sie nicht.
  // Ein hier gespeicherter Text wäre ein Text, den niemand je zu sehen bekommt.
  if (isMailTemplate(key)) return { error: "Die Mail-Spur ist noch nicht aktiv." };

  if (level === "org") {
    // Wörtlich dasselbe Prädikat wie can_manage_org_settings() in der RLS
    // (Migration 0031): role='owner' UND data_scope='workspace'. Ohne den
    // zweiten Teil dürfte ein Owner mit eingeschränkter Datensicht den
    // teamweiten Standard ändern.
    if (!access.can_switch_view) {
      return { error: "Nur Owner mit workspace-weiter Datensicht dürfen den Standard der Organisation ändern." };
    }
  } else if (access.is_foreign_org) {
    // Ein Plattform-Admin ist in einer Kunden-Organisation KEIN Mitglied.
    // Seine persönliche Zeile wäre dort heimatlos: Sie hinge an einer
    // workspace_id, in der er nicht vorkommt, und würde in keiner Ansicht
    // dieser Organisation je wieder auftauchen.
    return { error: "In einer fremden Organisation gibt es keine persönliche Vorlage." };
  }

  const trimmedBody = body.trim();
  const trimmedSubject = (subject ?? "").trim();
  if (trimmedBody.length > MAX_BODY) return { error: `Text ist zu lang (max. ${MAX_BODY} Zeichen).` };
  if (trimmedSubject && !isMailTemplate(key)) {
    return { error: "Nur Mail-Vorlagen haben eine Betreffzeile." };
  }
  if (trimmedSubject.length > MAX_SUBJECT) return { error: `Betreff ist zu lang (max. ${MAX_SUBJECT} Zeichen).` };

  const supabase = await createClient();
  // IMMER das angemeldete Konto, NIE access.effective_user_id: Sonst
  // überschreibt ein Owner mit eingestellter Datensicht unbemerkt den
  // persönlichen Text eines Kollegen. Die RLS-Policy message_templates_own
  // prüft auth.uid() und würde das ohnehin abweisen — die Absicht gehört
  // trotzdem sichtbar hierher.
  const userId = level === "org" ? null : access.user.id;

  // Kein upsert: Die beiden Unique-Indizes aus 0031 sind PARTIELL
  // (`where user_id is null` bzw. `is not null`). PostgREST reicht bei
  // on_conflict nur Spaltennamen durch, ohne das Prädikat — Postgres findet
  // dann keinen passenden Arbiter und weist das Statement ab. Deshalb lesen,
  // dann schreiben.
  const base = supabase
    .from("message_templates")
    .select("id")
    .eq("workspace_id", access.workspace_id)
    .eq("template_key", key);
  const { data: existing, error: loadError } = await (
    userId === null ? base.is("user_id", null) : base.eq("user_id", userId)
  ).maybeSingle();
  if (loadError) return { error: loadError.message };

  const rowId = (existing as { id: string } | null)?.id ?? null;

  if (!trimmedBody) {
    if (rowId) {
      const { error } = await supabase.from("message_templates").delete().eq("id", rowId);
      if (error) return { error: error.message };
    }
    revalidateTemplateViews();
    return { cleared: true };
  }

  const payload = {
    workspace_id: access.workspace_id,
    user_id: userId,
    template_key: key,
    subject: trimmedSubject || null,
    body: trimmedBody,
    updated_by_user_id: access.user.id,
  };

  const { error } = rowId
    ? await supabase.from("message_templates").update(payload).eq("id", rowId)
    : await supabase.from("message_templates").insert(payload);
  if (error) return { error: error.message };

  revalidateTemplateViews();
  // Unbekannte Token blockieren NICHT: „{Vornmae}" ist ein Tippfehler, kein
  // Syntaxfehler, und renderTemplate lässt ihn bewusst stehen, statt ihn
  // stillschweigend zu entfernen. Gemeldet wird er trotzdem — bisher fiel er
  // erst auf, als er beim Lead ankam.
  return { unknownTokens: validateTemplate(trimmedBody).unknownTokens };
}

/** Jede Oberfläche, die Vorlagen rendert. */
function revalidateTemplateViews(): void {
  revalidatePath("/settings");
  revalidatePath("/erinnerungen");
  revalidatePath("/nachfassen");
}

/**
 * Standard der Organisation (`message_templates.user_id is null`).
 * Gate: Owner mit workspace-weiter Datensicht — in fremder Organisation
 * zusätzlich der Plattform-Admin, für den die RLS dasselbe erlaubt.
 */
export async function setOrgTemplate(
  key: string,
  body: string,
  subject?: string | null,
): Promise<TemplateWriteResult> {
  return saveTemplate("org", key, body, subject);
}

/**
 * Persönliche Übersteuerung des ANGEMELDETEN Kontos. Jedes Mitglied darf sie
 * für sich setzen; eine eingestellte Datensicht ändert daran nichts.
 */
export async function setOwnTemplate(
  key: string,
  body: string,
  subject?: string | null,
): Promise<TemplateWriteResult> {
  return saveTemplate("own", key, body, subject);
}
