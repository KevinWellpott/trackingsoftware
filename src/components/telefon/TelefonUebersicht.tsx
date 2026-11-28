import { CsvImportDialog } from "@/components/telefon/CsvImportDialog";
import { DeletePhoneListButton } from "@/components/telefon/DeletePhoneListButton";
import { PhoneDashboard, type TelefonZeitraum } from "@/components/telefon/PhoneDashboard";
import { buildOwnScope, getAccessContext, listDataViewUsers, ownScopeFilter } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { ownerColor } from "@/lib/ownerColor";
import type { PhoneLeadStatus, PhoneList, PhoneListKind } from "@/lib/types";
import { EmptyState, PageHeader } from "@/components/ui/PageHeader";
import { CalendarX, Phone, PhoneForwarded, Voicemail } from "lucide-react";
import Link from "next/link";

// Telefon-Übersicht (Redesign Phase 5): Kennzahl-Module Heute/Woche, darunter
// die Akquise-Listen als Tabelle mit gestapeltem Fortschritt und „jetzt
// anrufbar", danach die Routing-Listen als „Wiedervorlagen".
//
// Zwei Ausprägungen (Entscheidung 28.11.): `/telefon` zeigt NUR die eigenen
// Listen und die eigenen Zahlen — auch für einen Owner mit Team-Sicht („da
// sollen meine Listen stehen und meine Zahlen, das war's"). Alles Gesamte
// (alle Listen, Team-Zahlen, „Je Person") steht unter `/telefon/team`.

type ListCounts = {
  total: number;
  aktiv: number;
  rueckruf: number;
  nicht_erreicht: number;
  kein_termin: number;
  termin: number;
  dead: number;
};

const EMPTY_COUNTS: ListCounts = { total: 0, aktiv: 0, rueckruf: 0, nicht_erreicht: 0, kein_termin: 0, termin: 0, dead: 0 };

const KIND_LABEL: Record<PhoneListKind, string> = {
  akquise: "Akquise",
  rueckruf: "Rückruf",
  nicht_erreicht: "Nicht erreicht",
  kein_termin: "Kein Termin",
};

function KindIcon({ kind }: { kind: PhoneListKind }) {
  const Icon =
    kind === "rueckruf" ? PhoneForwarded : kind === "nicht_erreicht" ? Voicemail : kind === "kein_termin" ? CalendarX : Phone;
  return <Icon size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} aria-hidden />;
}

/**
 * Gestapelter Fortschritt einer Liste, gezählt über `origin_list_id`
 * (abgewanderte Leads stehen unter ihrer Importliste). Fünf Segmente:
 *   Offen (Status „aktiv" — überwiegend noch nie angerufen; ein Anruf ohne
 *   Ergebnis lässt den Lead ebenfalls auf „aktiv"), In Arbeit (Rückruf und
 *   Nicht erreicht), Termin, Kein Termin, Tot.
 */
