"use client";

import { markFollowUpContacted, markTerminDead, setNeuerTermin } from "@/app/actions/followUpStamp";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { formatTerminParts } from "@/lib/apptTime";
import { dayDiff, lastContactLabel } from "@/lib/contactGap";
import {
  DRAN_TONE,
  erinnerungText,
  istBearbeitbar,
  istZuTun,
  type ErinnerungsStand,
  type ErinnerungsStufe,
  type TerminErinnerung,
} from "@/lib/dranRegel";
import { dueDayOf } from "@/lib/dueState";
import { ownerColor, ownerInitials } from "@/lib/ownerColor";
import type { TerminEvent, TerminKind } from "@/lib/termine";
import { EUR_FMT } from "@/lib/terminMeta";
import { ArrowDown, ArrowUp, BellRing, CalendarClock, CalendarX2, Check, Phone, Video } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { kindLabel } from "./EventChip";
import { TerminAktionen } from "./TerminAktionen";
import { erinnerungsArt, type SortDir, type TerminSort, type TerminZeit } from "./viewState";

// DIE ARBEITSFLÄCHE. „Eine Liste pro Person. Darauf stehen die Namen, die
// genervt werden müssen. Fertig."
//
// Vorbild ist die LinkedIn-Liste, und zwar in genau dem Punkt, der sie
// funktionieren lässt: EIN Feld leuchtet Gold, und Gold heißt ausnahmslos „du
// bist dran". Hier ist es die Termin-Spalte — die Spalte, die die eine Frage
// beantwortet, auf die es ankommt: steht ein Termin (dann ist er versorgt) oder
// keiner (dann liegt er in der Luft). Die Regel dafür steht nicht hier, sondern
// in src/lib/dranRegel.ts, gemeinsam mit der der LinkedIn-Liste — zwei
// Definitionen von „du bist dran" waren der Fehler, den dieser Umbau behebt.
//
// Ein DRITTER Fall leuchtet seit den zwei festen Erinnerungen mit: ein Termin,
// der morgen bzw. in weniger als einer Stunde ansteht und noch nicht angekündigt
// wurde. Er ist keine Ausnahme von „Gold heißt du bist dran", sondern ein Fall
// davon — und die Zeile SAGT ihn, statt ihn nur zu färben (`anlass` unten).
//
// Was die Liste NICHT mehr tut: nur lesen. Jede Zeile trägt die drei Handgriffe
// aus dem Zielbild (genervt · neuer Termin · tot), alle ohne Seitenwechsel.
//
// Und was sie nicht mehr zeigt: die Quellen-Spalte. Woher ein Lead kam, ändert
// nichts daran, ob er heute genervt werden muss.

/** Zeilen ohne Zeitpunkt sortieren immer nach oben — sie sind unerledigt. */
const NO_DATE_KEY = "0000-00-00";

type Column = {
  key: TerminSort;
  label: string;
  /** Spaltenbreite; leer = flexibel. */
  width?: number;
};

const COLUMNS: readonly Column[] = [
  { key: "zeit", label: "Termin", width: 176 },
  { key: "lead", label: "Lead / Firma" },
  { key: "person", label: "Person", width: 132 },
  { key: "status", label: "Status", width: 132 },
];

/* ------------------------------------------------------------------ *
 * Die Erinnerungs-Spalte
 * ------------------------------------------------------------------ */

/**
 * In den beiden Erinnerungs-Ansichten TRITT DIESE SPALTE AN DIE STELLE VON
 * „STATUS", statt neben sie.
 *
 * Grund: Dort steht in jeder einzelnen Zeile derselbe Pill — „Termin steht" ist
 * ja die Bedingung, unter der die Zeile überhaupt in der Ansicht ist. Eine
 * Spalte, die für alle Zeilen dasselbe sagt, ist reines Rauschen und kostet die
 * Breite, die die Zusicherung braucht, um die es hier geht: jeder wird ZWEIMAL
 * erinnert.
 */
