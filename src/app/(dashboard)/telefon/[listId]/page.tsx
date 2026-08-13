import { CallModeRunner } from "@/components/telefon/CallModeRunner";
import { DeletePhoneListButton } from "@/components/telefon/DeletePhoneListButton";
import { updatePhoneListScriptForm } from "@/app/actions/phone";
import { getAccessContext, matchesOwnScope, ownScopeFilter } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { ownerColor } from "@/lib/ownerColor";
import type { PhoneLead, PhoneList, PhoneListKind } from "@/lib/types";
import { ArrowLeft, ChevronRight, FileText, Phone, PhoneMissed, Voicemail } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

// Telefonliste im Call-Mode: Liste + Leads laden, Guard über Workspace +
// Personenscope, dann durchtelefonieren via CallModeRunner.
//
// Zusätzlich die Skript-Pflege (Migration 0029): Gesprächsleitfaden, Testarm
// und Ziel-Branche hängen an der Liste, weil sie die kleinste Einheit ist, die
// jemand am Stück abtelefoniert — und weil `phone_leads.script` pro Lead als
// Testachse unbrauchbar ist.

const KIND_META: Record<PhoneListKind, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  akquise: {
    label: "Akquise",
    color: "var(--text-muted)",
    bg: "var(--surface-150)",
    border: "var(--border)",
    icon: <Phone size={11} />,
  },
  rueckruf: {
    label: "Rückruf",
    color: "var(--info-fg)",
    bg: "var(--info-bg)",
    border: "rgb(78 128 214 / 0.28)",
    icon: <PhoneMissed size={11} />,
  },
  nicht_erreicht: {
    label: "Nicht erreicht",
    color: "var(--color-warning-text)",
    bg: "var(--color-warning-bg)",
    border: "var(--color-warning-border)",
    icon: <Voicemail size={11} />,
  },
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

export default async function PhoneListPage({ params }: { params: Promise<{ listId: string }> }) {
  const { listId } = await params;
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
  const [rawLeads, metaRows] = await Promise.all([
    fetchAllRows<PhoneLead>((from, to) =>
      supabase
        .from("phone_leads")
        .select("*")
        .eq("list_id", listId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
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
  const oc = list.owner_name ? ownerColor(list.owner_name) : null;

  // Standardmäßig offen, solange nichts hinterlegt ist — ein leeres Skript darf
  // nicht hinter einem zugeklappten Deckel unsichtbar bleiben.
  const scriptEmpty = !(list.script_text ?? "").trim() && !(list.script_label ?? "").trim();
  const scriptSummary = [
    (list.script_label ?? "").trim() ? `Arm „${list.script_label}"` : null,
    (list.target_group ?? "").trim() || null,
  ]
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

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: "1.25rem" }}>
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
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap", marginBottom: "0.25rem" }}>
          {list.owner_name && oc && (
            <span
              style={{
                fontSize: "0.6875rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: oc.fg,
                background: oc.bg,
                border: `1px solid color-mix(in srgb, ${oc.fg} 33%, transparent)`,
                padding: "2px 8px",
                borderRadius: 99,
              }}
            >
              {list.owner_name}
            </span>
          )}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
              fontSize: "0.6875rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: kind.color,
              background: kind.bg,
              border: `1px solid ${kind.border}`,
              padding: "2px 8px",
              borderRadius: 99,
            }}
          >
            {kind.icon} {kind.label}
          </span>
          <span style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>
            {leads.length.toLocaleString("de-DE")} Leads
          </span>
          <span style={{ marginLeft: "auto" }}>
            <DeletePhoneListButton listId={list.id} listName={list.name} redirectTo="/telefon" />
          </span>
        </div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.03em", margin: 0 }}>
          {list.name}
        </h1>
      </div>

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
          <FileText size={14} style={{ color: "var(--orange-500)", flexShrink: 0 }} />
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

          <label htmlFor="script_text" style={fieldLabel}>
            Gesprächsleitfaden
          </label>
          <textarea
            id="script_text"
            name="script_text"
            defaultValue={list.script_text ?? ""}
            rows={5}
            className="input"
            style={{
              resize: "vertical",
              fontSize: "var(--fs-base)",
              marginBottom: "var(--sp-3)",
              lineHeight: "var(--lh-base)",
              padding: "var(--sp-5)",
            }}
            placeholder="Opener, Einwandbehandlung, Terminfrage — der Text, der bei dieser Liste tatsächlich gesprochen wird."
          />
          <p style={fieldHint}>Arbeitstext für den Call-Mode. Ausgewertet wird nicht er, sondern das Label darunter.</p>

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

      {/* ── Call-Mode ── */}
      <CallModeRunner list={list} leads={leads} />
    </div>
  );
}
