import { berlinDateISO } from "@/lib/apptTime";
import { berlinWindowIso } from "@/components/dashboard/periodWindow";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { getTargets } from "@/app/actions/targets";
import { getAccessContext, listDataViewUsers } from "@/lib/access";
import { localDateISO } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { resolveTarget } from "@/lib/targets";
import { ownerColor } from "@/lib/ownerColor";
import { dialOwnerKey, loadDialRows } from "@/lib/phoneAttemptsData";
import { TelModule } from "@/components/telefon/TelModule";
import Link from "next/link";

// Telefon-Dashboard (Server): Kennzahl-Module für Heute oder diese Woche,
// darunter je Person dieselben Zahlen samt Wochenziel (Redesign Phase 5).
//
// Jede Zahl ist ein EREIGNIS im Zeitraum. Vorher kamen Entscheider, Termine,
// Rückrufe und Dead aus rpc_phone_owner_metrics — dort ist nur `calls`
// zeitgefiltert, der Rest sind Laufzeit-Summen. „Termine diese Woche" stand
// so bei 82 statt 9 und das Wochenziel war dauerhaft „übertroffen"
// (Live-Test 26.11., P1-2).
//   · Anwahlen, Entscheider, Rückrufe, Dead: Anruf-Log (`loadDialRows`), eine
//     Zeile = ein Wählversuch. Entscheider = Snapshot `decider_reached` oder
//     Ergebnis Termin/Kein Termin (beides setzt ihn voraus, N5).
//   · Termine: im Zeitraum GELEGTE Telefon-Termine (`setting_calls.created_at`,
//     `source_type='telefon'`), Person = Zuweisung — dieselbe Definition wie
//     „Termine gelegt" auf / und /team (Entscheidung E1).
// Gatekeeper steht hier nicht mehr: Das Feld wird kaum gepflegt (N4).

type OwnerMetrics = {
  owner_name: string;
  calls: number;
  decider_reached: number;
  appointments: number;
  callbacks: number;
  dead: number;
};

export type TelefonZeitraum = "heute" | "woche";

function weekStart(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  dt.setDate(dt.getDate() + (day === 0 ? -6 : 1 - day));
  return localDateISO(dt);
}

function emptyMetrics(owner_name: string): OwnerMetrics {
  return { owner_name, calls: 0, decider_reached: 0, appointments: 0, callbacks: 0, dead: 0 };
}

