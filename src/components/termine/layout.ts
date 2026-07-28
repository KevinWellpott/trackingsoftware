import type { TerminEvent } from "@/lib/termine";

// Überlappungs-Layout für Woche/Tag: parallele Termine sollen nebeneinander
// liegen statt sich zu verdecken.
//
// Vorgehen (Standard-Intervallgraph-Packing):
//   1. Nach Startzeit sortieren.
//   2. Zu Clustern gruppieren — solange ein Event vor dem spätesten Ende des
//      laufenden Clusters startet, gehört es dazu.
//   3. Innerhalb eines Clusters gierig die erste freie Spalte vergeben.
//   4. Breite = 1 / Spaltenanzahl des Clusters, Offset = Spaltenindex.

export type PlacedEvent = {
  event: TerminEvent;
  /** 0…1 — Anteil der Spaltenbreite. */
  left: number;
  width: number;
};

/** Mindesthöhe eines Events fürs Packing, damit 0-Minuten-Slots nicht kollabieren. */
const MIN_SLOT_MIN = 15;

export function packEvents(events: TerminEvent[]): PlacedEvent[] {
  if (events.length === 0) return [];

  const sorted = [...events].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const placed: PlacedEvent[] = [];

  let cluster: TerminEvent[] = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    // Spalten gierig vergeben: erste Spalte, deren letztes Event schon vorbei ist.
    const colEnds: number[] = [];
    const colOf = new Map<string, number>();
    for (const e of cluster) {
      const end = Math.max(e.endMin, e.startMin + MIN_SLOT_MIN);
      let col = colEnds.findIndex((cEnd) => cEnd <= e.startMin);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(end);
      } else {
        colEnds[col] = end;
      }
      colOf.set(e.id, col);
    }
    const cols = colEnds.length;
    for (const e of cluster) {
      const col = colOf.get(e.id) ?? 0;
      placed.push({ event: e, left: col / cols, width: 1 / cols });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const e of sorted) {
    const end = Math.max(e.endMin, e.startMin + MIN_SLOT_MIN);
    if (cluster.length > 0 && e.startMin >= clusterEnd) flush();
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();

  return placed;
}

/**
 * Sichtbarer Zeitbereich einer Ansicht. Basis 07:00–21:00, wird aber gedehnt,
 * damit Randtermine (früher Morgen / später Abend) nie unsichtbar sind.
 */
export const DEFAULT_DAY_START = 7 * 60;
export const DEFAULT_DAY_END = 21 * 60;

export function visibleRange(events: TerminEvent[]): { start: number; end: number } {
  let start = DEFAULT_DAY_START;
  let end = DEFAULT_DAY_END;
  for (const e of events) {
    if (e.startMin < start) start = Math.floor(e.startMin / 60) * 60;
    if (e.endMin > end) end = Math.ceil(e.endMin / 60) * 60;
  }
  return { start, end: Math.max(end, start + 60) };
}
