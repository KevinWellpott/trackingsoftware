import { ArchiveListButton } from "@/components/ArchiveListButton";
import { DeleteListButton } from "@/components/DeleteListButton";
import { ListBoardV2 } from "@/components/ListBoardV2";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { getAccessContext, ownScopeFilter } from "@/lib/access";
import { updateListPitchForm } from "@/app/actions/lists";
import { MultiMetricBarChart, AnswerDonutChart, type MultiMetricDay } from "@/components/DashboardCharts";
import { StatTile } from "@/components/dashboard/StatTile";
import { LIST_CONTACT_COLUMNS, type ListContact, type PitchList } from "@/lib/types";
import { addDaysISO, localDateISO } from "@/lib/dates";
import { VIZ_NEUTRAL } from "@/lib/viz";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/PageHeader";
import { Bell, Calendar, CalendarCheck, ChevronRight, FileText, MessageCircle, MessageSquare, TrendingUp } from "lucide-react";
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

  // Nur die Spalten laden, die Board + Kacheln wirklich brauchen — der frühere
  // "*, pipeline_stages (*)"-Join hat den Payload bei großen Listen vervielfacht.
  const rawContacts = await fetchAllRows((from, to) =>
    supabase
      .from("contacts")
      .select(LIST_CONTACT_COLUMNS)
      .eq("list_id", listId)
      .order("pitched_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to)
  );

  const contacts = (rawContacts ?? []) as unknown as ListContact[];
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
    c.answered !== true && c.appointment_set !== true && c.follow_up_number !== 3 &&
    c.blocked_at == null
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
  // Drei sich ausschliessende Buckets ueber ALLE Kontakte der Liste:
  // Antwort (ohne Termin) · keine Antwort · terminiert. „Keine Antwort" ist
  // die Abwesenheit eines Ergebnisses und bleibt deshalb neutral — aber im
  // Mittelgrau der divergierenden Rampe, nicht in einer Surface-Farbe: auf
  // #151519 war der alte Ton praktisch unsichtbar.
  const donutData = [
    { name: "Antwort", value: answeredOnly, color: "var(--viz-2)" },
    { name: "Keine Antwort", value: total - appts - answeredOnly, color: VIZ_NEUTRAL },
    { name: "Terminiert", value: appts, color: "var(--viz-3)" },
  ].filter((d) => d.value > 0);

  // Pitch-Sequenz: standardmäßig zu, solange etwas hinterlegt ist — sonst offen,
  // damit ein leerer Pitch-Text nicht unsichtbar bleibt.
  const fuFilled = [L.fu1_text, L.fu2_text, L.fu3_text].filter((t) => (t ?? "").trim() !== "").length;
  const sequenceEmpty = !(L.pitch_text ?? "").trim() && fuFilled === 0;

  const fieldLabel: React.CSSProperties = {
    display: "block",
    fontSize: "var(--fs-xs)",
    fontWeight: 500,
    color: "var(--text-secondary)",
    marginBottom: "var(--sp-3)",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      {/* ── Header ── */}
      <BackLink href="/" label="Dashboard" />
      <PageHeader
        eyebrow="LinkedIn-Liste"
        title={L.name}
        meta={
          // Kein Owner-Badge: die Sidebar zeigt ohnehin nur die eigenen
          // Listen, die Zuordnung ist damit redundant.
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap" }}>
            {L.archived_at && <span className="badge badge-amber">Archiviert</span>}
            <span className="tnum">{total.toLocaleString("de-DE")} Kontakte</span>
          </span>
        }
        actions={
          <>
            {!L.archived_at && <ArchiveListButton listId={listId} />}
            <DeleteListButton listId={listId} listName={L.name} contactCount={total} />
          </>
        }
      />

      {/* ── Analytics ── */}
      {total > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
          {/* KPI-Kacheln */}
          <div className="grid-6-stat" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "var(--sp-6)" }}>
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
            {/* Diese beiden Kacheln sind durchgefaerbt: Gruen = erreicht,
                Rot = zu tun. Das Label bleibt sichtbar, Farbe traegt die
                Bedeutung also nicht allein. */}
            <StatTile
              label="Termine"
              value={appts.toLocaleString("de-DE")}
              sub="gelegt"
              tone="success"
              filled
              icon={<Calendar size={14} />}
            />
            <StatTile
              label="Offene Follow-ups"
              value={openFU.toLocaleString("de-DE")}
              sub="ausstehend"
              tone="error"
              filled
              icon={<Bell size={14} />}
            />
          </div>

          {/* ── Verlauf: beide Graphen einklappbar, standardmaessig zu ──
              Gleiches <details>-Muster wie die Pitch-Sequenz: kein Client-JS,
              damit die Seite eine Server Component bleibt. */}
          <details className="card">
            <summary
              className="collapse-summary"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-4)",
                padding: "var(--sp-6) var(--sp-8)",
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <ChevronRight size={14} className="collapse-chevron" style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <TrendingUp size={14} style={{ color: "var(--orange-500)", flexShrink: 0 }} />
              <span className="eyebrow">Verlauf</span>
              <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", marginLeft: "auto", whiteSpace: "nowrap" }}>
                Letzte 30 Tage · Antwortverteilung
              </span>
            </summary>

            <div
              className="chart-grid-2"
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr",
                gap: "var(--sp-9)",
                padding: "0 var(--sp-8) var(--sp-8)",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", marginBottom: "var(--sp-6)" }}>
                  <TrendingUp size={16} aria-hidden style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, letterSpacing: "var(--ls-tight)", color: "var(--text-primary)" }}>
                      Verlauf
                    </div>
                    <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>Letzte 30 Tage</div>
                  </div>
                </div>
                <MultiMetricBarChart data={chartData} />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", marginBottom: "var(--sp-6)" }}>
                  <MessageCircle size={16} aria-hidden style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, letterSpacing: "var(--ls-tight)", color: "var(--text-primary)" }}>
                      Antworten
                    </div>
                    <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>Verteilung aller Kontakte</div>
                  </div>
                </div>
                <AnswerDonutChart data={donutData} />
              </div>
            </div>
          </details>
        </div>
      )}

      {/* ── Pitch-Sequenz (Pitch + FU1–3), komplett einklappbar ── */}
      <details open={sequenceEmpty} className="card">
        <summary
          className="collapse-summary"
          style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", padding: "var(--sp-6) var(--sp-8)", cursor: "pointer", userSelect: "none" }}
        >
          <ChevronRight size={14} className="collapse-chevron" style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <FileText size={14} style={{ color: "var(--orange-500)", flexShrink: 0 }} />
          <span className="eyebrow">Pitch-Text &amp; Follow-ups</span>
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", marginLeft: "auto", whiteSpace: "nowrap" }}>
            {sequenceEmpty ? "noch nicht hinterlegt" : `Pitch + ${fuFilled}/3 Follow-ups`}
          </span>
        </summary>

        <form action={updateListPitchForm} style={{ padding: "0 var(--sp-8) var(--sp-8)" }}>
          <input type="hidden" name="list_id" value={listId} />
          <input type="hidden" name="name" value={L.name} />

          <label htmlFor="pitch_text" style={fieldLabel}>Pitch-Text</label>
          <textarea
            id="pitch_text"
            name="pitch_text"
            defaultValue={L.pitch_text ?? ""}
            rows={3}
            className="input"
            style={{ resize: "vertical", fontSize: "var(--fs-base)", marginBottom: "var(--sp-7)", lineHeight: "var(--lh-base)", padding: "var(--sp-5)" }}
            placeholder="Füge hier die LinkedIn-Nachricht ein, damit du Performance je Pitch-Text tracken kannst."
          />

          {([1, 2, 3] as const).map((n) => (
            <div key={n}>
              <label htmlFor={`fu${n}_text`} style={fieldLabel}>
                Follow-up {n}
                <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: "var(--sp-3)" }}>
                  {n === 1 ? "+3 Tage nach Pitch" : n === 2 ? "+5 Tage nach FU1" : "+7 Tage nach FU2"}
                </span>
              </label>
              <textarea
                id={`fu${n}_text`}
                name={`fu${n}_text`}
                defaultValue={(n === 1 ? L.fu1_text : n === 2 ? L.fu2_text : L.fu3_text) ?? ""}
                rows={2}
                className="input"
                style={{ resize: "vertical", fontSize: "var(--fs-base)", marginBottom: "var(--sp-7)", lineHeight: "var(--lh-base)", padding: "var(--sp-5)" }}
                placeholder={`Nachfass-Nachricht ${n} — {name} wird durch den Vornamen ersetzt.`}
              />
            </div>
          ))}

          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)", flexWrap: "wrap" }}>
            <button type="submit" className="btn-secondary">Speichern</button>
          </div>
        </form>
      </details>

      {/* ── Kontakt-Tabelle ── */}
      <ListBoardV2 listId={listId} contacts={contacts} />
    </div>
  );
}
