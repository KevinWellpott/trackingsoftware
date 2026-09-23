import { CallModeRunner } from "@/components/telefon/CallModeRunner";
import { getAccessContext } from "@/lib/access";
import { ownerColor } from "@/lib/ownerColor";
import { loadPhoneNoShowLeads } from "@/lib/settingNoShowData";
import { ArrowLeft, UserX } from "lucide-react";
import Link from "next/link";
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
// `?owner=<username>` schneidet auf eine Person — so verlinkt die
// Telefon-Übersicht je Inhaber („eine Liste je Person"). Ohne Parameter gilt
// die aktive Datensicht.

export const dynamic = "force-dynamic";

export default async function SettingNoShowPhonePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await getAccessContext();
  if (!access) notFound();
  const owner = (await searchParams).owner?.trim() || null;

  const all = await loadPhoneNoShowLeads(access);
  // „Ohne Zuordnung" ist der Gruppenname der Übersicht für Listen ohne
  // `owner_name` — derselbe Schlüssel, damit der Link genau ihre Leads trifft.
  const leads = owner ? all.filter((l) => (l.owner_name ?? "Ohne Zuordnung") === owner) : all;
  const oc = owner ? ownerColor(owner) : null;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
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
          {owner && oc && (
            <span
              className="badge"
              style={{ color: oc.fg, background: oc.bg, border: `1px solid color-mix(in srgb, ${oc.fg} 33%, transparent)` }}
            >
              {owner}
            </span>
          )}
          <span className="badge badge-gray" style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "var(--r-full)", background: "var(--danger)" }} />
            <UserX size={11} /> Setting No-Show
          </span>
          <span className="tnum" style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
            {leads.length.toLocaleString("de-DE")} Leads
          </span>
        </div>
        <h1 className="page-title" style={{ margin: 0 }}>
          Setting No-Show
        </h1>
        <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", margin: "var(--sp-3) 0 0", maxWidth: 720 }}>
          Telefon-Leads mit Termin, deren Erstgespräch auf &bdquo;Nicht erschienen&ldquo; steht. Ein neuer Termin, ein
          anderes Ergebnis oder &bdquo;Tot&ldquo; nimmt sie von der Liste.
        </p>
      </div>

      <CallModeRunner
        leads={leads}
        empty={{
          title: "Keine No-Shows",
          text: "Sobald ein Erstgespräch aus der Telefonakquise auf „Nicht erschienen“ gesetzt wird, steht der Lead hier.",
        }}
      />
    </div>
  );
}
