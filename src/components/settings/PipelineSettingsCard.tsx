"use client";

import { useActionState, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { updatePipelineSettings, type PipelineSettings } from "@/app/actions/reminders";
import { Button } from "@/components/ui/Button";
import {
  FIELD_ERROR,
  FIELD_HINT,
  FIELD_LABEL,
  FIELD_OK,
  NUMBER_INPUT,
  SECTION_BODY,
  SECTION_HEAD,
  SECTION_META,
  SECTION_TITLE,
} from "@/components/settings/settingsStyles";

// Zwei Zahlen — das ist die ganze Pipeline-Konfiguration.
//
// Vorher standen hier sechzehn: fünf Ursprungs-Fristen, neun Wartezeiten je
// Verlustgrund, ein Versuchs-Deckel und der Erinnerungs-Horizont, dazu die
// Ansicht der 21 Kaskadenstufen. Das war die Bedienoberfläche zu einem
// Nachfass-System für zwanzig Setter; gearbeitet wird hier zu dritt. Was bleibt,
// sind die beiden Zahlen, die eine Entscheidung ändern:
//
//   * `max_reschedules` — die Grenze zwischen „liegt in der Luft" und „ist
//     versorgt". Kein Kaskaden- und kein Recycling-Feld.
//   * EINE Recycling-Frist für alle vier Ursprünge (siehe RECYCLE_COLUMNS).
//
// Der Speicherpfad ist unverändert und der Grund, warum jedes Feld ein eigenes
// useActionState hat: Die Vorgänger-Actions gaben `Promise<void>` zurück und
// warfen jeden Fehler weg — ein verletzter CHECK ließ das Feld lautlos auf den
// alten Wert zurückspringen, und der Nutzer sah eine Einstellung, die er nie
// gespeichert hat.

type SettingsKey = keyof PipelineSettings;

type FieldSpec = {
  /**
   * DOM-Id des Feldes. Ausgeschrieben statt aus der ersten Spalte gebaut: Die
   * Recycling-Frist schreibt vierzehn Spalten, und eine Id, die genau eine
   * davon nennt, behauptete im Markup dasselbe, was der Rückbau gerade
   * abschafft.
   */
  id: string;
  /** Spalten, die dieses EINE Feld schreibt — mehr als eine nur beim Recycling. */
  columns: SettingsKey[];
  label: string;
  min: number;
  max: number;
};

/** Grenzen wörtlich wie SETTINGS_BOUNDS in actions/reminders.ts und die CHECKs in 0032. */
const DAY_MIN = 1;
const DAY_MAX = 3650;

/**
 * Alle Wartezeit-Spalten aus `pipeline_settings` — das eine Feld schreibt sie
 * gemeinsam.
 *
 * Gerechnet wird die Wartezeit nicht hier, sondern in `schedule_recycle()`
 * (Migration 0033, eingefroren): Die Funktion sucht sich je Ursprung und
 * Verlustgrund eine dieser Spalten aus. Ein Feld, das nur EINE davon schriebe,
 * wäre deshalb eine Behauptung — für drei der vier Ursprünge und für jeden
 * Closing-Verlustgrund gälte weiter die alte Staffelung, sichtbar nirgends.
 * Alle gemeinsam zu schreiben macht „eine Frist für alle" ohne Migration wahr;
 * fällt die Staffelung später auch in der Funktion, tragen die Spalten dann
 * ohnehin längst dieselbe Zahl.
 */
const RECYCLE_COLUMNS: SettingsKey[] = [
  "days_default_closing_lost",
  "days_default_setting_disqualified",
  "days_default_phone_dead",
  "days_default_setting_dead",
  "days_default_linkedin_exhausted",
  "days_timing",
  "days_preis",
  "days_kein_bedarf",
  "days_entscheider",
  "days_wettbewerb",
  "days_vertrauen",
  "days_ghosting_breakup",
  "days_ghosting",
  "days_sonstiges",
];

const RESCHEDULE_FIELD: FieldSpec = {
  id: "pipeline-verschiebungen",
  columns: ["max_reschedules"],
  label: "Verschiebungen je Termin",
  min: 1,
  max: 5,
};

const RECYCLE_FIELD: FieldSpec = {
  id: "pipeline-recycling-frist",
  columns: RECYCLE_COLUMNS,
  label: "Recycling — Wartezeit (Tage)",
  min: DAY_MIN,
  max: DAY_MAX,
};

type FieldState = { error?: string; saved?: string };
const IDLE: FieldState = {};

const GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
  gap: "var(--sp-6)",
  alignItems: "start",
};

