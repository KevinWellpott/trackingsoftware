import { ListBoardV2 } from "@/components/ListBoardV2";
import { PageHeader } from "@/components/ui/PageHeader";
import { getAccessContext } from "@/lib/access";
import { loadLinkedInNoShowContacts } from "@/lib/settingNoShowData";
import { notFound } from "next/navigation";

// „Setting No-Show" (LinkedIn): alle LinkedIn-Kontakte, die terminiert wurden
// und zum Erstgespräch nicht erschienen sind — zum erneuten Anschreiben.
//
// Das Gegenstück zu /telefon/setting-no-show und nach derselben Regel
// ABGELEITET (src/lib/settingNoShow.ts): keine Liste in `lists`, kein Umzug
// des Kontakts. Das Board läuft wie bei den Smart Views mit `listId={null}` —
// Bearbeiten, Termin, Blockieren laufen über die `list_id` des Kontakts.
// Ein neuer Termin über das Board setzt das Setting zurück auf „offen"
// (`convertContactToSetting`), und der Kontakt verschwindet von hier.
//
// `?owner=<username>` schneidet auf eine Person, ohne Parameter gilt die
// aktive Datensicht.

export const dynamic = "force-dynamic";

export default async function SettingNoShowLinkedInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await getAccessContext();
  if (!access) notFound();
  const owner = (await searchParams).owner?.trim() || null;

  const all = await loadLinkedInNoShowContacts(access);
  const contacts = owner ? all.filter((c) => c.owner_name === owner) : all;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <PageHeader
        eyebrow="LinkedIn"
        title="Setting No-Show"
        meta={`${contacts.length.toLocaleString("de-DE")} Kontakte${owner ? ` · ${owner}` : ""} · terminiert, Erstgespräch auf „Nicht erschienen" — ein neuer Termin oder „Tot" nimmt sie von der Liste`}
      />
      <ListBoardV2 listId={null} contacts={contacts} />
    </div>
  );
}