const STUFEN_TON: Record<ErinnerungsStand, { bg: string; fg: string; border: string }> = {
  // Erledigt ist ein Haken, keine Auszeichnung — dieselbe stille Grau-Kachel
  // wie `.badge-gray`. Grün wäre hier ein Erfolg, und Erfolg ist der Abschluss,
  // nicht das Verschicken einer Terminbestätigung.
  erledigt: { bg: "var(--surface-3)", fg: "var(--text-secondary)", border: "var(--border-default)" },
  // Gold heißt in dieser Software ausnahmslos „du bist dran" (DRAN_TONE) — und
  // genau das ist eine offene Erinnerung. Dieselbe Farbe wie das Feld daneben.
  offen: { bg: DRAN_TONE.bg, fg: DRAN_TONE.fg, border: DRAN_TONE.border },
  // Noch nicht dran: sichtbar, aber ohne Gewicht. Bewusst nicht weggelassen —
  // die leere zweite Stelle ist die Zusage, dass noch eine Erinnerung kommt.
  ausstehend: { bg: "transparent", fg: "var(--text-disabled)", border: "var(--border-subtle)" },
};

const MARKE_WORT: Record<TerminErinnerung, string> = {
  vortag: "am Vortag zur selben Uhrzeit",
  stunde: "eine Stunde vor dem Termin",
};

// Kein „überfällig", kein „versäumt" — eine Erinnerung, deren Marke beim Buchen
// schon vorbei war, ist kein Versäumnis (siehe die Anmerkung in lib/dueState.ts).
const STAND_WORT: Record<ErinnerungsStand, string> = {
  ausstehend: "steht noch aus",
  offen: "jetzt fällig",
  erledigt: "erinnert",
};

function stufenTitel(s: ErinnerungsStufe): string {
  const wann = formatTerminParts(new Date(s.at).toISOString());
  const zeitpunkt = wann ? ` (${wann.date}, ${wann.time})` : "";
  return `${s.nr}. Erinnerung — ${MARKE_WORT[s.marke]}: ${STAND_WORT[s.stand]}${zeitpunkt}`;
}

/** Die zwei Stufen als abzählbare Marken. `null` = hier ist nichts anzukündigen. */
function ErinnerungsZelle({ stufen }: { stufen: ErinnerungsStufe[] | null }) {
  if (!stufen) {
    return (
      <span style={{ color: "var(--text-disabled)" }} title="Der Termin läuft gerade oder ist vorbei — anzukündigen gibt es nichts mehr.">
        —
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}>
      {stufen.map((s) => {
        const ton = STUFEN_TON[s.stand];
        return (
          <span
            key={s.nr}
            className="badge"
            title={stufenTitel(s)}
            style={{ color: ton.fg, backgroundColor: ton.bg, border: `1px solid ${ton.border}` }}
          >
            {s.stand === "erledigt" ? (
              <Check size={11} aria-hidden />
            ) : s.stand === "offen" ? (
              <BellRing size={11} aria-hidden />
            ) : null}
            {s.nr}.
          </span>
        );
      })}
    </span>
  );
}

/** Sortierschlüssel je Spalte — immer ein String, damit localeCompare reicht. */
function sortKey(e: TerminEvent, sort: TerminSort): string {
  switch (sort) {
    case "lead":
      return `${e.title} ${e.company ?? ""}`.toLowerCase();
    case "person":
      // Ohne Zuweisung ans Ende, egal in welche Richtung sortiert wird —
      // „niemand zuständig" ist kein Name, sondern eine Lücke.
      return e.assignee?.username.toLowerCase() ?? "￿";
    case "status":
      return e.statusPill.label.toLowerCase();
    default:
      return `${e.dayISO ?? NO_DATE_KEY}T${String(e.startMin).padStart(4, "0")}`;
  }
}

