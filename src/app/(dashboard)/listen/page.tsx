import { restoreListForm } from "@/app/actions/lists";
import { ListenTabs, type ListenTab } from "@/components/listen/ListenTabs";
import { EmptyState, PageHeader } from "@/components/ui/PageHeader";
import { getAccessContext, ownScopeFilter } from "@/lib/access";
import { localDateISO } from "@/lib/dates";
import { ownerColor } from "@/lib/ownerColor";
import { createClient } from "@/lib/supabase/server";
import { CalendarCheck, Inbox, MessageSquare, RotateCcw, Users } from "lucide-react";
import Link from "next/link";

// Listen-Uebersicht.
//
// Bisher gab es keinen Ort, an dem man alle LinkedIn-Listen auf einmal sieht —
// sie existierten ausschliesslich in der Sidebar. Archivierte Listen lagen
// zudem unter /team/archiv und waren damit fuer alle ohne Owner-Rolle
// unerreichbar. Diese Seite ist beides: Uebersicht und persoenliches Archiv.
//
// /team/archiv bleibt bestehen — dort sieht ein Owner das Archiv des GESAMTEN
// Workspace, hier sieht jeder sein eigenes.

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
  // Workspace-Datensicht sieht hier alle Listen — dieselbe Regel wie ueberall.
  const scope = ownScopeFilter(access);
  let listsQuery = supabase
    .from("lists")
    .select("id, name, owner_name, archived_at")
    .eq("workspace_id", access.workspace_id)
    .order("sort_order", { ascending: true });
  if (scope) listsQuery = listsQuery.or(scope);

  // Zaehler in EINER Abfrage statt einer pro Karte. Nur die sechs Spalten, die
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
    const cur = counts.get(c.list_id) ?? { kontakte: 0, faellig: 0, termine: 0 };
    cur.kontakte += 1;
    if (c.appointment_set === true) cur.termine += 1;
    // Identische Bedingung wie isDueFollowUp im Board und wie nachfassen_tasks —
    // sonst widersprechen sich die Zahlen zwischen den Ansichten.
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

  const gesamtKontakte = aktiv.reduce((n, l) => n + (counts.get(l.id)?.kontakte ?? 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <PageHeader
        eyebrow="LinkedIn"
        title="Listen"
        meta={`${aktiv.length} aktive Listen · ${gesamtKontakte.toLocaleString("de-DE")} Kontakte`}
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
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "var(--sp-6)",
          }}
        >
          {shown.map((l) => {
            const c = counts.get(l.id) ?? { kontakte: 0, faellig: 0, termine: 0 };
            const oc = l.owner_name ? ownerColor(l.owner_name) : null;

            const head = (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", minWidth: 0 }}>
                  <MessageSquare size={14} style={{ color: "var(--stage-linkedin)", flexShrink: 0 }} />
                  <span
                    style={{
                      fontSize: "var(--fs-md)",
                      fontWeight: 600,
                      letterSpacing: "var(--ls-tight)",
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {l.name}
                  </span>
                </div>
                {l.owner_name && oc && (
                  <span
                    style={{
                      fontSize: "var(--fs-2xs)",
                      fontWeight: 600,
                      color: oc.fg,
                      background: oc.bg,
                      border: `1px solid color-mix(in srgb, ${oc.fg} 33%, transparent)`,
                      padding: "1px 8px",
                      borderRadius: "var(--r-full)",
                      alignSelf: "flex-start",
                    }}
                  >
                    {l.owner_name}
                  </span>
                )}
              </>
            );

            if (tab === "archiviert") {
              return (
                <div key={l.id} className="card" style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
                  {head}
                  <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>
                    Archiviert am {formatDate(l.archived_at as string)}
                  </span>
                  <form action={restoreListForm} style={{ marginTop: "auto" }}>
                    <input type="hidden" name="list_id" value={l.id} />
                    <button type="submit" className="btn-secondary" style={{ width: "100%" }}>
                      <RotateCcw size={14} /> Wiederherstellen
                    </button>
                  </form>
                </div>
              );
            }

            return (
              <Link key={l.id} href={`/lists/${l.id}`} style={{ textDecoration: "none" }} className="organic-list-card-link">
                <div
                  className="card organic-list-card"
                  style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", height: "100%" }}
                >
                  {head}
                  <div style={{ display: "flex", gap: "var(--sp-7)", marginTop: "auto", flexWrap: "wrap" }}>
                    <Stat icon={<Users size={12} />} label="Kontakte" value={c.kontakte} />
                    {/* Faellige FUs sind der einzige Wert hier, der eine Handlung
                        verlangt — nur er traegt Warnfarbe, und nur wenn > 0. */}
                    <Stat
                      icon={<Inbox size={12} />}
                      label="Fällig"
                      value={c.faellig}
                      tone={c.faellig > 0 ? "warning" : undefined}
                    />
                    <Stat icon={<CalendarCheck size={12} />} label="Termine" value={c.termine} />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "warning";
}) {
  const color = tone === "warning" ? "var(--warning-fg)" : "var(--text-primary)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--sp-3)",
          fontSize: "var(--fs-2xs)",
          color: "var(--text-muted)",
        }}
      >
        {icon} {label}
      </span>
      <span className="tnum" style={{ fontSize: "var(--fs-lg)", fontWeight: 600, color }}>
        {value.toLocaleString("de-DE")}
      </span>
    </div>
  );
}
