import { getTargets } from "@/app/actions/targets";
import { berlinWindowIso } from "@/components/dashboard/periodWindow";
import type { AccessContext } from "@/lib/access";
import { berlinDateISO } from "@/lib/apptTime";
import { loadDialRows } from "@/lib/phoneAttemptsData";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import type { createClient } from "@/lib/supabase/server";
import { resolveTarget } from "@/lib/targets";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Die drei Zähler in der Kopfleiste des Call-Modus — für HEUTE und für genau
 * eine Person (eingestellte Datensicht, sonst die angemeldete).
 *
 * Dieselben Definitionen wie die Telefon-Übersicht (PhoneDashboard) und die
 * Analyse, damit „Zähler und Analyse stimmen für denselben Tag überein":
 *   · Anwahlen    = Zeilen in `phone_call_attempts` (eine Zeile = ein
 *                   Wählversuch), Person über den Listen-Owner-Snapshot.
 *   · Entscheider = Anwahlen mit Snapshot `decider_reached` ODER Ergebnis
 *                   Termin/Kein Termin (beides setzt ihn voraus, N5).
 *   · Termine     = heute GELEGTE Telefon-Termine (`setting_calls.created_at`,
 *                   `source_type='telefon'`, Person = Zuweisung, E1).
 *
 * `null`, wenn das Anruf-Log fehlt: lieber kein Zähler als eine erfundene 0.
 */
export type TelefonHeute = {
  anwahlen: number;
  entscheider: number;
  termine: number;
  /** Tagesziel Anwahlen aus `performance_targets` (ohne Eintrag der App-Default). */
  tagesziel: number;
};

export async function loadTelefonHeute(access: AccessContext, supabase: Client): Promise<TelefonHeute | null> {
  const today = berlinDateISO(new Date().toISOString());
  const userId = access.effective_user_id ?? access.user.id;
  const username = access.effective_username ?? access.username;
  const { startIso, endIso } = berlinWindowIso(today, today);
  try {
    const [targets, dials, appts] = await Promise.all([
      getTargets().catch(() => []),
      loadDialRows(supabase, access.workspace_id, today, today, { username, userId }),
      fetchAllRows((f, t) =>
        supabase
          .from("setting_calls")
          .select("id")
          .eq("workspace_id", access.workspace_id)
          .eq("source_type", "telefon")
          .gte("created_at", startIso)
          .lt("created_at", endIso)
          .or(`assigned_user_id.eq.${userId},and(assigned_user_id.is.null,created_by_user_id.eq.${userId})`)
          .order("id")
          .range(f, t),
      ).catch(() => []),
    ]);
    if (!dials.available) return null;
    let entscheider = 0;
    for (const d of dials.rows) {
      if (d.decider_reached || d.outcome === "termin" || d.outcome === "kein_termin") entscheider += 1;
    }
    return {
      anwahlen: dials.rows.length,
      entscheider,
      termine: appts.length,
      tagesziel: resolveTarget(targets, userId, "telefon", "daily", "calls"),
    };
  } catch {
    return null;
  }
}
