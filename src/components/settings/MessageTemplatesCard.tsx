"use client";

import { useActionState, useMemo, useState } from "react";
import { MessagesSquare } from "lucide-react";
import { setOrgTemplate, setOwnTemplate } from "@/app/actions/messageTemplates";
import {
  PLACEHOLDERS,
  PLACEHOLDER_LABELS,
  TEMPLATE_META,
  TEMPLATE_SOURCE_LABELS,
  isMailTemplate,
  resolveTemplate,
  validateTemplate,
  type TemplateBundle,
  type TemplateGroup,
  type TemplateKey,
  type TemplateSource,
} from "@/lib/messageTemplates";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
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
// Badge, und der Kasten „Wirkt aktuell" erscheint genau dann, wenn eine
// andere Ebene gewinnt.

/** Die beiden Ebenen, die hier bearbeitet werden — Teilmenge von TemplateSource. */
type EditLevel = Extract<TemplateSource, "organisation" | "persoenlich">;

const SOURCE_TONE: Record<TemplateSource, BadgeTone> = {
  liste: "info",
  persoenlich: "accent",
  organisation: "info",
  auslieferung: "neutral",
};

/** Gruppen in der Reihenfolge, in der TEMPLATE_META sie einführt. */
const GROUPS: { group: TemplateGroup; keys: TemplateKey[] }[] = (() => {
  const out: { group: TemplateGroup; keys: TemplateKey[] }[] = [];
  for (const [key, meta] of Object.entries(TEMPLATE_META) as [TemplateKey, (typeof TEMPLATE_META)[TemplateKey]][]) {
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

type RowState = { error?: string; note?: string; unknownTokens?: string[] };
const IDLE: RowState = {};

function TemplateRow({
  templateKey,
  level,
  bundle,
  editable,
  lockedReason,
}: {
  templateKey: TemplateKey;
  level: EditLevel;
  bundle: TemplateBundle;
  /** false = Ebene für diesen Nutzer gesperrt (fremde Organisation, fehlendes Recht). */
  editable: boolean;
  lockedReason?: string;
}) {
  const meta = TEMPLATE_META[templateKey];
  const isMail = isMailTemplate(templateKey);
  const effective = resolveTemplate(templateKey, bundle);
  const stored = (level === "organisation" ? bundle.org[templateKey] : bundle.own[templateKey])?.body ?? "";

  const [value, setValue] = useState(stored);
  const unknownWhileTyping = useMemo(() => validateTemplate(value).unknownTokens, [value]);

  // Was gilt, wenn dieses Feld geleert wird? Genau die nächste Stufe der
  // Vorrangkette — die Meldung nach dem Löschen nennt sie beim Namen.
  const fallbackLabel =
    level === "persoenlich" && bundle.org[templateKey]?.body?.trim()
      ? TEMPLATE_SOURCE_LABELS.organisation
      : TEMPLATE_SOURCE_LABELS.auslieferung;

  const [state, formAction, pending] = useActionState(
    async (_prev: RowState, formData: FormData): Promise<RowState> => {
      const body = String(formData.get("body") ?? "");
      const save = level === "organisation" ? setOrgTemplate : setOwnTemplate;
      const res = await save(templateKey, body);
      if (res.error) return { error: res.error };
      if (res.cleared) return { note: `Gelöscht — es gilt wieder: ${fallbackLabel}.` };
      return { note: "Gespeichert.", unknownTokens: res.unknownTokens };
    },
    IDLE,
  );

  const fieldId = `tpl-${level}-${templateKey}`;
  // „Wirkt aktuell" nur, wenn eine ANDERE Ebene gewinnt. Steht der wirkende
  // Text ohnehin im Feld darunter, wäre der Kasten eine zweite Abschrift.
  const showEffective = isMail || effective.source !== level;
  const unknownSaved = state.unknownTokens ?? [];

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
          {isMail && <Badge tone="warning">Noch nicht aktiv</Badge>}
          {/* Die Vorrangkette wird je Person aufgelöst — das Badge sagt
              deshalb, welcher Text BEI DIR wirkt, nicht bei jedem im Team. */}
          <Badge tone={SOURCE_TONE[effective.source]} title="Woher der Text kommt, der bei dir wirkt">
            {TEMPLATE_SOURCE_LABELS[effective.source]}
          </Badge>
        </span>
      </div>

      {showEffective && (
        <div>
          <div className="eyebrow eyebrow-muted" style={{ marginBottom: "var(--sp-3)" }}>
            Wirkt bei dir
          </div>
          {effective.subject && (
            <p style={{ ...READONLY_BLOCK, marginBottom: 2, fontWeight: 500, color: "var(--text-primary)" }}>
              {effective.subject}
            </p>
          )}
          <p style={READONLY_BLOCK}>{effective.body}</p>
        </div>
      )}

      {isMail ? (
        <p style={FIELD_HINT}>
          Die Mail-Spur ist noch nicht angeschlossen — dieser Text wird derzeit nirgends verschickt und
          lässt sich deshalb auch nicht ändern.
        </p>
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
          <div style={{ display: "flex", gap: "var(--sp-3)", alignItems: "flex-start" }}>
            <textarea
              id={fieldId}
              name="body"
              rows={2}
              value={value}
              disabled={pending}
              onChange={(e) => setValue(e.target.value)}
              placeholder={`Leer = ${fallbackLabel}`}
              className="ui-input"
              aria-invalid={state.error ? true : undefined}
              style={{
                flex: 1,
                minWidth: 0,
                resize: "vertical",
                fontFamily: "inherit",
                padding: "var(--sp-3) var(--sp-4)",
                ...(state.error ? { borderColor: "var(--danger)" } : null),
              }}
            />
            <button
              type="submit"
              title="Speichern"
              disabled={pending}
              className="btn-secondary"
              style={{ padding: "0 var(--sp-5)", height: "var(--h-control-lg)", flexShrink: 0 }}
            >
              ✓
            </button>
          </div>

          {unknownWhileTyping.length > 0 && (
            <p role="status" style={FIELD_WARN}>
              {unknownWhileTyping.map((t) => `{${t}}`).join(", ")}{" "}
              {unknownWhileTyping.length === 1 ? "kennt" : "kennen"} die App nicht — der Platzhalter geht
              so wörtlich an den Lead.
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

  const personalLocked = isForeignOrg;
  const editable = level === "organisation" ? canManageOrg : !personalLocked;
  const lockedReason =
    level === "organisation"
      ? "Nur Owner mit workspace-weiter Datensicht ändern den Standard der Organisation."
      : "In einer fremden Organisation gibt es keine persönliche Vorlage — hier wirkt der Standard dieser Organisation.";

  const storeFor = (key: TemplateKey) =>
    level === "organisation" ? bundle.org[key] : bundle.own[key];

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
            Vorrang: Text der Liste → deine Vorlage → Standard der Organisation → Auslieferungstext. Ein{" "}
            <strong style={{ color: "var(--text-primary)" }}>leeres Feld speichern</strong> löscht den
            Eintrag dieser Ebene — es gilt dann wieder die Ebene darüber.
          </p>
        </div>

        <div>
          <div className="eyebrow eyebrow-muted" style={{ marginBottom: "var(--sp-4)" }}>
            Platzhalter
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)" }}>
            {PLACEHOLDERS.map((p) => (
              <code key={p} title={PLACEHOLDER_LABELS[p]} style={CHIP}>
                {`{${p}}`}
              </code>
            ))}
          </div>
          <p style={FIELD_HINT}>
            Groß-/Kleinschreibung ist egal. Ein Platzhalter ohne Wert fällt samt umgebendem
            Füllwort weg, statt eine Lücke zu hinterlassen.
          </p>
        </div>

        {GROUPS.map(({ group, keys }) => {
          const customized = keys.filter((k) => storeFor(k)?.body?.trim()).length;
          return (
            // key trägt die Ebene: Beim Umschalten sollen Textfelder und
            // Aufklapp-Zustand neu aus der anderen Ebene aufgebaut werden,
            // statt den Text der vorherigen zu behalten.
            <Collapsible
              key={`${level}-${group}`}
              title={group}
              defaultOpen={customized > 0}
              meta={customized > 0 ? `${customized} angepasst` : `${keys.length} Vorlagen`}
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
                  editable={editable}
                  lockedReason={lockedReason}
                />
              ))}
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}
