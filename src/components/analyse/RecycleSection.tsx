import type { CSSProperties, ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import type { AnalyseRecycleRow, RecycleData, RecycleOriginKey } from "@/lib/analyseData";
import { fmtPct, isRecycleCandidate, listOwnerMatches, ownerKey, pct } from "@/lib/analyse";
import { berlinDateISO } from "@/lib/apptTime";
import { personOf } from "@/lib/personResolution";
import { AnalyseSection } from "@/components/analyse/AnalyseSection";
import { Footnote, MetricTable, StatRow, type MetricRow } from "@/components/analyse/AnalyseTables";

// „Lohnt das Recycling?" — die einzige Frage, die diese Sektion beantwortet.
//
// ── Warum es sie gibt ────────────────────────────────────────────────────────
// Das Lead-Recycling hatte bis hierher NULL Kennzahlen. Damit gab es auch keine
// Grundlage, die Wiedervorlage-Frist begründet zu ändern: Wer nicht misst, ob
// ein toter Lead nach drei Monaten überhaupt noch antwortet, verstellt die Zahl
// nach Gefühl. Genau dafür trägt jede der vier Ursprungstabellen ein
// `recycle_responded_at` — der einzige Beleg, dass ein Wiederbelebungsversuch
// gewirkt hat.
//
// ── Warum sie im Übersichts-Tab steht ────────────────────────────────────────
// Recycling spannt sich über ALLE VIER Ursprünge (LinkedIn-Kontakt,
// Telefon-Lead, Erstgespräch, Closing). Auf die vier Fach-Tabs verteilt wäre
// die Wiederbelebungsquote viermal dieselbe Kennzahl mit je einem Viertel der
// Fallzahl — und die Frage „lohnt es sich?" bliebe unbeantwortet, weil sie nur
// im Vergleich der Ursprünge eine Antwort hat. Die Übersicht ist der einzige
// Tab, dessen Zuständigkeit über einen Kanal hinausgeht.
//
// ── Was hier bewusst NICHT (mehr) steht ─────────────────────────────────────
// Keine kumulative Fortschritts-Sektion. Die Konvention des Bereichs verlangt
// sie für Mengen, die im Zeitraum WACHSEN und deren Vorsprung man sehen will
// (DMs, Termine, Umsatz). Recycling-Reaktionen sind einzelne Ereignisse im
// niedrigen zweistelligen Bereich, über Wochen verteilt: Eine kumulierte Kurve
// daraus wäre eine Treppe mit drei Stufen, die nach Wachstum aussieht.
//
// Und seit dem Rückbau auf das FLACHE Recycling — eine Frist für alle vier
// Ursprünge, kein Grund — zweierlei nicht mehr: die Aufschlüsselung je Grund
// (es gibt keinen Grund-Code mehr, nach dem sich staffeln ließe) und die
// Häufigkeitstabelle über den Versuchszähler (sie diente ausschließlich dazu,
// Deckel und erstes Intervall gegeneinander zu justieren; justiert wird nicht
// mehr). Der Ursprung bleibt die eine Achse, die noch etwas trennt: Ob ein
// totes Telefonat oder ein verlorenes Closing die besseren Wiederbelebungen
// liefert, ist auch bei EINER Frist eine Entscheidung wert.
//
// ── Die Kennzahl „Am Deckel" fehlt — und das ist eine LÜCKE, keine Aussage ──
// Hier stand „es gibt keinen [Deckel]". Das war falsch: `recycle_attempt()`
// (Migration 0033, eingefroren) nullt bei `recycle_attempt_count >=
// max_attempts` das `next_recycle_at`, `recycleBlockedReason` sperrt daraufhin
// „Jetzt wieder anschreiben", und die Ablage zeigt „1 von 2". Der Deckel wirkt
// also — er ist nur unsichtbar, und diese Sektion behauptete ausgerechnet als
// einzige mögliche Messstelle, es gebe ihn nicht.
//
// EINSTELLBAR IST ER NICHT. Er hatte zwischenzeitlich ein Feld unter
// `/settings`; der Auftraggeber hat es wieder herausgenommen, der Wert bleibt
// (ausgeliefert zwei Versuche). Für diese Sektion ändert das nichts — sie hat
// die Zahl nie gezeigt —, wohl aber für den Satz darüber: Wer den Deckel sucht,
// findet ihn an der Ablage-Karte, nicht in den Einstellungen.
//
// Die KENNZAHL dazu ist trotzdem nicht zurück, und der Grund ist mechanisch:
// `loadRecycleData` (src/lib/analyseData.ts) lädt `recycle_attempt_count` nicht
// mehr, `AnalyseRecycleRow` führt das Feld nicht, und `max_attempts` käme aus
// einer zweiten Abfrage. Ohne beides wäre „Am Deckel" geraten. Wer die Zahl
// wiederhaben will, fängt in `analyseData.ts` an, nicht hier.
//
// ── Zeitachsen ──────────────────────────────────────────────────────────────
// Zwei, und sie werden getrennt beschriftet, statt in eine Zahl gemischt zu
// werden:
//   • Die WIEDERBELEBUNGSQUOTE ist eine Kohorten-Quote wie die Telefon-Quoten
//     (docs §5): Nenner sind die Leads, deren letzter Versuch IM Zeitraum lag;
//     Zähler ist der heutige Stand genau dieser Leads. Ein Lead, der nächste
//     Woche antwortet, zählt rückwirkend auf die Woche seines Versuchs.
//   • GESPERRT zählt auf `recycle_excluded_at` — ein eigenes Ereignis mit
//     eigenem Datum. Deshalb steht es als eigene Zahl und nicht in der Quote.

type Member = { user_id: string; username: string };

const INT = new Intl.NumberFormat("de-DE");

/** Reihenfolge = Lifecycle: die beiden Akquise-Kanäle, dann die zwei Termine. */
const ORIGIN_ORDER: readonly RecycleOriginKey[] = ["linkedin", "telefon", "setting", "closing"];

const ORIGIN_LABELS: Record<RecycleOriginKey, string> = {
  linkedin: "LinkedIn",
  telefon: "Telefon",
  setting: "Setting",
  closing: "Closing",
};

/** Woher der Lead kam, als er terminal wurde — zweite Zeile in der Tabelle. */
const ORIGIN_SUBS: Record<RecycleOriginKey, string> = {
  linkedin: "Nachfasssequenz ohne Antwort",
  telefon: "toter Lead",
  setting: "dead, unqualifiziert, ohne Aussicht",
  closing: "verloren",
};

const INFO_P: CSSProperties = { margin: 0 };
const INFO_STRONG: CSSProperties = { fontWeight: 600 };

function InfoText({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>{children}</div>;
}

/**
 * Die Kohorte eines Schnitts.
 *
 * `contacted` ist der Nenner JEDER Quote hier: Leads, die im Zeitraum wirklich
 * einen Versuch bekommen haben. Der naheliegendere Nenner „alle terminal
 * negativen Leads" wäre falsch — die meisten davon warten nur auf ihr
 * Wiedervorlage-Datum und wurden nie angefasst. Eine Quote darauf misst den
 * Kalender, nicht das Recycling.
 */
type Cell = {
  contacted: number;
  responded: number;
};

const ZERO = (): Cell => ({ contacted: 0, responded: 0 });

export function RecycleSection({
  data,
  from,
  to,
  selectedMembers,
  allSelected,
}: {
  data: RecycleData;
  from: string;
  to: string;
  selectedMembers: Member[];
  /** Kein Personenfilter aktiv — nur dann zählen Zeilen ohne Person mit. */
  allSelected: boolean;
}) {
  const selectedIds = new Set(selectedMembers.map((m) => m.user_id));
  const selectedOwners = new Set(selectedMembers.map((m) => ownerKey(m.username)));

  /**
   * Zwei Personenachsen, wie überall im Bereich (docs §5.1): LinkedIn und
   * Telefon hängen am Owner ihrer Liste, die beiden Termin-Ursprünge an
   * `personOf()`. Ohne aktiven Filter zählt alles mit — auch Zeilen, deren
   * Person sich nicht mehr auflösen lässt.
   *
   * Bei den beiden Listen-Ursprüngen trägt `listOwnerMatches` die volle Kette
   * `owner_name` → Ersteller der Liste. Hier stand lange nur der Namensteil,
   * und `ownerKey(null)` ergibt "" — eine Liste ohne Besitzernamen traf damit
   * keine Auswahl und verschwand bei aktivem Personenfilter aus der ganzen
   * Sektion, statt bei ihrem Ersteller zu zählen.
   */
  const inScope = (r: AnalyseRecycleRow): boolean => {
    if (allSelected) return true;
    if (r.origin === "linkedin" || r.origin === "telefon") {
      return listOwnerMatches(r, selectedOwners, selectedIds);
    }
    const uid = personOf(r);
    return uid !== null && selectedIds.has(uid);
  };

  const byOrigin = new Map<RecycleOriginKey, Cell>(ORIGIN_ORDER.map((o) => [o, ZERO()]));
  const total = ZERO();
  let excludedInRange = 0;
  /**
   * Zustand von HEUTE, keine Zeitraum-Zahl — die Meta-Zeile sagt das.
   *
   * Gezählt wird nur, was auch als Aufgabe erscheinen WÜRDE: Kein Rückkehrpfad
   * räumt `next_recycle_at` ab, das Feld allein steht deshalb auch an einem
   * gewonnenen Closing und an einem Telefon-Lead, der längst einen Termin hat.
   * Ohne den Status-Riegel behauptet die Kachel eine Warteschlange, die im
   * Board /nachfassen gar nicht auftaucht.
   */
  let waiting = 0;
  /** Ältester Versuch überhaupt: der Anker gegen die Deploy-Datum-Falle. */
  let firstContact: string | null = null;

  for (const r of data.rows) {
    if (r.last_contacted_at && (firstContact === null || r.last_contacted_at < firstContact)) {
      firstContact = r.last_contacted_at;
    }
    if (!inScope(r)) continue;

    if (r.next_recycle_at && isRecycleCandidate(r)) waiting += 1;
    if (r.excluded_at) {
      const day = berlinDateISO(r.excluded_at);
      if (day >= from && day <= to) excludedInRange += 1;
    }

    if (!r.last_contacted_at) continue;
    const contactDay = berlinDateISO(r.last_contacted_at);
    if (contactDay < from || contactDay > to) continue;

    const responded = r.responded_at !== null;

    const add = (c: Cell): void => {
      c.contacted += 1;
      if (responded) c.responded += 1;
    };
    add(total);
    // `byOrigin` ist über ORIGIN_ORDER vorbelegt und deckt die Union
    // vollständig ab — ein fehlender Topf wäre ein Tippfehler, kein Datenfall.
    add(byOrigin.get(r.origin)!);
  }

  // ── Ehrlichkeit über die Datenlage ───────────────────────────
  // Es gibt keinen Backfill: Recycling gilt nur für Zeilen, die NACH dem Deploy
  // terminal geworden sind. Für ein Fenster davor heißt „nichts" nicht
  // „niemand hat nachgefasst", sondern „gab es damals noch nicht" — eine 0 %
  // wäre eine Aussage über das Deploy-Datum. Deshalb `null` (die Anzeige zeigt
  // „—") plus eine Zeile mit dem Grund. Muster: die Leitkachel „Anwahlen" im
  // Telefon-Tab (Anruf-Log, Migration 0028).
  const startDay = firstContact ? berlinDateISO(firstContact) : null;
  const covers = data.available && startDay !== null && startDay <= to;
  // Der Anker gilt nur den VERSUCHEN. Stehen daneben Sperren, sagt die Fußnote
  // das dazu — sonst liest sich „kein Versuch protokolliert" wie „hier ist
  // nichts passiert", während die Kachel eine Zahl zeigt.
  const sperrenHinweis =
    excludedInRange > 0 ? " Gesperrte Vorgänge zählen trotzdem — sie hängen an ihrem eigenen Datum." : "";
  const note = !data.available
    ? "Die Recycling-Daten ließen sich nicht laden — die leere Anzeige heißt hier nicht „kein Recycling“, sondern „keine Daten“. Migration 0033 im SQL-Editor prüfen."
    : startDay === null
      ? `Bisher wurde kein einziger Recycling-Versuch protokolliert. Die Felder dafür gibt es erst seit dem Umbau, und es gibt bewusst keinen Backfill — „0“ hieße hier „gab es damals noch nicht“.${sperrenHinweis}`
      : !covers
        ? `Der erste Recycling-Versuch stammt vom ${deDate(startDay)}; dieser Zeitraum liegt davor.${sperrenHinweis}`
        : startDay > from
          ? `Recycling-Versuche sind erst ab dem ${deDate(startDay)} protokolliert — für die Tage davor steht im Nenner zwangsläufig nichts.`
          : null;

  const rate = covers ? pct(total.responded, total.contacted) : null;

  const originRows: MetricRow[] = ORIGIN_ORDER.map((o) => [o, byOrigin.get(o) ?? ZERO()] as const)
    .filter(([, c]) => c.contacted > 0)
    .map(([key, c]) => ({
      key,
      label: ORIGIN_LABELS[key],
      sub: ORIGIN_SUBS[key],
      share: total.contacted === 0 ? null : c.contacted / total.contacted,
      values: {
        contacted: c.contacted,
        responded: c.responded,
        rate: pct(c.responded, c.contacted),
      },
    }))
    .sort((a, b) => (b.values.contacted as number) - (a.values.contacted as number));

  const emptyHint = covers
    ? "Im Zeitraum wurde kein toter Lead erneut angesprochen."
    : "Für diesen Zeitraum gibt es noch keine Recycling-Daten.";

  // Dieselbe Trennung wie bei der Kachel „Gesperrt": Nur der linke Teil hängt
  // an `covers`, weil nur er aus den VERSUCHEN kommt. Die Warteschlange ist der
  // Stand von heute — genau das sagt der Infotext —, und sie steht schon am
  // ersten Tag, an dem ein Closing verloren geht, während der erste Versuch
  // frühestens Wochen später fällig wird. An `covers` gehängt wäre sie
  // ausgerechnet dann unsichtbar, wenn sie als einzige Zahl etwas zu sagen hat.
  const meta = [
    covers
      ? `${fmtPct(rate)} von ${INT.format(total.contacted)} Versuchen`
      : "noch keine Recycling-Versuche",
    // Ohne geladene Daten bleibt der Teil weg, statt eine leere Warteschlange
    // zu behaupten.
    data.available ? `${INT.format(waiting)} warten aktuell` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return (
    <AnalyseSection
      title="Lohnt das Recycling?"
      icon={RefreshCw}
      meta={meta}
      collapsible
      defaultOpen={false}
      info={
        <InfoText>
          <p style={INFO_P}>
            <strong style={INFO_STRONG}>Wiederbelebungsquote = Leads mit Reaktion ÷ Leads, die im Zeitraum
            einen Versuch bekommen haben.</strong>{" "}
            Der Nenner sind ausdrücklich die <em>kontaktierten</em> Leads, nicht alle toten. Die große Mehrheit
            der toten Leads wartet nur auf ihr Wiedervorlage-Datum und wurde nie angefasst — eine Quote
            darauf misst den Kalender, nicht das Recycling.
          </p>
          <p style={INFO_P}>
            Kohorten-Quote wie die Telefon-Quoten: Der Zeitraum schneidet den <em>letzten Versuch</em>
            (<code>recycle_last_contacted_at</code>), der Zähler ist der heutige Stand genau dieser Leads. Ein
            Lead, der nächste Woche antwortet, zählt rückwirkend auf die Woche seines Versuchs — am Ende eines
            laufenden Zeitraums ist die Quote deshalb noch unfertig.
          </p>
          <p style={INFO_P}>
            <strong style={INFO_STRONG}>Gesperrt</strong> zählt auf seinem eigenen Datum
            (<code>recycle_excluded_at</code>) — ein Kontaktverbot ist ein Ereignis, keine Folge des Versuchs,
            deshalb steht es neben der Quote statt in ihr. <strong style={INFO_STRONG}>Warten aktuell</strong>{" "}
            ist der Stand von heute über alle Zeiträume, kein Wert dieses Fensters.
          </p>
          <p style={INFO_P}>
            Wozu die Aufteilung nach Ursprung gut ist: Die Wiedervorlage-Frist gilt für alle vier gleich, die
            Erfolgsaussicht nicht. Reagiert ein verlorenes Closing spürbar häufiger als ein toter
            Telefon-Lead, gehört die Arbeitszeit dorthin — und nicht gleichmäßig verteilt.
          </p>
        </InfoText>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
        <StatRow
          items={[
            { label: "Kontaktiert", value: covers ? INT.format(total.contacted) : "—" },
            { label: "Reaktionen", value: covers ? INT.format(total.responded) : "—" },
            {
              label: "Wiederbelebungsquote",
              value: fmtPct(rate),
              tone: rate !== null && rate > 0 ? "success" : "default",
            },
            {
              // NICHT an `covers` gehängt: Der Datenlage-Anker kommt aus dem
              // ersten VERSUCH, eine Sperre entsteht aber ohne jeden Versuch —
              // bei einem Kontaktverbot setzt die App sie sofort, während ein
              // erster Versuch frühestens nach Wochen fällig wird. Bis dahin
              // stand hier „—", obwohl korrekt gezählt wurde. Die Sperre zählt
              // ohnehin auf ihrer eigenen Zeitachse (docs §5).
              label: "Gesperrt",
              value: data.available ? INT.format(excludedInRange) : "—",
            },
          ]}
        />

        <MetricTable
          label="Ursprung"
          columns={[
            { key: "contacted", label: "Kontaktiert", format: "int" },
            { key: "responded", label: "Reaktionen", format: "int" },
            { key: "rate", label: "Wiederbelebt", format: "pct", emphasis: true },
          ]}
          rows={originRows}
          minWidth={440}
          emptyHint={emptyHint}
        />

        {note && <Footnote>{note}</Footnote>}
      </div>
    </AnalyseSection>
  );
}

/** "2026-07-31" → "31.07.2026" (ohne Date-Parsing, kein UTC-Tagessprung). */
function deDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
