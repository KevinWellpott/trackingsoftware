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
// NACHGEZOGEN: `src/components/Sidebar.tsx` und
// `src/components/dashboard/QuickLinks.tsx` tragen inzwischen ebenfalls
// „Recycling"; der Quicklink-Hinweis lautet „Zweiter Anlauf fällig" statt
// „Heute fällig" — die Wartezeiten liegen bei 14 bis 270 Tagen.
//
// NOCH NACHZUZIEHEN, und zwar bewusst NICHT: Die ROUTE bleibt `/nachfassen`,
// mit ihr die Dateinamen (`NachfassenBoard`, `actions/nachfassen.ts`) und der
// Zählerschlüssel `counts.nachfassen`. Das sind Namen im Code, keine auf dem
// Bildschirm — sie umzubenennen kostet jedes Lesezeichen und jeden
// `?from=nachfassen`-Rückweg und gewinnt nichts.

// ── DIE SEITE HAT KEINEN SCHALTER MEHR ─────────────────────────────────────
// Sie nahm einen URL-Parameter entgegen und lud damit die „Altlasten" mit —
// Versuche, deren Fälligkeit über ein Vierteljahr zurücklag und die sie sonst
// versteckte. Der Auftraggeber hat diesen Schnitt gestrichen („ohne Ausnahme,
// ohne Intervall-Logik"), und damit fällt auch sein Ausweg: Ein Schalter, der
// einschaltet, was ohnehin schon zu sehen ist, ist ein Bedienelement ohne
// Wirkung. Die Begründung steht bei `getNachfassenTasks`.

export default async function NachfassenPage() {
  // Bewusst als Ganzes durchgereicht statt Feld für Feld: Neben den Aufgaben
  // trägt das Ergebnis die Verfügbarkeits-Flagge, und eine hier vergessene
  // Flagge sähe im Board exakt wie „nichts zu tun" aus.
  const result = await getNachfassenTasks();

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
              herausgefallen ist. Die Wartezeit bis zum nächsten Anlauf steht in den Einstellungen unter
              „Pipeline“. Die Zahl der Versuche je Lead ist dagegen fest eingestellt — ist sie erreicht,
              kommt der Lead nicht mehr von selbst hoch und bleibt in der Ablage; wie viele es sind, steht
              dort an der Karte. Was heute ansteht und was in der Luft liegt, steht in der Terminliste.
            </InfoPopover>
          </span>
        }
      />

      <NachfassenBoard {...result} />
    </div>
  );
}
