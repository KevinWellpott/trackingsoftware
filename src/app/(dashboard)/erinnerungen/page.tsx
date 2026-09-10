import { getAccessContext, listDataViewUsers } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import {
  getDueReminderTouches,
  getOrgTemplateBundle,
  getTemplateBundles,
  type ReminderTouchWithContext,
} from "@/app/actions/reminders";
import { EMPTY_TEMPLATE_BUNDLE, type TemplateBundle } from "@/lib/messageTemplates";
import { ErinnerungenBoard, type SenderAccount } from "@/components/erinnerungen/ErinnerungenBoard";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/PageHeader";

// "Meine Erinnerungen": die fälligen Bestätigungs- und Ketten-Touches der
// Kaskade — bewusst eigenständig neben /nachfassen (dort geht es um
// Tages-Wiedervorlagen, hier um Uhrzeiten rund um einen Termin).
//
// Die Seite lädt DREI Dinge nach, die `getDueReminderTouches` nicht mitliefert,
// und zwar jeweils GEBÜNDELT über alle Karten hinweg — eine Abfrage je Ebene,
// nie eine je Karte (Muster `getTemplateBundles`, das genau deshalb eine
// Id-Liste nimmt):
//
//  1. das **Absender-Konto**: über wessen LinkedIn-Konto bzw. Telefonnummer die
//     Nachricht faktisch rausgehen muss. Das ist der Owner der QUELLLISTE
//     (`lists.owner_name` / `phone_lists.owner_name`, `owner_name` hat Vorrang —
//     docs §2) und nicht zwingend die zuständige Person am Touch.
//  2. `done_by_user_id`: „ist abgehakt" ohne „von wem" ist bei Vertretung und
//     Sammelaktion nicht handelbar. Die Spalte steht in `reminder_touches`,
//     wird von `TOUCH_COLUMNS` aber nicht mitselektiert.
//  3. die Mitglieder der Organisation für Personenfilter und Umzuweisung.
//
// Alle drei sind fail-soft: fehlt etwas (RLS, fehlende Migration), fällt die
// jeweilige Zeile weg — die Karte selbst bleibt bedienbar.

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ *
 * Absender-Konto
 * ------------------------------------------------------------------ */

/**
 * Der eingebettete Datensatz kommt je nach PostgREST-Version als Objekt oder
 * als einelementiges Array zurück. Beide Formen lesen, statt sich auf eine zu
 * verlassen — ein falscher Zugriff wäre hier lautlos `undefined`.
 */
function embeddedOwner(row: unknown, relation: "lists" | "phone_lists"): string | null {
  const node = (row as Record<string, unknown>)[relation];
  const one = Array.isArray(node) ? node[0] : node;
  const name = (one as { owner_name?: string | null } | undefined)?.owner_name;
  return name?.trim() ? name.trim() : null;
}

/**
 * Absender-Konto je Termin, geschlüsselt nach `entity_id`.
 *
 * Vier Schritte, jeder EINE Abfrage für alle Karten zusammen:
 * Closing → sein Setting (nur dort steht die Herkunft) → Quellkontakt bzw.
 * Quell-Lead → Owner der Liste. Für Quellen ohne Vorlaufkanal (Ads, Social,
 * Sonstige, manuell) gibt es kein Konto — die Karte lässt die Zeile dann weg,
 * statt eine Person zu raten.
 *
 * Diese Kette kann für einen Nutzer mit `data_scope='own'` MITTENDRIN abreißen,
 * ohne dass irgendetwas fehlschlägt: Die Zeilensicherheit auf `setting_calls`
 * kennt nur `created_by_user_id` und `assigned_user_id` (docs §2), die auf
 * `lists`/`phone_lists` nur den eigenen Besitz. Wem also ein Closing zugewiesen
 * ist, dessen Erstgespräch aber einem Kollegen gehört, der sieht die Quellzeile
 * nicht — und bekam bisher gar keine Absender-Zeile. Genau dasselbe Nichts wie
 * bei einer Quelle, die legitim kein Konto hat (Ads, Social, Sonstige). Deshalb
 * wird der Abriss jetzt als eigener Zustand zurückgegeben (`unresolved`) und
 * auf der Karte benannt. Das weicht keine Rechte auf: Zurück geht nur, DASS es
 * hier nicht ermittelbar ist — kein Name, keine Liste, keine fremde Zeile.
 */
