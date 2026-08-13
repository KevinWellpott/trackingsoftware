import { getTargets } from "@/app/actions/targets";
import { getAccessContext, listDataViewUsers } from "@/lib/access";
import { addDaysISO, localDateISO } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { resolveTarget } from "@/lib/targets";
import { ownerColor } from "@/lib/ownerColor";
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

// Icons tragen keine Semantik mehr. Sechs verschieden eingefaerbte Icons in
// einer Reihe sind keine Information, sondern ein Muster — welcher Wert wichtig
// ist, entscheidet ohnehin der Kontext, nicht die Farbe des Piktogramms.
function MiniStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-3)",
          color: "var(--text-muted)",
          marginBottom: "var(--sp-3)",
        }}
      >
        {icon}
        <span
          className="eyebrow eyebrow-muted"
          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {label}
        </span>
      </div>
      <div className="kpi-value" style={{ fontSize: "var(--fs-lg)" }}>
        {value.toLocaleString("de-DE")}
      </div>
    </div>
  );
}

// Der Balken ist neutral, solange das Ziel offen ist, und wird erst gruen,
// wenn es erreicht ist. Vorher lief er in der Personenfarbe — damit sagte die
// Farbe „wer", obwohl die Frage „wie weit" lautet.
function GoalBar({
  label,
  value,
  target,
}: {
  label: string;
  value: number;
  target: number;
}) {
  const pct = target > 0 ? Math.min((value / target) * 100, 100) : 0;
  const reached = target > 0 && value >= target;
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "var(--fs-xs)",
          marginBottom: "var(--sp-3)",
        }}
      >
        <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>{label}</span>
        <span
          className="tnum"
          style={{ fontWeight: 500, color: reached ? "var(--success-fg)" : "var(--text-secondary)" }}
        >
          {value.toLocaleString("de-DE")} / {target.toLocaleString("de-DE")}
        </span>
      </div>
      <div className="progress-track" style={{ height: 4 }}>
        <div
          className="progress-fill"
          style={{ width: `${pct}%`, background: reached ? "var(--success)" : "var(--text-disabled)" }}
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
    <div className="card" style={{ overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "var(--sp-4)",
          padding: "var(--sp-6) var(--sp-8)",
          borderBottom: "1px solid var(--border-default)",
        }}
      >
        <Headphones size={16} color="var(--text-muted)" />
        <span
          style={{
            fontWeight: 600,
            fontSize: "var(--fs-md)",
            letterSpacing: "var(--ls-tight)",
            color: "var(--text-primary)",
          }}
        >
          Telefon-Performance
        </span>
        <span className="eyebrow eyebrow-muted" style={{ marginLeft: "auto" }}>
          Letzte 30 Tage
        </span>
      </div>

      {rows30.length === 0 ? (
        <p style={{ fontSize: "var(--fs-base)", color: "var(--text-secondary)", textAlign: "center", padding: "var(--sp-11) var(--sp-6)" }}>
          Noch keine Anrufe erfasst. Importiere eine CSV-Liste und starte den Call-Mode.
        </p>
      ) : (
        <>
          {/* Global total strip */}
          <div
            className="grid-6-stat"
            style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", borderBottom: "1px solid var(--border-default)" }}
          >
            {/* Die Kennzahl-Zeile bleibt farblich ruhig: nur das Icon traegt
                den Kanal-/Semantikton, die Zahl bleibt --text-primary. */}
            {[
              { label: "Anrufe", value: totals.calls, icon: <Phone size={12} /> },
              { label: "Gatekeeper", value: totals.gatekeeper_reached, icon: <Shield size={12} /> },
              { label: "Entscheider", value: totals.decider_reached, icon: <UserCheck size={12} /> },
              { label: "Termine", value: totals.appointments, icon: <Calendar size={12} /> },
              { label: "Rückrufe", value: totals.callbacks, icon: <PhoneMissed size={12} /> },
              { label: "Dead", value: totals.dead, icon: <PhoneOff size={12} /> },
            ].map((s) => (
              <div key={s.label} className="stat-strip-cell" style={{ padding: "var(--sp-6) var(--sp-7)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", marginBottom: "var(--sp-3)", color: "var(--text-muted)" }}>
                  {s.icon}
                  <span className="eyebrow eyebrow-muted">{s.label}</span>
                </div>
                <div className="kpi-value" style={{ fontSize: "var(--fs-xl)" }}>
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
              gap: "var(--sp-6)",
              padding: "var(--sp-7) var(--sp-8)",
            }}
          >
            {rows30.map((r) => {
              const { fg: color, bg: colorBg } = ownerColor(r.owner_name);
              const week = weekByOwner[r.owner_name];
              const userId = userIdByName[r.owner_name] ?? "";
              const callsTarget = resolveTarget(targets, userId, "telefon", "weekly", "calls");
              const apptTarget = resolveTarget(targets, userId, "telefon", "weekly", "appointments");
              return (
                <div
                  key={r.owner_name}
                  style={{
                    background: "var(--surface-1)",
                    border: "1px solid var(--border-default)",
                    borderRadius: "var(--r-md)",
                    padding: "var(--sp-6) var(--sp-7)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", marginBottom: "var(--sp-6)" }}>
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: "var(--r-full)",
                        background: colorBg,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "var(--fs-xs)",
                        fontWeight: 600,
                        color,
                        flexShrink: 0,
                      }}
                    >
                      {r.owner_name.charAt(0).toUpperCase()}
                    </div>
                    <span style={{ fontWeight: 500, fontSize: "var(--fs-base)", color: "var(--text-primary)" }}>{r.owner_name}</span>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--sp-6)", marginBottom: "var(--sp-7)" }}>
                    <MiniStat icon={<Phone size={12} />} label="Anrufe" value={r.calls} />
                    <MiniStat icon={<Shield size={12} />} label="Gatekeeper" value={r.gatekeeper_reached} />
                    <MiniStat icon={<UserCheck size={12} />} label="Entscheider" value={r.decider_reached} />
                    <MiniStat icon={<Calendar size={12} />} label="Termine" value={r.appointments} />
                    <MiniStat icon={<PhoneMissed size={12} />} label="Rückrufe" value={r.callbacks} />
                    <MiniStat icon={<PhoneOff size={12} />} label="Dead" value={r.dead} />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
                    <GoalBar label="Anrufe diese Woche" value={week?.calls ?? 0} target={callsTarget} />
                    <GoalBar label="Termine diese Woche" value={week?.appointments ?? 0} target={apptTarget} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Owner comparison bars */}
          {rows30.length > 1 && (
            <div style={{ padding: "0 var(--sp-8) var(--sp-8)" }}>
              <div className="eyebrow eyebrow-muted" style={{ marginBottom: "var(--sp-5)" }}>
                Anrufe im Vergleich · 30 Tage
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
                {[...rows30]
                  .sort((a, b) => b.calls - a.calls)
                  .map((r) => {
                    const color = ownerColor(r.owner_name).fg;
                    return (
                      <div key={r.owner_name} style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)" }}>
                        <span
                          style={{
                            width: 110,
                            flexShrink: 0,
                            fontSize: "var(--fs-sm)",
                            color: "var(--text-secondary)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.owner_name}
                        </span>
                        <div className="progress-track" style={{ flex: 1, height: 8 }}>
                          <div
                            className="progress-fill"
                            style={{ width: `${(r.calls / maxCalls) * 100}%`, background: color }}
                          />
                        </div>
                        <span
                          className="tnum"
                          style={{ width: 48, textAlign: "right", fontSize: "var(--fs-sm)", fontWeight: 500, color: "var(--text-primary)" }}
                        >
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
