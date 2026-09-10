"use client";

import { useActionState, useCallback, useMemo, useState } from "react";
import { MessagesSquare, Search } from "lucide-react";
import { setOrgTemplate, setOwnTemplate } from "@/app/actions/messageTemplates";
import {
  LIST_SCOPED_KEYS,
  MAIL_TEMPLATE_KEYS,
  PLACEHOLDER_LABELS,
  PREVIEW_EXAMPLE,
  PREVIEW_LABEL,
  TEMPLATE_META,
  TEMPLATE_SOURCE_LABELS,
  isMailTemplate,
  renderTemplate,
  resolveTemplate,
  validateTemplate,
  type TemplateBundle,
  type TemplateGroup,
  type TemplateKey,
  type TemplateSource,
} from "@/lib/messageTemplates";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { Collapsible } from "@/components/settings/Collapsible";
import {
  FIELD_ERROR,
  FIELD_HINT,
  FIELD_OK,
  FIELD_WARN,
  SECTION_BODY,
  SECTION_HEAD,
  SECTION_META,
  SECTION_TITLE,
} from "@/components/settings/settingsStyles";

// Der Vorlagen-Editor: ALLE Nachrichtentexte der App an einer Stelle.
//
// Vorher lagen sie auf vier Speichermodellen — Listen-Text, followup_templates
// (ohne jede Oberfläche), reminder_settings, recycle_settings — plus
// hartkodierten Texten. Der schlimmste Fall war nicht die Verteilung, sondern
// die Unsichtbarkeit: Eine persönliche Follow-up-Vorlage wirkte bei jedem
// Nachfassen, ohne dass es einen Bildschirm gab, auf dem sie stand. Deshalb
// trägt hier JEDE Zeile den aktuell wirkenden Text und ein Badge, woher er
// kommt (resolveTemplate → TemplateSource).
//
// Zwei Ebenen, aber nur EIN Textfeld je Vorlage: Der Umschalter oben legt
// fest, WELCHE Ebene gerade bearbeitet wird. Zwei Felder nebeneinander wären
// 26 Vorlagen × 2 Textfelder auf einem Bildschirm — und die Frage „welches
// von beiden wirkt gerade?" bliebe trotzdem offen. So beantwortet sie das
// Badge, und die Vorschau zeigt, was daraus wird.
//
// Drei Entscheidungen gegen Überforderung, alle am selben Problem — 31
// Vorlagen sind zu viele, um sie am Stück zu lesen:
//   1. Vorschau statt Rohtext, und zwar mitlaufend. Der Block zeigte
//      `{vorname}`; unsichtbar blieb damit ausgerechnet das Klügste am System
//      — dass ein leerer Platzhalter sein Füllwort mitnimmt. Gerendert wird
//      der ENTWURF im Feld, durch die Vorrangkette aufgelöst (TemplateRow).
//   2. Ein Suchfeld. 31 Vorlagen in 8 Gruppen findet man sonst nur, indem man
//      jede Gruppe aufklappt.
//   3. Die fünf abgeschalteten Mail-Vorlagen stehen unten für sich. Vorher
//      meldete „Erstgespräch" 5 Vorlagen, von denen 3 änderbar waren — die
//      Gruppenzähler logen über den Arbeitsumfang, und die Erklärung „noch
//      nicht aktiv" stand fünfmal.

/** Die beiden Ebenen, die hier bearbeitet werden — Teilmenge von TemplateSource. */
type EditLevel = Extract<TemplateSource, "organisation" | "persoenlich">;

const SOURCE_TONE: Record<TemplateSource, BadgeTone> = {
  liste: "info",
  persoenlich: "accent",
  organisation: "info",
  auslieferung: "neutral",
};

/**
 * Gruppen in der Reihenfolge, in der TEMPLATE_META sie einführt — OHNE die
 * Mail-Spur: Die fünf abgeschalteten Vorlagen bekommen unten eine eigene
 * Aufklappung, damit die Gruppenzähler wieder das zählen, was man ändern kann.
 */