// Der Balken ist neutral, solange das Ziel offen ist, und wird erst grün,
// wenn es erreicht ist. Die Farbe sagt „geschafft", nicht „wer".
function GoalBar({ label, value, target }: { label: string; value: number; target: number }) {
  const pct = target > 0 ? Math.min((value / target) * 100, 100) : 0;
  const reached = target > 0 && value >= target;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "var(--fs-xs)", marginBottom: 3 }}>
        <span style={{ color: "var(--text-muted)" }}>{label}</span>
        <span className="tnum" style={{ fontWeight: 500, color: reached ? "var(--success-fg)" : "var(--text-secondary)" }}>
          {value.toLocaleString("de-DE")} / {target.toLocaleString("de-DE")}
        </span>
      </div>
      <div className="cm-meter">
        <i data-done={reached ? "" : undefined} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export async function PhoneDashboard({ zeitraum = "heute" }: { zeitraum?: TelefonZeitraum }) {
  const access = await getAccessContext();
  if (!access) return null;

  const supabase = await createClient();
  const today = berlinDateISO(new Date().toISOString());
  const monday = weekStart(today);
  const from = zeitraum === "heute" ? today : monday;
  const effectiveUserId = access.effective_user_id ?? null;
  // Geladen wird immer die ganze Woche: Die Wochenziele je Person brauchen
  // sie auch, wenn oben „Heute" gewählt ist.
  const { startIso, endIso } = berlinWindowIso(monday, today);

  const [targets, users, dials, apptRes] = await Promise.all([
    getTargets(),
    listDataViewUsers(access.workspace_id),
    loadDialRows(
      supabase,
      access.workspace_id,
      monday,
      today,
      effectiveUserId && access.effective_username
        ? { username: access.effective_username, userId: effectiveUserId }
        : undefined,
    ),
    // Gelegte Telefon-Termine (E1). Paginiert, weil ein großes Team die
    // 1.000er-Grenze von PostgREST erreichen kann.
    fetchAllRows((f, t) => {
      let q = supabase
        .from("setting_calls")
        .select("id, created_at, assigned_user_id, created_by_user_id")
        .eq("workspace_id", access.workspace_id)
        .eq("source_type", "telefon")
        .gte("created_at", startIso)
        .lt("created_at", endIso);
      if (effectiveUserId) {
        q = q.or(
          `assigned_user_id.eq.${effectiveUserId},and(assigned_user_id.is.null,created_by_user_id.eq.${effectiveUserId})`,
        );
      }
      return q.order("id").range(f, t);
    }).catch(() => []),
  ]);

  const usernameById = new Map(users.map((u) => [u.user_id, u.username]));
  // Anzeigename je kleingeschriebenem Schlüssel — der Log trägt den Owner als
  // Freitext-Snapshot, die Termine eine user_id.
  const displayByKey = new Map(users.map((u) => [u.username.toLowerCase(), u.username]));
  const periodMap = new Map<string, OwnerMetrics>();
  const weekMap = new Map<string, OwnerMetrics>();
  const bucket = (map: Map<string, OwnerMetrics>, key: string): OwnerMetrics => {
    let m = map.get(key);
    if (!m) {
      m = emptyMetrics(displayByKey.get(key) ?? key);
      map.set(key, m);
    }
    return m;
  };

  for (const d of dials.rows) {
    const key = dialOwnerKey(d, usernameById);
    if (!key) continue;
    const targetsFor = d.day >= from ? [bucket(periodMap, key), bucket(weekMap, key)] : [bucket(weekMap, key)];
    for (const m of targetsFor) {
      m.calls += 1;
      if (d.decider_reached || d.outcome === "termin" || d.outcome === "kein_termin") m.decider_reached += 1;
      if (d.outcome === "rueckruf") m.callbacks += 1;
      if (d.outcome === "dead") m.dead += 1;
    }
  }
  for (const r of apptRes as { created_at: string; assigned_user_id: string | null; created_by_user_id: string | null }[]) {
    const uid = r.assigned_user_id ?? r.created_by_user_id;
    const name = uid ? usernameById.get(uid) : undefined;
    if (!name) continue;
    const key = name.toLowerCase();
    bucket(weekMap, key).appointments += 1;
    if (berlinDateISO(r.created_at) >= from) bucket(periodMap, key).appointments += 1;
  }

  // Personen mit Aktivität in der Woche — an einem stillen Tag bleibt die
  // Zeile mit ihrem Wochenziel trotzdem stehen.
  const rows = [...weekMap.entries()]
    .map(([key, w]) => periodMap.get(key) ?? emptyMetrics(w.owner_name))
    .sort((a, b) => b.calls - a.calls || a.owner_name.localeCompare(b.owner_name, "de"));
  const weekByOwner: Record<string, OwnerMetrics> = {};
  for (const r of weekMap.values()) weekByOwner[r.owner_name] = r;

  const userIdByName: Record<string, string> = {};
  for (const u of users) userIdByName[u.username] = u.user_id;

  const totals = rows.reduce(
    (acc, r) => ({
      calls: acc.calls + r.calls,
      decider_reached: acc.decider_reached + r.decider_reached,
      appointments: acc.appointments + r.appointments,
      callbacks: acc.callbacks + r.callbacks,
      dead: acc.dead + r.dead,
    }),
    { calls: 0, decider_reached: 0, appointments: 0, callbacks: 0, dead: 0 },
  );

  // Ziel nur, wenn genau EINE Person gemeint ist (Datensicht oder eigene
  // Sicht) — eine Teamsumme gegen ein persönliches Ziel wäre keine Aussage.
  const zielPerson = effectiveUserId ?? (access.data_scope === "own" ? access.user.id : null);
  const period = zeitraum === "heute" ? "daily" : "weekly";
  const callsZiel = zielPerson ? resolveTarget(targets, zielPerson, "telefon", period, "calls") : 0;
  const apptZiel = zielPerson ? resolveTarget(targets, zielPerson, "telefon", period, "appointments") : 0;
  const anteil = (z: number, n: number) => (n > 0 ? `${Math.round((z / n) * 100)} % der Anwahlen` : "noch keine Anwahl");
  const wort = zeitraum === "heute" ? "heute" : "diese Woche";

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      <div className="tel-sec-head">
        <h2>Telefon-Performance</h2>
        <nav className="tel-seg" aria-label="Zeitraum">
          <Link href="/telefon" aria-current={zeitraum === "heute" ? "page" : undefined} scroll={false}>
            Heute
          </Link>
          <Link href="/telefon?zeitraum=woche" aria-current={zeitraum === "woche" ? "page" : undefined} scroll={false}>
            Woche
          </Link>
        </nav>
      </div>

      {!dials.available && (
        <p className="tel-note">Das Anruf-Log ist gerade nicht lesbar — Anwahlen, Entscheider, Rückrufe und Tot fehlen.</p>
      )}

      <div className="tel-mods" style={{ ["--n" as string]: 5 }}>
        <TelModule
          label={`Anwahlen ${wort}`}
          value={totals.calls.toLocaleString("de-DE")}
          unit={callsZiel > 0 ? `von ${callsZiel.toLocaleString("de-DE")}` : undefined}
          meter={callsZiel > 0 ? (totals.calls / callsZiel) * 100 : null}
          caption="jeder Wählversuch zählt"
        />
        <TelModule
          label="Entscheider erreicht"
          value={totals.decider_reached.toLocaleString("de-DE")}
          caption={anteil(totals.decider_reached, totals.calls)}
        />
        <TelModule
          label="Termine gelegt"
          value={totals.appointments.toLocaleString("de-DE")}
          unit={apptZiel > 0 ? `von ${apptZiel.toLocaleString("de-DE")}` : undefined}
          meter={apptZiel > 0 ? (totals.appointments / apptZiel) * 100 : null}
          caption="Telefon-Termine nach Buchungstag"
        />
        <TelModule label="Rückrufe vereinbart" value={totals.callbacks.toLocaleString("de-DE")} caption={`Ergebnis „Rückruf“ ${wort}`} />
        <TelModule label="Tot" value={totals.dead.toLocaleString("de-DE")} caption="das Recycling holt sie später wieder" />
      </div>

      {rows.length > 0 && (
        <div className="card tel-card">
          <header className="tel-card-head">
            <h3>Je Person</h3>
            <span className="tel-meta">{zeitraum === "heute" ? "Zahlen von heute" : "Zahlen dieser Woche"} · rechts das Wochenziel</span>
          </header>
          <div className="tel-tw">
            <table className="tel-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th className="r">Anwahlen</th>
                  <th className="r">Entscheider</th>
                  <th className="r">Termine gelegt</th>
                  <th className="r">Rückrufe</th>
                  <th className="r">Tot</th>
                  <th style={{ minWidth: 220 }}>Woche</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const { fg: color, bg: colorBg } = ownerColor(r.owner_name);
                  const week = weekByOwner[r.owner_name];
                  const userId = userIdByName[r.owner_name] ?? "";
                  const callsTarget = resolveTarget(targets, userId, "telefon", "weekly", "calls");
                  const apptTarget = resolveTarget(targets, userId, "telefon", "weekly", "appointments");
                  return (
                    <tr key={r.owner_name}>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <span className="tel-avatar" style={{ color, background: colorBg }}>
                            {r.owner_name.charAt(0).toUpperCase()}
                          </span>
                          <span className="tel-nm">{r.owner_name}</span>
                        </span>
                      </td>
                      <td className="r tnum">{r.calls.toLocaleString("de-DE")}</td>
                      <td className="r tnum">{r.decider_reached.toLocaleString("de-DE")}</td>
                      <td className="r tnum">{r.appointments.toLocaleString("de-DE")}</td>
                      <td className="r tnum tel-muted">{r.callbacks.toLocaleString("de-DE")}</td>
                      <td className="r tnum tel-muted">{r.dead.toLocaleString("de-DE")}</td>
                      <td>
                        <div style={{ display: "grid", gap: 6 }}>
                          <GoalBar label="Anwahlen diese Woche" value={week?.calls ?? 0} target={callsTarget} />
                          <GoalBar label="Termine gelegt diese Woche" value={week?.appointments ?? 0} target={apptTarget} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
