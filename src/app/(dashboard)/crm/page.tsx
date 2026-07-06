import { CrmBoard, type CrmContact } from "@/components/CrmBoard";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { getAccessContext } from "@/lib/access";
import { ArrowLeft, Briefcase } from "lucide-react";
import Link from "next/link";

type VisibleList = {
  id: string;
  name: string;
  owner_name: string | null;
};

type WonDeal = {
  id: string;
  lead_name: string | null;
  company: string | null;
  deal_volume: number | null;
  payment_type: string | null;
  contract_start: string | null;
};

const eur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

export default async function CrmPage() {
  const access = await getAccessContext();
  if (!access) return null;

  const supabase = await createClient();
  let listsQuery = supabase
    .from("lists")
    .select("id, name, owner_name")
    .eq("workspace_id", access.workspace_id)
    .order("sort_order", { ascending: true });

  if (access.effective_user_id) {
    listsQuery = listsQuery.eq("created_by_user_id", access.effective_user_id);
  }

  const { data: listsRaw } = await listsQuery;
  const lists = (listsRaw ?? []) as VisibleList[];
  const listIds = lists.map((list) => list.id);

  let contacts: CrmContact[] = [];
  if (listIds.length > 0) {
    const contactsRaw = await fetchAllRows((from, to) =>
      supabase
        .from("contacts")
        .select("*, pipeline_stages (*), lists!inner (id, name, owner_name)")
        .in("list_id", listIds)
        .eq("appointment_set", true)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to)
    );

    contacts = (contactsRaw ?? []) as unknown as CrmContact[];
  }

  // Gewonnene Deals (Closing 2.0)
  let wonQ = supabase
    .from("closing_calls")
    .select("id, lead_name, company, deal_volume, payment_type, contract_start")
    .eq("workspace_id", access.workspace_id)
    .eq("status", "gewonnen")
    .order("contract_start", { ascending: false, nullsFirst: false });
  if (access.effective_user_id) wonQ = wonQ.eq("created_by_user_id", access.effective_user_id);
  const { data: wonRaw } = await wonQ;
  const wonDeals = (wonRaw ?? []) as WonDeal[];
  const wonTotal = wonDeals.reduce((s, d) => s + (Number(d.deal_volume) || 0), 0);

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", fontSize: "0.8125rem", color: "var(--text-subtle)", textDecoration: "none", marginBottom: "1.25rem" }}>
        <ArrowLeft size={13} /> Dashboard
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <div style={{ width: 38, height: 38, borderRadius: "var(--radius-md)", background: "rgb(24 98 184 / 0.10)", border: "1px solid rgb(24 98 184 / 0.25)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-sm)" }}>
          <Briefcase size={18} color="var(--brand-500)" />
        </div>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 850, color: "var(--text-primary)", letterSpacing: "-0.03em", margin: 0 }}>CRM</h1>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-subtle)", margin: 0 }}>Alle Kontakte, die aus Pitching zu einem Termin konvertiert sind.</p>
        </div>
      </div>

      {wonDeals.length > 0 && (
        <div style={{ marginBottom: "1.5rem", background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary)" }}>Gewonnene Deals (Closing)</span>
            <span style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--color-success-text)" }}>{eur(wonTotal)} · {wonDeals.length}</span>
          </div>
          <div>
            {wonDeals.map((d, i) => (
              <div key={d.id} className="won-deal-row" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr auto", gap: "0.75rem", alignItems: "center", padding: "0.75rem 1.25rem", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                <div>
                  <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-primary)" }}>{d.lead_name ?? "—"}</div>
                  {d.company && <div style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>{d.company}</div>}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {d.payment_type ?? ""}{d.contract_start ? ` · Start ${new Date(d.contract_start).toLocaleDateString("de-DE")}` : ""}
                </div>
                <div style={{ fontSize: "0.9375rem", fontWeight: 800, color: "var(--color-success-text)", textAlign: "right" }}>
                  {d.deal_volume != null ? eur(Number(d.deal_volume)) : "—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <CrmBoard contacts={contacts} />
    </div>
  );
}
