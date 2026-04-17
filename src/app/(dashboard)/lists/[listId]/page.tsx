import { ArchiveListButton } from "@/components/ArchiveListButton";
import { DeleteListButton } from "@/components/DeleteListButton";
import { ListBoard } from "@/components/ListBoard";
import { createClient } from "@/lib/supabase/server";
import { updateListPitchForm } from "@/app/actions/lists";
import { MultiMetricBarChart, AnswerDonutChart, METRIC_COLORS, type MultiMetricDay } from "@/components/DashboardCharts";
import type { ContactWithStage, PipelineStage, PitchList } from "@/lib/types";
import { addDaysISO, localDateISO } from "@/lib/dates";
import { ArrowLeft, Calendar, CheckCircle, Clock, FileText, TrendingUp, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

function pct(n: number, t: number) { return t === 0 ? 0 : Math.round((n / t) * 100); }

export default async function ListDetailPage({ params }: { params: Promise<{ listId: string }> }) {
  const { listId } = await params;
  const supabase = await createClient();

  const { data: list, error: le } = await supabase.from("lists").select("*").eq("id", listId).single();
  if (le || !list) notFound();

  const { data: stages } = await supabase.from("pipeline_stages").select("*").eq("list_id", listId).order("sort_order");
  const { data: rawContacts } = await supabase.from("contacts").select("*, pipeline_stages (*)").eq("list_id", listId).order("pitched_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });

  const contacts = (rawContacts ?? []) as unknown as ContactWithStage[];
  const L = list as PitchList;
  const today = localDateISO();

  // ── Analytics ───────────────────────────────────────────────
  const total = contacts.length;
  const answered = contacts.filter((c) => c.answered === true).length;
  const appts = contacts.filter((c) => c.appointment_set === true).length;
  const fu1 = contacts.filter((c) => c.follow_up_number === 1).length;
  const fu2 = contacts.filter((c) => c.follow_up_number === 2).length;
  const fu3 = contacts.filter((c) => c.follow_up_number === 3).length;
  const openFU = contacts.filter((c) => c.answered !== true && c.next_follow_up_at && c.next_follow_up_at <= today && c.follow_up_number !== 3).length;

  const answerRate = pct(answered, total);
  const apptRate = pct(appts, total);
  const conversionRate = pct(appts, answered); // Antwort → Termin

  // ── Chart (letzte 30 Tage) ──────────────────────────────────
  const chartData: MultiMetricDay[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = addDaysISO(today, -i);
    const day = contacts.filter((c) => (c.pitched_at ?? c.created_at.slice(0, 10)) === d);
    chartData.push({
      date: d.slice(5),
      dms: day.length,
      answers: day.filter((c) => c.answered === true).length,
      appointments: day.filter((c) => c.appointment_set === true).length,
    });
  }

  const donutData = [
    { name: "Antwort ✓", value: answered, color: METRIC_COLORS.answers },
    { name: "Offen", value: total - answered, color: "#3f3f46" },
  ].filter((d) => d.value > 0);

  // ── Insights für diese Liste ────────────────────────────────
  const listInsights: { level: "success" | "warning" | "tip"; text: string }[] = [];
  if (total >= 10) {
    if (answerRate >= 20) listInsights.push({ level: "success", text: `Starke Antwortrate ${answerRate}% — skaliere diesen Pitch` });
    else if (answerRate < 8) listInsights.push({ level: "warning", text: `Antwortrate ${answerRate}% ist zu niedrig — Pitch-Text oder Zielgruppe überarbeiten` });
    if (answered > 0 && apptRate === 0) listInsights.push({ level: "warning", text: `${answered} Antworten, aber 0 Termine — Bridge-Nachricht optimieren` });
    if (openFU > 3) listInsights.push({ level: "tip", text: `${openFU} offene Follow-ups — jetzt abarbeiten` });
    if (conversionRate >= 20 && appts > 0) listInsights.push({ level: "success", text: `${conversionRate}% Antwort→Termin-Conversion — exzellenter Nachfassprozess` });
  } else if (total > 0) {
    listInsights.push({ level: "tip", text: `Noch ${10 - total} DMs bis zu auswertbaren Daten` });
  }

  const insightColors = { success: "#4ade80", warning: "#fbbf24", tip: "#818cf8" };

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: "1.5rem" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", fontSize: "0.8125rem", color: "#52525b", textDecoration: "none", marginBottom: "0.875rem" }}>
          <ArrowLeft size={13} /> Dashboard
        </Link>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginBottom: "0.25rem" }}>
              {L.owner_name && (
                <span style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: L.owner_name === "Kevin" ? "#818cf8" : "#a78bfa", background: L.owner_name === "Kevin" ? "rgba(99,102,241,0.12)" : "rgba(139,92,246,0.12)", border: `1px solid ${L.owner_name === "Kevin" ? "rgba(99,102,241,0.25)" : "rgba(139,92,246,0.25)"}`, padding: "2px 8px", borderRadius: 99 }}>
                  {L.owner_name}
                </span>
              )}
              {L.archived_at && <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#fbbf24", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)", padding: "2px 8px", borderRadius: 99 }}>Archiviert</span>}
            </div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#fafafa", letterSpacing: "-0.03em", margin: 0 }}>{L.name}</h1>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            {!L.archived_at && <ArchiveListButton listId={listId} />}
            <DeleteListButton listId={listId} listName={L.name} contactCount={total} />
          </div>
        </div>
      </div>

      {/* ── Analytics Strip ── */}
      {total > 0 && (
        <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", marginBottom: "1.25rem", overflow: "hidden" }}>
          {/* Stat Pills */}
          <div className="grid-6-stat" style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", borderBottom: "1px solid var(--border)" }}>
            {[
              { label: "DMs", value: total, color: METRIC_COLORS.dms, icon: <Users size={12} /> },
              { label: "Antwortrate", value: `${answerRate}%`, color: METRIC_COLORS.answers, icon: <TrendingUp size={12} /> },
              { label: "Terminrate", value: `${apptRate}%`, color: METRIC_COLORS.appointments, icon: <Calendar size={12} /> },
              { label: "→Termin", value: `${conversionRate}%`, color: METRIC_COLORS.appointments, icon: <CheckCircle size={12} />, sub: "Antwort→Termin" },
              { label: "Offene FUs", value: openFU, color: openFU > 0 ? METRIC_COLORS.followups : METRIC_COLORS.answers, icon: <Clock size={12} /> },
              { label: "FU1/2/3", value: `${fu1}/${fu2}/${fu3}`, color: "#71717a", icon: <Clock size={12} /> },
            ].map((s, i) => (
              <div key={s.label} style={{ padding: "0.875rem 1rem", borderRight: i < 5 ? "1px solid var(--border)" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", marginBottom: "0.25rem", color: "#52525b" }}>
                  {s.icon}
                  <span style={{ fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</span>
                </div>
                <div style={{ fontSize: "1.25rem", fontWeight: 800, color: s.color, lineHeight: 1, letterSpacing: "-0.02em" }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Charts row */}
          <div className="chart-grid-2" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 0 }}>
            <div style={{ padding: "1.125rem 1.375rem", borderRight: "1px solid var(--border)" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#52525b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.625rem" }}>Verlauf letzte 30 Tage</div>
              <MultiMetricBarChart data={chartData} />
            </div>
            <div style={{ padding: "1.125rem 1.375rem" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#52525b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.625rem" }}>Antworten</div>
              <AnswerDonutChart data={donutData} />
            </div>
          </div>

          {/* Insights */}
          {listInsights.length > 0 && (
            <div style={{ borderTop: "1px solid var(--border)", padding: "0.75rem 1.25rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {listInsights.map((ins, i) => (
                <div key={i} style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", padding: "0.25rem 0.75rem", borderRadius: 99, background: insightColors[ins.level] + "12", border: `1px solid ${insightColors[ins.level]}30`, fontSize: "0.75rem", color: insightColors[ins.level], fontWeight: 500 }}>
                  {ins.level === "success" ? "✓" : ins.level === "warning" ? "⚠" : "→"} {ins.text}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Pitch-Text ── */}
      <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1.125rem 1.375rem", marginBottom: "1.25rem" }}>
        <form action={updateListPitchForm}>
          <input type="hidden" name="list_id" value={listId} />
          <input type="hidden" name="name" value={L.name} />
          <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.75rem", fontWeight: 700, color: "#818cf8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.5rem" }}>
            <FileText size={13} /> Pitch-Text
          </label>
          <textarea
            name="pitch_text"
            defaultValue={L.pitch_text ?? ""}
            rows={3}
            className="input"
            style={{ resize: "vertical", fontSize: "0.875rem", marginBottom: "0.5rem" }}
            placeholder="Füge hier die LinkedIn-Nachricht ein, damit du Performance je Pitch-Text tracken kannst."
          />
          <button type="submit" className="btn-secondary" style={{ fontSize: "0.8125rem" }}>Speichern</button>
        </form>
      </div>

      {/* ── Kontakt-Tabelle ── */}
      <ListBoard listId={listId} stages={(stages ?? []) as PipelineStage[]} contacts={contacts} />
    </div>
  );
}
