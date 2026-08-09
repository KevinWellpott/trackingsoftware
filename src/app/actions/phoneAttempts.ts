"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import type { PhoneCallKind, PhoneCallOutcome } from "@/lib/types";

/**
 * Anruf-Ereignis-Log (Tabelle `phone_call_attempts`, Migration 0028).
 *
 * Vorher gab es kein Anruf-Ereignis: "Anwahlen" zählte Leads mit Erstkontakt,
 * und `phone_leads.call_attempt` wurde im Call-Modus von Hand gesetzt. Damit
 * war "lohnt es sich, Mailboxen nochmal anzurufen, oder lieber neue Leads
 * scrapen?" strukturell nicht beantwortbar — man konnte Leads zählen, aber
 * keine Anrufe.
 *
 * FAIL-SOFT: Das Protokollieren darf das Speichern eines Call-Ergebnisses
 * NIEMALS verhindern. Ein fehlgeschlagener Log-Eintrag (Migration noch nicht
 * eingespielt, RLS, Netzwerk) wird geloggt und verschluckt — der Setter soll
 * nicht mitten im Telefonat vor einer Fehlermeldung sitzen. Der Aufrufer
 * behandelt das Ergebnis entsprechend als Zusatzinformation, nicht als
 * Erfolgsbedingung.
 */

export type LogCallAttemptInput = {
  leadId: string;
  /** Ergebnis des Anrufs — 1:1 die Outcome-Buttons im Call-Modus. */
  outcome: PhoneCallOutcome;
  /** Optionaler Zeitpunkt (ISO). Ohne Angabe: jetzt. */
  calledAt?: string;
  /**
   * Lead-Status VOR dem Update, das dieser Anruf ausgeloest hat.
   *
   * Der Topf (`kind`) beschreibt, was dieser Anruf WAR, nicht was er bewirkt
   * hat. Wird er aus dem Stand NACH dem Update abgeleitet, zaehlt der Anruf,
   * in dem ein Rueckruf VEREINBART wird, als 'rueckruf' — und der spaeter
   * tatsaechlich gefuehrte Rueckruf als 'folgeanruf', weil sein Outcome den
   * Status wegdreht. Beide Toepfe waeren gegeneinander verschoben, und genau
   * sie stellt die Auswertung "Nachfassen oder neue Leads?" gegenueber.
   *
   * Ohne Angabe wird auf den aktuellen Stand zurueckgefallen.
   */
  statusBefore?: string | null;
};

export type LogCallAttemptResult = {
  /** Laufende Nummer dieses Anrufs beim Lead — nur bei Erfolg gesetzt. */
  attemptNo?: number;
  kind?: PhoneCallKind;
  /** Gesetzt, wenn nicht protokolliert werden konnte. Kein Grund abzubrechen. */
  error?: string;
};

export async function logCallAttempt(
  input: LogCallAttemptInput,
): Promise<LogCallAttemptResult> {
  try {
    const access = await getAccessContext();
    if (!access) return { error: "Nicht angemeldet." };

    const supabase = await createClient();

    // Der Lead liefert Listenbezug und die Flow-Antworten, die unmittelbar
    // davor per setAndSave geschrieben wurden. Der Snapshot friert sie im
    // Ereignis ein: Der Lead selbst wird bei jedem weiteren Anruf überschrieben.
    const { data: lead } = await supabase
      .from("phone_leads")
      .select(
        "id, list_id, workspace_id, status, mailbox, gatekeeper_reached, decider_reached, pitch_delivered",
      )
      .eq("id", input.leadId)
      .eq("workspace_id", access.workspace_id)
      .maybeSingle();

    if (!lead) return { error: "Lead nicht gefunden." };

    const leadRow = lead as {
      id: string;
      list_id: string;
      workspace_id: string;
      status: string | null;
      mailbox: boolean | null;
      gatekeeper_reached: string | null;
      decider_reached: boolean | null;
      pitch_delivered: boolean | null;
    };

    // owner_name als Snapshot: Der Lead wandert bei Rückruf/Nicht-erreicht
    // physisch in eine Routing-Liste. Ein Join über die AKTUELLE Liste würde
    // die Historie rückwirkend umschreiben.
    const { data: list } = await supabase
      .from("phone_lists")
      .select("owner_name")
      .eq("id", leadRow.list_id)
      .maybeSingle();

    // attempt_no strikt serverseitig — nie aus dem Client, sonst zählt ein
    // Doppelklick zweimal dieselbe Nummer.
    const { data: last } = await supabase
      .from("phone_call_attempts")
      .select("attempt_no")
      .eq("lead_id", leadRow.id)
      .order("attempt_no", { ascending: false })
      .limit(1)
      .maybeSingle();

    const attemptNo = ((last as { attempt_no: number } | null)?.attempt_no ?? 0) + 1;

    // Der Topf entscheidet die Auswertung "Nachfassen vs. neue Leads":
    // Ein Rückruf ist ein terminierter Zweitanruf, ein Folgeanruf ein
    // erneuter Versuch ohne Verabredung. Maßgeblich ist der Stand VOR dem
    // Outcome (siehe statusBefore) — der aktuelle Lead-Stand ist nur der
    // Rückfall, wenn der Aufrufer ihn nicht mitgibt.
    const statusForKind =
      input.statusBefore !== undefined ? input.statusBefore : leadRow.status;
    const kind: PhoneCallKind =
      attemptNo === 1 ? "erstanruf" : statusForKind === "rueckruf" ? "rueckruf" : "folgeanruf";

    const { error } = await supabase.from("phone_call_attempts").insert({
      workspace_id: access.workspace_id,
      created_by_user_id: access.user.id,
      lead_id: leadRow.id,
      list_id: leadRow.list_id,
      owner_name: (list as { owner_name: string | null } | null)?.owner_name ?? null,
      called_at: input.calledAt ?? new Date().toISOString(),
      attempt_no: attemptNo,
      kind,
      outcome: input.outcome,
      mailbox: leadRow.mailbox === true,
      gatekeeper_reached: leadRow.gatekeeper_reached,
      decider_reached: leadRow.decider_reached,
      pitch_delivered: leadRow.pitch_delivered,
      source: "app",
    });

    if (error) {
      console.error("[logCallAttempt] insert fehlgeschlagen:", error.message);
      return { error: error.message };
    }

    // call_attempt denormalisiert nachziehen (max. 3 wegen CHECK). Hält den
    // Telefon-Tab und den CSV-Export unverändert lauffähig, während das Log
    // die genaue Zahl trägt.
    await supabase
      .from("phone_leads")
      .update({ call_attempt: Math.min(attemptNo, 3) })
      .eq("id", leadRow.id);

    return { attemptNo, kind };
  } catch (e) {
    // Siehe FAIL-SOFT oben: nie den Call-Flow blockieren.
    const message = e instanceof Error ? e.message : "Unbekannter Fehler";
    console.error("[logCallAttempt] unerwartet:", message);
    return { error: message };
  }
}
