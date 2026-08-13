import { CsvImportDialog } from "@/components/telefon/CsvImportDialog";
import { DeletePhoneListButton } from "@/components/telefon/DeletePhoneListButton";
import { PhoneDashboard } from "@/components/telefon/PhoneDashboard";
import { getAccessContext, listDataViewUsers, ownScopeFilter } from "@/lib/access";
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

// Routing-Listen sind eine STRUKTUR-Eigenschaft der Liste, kein Status ihrer
// Leads — deshalb ein neutrales Badge mit farbigem Punkt statt einer getoenten
// Flaeche. Vorher trug jede Karte bis zu drei eingefaerbte Elemente (Icon,
// Badge, Statuszeile) in vier Semantiktoenen; im Raster mit einem Dutzend
// Karten ergab das ein Farbfeld, in dem nichts mehr hervorstach.
const KIND_BADGE: Record<PhoneListKind, { label: string; dot: string } | null> = {
  akquise: null,
  rueckruf: { label: "Rückruf", dot: "var(--info)" },
  nicht_erreicht: { label: "Nicht erreicht", dot: "var(--warning)" },
};

function KindIcon({ kind }: { kind: PhoneListKind }) {
  const Icon = kind === "rueckruf" ? PhoneMissed : kind === "nicht_erreicht" ? Voicemail : Phone;
  return <Icon size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />;
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
  // Personenfilter über owner_name (mit created_by_user_id nur als Rückfall) —
  // dieselbe Regel wie `list_owned_by_user()` in den RPCs, wie `/telefon/[listId]`
  // und wie der Sidebar-Baum. Vorher stand hier `eq(created_by_user_id)`: Eine
  // Liste, die ein Admin FÜR ein Mitglied angelegt hat, zählte damit in jeder
  // Auswertung beim Mitglied, war in dessen Datensicht aber unsichtbar — und die
  // Detailseite antwortete auf denselben Datensatz mit 404, weil sie schon nach
  // owner_name filterte.
  const ownScope = ownScopeFilter(access);
  if (ownScope) {
    listsQuery = listsQuery.or(ownScope);
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
              orgName={access.workspaces.name}
              isForeignOrg={access.is_foreign_org}
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
                                className="badge badge-gray"
                                style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)", flexShrink: 0 }}
                              >
                                <span
                                  style={{ width: 6, height: 6, borderRadius: "var(--r-full)", background: badge.dot }}
                                />
                                {badge.label}
                              </span>
                            )}
                          </div>

                          {/* Status-Zeile: Zahl + Wort, nie Farbe allein — und
                              nur EIN Ton. „Termin" ist das Ergebnis, auf das
                              die Liste hinarbeitet; Rückruf und Dead sind
                              Zwischenstände und stehen gedämpft daneben.
                              Vorher trugen vier der fünf Zahlen eine eigene
                              Farbe, wodurch die wichtigste keine mehr hatte. */}
                          <div
                            className="tnum"
                            style={{
                              display: "flex",
                              gap: "var(--sp-4) var(--sp-6)",
                              flexWrap: "wrap",
                              fontSize: "var(--fs-xs)",
                              color: "var(--text-muted)",
                            }}
                          >
                            <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{c.total} gesamt</span>
                            <span>{c.aktiv} aktiv</span>
                            <span>{c.rueckruf} Rückruf</span>
                            <span style={{ color: "var(--success-fg)" }}>{c.termin} Termin</span>
                            <span>{c.dead} dead</span>
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
