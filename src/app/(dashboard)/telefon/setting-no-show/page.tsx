import { CallModeRunner } from "@/components/telefon/CallModeRunner";
import { getAccessContext } from "@/lib/access";
import { loadPhoneNoShowLeads } from "@/lib/settingNoShowData";
import { createClient } from "@/lib/supabase/server";
import { loadTelefonHeute } from "@/lib/telefonHeute";
import { notFound } from "next/navigation";

// „Setting No-Show" (Telefon): alle Telefon-Leads, die terminiert wurden und
// zum Erstgespräch nicht erschienen sind — zum erneuten Anrufen im Call-Mode.
//
// Eine ABGELEITETE Liste, keine Zeile in `phone_lists` (src/lib/settingNoShow.ts):
// Wer hier steht, entscheidet das Setting, nicht ein Umzug des Leads. Die Leads
// bleiben in ihrer Heimatliste; der Call-Mode arbeitet über deren `list_id`.
// Raus kommt ein Lead über jedes Ergebnis im Call-Mode (neuer Termin, Rückruf,
// Nicht erreicht, Kein Termin, Tot) oder über das Setting selbst.
//
// NUR DIE EIGENEN: Termin selbst gelegt UND Lead in der eigenen Liste
// (`gehoertMir`, src/lib/settingNoShow.ts). Auch ein Owner mit Team-Sicht sieht
// hier nicht die No-Shows der Kollegen — dafür stellt er deren Datensicht ein.

export const dynamic = "force-dynamic";

export default async function SettingNoShowPhonePage() {
  const access = await getAccessContext();
  if (!access) notFound();

  const leads = await loadPhoneNoShowLeads(access);
  const owner = access.effective_username ?? access.username;
  const heute = await loadTelefonHeute(access, await createClient());

  // Der Call-Modus bringt seine Kopfleiste mit (Redesign Phase 5); die
  // Erklärung, wer hier steht, ist die zweite Zeile darin.
  return (
    <CallModeRunner
      leads={leads}
      titel="Setting No-Show"
      untertitel={`${owner} · Erstgespräch nicht erschienen`}
      exitHref="/telefon"
      heute={heute}
      empty={{
        title: "Keine No-Shows",
        text: "Sobald ein Erstgespräch aus der Telefonakquise auf „Nicht erschienen“ gesetzt wird, steht der Lead hier.",
      }}
    />
  );
}
