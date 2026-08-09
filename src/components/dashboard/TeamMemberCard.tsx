import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { setDataViewForm } from "@/app/actions/workspace";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ownerColor, ownerInitials } from "@/lib/ownerColor";

// Team-Vergleich: eine Karte pro Workspace-Mitglied mit Wochen-Kennzahlen.
// Server-kompatibel — der Footer wechselt die Datensicht via setDataViewForm.
//
// ALLE Zeilen beziehen sich auf dieselbe Woche (Mo–So). Vorher mischte die
// Karte drei Fenster — Woche (DMs/Quoten), 30 Tage (Telefon) und all-time
// (Umsatz) —, wodurch die Karte insgesamt keine beantwortbare Frage mehr
// stellte. Wo eine Kennzahl trotzdem eine andere Bezugsgröße hat
// (Terminquote = Konversion der Pitches, nicht Aktivität), steht das im Label.
//
// Gestaltung: Die Karte ist ein Vergleichsraster, kein Personen-Poster. Farbige
// Kantenleiste, getönter Avatar und Markenring liefen frueher pro Karte in
// einer anderen Farbe — nebeneinander ergab das ein Farbmuster, in dem die
// Zahlen die schwaechsten Elemente waren. Uebrig bleibt der 6px-Punkt: er
// identifiziert die Person genauso zuverlaessig und ist derselbe Marker wie im
// Wochenduell.

export type TeamMemberMetrics = {
  dms: number;
  /** Im Zeitraum GELEGTE Termine (setting_calls.created_at) — alle Kanäle. */
  apptsBooked: number;
  answerRate: number | null;
  /** Anteil der Pitches DIESER Woche, die irgendwann zu einem Termin führten. */
  apptRate: number | null;
  calls: number;
  revenue: number;
};

const EUR = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

function formatRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${rate.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-4)" }}>
      <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{label}</span>
      <span
        style={{
          marginLeft: "auto",
          fontSize: "var(--fs-base)",
          fontWeight: 600,
          color: "var(--text-primary)",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function TeamMemberCard({
  username,
  userId,
  metrics,
  isSelf,
}: {
  username: string;
  userId: string;
  metrics: TeamMemberMetrics | null;
  isSelf: boolean;
}) {
  const c = ownerColor(username);

  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      {/* Kopf: Avatar + Name */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)", minWidth: 0 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: "var(--r-full)",
            background: "var(--surface-3)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border-default)",
            // box-sizing, damit der Rand den Kreis nicht auf 36px aufblaest
            // und die Kopfzeile verspringt.
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "var(--fs-sm)",
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {ownerInitials(username)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-3)",
              fontSize: "var(--fs-md)",
              fontWeight: 600,
              color: "var(--text-primary)",
              letterSpacing: "var(--ls-tight)",
              minWidth: 0,
            }}
            title={username}
          >
            {/* Personen-Marker — identisch zum Punkt im Wochenduell und zur
                Serienfarbe im Verlaufs-Chart. */}
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                flexShrink: 0,
                borderRadius: "var(--r-full)",
                background: c.fg,
                display: "inline-block",
              }}
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {username}
            </span>
          </div>
          <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
            {isSelf ? "Du" : "Teammitglied"}
          </div>
        </div>
      </div>

      {/* Kennzahlen */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
        <MetricRow label="DMs (Woche)" value={metrics ? metrics.dms.toLocaleString("de-DE") : "—"} />
        {/* Die Zahl, nach der der Auftraggeber steuert: wer hat diese Woche wie
            viele Termine GELEGT — über LinkedIn, Telefon und manuell. */}
        <MetricRow
          label="Termine gelegt (Woche)"
          value={metrics ? metrics.apptsBooked.toLocaleString("de-DE") : "—"}
        />
        <MetricRow label="Antwortquote (Woche)" value={metrics ? formatRate(metrics.answerRate) : "—"} />
        <MetricRow label="Terminquote (aus Pitches)" value={metrics ? formatRate(metrics.apptRate) : "—"} />
        <MetricRow label="Telefon-Calls (Woche)" value={metrics ? metrics.calls.toLocaleString("de-DE") : "—"} />
        <MetricRow label="Umsatz (Woche)" value={metrics ? EUR.format(metrics.revenue) : "—"} />
      </div>

      {/* Footer: Datensicht wechseln bzw. eigenes Dashboard */}
      <div style={{ marginTop: "auto", paddingTop: "var(--sp-5)", borderTop: "1px solid var(--border-default)" }}>
        {isSelf ? (
          <Link
            href="/"
            className="btn-secondary"
            style={{ width: "100%", textDecoration: "none" }}
          >
            Mein Dashboard
            <ArrowRight size={13} aria-hidden />
          </Link>
        ) : (
          <form action={setDataViewForm}>
            <input type="hidden" name="view_user_id" value={userId} />
            <input type="hidden" name="next" value="/" />
            {/* size="md" statt "sm": beide Footer-Varianten sind damit 32px hoch,
                sonst sprangen die Karten je nach „Du"/„Teammitglied" um 4px. */}
            <Button type="submit" variant="secondary" size="md" fullWidth icon={<ArrowRight size={13} aria-hidden />}>
              Dashboard ansehen
            </Button>
          </form>
        )}
      </div>
    </Card>
  );
}
