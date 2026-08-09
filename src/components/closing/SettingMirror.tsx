import { ALL_SETTING_BLOCKS, LEGACY_SETTING_BLOCKS } from "@/lib/scripts";
import { formatTermin } from "@/lib/apptTime";
import {
  BRANCHE_LABEL,
  BUDGET_LABEL,
  jaNein,
  SETTING_STATUS_LABEL,
  SHOW_STATUS_LABEL,
} from "@/lib/settingLabels";
import type { SettingStatus } from "@/lib/types";
import { ExternalLink } from "lucide-react";

// Read-only-Spiegel des Setting-Calls, gedacht als gleichwertige Spalte NEBEN
// dem Closing-Script. Die Masse sind bewusst 1:1 aus ScriptRunner uebernommen
// (Badge 22px, Titel 1rem, Fragetext eingerueckt 1.875rem, Antwortbox wie die
// AutoGrowTextarea) — nur so lesen sich linke und rechte Spalte als dieselbe
// Sache. Wer hier Werte aendert, muss ScriptRunner mitziehen.
//
// Server-Komponente: kein State, kein "use client".

export type SettingContext = {
  script_answers: Record<string, string> | null;
  notes: string | null;
  ist_pain: number | null;
  warmth: number | null;
  soll_ziel: string | null;
  objections_handled: string | null;
  objections_open: string | null;
  has_budget_8k: "ja" | "nein" | "unklar" | null;
  branche: string | null;
  sole_decider: boolean | null;
  can_decide_now: boolean | null;
  clear_need: boolean | null;
  show_status: "show" | "no_show" | null;
  status: SettingStatus | null;
  appointment_at: string | null;
  recording_link: string | null;
};

const BLOCK_INDENT = "1.875rem";

const factLabel: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "var(--ls-eyebrow)",
  color: "var(--text-muted)",
  flexShrink: 0,
  minWidth: 132,
};

const proseLabel: React.CSSProperties = {
  display: "block",
  fontSize: "var(--fs-xs)",
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "var(--ls-eyebrow)",
  color: "var(--text-muted)",
  marginBottom: "var(--sp-3)",
};

