import { Mail, Phone } from "lucide-react";

// Anrufen und Mailen dort, wo man es braucht: im Kopf der Akte und an jedem
// überfälligen Kunden.

/** Nur, was eine Wählverbindung versteht. */
export function waehlbar(telefon: string | null): string | null {
  const n = (telefon ?? "").replace("(0)", "").replace(/[^\d+]/g, "");
  return n.replace(/\D/g, "").length >= 5 ? n : null;
}

export function KontaktLinks({ telefon, email }: { telefon: string | null; email: string | null }) {
  const tel = waehlbar(telefon);
  const mail = email && /^[^\s@?&]+@[^\s@?&]+$/.test(email.trim()) ? email.trim() : null;
  if (!tel && !mail) return null;
  return (
    <span className="ks-kontakt">
      {tel && (
        <a href={`tel:${tel}`} className="ks-link">
          <Phone size={13} aria-hidden /> {telefon}
        </a>
      )}
      {mail && (
        <a href={`mailto:${mail}`} className="ks-link">
          <Mail size={13} aria-hidden /> {mail}
        </a>
      )}
    </span>
  );
}
