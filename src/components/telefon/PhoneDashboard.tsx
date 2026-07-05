import { getTargets } from "@/app/actions/targets";
import { getAccessContext, listDataViewUsers } from "@/lib/access";
import { addDaysISO, localDateISO } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { resolveTarget } from "@/lib/targets";
import { Calendar, Headphones, Phone, PhoneMissed, PhoneOff, Shield, UserCheck } from "lucide-react";

// Telefon-Dashboard (Server): Owner-Metriken der letzten 30 Tage aus
// rpc_phone_owner_metrics + Wochenziel-Fortschritt (performance_targets).

type OwnerMetrics = {
  owner_name: string;
  calls: number;
  gatekeeper_reached: number;
  decider_reached: number;
  appointments: number;
  callbacks: number;
  dead: number;
};

type RawRow = {
  owner_name: string | null;
  calls: number | string | null;
  gatekeeper_reached: number | string | null;
  decider_reached: number | string | null;
  appointments: number | string | null;
  callbacks: number | string | null;
  dead: number | string | null;
};

const OWNER_COLORS: Record<string, string> = {
  Kevin: "#6366f1",
  Simon: "#8b5cf6",
  Daniel: "#10b981",
  "Samuel Kerber": "#0ea5e9",
};
const FALLBACK_PALETTE = ["#0ea5e9", "#f59e0b", "#ec4899", "#14b8a6"];

function ownerColor(name: string, index: number): string {
  return OWNER_COLORS[name] ?? FALLBACK_PALETTE[index % FALLBACK_PALETTE.length];
}

function weekStart(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  dt.setDate(dt.getDate() + (day === 0 ? -6 : 1 - day));
  return localDateISO(dt);
}

function coerce(rows: RawRow[] | null | undefined): OwnerMetrics[] {
  return (rows ?? []).map((r) => ({
    owner_name: r.owner_name ?? "Ohne Zuordnung",
    calls: Number(r.calls ?? 0),
    gatekeeper_reached: Number(r.gatekeeper_reached ?? 0),
    decider_reached: Number(r.decider_reached ?? 0),
    appointments: Number(r.appointments ?? 0),
    callbacks: Number(r.callbacks ?? 0),
    dead: Number(r.dead ?? 0),
  }));
}

function MiniStat({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.25rem",
          color: "var(--text-subtle)",
          marginBottom: "0.2rem",
        }}
      >
        {icon}
        <span
          style={{
            fontSize: "0.625rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      </div>
      <div
        style={{
          fontSize: "1.125rem",
          fontWeight: 800,
          letterSpacing: "-0.02em",
          lineHeight: 1,
          color: color ?? "var(--text-primary)",
        }}
      >
        {value.toLocaleString("de-DE")}
      </div>
    </div>
  );
}

function GoalBar({
  label,
  value,
  target,
  color,
}: {
  label: string;
  value: number;
  target: number;
  color: string;
}) {
  const pct = target > 0 ? Math.min((value / target) * 100, 100) : 0;
  const reached = target > 0 && value >= target;
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.6875rem",
          marginBottom: "0.25rem",
        }}
      >
        <span style={{ color: "var(--text-subtle)", fontWeight: 600 }}>{label}</span>
        <span style={{ fontWeight: 700, color: reached ? "var(--color-success-text)" : "var(--text-secondary)" }}>
          {value.toLocaleString("de-DE")} / {target.toLocaleString("de-DE")}
        </span>
      </div>
      <div style={{ background: "var(--surface-200)", borderRadius: 99, height: 6, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            borderRadius: 99,
            width: `${pct}%`,
            background: reached ? "var(--color-success-text)" : color,
            transition: "width 0.4s ease",
          }}
        />
      </div>
    </div>
  );
}