function NumberField({ spec, value, hint }: { spec: FieldSpec; value: number; hint: string }) {
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
      const wert = Math.round(parsed);
      const patch = Object.fromEntries(spec.columns.map((c) => [c, wert])) as Partial<PipelineSettings>;
      const res = await updatePipelineSettings(patch);
      if (res.error) return { error: res.error };
      return { saved: `Gespeichert: ${wert}` };
    },
    IDLE,
  );

  const fieldId = spec.id;

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
        {/* Beschriftet statt „✓": Ohne Hover war nicht zu erkennen, ob der
            Knopf speichert oder etwas abhakt — bei einem Zahlenfeld liegt
            beides gleich nah. */}
        <Button type="submit" variant="secondary" size="sm" loading={pending}>
          Speichern
        </Button>
      </div>
      {!state.error && !state.saved && <p style={FIELD_HINT}>{hint}</p>}
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
 * Karte
 * ------------------------------------------------------------------ */

export function PipelineSettingsCard({
  settings,
  configured,
}: {
  settings: PipelineSettings;
  /** false = es gibt noch keine gespeicherte Zeile, die Spalten-Defaults greifen. */
  configured: boolean;
}) {
  const gespeichert = RECYCLE_COLUMNS.map((c) => settings[c]);
  const kuerzeste = Math.min(...gespeichert);
  const laengste = Math.max(...gespeichert);
  const gestaffelt = kuerzeste !== laengste;

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={SECTION_HEAD}>
        <SlidersHorizontal size={16} color="var(--text-muted)" />
        <span style={SECTION_TITLE}>Pipeline</span>
        <span style={SECTION_META}>Termine &amp; Recycling</span>
      </div>

      <div style={SECTION_BODY}>
        {!configured && (
          <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-subtle)" }}>
            Für diese Organisation ist noch nichts gespeichert — unten stehen die Auslieferungswerte.
            Sobald ein Feld gespeichert wird, gelten sie als gesetzt.
          </p>
        )}

        <div style={GRID}>
          <NumberField
            spec={RESCHEDULE_FIELD}
            value={settings.max_reschedules}
            hint="Ab der nächsten Verschiebung warnt die Oberfläche — keine harte Sperre."
          />
          {/* Angezeigt wird die LÄNGSTE der bisher gespeicherten Wartezeiten,
              nicht die erstbeste: Solange die alte Staffelung noch in der
              Datenbank steht, wäre die kürzeste Frist auf alles anzuwenden der
              teure Fehler — sie spülte den gesamten toten Bestand auf einmal
              wieder in die Arbeitsliste. Sind alle Spalten gleich (nach dem
              ersten Speichern), ist es schlicht die eine Frist. */}
          <NumberField
            spec={RECYCLE_FIELD}
            value={laengste}
            hint={
              gestaffelt
                ? `Eine Frist für alle vier Ursprünge. Gespeichert stehen dort noch ${kuerzeste}–${laengste} Tage je Grund — Speichern ebnet das ein.`
                : "Eine Frist für alle vier Ursprünge — LinkedIn, Telefon, Erstgespräch, Closing."
            }
          />
        </div>
      </div>
    </div>
  );
}