export function TermineList({
  events,
  ohneTermin,
  zeit,
  today,
  sort,
  dir,
  onSort,
  onError,
}: {
  events: TerminEvent[];
  ohneTermin: TerminEvent[];
  zeit: TerminZeit;
  today: string;
  sort: TerminSort;
  dir: SortDir;
  onSort: (col: TerminSort) => void;
  /** Fehler landen in der EINEN Fehlerzeile des Boards, nicht in der Zeile. */
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /** Welche Zeile schreibt gerade? Nur sie sperrt ihre Knöpfe. */
  const [busyId, setBusyId] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  /**
   * Welche Termin-Art zeigt dieser Ausschnitt? `null` = keine
   * Erinnerungs-Ansicht (src/components/termine/viewState.ts).
   *
   * Diese eine Variable entscheidet dreierlei — welche Zeilen, welche vierte
   * Spalte und welcher Leerzustand —, damit die drei Antworten nicht
   * auseinanderlaufen können.
   */
  const art = erinnerungsArt(zeit);

  const rows = useMemo(() => {
    // Termine ohne Zeitpunkt sind per Definition in der Arbeitsmenge und gehören
    // deshalb in denselben Topf — ohne die Liste hätten sie gar keinen Ort.
    const all = [...events, ...ohneTermin];
    // `istZuTun` = Arbeitsmenge ODER offene Erinnerung (src/lib/dranRegel.ts).
    // Ein Termin, der morgen ansteht und heute angekündigt werden muss, steht
    // deshalb in BEIDEN Ausschnitten — er ist versorgt und trotzdem heute
    // anzufassen.
    //
    // Die Erinnerungs-Ansichten zeigen ALLE stehenden Termine ihrer Art, nicht
    // nur die mit gerade offener Erinnerung: Die Frage dort ist nicht „was ist
    // jetzt zu tun" (das steht in „Zu tun"), sondern „bekommt jeder seine zwei
    // Erinnerungen" — und die lässt sich nur an der vollständigen Liste
    // beantworten.
    const pool = art
      ? all.filter((e) => e.zustand === "verlegt" && e.kind === art)
      : zeit === "zu_tun"
        ? all.filter((e) => istZuTun(e.zustand, e.erinnerung))
        : all;

    const factor = dir === "asc" ? 1 : -1;
    return [...pool].sort((a, b) => {
      const cmp = sortKey(a, sort).localeCompare(sortKey(b, sort), "de", { numeric: true });
      // Gleichstand immer chronologisch auflösen — sonst springen Zeilen bei
      // jedem Re-Render, weil Array.sort nicht garantiert stabil gefüllt wird.
      return cmp !== 0 ? cmp * factor : sortKey(a, "zeit").localeCompare(sortKey(b, "zeit"));
    });
  }, [events, ohneTermin, art, zeit, sort, dir]);

  /**
   * Ein Handgriff, eine Server-Antwort, ein Neuladen.
   *
   * Bewusst OHNE optimistische Anzeige: Anders als beim Verschieben im Kalender
   * hängen an diesen drei Aktionen Folgen, die der Server bestimmt (Zustand,
   * Recycling-Datum, Zuständigkeit) — eine vorweggenommene Zeile müsste sie
   * erraten und läge bei jeder abgewiesenen Antwort falsch.
   */
  const run = useCallback(
    (event: TerminEvent, aktion: () => Promise<{ error?: string }>) => {
      onError(null);
      setBusyId(event.id);
      startTransition(async () => {
        const res = await aktion();
        setBusyId(null);
        if (res?.error) {
          onError(res.error);
          return;
        }
        router.refresh();
      });
    },
    [onError, router],
  );

  const onGenervt = useCallback(
    (e: TerminEvent) => run(e, () => markFollowUpContacted(e.kind, e.refId)),
    [run],
  );

  const onNeuerTermin = useCallback(
    (e: TerminEvent, berlinInput: string) => run(e, () => setNeuerTermin(e.kind, e.refId, berlinInput)),
    [run],
  );

  const onTot = useCallback(
    async (e: TerminEvent) => {
      // Der eine Handgriff, der die Zeile beendet — deshalb als einziger mit
      // Rückfrage. „Genervt" ist folgenlos, ein neuer Termin ist korrigierbar.
      const ok = await confirm({
        title: e.kind === "setting" ? "Lead als tot markieren?" : "Als „Kein Close“ abschließen?",
        message: `„${e.title}“ verschwindet damit aus der Liste. Rückgängig geht das nur auf der Detailseite.`,
        confirmLabel: e.kind === "setting" ? "Als tot markieren" : "Kein Close",
        destructive: true,
      });
      if (!ok) return;
      run(e, () => markTerminDead(e.kind, e.refId));
    },
    [confirm, run],
  );

  if (rows.length === 0) return <EmptyState zeit={zeit} art={art} />;

  // Die Erinnerungs-Spalte tritt AN DIE STELLE von „Status" (Begründung an
  // `STUFEN_TON`), die Spaltenzahl bleibt damit in jeder Ansicht dieselbe.
  const columns = art ? COLUMNS.filter((c) => c.key !== "status") : COLUMNS;

  return (
    <div
      className="table-scroll"
      // `overflowX: "auto"` wie in jeder anderen Tabelle der App (z. B.
      // AnalyseTables). Hier stand `overflow: "hidden"` — ein Inline-Stil, der
      // die einzige `.table-scroll`-Regel (globals.css, unter 768px) schlägt.
      // Die Spalten summieren sich auf gut 860 Pixel; auf dem Telefon wurde
      // damit ausgerechnet die Spalte „Aktion" abgeschnitten, ohne dass man
      // hinscrollen konnte — und sie trägt die drei einzigen Handgriffe, mit
      // denen sich eine Zeile abhaken lässt. Geklippt (und damit rund) bleibt
      // der Rahmen trotzdem: `auto` schneidet wie `hidden`, nur mit Weg.
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        overflowX: "auto",
        background: "var(--surface-100)",
      }}
    >
      {dialog}
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort === c.key;
              const Arrow = dir === "asc" ? ArrowUp : ArrowDown;
              return (
                <th key={c.key} style={{ width: c.width }} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
                  <button
                    type="button"
                    onClick={() => onSort(c.key)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "var(--sp-2)",
                      border: "none",
                      background: "transparent",
                      padding: 0,
                      font: "inherit",
                      letterSpacing: "inherit",
                      textTransform: "inherit",
                      color: active ? "var(--text-primary)" : "inherit",
                      cursor: "pointer",
                    }}
                  >
                    {c.label}
                    {active && <Arrow size={11} />}
                  </button>
                </th>
              );
            })}
            {/* Erinnerung, Kontakt und Aktion sind bewusst nicht sortierbar:
                Kontakt ist eine Mischspalte (Umsatz, Meet-Link, Rufnummer),
                Aktion trägt Knöpfe — und die Erinnerungs-Marken hängen am
                Termin, die Vorgabe-Sortierung nach Zeit ordnet sie also bereits
                nach Dringlichkeit. Eine zweite Sortierung daneben ergäbe
                dieselbe Reihenfolge unter anderem Namen. */}
            {art && <th style={{ width: 132 }}>Erinnerung</th>}
            <th style={{ width: 150 }}>Kontakt</th>
            <th style={{ width: 268 }}>Aktion</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <Row
              key={e.id}
              event={e}
              today={today}
              erinnerungsSpalte={art !== null}
              pending={pending && busyId === e.id}
              onGenervt={() => onGenervt(e)}
              onNeuerTermin={(input) => onNeuerTermin(e, input)}
              onTot={() => void onTot(e)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  event,
  today,
  erinnerungsSpalte,
  pending,
  onGenervt,
  onNeuerTermin,
  onTot,
}: {
  event: TerminEvent;
  today: string;
  /** Steht an vierter Stelle die Erinnerung statt des Status? */
  erinnerungsSpalte: boolean;
  pending: boolean;
  onGenervt: () => void;
  onNeuerTermin: (berlinInput: string) => void;
  onTot: () => void;
}) {
  const termin = formatTerminParts(event.at);
  // „Ist an dieser Zeile heute etwas zu tun?" — dieselbe Frage wie beim
  // Ausschnitt oben, deshalb dieselbe Funktion. Sie entscheidet, ob die
  // Unterzeile mit Anlass und letztem Kontakt erscheint.
  const imFluss = istZuTun(event.zustand, event.erinnerung);
  // Ob die Zeile ihre drei Knöpfe trägt, ist eine ANDERE Frage — sie hängt nur
  // am Zustand und kippt deshalb nicht mitten am Tag um (siehe `istBearbeitbar`).
  // Vorher hing beides an `imFluss`, und ein stehender Termin hatte in der
  // Spalte Aktion einen Strich: kein Umterminieren, kein Abschreiben, obwohl
  // genau dafür die Ansicht da ist.
  const anfassbar = istBearbeitbar(event.zustand);
  // Warum die Zeile leuchtet, in Worten. Steht vor dem letzten Kontakt, weil es
  // der Grund ist und der Kontakt nur die Begleitauskunft: Ohne diesen Satz
  // sähe man eine goldene Zeile mit einem Termin in der Zukunft und wüsste
  // nicht, was zu tun ist.
  const anlass = event.erinnerung ? erinnerungText(event.erinnerung, event.dayISO, today) : null;
  // Gegen `today` gerechnet, nicht gegen ein selbst geholtes „jetzt": Ein
  // `new Date()` im Render-Körper wäre unrein (react-hooks/purity), und die
  // Zeile soll dieselbe Tagesgrenze benutzen wie das Gold daneben.
  // `lastContactLabel` ist wortgleich der Text aus Dossier und Nachfassen —
  // eine Zahl, die auf drei Seiten anders heißt, liest sich wie drei Zahlen.
  const genervtVor = event.lastContactedAt ? dayDiff(dueDayOf(event.lastContactedAt), today) : null;

  return (
    <tr>
      {/* ── Termin — DAS EINE GOLDENE FELD ──
             Gold heißt ausnahmslos „du bist dran", und zwar aus einem von zwei
             Gründen: Der Vorgang liegt in der Arbeitsmenge und heute war noch
             niemand an ihm — oder eine seiner zwei Erinnerungen ist offen. Ein
             Klick auf „Genervt" nimmt das Gold; im ersten Fall bis morgen, im
             zweiten bis zur nächsten Marke (src/lib/dranRegel.ts). */}
      <td
        style={
          event.dran
            ? {
                background: DRAN_TONE.bg,
                boxShadow: `inset 2px 0 0 ${DRAN_TONE.border}`,
              }
            : undefined
        }
      >
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          {termin ? (
            <span
              className="tnum"
              style={{
                display: "inline-flex",
                alignItems: "baseline",
                gap: "var(--sp-3)",
                color: event.dran ? DRAN_TONE.fg : "var(--text-secondary)",
              }}
            >
              {event.dran && <CalendarClock size={12} style={{ alignSelf: "center", flexShrink: 0 }} />}
              {termin.date}
              <span style={{ color: event.dran ? "inherit" : "var(--text-primary)", fontWeight: 500 }}>
                {termin.time}
              </span>
            </span>
          ) : (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--sp-3)",
                color: event.dran ? DRAN_TONE.fg : "var(--text-muted)",
                fontWeight: event.dran ? 600 : 400,
              }}
            >
              <CalendarX2 size={12} style={{ flexShrink: 0 }} /> Kein Termin
            </span>
          )}

          {/* Zweite Zeile, solange der Vorgang Arbeit ist — bei einem
              abgeschlossenen wäre „noch nie genervt" eine Mahnung ohne Adressat.
              Der NAME steht dabei: „Hast du den angerufen oder ich?" ist die
              Frage, für die es die zweite Spalte aus Migration 0041 gibt.

              ODER sobald es einen Stempel gibt. Das ist der Fall, den die
              Erinnerungs-Ansicht braucht: Ein stehender Termin ist keine
              Arbeitsmenge, aber wer schon erinnert hat, muss dort mit Namen
              stehen. Umgekehrt bleibt die Zeile bei einem noch fernen Termin
              ohne Stempel still — „noch nie kontaktiert" unter einem Termin in
              drei Wochen ist kein Befund, sondern Rauschen.

              Bei einer offenen Erinnerung steht der Anlass davor — und zwar in
              derselben stillen Farbe: Gold gehört dem Feld, nicht dem Text
              darin (DESIGN.md §3.6, ein farbiges Element je Zeile). */}
          {(imFluss || event.lastContactedAt) && (
            <span style={{ fontSize: "var(--fs-2xs)", color: "var(--text-muted)" }}>
              {event.cancelled && "abgesagt · "}
              {anlass ? `${anlass} · ` : ""}
              {lastContactLabel(genervtVor)}
              {event.lastContactedBy ? ` · ${event.lastContactedBy}` : ""}
            </span>
          )}
        </span>
      </td>

      {/* ── Lead / Firma — mit dem Typ-Marker in der Chip-Fuellfarbe, damit
             Liste und Kalender dieselbe Sprache sprechen. ── */}
      <td>
        <Link
          href={event.href}
          className="listen-name"
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: "var(--sp-4)",
            color: "inherit",
            textDecoration: "none",
            maxWidth: "100%",
          }}
        >
          <span
            aria-hidden
            title={kindLabel(event.kind)}
            style={{
              alignSelf: "center",
              flexShrink: 0,
              width: 18,
              textAlign: "center",
              borderRadius: "var(--r-xs)",
              padding: "1px 0",
              fontSize: "var(--fs-2xs)",
              fontWeight: 600,
              background:
                event.kind === "setting" ? "var(--event-setting-bg)" : "var(--event-closing-bg)",
              color: event.kind === "setting" ? "var(--event-setting-fg)" : "var(--event-closing-fg)",
              border: "1px solid var(--border-default)",
            }}
          >
            {kindLabel(event.kind, true)}
          </span>
          <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {event.title}
          </span>
          {event.company && (
            <span
              style={{
                fontSize: "var(--fs-xs)",
                color: "var(--text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {event.company}
            </span>
          )}
        </Link>
      </td>

      {/* ── Person ── */}
      <td>
        {event.assignee ? (
          <OwnerCell username={event.assignee.username} />
        ) : (
          <span style={{ color: "var(--text-disabled)" }}>—</span>
        )}
      </td>

      {/* ── Vierte Spalte: Status ODER die zwei Erinnerungen ──
             In den Erinnerungs-Ansichten stünde hier in JEDER Zeile derselbe
             Pill „Termin steht" — er ist ja die Bedingung der Ansicht. Statt
             ihn zu wiederholen, steht dort die Zusicherung, um die es geht:
             beide Marken, abzählbar (Begründung an `STUFEN_TON`). */}
      <td>
        {erinnerungsSpalte ? (
          <ErinnerungsZelle stufen={event.erinnerungsStufen} />
        ) : (
          <span
            className="badge"
            style={{
              color: event.statusPill.color,
              backgroundColor: event.statusPill.bg,
              border: `1px solid ${event.statusPill.border}`,
            }}
          >
            {event.statusPill.label}
          </span>
        )}
      </td>

      {/* ── Kontakt: Umsatz, sonst der Weg zum Lead ── */}
      <td>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap" }}>
          {event.dealVolume != null && event.zustand === "close" && (
            <span className="tnum" style={{ fontWeight: 500, color: "var(--success-fg)" }}>
              {EUR_FMT.format(event.dealVolume)}
            </span>
          )}
          {event.meetLink && (
            <a
              href={event.meetLink}
              target="_blank"
              rel="noopener noreferrer"
              className="badge"
              style={{
                textDecoration: "none",
                color: "var(--orange-300)",
                backgroundColor: "var(--accent-muted)",
                border: "1px solid var(--border-accent)",
              }}
            >
              <Video size={11} /> Meet
            </a>
          )}
          {/* Die Nummer ist der Grund, warum es das Feld gibt: Wer kurzfristig
              einspringt, muss sie ohne Umweg über die Detailseite sehen. */}
          {event.phone && (
            <a
              href={`tel:${event.phone.replace(/[^\d+]/g, "")}`}
              className="badge badge-gray tnum"
              style={{ textDecoration: "none" }}
              title="Anrufen"
            >
              <Phone size={11} /> {event.phone}
            </a>
          )}
          {!event.meetLink && !event.phone && event.meetingKind === "telefon" && (
            <span className="badge badge-gray" title="Telefon-Termin ohne hinterlegte Nummer">
              <Phone size={11} /> Nummer fehlt
            </span>
          )}
        </span>
      </td>

      {/* ── Aktion: die drei Handgriffe, ohne Seitenwechsel ──
             Solange der Vorgang laufen kann — Arbeitsmenge oder stehender
             Termin. Eine ABGESCHLOSSENE Zeile bekommt keine Knöpfe; wer sie
             wieder aufmachen will, tut das auf der Detailseite, wo die Folgen
             erklärt sind. Ein stehender Termin dagegen behält sie den ganzen
             Tag: „Genervt" schließt die fällige Erinnerung, „Termin" verlegt
             ihn, „Tot" schreibt ihn ab. */}
      <td>
        {anfassbar ? (
          <TerminAktionen
            event={event}
            pending={pending}
            onGenervt={onGenervt}
            onNeuerTermin={onNeuerTermin}
            onTot={onTot}
          />
        ) : (
          <span style={{ color: "var(--text-disabled)" }}>—</span>
        )}
      </td>
    </tr>
  );
}

