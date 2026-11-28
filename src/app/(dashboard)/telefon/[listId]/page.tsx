import { CallModeRunner } from "@/components/telefon/CallModeRunner";
import { DeletePhoneListButton } from "@/components/telefon/DeletePhoneListButton";
import { updatePhoneListScriptForm } from "@/app/actions/phone";
import { getAccessContext, matchesOwnScope, ownScopeFilter } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { ownerColor } from "@/lib/ownerColor";
import { PhoneListOverview } from "@/components/telefon/PhoneListOverview";
import { TelModule } from "@/components/telefon/TelModule";
import { PageHeader } from "@/components/ui/PageHeader";
import { loadTelefonHeute } from "@/lib/telefonHeute";
import type { PhoneLead, PhoneList, PhoneListKind } from "@/lib/types";
import { ArrowLeft, CalendarX, ChevronRight, FileText, Phone, PhoneMissed, Voicemail } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

// Telefonliste (Redesign Phase 5): Liste + Leads laden, Guard über Workspace +
// Personenscope. Zwei Ansichten derselben Daten:
//   · Übersicht (Vorgabe): Kennzahlen, Status-Reiter, Leads mit nächstem Schritt.
//   · Call-Modus (`?modus=anrufen`, oder `?lead=` aus einer Zeile): der
//     CallModeRunner mit Kopfleiste, Warteschlange und Ergebnis-Dock.
//
// Dazu Testarm und Ziel-Branche (Migration 0029) — sie hängen an der Liste,
// weil sie die kleinste Einheit ist, die jemand am Stück abtelefoniert. Den
// Gesprächsleitfaden je Liste gibt es nicht mehr (docs §0.3).

/** Quoten mit kleinerem Nenner zeigen „—" (wie der Telefon-Tab, N13). */
const MIN_QUOTE_NENNER = 20;

// Wie in der Übersicht: Die Listen-Art ist Struktur, kein Status — neutrales
// Badge mit farbigem Punkt statt getönter Fläche.
const KIND_META: Record<PhoneListKind, { label: string; dot: string; icon: React.ReactNode }> = {
  akquise: { label: "Akquise", dot: "var(--text-muted)", icon: <Phone size={11} /> },
  rueckruf: { label: "Rückruf", dot: "var(--info)", icon: <PhoneMissed size={11} /> },
  nicht_erreicht: { label: "Nicht erreicht", dot: "var(--warning)", icon: <Voicemail size={11} /> },
  kein_termin: { label: "Kein Termin", dot: "var(--text-subtle)", icon: <CalendarX size={11} /> },
};

/**
 * Die Liste gibt es — sie gehoert nur jemand anderem als der eingestellten
 * Datensicht. Frueher stand hier ein 404, und der ist an dieser Stelle eine
 * Falschaussage: Er sagt „nicht vorhanden", obwohl der Datensatz genau da ist.
 * Wer gerade importiert hat und auf „Zur Liste" klickt, sucht daraufhin den
 * Fehler im Import statt im Filter.
 */
function OutOfScopeNotice({
  listName,
  ownerName,
  viewName,
  orgName,
}: {
  listName: string;
  ownerName: string | null;
  viewName: string | null;
  orgName: string;
}) {
  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <Link
        href="/telefon"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.375rem",
          fontSize: "0.8125rem",
          color: "var(--text-subtle)",
          textDecoration: "none",
          marginBottom: "0.75rem",
        }}
      >
        <ArrowLeft size={13} /> Telefon
      </Link>
      <div className="card" style={{ padding: "var(--sp-9) var(--sp-8)" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, color: "var(--text-primary)", margin: "0 0 var(--sp-5)" }}>
          &bdquo;{listName}&ldquo; liegt außerhalb der aktiven Datensicht
        </h1>
        <p style={{ fontSize: "var(--fs-base)", color: "var(--text-secondary)", lineHeight: 1.6, margin: "0 0 var(--sp-6)" }}>
          Die Liste existiert in <strong>{orgName}</strong> und gehört{" "}
          <strong>{ownerName ?? "niemandem (kein Inhaber gesetzt)"}</strong>. Angezeigt werden gerade
          nur die Daten von <strong>{viewName ?? "einer einzelnen Person"}</strong>.
        </p>
        <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>
          Setz die Datensicht oben auf <strong>{ownerName ?? "alle"}</strong> zurück — dann taucht die
          Liste auch in der Übersicht wieder auf.
        </p>
      </div>
    </div>
  );
}

