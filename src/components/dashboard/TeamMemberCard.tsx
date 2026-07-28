import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { setDataViewForm } from "@/app/actions/workspace";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ownerColor, ownerInitials } from "@/lib/ownerColor";

// Team-Vergleich: eine Karte pro Workspace-Mitglied mit Wochen-Kennzahlen.
// Server-kompatibel — der Footer wechselt die Datensicht via setDataViewForm.

export type TeamMemberMetrics = {
  dms: number;
  answerRate: number | null;
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
    <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
      <span style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>{label}</span>
      <span
        style={{
          marginLeft: "auto",
          fontSize: "0.875rem",
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
    <Card style={{ borderLeft: `3px solid ${c.fg}`, display: "flex", flexDirection: "column", gap: "0.875rem" }}>
      {/* Kopf: Avatar + Name */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", minWidth: 0 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            background: c.bg,
            color: c.fg,
            // Markenring um den Avatar. box-sizing, damit der Rand den Kreis
            // nicht auf 36px aufblaest und die Kopfzeile verspringt.
            border: "2px solid var(--orange-500)",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.8125rem",
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {ownerInitials(username)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={username}
          >
            {username}
          </div>
          <div style={{ fontSize: "0.6875rem", color: "var(--text-subtle)" }}>
            {isSelf ? "Du" : "Teammitglied"}
          </div>
        </div>
      </div>

      {/* Kennzahlen */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <MetricRow label="DMs (Woche)" value={metrics ? metrics.dms.toLocaleString("de-DE") : "—"} />
        <MetricRow label="Antwortquote" value={metrics ? formatRate(metrics.answerRate) : "—"} />
        <MetricRow label="Terminquote" value={metrics ? formatRate(metrics.apptRate) : "—"} />
        <MetricRow label="Telefon-Calls (30T)" value={metrics ? metrics.calls.toLocaleString("de-DE") : "—"} />
        <MetricRow label="Umsatz" value={metrics ? EUR.format(metrics.revenue) : "—"} />
      </div>

      {/* Footer: Datensicht wechseln bzw. eigenes Dashboard */}
      <div style={{ marginTop: "auto", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }}>
        {isSelf ? (
          <Link
            href="/"
            className="ui-btn"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.375rem",
              width: "100%",
              minHeight: 32,
              padding: "0.3125rem 0.75rem",
              fontSize: "0.8125rem",
              fontWeight: 600,
              borderRadius: "var(--radius-md)",
              background: "var(--surface-100)",
              color: "var(--text-primary)",
              border: "1px solid var(--border)",
              textDecoration: "none",
            }}
          >
            Mein Dashboard
            <ArrowRight size={13} aria-hidden />
          </Link>
        ) : (
          <form action={setDataViewForm}>
            <input type="hidden" name="view_user_id" value={userId} />
            <input type="hidden" name="next" value="/" />
            <Button type="submit" variant="secondary" size="sm" fullWidth icon={<ArrowRight size={13} aria-hidden />}>
              Dashboard ansehen
            </Button>
          </form>
        )}
      </div>
    </Card>
  );
}
