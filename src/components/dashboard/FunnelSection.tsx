import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { addDaysISO, localDateISO } from "@/lib/dates";
import type { AccessContext } from "@/lib/access";
import { ownerColor, ownerInitials } from "@/lib/ownerColor";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Filter, Phone } from "lucide-react";

// Funnel-Übersicht fürs Home-Dashboard (Server): Telefon (Woche, RPC) →
// Setting/Closing-Statuszahlen (Head-Counts) → Umsatz (gewonnene Deals).
// Rein additiv — greift keine bestehenden Dashboard-Berechnungen an.

type PhoneOwnerRow = {
  owner_name: string | null;
  calls: number | string | null;
  gatekeeper_reached: number | string | null;
  decider_reached: number | string | null;
  appointments: number | string | null;
  callbacks: number | string | null;
  dead: number | string | null;
};

type PhoneOwner = { owner_name: string; calls: number; appointments: number };

const SETTING_STATUSES = ["offen", "qualifiziert", "closing_gelegt", "disqualifiziert", "dead"] as const;
const CLOSING_STATUSES = ["offen", "gewonnen", "verloren", "nachfassen"] as const;

const SETTING_LABELS: Record<(typeof SETTING_STATUSES)[number], { label: string; tone: BadgeTone }> = {
  offen: { label: "Offen", tone: "info" },
  qualifiziert: { label: "Qualifiziert", tone: "success" },
  closing_gelegt: { label: "Closing gelegt", tone: "brand" },
  disqualifiziert: { label: "Disqualifiziert", tone: "error" },
  dead: { label: "Dead", tone: "error" },
};

const CLOSING_LABELS: Record<(typeof CLOSING_STATUSES)[number], { label: string; tone: BadgeTone }> = {
  offen: { label: "Offen", tone: "info" },
  gewonnen: { label: "Gewonnen", tone: "success" },
  verloren: { label: "Verloren", tone: "error" },
  nachfassen: { label: "Nachfassen", tone: "warning" },
};

/** Montag der laufenden Woche (identisch zur Logik im PhoneDashboard). */
function weekStart(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  dt.setDate(dt.getDate() + (day === 0 ? -6 : 1 - day));
  return localDateISO(dt);
}

function getISOWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const jan4 = new Date(dt.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  return Math.floor((dt.getTime() - startOfWeek1.getTime()) / (7 * 86400000)) + 1;
}

const EUR = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

function CardHeader({ href, title, meta }: { href: string; title: string; meta?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.875rem", flexWrap: "wrap" }}>
      <Link
        href={href}
        style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.375rem" }}
      >
        {title}
        <span style={{ color: "var(--text-subtle)", fontWeight: 500, fontSize: "0.75rem" }}>→</span>
      </Link>
      {meta && <span style={{ marginLeft: "auto", fontSize: "0.6875rem", color: "var(--text-subtle)" }}>{meta}</span>}
    </div>
  );
}

