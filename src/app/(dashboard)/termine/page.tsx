import type { ReactNode } from "react";
import { TermineBoard } from "@/components/termine/TermineBoard";
import { TerminBuchenAktion } from "@/components/termine/TerminBuchenAktion";
import { getAccessContext, listDataViewUsers, matchesOwnScope } from "@/lib/access";
import { berlinDateISO } from "@/lib/apptTime";
import { ownerUserIdOfList } from "@/lib/personResolution";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import type { RueckrufAufgabe } from "@/lib/termine";
import type { ClosingCall, SettingCall } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { InfoPopover } from "@/components/ui/InfoPopover";

// Die Arbeitsfläche: Setting- und Closing-Calls als Arbeitsliste (Vorgabe),
// als Kalender (Monat / Woche / Tag) und daneben die fälligen Telefon-Rückrufe.
// Alle drei Mengen werden komplett geladen und clientseitig gefiltert —
// Navigation und Ansichtswechsel bleiben dadurch ohne Server-Roundtrip. (Für
// größere Datenmengen existieren die Range-Indizes idx_setting_calls_ws_appt /
// idx_closing_calls_ws_call_at.)
//
// Die Personen-Zuordnung kommt seit Migration 0028 als `assigned_user_id` mit
// dem normalen Select mit. Vorher liefen dafür zwei zusätzliche Volldurchläufe
// über `call_assignees` (polymorph, ohne Fremdschlüssel → nicht einbettbar),
// deren Ergebnis im Speicher gruppiert wurde. Den Namen liefert die ohnehin
// geladene Mitgliederliste.
//
// ⚠ DIE BEIDEN TERMIN-ABFRAGEN LADEN MIT `select("*")`, UND DAS MUSS SO BLEIBEN.
// Die Arbeitsliste liest `follow_up_last_contacted_at`/`_by_user_id` aus
// Migration 0041 — geschrieben, aber noch nicht überall eingespielt. Eine
// namentlich selektierte fehlende Spalte lässt PostgREST die GANZE Abfrage
// abweisen; die Seite wäre leer statt unvollständig (dieselbe Falle wie bei
// 0029 und 0032, docs §7). Mit `*` kommen die Felder einfach nicht mit,
// `undefined` heißt „noch nie nachgefasst", und alles andere funktioniert.

export const dynamic = "force-dynamic";

/**
 * Datensicht-Filter: „zugewiesen ODER (nicht zugewiesen UND selbst angelegt)".
 *
 * Dieselbe Reihenfolge wie `personOf()` (src/lib/personResolution.ts) und
 * `buildOwnScope()` für Listen. Ein reiner `created_by_user_id`-Filter würde
 * jeden Termin, den jemand FÜR eine andere Person gelegt hat, aus der Sicht des
 * Zuständigen verschwinden lassen — er stünde nur beim Ersteller, der ihn gar
 * nicht bearbeitet. Deckungsgleich mit den RLS-Policies aus Migration 0028 §5.
 */
function personScope(userId: string): string {
  return `assigned_user_id.eq.${userId},and(assigned_user_id.is.null,created_by_user_id.eq.${userId})`;
}

/* ------------------------------------------------------------------ *
 * Telefon-Rückrufe
 * ------------------------------------------------------------------ */

type LeadRow = {
  id: string;
  company: string | null;
  decider_name: string | null;
  phone: string | null;
  callback_at: string | null;
  list_id: string | null;
};

type ListRow = {
  id: string;
  name: string | null;
  owner_name: string | null;
  created_by_user_id: string | null;
};

/**
 * Fällige Rückrufe für den dritten Reiter — bewusst HIER geladen und nicht über
 * `actions/nachfassen.ts`: Die Frage ist dieselbe, aber die Zuständigkeit für
 * diese Seite liegt hier, und ein zweiter Aufrufer einer Board-Action wäre eine
 * Kopplung zwischen zwei Bereichen, die sonst nichts miteinander zu tun haben.
 *
 * Zwei einfache Abfragen statt eines eingebetteten Selects: `phone_leads` trägt
 * den Owner nicht, der steht an der LISTE (`list_owned_by_user()`, docs §2).
 * Der Join in JS kostet nichts (Telefonlisten sind eine Handvoll Zeilen) und
 * erspart der Seite eine PostgREST-Einbettung, deren Rückgabeform sich je nach
 * Version zwischen Objekt und Array unterscheidet.
 *
 * Der Personenfilter läuft über `matchesOwnScope` — dieselbe Regel wie der
 * PostgREST-Filter `buildOwnScope`, nur in JS. `owner_name` hat Vorrang vor dem
 * Ersteller: Eine Liste, die ein Admin FÜR ein Mitglied angelegt hat, gehört
 * dem Mitglied.
 */
