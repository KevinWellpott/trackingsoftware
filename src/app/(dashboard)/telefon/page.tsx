import { CsvImportDialog } from "@/components/telefon/CsvImportDialog";
import { PhoneDashboard } from "@/components/telefon/PhoneDashboard";
import { getAccessContext, listDataViewUsers } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { ownerColor } from "@/lib/ownerColor";
import type { PhoneLeadStatus, PhoneList, PhoneListKind } from "@/lib/types";
import { Phone, PhoneMissed, Voicemail } from "lucide-react";
import Link from "next/link";

// Telefon-Übersicht: Dashboard-Metriken + alle Telefonlisten gruppiert nach
// Inhaber (Akquise-Listen + Rückruf-/Nicht-erreicht-Routing-Listen).

type ListCounts = {
  total: number;
  aktiv: number;
  rueckruf: number;
  nicht_erreicht: number;
  termin: number;
  dead: number;
};

const EMPTY_COUNTS: ListCounts = { total: 0, aktiv: 0, rueckruf: 0, nicht_erreicht: 0, termin: 0, dead: 0 };

const KIND_BADGE: Record<PhoneListKind, { label: string; color: string; bg: string; border: string } | null> = {
  akquise: null,
  rueckruf: { label: "Rückruf", color: "var(--brand-500)", bg: "var(--brand-50)", border: "var(--brand-200)" },
  nicht_erreicht: {
    label: "Nicht erreicht",
    color: "var(--color-warning-text)",
    bg: "var(--color-warning-bg)",
    border: "var(--color-warning-border)",
  },
};

function KindIcon({ kind }: { kind: PhoneListKind }) {
  if (kind === "rueckruf") return <PhoneMissed size={13} style={{ color: "var(--brand-500)" }} />;
  if (kind === "nicht_erreicht") return <Voicemail size={13} style={{ color: "var(--color-warning-text)" }} />;
  return <Phone size={13} style={{ color: "var(--text-subtle)" }} />;
}