const GROUPS: { group: TemplateGroup; keys: TemplateKey[] }[] = (() => {
  const out: { group: TemplateGroup; keys: TemplateKey[] }[] = [];
  for (const [key, meta] of Object.entries(TEMPLATE_META) as [TemplateKey, (typeof TEMPLATE_META)[TemplateKey]][]) {
    if (isMailTemplate(key)) continue;
    const bucket = out.find((g) => g.group === meta.group);
    if (bucket) bucket.keys.push(key);
    else out.push({ group: meta.group, keys: [key] });
  }
  return out;
})();

const GROUP_NOTES: Partial<Record<TemplateGroup, string>> = {
  // Ausdrücklich hier und zusätzlich am einzelnen Feld: Die Listen-Stufe ist
  // die einzige Ausnahme von der zweistufigen Kette (resolveTemplate), und wer
  // sie nicht kennt, ändert hier einen Text und wundert sich, dass beim
  // Nachfassen ein anderer erscheint.
  LinkedIn:
    "Trägt eine Liste einen eigenen Nachfass-Text (Listen-Editor, FU1–FU3), hat dieser Vorrang — dann wirkt für Kontakte dieser Liste keiner der Texte hier.",
  Aufgaben: "Kurze Merktexte auf den Karten unter „Nachfassen“ — sie gehen an niemanden raus.",
};

const CHIP: React.CSSProperties = {
  fontFamily: "var(--font-mono-stack)",
  fontSize: "var(--fs-xs)",
  color: "var(--text-secondary)",
  background: "var(--surface-1)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--r-sm)",
  padding: "2px 7px",
  whiteSpace: "nowrap",
};

const READONLY_BLOCK: React.CSSProperties = {
  margin: 0,
  whiteSpace: "pre-wrap",
  fontSize: "var(--fs-sm)",
  lineHeight: "var(--lh-base)",
  color: "var(--text-secondary)",
  background: "var(--surface-1)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--r-md)",
  padding: "var(--sp-4) var(--sp-5)",
};

/* ------------------------------------------------------------------ *
 * Eine Vorlage
 * ------------------------------------------------------------------ */

type RowState = {
  error?: string;
  note?: string;
  unknownTokens?: string[];
  unsupportedTokens?: string[];
  /** true = die Zeile dieser Ebene wurde gelöscht. */
  cleared?: boolean;
  /** Zuletzt erfolgreich gespeicherter Text — hält „Zurücksetzen" aktuell. */
  savedBody?: string;
};
const IDLE: RowState = {};

