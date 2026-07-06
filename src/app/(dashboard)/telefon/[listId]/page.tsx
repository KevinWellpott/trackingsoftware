import { CallModeRunner } from "@/components/telefon/CallModeRunner";
import { DeletePhoneListButton } from "@/components/telefon/DeletePhoneListButton";
import { getAccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { ownerColor } from "@/lib/ownerColor";
import type { PhoneLead, PhoneList, PhoneListKind } from "@/lib/types";
import { ArrowLeft, Phone, PhoneMissed, Voicemail } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

// Telefonliste im Call-Mode: Liste + Leads laden, Guard über Workspace +
// Personenscope, dann durchtelefonieren via CallModeRunner.

const KIND_META: Record<PhoneListKind, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  akquise: {
    label: "Akquise",
    color: "var(--text-muted)",
    bg: "var(--surface-150)",
    border: "var(--border)",
    icon: <Phone size={11} />,
  },
  rueckruf: {
    label: "Rückruf",
    color: "var(--brand-500)",
    bg: "var(--brand-50)",
    border: "var(--brand-200)",
    icon: <PhoneMissed size={11} />,
  },
  nicht_erreicht: {
    label: "Nicht erreicht",
    color: "var(--color-warning-text)",
    bg: "var(--color-warning-bg)",
    border: "var(--color-warning-border)",
    icon: <Voicemail size={11} />,
  },
};

export default async function PhoneListPage({ params }: { params: Promise<{ listId: string }> }) {
  const { listId } = await params;
  const access = await getAccessContext();
  if (!access) notFound();

  const supabase = await createClient();

  let listQuery = supabase
    .from("phone_lists")
    .select("*")
    .eq("id", listId)
    .eq("workspace_id", access.workspace_id);
  if (access.effective_user_id) {
    listQuery = listQuery.eq("created_by_user_id", access.effective_user_id);
  }
  const { data: rawList } = await listQuery.maybeSingle();
  if (!rawList) notFound();
  const list = rawList as PhoneList;

  const rawLeads = await fetchAllRows<PhoneLead>((from, to) =>
    supabase
      .from("phone_leads")
      .select("*")
      .eq("list_id", listId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  const leads = rawLeads as PhoneLead[];

  const kind = KIND_META[list.list_kind];
  const oc = list.owner_name ? ownerColor(list.owner_name) : null;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: "1.25rem" }}>
        <Link
          href="/telefon"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
            fontSize: "0.8125rem",
            color: "var(--text-subtle)",
            textDecoration: "none",
            marginBottom: "0.75rem",
          }}
        >
          <ArrowLeft size={13} /> Telefon
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap", marginBottom: "0.25rem" }}>
          {list.owner_name && oc && (
            <span
              style={{
                fontSize: "0.6875rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: oc.fg,
                background: oc.bg,
                border: `1px solid color-mix(in srgb, ${oc.fg} 33%, transparent)`,
                padding: "2px 8px",
                borderRadius: 99,
              }}
            >
              {list.owner_name}
            </span>
          )}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
              fontSize: "0.6875rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: kind.color,
              background: kind.bg,
              border: `1px solid ${kind.border}`,
              padding: "2px 8px",
              borderRadius: 99,
            }}
          >
            {kind.icon} {kind.label}
          </span>
          <span style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>
            {leads.length.toLocaleString("de-DE")} Leads
          </span>
          <span style={{ marginLeft: "auto" }}>
            <DeletePhoneListButton listId={list.id} listName={list.name} redirectTo="/telefon" />
          </span>
        </div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.03em", margin: 0 }}>
          {list.name}
        </h1>
      </div>

      {/* ── Call-Mode ── */}
      <CallModeRunner list={list} leads={leads} />
    </div>
  );
}
