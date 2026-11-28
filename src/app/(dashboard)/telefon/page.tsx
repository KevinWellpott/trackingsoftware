import { TelefonUebersicht } from "@/components/telefon/TelefonUebersicht";

// /telefon — nur die eigenen Listen und die eigenen Zahlen (28.11.). Das
// Gesamtbild steht unter /telefon/team.

export default async function TelefonPage({ searchParams }: { searchParams: Promise<{ zeitraum?: string }> }) {
  const sp = await searchParams;
  return <TelefonUebersicht team={false} zeitraumRaw={sp.zeitraum} />;
}