async function loadSenderAccounts(
  workspaceId: string,
  touches: ReminderTouchWithContext[],
): Promise<Record<string, SenderAccount>> {
  const out: Record<string, SenderAccount> = {};
  /** „Kette abgerissen" — Kanal unbekannt, Konto nicht ermittelbar. */
  const UNRESOLVED: SenderAccount = { ownerName: null, kind: null, unresolved: true };
  const settingIds = new Set<string>();
  const closingIds = new Set<string>();
  for (const t of touches) {
    if (t.setting_call_id) settingIds.add(t.setting_call_id);
    if (t.closing_call_id) closingIds.add(t.closing_call_id);
  }
  if (settingIds.size === 0 && closingIds.size === 0) return out;

  try {
    const supabase = await createClient();

    // (1) Closing → Setting. Ein Closing ohne Setting-Bezug (direkt angelegt
    //     oder beim Org-Umzug gekappt) bekommt schlicht kein Konto — das ist
    //     etwas anderes als ein Closing, das wir gar nicht lesen dürfen,
    //     deshalb der Merker `closingSeen`.
    const parentOf = new Map<string, string>();
    const closingSeen = new Set<string>();
    if (closingIds.size > 0) {
      const { data } = await supabase
        .from("closing_calls")
        .select("id, setting_call_id")
        .eq("workspace_id", workspaceId)
        .in("id", [...closingIds]);
      for (const r of (data ?? []) as unknown as { id: string; setting_call_id: string | null }[]) {
        closingSeen.add(r.id);
        if (!r.setting_call_id) continue;
        parentOf.set(r.id, r.setting_call_id);
        settingIds.add(r.setting_call_id);
      }
    }

    // (2) Setting → Quellkontakt / Quell-Lead.
    const originOf = new Map<string, { contactId: string | null; leadId: string | null }>();
    if (settingIds.size > 0) {
      const { data } = await supabase
        .from("setting_calls")
        .select("id, source_contact_id, source_phone_lead_id")
        .eq("workspace_id", workspaceId)
        .in("id", [...settingIds]);
      for (const r of (data ?? []) as unknown as {
        id: string;
        source_contact_id: string | null;
        source_phone_lead_id: string | null;
      }[]) {
        originOf.set(r.id, { contactId: r.source_contact_id, leadId: r.source_phone_lead_id });
      }
    }

    const contactIds = [...new Set([...originOf.values()].map((o) => o.contactId).filter((v): v is string => Boolean(v)))];
    const leadIds = [...new Set([...originOf.values()].map((o) => o.leadId).filter((v): v is string => Boolean(v)))];

    // (3) Quelle → Owner der Liste, beide Kanäle parallel.
    const [contactRes, leadRes] = await Promise.all([
      contactIds.length > 0
        ? supabase.from("contacts").select("id, lists(owner_name)").in("id", contactIds)
        : Promise.resolve({ data: [] }),
      leadIds.length > 0
        ? supabase.from("phone_leads").select("id, phone_lists(owner_name)").in("id", leadIds)
        : Promise.resolve({ data: [] }),
    ]);

    const contactOwner = new Map<string, string | null>();
    for (const r of (contactRes.data ?? []) as unknown as { id: string }[]) {
      contactOwner.set(r.id, embeddedOwner(r, "lists"));
    }
    const leadOwner = new Map<string, string | null>();
    for (const r of (leadRes.data ?? []) as unknown as { id: string }[]) {
      leadOwner.set(r.id, embeddedOwner(r, "phone_lists"));
    }

    // (4) Auf die Termine zurückspielen — für ein Closing über sein Setting.
    //     Drei Ausgänge, die vorher alle „keine Zeile" hießen: aufgelöst ·
    //     legitim kein Konto · nicht ermittelbar.
    for (const t of touches) {
      const settingId = t.setting_call_id ?? (t.closing_call_id ? parentOf.get(t.closing_call_id) : undefined);
      if (!settingId) {
        // Kein Setting in der Hand: Entweder das Closing hat wirklich keines
        // (dann gibt es auch kein Konto), oder wir durften es nicht lesen.
        if (t.closing_call_id && !closingSeen.has(t.closing_call_id)) out[t.entity_id] = UNRESOLVED;
        continue;
      }
      const origin = originOf.get(settingId);
      // Das Erstgespräch liegt außerhalb der Datensicht — über die Herkunft
      // lässt sich damit gar nichts sagen, auch nicht „gibt es nicht".
      if (!origin) {
        out[t.entity_id] = UNRESOLVED;
        continue;
      }
      if (origin.contactId) {
        // Kein Name heißt hier: Kontakt oder Liste nicht sichtbar, oder die
        // Liste trägt gar keinen Inhaber (Altbestand). Der Kanal steht fest,
        // das Konto nicht.
        const owner = contactOwner.get(origin.contactId) ?? null;
        out[t.entity_id] = owner
          ? { ownerName: owner, kind: "linkedin" }
          : { ownerName: null, kind: "linkedin", unresolved: true };
      } else if (origin.leadId) {
        const owner = leadOwner.get(origin.leadId) ?? null;
        out[t.entity_id] = owner
          ? { ownerName: owner, kind: "telefon" }
          : { ownerName: null, kind: "telefon", unresolved: true };
      }
      // Sonst: Quelle ohne Vorlaufkanal (Ads, Social, Sonstige, manuell) — es
      // GIBT kein Konto. Keine Zeile ist hier die richtige Antwort.
    }
  } catch (e) {
    // Ohne Konto-Zeile ist die Karte unvollständig, aber benutzbar — ein
    // Fehler hier darf die Seite nicht abräumen.
    console.error("loadSenderAccounts:", e instanceof Error ? e.message : e);
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Wer hat abgehakt
 * ------------------------------------------------------------------ */

async function loadDoneBy(
  workspaceId: string,
  touches: ReminderTouchWithContext[],
): Promise<Record<string, string>> {
  const ids = touches.filter((t) => t.done_at).map((t) => t.id);
  if (ids.length === 0) return {};

  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("reminder_touches")
      .select("id, done_by_user_id")
      .eq("workspace_id", workspaceId)
      .in("id", ids);
    const rows = (data ?? []) as unknown as { id: string; done_by_user_id: string | null }[];

    const userIds = [...new Set(rows.map((r) => r.done_by_user_id).filter((v): v is string => Boolean(v)))];
    if (userIds.length === 0) return {};

    const { data: profiles } = await supabase.from("profiles").select("user_id, username").in("user_id", userIds);
    const nameById = new Map<string, string>();
    for (const p of (profiles ?? []) as unknown as { user_id: string; username: string }[]) {
      nameById.set(p.user_id, p.username);
    }

    const out: Record<string, string> = {};
    for (const r of rows) {
      const name = r.done_by_user_id ? nameById.get(r.done_by_user_id) : undefined;
      if (name) out[r.id] = name;
    }
    return out;
  } catch (e) {
    console.error("loadDoneBy:", e instanceof Error ? e.message : e);
    return {};
  }
}

/* ------------------------------------------------------------------ *
 * Seite
 * ------------------------------------------------------------------ */

export default async function ErinnerungenPage() {
  const access = await getAccessContext();
  if (!access) return null;

  // Dasselbe Prädikat wie `setAssignee()` und die RLS auf `pipeline_settings`:
  // nur ein Owner mit workspace-weiter Datensicht sieht fremde Erinnerungen und
  // darf umverteilen.
  const canTeamView = access.role === "owner" && access.data_scope === "workspace";

  const [mine, team] = await Promise.all([
    getDueReminderTouches(),
    canTeamView ? getDueReminderTouches({ teamView: true }) : Promise.resolve(null),
  ]);

  // Die Team-Liste enthält die eigenen Touches bereits — für die Nachlade-
  // Bündel reicht deshalb die jeweils größere Menge.
  const all = team ? team.touches : mine.touches;
  const assignedUserIds = [...new Set(all.map((t) => t.assigned_user_id).filter((v): v is string => Boolean(v)))];

  // `assigned_user_id` ist `on delete set null`: Ein gelöschtes Konto lässt
  // seine Erinnerungen stehen, und in der Team-Ansicht sind sie weiter sichtbar.
  // Für diese Karten gibt es kein Personen-Bundle — ohne den Org-Standard fiele
  // ihr Text bis auf den Auslieferungstext durch, obwohl die Organisation einen
  // eigenen hinterlegt hat. Nur dann nachladen: eine Abfrage, die im Normalfall
  // nichts beiträgt, gehört nicht in jeden Seitenaufruf.
  const needsOrgFallback = all.some((t) => !t.assigned_user_id);

  const [bundleMap, orgBundle, senders, doneBy, members] = await Promise.all([
    // Vorlagen je ZUSTÄNDIGER Person, nicht je Betrachter — sonst läse ein
    // Owner in der Team-Ansicht seine eigenen Texte unter fremden Namen.
    getTemplateBundles(assignedUserIds),
    needsOrgFallback ? getOrgTemplateBundle() : Promise.resolve(EMPTY_TEMPLATE_BUNDLE),
    loadSenderAccounts(access.workspace_id, all),
    loadDoneBy(access.workspace_id, all),
    canTeamView ? listDataViewUsers(access.workspace_id).catch(() => []) : Promise.resolve([]),
  ]);

  const bundles: Record<string, TemplateBundle> = Object.fromEntries(bundleMap);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <BackLink href="/" label="Dashboard" />

      <PageHeader
        eyebrow="Bestätigung"
        title="Meine Erinnerungen"
        meta={
          mine.available
            ? `Fällige Kontakte rund um Setting-, Closing- und Nachfass-Termine — eine Karte je Termin, ` +
              `Fenster ${mine.horizonDays} Tage. Fertiger Text zum Kopieren, kein Auto-Versand.`
            : "Fällige Kontakte rund um Setting-, Closing- und Nachfass-Termine."
        }
      />

      <ErinnerungenBoard
        mine={mine}
        team={team}
        canTeamView={canTeamView}
        bundles={bundles}
        orgBundle={orgBundle}
        senders={senders}
        doneBy={doneBy}
        members={members.map((m) => ({ user_id: m.user_id, username: m.username }))}
      />
    </div>
  );
}
