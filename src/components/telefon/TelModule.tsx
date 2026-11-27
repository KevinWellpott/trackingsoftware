import type { ReactNode } from "react";

/**
 * Kennzahl-Modul der Telefon-Seiten (Redesign Phase 5, Prototyp `.mod`):
 * Beschriftung in Text 2, große Zahl, eine Zeile Kontext, optional ein
 * Fortschrittsbalken. Der Balken ist neutral, bis das Ziel erreicht ist —
 * die Farbe sagt „geschafft", nicht „wer".
 */
export function TelModule({
  label,
  value,
  unit,
  caption,
  meter,
  icon,
  tone,
}: {
  label: string;
  value: ReactNode;
  /** Kleiner Zusatz hinter der Zahl, z. B. „von 40". */
  unit?: string;
  caption?: ReactNode;
  /** 0–100; ab 100 grün. */
  meter?: number | null;
  icon?: ReactNode;
  /** `gold` = „du bist dran" (fällige Rückrufe). */
  tone?: "gold";
}) {
  return (
    <div className="tel-mod" data-tone={tone}>
      <div className="tel-mod-l">
        {icon}
        <span>{label}</span>
      </div>
      <div className="tel-mod-v">
        <b className="tnum">{value}</b>
        {unit && <span>{unit}</span>}
      </div>
      {meter != null && (
        <div className="cm-meter" style={{ marginTop: 8 }}>
          <i data-done={meter >= 100 ? "" : undefined} style={{ width: `${Math.max(0, Math.min(100, meter))}%` }} />
        </div>
      )}
      {caption && <div className="tel-mod-c">{caption}</div>}
    </div>
  );
}
