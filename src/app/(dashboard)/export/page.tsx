import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/workspace";
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
  const m = await getMembership();
  if (!m) return null;

  const supabase = await createClient();
  const q = await searchParams;
  const today = localDateISO();

  const { data: listsRaw } = await supabase
    .from("lists")
    .select("id, name, owner_name, archived_at")
    .eq("workspace_id", m.workspace_id)
    .order("sort_order");

  const allLists = (listsRaw ?? []) as PitchList[];

  // Current filter values
  const from     = q.from     ?? "";
  const to       = q.to       ?? today;
  const owner    = q.owner    ?? "";
  const listIds  = q.listIds  ? q.listIds.split(",").filter(Boolean) : [];
  const category = q.category ?? "";

  // Preview: count matching contacts
  let countQ = supabase
    .from("contacts")
    .select("id, list_id, pitched_at, answer_category, lists!inner(owner_name)", { count: "exact", head: false });

  if (from) countQ = countQ.gte("pitched_at", from);
  countQ = countQ.lte("pitched_at", to);
  if (listIds.length > 0) countQ = countQ.in("list_id", listIds);

  const { count: rawCount } = await countQ;

  // Further filter by owner + category (client-side for preview since nested filters are limited)
  const { data: previewRaw } = await supabase
    .from("contacts")
    .select("id, list_id, answered, appointment_set, answer_category, lists!inner(owner_name)")
    .gte("pitched_at", from || "2000-01-01")
    .lte("pitched_at", to)
    .limit(2000);

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
      <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", fontSize: "0.8125rem", color: "#52525b", textDecoration: "none", marginBottom: "1.25rem" }}>
        <ArrowLeft size={13} /> Dashboard
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.75rem" }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 12px rgba(99,102,241,0.4)" }}>
          <Download size={17} color="white" />
        </div>
        <div>
          <h1 style={{ fontSize: "1.375rem", fontWeight: 800, color: "#fafafa", letterSpacing: "-0.03em", margin: 0 }}>Daten exportieren</h1>
          <p style={{ fontSize: "0.8125rem", color: "#52525b", margin: 0 }}>CSV-Download · Excel-kompatibel · alle Felder</p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: "1.25rem", alignItems: "start" }}>
        {/* ── Filter Form ── */}
        <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          <div style={{ padding: "1rem 1.375rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <FileText size={14} color="#818cf8" />
            <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#fafafa" }}>Filter</span>
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
            <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#52525b", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.875rem" }}>Vorschau</div>
            {[
              { label: "Datensätze", value: count, color: "#818cf8" },
              { label: "Antworten", value: answered, color: "#4ade80" },
              { label: "Termine", value: appts, color: "#a78bfa" },
            ].map((s) => (
              <div key={s.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.375rem" }}>
                <span style={{ fontSize: "0.8125rem", color: "#71717a" }}>{s.label}</span>
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
              background: count > 0 ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "#18181b",
              color: count > 0 ? "white" : "#3f3f46",
              fontWeight: 700,
              fontSize: "0.9375rem",
              textDecoration: "none",
              boxShadow: count > 0 ? "0 4px 16px rgba(99,102,241,0.4)" : "none",
              pointerEvents: count === 0 ? "none" : "auto",
              border: `1px solid ${count > 0 ? "transparent" : "#27272a"}`,
              transition: "all 0.15s",
            }}
          >
            <Download size={16} />
            CSV herunterladen
            {count > 0 && <span style={{ fontSize: "0.75rem", fontWeight: 500, opacity: 0.8 }}>({count} Zeilen)</span>}
          </a>

          {count === 0 && (
            <p style={{ fontSize: "0.75rem", color: "#52525b", textAlign: "center" }}>
              Keine Daten für diese Filter-Kombination.
            </p>
          )}

          {/* Field list */}
          <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1rem 1.25rem" }}>
            <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#52525b", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.625rem" }}>Felder im Export</div>
            {["Datum", "Name", "Liste", "Owner", "FU-Nummer", "Kategorie", "Antwort erhalten", "Termin gesetzt", "Was war die Antwort?", "Notizen"].map((f) => (
              <div key={f} style={{ fontSize: "0.75rem", color: "#71717a", display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.1875rem" }}>
                <span style={{ color: "#4ade80", fontSize: "0.625rem" }}>✓</span> {f}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
