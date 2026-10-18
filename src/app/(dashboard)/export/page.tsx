import { berlinDateISO } from "@/lib/apptTime";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext, ownScopeFilter } from "@/lib/access";
import type { PitchList } from "@/lib/types";
import { Download, FileText } from "lucide-react";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/PageHeader";
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
  const today = berlinDateISO(new Date().toISOString());

  let listsQuery = supabase
    .from("lists")
    .select("id, name, owner_name, archived_at")
    .eq("workspace_id", access.workspace_id)
    .order("sort_order");
  const ownScope = ownScopeFilter(access);
  if (ownScope) {
    listsQuery = listsQuery.or(ownScope);
  }
  const { data: listsRaw } = await listsQuery;

  const allLists = (listsRaw ?? []) as PitchList[];

  // Current filter values
  const from     = q.from     ?? "";
  const to       = q.to       ?? today;
  const owner    = q.owner    ?? "";
  const listIds  = q.listIds  ? q.listIds.split(",").filter(Boolean) : [];
  const category = q.category ?? "";

  // Vorschau: drei Zählungen in der Datenbank statt alle Kontakte des
  // Zeitraums seitenweise zu holen und in JS zu filtern (Standard-Zeitraum ab
  // 2000 = die ganze Tabelle, 1000 Zeilen je Roundtrip). Dieselben Filter wie
  // die Download-Route — inklusive `workspace_id`, ohne den ein Plattform-Admin
  // über alle Organisationen gezählt hätte, während die CSV nur eine enthält.
  const allowedListIds = allLists.map((l) => l.id);
  const previewBase = () => {
    let previewQuery = supabase
      .from("contacts")
      .select("id, lists!inner(owner_name)", { count: "exact", head: true })
      .eq("workspace_id", access.workspace_id)
      .gte("pitched_at", from || "2000-01-01")
      .lte("pitched_at", to);
    if (access.effective_user_id) {
      previewQuery = previewQuery.in("list_id", allowedListIds.length ? allowedListIds : ["00000000-0000-0000-0000-000000000000"]);
    }
    if (listIds.length > 0) previewQuery = previewQuery.in("list_id", listIds);
    if (owner) previewQuery = previewQuery.eq("lists.owner_name", owner);
    if (category) previewQuery = previewQuery.eq("answer_category", category);
    return previewQuery;
  };
  const [allRes, answeredRes, apptsRes] = await Promise.all([
    previewBase(),
    previewBase().eq("answered", true),
    previewBase().eq("appointment_set", true),
  ]);
  const count = allRes.count ?? 0;
  const answered = answeredRes.count ?? 0;
  const appts = apptsRes.count ?? 0;

  // Build export URL
  const exportParams = new URLSearchParams();
  if (from) exportParams.set("from", from);
  if (to) exportParams.set("to", to);
  if (owner) exportParams.set("owner", owner);
  if (listIds.length > 0) exportParams.set("listIds", listIds.join(","));
  if (category) exportParams.set("category", category);
  const exportUrl = `/api/export?${exportParams.toString()}`;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <BackLink href="/" label="Dashboard" />

      <PageHeader eyebrow="Daten" title="Export" meta="CSV-Download · Excel-kompatibel · alle Felder" />

      <div className="grid-2-col" style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: "var(--sp-7)", alignItems: "start" }}>
        {/* ── Filter Form ── */}
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ padding: "var(--sp-6) var(--sp-8)", borderBottom: "1px solid var(--border-default)", display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
            <FileText size={16} color="var(--text-muted)" />
            <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-primary)" }}>Filter</span>
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
            <div style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--text-subtle)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.875rem" }}>Vorschau</div>
            {[
              { label: "Datensätze", value: count, color: "var(--brand-500)" },
              { label: "Antworten", value: answered, color: "var(--color-success-text)" },
              { label: "Termine", value: appts, color: "var(--brand-400)" },
            ].map((s) => (
              <div key={s.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.375rem" }}>
                <span style={{ fontSize: "0.8125rem", color: "var(--text-subtle)" }}>{s.label}</span>
                <span style={{ fontSize: "1.125rem", fontWeight: 600, color: s.color }}>{s.value}</span>
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
              fontWeight: 600,
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
            <div style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--text-subtle)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.625rem" }}>Felder im Export</div>
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
        <div style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--text-subtle)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.875rem" }}>Weitere Exporte (vollständig)</div>
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
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", padding: "0.75rem 1rem", borderRadius: "var(--r-full)", background: "var(--surface-50)", border: "1px solid var(--border)", color: "var(--text-primary)", fontWeight: 600, fontSize: "0.8125rem", textDecoration: "none" }}
            >
              <Download size={14} color="var(--brand-500)" /> {x.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
