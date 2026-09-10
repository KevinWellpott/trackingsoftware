"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, CalendarDays, CalendarPlus, Clock } from "lucide-react";

import { ManualAppointmentModal } from "@/components/appointment/ManualAppointmentModal";
import { ABLAGE_COUNT_LABEL, type NavCount, type NavCounts } from "@/lib/navCounts";

// Quicklinks — der Tageseinstieg über dem ersten Zahlenblock.
//
// WARUM ES SIE GIBT: Die Seitenleiste startet seit dem Umbau komplett
// zugeklappt (components/Sidebar.tsx, SECTION_DEFAULT_OPEN). Das macht sie zur
// Gliederung, nimmt aber genau das weg, was sie vorher nebenbei leistete: den
// Blick auf „was liegt heute an", ohne dass jemand danach sucht. Dieser
// Streifen gibt ihn zurück — an der einen Stelle, die morgens ohnehin offen ist.
//
// WELCHE ZIELE: exakt der Block „Meine Arbeit" aus der Seitenleiste (Termine ·
// Nachfassen · Ablage) plus die eine Anlege-Aktion, die dort über allen Blöcken
// steht. Das ist kein Zufall, sondern die Regel dahinter: Ersetzt wird, was das
// Zuklappen verdeckt — nicht eine zweite, neu erfundene Auswahl. Analyse,
// Listen und Einstellungen fehlen bewusst; die öffnet man gezielt, und dafür
// ist die Leiste zwei Klicks entfernt.
//
// „Erinnerungen" ist mit dem Rückbau ersatzlos gefallen — samt seinem Zähler.
// Nachgerückt ist keine neue Kachel, sondern TERMINE an die erste Stelle: Die
// Terminliste wird die zentrale Arbeitsfläche („eine Liste pro Person"), und
// die erste Kachel ist die, auf die morgens der Blick fällt.
//
// DIE ZAHLEN GEHÖREN DAZU. Ein Quicklink „Nachfassen" ohne die Zahl offener
// Aufgaben ist ein Lesezeichen, mit ihr eine Arbeitsanweisung. Es sind
// dieselben Zähler wie in der Navigation — geladen wird EINMAL pro Anfrage
// (src/lib/navCountsData.ts), sonst zeigten Streifen und Leiste
// Sekundenbruchteile auseinanderliegende Zahlen.
//
// UND DIE DOKTRIN GILT AUCH HIER: `null` heißt „nicht ermittelbar", nicht
// „null Aufgaben". Eine Kachel ohne ermittelbare Zahl zeigt KEINE Zahl — keine
// beruhigende 0, keinen Platzhalter. Die 0 selbst zeigt sie ebenfalls nicht:
// „nichts fällig" ist die Abwesenheit einer Nachricht, kein Abzeichen.
//
// FARBEN: Graustufen für die Kachel, der vorhandene Überfällig-Ton für die
// Zahl (.count-pill[data-tone="overdue"], globals.css §6.6). Beides sind exakt
// die Bausteine der Seitenleiste — dieselbe Zahl darf nicht auf zwei Flächen
// verschieden aussehen.

/** Eine Kachel: Ziel, Beschriftung, die Frage die sie beantwortet, ihr Zähler. */
type QuickLink = {
  href: string;
  label: string;
  /** Wofür die Zeile zuständig ist — die drei Nachfass-Mechanismen sind sonst
      nicht auseinanderzuhalten (docs/data-model.md §1). */
  hint: string;
  icon: React.ElementType;
  count: NavCount | null;
  /** Was gezählt wird, als [Einzahl, Mehrzahl] — für den Tooltip. */
  countLabel?: [singular: string, plural: string];
};

/** Kachel-Grundform, geteilt von Link und Knopf: gleiche Höhe, gleiche Kanten. */
function tileStyle(): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: "var(--sp-5)",
    padding: "var(--sp-6) var(--sp-7)",
    height: "100%",
    width: "100%",
    textAlign: "left",
    textDecoration: "none",
    color: "inherit",
    fontFamily: "inherit",
    cursor: "pointer",
  };
}