function TemplateRow({
  templateKey,
  level,
  bundle,
  draft,
  onDraftChange,
  editable,
  lockedReason,
  mailExplained = false,
}: {
  templateKey: TemplateKey;
  level: EditLevel;
  bundle: TemplateBundle;
  /** Entwurf dieser Zeile — undefined heißt „noch nichts getippt", siehe MessageTemplatesCard. */
  draft?: string;
  onDraftChange: (value: string) => void;
  /** false = Ebene für diesen Nutzer gesperrt (fremde Organisation, fehlendes Recht). */
  editable: boolean;
  lockedReason?: string;
  /** true = die Zeile steht im Mail-Block, der „noch nicht aktiv" schon erklärt. */
  mailExplained?: boolean;
}) {
  const meta = TEMPLATE_META[templateKey];
  const isMail = isMailTemplate(templateKey);
  // Für die LinkedIn-Sequenz kann eine Liste den Text überstimmen. Der Editor
  // löst die Kette ohne Listentext auf und wüsste davon nichts — das Badge
  // behauptete deshalb „Deine Vorlage" für einen Text, den die Liste schlägt.
  //
  // Sichtbar steht der Vorbehalt trotzdem nur EINMAL je Zeile: als
  // meta.hint („Text der Liste geht vor") neben der Beschriftung, dazu einmal
  // je Gruppe in GROUP_NOTES. Ein Zusatz am Badge stand daneben ein zweites
  // Mal in derselben Zeile — und behauptete ihn auch dort, wo gar keine Liste
  // einen eigenen FU-Text trägt: Die Karte bekommt die Listentexte nicht
  // übergeben und kann beide Fälle nicht unterscheiden. Am Badge bleibt er
  // deshalb nur im title, wo er als Regel und nicht als Befund gelesen wird.
  const listMayWin = LIST_SCOPED_KEYS.includes(templateKey);
  const current = level === "organisation" ? bundle.org[templateKey] : bundle.own[templateKey];
  const stored = current?.body ?? "";
  const value = draft ?? stored;

  // Geprüft wird MIT dem Schlüssel: {notiz} ist im Recycling richtig und in
  // einer Termin-Erinnerung ein Wert, den dieser Pfad nie füllt.
  const issues = useMemo(() => validateTemplate(value, templateKey), [value, templateKey]);

  // Die Vorschau läuft gegen den ENTWURF im Feld, nicht gegen den zuletzt
  // gespeicherten Stand: Sie sprang sonst erst nach dem Speichern um
  // (revalidatePath) — also genau dann nicht, wenn man sie braucht.
  //
  // Aufgelöst wird trotzdem die ganze KETTE, nur mit dem Entwurf auf SEINER
  // Ebene. Wer als Owner den Standard der Organisation tippt, während für ihn
  // selbst eine persönliche Vorlage liegt, sieht weiter die persönliche — das
  // Badge sagt, welche gewinnt. Eine Vorschau, die den Entwurf zeigt, obwohl
  // er bei diesem Nutzer gar nicht wirkt, wäre die teurere Unwahrheit: Die
  // Beschriftung darüber verspricht „Wirkt bei dir".
  const effective = useMemo(() => {
    const entwurf = value.trim() ? { body: value, subject: current?.subject } : undefined;
    const merged: TemplateBundle =
      level === "organisation"
        ? { own: bundle.own, org: { ...bundle.org, [templateKey]: entwurf } }
        : { own: { ...bundle.own, [templateKey]: entwurf }, org: bundle.org };
    return resolveTemplate(templateKey, merged);
  }, [value, current?.subject, level, bundle, templateKey]);

  const preview = useMemo(
    () => ({
      subject: effective.subject ? renderTemplate(effective.subject, PREVIEW_EXAMPLE) : null,
      body: renderTemplate(effective.body, PREVIEW_EXAMPLE),
    }),
    [effective.subject, effective.body],
  );

  // Was gilt, wenn dieses Feld geleert wird? Genau die nächste Stufe der
  // Vorrangkette — die Meldung nach dem Löschen nennt sie beim Namen.
  const fallbackLabel =
    level === "persoenlich" && bundle.org[templateKey]?.body?.trim()
      ? TEMPLATE_SOURCE_LABELS.organisation
      : TEMPLATE_SOURCE_LABELS.auslieferung;

  const [state, formAction, pending] = useActionState(
    async (_prev: RowState, formData: FormData): Promise<RowState> => {
      // „Zurücksetzen" ist derselbe Schreibpfad mit leerem Text — die Action
      // löscht die Zeile dann, statt einen Leerstring zu speichern.
      const reset = formData.get("op") === "reset";
      const body = reset ? "" : String(formData.get("body") ?? "");
      const save = level === "organisation" ? setOrgTemplate : setOwnTemplate;
      const res = await save(templateKey, body);
      if (res.error) return { error: res.error };
      if (res.cleared) {
        onDraftChange("");
        return { note: `Zurückgesetzt — es gilt wieder: ${fallbackLabel}.`, cleared: true };
      }
      return {
        note: "Gespeichert.",
        savedBody: body.trim(),
        unknownTokens: res.unknownTokens,
        unsupportedTokens: res.unsupportedTokens,
      };
    },
    IDLE,
  );

  const fieldId = `tpl-${level}-${templateKey}`;
  const unknownSaved = state.unknownTokens ?? [];
  const unsupportedSaved = state.unsupportedTokens ?? [];
  // „Zurücksetzen" gibt es nur, wenn auf DIESER Ebene wirklich etwas liegt —
  // sonst wäre der Knopf ein Angebot, das nichts tut. `stored` kommt aus dem
  // Bundle und hinkt bis zur Revalidierung hinterher, deshalb zieht der
  // zuletzt gespeicherte Wert vor.
  const levelHasText = state.cleared ? false : (state.savedBody ?? stored).trim().length > 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-4)",
        padding: "var(--sp-6) 0",
        borderTop: "1px solid var(--border-subtle)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap" }}>
        <span style={{ fontSize: "var(--fs-base)", fontWeight: 500, color: "var(--text-primary)" }}>
          {meta.label}
        </span>
        {meta.hint && (
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{meta.hint}</span>
        )}
        <span style={{ marginLeft: "auto", display: "flex", gap: "var(--sp-3)", flexShrink: 0 }}>
          {isMail && !mailExplained && <Badge tone="warning">Noch nicht aktiv</Badge>}
          {/* Die Vorrangkette wird je Person aufgelöst — das Badge sagt
              deshalb, welcher Text BEI DIR wirkt, nicht bei jedem im Team.
              Für die LinkedIn-Sequenz gilt es zusätzlich nur, solange die
              Liste keinen eigenen Nachfass-Text trägt (siehe listMayWin). */}
          <Badge
            tone={SOURCE_TONE[effective.source]}
            title={
              listMayWin
                ? "Trägt die Liste einen eigenen Nachfass-Text, gilt dieser statt des hier gezeigten."
                : "Woher der Text kommt, der bei dir wirkt"
            }
          >
            {TEMPLATE_SOURCE_LABELS[effective.source]}
          </Badge>
        </span>
      </div>

      <div>
        <div className="eyebrow eyebrow-muted" style={{ marginBottom: "var(--sp-3)" }}>
          {PREVIEW_LABEL}
        </div>
        {preview.subject && (
          <p style={{ ...READONLY_BLOCK, marginBottom: 2, fontWeight: 500, color: "var(--text-primary)" }}>
            {preview.subject}
          </p>
        )}
        <p style={READONLY_BLOCK}>{preview.body}</p>
      </div>

      {isMail ? (
        mailExplained ? null : (
          <p style={FIELD_HINT}>
            Die Mail-Spur ist noch nicht angeschlossen — dieser Text wird derzeit nirgends verschickt und
            lässt sich deshalb auch nicht ändern.
          </p>
        )
      ) : !editable ? (
        <p style={FIELD_HINT}>{lockedReason}</p>
      ) : (
        <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
          {/* Die sichtbare Beschriftung steht im Kopf der Zeile; hier braucht
              das Textfeld nur noch einen zugänglichen Namen, der die Ebene
              mitnennt — sonst heißen im Screenreader alle Felder gleich.
              Eine .sr-only-Klasse gibt es in globals.css nicht, deshalb inline. */}
          <label
            htmlFor={fieldId}
            style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap" }}
          >
            {`${meta.label} — ${TEMPLATE_SOURCE_LABELS[level]}`}
          </label>
          <textarea
            id={fieldId}
            name="body"
            rows={2}
            value={value}
            disabled={pending}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder={`Leer = ${fallbackLabel}`}
            className="ui-input"
            aria-invalid={state.error ? true : undefined}
            style={{
              width: "100%",
              minWidth: 0,
              resize: "vertical",
              fontFamily: "inherit",
              padding: "var(--sp-3) var(--sp-4)",
              ...(state.error ? { borderColor: "var(--danger)" } : null),
            }}
          />

          {/* Nur die Platzhalter DIESER Vorlage. Die frühere globale Liste bot
              allen 31 Vorlagen dieselben elf an — wer daraus einen wählte, den
              der Pfad nicht füllt, bekam keine Warnung und beim Lead eine
              Lücke. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)", alignItems: "center" }}>
            {meta.placeholders.map((p) => (
              <code key={p} title={PLACEHOLDER_LABELS[p]} style={CHIP}>
                {`{${p}}`}
              </code>
            ))}
          </div>

          <div style={{ display: "flex", gap: "var(--sp-3)", alignItems: "center", flexWrap: "wrap" }}>
            <Button type="submit" variant="secondary" size="sm" loading={pending}>
              Speichern
            </Button>
            {levelHasText && (
              <Button
                type="submit"
                name="op"
                value="reset"
                variant="ghost"
                size="sm"
                disabled={pending}
                title={`Löscht deinen Text auf dieser Ebene — es gilt dann wieder: ${fallbackLabel}.`}
              >
                Zurücksetzen
              </Button>
            )}
          </div>

          {issues.unknownTokens.length > 0 && (
            <p role="status" style={FIELD_WARN}>
              {issues.unknownTokens.map((t) => `{${t}}`).join(", ")}{" "}
              {issues.unknownTokens.length === 1 ? "kennt" : "kennen"} die App nicht — der Platzhalter geht
              so wörtlich an den Lead.
            </p>
          )}
          {issues.unsupportedTokens.length > 0 && (
            <p role="status" style={FIELD_WARN}>
              {issues.unsupportedTokens.map((t) => `{${t}}`).join(", ")}{" "}
              {issues.unsupportedTokens.length === 1 ? "füllt" : "füllen"} diese Vorlage nicht — der
              Platzhalter verschwindet beim Senden spurlos, ein Trenner davor bleibt stehen.
            </p>
          )}
          {state.error && (
            <p role="alert" style={FIELD_ERROR}>
              {state.error}
            </p>
          )}
          {!state.error && state.note && (
            <p role="status" style={FIELD_OK}>
              {state.note}
              {unknownSaved.length > 0 && ` Unbekannt: ${unknownSaved.map((t) => `{${t}}`).join(", ")}.`}
              {unsupportedSaved.length > 0 &&
                ` Ohne Wirkung hier: ${unsupportedSaved.map((t) => `{${t}}`).join(", ")}.`}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Karte
 * ------------------------------------------------------------------ */

export function MessageTemplatesCard({
  bundle,
  canManageOrg,
  isForeignOrg,
}: {
  /** Vorlagen des ANGEMELDETEN Kontos plus Standard der Organisation. */
  bundle: TemplateBundle;
  /** role='owner' && data_scope='workspace' — dasselbe Prädikat wie in der RLS. */
  canManageOrg: boolean;
  /** Plattform-Admin in einer Kunden-Organisation: dort gibt es keine persönliche Zeile. */
  isForeignOrg: boolean;
}) {
  const levels: { value: EditLevel; label: string }[] = [];
  if (canManageOrg) levels.push({ value: "organisation", label: TEMPLATE_SOURCE_LABELS.organisation });
  levels.push({ value: "persoenlich", label: TEMPLATE_SOURCE_LABELS.persoenlich });

  const [level, setLevel] = useState<EditLevel>(canManageOrg ? "organisation" : "persoenlich");
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();

  // Die Entwürfe ALLER Zeilen, geschlüsselt nach Ebene und Vorlage — bewusst
  // hier oben statt als useState in TemplateRow.
  //
  // Eine Zeile wird beim Suchen neu aufgebaut: Sie fällt aus dem Trefferfilter,
  // oder der Collapsible-Key wechselt (beim ersten getippten Zeichen und beim
  // Leeren des Feldes). Lag der Entwurf im lokalen State der Zeile, war ein
  // noch nicht gespeicherter Text danach weg — lautlos, mitten im Schreiben,
  // ausgelöst von einer Eingabe an ganz anderer Stelle. Hier oben überlebt er
  // Filter, Zuklappen und Ebenenwechsel; `undefined` heißt „nichts getippt",
  // dann zeigt die Zeile den gespeicherten Stand.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const setDraft = useCallback((draftKey: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [draftKey]: value }));
  }, []);

  const personalLocked = isForeignOrg;
  const editable = level === "organisation" ? canManageOrg : !personalLocked;
  const lockedReason =
    level === "organisation"
      ? "Nur Owner mit workspace-weiter Datensicht ändern den Standard der Organisation."
      : "In einer fremden Organisation gibt es keine persönliche Vorlage — hier wirkt der Standard dieser Organisation.";

  const storeFor = (key: TemplateKey) =>
    level === "organisation" ? bundle.org[key] : bundle.own[key];

  // Gesucht wird über das, was auf dem Bildschirm steht: Beschriftung, Hinweis
  // und der Text selbst — samt beider gespeicherter Ebenen. Wer „Rückruf" oder
  // „bis dann" eintippt, soll die Zeile finden, egal ob er den Namen der
  // Vorlage kennt oder nur einen Halbsatz daraus.
  const matches = useMemo(() => {
    if (!query) return null;
    const hit = new Set<TemplateKey>();
    for (const key of Object.keys(TEMPLATE_META) as TemplateKey[]) {
      const meta = TEMPLATE_META[key];
      const eff = resolveTemplate(key, bundle);
      const haystack = [
        meta.group,
        meta.label,
        meta.hint ?? "",
        eff.body,
        eff.subject ?? "",
        bundle.own[key]?.body ?? "",
        bundle.org[key]?.body ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (haystack.includes(query)) hit.add(key);
    }
    return hit;
  }, [query, bundle]);

  const visible = (keys: TemplateKey[]) => (matches ? keys.filter((k) => matches.has(k)) : keys);

  // Ebene UND Vorlage im Schlüssel: Derselbe Text hat je Ebene einen eigenen
  // Entwurf — sonst trüge der Umschalter den halb getippten Org-Standard in
  // die persönliche Vorlage hinüber.
  const rowDraft = (key: TemplateKey) => {
    const draftKey = `${level}-${key}`;
    return { draft: drafts[draftKey], onDraftChange: (value: string) => setDraft(draftKey, value) };
  };

  const mailKeys = visible([...MAIL_TEMPLATE_KEYS]);
  const groups = GROUPS.map(({ group, keys }) => ({ group, keys: visible(keys) })).filter(
    (g) => g.keys.length > 0,
  );
  const nothingFound = groups.length === 0 && mailKeys.length === 0;

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={SECTION_HEAD}>
        <MessagesSquare size={16} color="var(--text-muted)" />
        <span style={SECTION_TITLE}>Nachrichtenvorlagen</span>
        <span style={SECTION_META}>Alle Texte der App</span>
      </div>

      <div style={SECTION_BODY}>
        {/* Ebenen-Umschalter. Für ein Mitglied ohne Owner-Recht gibt es nur
            eine Ebene — dann steht statt eines Ein-Knopf-Umschalters die
            Erklärung allein. */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          {levels.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)", flexWrap: "wrap" }}>
              <span className="eyebrow eyebrow-muted">Bearbeiten</span>
              <Segmented options={levels} value={level} onChange={setLevel} ariaLabel="Ebene bearbeiten" />
            </div>
          )}
          <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-secondary)", lineHeight: "var(--lh-base)" }}>
            {level === "organisation" ? (
              <>
                Gilt für <strong style={{ color: "var(--text-primary)" }}>alle im Team</strong>, solange
                niemand eine eigene Vorlage hinterlegt hat.
              </>
            ) : (
              <>
                Gilt <strong style={{ color: "var(--text-primary)" }}>nur für dich</strong> und übersteuert
                den Standard der Organisation.
              </>
            )}{" "}
            Vorrang: Text der Liste → deine Vorlage → Standard der Organisation → Auslieferungstext.{" "}
            <strong style={{ color: "var(--text-primary)" }}>Zurücksetzen</strong> löscht den Eintrag dieser
            Ebene — es gilt dann wieder die Ebene darunter.
          </p>
          <p style={FIELD_HINT}>
            Platzhalter sind unter jedem Feld aufgeführt; Groß-/Kleinschreibung ist egal. Einer ohne Wert
            fällt samt umgebendem Füllwort weg, statt eine Lücke zu hinterlassen.
          </p>
        </div>

        {/* Suchfeld nach dem Muster der Listen-Toolbar. 31 Vorlagen in acht
            Gruppen findet man sonst nur, indem man jede Gruppe aufklappt. */}
        <div style={{ position: "relative", maxWidth: 280 }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: "var(--sp-5)",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-muted)",
              pointerEvents: "none",
              zIndex: 1,
            }}
          />
          <input
            type="search"
            placeholder="Vorlage suchen…"
            aria-label="Vorlage suchen"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ui-input"
            style={{ paddingLeft: "var(--sp-10)" }}
          />
        </div>

        {nothingFound && (
          <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-subtle)" }}>
            Keine Vorlage enthält &bdquo;{search.trim()}&ldquo;.
          </p>
        )}

        {groups.map(({ group, keys }) => {
          const customized = keys.filter((k) => storeFor(k)?.body?.trim()).length;
          return (
            // key trägt die Ebene UND ob gesucht wird: Beim Umschalten sollen
            // Textfelder und Aufklapp-Zustand neu aufgebaut werden, und eine
            // Gruppe mit Treffern soll offen starten (Collapsible liest
            // defaultOpen nur beim Aufbau). Der Suchteil wechselt nur beim
            // ersten und letzten Zeichen — was die Zeilen darin neu aufbaut;
            // die Entwürfe überleben das, weil sie oben in der Karte liegen.
            <Collapsible
              key={`${level}-${group}-${query ? "suche" : ""}`}
              title={group}
              defaultOpen={query ? true : customized > 0}
              meta={
                query
                  ? `${keys.length} Treffer`
                  : customized > 0
                    ? `${customized} angepasst`
                    : `${keys.length} Vorlagen`
              }
            >
              {GROUP_NOTES[group] && (
                <p style={{ margin: "0 0 var(--sp-3)", fontSize: "var(--fs-xs)", color: "var(--text-subtle)", lineHeight: "var(--lh-base)" }}>
                  {GROUP_NOTES[group]}
                </p>
              )}
              {keys.map((key) => (
                <TemplateRow
                  key={`${level}-${key}`}
                  templateKey={key}
                  level={level}
                  bundle={bundle}
                  {...rowDraft(key)}
                  editable={editable}
                  lockedReason={lockedReason}
                />
              ))}
            </Collapsible>
          );
        })}

        {/* Die fünf Mail-Vorlagen sind ausgeliefert, aber abgeschaltet
            (cascade_steps.enabled = false). Sie stehen für sich am Ende, damit
            die Gruppenzähler oben zählen, was man ändern kann — und die
            Erklärung einmal steht statt fünfmal. */}
        {mailKeys.length > 0 && (
          <Collapsible
            key={`${level}-mail-${query ? "suche" : ""}`}
            title="Mail-Spur — noch nicht aktiv"
            defaultOpen={Boolean(query)}
            // Bei aktiver Suche ist mailKeys schon gefiltert — „5 Vorlagen"
            // stand dann neben „2 Treffer" der Gruppen darüber und meinte
            // dieselbe Zahl in einer anderen Bedeutung.
            meta={query ? `${mailKeys.length} Treffer` : `${mailKeys.length} Vorlagen`}
          >
            <p style={{ margin: "0 0 var(--sp-3)", fontSize: "var(--fs-xs)", color: "var(--text-subtle)", lineHeight: "var(--lh-base)" }}>
              Diese Texte sind vorbereitet, aber nicht angeschlossen: Sie werden derzeit nirgends verschickt
              und lassen sich deshalb auch nicht ändern.
            </p>
            {mailKeys.map((key) => (
              <TemplateRow
                key={`${level}-${key}`}
                templateKey={key}
                level={level}
                bundle={bundle}
                {...rowDraft(key)}
                editable={editable}
                lockedReason={lockedReason}
                mailExplained
              />
            ))}
          </Collapsible>
        )}
      </div>
    </div>
  );
}
