/** Lokales Kalenderdatum YYYY-MM-DD (für Abgleich mit Postgres `date`). */
export function localDateISO (d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysISO (isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return localDateISO(dt);
}

/** ISO-Kalenderwoche (KW) eines Datums (YYYY-MM-DD). */
export function getISOWeek (dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const jan4 = new Date(dt.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  return Math.floor((dt.getTime() - startOfWeek1.getTime()) / (7 * 86400000)) + 1;
}

/** Montag der Woche, in der `today` (YYYY-MM-DD) liegt. */
export function weekStart (today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  dt.setDate(dt.getDate() + (day === 0 ? -6 : 1 - day));
  return localDateISO(dt);
}

export const WEEKDAYS_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;

/** 6 Wochen à 7 Tage rund um den Monat (Montag-Start) — DatePicker + Kalender. */
export function buildMonthGrid (y: number, m: number): { iso: string; day: number; inMonth: boolean }[] {
  const first = new Date(y, m - 1, 1);
  const offset = (first.getDay() + 6) % 7; // Mo=0 … So=6
  const cells: { iso: string; day: number; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const dt = new Date(y, m - 1, 1 - offset + i);
    cells.push({ iso: localDateISO(dt), day: dt.getDate(), inMonth: dt.getMonth() === m - 1 });
  }
  return cells;
}

/** Die 7 Tage (Mo–So) der Woche, in der `isoDate` liegt. */
export function buildWeekDays (isoDate: string): string[] {
  const start = weekStart(isoDate);
  return Array.from({ length: 7 }, (_, i) => addDaysISO(start, i));
}

/** Monats-Label "Juli 2026". */
export function monthLabelDe (y: number, m: number): string {
  return new Date(y, m - 1, 1).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}
