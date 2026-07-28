import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// Rueckweg-Link ueber dem Seitenkopf. Ersetzt die frueheren Ad-hoc-Varianten
// in jeder Detailseite, damit „zurueck" ueberall gleich aussieht und liegt.

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        alignSelf: "flex-start",
        fontSize: "var(--fs-sm)",
        color: "var(--text-muted)",
        textDecoration: "none",
      }}
    >
      <ArrowLeft size={14} />
      {label}
    </Link>
  );
}