async function ladeRueckrufe(
  workspaceId: string,
  access: Awaited<ReturnType<typeof getAccessContext>>,
  usernameToUserId: Map<string, string>,
): Promise<RueckrufAufgabe[]> {
  const supabase = await createClient();
  const [leads, lists] = await Promise.all([
    fetchAllRows<LeadRow>((from, to) =>
      supabase
        .from("phone_leads")
        .select("id, company, decider_name, phone, callback_at, list_id")
        .eq("workspace_id", workspaceId)
        .eq("status", "rueckruf")
        .not("callback_at", "is", null)
        .order("callback_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows<ListRow>((from, to) =>
      supabase
        .from("phone_lists")
        .select("id, name, owner_name, created_by_user_id")
        .eq("workspace_id", workspaceId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const byId = new Map(lists.map((l) => [l.id, l]));
  const aufgaben: RueckrufAufgabe[] = [];
  for (const lead of leads) {
    if (!lead.callback_at) continue;
    const list = lead.list_id ? byId.get(lead.list_id) : undefined;
    // Ein Lead ohne auffindbare Liste hat keinen Owner und damit keinen Platz
    // in einer persönlichen Liste — er fällt weg, statt allen zu erscheinen.
    if (!list) continue;
    if (access && !matchesOwnScope(access, list)) continue;
    const ownerUserId = ownerUserIdOfList(list, usernameToUserId);
    aufgaben.push({
      id: lead.id,
      company: lead.company,
      decider: lead.decider_name,
      phone: lead.phone,
      callbackAt: lead.callback_at,
      listId: list.id,
      listName: list.name,
      ownerUserId,
      ownerName: list.owner_name,
    });
  }
  return aufgaben;
}

/* ------------------------------------------------------------------ *
 * Legende
 * ------------------------------------------------------------------ */

/**
 * Ein Kalender-Chip als Muster — mit denselben `data-*`-Attributen, aus denen
 * globals.css §7 die echten Chips baut. Bewusst kein nachgebautes Kästchen: Ein
 * zweites Rezept liefe beim nächsten Farbwechsel auseinander, und eine Legende,
 * die anders aussieht als die Sache, die sie erklärt, ist schlimmer als keine.
 */
function LegendChip({
  kind,
  tone = "neutral",
  dashed = false,
  dimmed = false,
  children,
}: {
  kind: "setting" | "closing";
  tone?: string;
  dashed?: boolean;
  dimmed?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className="cal-event"
      data-size="xs"
      data-kind={kind}
      data-tone={tone}
      data-dashed={dashed}
      data-dimmed={dimmed}
      aria-hidden
      style={{ width: 58, flexShrink: 0, cursor: "default", padding: "1px 4px" }}
    >
      {children}
    </span>
  );
}

function LegendRow({ chips, text }: { chips: ReactNode; text: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}>{chips}</span>
      <span style={{ minWidth: 0 }}>{text}</span>
    </div>
  );
}

/**
 * Was ein Chip alles sagt — vier Eigenschaften auf einmal.
 *
 * Das System steht seit Runde 1 in `lib/terminMeta.ts` und in globals.css §7
 * ausführlich begründet, war aber ausschließlich dort zu lesen: Auf der Seite
 * gab es weder Legende noch Info-Icon. Am ersten Tag ist ein Kalender damit ein
 * Farbraster, das man erst durch Ausprobieren versteht.
 */
function ChipLegende() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
        <strong style={{ color: "var(--text-primary)" }}>Füllung = Art</strong>
        <LegendRow
          chips={
            <>
              <LegendChip kind="setting">Setting</LegendChip>
              <LegendChip kind="closing">Closing</LegendChip>
            </>
          }
          text="Dunkel ist ein Setting, hell ein Closing."
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
        <strong style={{ color: "var(--text-primary)" }}>Rahmen = Stand</strong>
        <LegendRow chips={<LegendChip kind="setting">10:00</LegendChip>} text="Durchgezogen: steht noch an." />
        <LegendRow
          chips={
            <LegendChip kind="setting" tone="success" dashed>
              10:00
            </LegendChip>
          }
          text="Gestrichelt: das Ergebnis steht fest."
        />
        <LegendRow
          chips={
            <LegendChip kind="setting" tone="danger" dashed dimmed>
              10:00
            </LegendChip>
          }
          text="Abgeblendet: erledigt und aus der Planung raus."
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
        <strong style={{ color: "var(--text-primary)" }}>Farbe = Ausgang</strong>
        {/* „ohne Ergebnis" statt „offen": Der Rahmen des Chips beschreibt, ob
            ein Ergebnis feststeht — „Offen" heißt in der Arbeitsliste daneben
            inzwischen etwas anderes (es steht kein Termin). Ein Wort, das auf
            derselben Seite zweierlei bedeutet, erklärt nichts mehr. */}
        <span>
          Grün weitergekommen oder gewonnen · Rot geplatzt oder verloren · Gold da muss jemand ran · Grau noch
          ohne Ergebnis.
        </span>
      </div>

      <span>
        Ausgeblendet wird nichts — auch ein toter Lead bleibt sichtbar und anklickbar, nur zurückgenommen.
      </span>
    </div>
  );
}

export default async function TerminePage() {
  const access = await getAccessContext();
  if (!access) return null;

  const supabase = await createClient();

  // fetchAllRows: ohne order/range cappt PostgREST bei 1000 Zeilen.
  const [settings, closings, members] = await Promise.all([
    fetchAllRows<SettingCall>((from, to) => {
      let q = supabase.from("setting_calls").select("*").eq("workspace_id", access.workspace_id);
      if (access.effective_user_id) q = q.or(personScope(access.effective_user_id));
      return q
        .order("appointment_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to);
    }),
    fetchAllRows<ClosingCall>((from, to) => {
      let q = supabase.from("closing_calls").select("*").eq("workspace_id", access.workspace_id);
      if (access.effective_user_id) q = q.or(personScope(access.effective_user_id));
      return q
        .order("call_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to);
    }),
    listDataViewUsers(access.workspace_id).catch(() => []),
  ]);

  const usernameToUserId = new Map(members.map((m) => [m.username, m.user_id]));
  // `available`-Rückfall wie bei `loadCallAttempts` (docs §5.1): Eine
  // gescheiterte Abfrage darf nicht wie „keine Rückrufe" aussehen — und schon
  // gar nicht die ganze Seite mitnehmen, deren Hauptaufgabe woanders liegt.
  const rueckrufe = await ladeRueckrufe(access.workspace_id, access, usernameToUserId).catch(() => null);

  // ⚠ „HEUTE" KOMMT VOM SERVER UND IST BERLIN — beides ist tragend.
  //
  // Das Board rechnete seinen Tag bis hierher browser-lokal (`localDateISO()`).
  // Auf Vercel läuft der Server in UTC: Zwischen etwa 22:00 Berliner Zeit und
  // Mitternacht lieferte er den VORTAG, der Browser den richtigen Tag. Das ist
  // erstens ein Hydrations-Unterschied und zweitens ein fachlicher Fehler in
  // genau dem Fenster — die Gold-Regel darunter bucketet den Nachfass-Stempel
  // über `berlinDateISO` (lib/dranRegel.ts), also hielt der Server eine heute
  // gestempelte Zeile für „gestern" und ließ sie wieder leuchten, während ein
  // gestriger Termin als „Verlegt" durchging.
  //
  // Europe/Berlin ist eine Produktgrenze, keine Einstellung (docs §6), und
  // apptTime.ts ist ihre einzige Konvertierungsstelle. Dieselbe Lösung wie auf
  // /ablage: Der Tag wird einmal serverseitig bestimmt und durchgereicht — dann
  // gibt es gar keine zweite Uhr, die abweichen könnte.
  const today = berlinDateISO(new Date().toISOString());

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      {/* ── Page Header ──
          Die Legende hängt am Titel und nicht im Aktionsbereich: Dort steht mit
          der Zähl-Pille schon eine Aussage über den Bestand, das Info-Icon
          beantwortet dagegen eine Frage zum Inhalt darunter — dieselbe Stelle
          wie auf /ablage. */}
      <PageHeader
        eyebrow="Arbeitsfläche"
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" }}>
            Termine
            <InfoPopover label="Wie die Chips zu lesen sind" width={380}>
              <ChipLegende />
            </InfoPopover>
          </span>
        }
        meta="Wer liegt in der Luft, wer ist versorgt · Setting 30 min · Closing 60 min"
        // ── HIER STAND EINE ZAHL, UND SIE WIDERSPRACH DER FLÄCHE DARUNTER ──
        // „N Termine" zählte `settings.length + closings.length`, also JEDEN je
        // angelegten Termin. Der Vorgabe-Ausschnitt darunter ist „Zu tun" und
        // zeigt nur die Arbeitsmenge: morgens stand über vierzehn Zeilen die
        // Zahl 223. Dasselbe Argument, mit dem an dieser Stelle schon die
        // frühere „offen"-Zahl gefallen ist — eine Zahl, die dem Reiter darunter
        // widerspricht, ist schlimmer als keine. Ehrlich zählen ließe sie sich
        // hier gar nicht: Wer, Suche und Ausschnitt entscheiden erst im Client.
        //
        // Im Aktionsbereich steht deshalb, was dort hingehört: der eine
        // Primär-CTA dieser View (DESIGN.md §3.8). Er lag bis hierher als
        // handgebauter Gradient-Knopf in einer eigenen Zeile über der
        // Filterleiste.
        actions={<TerminBuchenAktion />}
      />

      <TermineBoard
        settings={settings}
        closings={closings}
        members={members.map((m) => ({ user_id: m.user_id, username: m.username }))}
        rueckrufe={rueckrufe ?? []}
        rueckrufeVerfuegbar={rueckrufe != null}
        today={today}
        // „Eine Liste pro Person": Vorgabe ist die persönliche Sicht. Bei
        // aktiver Datensicht ist das der Kollege, dessen Liste man abarbeitet
        // (`effective_user_id`), sonst das eigene Konto — dieselbe Regel wie bei
        // den Navigations-Zählern (docs §5.4).
        scopeUserId={access.effective_user_id ?? access.user.id}
        canSeeAll={!access.effective_user_id}
      />
    </div>
  );
}
