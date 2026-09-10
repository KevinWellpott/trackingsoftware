import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// Rueckweg-Link ueber dem Seitenkopf. Ersetzt die frueheren Ad-hoc-Varianten
// in jeder Detailseite, damit „zurueck" ueberall gleich aussieht und liegt.

export type BackTarget = { href: string; label: string };

/**
 * Herkuenfte, die eine Detailseite als Rueckweg anerkennt.
 *
 * Eine FESTE Liste und keine Pfad-Pruefung: `?from=` kommt aus der URL und
 * landet in einem `href`. Ein uebernommener Fremdwert waere ein offener
 * Weiterleitungspunkt — „//fremde-seite" ist ein absoluter Link, und ein
 * Zurueck-Pfeil ist genau der Knopf, den niemand vor dem Klick liest.
 * Ausserdem gehoert die Beschriftung dazu: „Nachfassen" muss dranstehen, sonst
 * fuehrt ein Link mit der Aufschrift „Termine" woandershin.
 */
const BACK_TARGETS: Record<string, BackTarget> = {
  nachfassen: { href: "/nachfassen", label: "Nachfassen" },
};

/**
 * Rueckweg aus dem `?from=`-Parameter, sonst der uebergebene Standard.
 *
 * Ohne das fuehrte der Zurueck-Pfeil einer Termin-Detailseite immer in den
 * Kalender. Wer aus einer Arbeitsliste kam, landete woanders — und die Liste
 * wurde beim Zurueck komplett neu aufgebaut (Filter, Sektionszustand,
 * Scrollposition weg).
 */
export function backTargetFrom(
  from: string | string[] | undefined,
  fallback: BackTarget,
): BackTarget {
  const key = Array.isArray(from) ? from[0] : from;
  return (key ? BACK_TARGETS[key] : undefined) ?? fallback;
}

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
