"use client";

import { ManualAppointmentModal } from "@/components/appointment/ManualAppointmentModal";
import { Input } from "@/components/ui/Input";
import { ownerColor, ownerInitials } from "@/lib/ownerColor";
import type { SettingCall } from "@/lib/types";
import { AtSign, CalendarClock, ClipboardCheck, Phone, Plus, Search, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

// Setting-Queue (Client): Filter "Meine/Alle" + Status-Filter, Karten pro Call.
// Alle Daten kommen vom Server-Parent; gefiltert wird rein clientseitig.

type Assignee = { user_id: string; username: string };

type Props = {
  calls: SettingCall[];
  assigneesByCall: Record<string, Assignee[]>;
  currentUserId: string;
};

type StatusFilter = SettingCall["status"] | "alle";
type ScopeFilter = "meine" | "alle";

const STATUS_META: Record<SettingCall["status"], { label: string; color: string; bg: string; border: string }> = {
  offen: { label: "Offen", color: "var(--text-muted)", bg: "var(--surface-150)", border: "var(--border)" },
  no_show: {
    label: "No-Show",
    color: "var(--color-error-text)",
    bg: "var(--color-error-bg)",
    border: "var(--color-error-border)",
  },
  qualifiziert: {
    label: "Qualifiziert",
    color: "var(--color-success-text)",
    bg: "var(--color-success-bg)",
    border: "var(--color-success-border)",
  },
  closing_gelegt: {
    label: "Closing gelegt",
    color: "var(--color-info-text)",
    bg: "var(--color-info-bg)",
    border: "var(--color-info-border)",
  },
  unqualifiziert: {
    label: "Unqualifiziert",
    color: "var(--color-warning-text)",
    bg: "var(--color-warning-bg)",
    border: "var(--color-warning-border)",
  },
  dead: { label: "Dead", color: "var(--color-error-text)", bg: "var(--color-error-bg)", border: "var(--color-error-border)" },
};

// "Qualifiziert" entsteht nicht mehr neu (ein Klick legt direkt das Closing an),
// bleibt aber für Bestandsdaten erreichbar — der Tab wird nur bei Treffern gezeigt.
const STATUS_FILTERS: { value: StatusFilter; label: string; legacy?: boolean }[] = [
  { value: "alle", label: "Alle" },
  { value: "offen", label: "Offen" },
  { value: "no_show", label: "No-Show" },
  { value: "qualifiziert", label: "Qualifiziert", legacy: true },
  { value: "closing_gelegt", label: "Closing gelegt" },
  { value: "unqualifiziert", label: "Unqualifiziert" },
  { value: "dead", label: "Dead" },
];

const SOURCE_META: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string; border: string }> = {
  linkedin: {
    label: "LinkedIn",
    icon: <AtSign size={10} />,
    color: "var(--color-info-text)",
    bg: "var(--color-info-bg)",
    border: "var(--color-info-border)",
  },
  telefon: {
    label: "Telefon",
    icon: <Phone size={10} />,
    color: "var(--brand-500)",
    bg: "var(--brand-50)",
    border: "var(--brand-200)",
  },
  inbound: {
    label: "Inbound",
    icon: <CalendarClock size={10} />,
    color: "var(--text-muted)",
    bg: "var(--surface-150)",
    border: "var(--border)",
  },
  website: {
    label: "Website",
    icon: <CalendarClock size={10} />,
    color: "var(--text-muted)",
    bg: "var(--surface-150)",
    border: "var(--border)",
  },
  manuell: {
    label: "Manuell",
    icon: <Plus size={10} />,
    color: "var(--color-success-text)",
    bg: "var(--color-success-bg)",
    border: "var(--color-success-border)",
  },
};

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
    timeZone: "Europe/Berlin",
  }).format(d)} Uhr`;
}

export function SettingQueue({ calls, assigneesByCall, currentUserId }: Props) {
  const router = useRouter();
  const [scope, setScope] = useState<ScopeFilter>("alle");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("alle");
  const [search, setSearch] = useState("");
  const [showManual, setShowManual] = useState(false);

  const scoped = useMemo(() => {
    if (scope === "alle") return calls;
    return calls.filter((c) => {
      if (c.created_by_user_id === currentUserId) return true;
      return (assigneesByCall[c.id] ?? []).some((a) => a.user_id === currentUserId);
    });
  }, [calls, scope, assigneesByCall, currentUserId]);

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      alle: scoped.length,
      offen: 0,
      no_show: 0,
      qualifiziert: 0,
      closing_gelegt: 0,
      unqualifiziert: 0,
      dead: 0,
    };
    for (const c of scoped) counts[c.status] += 1;
    return counts;
  }, [scoped]);

  const byStatus = useMemo(
    () => (statusFilter === "alle" ? scoped : scoped.filter((c) => c.status === statusFilter)),
    [scoped, statusFilter],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return byStatus;
    return byStatus.filter((c) => [c.lead_name, c.company].filter(Boolean).join(" ").toLowerCase().includes(q));
  }, [byStatus, search]);

  return (
    <div>
      {/* ── Aktions-Zeile: Termin ohne Liste manuell buchen ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.75rem" }}>
        <button
          type="button"
          onClick={() => setShowManual(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
            padding: "0.45rem 0.875rem",
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: "var(--btn-primary-bg)",
            color: "var(--btn-primary-fg)",
            fontSize: "0.8125rem",
            fontWeight: 700,
            cursor: "pointer",
            transition: "opacity 0.1s",
          }}
        >
          <Plus size={15} /> Termin manuell
        </button>
      </div>

      <ManualAppointmentModal open={showManual} onClose={() => setShowManual(false)} onSaved={() => router.refresh()} />

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
          {STATUS_FILTERS.filter((f) => !f.legacy || statusCounts[f.value] > 0).map((f) => {
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

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: "1 1 200px", maxWidth: 300, marginLeft: "auto" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search
              size={13}
              style={{
                position: "absolute",
                left: "0.625rem",
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-subtle)",
                pointerEvents: "none",
              }}
            />
            <Input
              type="search"
              placeholder="Lead oder Firma…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minHeight: 32, padding: "0.35rem 0.75rem 0.35rem 2rem", fontSize: "0.8125rem" }}
            />
          </div>
          {search.trim() && (
            <span style={{ fontSize: "0.75rem", color: "var(--text-subtle)", whiteSpace: "nowrap", flexShrink: 0 }}>
              {visible.length}/{byStatus.length}
            </span>
          )}
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
          <ClipboardCheck size={26} style={{ color: "var(--text-subtle)", marginBottom: "0.625rem" }} />
          <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.25rem" }}>
            Keine Setting-Calls
          </div>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", margin: 0 }}>
            Setting-Calls entstehen automatisch, sobald ein LinkedIn-Kontakt oder Telefon-Lead einen Termin bekommt — oder über „Termin manuell“.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
          {visible.map((c) => {
            const status = STATUS_META[c.status];
            const source = c.source_type ? SOURCE_META[c.source_type] : null;
            const termin = formatTermin(c.appointment_at);
            const callAssignees = assigneesByCall[c.id] ?? [];
            return (
              <Link key={c.id} href={`/setting/${c.id}`} style={{ textDecoration: "none" }} className="organic-list-card-link">
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
                  {/* Name + Firma + Quelle */}
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.2rem" }}>
                      <span
                        style={{
                          fontSize: "0.9375rem",
                          fontWeight: 800,
                          letterSpacing: "-0.01em",
                          color: "var(--text-primary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c.lead_name ?? "Unbenannter Lead"}
                      </span>
                      {source && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.25rem",
                            fontSize: "0.625rem",
                            fontWeight: 800,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            color: source.color,
                            background: source.bg,
                            border: `1px solid ${source.border}`,
                            borderRadius: 99,
                            padding: "0.1rem 0.45rem",
                            flexShrink: 0,
                          }}
                        >
                          {source.icon} {source.label}
                        </span>
                      )}
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
                    {c.source_detail && (
                      <div
                        style={{
                          fontSize: "0.6875rem",
                          color: "var(--text-subtle)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={`Quelle: ${c.source_detail}`}
                      >
                        Quelle: {c.source_detail}
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
                      const oc = ownerColor(a.username);
                      return (
                        <span
                          key={a.user_id}
                          title={a.username}
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: "50%",
                            background: oc.bg,
                            color: oc.fg,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "0.625rem",
                            fontWeight: 800,
                            border: "2px solid var(--surface-100)",
                            marginLeft: i === 0 ? 0 : -7,
                          }}
                        >
                          {ownerInitials(a.username)}
                        </span>
                      );
                    })}
                    {callAssignees.length > 4 && (
                      <span style={{ fontSize: "0.6875rem", color: "var(--text-subtle)", marginLeft: 4, fontWeight: 700 }}>
                        +{callAssignees.length - 4}
                      </span>
                    )}
                  </div>

                  {/* Meet-Link */}
                  {c.meet_link && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        window.open(c.meet_link as string, "_blank", "noopener,noreferrer");
                      }}
                      title="Meet öffnen"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.3rem",
                        padding: "0.3rem 0.625rem",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--brand-200)",
                        background: "var(--brand-50)",
                        color: "var(--brand-500)",
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        cursor: "pointer",
                        flexShrink: 0,
                        transition: "all 0.1s",
                      }}
                    >
                      <Video size={12} /> Meet
                    </button>
                  )}

                  {/* Telefon-Termin (kein Link) */}
                  {!c.meet_link && c.meeting_kind === "telefon" && (
                    <span
                      title="Termin findet telefonisch statt"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.3rem",
                        padding: "0.3rem 0.625rem",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border)",
                        background: "var(--surface-50)",
                        color: "var(--text-muted)",
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      <Phone size={12} /> Telefon
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