function Fortschritt({ c }: { c: ListCounts }) {
  const segs = [
    { n: c.aktiv, label: "offen", color: "var(--line-2)" },
    { n: c.rueckruf + c.nicht_erreicht, label: "in Arbeit", color: "var(--c-tel)" },
    { n: c.termin, label: "Termin", color: "var(--success)" },
    { n: c.kein_termin, label: "kein Termin", color: "var(--gold)" },
    { n: c.dead, label: "tot", color: "var(--red)" },
  ];
  const total = Math.max(1, c.total);
  const title = segs.map((s) => `${s.n} ${s.label}`).join(" · ");
  return (
    <div className="tel-progress" title={title} aria-label={title}>
      <div className="tel-stack">
        {segs.map((s) =>
          s.n > 0 ? <i key={s.label} style={{ width: `${(s.n / total) * 100}%`, background: s.color }} /> : null,
        )}
      </div>
      <span className="tel-progress-c tnum">
        {c.total - c.aktiv > 0 ? `${Math.round(((c.total - c.aktiv) / total) * 100)} % bearbeitet` : "unberührt"} · {c.termin} Termin
        {c.termin === 1 ? "" : "e"}
      </span>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const { fg, bg } = ownerColor(name);
  return (
    <span className="tel-avatar" style={{ color: fg, background: bg }} title={name}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export async function TelefonUebersicht({ team, zeitraumRaw }: { team: boolean; zeitraumRaw?: string }) {
  const access = await getAccessContext();
  if (!access) return null;
  const zeitraum: TelefonZeitraum = zeitraumRaw === "woche" ? "woche" : "heute";
  // „Meine" = die eingestellte Datensicht, sonst die angemeldete Person.
  const personId = access.effective_user_id ?? access.user.id;
  const personName = access.effective_username ?? access.username;
  const darfTeam = access.can_switch_view && !access.effective_user_id;
  const basis = team ? "/telefon/team" : "/telefon";

  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  let listsQuery = supabase
    .from("phone_lists")
    .select("*")
    .eq("workspace_id", access.workspace_id)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  // Personenfilter über owner_name (mit created_by_user_id nur als Rückfall) —
  // dieselbe Regel wie `list_owned_by_user()` in den RPCs, wie `/telefon/[listId]`
  // und wie der Sidebar-Baum.
  // Ohne Team: immer die eigenen Listen, auch bei workspace-weiter Sicht.
  const ownScope = team ? ownScopeFilter(access) : buildOwnScope(personId, personName);
  if (ownScope) {
    listsQuery = listsQuery.or(ownScope);
  }

  // Fällige Rückrufe je Liste: unter der Routing-Liste, in der der Lead liegt,
  // UND unter seiner Importliste. Fehlt `origin_list_id` (Migration 0044),
  // ohne die Herkunft; scheitert auch das, fehlt nur die Plakette.
  const loadDue = (withOrigin: boolean) =>
    fetchAllRows<{ list_id: string; origin_list_id?: string | null }>((f, t) =>
      supabase
        .from("phone_leads")
        .select(withOrigin ? "list_id, origin_list_id" : "list_id")
        .eq("workspace_id", access.workspace_id)
        .eq("status", "rueckruf")
        .lte("callback_at", nowIso)
        .order("id")
        .range(f, t) as unknown as PromiseLike<{
        data: { list_id: string; origin_list_id?: string | null }[] | null;
        error: { message: string } | null;
      }>,
    );

  const [{ data: rawLists }, { data: countRows }, { data: originRows }, allUsers, dueRows] = await Promise.all([
    listsQuery,
    // Aggregat-RPC statt Full-Table-Read: nur (list_id, status, cnt) statt aller Leads
    supabase.rpc("rpc_phone_list_counts", {
      p_workspace_id: access.workspace_id,
      p_effective_user_id: team ? access.effective_user_id ?? null : personId,
    }),
    // Die in Routing-Listen abgewanderten Leads, gezählt unter ihrer
    // Importliste (Migration 0044). Ohne sie stünde in jedem Fortschritt
    // „0 in Arbeit", egal wie viele Rückrufe aus der Liste entstanden sind.
    // Fehlt die RPC, kommt `data: null` zurück — dann der alte Stand.
    supabase.rpc("rpc_phone_origin_counts", {
      p_workspace_id: access.workspace_id,
      p_effective_user_id: team ? access.effective_user_id ?? null : personId,
    }),
    listDataViewUsers(access.workspace_id),
    loadDue(true)
      .catch(() => loadDue(false))
      .catch(() => [] as { list_id: string; origin_list_id?: string | null }[]),
  ]);

  const lists = (rawLists ?? []) as PhoneList[];

  // Bereits vergebene Branchen/Testarme als Vorschläge für den Import-Dialog.
  // Case-insensitiv dedupliziert, erste Schreibweise gewinnt — dieselbe Regel
  // wie in der Auswertung.
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
  // Abgewanderte Leads zusätzlich an ihrer Importliste — bewusst NICHT in
  // `totalLeads`: Sie stehen oben schon unter ihrer Routing-Liste.
  for (const row of (originRows ?? []) as { list_id: string; status: string; cnt: number }[]) {
    const n = Number(row.cnt) || 0;
    const c = (countsByList[row.list_id] ??= { ...EMPTY_COUNTS });
    c.total += n;
    if (row.status in c) c[row.status as PhoneLeadStatus] += n;
  }

  const dueByList: Record<string, number> = {};
  for (const r of dueRows) {
    dueByList[r.list_id] = (dueByList[r.list_id] ?? 0) + 1;
    if (r.origin_list_id && r.origin_list_id !== r.list_id) {
      dueByList[r.origin_list_id] = (dueByList[r.origin_list_id] ?? 0) + 1;
    }
  }
  /** Jetzt anrufbar = offen + nicht erreicht + fällige Rückrufe. */
  const anrufbar = (l: PhoneList) => {
    const c = countsByList[l.id] ?? EMPTY_COUNTS;
    return c.aktiv + c.nicht_erreicht + (dueByList[l.id] ?? 0);
  };

  const akquise = lists.filter((l) => l.list_kind === "akquise");
  const KIND_ORDER: Record<PhoneListKind, number> = { akquise: 0, rueckruf: 1, nicht_erreicht: 2, kein_termin: 3 };
  const routing = lists
    .filter((l) => l.list_kind !== "akquise")
    .sort(
      (a, b) =>
        (a.owner_name ?? "").localeCompare(b.owner_name ?? "", "de") || KIND_ORDER[a.list_kind] - KIND_ORDER[b.list_kind],
    );
  const einePerson = !team || access.data_scope === "own" || !!access.effective_user_id;
  // Zähler nur über die angezeigten Listen — die RPC liefert bei Team-Sicht
  // sonst auch Listen, die hier gar nicht stehen.
  // Aus der Lead-Zählung OHNE die abgewanderten Leads — die stehen schon unter
  // ihrer Routing-Liste (sonst doppelt, wie bei `totalLeads`).
  const sichtbareIds = new Set(lists.map((l) => l.id));
  const leadsGezeigt = ((countRows ?? []) as { list_id: string; cnt: number }[])
    .filter((row) => sichtbareIds.has(row.list_id))
    .reduce((n, row) => n + (Number(row.cnt) || 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-9)" }}>
      <PageHeader
        eyebrow={team ? "Kaltakquise · Team" : "Kaltakquise"}
        title={team ? "Telefon · Team" : "Telefon"}
        meta={`${team ? "" : "Deine "}${akquise.length} Listen · ${(team ? totalLeads : leadsGezeigt).toLocaleString("de-DE")} Leads`}
        actions={
          /* Der eine Primär-CTA dieser View. */
          <span style={{ display: "inline-flex", gap: "var(--sp-3)", alignItems: "center", flexWrap: "wrap" }}>
          {darfTeam && (
            <Link href={team ? "/telefon" : "/telefon/team"} className="ui-btn" data-variant="ghost" data-size="md">
              {team ? "Nur meine" : "Team-Übersicht"}
            </Link>
          )}
          <CsvImportDialog
            users={users}
            me={{ user_id: access.user.id, username: access.username }}
            isAdmin={access.role === "owner"}
            orgName={access.workspaces.name}
            isForeignOrg={access.is_foreign_org}
            targetGroups={targetGroups}
            scriptLabels={scriptLabels}
          />
          </span>
        }
      />

      <PhoneDashboard zeitraum={zeitraum} team={team} basis={basis} />

      {lists.length === 0 ? (
        <div className="card dot-grid">
          <EmptyState
            icon={<Phone size={24} />}
            message={
              team
                ? "Noch keine Telefonlisten. Importiere eine Google-Maps-CSV, um die erste Akquise-Liste anzulegen."
                : "Du hast noch keine eigenen Telefonlisten. Importiere eine Google-Maps-CSV — die Listen des Teams stehen unter „Team-Übersicht“."
            }
          />
        </div>
      ) : (
        <>
          {akquise.length > 0 && (
            <section className="card tel-card">
              <header className="tel-card-head">
                <h3>Akquise-Listen</h3>
                <span className="tel-meta">Fortschritt über die Herkunft der Leads — auch die in Wiedervorlagen gewanderten</span>
              </header>
              <div className="tel-tw">
                <table className="tel-table">
                  <thead>
                    <tr>
                      <th>Liste</th>
                      <th>Inhaber</th>
                      <th style={{ minWidth: 200 }}>Fortschritt</th>
                      <th className="r">Leads</th>
                      <th className="r">Jetzt anrufbar</th>
                      <th className="r" aria-label="Aktionen" />
                    </tr>
                  </thead>
                  <tbody>
                    {akquise.map((l) => {
                      const c = countsByList[l.id] ?? EMPTY_COUNTS;
                      const due = dueByList[l.id] ?? 0;
                      return (
                        <tr key={l.id}>
                          <td className="tel-main">
                            <Link href={`/telefon/${l.id}`} className="tel-nm tel-link">
                              {l.name}
                            </Link>
                            {(l.script_label || l.target_group) && (
                              <span className="tel-co">
                                {[l.target_group, l.script_label ? `Skript „${l.script_label}“` : null].filter(Boolean).join(" · ")}
                              </span>
                            )}
                          </td>
                          <td>{l.owner_name ? <Avatar name={l.owner_name} /> : <span className="tel-faint">—</span>}</td>
                          <td>
                            <Fortschritt c={c} />
                          </td>
                          <td className="r tnum tel-muted">{c.total.toLocaleString("de-DE")}</td>
                          <td className="r tnum">
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                              {due > 0 && (
                                <span className="badge" data-tone="warning" title="Rückrufe, deren Zeit erreicht ist">
                                  {due} Rückruf
                                </span>
                              )}
                              {anrufbar(l).toLocaleString("de-DE")}
                            </span>
                          </td>
                          <td className="r">
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <Link
                                className="ui-btn"
                                data-variant="secondary"
                                data-size="sm"
                                href={`/telefon/${l.id}?modus=anrufen`}
                                style={{ minHeight: 28, padding: "0 10px" }}
                              >
                                <Phone size={13} aria-hidden /> Anrufen
                              </Link>
                              <DeletePhoneListButton iconOnly listId={l.id} listName={l.name} />
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {routing.length > 0 && (
            <section className="card tel-card">
              <header className="tel-card-head">
                <h3>{einePerson ? "Deine Wiedervorlagen" : "Wiedervorlagen"}</h3>
                <span className="tel-meta">Hierhin wandern Leads nach Rückruf, Nicht erreicht und Kein Termin</span>
              </header>
              <div className="tel-tw">
                <table className="tel-table">
                  <thead>
                    <tr>
                      <th>Liste</th>
                      <th>Inhaber</th>
                      <th className="r">Leads</th>
                      <th className="r">Jetzt anrufbar</th>
                      <th className="r" aria-label="Aktionen" />
                    </tr>
                  </thead>
                  <tbody>
                    {routing.map((l) => {
                      const c = countsByList[l.id] ?? EMPTY_COUNTS;
                      const due = dueByList[l.id] ?? 0;
                      return (
                        <tr key={l.id}>
                          <td className="tel-main">
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                              <KindIcon kind={l.list_kind} />
                              <Link href={`/telefon/${l.id}`} className="tel-nm tel-link">
                                {KIND_LABEL[l.list_kind]}
                              </Link>
                            </span>
                            {l.name !== KIND_LABEL[l.list_kind] && <span className="tel-co">{l.name}</span>}
                          </td>
                          <td>{l.owner_name ? <Avatar name={l.owner_name} /> : <span className="tel-faint">—</span>}</td>
                          <td className="r tnum tel-muted">{c.total.toLocaleString("de-DE")}</td>
                          <td className="r tnum">
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                              {due > 0 && (
                                <span className="badge" data-tone="warning" title="Rückrufe, deren Zeit erreicht ist">
                                  {due} fällig
                                </span>
                              )}
                              {anrufbar(l).toLocaleString("de-DE")}
                            </span>
                          </td>
                          <td className="r">
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <Link
                                className="ui-btn"
                                data-variant="secondary"
                                data-size="sm"
                                href={`/telefon/${l.id}?modus=anrufen`}
                                style={{ minHeight: 28, padding: "0 10px" }}
                              >
                                <Phone size={13} aria-hidden /> Anrufen
                              </Link>
                              <DeletePhoneListButton iconOnly listId={l.id} listName={l.name} />
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
