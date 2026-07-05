import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { getAccessContext } from "@/lib/access";
import { localDateISO } from "@/lib/dates";
import type { PitchList } from "@/lib/types";
import { ANSWER_CATEGORIES, CATEGORY_CONFIG } from "@/lib/categories";
import Link from "next/link";
import { ArrowLeft, Download, FileText } from "lucide-react";
import { ExportForm } from "./ExportForm";

export default async function ExportPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string; to?: string; owner?: string; listIds?: string; category?: string;
  }>;
}) {
  const access = await getAccessContext();
  if (!access) return null;

  const supabase = await createClient();
  const q = await searchParams;
  const today = localDateISO();

  let listsQuery = supabase
    .from("lists")
    .select("id, name, owner_name, archived_at")
    .eq("workspace_id", access.workspace_id)
    .order("sort_order");
  if (access.effective_user_id) {
    listsQuery = listsQuery.eq("created_by_user_id", access.effective_user_id);
  }
  const { data: listsRaw } = await listsQuery;

  const allLists = (listsRaw ?? []) as PitchList[];

  // Current filter values
  const from     = q.from     ?? "";
  const to       = q.to       ?? today;
  const owner    = q.owner    ?? "";
  const listIds  = q.listIds  ? q.listIds.split(",").filter(Boolean) : [];
  const category = q.category ?? "";

  // Preview: count matching contacts
  const allowedListIds = allLists.map((l) => l.id);

  let countQ = supabase
    .from("contacts")
    .select("id, list_id, pitched_at, answer_category, lists!inner(owner_name)", { count: "exact", head: false });

  if (from) countQ = countQ.gte("pitched_at", from);
  countQ = countQ.lte("pitched_at", to);
  if (listIds.length > 0) countQ = countQ.in("list_id", listIds);
  else if (access.effective_user_id) countQ = countQ.in("list_id", allowedListIds.length ? allowedListIds : ["00000000-0000-0000-0000-000000000000"]);

  const { count: rawCount } = await countQ;
  void rawCount;

  // Further filter by owner + category (client-side for preview since nested filters are limited)
  const previewRaw = await fetchAllRows((rangeFrom, rangeTo) => {
    let previewQuery = supabase
      .from("contacts")
      .select("id, list_id, answered, appointment_set, answer_category, lists!inner(owner_name)")
      .gte("pitched_at", from || "2000-01-01")
      .lte("pitched_at", to);
    if (access.effective_user_id) {
      previewQuery = previewQuery.in("list_id", allowedListIds.length ? allowedListIds : ["00000000-0000-0000-0000-000000000000"]);
    }
    return previewQuery.order("id", { ascending: true }).range(rangeFrom, rangeTo);
  });

  type PR = { id: string; list_id: string; answered: boolean | null; appointment_set: boolean | null; answer_category: string | null; lists: { owner_name: string | null } | null };
  let preview = (previewRaw ?? []) as unknown as PR[];
  if (listIds.length > 0) preview = preview.filter((r) => listIds.includes(r.list_id));
  if (owner) preview = preview.filter((r) => r.lists?.owner_name === owner);
  if (category) preview = preview.filter((r) => r.answer_category === category);

  const count = preview.length;
  const answered = preview.filter((r) => r.answered === true).length;
  const appts = preview.filter((r) => r.appointment_set === true).length;

  // Build export URL
  const exportParams = new URLSearchParams();
  if (from) exportParams.set("from", from);
  if (to) exportParams.set("to", to);
  if (owner) exportParams.set("owner", owner);
  if (listIds.length > 0) exportParams.set("listIds", listIds.join(","));
  if (category) exportParams.set("category", category);
  const exportUrl = `/api/export?${exportParams.toString()}`;

  return (
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", fontSize: "0.8125rem", color: "var(--text-subtle)", textDecoration: "none", marginBottom: "1.25rem" }}>
        <ArrowLeft size={13} /> Dashboard
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.75rem" }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--brand-500)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-sm)" }}>
          <Download size={17} color="white" />
        </div>
        <div>
          <h1 style={{ fontSize: "1.375rem", fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.03em", margin: 0 }}>Daten exportieren</h1>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-subtle)", margin: 0 }}>CSV-Download · Excel-kompatibel · alle Felder</p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: "1.25rem", alignItems: "start" }}>
        {/* ── Filter Form ── */}
        <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          <div style={{ padding: "1rem 1.375rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <FileText size={14} color="var(--brand-500)" />
            <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary)" }}>Filter</span>
          </div>
          <div style={{ padding: "1.25rem 1.375rem" }}>
            <ExportForm
              lists={allLists.map((l) => ({ id: l.id, name: l.name, owner_name: l.owner_name ?? null, archived: !!l.archived_at }))}
              currentFrom={from}
              currentTo={to}
              currentOwner={owner}
              currentListIds={listIds}
              currentCategory={category}
            />
          </div>
        </div>

        {/* ── Preview & Download ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          {/* Stats */}
          <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1.125rem 1.25rem" }}>
            <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "var(--text-subtle)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.875rem" }}>Vorschau</div>
            {[
              { label: "Datensätze", value: count, color: "var(--brand-500)" },
              { label: "Antworten", value: answered, color: "var(--color-success-text)" },
              { label: "Termine", value: appts, color: "var(--brand-400)" },
            ].map((s) => (
              <div key={s.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.375rem" }}>
                <span style={{ fontSize: "0.8125rem", color: "var(--text-subtle)" }}>{s.label}</span>
                <span style={{ fontSize: "1.125rem", fontWeight: 800, color: s.color }}>{s.value}</span>
              </div>
            ))}
          </div>

          {/* Download button */}
          <a
            href={exportUrl}
            download
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              padding: "0.875rem 1.25rem",
              borderRadius: "var(--radius-lg)",
              background: count > 0 ? "var(--brand-500)" : "var(--surface-100)",
              color: count > 0 ? "white" : "var(--text-subtle)",
              fontWeight: 700,
              fontSize: "0.9375rem",
              textDecoration: "none",
              boxShadow: count > 0 ? "var(--shadow-sm)" : "none",
              pointerEvents: count === 0 ? "none" : "auto",
              border: `1px solid ${count > 0 ? "transparent" : "var(--border)"}`,
              transition: "all 0.15s",
            }}
          >
            <Download size={16} />
            CSV herunterladen
            {count > 0 && <span style={{ fontSize: "0.75rem", fontWeight: 500, opacity: 0.8 }}>({count} Zeilen)</span>}
          </a>

          {count === 0 && (
            <p style={{ fontSize: "0.75rem", color: "var(--text-subtle)", textAlign: "center" }}>
              Keine Daten für diese Filter-Kombination.
            </p>
          )}

          {/* Field list */}
          <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1rem 1.25rem" }}>
            <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "var(--text-subtle)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.625rem" }}>Felder im Export</div>
            {["Datum", "Name", "Liste", "Owner", "FU-Nummer", "Kategorie", "Antwort erhalten", "Termin gesetzt", "Was war die Antwort?", "Notizen"].map((f) => (
              <div key={f} style={{ fontSize: "0.75rem", color: "var(--text-subtle)", display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.1875rem" }}>
                <span style={{ color: "var(--color-success-text)", fontSize: "0.625rem" }}>✓</span> {f}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Weitere Exporte (Funnel 2.0) ── */}
      <div style={{ marginTop: "1.5rem", background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1.25rem 1.375rem" }}>
        <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "var(--text-subtle)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.875rem" }}>Weitere Exporte (vollständig)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
          {[
            { label: "Telefon-Leads", source: "telefon" },
            { label: "Setting-Calls", source: "setting" },
            { label: "Closing-Calls", source: "closing" },
          ].map((x) => (
            <a
              key={x.source}
              href={`/api/export?source=${x.source}`}
              download
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", padding: "0.75rem 1rem", borderRadius: "var(--radius-md)", background: "var(--surface-50)", border: "1px solid var(--border)", color: "var(--text-primary)", fontWeight: 600, fontSize: "0.8125rem", textDecoration: "none" }}
            >
              <Download size={14} color="var(--brand-500)" /> {x.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
