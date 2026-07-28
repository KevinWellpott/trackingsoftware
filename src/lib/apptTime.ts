// Termin-Zeit: eine einzige Konvertierungsstelle zwischen Berlin-Wandzeit
// (was der Nutzer eintippt und liest) und echtem UTC (was in den timestamptz-
// Spalten steht).
//
// Warum explizit und nicht über `new Date(...)`: Server-Actions laufen auf
// Vercel in UTC, lokal in Europe/Berlin. Ein `new Date("2026-07-27T10:00")`
// liefert dort zwei verschiedene Zeitpunkte — genau daran ist die alte
// Speicherung zerbrochen (Berlin-Wandzeit landete unverändert als UTC in der
// Spalte). Der Offset wird darum über Intl aus der IANA-Zone gelesen und gilt
// serverseitig wie clientseitig identisch, inklusive Sommer-/Winterzeit.

export const APP_TZ = "Europe/Berlin";

/** Offset (ms) von APP_TZ gegenüber UTC zum Zeitpunkt `utcMs`. */
function tzOffsetMs(utcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24, // 24:00 kommt bei hour12:false vor
    Number(parts.minute),
    Number(parts.second),
  );
  return asUTC - utcMs;
}

/** "2026-07-27T10:00" (Berlin-Wandzeit) → echtes ISO-UTC, oder null. */
export function berlinInputToIso(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  // Zweistufig: der Offset hängt selbst vom Zeitpunkt ab (DST). Der erste
  // Durchlauf schätzt, der zweite korrigiert an den Umstellungswochenenden.
  const first = naive - tzOffsetMs(naive);
  const exact = naive - tzOffsetMs(first);
  return new Date(exact).toISOString();
}

/** Berlin-Wandzeit-Bestandteile eines UTC-Zeitpunkts. */
function berlinParts(iso: string): { date: string; time: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // sv-SE formatiert als "2026-07-27 10:00:00" — ISO-nah und stabil parsebar.
  const s = new Intl.DateTimeFormat("sv-SE", {
    timeZone: APP_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  const [date, time] = s.split(" ");
  if (!date || !time) return null;
  return { date, time };
}

/** ISO-UTC → "2026-07-27T10:00" für <input type="datetime-local">. */
export function isoToBerlinInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const p = berlinParts(iso);
  return p ? `${p.date}T${p.time}` : "";
}

/** ISO-UTC → "2026-07-27" (Berlin-Kalendertag, nicht UTC-Datumsteil). */
export function berlinDateISO(iso: string | null | undefined): string {
  if (!iso) return "";
  return berlinParts(iso)?.date ?? "";
}

/** ISO-UTC → Kalender-Slot: Berlin-Tag + Minuten ab Mitternacht. */
export function toBerlinSlot(iso: string): { dayISO: string; startMin: number } | null {
  const p = berlinParts(iso);
  if (!p) return null;
  const [hh, mm] = p.time.split(":").map(Number);
  return { dayISO: p.date, startMin: hh * 60 + mm };
}

/** Umkehrung von toBerlinSlot: Kalender-Slot → echtes ISO-UTC. */
export function slotToIso(dayISO: string, startMin: number): string {
  // Über Tagesgrenzen hinaus normalisieren (Drag kann rechnerisch <0 / >1440 ergeben).
  const dayShift = Math.floor(startMin / 1440);
  const minOfDay = ((startMin % 1440) + 1440) % 1440;
  const [y, m, d] = dayISO.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + dayShift));
  const day = shifted.toISOString().slice(0, 10);
  const hh = String(Math.floor(minOfDay / 60)).padStart(2, "0");
  const mm = String(minOfDay % 60).padStart(2, "0");
  return berlinInputToIso(`${day}T${hh}:${mm}`) as string;
}

/** "Mo., 27.07.2026, 10:00 Uhr" — die Termin-Anzeige der gesamten App. */
export function formatTermin(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: APP_TZ,
  }).format(d)} Uhr`;
}

/**
 * Termin in seine zwei Teile zerlegt: `{ date: "Do 17.07.", time: "14:00" }`.
 *
 * Für Kopfzeilen, in denen die Uhrzeit hervorgehoben und das Datum ruhig
 * gesetzt wird. Bewusst ohne Jahr und ohne „Uhr" — beides kostet Breite und
 * trägt im laufenden Betrieb nichts bei. Wer das Jahr braucht, nimmt
 * `formatTermin`.
 */
export function formatTerminParts(iso: string | null): { date: string; time: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const weekday = new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone: APP_TZ })
    .format(d)
    .replace(".", "");
  const dayMonth = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    timeZone: APP_TZ,
  }).format(d);
  const time = new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: APP_TZ,
  }).format(d);
  return { date: `${weekday} ${dayMonth}`, time };
}

/** Nur die Uhrzeit, "10:00" — für Kalender-Chips. */
export function formatZeit(iso: string | null): string {
  if (!iso) return "";
  const p = berlinParts(iso);
  return p?.time ?? "";
}

/** Minuten ab Mitternacht → "10:00". */
export function minToHHMM(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
