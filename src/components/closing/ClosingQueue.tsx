"use client";

import type { ClosingCall } from "@/lib/types";
import { CalendarClock, Euro, Handshake } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

// Closing-Queue (Client): Filter "Meine/Alle" + Status-Filter, Karten pro Call.
// Alle Daten kommen vom Server-Parent; gefiltert wird rein clientseitig.

type Assignee = { user_id: string; username: string };

type Props = {
  calls: ClosingCall[];
  assigneesByCall: Record<string, Assignee[]>;
  meId: string;
};

type StatusFilter = ClosingCall["status"] | "alle";
type ScopeFilter = "meine" | "alle";

const STATUS_META: Record<ClosingCall["status"], { label: string; color: string; bg: string; border: string }> = {
  offen: { label: "Offen", color: "var(--text-muted)", bg: "var(--surface-150)", border: "var(--border)" },
  gewonnen: {
    label: "Gewonnen",
    color: "var(--color-success-text)",
    bg: "var(--color-success-bg)",
    border: "var(--color-success-border)",
  },
  verloren: {
    label: "Verloren",
    color: "var(--color-error-text)",
    bg: "var(--color-error-bg)",
    border: "var(--color-error-border)",
  },
  nachfassen: {
    label: "Nachfassen",
    color: "var(--color-warning-text)",
    bg: "var(--color-warning-bg)",
    border: "var(--color-warning-border)",
  },
};

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "alle", label: "Alle" },
  { value: "offen", label: "Offen" },
  { value: "gewonnen", label: "Gewonnen" },
  { value: "verloren", label: "Verloren" },
  { value: "nachfassen", label: "Nachfassen" },
];

const CHIP_PALETTE = ["#6366f1", "#8b5cf6", "#10b981", "#0ea5e9", "#f59e0b", "#ec4899", "#14b8a6"];

function avatarColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
  return CHIP_PALETTE[hash % CHIP_PALETTE.length];
}

