import { CsvImportDialog } from "@/components/telefon/CsvImportDialog";
import { DeletePhoneListButton } from "@/components/telefon/DeletePhoneListButton";
import { PhoneDashboard } from "@/components/telefon/PhoneDashboard";
import { getAccessContext, listDataViewUsers } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { ownerColor } from "@/lib/ownerColor";
import type { PhoneLeadStatus, PhoneList, PhoneListKind } from "@/lib/types";
import { EmptyState, PageHeader } from "@/components/ui/PageHeader";
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

// Routing-Listen tragen Info-Blau (Rueckruf) bzw. Warning-Gold (nicht
// erreicht). Orange bleibt dem Akzent vorbehalten und traegt hier keinen Status.
const KIND_BADGE: Record<PhoneListKind, { label: string; color: string; bg: string } | null> = {
  akquise: null,
  rueckruf: { label: "Rückruf", color: "var(--info-fg)", bg: "var(--info-bg)" },
  nicht_erreicht: { label: "Nicht erreicht", color: "var(--warning-fg)", bg: "var(--warning-bg)" },
};

function KindIcon({ kind }: { kind: PhoneListKind }) {
  if (kind === "rueckruf") return <PhoneMissed size={14} style={{ color: "var(--info-fg)" }} />;
  if (kind === "nicht_erreicht") return <Voicemail size={14} style={{ color: "var(--warning-fg)" }} />;
  return <Phone size={14} style={{ color: "var(--stage-telefon)" }} />;
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

  // Bereits vergebene Branchen als Vorschläge für den Import-Dialog.
  // Case-insensitiv dedupliziert, erste Schreibweise gewinnt — dieselbe Regel
  // wie in der Auswertung, sonst schlägt der Dialog eine Schreibweise vor, die
  // dort als eigene Gruppe geführt wird.
  const distinctValues = (pick: (l: PhoneList) => string | null) => {
    const byKey = new Map<string, string>();
    for (const l of lists) {
      const v = (pick(l) ?? "").trim();
      if (!v) continue;
      const key = v.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, v);
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b, "de"));
  };
  const targetGroups = distinctValues((l) => l.target_group);
  // Dieselbe Vorschlagslogik für den Skript-Testarm: Nur wenn derselbe Arm bei
  // mehreren Importen exakt gleich heißt, bündeln sich seine Listen in der
  // Auswertung zu einer tragfähigen Fallzahl.
  const scriptLabels = distinctValues((l) => l.script_label);

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
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-9)" }}>
      {/* ── Page Header ── */}
      <PageHeader
        eyebrow="Kaltakquise"
        title="Telefon"
        meta="Call-Mode · CSV-Import · Rückruf-Routing"
        actions={
          <>
            <span
              className="badge badge-gray tnum"
              title={`${lists.length} Listen mit insgesamt ${totalLeads.toLocaleString("de-DE")} Leads`}
            >
              {lists.length} Listen · {totalLeads.toLocaleString("de-DE")} Leads
            </span>
            {/* Der eine Primaer-CTA dieser View. */}
            <CsvImportDialog
              users={users}
              me={{ user_id: access.user.id, username: access.username }}
              isAdmin={access.role === "owner"}
              targetGroups={targetGroups}
              scriptLabels={scriptLabels}
            />
          </>
        }
      />

      {/* ── Metriken ── */}
      <PhoneDashboard />

      {/* ── Listen nach Inhaber ── */}
      {lists.length === 0 ? (
        <div className="card dot-grid">
          <EmptyState
            icon={<Phone size={24} />}
            message="Noch keine Telefonlisten. Importiere eine Google-Maps-CSV, um die erste Akquise-Liste anzulegen."
          />
        </div>
      ) : (
        ownerNames.map((owner) => {
          const { fg: color, bg: colorBg } = ownerColor(owner);
          return (
            <section key={owner} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "var(--r-full)",
                    background: colorBg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "var(--fs-2xs)",
                    fontWeight: 600,
                    color,
                    flexShrink: 0,
                  }}
                >
                  {owner.charAt(0).toUpperCase()}
                </div>
                <span style={{ fontWeight: 600, fontSize: "var(--fs-md)", color: "var(--text-primary)" }}>{owner}</span>
                <span className="count-pill">{grouped[owner].length}</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "var(--sp-6)" }}>
                {grouped[owner].map((l) => {
                  const c = countsByList[l.id] ?? EMPTY_COUNTS;
                  const badge = KIND_BADGE[l.list_kind];
                  return (
                    <div key={l.id} style={{ position: "relative" }}>
                      <Link href={`/telefon/${l.id}`} style={{ textDecoration: "none" }} className="organic-list-card-link">
                        <div className="organic-list-card card" style={{ padding: "var(--sp-6) var(--sp-7)" }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "var(--sp-4)",
                              marginBottom: "var(--sp-6)",
                              paddingRight: "var(--sp-8)",
                            }}
                          >
                            <KindIcon kind={l.list_kind} />
                            <span
                              style={{
                                flex: 1,
                                fontSize: "var(--fs-base)",
                                fontWeight: 500,
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
                                className="badge"
                                style={{ color: badge.color, background: badge.bg, flexShrink: 0 }}
                              >
                                {badge.label}
                              </span>
                            )}
                          </div>

                          {/* Status-Zeile: Zahl + Wort, nie Farbe allein. */}
                          <div
                            className="tnum"
                            style={{
                              display: "flex",
                              gap: "var(--sp-4) var(--sp-6)",
                              flexWrap: "wrap",
                              fontSize: "var(--fs-xs)",
                            }}
                          >
                            <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{c.total} gesamt</span>
                            <span style={{ color: "var(--text-muted)" }}>{c.aktiv} aktiv</span>
                            <span style={{ color: "var(--info-fg)" }}>{c.rueckruf} Rückruf</span>
                            <span style={{ color: "var(--success-fg)" }}>{c.termin} Termin</span>
                            <span style={{ color: "var(--text-muted)" }}>{c.dead} dead</span>
                          </div>
                        </div>
                      </Link>
                      <div style={{ position: "absolute", top: "var(--sp-4)", right: "var(--sp-4)" }}>
                        <DeletePhoneListButton iconOnly listId={l.id} listName={l.name} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