export default async function PhoneListPage({
  params,
  searchParams,
}: {
  params: Promise<{ listId: string }>;
  searchParams: Promise<{ modus?: string; lead?: string; from?: string }>;
}) {
  const { listId } = await params;
  const sp = await searchParams;
  const access = await getAccessContext();
  if (!access) notFound();

  const supabase = await createClient();

  // Bewusst OHNE Personenfilter laden und die Zuordnung danach in JS pruefen.
  // Gefiltert abgefragt liefern „Liste existiert hier nicht" und „Liste ist da,
  // aber die Datensicht zeigt auf jemand anderen" dieselbe leere Antwort — und
  // damit denselben 404. Der zweite Fall ist aber kein Fehler des Nutzers,
  // sondern eine Filtereinstellung, und braucht eine Erklaerung statt einer
  // Sackgasse. Die Organisationsgrenze bleibt hart (`workspace_id`), und RLS
  // liegt ohnehin darunter: Wer nur seine eigenen Zeilen sehen darf, bekommt
  // hier gar keine.
  const { data: rawList } = await supabase
    .from("phone_lists")
    .select("*")
    .eq("id", listId)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();
  if (!rawList) notFound();
  const list = rawList as PhoneList;
  const ownScope = ownScopeFilter(access);

  if (!matchesOwnScope(access, list)) {
    return (
      <OutOfScopeNotice
        listName={list.name}
        ownerName={list.owner_name}
        viewName={access.effective_username}
        orgName={access.workspaces.name}
      />
    );
  }

  // Leads + bereits vergebene Testarme/Branchen parallel: die Vorschlagsliste
  // hängt an keiner Lead-Zeile, ein zweiter serieller Roundtrip vor dem großen
  // Lead-Fetch wäre reine Wartezeit.
  //
  // Warum es die Vorschläge überhaupt gibt: Ohne sie entstehen „V1", „v1 " und
  // „Variante 1" als drei Testarme mit je zu kleiner Fallzahl — genau das, was
  // das Label verhindern soll. Bewusst über den ganzen (sichtbaren) Bestand,
  // nicht nur über diese Liste: der Test läuft über mehrere Listen und Setter.
  //
  // Eine Importliste zeigt zusätzlich ihre ABGEWANDERTEN Leads: Rückruf, Nicht
  // erreicht und Kein Termin verschieben den Lead physisch in die gemeinsame
  // Routing-Liste des Inhabers (`setPhoneLeadOutcome`), `list_id` zeigt danach
  // dorthin. Über `list_id` allein blieben die Unteransichten Rückruf / Nicht
  // erreicht / Kein Termin hier für immer leer — nur Termin und Dead bleiben in
  // der Liste liegen. `origin_list_id` (Migration 0044) hält die Herkunft fest.
  // Jede Aktion im Call-Mode läuft ohnehin über die `list_id` DES LEADS, ein
  // abgewanderter Lead ist hier also voll bearbeitbar.
  //
  // Fehlt 0044, weist PostgREST den `or`-Filter ab — dann das alte Verhalten
  // statt einer leeren Seite.
  const loadLeads = (withOrigin: boolean) =>
    fetchAllRows<PhoneLead>((from, to) => {
      let q = supabase.from("phone_leads").select("*");
      q = withOrigin ? q.or(`list_id.eq.${listId},origin_list_id.eq.${listId}`) : q.eq("list_id", listId);
      return q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
    });
  const [rawLeads, metaRows] = await Promise.all([
    list.list_kind === "akquise" ? loadLeads(true).catch(() => loadLeads(false)) : loadLeads(false),
    fetchAllRows<{ script_label: string | null; target_group: string | null }>((from, to) => {
      let q = supabase
        .from("phone_lists")
        .select("script_label, target_group")
        .eq("workspace_id", access.workspace_id);
      if (ownScope) q = q.or(ownScope);
      return q.order("id").range(from, to);
    }).catch(() => []),
  ]);
  const leads = rawLeads as PhoneLead[];
  const movedCount = leads.filter((l) => l.list_id !== listId).length;

  /** Trim + case-insensitiv dedupliziert, erste Schreibweise gewinnt (wie in der Analyse). */
  const distinct = (field: "script_label" | "target_group"): string[] => {
    const byKey = new Map<string, string>();
    for (const row of metaRows) {
      const v = (row[field] ?? "").trim();
      if (!v) continue;
      const key = v.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, v);
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b, "de"));
  };
  const scriptLabels = distinct("script_label");
  const targetGroups = distinct("target_group");

  const kind = KIND_META[list.list_kind];
  const armText = (list.script_label ?? "").trim();
  const untertitel = [kind.label, armText ? `Skript „${armText}“` : null, list.owner_name].filter(Boolean).join(" · ");
  const oc = list.owner_name ? ownerColor(list.owner_name) : null;

  // Testarm & Branche: standardmäßig offen, solange kein Testarm hinterlegt
  // ist — ein fehlendes Label darf nicht hinter einem zugeklappten Deckel
  // unsichtbar bleiben.
  const scriptEmpty = !armText;
  const scriptSummary = [armText ? `Skript „${list.script_label}"` : null, (list.target_group ?? "").trim() || null]
    .filter(Boolean)
    .join(" · ");

  const fieldLabel: React.CSSProperties = {
    display: "block",
    fontSize: "var(--fs-xs)",
    fontWeight: 500,
    color: "var(--text-secondary)",
    marginBottom: "var(--sp-3)",
  };
  const fieldHint: React.CSSProperties = {
    margin: "0 0 var(--sp-7)",
    fontSize: "var(--fs-xs)",
    color: "var(--text-subtle)",
    lineHeight: 1.5,
  };

  // ── Call-Modus: `?modus=anrufen` oder ein direkt angesprungener Lead ──
  // Kopfleiste, Warteschlange und Dock bringt der CallModeRunner selbst mit;
  // die Seitenleiste weicht (body[data-dialer]). „Beenden" führt hierher zurück.
  if (sp.modus === "anrufen" || sp.lead) {
    const heute = await loadTelefonHeute(access, supabase);
    return (
      <CallModeRunner
        leads={leads}
        titel={list.name}
        untertitel={untertitel}
        // Aus „Heute“ angesprungen: „Beenden“ führt dorthin zurück.
        exitHref={sp.from === "nachfassen" ? "/nachfassen" : `/telefon/${listId}`}
        heute={heute}
        defaultStatus="offen"
      />
    );
  }

  // ── Kennzahlen der Liste — Lead-Ebene, exakt aus den geladenen Leads ──
  // „Erstkontakt" wie überall (docs §1): Lead mit `first_call_at`.
  const jetztMs = new Date().getTime();
  const erstkontakte = leads.filter((l) => l.first_call_at).length;
  const entscheider = leads.filter((l) => l.decider_reached === true).length;
  const termine = leads.filter((l) => l.status === "termin").length;
  const rueckrufFaellig = leads.filter(
    (l) => l.status === "rueckruf" && !!l.callback_at && Date.parse(l.callback_at) <= jetztMs,
  ).length;
  const anrufbar = leads.filter((l) => l.status === "aktiv" || l.status === "nicht_erreicht").length + rueckrufFaellig;
  // Quoten mit Nenner unter 20 zeigen „—" (wie der Telefon-Tab, N13).
  const quote = (z: number) =>
    erstkontakte >= MIN_QUOTE_NENNER ? `${Math.round((z / erstkontakte) * 100)} % der Erstkontakte` : "zu wenige Erstkontakte für eine Quote";
  const abgearbeitet = leads.length > 0 ? (erstkontakte / leads.length) * 100 : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <PageHeader
        eyebrow={`Telefonliste · ${kind.label}`}
        title={list.name}
        meta={
          <span
            title={
              movedCount > 0
                ? "Rückruf, Nicht erreicht und Kein Termin liegen zusätzlich in der gemeinsamen Routing-Liste — hier stehen sie weiter unter ihrem Status."
                : undefined
            }
          >
            {leads.length.toLocaleString("de-DE")} Leads
            {armText ? ` · Skript „${armText}“` : ""}
            {movedCount > 0 ? ` · ${movedCount.toLocaleString("de-DE")} auch in Routing-Listen` : ""}
          </span>
        }
        actions={
          <>
            <Link className="ui-btn" data-variant="ghost" data-size="sm" href="/telefon" style={{ minHeight: 28, padding: "0 10px" }}>
              <ArrowLeft size={14} aria-hidden /> Alle Listen
            </Link>
            {list.owner_name && oc && (
              <span className="tel-avatar" style={{ color: oc.fg, background: oc.bg }} title={`Inhaber: ${list.owner_name}`}>
                {list.owner_name.charAt(0).toUpperCase()}
              </span>
            )}
            <DeletePhoneListButton iconOnly listId={list.id} listName={list.name} redirectTo="/telefon" />
            {/* Der eine Primärknopf dieser Ansicht. */}
            <Link className="ui-btn" data-variant="primary" data-size="md" href={`/telefon/${listId}?modus=anrufen`}>
              <Phone size={15} aria-hidden /> Session starten
            </Link>
          </>
        }
      />

      <div className="tel-mods" style={{ ["--n" as string]: 4 }}>
        <TelModule
          label="Abgearbeitet"
          value={`${Math.round(abgearbeitet)} %`}
          meter={abgearbeitet}
          caption={`${erstkontakte.toLocaleString("de-DE")} von ${leads.length.toLocaleString("de-DE")} angerufen`}
        />
        <TelModule
          label="Jetzt anrufbar"
          value={anrufbar.toLocaleString("de-DE")}
          tone={rueckrufFaellig > 0 ? "gold" : undefined}
          caption={rueckrufFaellig > 0 ? `davon ${rueckrufFaellig} Rückruf fällig` : "offen und nicht erreicht"}
        />
        <TelModule label="Entscheider erreicht" value={entscheider.toLocaleString("de-DE")} caption={quote(entscheider)} />
        <TelModule label="Termine" value={termine.toLocaleString("de-DE")} caption={quote(termine)} />
      </div>

      <PhoneListOverview leads={leads} listId={listId} jetztMs={jetztMs} />

      {/* ── Skript, Testarm & Branche (Migration 0029) ── */}
      <details open={scriptEmpty} className="card" style={{ marginBottom: "1.25rem" }}>
        <summary
          className="collapse-summary"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-4)",
            padding: "var(--sp-6) var(--sp-8)",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <ChevronRight size={14} className="collapse-chevron" style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <FileText size={14} style={{ color: "var(--accent-text)", flexShrink: 0 }} />
          <span className="eyebrow">Skript &amp; A/B-Test</span>
          <span
            style={{
              fontSize: "var(--fs-xs)",
              color: "var(--text-muted)",
              marginLeft: "auto",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {scriptSummary || "noch nicht hinterlegt"}
          </span>
        </summary>

        <form action={updatePhoneListScriptForm} style={{ padding: "0 var(--sp-8) var(--sp-8)" }}>
          <input type="hidden" name="list_id" value={listId} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--sp-6)" }}>
            <div>
              <label htmlFor="script_label" style={fieldLabel}>
                Testarm (Skript-Label)
              </label>
              {/* Freitext mit Vorschlagsliste: ein geschlossenes Set bräuchte
                  eine Migration pro Testvariante, reiner Freitext erzeugt
                  Schreibweisen-Chaos. `list` erlaubt beides. */}
              <input
                id="script_label"
                name="script_label"
                type="text"
                list="script-label-options"
                defaultValue={list.script_label ?? ""}
                className="input"
                placeholder='z. B. „V1" oder „Hard Opener"'
              />
              <datalist id="script-label-options">
                {scriptLabels.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
              <p style={fieldHint}>
                Die Gruppierungsachse des A/B-Tests. Jeder Import legt eine neue Liste an — erst dasselbe Label in
                mehreren Listen ergibt eine Fallzahl, aus der sich etwas ablesen lässt.
              </p>
            </div>

            <div>
              <label htmlFor="target_group" style={fieldLabel}>
                Branche / Zielgruppe
              </label>
              <input
                id="target_group"
                name="target_group"
                type="text"
                list="target-group-options"
                defaultValue={list.target_group ?? ""}
                className="input"
                placeholder="z. B. Webdesigner, Handwerk"
              />
              <datalist id="target-group-options">
                {targetGroups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
              <p style={fieldHint}>
                Beim Import wird die Branche auf jeden Lead gestempelt. Dieser Wert hier greift für alle Leads, bei
                denen sie fehlt — nachträglich gesetzt, ordnet er also auch Altbestand zu.
              </p>
            </div>
          </div>

          <button type="submit" className="btn-secondary">
            Speichern
          </button>
        </form>
      </details>

    </div>
  );
}