function StatusRow({ label, tone, count }: { label: string; tone: BadgeTone; count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <Badge tone={tone}>{label}</Badge>
      <span style={{ marginLeft: "auto", fontSize: "0.875rem", fontWeight: 800, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
        {count.toLocaleString("de-DE")}
      </span>
    </div>
  );
}

export async function FunnelSection({ access }: { access: AccessContext }) {
  const supabase = await createClient();
  const today = localDateISO();
  const monday = weekStart(today);
  const effectiveUserId = access.effective_user_id ?? null;

  const countByStatus = (table: "setting_calls" | "closing_calls", status: string) => {
    let q = supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", access.workspace_id)
      .eq("status", status);
    if (effectiveUserId) q = q.eq("created_by_user_id", effectiveUserId);
    return q;
  };

  let wonDealsQuery = supabase
    .from("closing_calls")
    .select("deal_volume")
    .eq("workspace_id", access.workspace_id)
    .eq("status", "gewonnen");
  if (effectiveUserId) wonDealsQuery = wonDealsQuery.eq("created_by_user_id", effectiveUserId);

  const [phoneRes, settingRes, closingRes, wonDealsRes] = await Promise.all([
    supabase.rpc("rpc_phone_owner_metrics", {
      p_workspace_id: access.workspace_id,
      p_from: monday,
      p_to: today,
      p_effective_user_id: effectiveUserId,
    }),
    Promise.all(SETTING_STATUSES.map((s) => countByStatus("setting_calls", s))),
    Promise.all(CLOSING_STATUSES.map((s) => countByStatus("closing_calls", s))),
    wonDealsQuery,
  ]);

  // RPC-Fehler oder leere Daten → als 0 behandeln, Sektion bleibt sichtbar.
  const phoneOwners: PhoneOwner[] = phoneRes.error
    ? []
    : ((phoneRes.data ?? []) as PhoneOwnerRow[]).map((r) => ({
        owner_name: (r.owner_name ?? "Ohne Zuordnung").trim() || "Ohne Zuordnung",
        calls: Number(r.calls ?? 0),
        appointments: Number(r.appointments ?? 0),
      }));

  const settingCounts: Record<(typeof SETTING_STATUSES)[number], number> = {
    offen: 0, qualifiziert: 0, closing_gelegt: 0, disqualifiziert: 0, dead: 0,
  };
  SETTING_STATUSES.forEach((s, i) => { settingCounts[s] = settingRes[i].count ?? 0; });

  const closingCounts: Record<(typeof CLOSING_STATUSES)[number], number> = {
    offen: 0, gewonnen: 0, verloren: 0, nachfassen: 0,
  };
  CLOSING_STATUSES.forEach((s, i) => { closingCounts[s] = closingRes[i].count ?? 0; });

  const settingTotal = SETTING_STATUSES.reduce((sum, s) => sum + settingCounts[s], 0);
  const weekCalls = phoneOwners.reduce((sum, o) => sum + o.calls, 0);
  const revenue = (wonDealsRes.data ?? []).reduce(
    (sum, row) => sum + Number((row as { deal_volume: number | string | null }).deal_volume ?? 0),
    0,
  );

  const kw = getISOWeek(monday);
  const sunday = addDaysISO(monday, 6);

  const stages: { label: string; sub: string; value: string; href: string; color: string }[] = [
    { label: `Anrufe KW ${kw}`, sub: "Telefon, diese Woche", value: weekCalls.toLocaleString("de-DE"), href: "/telefon", color: "var(--brand-500)" },
    { label: "Termine", sub: `Setting · ${settingCounts.offen.toLocaleString("de-DE")} offen`, value: settingTotal.toLocaleString("de-DE"), href: "/setting", color: "var(--color-info-text)" },
    { label: "Closings", sub: "offen", value: closingCounts.offen.toLocaleString("de-DE"), href: "/closing", color: "var(--color-warning-text)" },
    { label: "Gewonnen", sub: "Deals", value: closingCounts.gewonnen.toLocaleString("de-DE"), href: "/closing", color: "var(--color-success-text)" },
    { label: "Umsatz", sub: "gewonnene Deals", value: EUR.format(revenue), href: "/closing", color: "var(--color-success-text)" },
  ];

  return (
    <>
      {/* ══ SEKTION: FUNNEL ══ */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", paddingBottom: "0.125rem", borderBottom: "1px solid var(--border)" }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: "var(--surface-200)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Filter size={13} color="var(--brand-500)" />
        </div>
        <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary)" }}>Funnel</span>
        <span style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>· Telefon → Setting → Closing → Umsatz</span>
      </div>

      {/* Funnel-Pipeline */}
      <Card>
        <div style={{ display: "flex", alignItems: "stretch", gap: "0.75rem", flexWrap: "wrap" }}>
          {stages.map((s, i) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: "0.75rem", flex: "1 1 150px", minWidth: 0 }}>
              <Link href={s.href} style={{ textDecoration: "none", minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-subtle)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {s.label}
                </div>
                <div style={{ fontSize: "1.375rem", fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.2, color: s.color, whiteSpace: "nowrap" }}>
                  {s.value}
                </div>
                <div style={{ fontSize: "0.6875rem", color: "var(--text-subtle)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {s.sub}
                </div>
              </Link>
              {i < stages.length - 1 && (
                <span aria-hidden style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-subtle)", flexShrink: 0 }}>→</span>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Telefon diese Woche — pro Owner */}
      <Card>
        <CardHeader href="/telefon" title="Telefon diese Woche" meta={`${monday} → ${sunday}`} />
        {phoneOwners.length === 0 ? (
          <p style={{ fontSize: "0.8125rem", color: "var(--text-subtle)", margin: 0 }}>
            Noch keine Anrufe diese Woche erfasst.
          </p>
        ) : (
          <div style={{ display: "flex", gap: "0.625rem", flexWrap: "wrap" }}>
            {phoneOwners.map((o) => {
              const c = ownerColor(o.owner_name);
              return (
                <div
                  key={o.owner_name}
                  style={{ display: "flex", alignItems: "center", gap: "0.625rem", background: "var(--surface-50)", border: "1px solid var(--border)", borderLeft: `3px solid ${c.fg}`, borderRadius: "var(--radius-md)", padding: "0.5rem 0.875rem 0.5rem 0.625rem" }}
                >
                  <div style={{ width: 26, height: 26, borderRadius: "50%", background: c.bg, color: c.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.6875rem", fontWeight: 800, flexShrink: 0 }}>
                    {ownerInitials(o.owner_name)}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {o.owner_name}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.6875rem", color: "var(--text-subtle)", whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.2rem" }}>
                        <Phone size={10} />
                        <strong style={{ color: c.fg, fontWeight: 800 }}>{o.calls.toLocaleString("de-DE")}</strong> Anrufe
                      </span>
                      <span>
                        <strong style={{ color: "var(--color-success-text)", fontWeight: 800 }}>{o.appointments.toLocaleString("de-DE")}</strong> Termine
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Setting-/Closing-Status */}
      <div style={{ display: "flex", gap: "0.875rem", flexWrap: "wrap" }}>
        <Card style={{ flex: "1 1 280px", minWidth: 0 }}>
          <CardHeader href="/setting" title="Setting-Status" meta={`${settingTotal.toLocaleString("de-DE")} gesamt`} />
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {SETTING_STATUSES.map((s) => (
              <StatusRow key={s} label={SETTING_LABELS[s].label} tone={SETTING_LABELS[s].tone} count={settingCounts[s]} />
            ))}
          </div>
        </Card>
        <Card style={{ flex: "1 1 280px", minWidth: 0 }}>
          <CardHeader
            href="/closing"
            title="Closing-Status"
            meta={`${CLOSING_STATUSES.reduce((sum, s) => sum + closingCounts[s], 0).toLocaleString("de-DE")} gesamt`}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {CLOSING_STATUSES.map((s) => (
              <StatusRow key={s} label={CLOSING_LABELS[s].label} tone={CLOSING_LABELS[s].tone} count={closingCounts[s]} />
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.25rem", paddingTop: "0.625rem", borderTop: "1px solid var(--border)" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-subtle)" }}>Umsatz (gewonnen)</span>
              <span style={{ marginLeft: "auto", fontSize: "0.9375rem", fontWeight: 800, color: "var(--color-success-text)", fontVariantNumeric: "tabular-nums" }}>
                {EUR.format(revenue)}
              </span>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
