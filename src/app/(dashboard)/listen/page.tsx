import { restoreListForm } from "@/app/actions/lists";
import { ListenTabs, type ListenTab } from "@/components/listen/ListenTabs";
import { EmptyState, PageHeader } from "@/components/ui/PageHeader";
import { getAccessContext, ownScopeFilter } from "@/lib/access";
import { localDateISO } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { Inbox, RotateCcw } from "lucide-react";
import Link from "next/link";

// Listen-Uebersicht.
//
// Bisher gab es keinen Ort, an dem man alle LinkedIn-Listen auf einmal sieht —
// sie existierten ausschliesslich in der Sidebar. Archivierte Listen lagen
// zudem unter /team/archiv und waren fuer alle ohne Owner-Rolle unerreichbar.
//
// Darstellung als dichte TABELLE, nicht als Karten: die Seite dient dem
// Vergleich („wo liegt am meisten liegen?"). Karten stellen jede Liste einzeln
// dar und zwingen die Zahlen in kleine Bloecke, die untereinander nicht
// fluchten — genau daran war die erste Fassung unlesbar.
//
// FARBEN: nur Rot, Gruen, Grau/Weiss und Orange.
//   Faellig  = Rot   (verlangt Handlung)
//   Termine  = Gruen (erreichtes Ergebnis)
//   alles Uebrige = Grau/Weiss, Orange bleibt der Akzent (aktiver Reiter).
// Dieselbe Zuordnung wie auf der Listen-Detailseite. Owner-Farben (sechs
// Hues aus ownerColor) sind hier bewusst NICHT im Einsatz.

export const dynamic = "force-dynamic";

type ListRow = {
  id: string;
  name: string;
  owner_name: string | null;
  archived_at: string | null;
};

type ContactRow = {
  list_id: string | null;
  next_follow_up_at: string | null;
  answered: boolean | null;
  appointment_set: boolean | null;
  follow_up_number: number | null;
  blocked_at: string | null;
};

type Counts = { kontakte: number; faellig: number; termine: number };

