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

      <CrmBoard contacts={contacts} />
    </div>
  );
}