export default async function TelefonPage() {
  const access = await getAccessContext();
  if (!access) return null;

  const supabase = await createClient();

  let listsQuery = supabase
    .from("phone_lists")
    .select("*")
    .eq("workspace_id", access.workspace_id)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (access.effective_user_id) {
    listsQuery = listsQuery.eq("created_by_user_id", access.effective_user_id);
  }

  const [{ data: rawLists }, { data: countRows }, allUsers] = await Promise.all([
    listsQuery,
    // Aggregat-RPC statt Full-Table-Read: nur (list_id, status, cnt) statt aller Leads
    supabase.rpc("rpc_phone_list_counts", {
      p_workspace_id: access.workspace_id,
      p_effective_user_id: access.effective_user_id ?? null,
    }),
    listDataViewUsers(access.workspace_id),
  ]);

  const lists = (rawLists ?? []) as PhoneList[];
  const users = (access.data_scope === "own"
    ? allUsers.filter((u) => u.user_id === access.user.id)
    : allUsers
  ).map((u) => ({ user_id: u.user_id, username: u.username }));

  // Status-Breakdown je Liste (aus der RPC gruppiert)
  const countsByList: Record<string, ListCounts> = {};
  let totalLeads = 0;
  for (const row of (countRows ?? []) as { list_id: string; status: string; cnt: number }[]) {
    const n = Number(row.cnt) || 0;
    const c = (countsByList[row.list_id] ??= { ...EMPTY_COUNTS });
    c.total += n;
    if (row.status in c) c[row.status as PhoneLeadStatus] += n;
    totalLeads += n;
  }

  // Nach Inhaber gruppieren; Akquise-Listen zuerst, Routing-Listen danach
  const KIND_ORDER: Record<PhoneListKind, number> = { akquise: 0, rueckruf: 1, nicht_erreicht: 2 };
  const grouped: Record<string, PhoneList[]> = {};
  for (const l of lists) {
    const key = l.owner_name ?? "Ohne Zuordnung";
    (grouped[key] ??= []).push(l);
  }
  const ownerNames = Object.keys(grouped).sort((a, b) => a.localeCompare(b, "de"));
  for (const owner of ownerNames) {
    grouped[owner].sort((a, b) => KIND_ORDER[a.list_kind] - KIND_ORDER[b.list_kind] || (a.created_at < b.created_at ? 1 : -1));
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      {/* ── Page Header ── */}
      <div
        style={{
          marginBottom: "1.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
            <Phone size={18} color="var(--brand-500)" />
            <h1 style={{ fontSize: "1.375rem", fontWeight: 800, margin: 0, letterSpacing: "-0.03em", color: "var(--text-primary)" }}>
              Telefon
            </h1>
          </div>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", margin: 0 }}>
            Telefonakquise · Call-Mode · CSV-Import · Rückruf-Routing
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.625rem", alignItems: "center", flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: "0.75rem",
              color: "var(--text-subtle)",
              background: "var(--surface-100)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "0.25rem 0.625rem",
            }}
          >
            {lists.length} Listen · {totalLeads.toLocaleString("de-DE")} Leads
          </span>
          <CsvImportDialog users={users} />
        </div>
      </div>

      {/* ── Metriken ── */}
      <PhoneDashboard />

      {/* ── Listen nach Inhaber ── */}
      {lists.length === 0 ? (
        <div
          style={{
            background: "var(--surface-100)",
            border: "1px dashed var(--border-bright)",
            borderRadius: "var(--radius-lg)",
            padding: "3rem 1.5rem",
            textAlign: "center",
          }}
        >
          <Phone size={26} style={{ color: "var(--text-subtle)", marginBottom: "0.625rem" }} />
          <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.25rem" }}>
            Noch keine Telefonlisten
          </div>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", margin: 0 }}>
            Importiere eine Google-Maps-CSV, um die erste Akquise-Liste anzulegen.
          </p>
        </div>
      ) : (
        ownerNames.map((owner) => {
          const { fg: color, bg: colorBg } = ownerColor(owner);
          return (
            <div key={owner} style={{ marginBottom: "1.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: colorBg,
                    border: `1.5px solid ${color}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.6875rem",
                    fontWeight: 800,
                    color,
                    flexShrink: 0,
                  }}
                >
                  {owner.charAt(0).toUpperCase()}
                </div>
                <span style={{ fontWeight: 800, fontSize: "0.9375rem", color }}>{owner}</span>
                <span style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>
                  {grouped[owner].length} Listen
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: "0.75rem" }}>
                {grouped[owner].map((l) => {
                  const c = countsByList[l.id] ?? EMPTY_COUNTS;
                  const badge = KIND_BADGE[l.list_kind];
                  return (
                    <Link key={l.id} href={`/telefon/${l.id}`} style={{ textDecoration: "none" }} className="organic-list-card-link">
                      <div
                        className="organic-list-card"
                        style={{
                          background: "var(--surface-100)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-md)",
                          padding: "0.875rem 1rem",
                          transition: "border-color 0.15s, box-shadow 0.15s",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.625rem" }}>
                          <KindIcon kind={l.list_kind} />
                          <span
                            style={{
                              flex: 1,
                              fontSize: "0.875rem",
                              fontWeight: 700,
                              color: "var(--text-primary)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {l.name}
                          </span>
                          {badge && (
                            <span
                              style={{
                                fontSize: "0.625rem",
                                fontWeight: 800,
                                textTransform: "uppercase",
                                letterSpacing: "0.05em",
                                color: badge.color,
                                background: badge.bg,
                                border: `1px solid ${badge.border}`,
                                borderRadius: 99,
                                padding: "0.1rem 0.45rem",
                                flexShrink: 0,
                              }}
                            >
                              {badge.label}
                            </span>
                          )}
                        </div>

                        <div style={{ display: "flex", gap: "0.625rem", flexWrap: "wrap", fontSize: "0.6875rem", fontWeight: 600 }}>
                          <span style={{ color: "var(--text-secondary)" }}>
                            <strong style={{ fontWeight: 800 }}>{c.total}</strong> gesamt
                          </span>
                          <span style={{ color: "var(--text-muted)" }}>{c.aktiv} aktiv</span>
                          <span style={{ color: "var(--brand-500)" }}>{c.rueckruf} Rückruf</span>
                          <span style={{ color: "var(--color-success-text)" }}>{c.termin} Termin</span>
                          <span style={{ color: "var(--color-error-text)" }}>{c.dead} dead</span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
