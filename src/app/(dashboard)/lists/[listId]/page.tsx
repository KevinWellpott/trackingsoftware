import { ArchiveListButton } from "@/components/ArchiveListButton";
import { DeleteListButton } from "@/components/DeleteListButton";
import { ListBoardV2 } from "@/components/ListBoardV2";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { getAccessContext, ownScopeFilter } from "@/lib/access";
import { updateListPitchForm } from "@/app/actions/lists";
import { MultiMetricBarChart, AnswerDonutChart, type MultiMetricDay } from "@/components/DashboardCharts";
import { StatTile } from "@/components/dashboard/StatTile";
import type { ContactWithStage, PipelineStage, PitchList } from "@/lib/types";
import { addDaysISO, localDateISO } from "@/lib/dates";
import { AlertTriangle, ArrowLeft, ArrowRight, Bell, Calendar, CalendarCheck, CheckCircle, FileText, MessageCircle, MessageSquare, TrendingUp } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

function pct(n: number, t: number) { return t === 0 ? 0 : Math.round((n / t) * 1000) / 10; }

export default async function ListDetailPage({ params }: { params: Promise<{ listId: string }> }) {
  const { listId } = await params;
  const access = await getAccessContext();
  if (!access) notFound();

  const supabase = await createClient();

  let listQuery = supabase
    .from("lists")
    .select("*")
    .eq("id", listId)
    .eq("workspace_id", access.workspace_id);
  const ownScope = ownScopeFilter(access);
  if (ownScope) {
    listQuery = listQuery.or(ownScope);
  }
  const { data: list, error: le } = await listQuery.single();
  if (le || !list) notFound();

  const { data: stages } = await supabase.from("pipeline_stages").select("*").eq("list_id", listId).order("sort_order");
  const rawContacts = await fetchAllRows((from, to) =>
    supabase
      .from("contacts")
      .select("*, pipeline_stages (*)")
      .eq("list_id", listId)
      .order("pitched_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to)
  );

  const contacts = (rawContacts ?? []) as unknown as ContactWithStage[];
  const L = list as PitchList;
  const today = localDateISO();

  // ── Analytics ───────────────────────────────────────────────
  const total = contacts.length;
  const answered = contacts.filter((c) => c.answered === true).length;
  const appts = contacts.filter((c) => c.appointment_set === true).length;
  // Offen = fällig. Ein Follow-up, dessen Wiedervorlage noch in der Zukunft liegt,
  // ist erledigt, nicht offen. Gleiche Bedingung wie im nachfassen_tasks-RPC,
  // sonst widersprechen sich Listen-Kachel und Nachfassen-Board.
  const openFU = contacts.filter((c) =>
    c.next_follow_up_at != null &&
    c.next_follow_up_at <= today &&
    c.answered !== true && c.appointment_set !== true && c.follow_up_number !== 3
  ).length;

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

  const answeredOnly = contacts.filter((c) => c.answered === true && c.appointment_set !== true).length;
  const donutData = [
    { name: "Termine", value: appts, color: "var(--brand-500)" },
    { name: "Beantwortet", value: answeredOnly, color: "var(--color-success-text)" },
    { name: "Offen", value: total - appts - answeredOnly, color: "var(--surface-300)" },
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

  const insightStyles: Record<"success" | "warning" | "tip", { color: string; bg: string; border: string }> = {
    success: { color: "var(--color-success-text)", bg: "var(--color-success-bg)", border: "var(--color-success-border)" },
    warning: { color: "var(--color-warning-text)", bg: "var(--color-warning-bg)", border: "var(--color-warning-border)" },
    tip: { color: "var(--brand-500)", bg: "var(--brand-50)", border: "var(--brand-200)" },
  };

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: "1.5rem" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", fontSize: "0.8125rem", color: "var(--text-subtle)", textDecoration: "none", marginBottom: "0.875rem" }}>
          <ArrowLeft size={13} /> Dashboard
        </Link>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginBottom: "0.25rem" }}>
              {L.owner_name && (
                <span style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: L.owner_name === "Kevin" ? "var(--brand-500)" : "var(--color-success-text)", background: L.owner_name === "Kevin" ? "var(--brand-50)" : "var(--color-success-bg)", border: `1px solid ${L.owner_name === "Kevin" ? "var(--brand-200)" : "var(--color-success-border)"}`, padding: "2px 8px", borderRadius: 99 }}>
                  {L.owner_name}
                </span>
              )}
              {L.archived_at && <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--color-warning-text)", background: "var(--color-warning-bg)", border: "1px solid var(--color-warning-border)", padding: "2px 8px", borderRadius: 99 }}>Archiviert</span>}
            </div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.03em", margin: 0 }}>{L.name}</h1>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            {!L.archived_at && <ArchiveListButton listId={listId} />}
            <DeleteListButton listId={listId} listName={L.name} contactCount={total} />
          </div>
        </div>
      </div>

      {/* ── Analytics ── */}
      {total > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem", marginBottom: "1.25rem" }}>
          {/* KPI-Kacheln */}
          <div className="grid-6-stat" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.75rem" }}>
            <StatTile
              label="DMs"
              value={total.toLocaleString("de-DE")}
              sub="Kontakte in dieser Liste"
              icon={<MessageSquare size={14} />}
            />
            <StatTile
              label="Antwortquote"
              value={`${answerRate}%`}
              sub={`${answered.toLocaleString("de-DE")} Antworten`}
              icon={<TrendingUp size={14} />}
            />
            <StatTile
              label="Terminquote"
              value={`${apptRate}%`}
              sub={`Antwort→Termin: ${conversionRate}%`}
              icon={<CalendarCheck size={14} />}
            />
            <StatTile
              label="Termine"
              value={appts.toLocaleString("de-DE")}
              sub="eingebucht"
              tone={appts > 0 ? "success" : "neutral"}
              icon={<Calendar size={14} />}
            />
            <StatTile
              label="Offene Follow-ups"
              value={openFU.toLocaleString("de-DE")}
              sub="Nachfassen ausstehend"
              tone={openFU > 0 ? "error" : "neutral"}
              icon={<Bell size={14} />}
            />
          </div>

          {/* Charts */}
          <div className="chart-grid-2" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.75rem" }}>
            <div className="card" style={{ padding: "1.125rem 1.375rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                <span aria-hidden style={{ display: "inline-flex", color: "var(--text-subtle)", flexShrink: 0 }}>
                  <TrendingUp size={14} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-primary)" }}>Verlauf</div>
                  <div style={{ fontSize: "0.6875rem", color: "var(--text-subtle)" }}>DMs, Antworten und Termine der letzten 30 Tage</div>
                </div>
              </div>
              <MultiMetricBarChart data={chartData} />
            </div>
            <div className="card" style={{ padding: "1.125rem 1.375rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                <span aria-hidden style={{ display: "inline-flex", color: "var(--text-subtle)", flexShrink: 0 }}>
                  <MessageCircle size={14} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-primary)" }}>Antworten</div>
                  <div style={{ fontSize: "0.6875rem", color: "var(--text-subtle)" }}>Verteilung aller Kontakte</div>
                </div>
              </div>
              <AnswerDonutChart data={donutData} />
            </div>
          </div>

          {/* Insights */}
          {listInsights.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {listInsights.map((ins, i) => (
                <div key={i} style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", padding: "0.25rem 0.75rem", borderRadius: 99, background: insightStyles[ins.level].bg, border: `1px solid ${insightStyles[ins.level].border}`, fontSize: "0.75rem", color: insightStyles[ins.level].color, fontWeight: 500 }}>
                  {ins.level === "success" ? <CheckCircle size={12} /> : ins.level === "warning" ? <AlertTriangle size={12} /> : <ArrowRight size={12} />} {ins.text}
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
          <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.75rem", fontWeight: 700, color: "var(--brand-500)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.5rem" }}>
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
      <ListBoardV2 listId={listId} stages={(stages ?? []) as PipelineStage[]} contacts={contacts} />
    </div>
  );
}
