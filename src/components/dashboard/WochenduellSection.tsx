import { Crown, History, Trophy, Utensils } from "lucide-react";
import {
  DUEL_GOAL_COLOR, WeeklyDuelChart, type DuelSeries, type WeeklyDuelPoint,
} from "@/components/DashboardCharts";
import { ownerBrandColor } from "@/lib/ownerColor";

// Wochenduell + Duell-Verlauf des Team-Dashboards.
//
// Farbdoktrin dieser Sektion (DESIGN.md §3.5/§3.8): Die Personenfarbe erscheint
// nur noch als 6px-Punkt — genau dort, wo man eine Person ueber Panel, Legende
// und Diagramm hinweg wiedererkennen muss. Frueher trug sie Avatare, Namen,
// Zahlen und Fortschrittsbalken; dadurch stand die Rangfolge in vier Farben
// gleichzeitig und die eigentlichen Zahlen gingen darin unter. Rang liest man
// jetzt aus Zahl, Krone und Untertitel — Farbe traegt sie nirgends allein.
//
// Und die Farbe, die uebrig bleibt, kommt aus der Marken-Rampe
// (`ownerBrandColor`), nicht aus den sechs freien Hues: Orange-Stufen und
// Neutraltoene halten die Personen im Diagramm auseinander, ohne dass die Seite
// in Blau/Violett/Gruen/Fuchsia gleichzeitig steht.

export type WochenduellProps = {
  roster: string[];
  weekCounts: Record<string, number>;
  weeklyGoal: number;
  historicalWeeks: { week: string; counts: Record<string, number> }[];
  winCounts: Record<string, number>;
  draws: number;
};

/**
 * Personen-Marker. Bewusst der kleinste sichtbare Traeger der Owner-Farbe:
 * er identifiziert, ohne eine Flaeche einzufaerben — und benutzt exakt die
 * Farbe, die die Person auch im Verlaufs-Chart hat.
 */
function OwnerDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      style={{
        width: 6,
        height: 6,
        flexShrink: 0,
        borderRadius: "var(--r-full)",
        background: color,
        display: "inline-block",
      }}
    />
  );
}

function DuelPanel({ owner, color, count, isLeader, isLoser, goal }: { owner: string; color: string; count: number; isLeader: boolean; isLoser: boolean; goal: number; }) {
  const progress = Math.min((count / goal) * 100, 100);
  // Ziel erreicht ist ein Zustand, kein Schmuck — der einzige Anlass fuer
  // Semantikfarbe im Panel.
  const reached = count >= goal;
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-4)", marginBottom: "var(--sp-6)" }}>
        {/* Avatar neutral: der getoente Kreis mit farbigem Ring sagte nichts,
            was die Initiale nicht schon sagt. */}
        <div style={{ width: 38, height: 38, borderRadius: "var(--r-full)", background: "var(--surface-3)", border: "1px solid var(--border-default)", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--fs-md)", fontWeight: 600, color: "var(--text-secondary)", flexShrink: 0 }}>{owner[0]}</div>
        <div>
          <div style={{ fontSize: "var(--fs-base)", fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--sp-3)" }}>
            <OwnerDot color={color} />
            {owner}
            {isLeader && <Crown size={13} color="var(--text-muted)" aria-hidden />}
          </div>
          <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--sp-2)", marginTop: 2 }}>
            {isLoser ? <>zahlt das Essen <Utensils size={11} aria-hidden /></> : isLeader ? "führt diese Woche" : "im Rennen"}
          </div>
        </div>
      </div>
      {/* Die Zahl ist das lauteste Element der Karte — und zwar bei JEDEM
          Teilnehmer. Der Letzte stand vorher in --text-subtle und war damit
          schlechter lesbar als der Erste, obwohl beide dieselbe Frage
          beantworten. */}
      <div style={{ fontSize: "var(--fs-3xl)", fontWeight: 600, letterSpacing: "var(--ls-display)", color: "var(--text-primary)", lineHeight: "var(--lh-tight)", fontVariantNumeric: "tabular-nums", marginBottom: "var(--sp-5)" }}>
        {count}<span style={{ fontSize: "var(--fs-md)", fontWeight: 500, color: "var(--text-muted)", marginLeft: 3 }}>/{goal}</span>
      </div>
      <div style={{ background: "var(--surface-3)", borderRadius: "var(--r-full)", height: 6, overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: "var(--r-full)", width: `${progress}%`, background: reached ? "var(--success)" : "var(--text-secondary)" }} />
      </div>
      <div style={{ fontSize: "var(--fs-2xs)", color: "var(--text-muted)", marginTop: "var(--sp-3)", fontVariantNumeric: "tabular-nums" }}>
        {Math.round(progress)}% · noch {Math.max(0, goal - count)} bis {goal}
      </div>
    </div>
  );
}