function formatTermin(iso: string | null): string | null {
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
    timeZone: "Europe/Berlin",
  }).format(d)} Uhr`;
}

function formatEur(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function ClosingQueue({ calls, assigneesByCall, meId }: Props) {
  const [scope, setScope] = useState<ScopeFilter>("alle");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("alle");

  const scoped = useMemo(() => {
    if (scope === "alle") return calls;
    return calls.filter((c) => {
      if (c.created_by_user_id === meId) return true;
      return (assigneesByCall[c.id] ?? []).some((a) => a.user_id === meId);
    });
  }, [calls, scope, assigneesByCall, meId]);

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      alle: scoped.length,
      offen: 0,
      gewonnen: 0,
      verloren: 0,
      nachfassen: 0,
    };
    for (const c of scoped) counts[c.status] += 1;
    return counts;
  }, [scoped]);

  const visible = useMemo(
    () => (statusFilter === "alle" ? scoped : scoped.filter((c) => c.status === statusFilter)),
    [scoped, statusFilter],
  );

  return (
    <div>
      {/* ── Scope-Tabs + Status-Filter ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
          marginBottom: "1rem",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            background: "var(--surface-150)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            padding: 3,
            gap: 2,
          }}
        >
          {(
            [
              { value: "meine", label: "Meine" },
              { value: "alle", label: "Alle" },
            ] as { value: ScopeFilter; label: string }[]
          ).map((t) => {
            const active = scope === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setScope(t.value)}
                style={{
                  padding: "0.3rem 0.875rem",
                  borderRadius: "var(--radius-xs)",
                  border: "none",
                  background: active ? "var(--surface-100)" : "transparent",
                  color: active ? "var(--text-primary)" : "var(--text-subtle)",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  boxShadow: active ? "var(--shadow-xs)" : "none",
                  transition: "all 0.1s",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
          {STATUS_FILTERS.map((f) => {
            const active = statusFilter === f.value;
            const meta = f.value !== "alle" ? STATUS_META[f.value] : null;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatusFilter(f.value)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  padding: "0.3rem 0.625rem",
                  borderRadius: 99,
                  border: `1px solid ${active ? (meta?.border ?? "var(--border-bright)") : "var(--border)"}`,
                  background: active ? (meta?.bg ?? "var(--surface-150)") : "var(--surface-50)",
                  color: active ? (meta?.color ?? "var(--text-primary)") : "var(--text-muted)",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  transition: "all 0.1s",
                }}
              >
                {f.label}
                <span
                  style={{
                    fontSize: "0.625rem",
                    fontWeight: 800,
                    background: "var(--surface-200)",
                    color: "var(--text-muted)",
                    borderRadius: 99,
                    padding: "0.05rem 0.35rem",
                  }}
                >
                  {statusCounts[f.value]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Karten ── */}
      {visible.length === 0 ? (
        <div
          style={{
            background: "var(--surface-100)",
            border: "1px dashed var(--border-bright)",
            borderRadius: "var(--radius-lg)",
            padding: "3rem 1.5rem",
            textAlign: "center",
          }}
        >
          <Handshake size={26} style={{ color: "var(--text-subtle)", marginBottom: "0.625rem" }} />
          <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.25rem" }}>
            Keine Closing-Calls
          </div>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", margin: 0 }}>
            Closing-Calls entstehen automatisch, sobald ein qualifizierter Setting-Call ins Closing gelegt wird.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
          {visible.map((c) => {
            const status = STATUS_META[c.status];
            const termin = formatTermin(c.call_at);
            const callAssignees = assigneesByCall[c.id] ?? [];
            const dealVolume = c.deal_volume == null ? null : Number(c.deal_volume);
            return (
              <Link key={c.id} href={`/closing/${c.id}`} style={{ textDecoration: "none" }} className="organic-list-card-link">
                <div
                  className="organic-list-card"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.875rem",
                    flexWrap: "wrap",
                    background: "var(--surface-100)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-md)",
                    padding: "0.875rem 1.125rem",
                    transition: "border-color 0.15s, box-shadow 0.15s",
                  }}
                >
                  {/* Name + Firma */}
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "0.9375rem",
                        fontWeight: 800,
                        letterSpacing: "-0.01em",
                        color: "var(--text-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        marginBottom: "0.2rem",
                      }}
                    >
                      {c.lead_name ?? "Unbenannter Lead"}
                    </div>
                    {c.company && (
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "var(--text-muted)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c.company}
                      </div>
                    )}
                  </div>

                  {/* Termin */}
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.35rem",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      color: termin ? "var(--text-secondary)" : "var(--text-subtle)",
                      flexShrink: 0,
                    }}
                  >
                    <CalendarClock size={13} style={{ color: "var(--text-subtle)" }} />
                    {termin ?? "Kein Termin"}
                  </div>

                  {/* Deal-Volumen (nur gewonnen) */}
                  {c.status === "gewonnen" && dealVolume != null && !Number.isNaN(dealVolume) && (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.3rem",
                        fontSize: "0.75rem",
                        fontWeight: 800,
                        color: "var(--color-success-text)",
                        background: "var(--color-success-bg)",
                        border: "1px solid var(--color-success-border)",
                        borderRadius: 99,
                        padding: "0.15rem 0.55rem",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      <Euro size={11} strokeWidth={2.5} />
                      {formatEur(dealVolume)}
                    </span>
                  )}

                  {/* Status */}
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      fontSize: "0.6875rem",
                      fontWeight: 700,
                      color: status.color,
                      background: status.bg,
                      border: `1px solid ${status.border}`,
                      borderRadius: 99,
                      padding: "0.15rem 0.55rem",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {status.label}
                  </span>

                  {/* Assignees */}
                  <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                    {callAssignees.slice(0, 4).map((a, i) => {
                      const color = avatarColor(a.username);
                      return (
                        <span
                          key={a.user_id}
                          title={a.username}
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: "50%",
                            background: color,
                            color: "#fff",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "0.625rem",
                            fontWeight: 800,
                            border: "2px solid var(--surface-100)",
                            marginLeft: i === 0 ? 0 : -7,
                          }}
                        >
                          {a.username.charAt(0).toUpperCase()}
                        </span>
                      );
                    })}
                    {callAssignees.length > 4 && (
                      <span style={{ fontSize: "0.6875rem", color: "var(--text-subtle)", marginLeft: 4, fontWeight: 700 }}>
                        +{callAssignees.length - 4}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