function TileBody({
  icon: Icon,
  label,
  hint,
  accent = false,
  badge,
}: {
  icon: React.ElementType;
  label: string;
  hint: string;
  /** Die eine Anlege-Aktion trägt Orange — „hier entsteht etwas Neues". */
  accent?: boolean;
  badge?: React.ReactNode;
}) {
  return (
    <>
      <span
        aria-hidden
        style={{ display: "inline-flex", color: accent ? "var(--orange-300)" : "var(--orange-500)", flexShrink: 0 }}
      >
        <Icon size={16} />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span
          style={{
            fontSize: "var(--fs-sm)",
            fontWeight: 600,
            letterSpacing: "var(--ls-tight)",
            color: accent ? "var(--orange-300)" : "var(--text-primary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: "var(--fs-xs)",
            color: "var(--text-muted)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {hint}
        </span>
      </span>
      {badge}
    </>
  );
}

export function QuickLinks({ counts }: { counts?: NavCounts }) {
  const router = useRouter();
  const [showManualAppt, setShowManualAppt] = useState(false);

  const links: QuickLink[] = [
    {
      href: "/termine",
      label: "Termine",
      hint: "Kalender",
      icon: CalendarDays,
      // Es gibt keinen Termin-Zähler, und einer wäre auch keine Aufgabe: Ein
      // Kalender ist voll oder leer, aber nie überfällig.
      count: null,
    },
    {
      href: "/nachfassen",
      label: "Nachfassen",
      hint: "Heute fällig",
      icon: Clock,
      count: counts?.nachfassen ?? null,
      countLabel: ["Aufgabe fällig", "Aufgaben fällig"],
    },
    {
      href: "/ablage",
      label: "Ablage",
      hint: "Aus dem Funnel gefallen",
      icon: Archive,
      count: counts?.ablage ?? null,
      countLabel: ABLAGE_COUNT_LABEL,
    },
  ];

  return (
    <>
      <div
        className="grid-4-stat"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "var(--sp-6)",
        }}
      >
        {links.map((l) => {
          // Kein Abzeichen bei `null` (nicht ermittelbar) UND keins bei 0
          // (nichts fällig) — dieselbe Regel wie an den Zeilen der Seitenleiste.
          const shows = Boolean(l.count && l.count.total > 0);
          const noun =
            l.count && l.count.total === 1 ? (l.countLabel?.[0] ?? "Eintrag") : (l.countLabel?.[1] ?? "Einträge");
          const countTitle = shows
            ? `${l.count!.total} ${noun}${l.count!.overdue > 0 ? `, davon ${l.count!.overdue} überfällig` : ""}`
            : null;
          return (
            <Link
              key={l.href}
              href={l.href}
              className="card card-hover"
              style={tileStyle()}
              title={countTitle ?? `${l.label} — ${l.hint}`}
            >
              <TileBody
                icon={l.icon}
                label={l.label}
                hint={l.hint}
                badge={
                  shows ? (
                    <span
                      className="count-pill"
                      data-tone={l.count!.overdue > 0 ? "overdue" : undefined}
                      style={{ flexShrink: 0 }}
                      aria-label={countTitle ?? undefined}
                    >
                      {l.count!.total}
                    </span>
                  ) : undefined
                }
              />
            </Link>
          );
        })}

        {/* Die einzige Aktion im Streifen — sie steht in der Seitenleiste
            ebenfalls ausserhalb aller Bloecke und ist damit von der neuen
            Vorbelegung gar nicht betroffen; hier steht sie, weil ein Termin
            morgens haeufiger entsteht als gesucht wird. */}
        <button
          type="button"
          onClick={() => setShowManualAppt(true)}
          className="card card-hover"
          style={{ ...tileStyle(), background: "none", border: "1px solid var(--border-accent)" }}
          title="Termin ohne Liste manuell buchen"
        >
          <TileBody icon={CalendarPlus} label="Termin buchen" hint="Ohne Liste, manuell" accent />
        </button>
      </div>

      <ManualAppointmentModal
        open={showManualAppt}
        onClose={() => setShowManualAppt(false)}
        onSaved={() => router.refresh()}
      />
    </>
  );
}