export async function PhoneDashboard() {
  const access = await getAccessContext();
  if (!access) return null;

  const supabase = await createClient();
  const today = localDateISO();
  const from30 = addDaysISO(today, -29);
  const monday = weekStart(today);
  const effectiveUserId = access.effective_user_id ?? null;

  const [res30, resWeek, targets, users] = await Promise.all([
    supabase.rpc("rpc_phone_owner_metrics", {
      p_workspace_id: access.workspace_id,
      p_from: from30,
      p_to: today,
      p_effective_user_id: effectiveUserId,
    }),
    supabase.rpc("rpc_phone_owner_metrics", {
      p_workspace_id: access.workspace_id,
      p_from: monday,
      p_to: today,
      p_effective_user_id: effectiveUserId,
    }),
    getTargets(),
    listDataViewUsers(access.workspace_id),
  ]);

  const rows30 = coerce(res30.data as RawRow[] | null);
  const rowsWeek = coerce(resWeek.data as RawRow[] | null);
  const weekByOwner: Record<string, OwnerMetrics> = {};
  for (const r of rowsWeek) weekByOwner[r.owner_name] = r;

  const userIdByName: Record<string, string> = {};
  for (const u of users) userIdByName[u.username] = u.user_id;

  const totals = rows30.reduce(
    (acc, r) => ({
      calls: acc.calls + r.calls,
      gatekeeper_reached: acc.gatekeeper_reached + r.gatekeeper_reached,
      decider_reached: acc.decider_reached + r.decider_reached,
      appointments: acc.appointments + r.appointments,
      callbacks: acc.callbacks + r.callbacks,
      dead: acc.dead + r.dead,
    }),
    { calls: 0, gatekeeper_reached: 0, decider_reached: 0, appointments: 0, callbacks: 0, dead: 0 },
  );

  const maxCalls = Math.max(1, ...rows30.map((r) => r.calls));

  return (
    <div
      style={{
        background: "var(--surface-100)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-sm)",
        marginBottom: "1.5rem",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.875rem 1.25rem",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <Headphones size={15} color="var(--brand-500)" />
        <span style={{ fontWeight: 800, fontSize: "0.9375rem", color: "var(--text-primary)" }}>
          Telefon-Performance
        </span>
        <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--text-subtle)" }}>
          Letzte 30 Tage · {from30} → {today}
        </span>
      </div>

      {rows30.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "var(--text-subtle)", textAlign: "center", padding: "1.75rem 1rem" }}>
          Noch keine Anrufe erfasst. Importiere eine CSV-Liste und starte den Call-Mode.
        </p>
      ) : (
        <>
          {/* Global total strip */}
          <div
            className="grid-6-stat"
            style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", borderBottom: "1px solid var(--border)" }}
          >
            {[
              { label: "Anrufe", value: totals.calls, icon: <Phone size={12} />, color: "var(--brand-500)" },
              { label: "Gatekeeper", value: totals.gatekeeper_reached, icon: <Shield size={12} />, color: "var(--text-primary)" },
              { label: "Entscheider", value: totals.decider_reached, icon: <UserCheck size={12} />, color: "var(--text-primary)" },
              { label: "Termine", value: totals.appointments, icon: <Calendar size={12} />, color: "var(--color-success-text)" },
              { label: "Rückrufe", value: totals.callbacks, icon: <PhoneMissed size={12} />, color: "var(--color-warning-text)" },
              { label: "Dead", value: totals.dead, icon: <PhoneOff size={12} />, color: "var(--color-error-text)" },
            ].map((s, i) => (
              <div key={s.label} style={{ padding: "0.875rem 1rem", borderRight: i < 5 ? "1px solid var(--border)" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", marginBottom: "0.25rem", color: "var(--text-subtle)" }}>
                  {s.icon}
                  <span style={{ fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {s.label}
                  </span>
                </div>
                <div style={{ fontSize: "1.25rem", fontWeight: 800, color: s.color, lineHeight: 1, letterSpacing: "-0.02em" }}>
                  {s.value.toLocaleString("de-DE")}
                </div>
              </div>
            ))}
          </div>

          {/* Per-owner cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "0.875rem",
              padding: "1rem 1.25rem",
            }}
          >
            {rows30.map((r, i) => {
              const color = ownerColor(r.owner_name, i);
              const week = weekByOwner[r.owner_name];
              const userId = userIdByName[r.owner_name] ?? "";
              const callsTarget = resolveTarget(targets, userId, "telefon", "weekly", "calls");
              const apptTarget = resolveTarget(targets, userId, "telefon", "weekly", "appointments");
              return (
                <div
                  key={r.owner_name}
                  style={{
                    background: "var(--surface-50)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-md)",
                    padding: "0.875rem 1rem",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        background: `${color}22`,
                        border: `1.5px solid ${color}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.75rem",
                        fontWeight: 800,
                        color,
                        flexShrink: 0,
                      }}
                    >
                      {r.owner_name.charAt(0).toUpperCase()}
                    </div>
                    <span style={{ fontWeight: 700, fontSize: "0.875rem", color: "var(--text-primary)" }}>{r.owner_name}</span>
                    <span style={{ marginLeft: "auto", fontSize: "0.6875rem", color: "var(--text-subtle)" }}>30 Tage</span>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.625rem", marginBottom: "0.875rem" }}>
                    <MiniStat icon={<Phone size={11} />} label="Anrufe" value={r.calls} color={color} />
                    <MiniStat icon={<Shield size={11} />} label="Gatekeeper" value={r.gatekeeper_reached} />
                    <MiniStat icon={<UserCheck size={11} />} label="Entscheider" value={r.decider_reached} />
                    <MiniStat icon={<Calendar size={11} />} label="Termine" value={r.appointments} color="var(--color-success-text)" />
                    <MiniStat icon={<PhoneMissed size={11} />} label="Rückrufe" value={r.callbacks} color="var(--color-warning-text)" />
                    <MiniStat icon={<PhoneOff size={11} />} label="Dead" value={r.dead} color="var(--color-error-text)" />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <GoalBar label="Anrufe diese Woche" value={week?.calls ?? 0} target={callsTarget} color={color} />
                    <GoalBar
                      label="Termine diese Woche"
                      value={week?.appointments ?? 0}
                      target={apptTarget}
                      color="var(--color-success-text)"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Owner comparison bars */}
          {rows30.length > 1 && (
            <div style={{ padding: "0 1.25rem 1.125rem" }}>
              <div
                style={{
                  fontSize: "0.6875rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--text-subtle)",
                  marginBottom: "0.5rem",
                }}
              >
                Anrufe im Vergleich (30 Tage)
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                {[...rows30]
                  .sort((a, b) => b.calls - a.calls)
                  .map((r, i) => {
                    const color = ownerColor(r.owner_name, i);
                    return (
                      <div key={r.owner_name} style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                        <span
                          style={{
                            width: 110,
                            flexShrink: 0,
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            color: "var(--text-secondary)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.owner_name}
                        </span>
                        <div style={{ flex: 1, background: "var(--surface-200)", borderRadius: 99, height: 10, overflow: "hidden" }}>
                          <div
                            style={{
                              height: "100%",
                              borderRadius: 99,
                              width: `${(r.calls / maxCalls) * 100}%`,
                              background: color,
                            }}
                          />
                        </div>
                        <span style={{ width: 44, textAlign: "right", fontSize: "0.75rem", fontWeight: 800, color: "var(--text-primary)" }}>
                          {r.calls.toLocaleString("de-DE")}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
