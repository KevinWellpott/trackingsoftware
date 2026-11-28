import { redirect } from "next/navigation";
import { TelefonUebersicht } from "@/components/telefon/TelefonUebersicht";
import { getAccessContext } from "@/lib/access";

// /telefon/team — alle Listen, Team-Zahlen und „Je Person". Nur für einen
// Owner mit Team-Sicht ohne aktive Datensicht; alle anderen sehen ohnehin nur
// ihre eigenen Zahlen und landen auf /telefon.

export default async function TelefonTeamPage({ searchParams }: { searchParams: Promise<{ zeitraum?: string }> }) {
  const access = await getAccessContext();
  if (!access) return null;
  if (!access.can_switch_view || access.effective_user_id) redirect("/telefon");
  const sp = await searchParams;
  return <TelefonUebersicht team zeitraumRaw={sp.zeitraum} />;
}