/** Zuständige Person einer Zeile. Avatar für den Wiedererkennungswert, Name für die Suche. */
function OwnerCell({ username }: { username: string }) {
  const oc = ownerColor(username);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)", minWidth: 0 }}>
      <span
        aria-hidden
        style={{
          width: 20,
          height: 20,
          flexShrink: 0,
          borderRadius: "var(--r-full)",
          background: oc.bg,
          color: oc.fg,
          boxShadow: `inset 0 0 0 1px ${oc.fg}`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "var(--fs-2xs)",
          fontWeight: 600,
        }}
      >
        {ownerInitials(username)}
      </span>
      <span
        style={{
          fontSize: "var(--fs-sm)",
          color: "var(--text-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {username}
      </span>
    </span>
  );
}

function EmptyState({ zeit, art }: { zeit: TerminZeit; art: TerminKind | null }) {
  const titel = art
    ? `Kein ${art === "setting" ? "Erstgespräch" : "Closing"} steht an`
    : zeit === "zu_tun"
      ? "Nichts zu tun"
      : "Keine Termine";

  // Der Leerzustand zeigt auf die EINE Aktion dieser Seite — und die steht seit
  // der Design-Runde oben rechts im Seitenkopf, nicht mehr „in der Navigation".
  // Ein Leerzustand, der woandershin verweist, schickt auf die Suche nach einem
  // Knopf, der 40 Pixel darüber steht (COMPONENTS.md §14.1).
  const text = art
    ? `Hier stehen alle ${art === "setting" ? "Erstgespräche" : "Closings"} mit einem Termin in der Zukunft — jedes mit seinen zwei Erinnerungen, einen Tag und eine Stunde vorher. Sobald ein Termin gebucht ist, erscheint er hier.`
    : zeit === "zu_tun"
      ? "Niemand liegt in der Luft: Jeder offene Vorgang hat entweder einen Termin oder ist abgeschlossen — und kein Termin steht so nah bevor, dass daran zu erinnern wäre."
      : "Termine entstehen automatisch, sobald ein LinkedIn-Kontakt oder Telefon-Lead einen Termin bekommt — oder oben rechts über „Termin buchen“.";

  return (
    <div className="card dot-grid">
      <div className="empty-state">
        <CalendarClock size={24} aria-hidden />
        <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: "var(--text-primary)" }}>{titel}</div>
        <p style={{ maxWidth: 420 }}>{text}</p>
      </div>
    </div>
  );
}