const prose: React.CSSProperties = {
  margin: 0,
  fontSize: "var(--fs-base)",
  lineHeight: "var(--lh-base)",
  color: "var(--text-secondary)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

/** Freitext-Abschnitt — rendert gar nichts, wenn leer. */
function ProseBlock({ label, text }: { label: string; text: string | null }) {
  if (!text?.trim()) return null;
  return (
    <div>
      <span style={proseLabel}>{label}</span>
      <p style={prose}>{text}</p>
    </div>
  );
}

export function SettingMirror({ setting }: { setting: SettingContext }) {
  // Kernfakten — nur befuellte. Heute bleibt die Liste meist leer, weil keine
  // Setting-Oberflaeche diese Felder schreibt; sobald sie es tut (oder Daten
  // importiert werden), erscheinen sie hier ohne weitere Aenderung.
  const facts: { label: string; value: string }[] = [];
  if (setting.has_budget_8k) {
    facts.push({ label: "Budget (8k+)", value: BUDGET_LABEL[setting.has_budget_8k] ?? setting.has_budget_8k });
  }
  if (setting.branche) {
    facts.push({ label: "Branche", value: BRANCHE_LABEL[setting.branche] ?? setting.branche });
  }
  if (setting.ist_pain != null) facts.push({ label: "Ist-Pain", value: `${Number(setting.ist_pain)} / 10` });
  if (setting.warmth != null) facts.push({ label: "Wärme", value: `${Number(setting.warmth)} / 10` });
  if (setting.soll_ziel?.trim()) facts.push({ label: "Soll-Ziel", value: setting.soll_ziel });

  const soleDecider = jaNein(setting.sole_decider);
  if (soleDecider) facts.push({ label: "Allein-Entscheider", value: soleDecider });
  const canDecideNow = jaNein(setting.can_decide_now);
  if (canDecideNow) facts.push({ label: "Kann jetzt entscheiden", value: canDecideNow });
  const clearNeed = jaNein(setting.clear_need);
  if (clearNeed) facts.push({ label: "Klarer Bedarf", value: clearNeed });

  const answers = setting.script_answers ?? {};
  const answeredCount = ALL_SETTING_BLOCKS.filter((b) => (answers[b.key] ?? "").trim().length > 0).length;

  const termin = formatTermin(setting.appointment_at);
  const hasProse =
    Boolean(setting.notes?.trim()) ||
    Boolean(setting.objections_handled?.trim()) ||
    Boolean(setting.objections_open?.trim());
  const isEmpty = facts.length === 0 && answeredCount === 0 && !hasProse;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* ── Kopf: Herkunft des Gesprächs ── */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "var(--sp-4)",
            marginBottom: "var(--sp-4)",
          }}
        >
          <span className="eyebrow">Aus dem Setting</span>
          {/* Zaehler nur, wenn ueberhaupt Notizen existieren. Das Setting-Skript
              sammelt seit dem Umbau keine Antworten mehr — ein festes „0 / 9"
              haette dauerhaft einen Mangel gemeldet, den es nicht gibt. */}
          {answeredCount > 0 && (
            <span className="tnum" style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
              {answeredCount} Notizen
            </span>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)" }}>
          {termin && <span className="badge badge-gray">{termin}</span>}
          {setting.show_status && (
            <span className={setting.show_status === "show" ? "badge badge-green" : "badge badge-red"}>
              {SHOW_STATUS_LABEL[setting.show_status]}
            </span>
          )}
          {setting.status && <span className="badge badge-gray">{SETTING_STATUS_LABEL[setting.status]}</span>}
          {setting.recording_link?.trim() && (
            <a
              href={setting.recording_link}
              target="_blank"
              rel="noopener noreferrer"
              className="badge badge-gray"
              style={{ textDecoration: "none" }}
            >
              <ExternalLink size={11} /> Aufzeichnung
            </a>
          )}
        </div>
      </div>

      {isEmpty && (
        <p style={{ margin: 0, fontSize: "var(--fs-base)", color: "var(--text-muted)" }}>
          Der Setter hat keine Angaben hinterlassen.
        </p>
      )}

      {/* ── Kernfakten ── */}
      {facts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          {facts.map((f) => (
            <div key={f.label} style={{ display: "flex", gap: "var(--sp-4)", alignItems: "baseline" }}>
              <span style={factLabel}>{f.label}</span>
              <span
                style={{
                  fontSize: "var(--fs-base)",
                  fontWeight: 500,
                  color: "var(--text-primary)",
                  wordBreak: "break-word",
                }}
              >
                {f.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Script-Blöcke ──
          Frueher standen hier ALLE Bloecke, auch unbeantwortete: Block 3 links
          sollte neben Block 3 rechts stehen. Seit das Setting-Skript auf reine
          Ueberschriften reduziert ist, sammelt es keine Antworten mehr — die
          Ansicht bestuende dann aus neun Zeilen „nicht beantwortet" und einem
          Zaehler, der fuer immer auf 0 steht. Deshalb jetzt: nur zeigen, was
          tatsaechlich beantwortet wurde (Bestandsdaten aus der Zeit davor). */}
      {[...ALL_SETTING_BLOCKS, ...LEGACY_SETTING_BLOCKS]
        .filter((b) => (answers[b.key] ?? "").trim())
        .map((block, idx) => {
        const value = (answers[block.key] ?? "").trim();
        const hasContent = value.length > 0;
        return (
          <section key={block.key}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "var(--r-full)",
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  background: hasContent ? "var(--surface-3)" : "var(--surface-1)",
                  border: `1px solid ${hasContent ? "var(--border-strong)" : "var(--border-default)"}`,
                  color: hasContent ? "var(--text-secondary)" : "var(--text-disabled)",
                }}
              >
                {idx + 1}
              </span>
              <span
                style={{
                  fontSize: "1rem",
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                  color: hasContent ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                {block.label}
              </span>
            </div>
            <p
              style={{
                fontSize: "0.8125rem",
                lineHeight: 1.5,
                color: "var(--text-muted)",
                whiteSpace: "pre-line",
                margin: `0 0 0.5rem ${BLOCK_INDENT}`,
              }}
            >
              {block.hint}
            </p>
            <div style={{ marginLeft: BLOCK_INDENT }}>
              {hasContent ? (
                // Spiegelt die AutoGrowTextarea des ScriptRunner — gleiche
                // Flaeche, gleiche Schriftgroesse, nur eben nicht editierbar.
                <p
                  style={{
                    margin: 0,
                    boxSizing: "border-box",
                    background: "var(--surface-1)",
                    border: "1px solid var(--border-default)",
                    borderRadius: "var(--r-md)",
                    padding: "0.875rem 1rem",
                    fontSize: "0.9375rem",
                    lineHeight: 1.6,
                    color: "var(--text-primary)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {value}
                </p>
              ) : null}
            </div>
          </section>
        );
      })}

      {/* ── Freitexte des Setters ── */}
      <ProseBlock label="Einwände behandelt" text={setting.objections_handled} />
      <ProseBlock label="Einwände offen" text={setting.objections_open} />
      <ProseBlock label="Notizen des Setters" text={setting.notes} />
    </div>
  );
}