function VSSep() {
  // Der Trenner trug Info-Blau — eine Farbe, die hier keinen Zustand meldet.
  // Die Klasse duel-vs blendet ihn auf Mobile aus (globals.css).
  return (
    <div className="duel-vs" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-2)", flexShrink: 0 }}>
      <div style={{ width: 1, height: 24, background: "linear-gradient(to bottom, transparent, var(--border-default))" }} />
      <div style={{ fontSize: "var(--fs-2xs)", fontWeight: 500, color: "var(--text-muted)", letterSpacing: "0.1em", padding: "3px 8px", border: "1px solid var(--border-default)", borderRadius: "var(--r-full)" }}>VS</div>
      <div style={{ width: 1, height: 24, background: "linear-gradient(to bottom, var(--border-default), transparent)" }} />
    </div>
  );
}

export function WochenduellSection({
  roster: rosterNames,
  weekCounts,
  weeklyGoal,
  historicalWeeks: historicalWeeksProp,
  winCounts,
  draws,
}: WochenduellProps) {
  const roster: DuelSeries[] = rosterNames.map((name) => ({ name, color: ownerBrandColor(name) }));
  const historicalWeeks: WeeklyDuelPoint[] = historicalWeeksProp.map((w) => ({ week: w.week, values: w.counts }));

  const weekValues = rosterNames.map((n) => weekCounts[n] ?? 0);
  const maxCount   = weekValues.length > 0 ? Math.max(...weekValues) : 0;
  const minCount   = weekValues.length > 0 ? Math.min(...weekValues) : 0;
  const leadersArr = rosterNames.filter((n) => (weekCounts[n] ?? 0) === maxCount);
  const losersArr  = rosterNames.filter((n) => (weekCounts[n] ?? 0) === minCount);
  const leader: string | null = leadersArr.length === 1 ? leadersArr[0] : null;
  const loser:  string | null = losersArr.length === 1 && minCount < maxCount ? losersArr[0] : null;
  const secondCount = leader ? Math.max(0, ...rosterNames.filter((n) => n !== leader).map((n) => weekCounts[n] ?? 0)) : maxCount;
  const diff = leader ? maxCount - secondCount : 0;
  const leaderColor = leader ? roster.find((r) => r.name === leader)!.color : null;

  const winValues = rosterNames.map((n) => winCounts[n] ?? 0);
  const topWins = winValues.length > 0 ? Math.max(...winValues) : 0;
  const overallLeaders = rosterNames.filter((n) => (winCounts[n] ?? 0) === topWins);
  const secondWins = overallLeaders.length === 1
    ? Math.max(0, ...rosterNames.filter((n) => n !== overallLeaders[0]).map((n) => winCounts[n] ?? 0))
    : topWins;

  if (roster.length === 0) return null;

  return (
    <>
      {/* ══ WOCHENDUELL ══ */}
      <div className="card ember-glow" style={{ position: "relative", overflow: "hidden", padding: "var(--sp-9) var(--sp-10) var(--sp-8)" }}>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)", marginBottom: "var(--sp-8)", flexWrap: "wrap" }}>
          {/* Orange nur als Tint, nie als Vollflaeche (DESIGN.md §3.8) — das
              haelt den einen Markenfunken der Karte, ohne zu leuchten. */}
          <div style={{ width: 32, height: 32, borderRadius: "var(--r-md)", background: "var(--accent-muted)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Trophy size={16} color="var(--orange-500)" aria-hidden />
          </div>
          <div>
            <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: "var(--text-primary)", letterSpacing: "var(--ls-tight)" }}>Wochenduell — Wer bezahlt das Essen?</div>
            <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>Ziel: {weeklyGoal} DMs · Reset jeden Montag</div>
          </div>
          {leader && leaderColor && (
            <div style={{ marginLeft: "auto", background: "var(--surface-3)", border: "1px solid var(--border-default)", borderRadius: "var(--r-full)", padding: "var(--sp-2) var(--sp-5)", display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
              <OwnerDot color={leaderColor} />
              <span style={{ fontSize: "var(--fs-sm)", fontWeight: 500, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{leader} +{diff}</span>
            </div>
          )}
        </div>

        {roster.length === 2 ? (
          <div className="duel-grid" style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "var(--sp-8)", alignItems: "center" }}>
            <DuelPanel owner={roster[0].name} color={roster[0].color} count={weekCounts[roster[0].name] ?? 0} isLeader={leader === roster[0].name} isLoser={loser === roster[0].name} goal={weeklyGoal} />
            <VSSep />
            <DuelPanel owner={roster[1].name} color={roster[1].color} count={weekCounts[roster[1].name] ?? 0} isLeader={leader === roster[1].name} isLoser={loser === roster[1].name} goal={weeklyGoal} />
          </div>
        ) : (
          <div className="duel-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "var(--sp-8)", alignItems: "start" }}>
            {roster.map((r) => (
              <DuelPanel key={r.name} owner={r.name} color={r.color} count={weekCounts[r.name] ?? 0} isLeader={leader === r.name} isLoser={loser === r.name} goal={weeklyGoal} />
            ))}
          </div>
        )}

        {/* Fazit-Zeile: vorher Gold + Orange + Gruen in einem Satz. Jetzt traegt
            der Kontrast die Betonung; Gruen bleibt nur fuer „Ziel erreicht". */}
        <div style={{ marginTop: "var(--sp-6)", paddingTop: "var(--sp-5)", borderTop: "1px solid var(--border-default)", fontSize: "var(--fs-sm)", color: "var(--text-muted)", textAlign: "center" }}>
          {leader && diff > 0
            ? <>2. Platz braucht noch <span style={{ color: "var(--text-primary)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{diff} DMs</span> zum Gleichstand · </>
            : <>Gleichstand · </>}
          <span style={{ color: weeklyGoal - maxCount > 0 ? "var(--text-primary)" : "var(--success-fg)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {weeklyGoal - maxCount > 0 ? `${weeklyGoal - maxCount} bis zur ${weeklyGoal}er-Marke` : `${weeklyGoal}er-Marke erreicht!`}
          </span>
        </div>
      </div>

      {/* ══ DUELL-VERLAUF ══ */}
      <div className="card" style={{ padding: "var(--sp-7) var(--sp-8)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", marginBottom: "var(--sp-6)", flexWrap: "wrap" }}>
          <History size={14} color="var(--text-muted)" aria-hidden />
          <span style={{ fontSize: "var(--fs-base)", fontWeight: 600, color: "var(--text-primary)", letterSpacing: "var(--ls-tight)" }}>Duell-Verlauf letzte 10 Wochen</span>
          {/* Legende: hier IST die Farbe die Information — sie ist der einzige
              Schluessel zu den Balken. Die Ziel-Linie traegt denselben Neutralton,
              in dem das Chart sie zeichnet (DUEL_GOAL_COLOR in DashboardCharts):
              Gold war die letzte Fremdfarbe der Seite und meldete keinen Zustand,
              den man nicht schon an der Linie selbst sieht. */}
          <div style={{ marginLeft: "auto", display: "flex", gap: "var(--sp-5)", flexWrap: "wrap" }}>
            {[...roster.map((r) => ({ label: r.name, color: r.color })), { label: `Ziel ${weeklyGoal}`, color: DUEL_GOAL_COLOR }].map((m) => (
              <div key={m.label} style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                <OwnerDot color={m.color} />
                <span style={{ fontSize: "var(--fs-2xs)", color: "var(--text-muted)" }}>{m.label}</span>
              </div>
            ))}
          </div>
        </div>
        <WeeklyDuelChart data={historicalWeeks} series={roster} goal={weeklyGoal} />
        <div style={{ display: "flex", gap: "var(--sp-6)", marginTop: "var(--sp-6)", paddingTop: "var(--sp-5)", borderTop: "1px solid var(--border-default)", flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>Siege 10 Wochen:</div>
          <div style={{ display: "flex", gap: "var(--sp-6)", flexWrap: "wrap" }}>
            {roster.map((r) => (
              <span key={r.name} style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)", fontSize: "var(--fs-sm)", fontWeight: 500, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
                <OwnerDot color={r.color} />{r.name} {winCounts[r.name] ?? 0}W
              </span>
            ))}
            {draws > 0 && <span style={{ fontSize: "var(--fs-sm)", fontWeight: 500, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{draws}×Unentschieden</span>}
          </div>
          <div style={{ marginLeft: "auto", fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
            {overallLeaders.length === 1 ? `${overallLeaders[0]} führt (+${topWins - secondWins})` : "Gleichstand"}
          </div>
        </div>
      </div>
    </>
  );
}
