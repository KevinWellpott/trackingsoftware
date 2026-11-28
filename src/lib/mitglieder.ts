// Mitglieder-Verwaltung — Regeln ohne Datenbank (für Server Action UND
// Formular, damit beide dasselbe sagen).

export const PASSWORT_MIN = 8;

/** Fehlertext oder `null`, wenn das Passwort taugt. */
export function passwortFehler(pw: string): string | null {
  if (typeof pw !== "string" || pw.length < PASSWORT_MIN) return `Das Passwort braucht mindestens ${PASSWORT_MIN} Zeichen.`;
  if (pw.length > 72) return "Das Passwort darf höchstens 72 Zeichen haben.";
  if (/^\s|\s$/.test(pw)) return "Das Passwort darf nicht mit einem Leerzeichen beginnen oder enden.";
  return null;
}

/** Gut lesbares Zufallspasswort ohne verwechselbare Zeichen (0/O, 1/l/I). */
export function erzeugePasswort(laenge = 12, zufall: (n: number) => Uint32Array = (n) => crypto.getRandomValues(new Uint32Array(n))): string {
  const zeichen = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const werte = zufall(laenge);
  let out = "";
  for (let i = 0; i < laenge; i++) out += zeichen[werte[i] % zeichen.length];
  return out;
}

/** „vor 3 Tagen“, „heute“, „noch nie“ — für die Mitgliederliste. */
export function zuletztText(iso: string | null, nowMs: number): string {
  if (!iso) return "noch nie angemeldet";
  const tage = Math.floor((nowMs - Date.parse(iso)) / 86_400_000);
  if (tage <= 0) return "zuletzt heute angemeldet";
  if (tage === 1) return "zuletzt gestern angemeldet";
  if (tage < 30) return `zuletzt vor ${tage} Tagen angemeldet`;
  const monate = Math.floor(tage / 30);
  return monate === 1 ? "zuletzt vor einem Monat angemeldet" : `zuletzt vor ${monate} Monaten angemeldet`;
}
