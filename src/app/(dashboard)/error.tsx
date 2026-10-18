"use client";

// Fehlergrenze des Dashboard-Bereichs. Ohne sie zeigte jeder geworfene Fehler
// (RPC, fehlende Migration, abgelaufene Sitzung) den nackten Next-Bildschirm
// ohne Seitenleiste — man kam nur über die Adresszeile zurück. Diese Grenze
// liegt UNTER dem Layout: Navigation, Org- und Datensicht-Umschalter bleiben
// bedienbar, nur der Inhalt wird ersetzt.
//
// Die Fehlermeldung selbst zeigen wir nicht: Aus Server Components kommt in
// Produktion ohnehin nur ein generischer Text, und der `digest` ist das, was
// man in den Vercel-Logs wiederfindet.

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      role="alert"
      className="card"
      style={{
        maxWidth: 560,
        margin: "var(--sp-12) auto 0",
        padding: "var(--sp-9)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-5)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", color: "var(--text-primary)" }}>
        <AlertTriangle size={18} aria-hidden="true" style={{ color: "var(--warning)" }} />
        <h1 style={{ fontSize: "var(--fs-lg)", fontWeight: 600, margin: 0 }}>
          Diese Seite konnte nicht geladen werden
        </h1>
      </div>
      <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.5 }}>
        Das liegt meist an einer kurzen Verbindungsstörung. Ein zweiter Versuch hilft in den
        meisten Fällen; die Navigation links funktioniert weiter.
      </p>
      {error.digest && (
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "var(--fs-xs)", fontVariantNumeric: "tabular-nums" }}>
          Fehler-Kennung: {error.digest}
        </p>
      )}
      <div>
        <Button onClick={() => unstable_retry()}>Erneut versuchen</Button>
      </div>
    </div>
  );
}
