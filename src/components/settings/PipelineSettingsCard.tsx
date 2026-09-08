"use client";

import { useActionState, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { updatePipelineSettings, type PipelineSettings } from "@/app/actions/reminders";
import { CASCADE_KIND_LABELS, type CascadeKind, type CascadeStep } from "@/lib/cascadeEngine";
import { TEMPLATE_META } from "@/lib/messageTemplates";
import { Collapsible } from "@/components/settings/Collapsible";
import {
  FIELD_ERROR,
  FIELD_HINT,
  FIELD_LABEL,
  FIELD_OK,
  NUMBER_INPUT,
  SAVE_BUTTON,
  SECTION_BODY,
  SECTION_HEAD,
  SECTION_META,
  SECTION_TITLE,
} from "@/components/settings/settingsStyles";

// Eine Karte statt zweier („Erinnerungs-Kaskade" + „Recycling"): Beide lasen
// aus einer eigenen Tabelle, seit Migration 0032 gibt es nur noch
// `pipeline_settings` — eine Zeile je Organisation. Zwei Karten über einer
// Zeile wären eine Trennung, die die Daten nicht mehr hergeben.
//
// Der eigentliche Umbau steckt aber im Speicherpfad: Die Vorgänger-Actions
// gaben `Promise<void>` zurück und warfen jeden Fehler weg. Ein verletzter
// CHECK (Wert außerhalb der Grenzen, fehlende Berechtigung, fehlende
// Migration) ließ das Feld lautlos auf den alten Wert zurückspringen — der
// Nutzer sah eine Einstellung, die er nie gespeichert hat. Jedes Feld hängt
// deshalb an einem eigenen useActionState und zeigt Erfolg oder Grund direkt
// unter sich.

type SettingsKey = keyof PipelineSettings;

type FieldSpec = {
  field: SettingsKey;
  label: string;
  min: number;
  max: number;
  hint?: string;
};

/** Grenzen wörtlich wie SETTINGS_BOUNDS in actions/reminders.ts und die CHECKs in 0032. */
const DAY_MIN = 1;
const DAY_MAX = 3650;

const RHYTHM_FIELDS: FieldSpec[] = [
  {
    field: "max_reschedules",
    label: "Verschiebungen je Termin",
    min: 1,
    max: 5,
    hint: "Ab der nächsten Verschiebung warnt die Oberfläche — keine harte Sperre.",
  },
  {
    field: "reminder_horizon_days",
    label: "Erinnerungen vorausschauen (Tage)",
    min: 1,
    max: 60,
    hint: "So weit blickt „Meine Erinnerungen“ nach vorn.",
  },
];

// Die fünf Ursprünge sind das, was ein neuer Kunde einstellt: „wann darf ein
// tot gelaufener Lead wieder auftauchen?". Die Verlustgrund-Staffelung
// darunter übersteuert sie nur — sie steht deshalb zugeklappt.
const ORIGIN_FIELDS: FieldSpec[] = [
  { field: "days_default_closing_lost", label: "Closing verloren (Tage)", min: DAY_MIN, max: DAY_MAX },
  {
    field: "days_default_setting_disqualified",
    label: "Erstgespräch unqualifiziert (Tage)",
    min: DAY_MIN,
    max: DAY_MAX,
  },
  { field: "days_default_phone_dead", label: "Telefon-Lead dead (Tage)", min: DAY_MIN, max: DAY_MAX },
  { field: "days_default_setting_dead", label: "Erstgespräch dead (Tage)", min: DAY_MIN, max: DAY_MAX },
  {
    field: "days_default_linkedin_exhausted",
    label: "LinkedIn ohne Antwort (Tage)",
    min: DAY_MIN,
    max: DAY_MAX,
  },
];

const ATTEMPTS_FIELD: FieldSpec = {
  field: "max_attempts",
  label: "Max. Recycling-Versuche",
  min: 1,
  max: 5,
  hint: "Deckel über alle Wiedervorlagen eines Leads.",
};

// Reihenfolge = Erzähl-Reihenfolge: kurze Wartezeit zuerst, lange zuletzt.
// 'falsche_zielgruppe' hat bewusst kein Feld — dieser Lead war nie der
// richtige Fit und bekommt nie ein Recycling-Datum.
const LOST_REASON_FIELDS: FieldSpec[] = [
  { field: "days_ghosting_breakup", label: "Ghosting — Breakup-Touch (Tage)", min: DAY_MIN, max: DAY_MAX },
  { field: "days_timing", label: "Timing (Tage)", min: DAY_MIN, max: DAY_MAX },
  { field: "days_preis", label: "Preis (Tage)", min: DAY_MIN, max: DAY_MAX },
  { field: "days_kein_bedarf", label: "Kein Bedarf (Tage)", min: DAY_MIN, max: DAY_MAX },
  { field: "days_sonstiges", label: "Sonstiges (Tage)", min: DAY_MIN, max: DAY_MAX },
  { field: "days_entscheider", label: "Entscheider (Tage)", min: DAY_MIN, max: DAY_MAX },
  { field: "days_ghosting", label: "Ghosting — danach (Tage)", min: DAY_MIN, max: DAY_MAX },
  { field: "days_wettbewerb", label: "Wettbewerb (Tage)", min: DAY_MIN, max: DAY_MAX },
  { field: "days_vertrauen", label: "Vertrauen (Tage)", min: DAY_MIN, max: DAY_MAX },
];

type FieldState = { error?: string; saved?: string };
const IDLE: FieldState = {};

const GRID = (min: number): React.CSSProperties => ({
  display: "grid",
  gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`,
  gap: "var(--sp-6)",
  alignItems: "start",
});

function NumberField({ spec, value }: { spec: FieldSpec; value: number }) {
  // Bewusst KONTROLLIERT statt defaultValue: React setzt ein Formular nach
  // einer Action zurück, und bei einem unkontrollierten Feld hieße das —
  // ausgerechnet im Fehlerfall — dass die eingegebene Zahl verschwindet,
  // während die Meldung sie erklärt. So bleibt stehen, was der Nutzer
  // getippt hat, und er kann es korrigieren.
  const [draft, setDraft] = useState(String(value));

  // useActionState statt eines `action`-Attributs mit void-Action: Die
  // Server-Action nimmt einen typisierten Patch, kein FormData — der Reducer
  // hier übersetzt und reicht den Fehler als Zustand zurück, statt ihn wie
  // bisher zu verschlucken.
  const [state, formAction, pending] = useActionState(
    async (_prev: FieldState, formData: FormData): Promise<FieldState> => {
      const raw = String(formData.get("value") ?? "").trim();
      if (!raw) return { error: "Bitte einen Wert eintragen." };
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return { error: "Bitte eine Zahl eintragen." };
      if (parsed < spec.min || parsed > spec.max) {
        return { error: `Erlaubt sind ${spec.min} bis ${spec.max}.` };
      }
      const res = await updatePipelineSettings({ [spec.field]: Math.round(parsed) } as Partial<PipelineSettings>);
      if (res.error) return { error: res.error };
      return { saved: `Gespeichert: ${Math.round(parsed)}` };
    },
    IDLE,
  );

  const fieldId = `pipeline-${spec.field}`;

  return (
    <form action={formAction}>
      <label htmlFor={fieldId} style={FIELD_LABEL}>
        {spec.label}
      </label>
      <div style={{ display: "flex", gap: "var(--sp-3)" }}>
        <input
          id={fieldId}
          type="number"
          name="value"
          min={spec.min}
          max={spec.max}
          step={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={pending}
          className="ui-input"
          aria-describedby={state.error ? `${fieldId}-msg` : undefined}
          aria-invalid={state.error ? true : undefined}
          style={{
            ...NUMBER_INPUT,
            ...(state.error ? { borderColor: "var(--danger)" } : null),
          }}
        />
        <button
          type="submit"
          title="Speichern"
          disabled={pending}
          className="btn-secondary"
          style={SAVE_BUTTON}
        >
          ✓
        </button>
      </div>
      {spec.hint && !state.error && !state.saved && <p style={FIELD_HINT}>{spec.hint}</p>}
      {state.error && (
        <p id={`${fieldId}-msg`} role="alert" style={FIELD_ERROR}>
          {state.error}
        </p>
      )}
      {!state.error && state.saved && (
        <p id={`${fieldId}-msg`} role="status" style={FIELD_OK}>
          {state.saved}
        </p>
      )}
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Kaskaden-Stufen — ausschließlich lesend
 * ------------------------------------------------------------------ */

function humanOffset(minutes: number): string {
  if (minutes === 0) return "sofort";
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return d === 1 ? "1 Tag" : `${d} Tage`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? "1 Stunde" : `${h} Stunden`;
  }
  return `${minutes} Minuten`;
}

function stepTiming(step: CascadeStep): string {
  const offset = humanOffset(step.offset_minutes);
  if (step.anchor === "before_appointment") return `${offset} vor dem Termin`;
  return step.offset_minutes === 0 ? "sofort nach dem Ereignis" : `${offset} nach dem Ereignis`;
}

function CascadeStepList({ steps }: { steps: CascadeStep[] }) {
  const kinds: CascadeKind[] = [];
  for (const s of steps) if (!kinds.includes(s.cascade_kind)) kinds.push(s.cascade_kind);

  if (kinds.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-subtle)" }}>
        Noch keine Stufen konfiguriert.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      {kinds.map((kind) => (
        <div key={kind}>
          <div style={{ fontSize: "var(--fs-sm)", fontWeight: 500, color: "var(--text-primary)", marginBottom: "var(--sp-3)" }}>
            {CASCADE_KIND_LABELS[kind]}
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 2 }}>
            {steps
              .filter((s) => s.cascade_kind === kind)
              .map((s) => (
                <li
                  key={`${kind}-${s.step_no}`}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "var(--sp-4)",
                    fontSize: "var(--fs-xs)",
                    color: s.enabled ? "var(--text-secondary)" : "var(--text-disabled)",
                  }}
                >
                  <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-muted)" }}>
                    {s.step_no}.
                  </span>
                  <span>{stepTiming(s)}</span>
                  <span style={{ color: "var(--text-muted)" }}>
                    · {TEMPLATE_META[s.template_key]?.label ?? s.template_key}
                  </span>
                  {s.requires_no_response && (
                    <span style={{ color: "var(--text-muted)" }}>· nur ohne Antwort</span>
                  )}
                  {!s.enabled && <span className="badge badge-gray">aus</span>}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Karte
 * ------------------------------------------------------------------ */

export function PipelineSettingsCard({
  settings,
  configured,
  steps,
  stepsAvailable,
}: {
  settings: PipelineSettings;
  /** false = es gibt noch keine gespeicherte Zeile, die Spalten-Defaults greifen. */
  configured: boolean;
  steps: CascadeStep[];
  stepsAvailable: boolean;
}) {
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={SECTION_HEAD}>
        <SlidersHorizontal size={16} color="var(--text-muted)" />
        <span style={SECTION_TITLE}>Pipeline</span>
        <span style={SECTION_META}>Erinnerungen &amp; Recycling</span>
      </div>

      <div style={SECTION_BODY}>
        {!configured && (
          <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-subtle)" }}>
            Für diese Organisation ist noch nichts gespeichert — unten stehen die Auslieferungswerte.
            Sobald ein Feld gespeichert wird, gelten sie als gesetzt.
          </p>
        )}

        <div>
          <div className="eyebrow eyebrow-muted" style={{ marginBottom: "var(--sp-5)" }}>
            Termine &amp; Erinnerungen
          </div>
          <div style={GRID(230)}>
            {RHYTHM_FIELDS.map((spec) => (
              <NumberField key={spec.field} spec={spec} value={settings[spec.field]} />
            ))}
          </div>
        </div>

        <div>
          <div className="eyebrow eyebrow-muted" style={{ marginBottom: "var(--sp-5)" }}>
            Recycling — Wartezeit bis zum nächsten Versuch
          </div>
          <div style={GRID(230)}>
            {ORIGIN_FIELDS.map((spec) => (
              <NumberField key={spec.field} spec={spec} value={settings[spec.field]} />
            ))}
            <NumberField spec={ATTEMPTS_FIELD} value={settings[ATTEMPTS_FIELD.field]} />
          </div>
          <p style={{ margin: "var(--sp-5) 0 0", fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>
            Verlustgrund &bdquo;Falsche Zielgruppe&ldquo; bekommt bewusst kein automatisches Recycling.
          </p>
        </div>

        {/* Vierzehn Zahlen auf einmal beantworten keine Frage. Die neun
            Verlustgründe übersteuern nur den Ursprungswert darüber und
            stehen deshalb hinter einem Klick. */}
        <Collapsible title="Feinstaffelung je Verlustgrund" meta={`${LOST_REASON_FIELDS.length} Werte`}>
          <p style={{ margin: "0 0 var(--sp-6)", fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>
            Gilt nur für verlorene Closings und übersteuert dort &bdquo;Closing verloren&ldquo;. Steht kein
            Verlustgrund am Closing, bleibt es beim Ursprungswert.
          </p>
          <div style={GRID(210)}>
            {LOST_REASON_FIELDS.map((spec) => (
              <NumberField key={spec.field} spec={spec} value={settings[spec.field]} />
            ))}
          </div>
        </Collapsible>

        {/* Nur Ansicht: Der Editor für Stufen (Abstände, Reihenfolge, An/Aus)
            ist ein eigener Arbeitsschritt. Sichtbar sind sie hier trotzdem,
            weil sonst niemand nachvollziehen kann, welche Vorlage wann greift. */}
        {stepsAvailable && (
          <Collapsible title="Kaskaden-Stufen" meta="nur Ansicht">
            <CascadeStepList steps={steps} />
          </Collapsible>
        )}
      </div>
    </div>
  );
}