const EMPTY: Counts = { kontakte: 0, faellig: 0, termine: 0 };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default async function ListenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const tab: ListenTab = sp.tab === "archiviert" ? "archiviert" : "aktiv";

  const access = await getAccessContext();
  if (!access) return null;

  const supabase = await createClient();
  const today = localDateISO();

  // Personenfilter nur, wenn der Zugriff eingeschraenkt ist. Ein Owner mit
  // Workspace-Datensicht sieht alle Listen — dieselbe Regel wie ueberall.
  const scope = ownScopeFilter(access);
  let listsQuery = supabase
    .from("lists")
    .select("id, name, owner_name, archived_at")
    .eq("workspace_id", access.workspace_id)
    .order("sort_order", { ascending: true });
  if (scope) listsQuery = listsQuery.or(scope);

  // Zaehler in EINER Abfrage statt einer pro Zeile. Nur die sechs Spalten, die
  // isDueFollowUp braucht — RLS beschraenkt die Menge bereits auf den Scope.
  const contactsQuery = supabase
    .from("contacts")
    .select("list_id, next_follow_up_at, answered, appointment_set, follow_up_number, blocked_at")
    .eq("workspace_id", access.workspace_id);

  const [{ data: listData }, { data: contactData }] = await Promise.all([listsQuery, contactsQuery]);

  const lists = (listData ?? []) as ListRow[];
  const contacts = (contactData ?? []) as ContactRow[];

  const counts = new Map<string, Counts>();
  for (const c of contacts) {
    if (!c.list_id) continue;
    const cur = counts.get(c.list_id) ?? { ...EMPTY };
    cur.kontakte += 1;
    if (c.appointment_set === true) cur.termine += 1;
    // Exakt die Bedingung aus isDueFollowUp und nachfassen_tasks — weicht sie
    // ab, widersprechen sich die Zahlen zwischen den Ansichten.
    if (
      c.next_follow_up_at != null &&
      c.next_follow_up_at <= today &&
      c.answered !== true &&
      c.appointment_set !== true &&
      c.follow_up_number !== 3 &&
      c.blocked_at == null
    ) {
      cur.faellig += 1;
    }
    counts.set(c.list_id, cur);
  }

  const aktiv = lists.filter((l) => !l.archived_at);
  const archiviert = lists
    .filter((l) => l.archived_at)
    .sort((a, b) => (b.archived_at ?? "").localeCompare(a.archived_at ?? ""));
  const shown = tab === "aktiv" ? aktiv : archiviert;

  const summe = aktiv.reduce<Counts>(
    (acc, l) => {
      const c = counts.get(l.id) ?? EMPTY;
      return {
        kontakte: acc.kontakte + c.kontakte,
        faellig: acc.faellig + c.faellig,
        termine: acc.termine + c.termine,
      };
    },
    { ...EMPTY },
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <PageHeader
        eyebrow="LinkedIn"
        title="Listen"
        meta={
          <span style={{ display: "inline-flex", gap: "var(--sp-6)", flexWrap: "wrap" }}>
            <span>{aktiv.length} aktive Listen</span>
            <span>{summe.kontakte.toLocaleString("de-DE")} Kontakte</span>
            {summe.faellig > 0 && (
              <span style={{ color: "var(--danger-fg)", fontWeight: 500 }}>
                {summe.faellig.toLocaleString("de-DE")} fällig
              </span>
            )}
          </span>
        }
      >
        <ListenTabs tab={tab} counts={{ aktiv: aktiv.length, archiviert: archiviert.length }} />
      </PageHeader>

      {shown.length === 0 ? (
        <EmptyState
          icon={<Inbox size={28} style={{ color: "var(--text-disabled)" }} />}
          message={
            tab === "aktiv"
              ? "Noch keine Listen. Lege in der Seitenleiste unter LinkedIn deine erste an."
              : "Keine archivierten Listen."
          }
        />
      ) : (
        // Schmale Fenster: die Tabelle scrollt in sich, die Seite nie horizontal.
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Liste</th>
                <th>Inhaber</th>
                {tab === "aktiv" ? (
                  <>
                    <th className="num">Kontakte</th>
                    <th className="num">Fällig</th>
                    <th className="num">Termine</th>
                  </>
                ) : (
                  <>
                    <th>Archiviert</th>
                    <th />
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => {
                const c = counts.get(l.id) ?? EMPTY;
                return (
                  <tr key={l.id}>
                    <td style={{ maxWidth: 320 }}>
                      {tab === "aktiv" ? (
                        <Link
                          href={`/lists/${l.id}`}
                          className="listen-name"
                          style={{
                            display: "block",
                            fontWeight: 500,
                            color: "var(--text-primary)",
                            textDecoration: "none",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {l.name}
                        </Link>
                      ) : (
                        <span style={{ color: "var(--text-secondary)" }}>{l.name}</span>
                      )}
                    </td>
                    <td style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", whiteSpace: "nowrap" }}>
                      {l.owner_name ?? "—"}
                    </td>

                    {tab === "aktiv" ? (
                      <>
                        <td className="num" style={{ color: "var(--text-secondary)" }}>
                          {c.kontakte.toLocaleString("de-DE")}
                        </td>
                        {/* Nur die Null ist still. Alles darueber verlangt eine
                            Handlung und traegt deshalb Rot. */}
                        <td
                          className="num"
                          style={{
                            color: c.faellig > 0 ? "var(--danger-fg)" : "var(--text-disabled)",
                            fontWeight: c.faellig > 0 ? 600 : 400,
                          }}
                        >
                          {c.faellig.toLocaleString("de-DE")}
                        </td>
                        <td
                          className="num"
                          style={{
                            color: c.termine > 0 ? "var(--success-fg)" : "var(--text-disabled)",
                            fontWeight: c.termine > 0 ? 600 : 400,
                          }}
                        >
                          {c.termine.toLocaleString("de-DE")}
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", whiteSpace: "nowrap" }}>
                          {formatDate(l.archived_at as string)}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <form action={restoreListForm}>
                            <input type="hidden" name="list_id" value={l.id} />
                            <button type="submit" className="btn-secondary" style={{ whiteSpace: "nowrap" }}>
                              <RotateCcw size={14} /> Wiederherstellen
                            </button>
                          </form>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>

            {tab === "aktiv" && shown.length > 1 && (
              <tfoot>
                <tr>
                  <td style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)" }}>Gesamt</td>
                  <td />
                  <td className="num" style={{ color: "var(--text-secondary)" }}>
                    {summe.kontakte.toLocaleString("de-DE")}
                  </td>
                  <td className="num" style={{ color: summe.faellig > 0 ? "var(--danger-fg)" : "var(--text-disabled)" }}>
                    {summe.faellig.toLocaleString("de-DE")}
                  </td>
                  <td className="num" style={{ color: summe.termine > 0 ? "var(--success-fg)" : "var(--text-disabled)" }}>
                    {summe.termine.toLocaleString("de-DE")}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
