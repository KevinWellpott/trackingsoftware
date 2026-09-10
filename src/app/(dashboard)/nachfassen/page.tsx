import { getNachfassenTasks } from "@/app/actions/nachfassen";
import { NachfassenBoard } from "@/components/nachfassen/NachfassenBoard";
import { BackLink } from "@/components/ui/BackLink";
import { InfoPopover } from "@/components/ui/InfoPopover";
import { PageHeader } from "@/components/ui/PageHeader";

// Recycling: die Wiedervorlage für Leads, die schon einmal aus dem Funnel
// gefallen sind — verlorene Closings, tote Telefon- und Erstgespräch-Leads,
// LinkedIn-Kontakte nach FU3 ohne Antwort.
//
// Die Seite hieß einmal „Nachfassen" und trug vier Quellen. Drei davon sind
// Zeilen, die „in der Luft liegen", und stehen jetzt in der Terminliste; hier
// blieb die eine, die dort nicht hingehört (Begründung in
// actions/nachfassen.ts). Die ROUTE behält ihren Namen — Lesezeichen und der
// Rückweg der Detailseiten (`?from=nachfassen`) hängen daran —, der TITEL sagt,
// was die Seite heute ist.
//
// ── DER NAME IST ENTSCHIEDEN: „Recycling", nicht „Nachfassen" ───────────────
// Beide Wörter standen nebeneinander — Seitenleiste und Quicklink führten
// „Nachfassen", die Seite selbst „Recycling". Wer auf „Nachfassen" klickte,
// suchte die alte Seite (heutige Rückrufe, fällige Wiedervorlagen) und fand
// tote Leads von vor drei Monaten.
//
// „Recycling" gewinnt, aus drei Gründen: Es ist das Wort, das das ganze System
// für diese Sache benutzt (`/settings` → „Recycling — Wartezeit",
// „Lohnt das Recycling?" im Analyse-Bereich, `recycle_tasks` in der Datenbank,
// docs §1). „Nachfassen" war dagegen die umgangssprachliche Sammelbezeichnung
// für DREI Mechanismen — und die anderen beiden sind in die Terminliste
// gewandert; als Menüpunkt verspräche das Wort weiter deren Inhalt. Und die
// Seitenleiste erklärt in ihrem eigenen Tooltip längst „Fällige
// Recycling-Versuche".
//
// NOCH NACHZUZIEHEN (andere Dateien): `src/components/Sidebar.tsx` (NavLink
// label="Nachfassen") und `src/components/dashboard/QuickLinks.tsx`
// (label: "Nachfassen"). Die ROUTE bleibt `/nachfassen`.

export default async function NachfassenPage({
  searchParams,
}: {
  searchParams: Promise<{ alle?: string }>;
}) {
  const sp = await searchParams;
  // `?alle=1` hat genau einen Zweck: die Altlasten mitladen — Versuche, deren
  // Fälligkeit über ein Vierteljahr zurückliegt (lib/staleTasks.ts).
  const showingAll = sp.alle === "1";
  // Bewusst als Ganzes durchgereicht statt Feld für Feld: Neben den Aufgaben
  // trägt das Ergebnis die Verfügbarkeits-Flagge und den Altlast-Zähler, und
  // eine hier vergessene Flagge sähe im Board exakt wie „nichts zu tun" aus.
  const result = await getNachfassenTasks({ includeOlder: showingAll });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <BackLink href="/" label="Dashboard" />

      {/* Die Beschreibung der Seite steht hinter dem Info-Icon, nicht als Absatz
          darunter. Das `info`-Element trägt bewusst keinen Handler: Die Seite
          ist eine Server Component, `preventDefault`/`stopPropagation` sitzen im
          Client-Teil `InfoPopover` (docs §5.1). */}
      <PageHeader
        eyebrow="Wiedervorlage"
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)" }}>
            Recycling
            <InfoPopover label="Recycling: was hier steht" width={380}>
              Welcher tote Lead ist wieder einen Versuch wert? Verlorene Closings, tote Telefon- und
              Erstgespräch-Leads und LinkedIn-Kontakte ohne Antwort — jeder mit dem Grund, aus dem er damals
              herausgefallen ist. Wartezeit und Anzahl der Versuche stehen in den Einstellungen unter
              „Pipeline“; ist die Zahl der Versuche erreicht, kommt der Lead nicht mehr von selbst hoch und
              bleibt in der Ablage. Was heute ansteht und was in der Luft liegt, steht dagegen in der
              Terminliste.
            </InfoPopover>
          </span>
        }
      />

      <NachfassenBoard {...result} showingAll={showingAll} />
    </div>
  );
}
