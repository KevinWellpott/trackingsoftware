import { redirect } from "next/navigation";
import Link from "next/link";
import { Archive, ArrowLeft, MessageSquare, Phone, RotateCcw } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { restoreListForm } from "@/app/actions/lists";
import { restorePhoneListForm } from "@/app/actions/phone";
import { ownerColor } from "@/lib/ownerColor";
import type { PhoneListKind } from "@/lib/types";

// Admin-Archiv: zeigt archivierte LinkedIn- und Telefonlisten workspace-weit
// und erlaubt das Wiederherstellen ohne manuellen SQL-Zugriff.
// Nur für Owner mit Workspace-Datensicht — alle anderen landen auf "/".

type ArchivedList = { id: string; name: string; owner_name: string | null; archived_at: string };
type ArchivedPhoneList = { id: string; name: string; owner_name: string | null; archived_at: string; list_kind: PhoneListKind };

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default async function ArchivPage() {
  const access = await getAccessContext();
  if (!access) return null;
  if (!(access.role === "owner" && access.data_scope === "workspace")) redirect("/");

  const supabase = await createClient();

  const [{ data: lists }, { data: phoneLists }] = await Promise.all([
    supabase
      .from("lists")
      .select("id, name, owner_name, archived_at")
      .eq("workspace_id", access.workspace_id)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false }),
    supabase
      .from("phone_lists")
      .select("id, name, owner_name, archived_at, list_kind")
      .eq("workspace_id", access.workspace_id)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false }),
  ]);

  const archivedLists = (lists ?? []) as ArchivedList[];
  const archivedPhoneLists = (phoneLists ?? []) as ArchivedPhoneList[];

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div>
        <Link href="/team" style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", fontSize: "0.8125rem", color: "var(--text-subtle)", textDecoration: "none", marginBottom: "0.875rem" }}>
          <ArrowLeft size={13} /> Team
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--brand-500)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-sm)" }}>
            <Archive size={17} color="white" />
          </div>
          <div>
            <h1 style={{ fontSize: "1.375rem", fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.03em", margin: 0 }}>Archiv</h1>
            <p style={{ fontSize: "0.8125rem", color: "var(--text-subtle)", margin: 0 }}>Archivierte Listen workspace-weit · wiederherstellen ohne SQL</p>
          </div>
        </div>
      </div>

      {/* ── LinkedIn-Listen ── */}
      <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
        <div style={{ padding: "1rem 1.375rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <MessageSquare size={14} color="var(--brand-400)" />
          <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary)" }}>LinkedIn-Listen ({archivedLists.length})</span>
        </div>
        {archivedLists.length === 0 ? (
          <p style={{ margin: 0, padding: "0.875rem 1.375rem", fontSize: "0.8125rem", color: "var(--text-subtle)" }}>Keine archivierten Listen.</p>
        ) : (
          <div>
            {archivedLists.map((l, i) => {
              const oc = l.owner_name ? ownerColor(l.owner_name) : null;
              return (
                <div key={l.id} style={{ display: "flex", alignItems: "center", gap: "0.875rem", padding: "0.875rem 1.375rem", borderBottom: i < archivedLists.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-primary)" }}>{l.name}</span>
                      {l.owner_name && oc && (
                        <span style={{ fontSize: "0.6875rem", fontWeight: 700, color: oc.fg, background: oc.bg, border: `1px solid color-mix(in srgb, ${oc.fg} 33%, transparent)`, padding: "1px 8px", borderRadius: 99 }}>
                          {l.owner_name}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>Archiviert am {formatDate(l.archived_at)}</span>
                  </div>
                  <form action={restoreListForm}>
                    <input type="hidden" name="list_id" value={l.id} />
                    <button type="submit" style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "var(--color-success-bg)", border: "1px solid var(--color-success-border)", borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: "var(--color-success-text)", fontSize: "0.75rem", fontWeight: 600 }}>
                      <RotateCcw size={13} /> Wiederherstellen
                    </button>
                  </form>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Telefonlisten ── */}
      <div style={{ background: "var(--surface-100)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
        <div style={{ padding: "1rem 1.375rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Phone size={14} color="var(--brand-400)" />
          <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary)" }}>Telefonlisten ({archivedPhoneLists.length})</span>
        </div>
        {archivedPhoneLists.length === 0 ? (
          <p style={{ margin: 0, padding: "0.875rem 1.375rem", fontSize: "0.8125rem", color: "var(--text-subtle)" }}>Keine archivierten Listen.</p>
        ) : (
          <div>
            {archivedPhoneLists.map((l, i) => {
              const oc = l.owner_name ? ownerColor(l.owner_name) : null;
              return (
                <div key={l.id} style={{ display: "flex", alignItems: "center", gap: "0.875rem", padding: "0.875rem 1.375rem", borderBottom: i < archivedPhoneLists.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-primary)" }}>{l.name}</span>
                      {l.owner_name && oc && (
                        <span style={{ fontSize: "0.6875rem", fontWeight: 700, color: oc.fg, background: oc.bg, border: `1px solid color-mix(in srgb, ${oc.fg} 33%, transparent)`, padding: "1px 8px", borderRadius: 99 }}>
                          {l.owner_name}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>Archiviert am {formatDate(l.archived_at)}</span>
                  </div>
                  <form action={restorePhoneListForm}>
                    <input type="hidden" name="list_id" value={l.id} />
                    <button type="submit" style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "var(--color-success-bg)", border: "1px solid var(--color-success-border)", borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: "var(--color-success-text)", fontSize: "0.75rem", fontWeight: 600 }}>
                      <RotateCcw size={13} /> Wiederherstellen
                    </button>
                  </form>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
