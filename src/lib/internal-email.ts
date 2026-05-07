/** E-Mail für Login/Auth: gleiche Regel wie bei `createUser` / add-paul (Leerzeichen → Punkt, nur erlaubte Zeichen). */
export function usernameToInternalEmail(username: string): string {
  const emailName = username
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]/g, "");
  return `${emailName}@pitchtracker.internal`;
}
