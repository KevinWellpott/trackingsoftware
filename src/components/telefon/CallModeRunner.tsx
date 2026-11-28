"use client";

import { deletePhoneLead, setPhoneLeadOutcome, updatePhoneLead, type PhoneLeadInput } from "@/app/actions/phone";
import { convertPhoneLeadToSetting } from "@/app/actions/appointments";
import { loadPhoneLeadHistory, type PhoneHistoryRow } from "@/app/actions/phoneCallHistory";
import { DateTimeField } from "@/components/ui/DateTimeField";
import { Segmented } from "@/components/ui/Segmented";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { berlinDateISO, berlinInputToIso, formatTermin, formatTerminParts, isoToBerlinInput } from "@/lib/apptTime";
import { addDaysISO } from "@/lib/dates";
import type { TelefonHeute } from "@/lib/telefonHeute";
import type { PhoneLead, PhoneLeadStatus } from "@/lib/types";
import {
  CalendarPlus,
  CalendarX,
  Check,
  Clock,
  Copy,
  Globe,
  History,
  Phone,
  PhoneForwarded,
  PhoneOff,
  Search,
  SkipForward,
  Trash2,
  TriangleAlert,
  User,
  Voicemail,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

// Call-Modus (Redesign Phase 5): eine Liste Lead für Lead durchtelefonieren.
//
//   Kopfleiste (Glas)  Liste · Position · Zähler des Tages · Session-Uhr · Beenden
//   Links              „Als Nächstes": Rückruf fällig → Wiederholen → Noch nie angerufen
//   Mitte              der Lead: Firma, Entscheider, Nummer, letzter Verlauf, Notiz
//   Unten (Glas)       Ergebnis-Dock, Tasten 1–5 und S
//
// Das Verhalten der Server-Actions ist unverändert: `setPhoneLeadOutcome`
// routet den Lead (Rückruf / Nicht erreicht / Kein Termin → Routing-Listen des
// Inhabers), schreibt das Anruf-Log und beendet beim dritten „Nicht erreicht"
// in Folge automatisch. Neu ist nur der ZEITPUNKT (T1): Das Ergebnis wird
// fünf Sekunden zurückgehalten, „Rückgängig" verwirft es ohne Serveraufruf.
// Ein Revert nach dem Speichern hätte den Umzug in die Routing-Liste, den
// Log-Eintrag und die Dead-Serie zurückdrehen müssen — drei Stellen, die sich
// nicht sauber umkehren lassen.

type StatusFilter = PhoneLeadStatus | "alle" | "offen";

/** Statusfarben tragen nur PUNKTE, keine Flächen (unverändert seit dem Dialer-Umbau). */
const STATUS_STYLE: Record<PhoneLeadStatus, { label: string; color: string }> = {
  aktiv: { label: "Aktiv", color: "var(--text-muted)" },
  rueckruf: { label: "Rückruf", color: "var(--info)" },
  nicht_erreicht: { label: "Nicht erreicht", color: "var(--warning)" },
  kein_termin: { label: "Kein Termin", color: "var(--text-subtle)" },
  termin: { label: "Termin", color: "var(--success)" },
  dead: { label: "Tot", color: "var(--danger)" },
};

/** „Offen" = anrufbar: alles, was noch kein Ergebnis hat, das den Lead beendet. */
const OFFEN: ReadonlySet<PhoneLeadStatus> = new Set(["aktiv", "rueckruf", "nicht_erreicht"]);

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "offen", label: "Offen" },
  { value: "alle", label: "Alle" },
  { value: "aktiv", label: "Aktiv" },
  { value: "rueckruf", label: "Rückruf" },
  { value: "nicht_erreicht", label: "Nicht erreicht" },
  { value: "kein_termin", label: "Kein Termin" },
  { value: "termin", label: "Termin" },
  { value: "dead", label: "Tot" },
];

/**
 * Tastenkürzel der Ergebnis-Knöpfe. Ziffern statt Anfangsbuchstaben: `t` und
 * `n` lägen auf Deutsch doppelt. „Kein Termin" kam später und bekam die 5,
 * statt die vier bestehenden Kürzel umzunummerieren — die sitzen bei den
 * Settern in den Fingern.
 */
const OUTCOME_KEYS = { termin: "1", rueckruf: "2", nicht_erreicht: "3", dead: "4", kein_termin: "5" } as const;

/** T1: so lange wird ein Ergebnis zurückgehalten, bevor es gespeichert wird. */
const UNDO_MS = 5000;

/** Zeilenhöhen der virtualisierten Warteschlange. */
const QUEUE_ROW_HEIGHT = 52;
const QUEUE_HEAD_HEIGHT = 30;

/**
 * Session-Gruppe eines Leads (E8): feste Reihenfolge Rückruf fällig →
 * Wiederholen → Noch nie angerufen. Vergeben wird sie, wenn der Lead zum
 * ersten Mal in der Session auftaucht, und bleibt dann stehen — sonst spränge
 * ein Lead nach „Nicht erreicht" von „neu" nach oben in „Wiederholen", und die
 * Liste ordnete sich unter dem Setter neu.
 */
type Gruppe = "rueckruf" | "wiederholen" | "neu";
const GRUPPE_LABEL: Record<Gruppe, string> = {
  rueckruf: "Rückruf fällig",
  wiederholen: "Wiederholen",
  neu: "Noch nie angerufen",
};
const GRUPPE_RANG: Record<Gruppe, number> = { rueckruf: 0, wiederholen: 1, neu: 2 };

function gruppeFuer(l: PhoneLead, jetzt: number): Gruppe {
  if (l.status === "rueckruf" && l.callback_at !== null && Date.parse(l.callback_at) <= jetzt) return "rueckruf";
  if (l.first_call_at || (l.call_attempt ?? 0) > 0 || l.status !== "aktiv") return "wiederholen";
  return "neu";
}

const OUTCOME_LABEL: Record<"rueckruf" | "nicht_erreicht" | "kein_termin" | "dead", string> = {
  rueckruf: "Rückruf",
  nicht_erreicht: "Nicht erreicht",
  kein_termin: "Kein Termin",
  dead: "Tot",
};

/** Gründe für „Tot" (E8): keine Spalte, sie landen in der Notiz des Leads. */
const TOT_GRUENDE = ["Falsche Nummer", "Betrieb aufgegeben", "Will nicht angerufen werden", "Kein Fit"];

/** Schnellwahl für die Uhrzeit eines Termins. */
const TERMIN_ZEITEN = ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00", "17:00"];

/** Der Statuspunkt — das einzige Farbsignal je Status. */
function StatusDot({ status, size = 6 }: { status: PhoneLeadStatus; size?: number }) {
  return (
    <span
      title={STATUS_STYLE[status].label}
      style={{ width: size, height: size, borderRadius: "var(--r-full)", background: STATUS_STYLE[status].color, flexShrink: 0 }}
    />
  );
}

/**
 * Auswahl aus wenigen Werten (Chips). `value` darf `null` sein: NULL heißt
 * „noch nicht erfasst" und ist im Telefon-Modell der Normalfall (docs §7) —
 * ein vorbelegtes „Nein" wäre eine erfundene Antwort, die später als Fakt in
 * der Auswertung landet. Ein zweiter Klick auf die aktive Wahl nimmt sie zurück.
 */
function Chips<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | null;
  options: { value: T; label: string; neg?: boolean }[];
  onChange: (v: T | null) => void;
}) {
  return (
    <div className="cm-chips">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="cm-chip"
          data-neg={o.neg ? "" : undefined}
          aria-pressed={value === o.value}
          onClick={() => onChange(value === o.value ? null : o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Freitext-Notiz zum Lead (`phone_leads.notes`), immer sichtbar, speichert
 * selbst: 900 ms nach der letzten Eingabe und sofort beim Verlassen des Felds.
 * Ein Save je Tastendruck wären dutzende Roundtrips pro Satz.
 *
 * Der Entwurf lebt lokal und wird über `key={lead.id}` je Lead neu angelegt —
 * sonst trüge der Text beim Weiterblättern in den nächsten Lead hinüber. Wer
 * mitten im Tippen weiterblättert, verliert nichts: Beim Abbau wird ein noch
 * ausstehender Entwurf gespeichert.
 */
function NotesField({
  value,
  onCommit,
}: {
  value: string | null;
  onCommit: (next: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [stand, setStand] = useState<"ruhe" | "tippt" | "gespeichert">("ruhe");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zuletzt = useRef<string | null>(value ?? null);
  const entwurf = useRef(draft);
  const commitRef = useRef(onCommit);
  useEffect(() => {
    commitRef.current = onCommit;
  }, [onCommit]);

  function speichern() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = entwurf.current.trim() ? entwurf.current : null;
    if (next === zuletzt.current) {
      setStand((s) => (s === "tippt" ? "ruhe" : s));
      return;
    }
    zuletzt.current = next;
    commitRef.current(next);
    setStand("gespeichert");
  }

  useEffect(
    () => () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      const next = entwurf.current.trim() ? entwurf.current : null;
      if (next !== zuletzt.current) commitRef.current(next);
    },
    [],
  );

  return (
    <div className="cm-notes">
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          entwurf.current = e.target.value;
          setStand("tippt");
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(speichern, 900);
        }}
        onBlur={speichern}
        rows={3}
        placeholder="Notiz: wen erreicht man wann, worauf beim nächsten Anruf achten …"
        aria-label="Notizen zum Lead"
      />
      <span className="cm-notes-state" aria-live="polite">
        {stand === "tippt" ? "Speichert gleich …" : stand === "gespeichert" ? "Gespeichert" : "Speichert automatisch"}
      </span>
    </div>
  );
}

/** Session-Uhr: eigene Komponente, damit nicht der ganze Dialer jede Sekunde neu rendert. */
function SessionUhr() {
  const [start, setStart] = useState<number | null>(null);
  const [jetzt, setJetzt] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      const t = Date.now();
      setStart((s) => s ?? t);
      setJetzt(t);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  if (start === null || jetzt === null) return null;
  const s = Math.floor((jetzt - start) / 1000);
  const text = `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return (
    <span className="cm-clock tnum" title="Dauer dieser Session">
      <Clock size={13} aria-hidden /> {text}
    </span>
  );
}

/**
 * Schnellwahl für den Rückruf-Zeitpunkt, in Berliner Wandzeit. „In 1 Std"
 * wird auf die nächste Viertelstunde gerundet, damit im Kalender keine 14:37
 * steht; Freitag/Samstag heißt „morgen" der nächste Montag.
 */
function callbackPresets(nowMs: number): { label: string; value: string }[] {
  const QUARTER = 15 * 60_000;
  const inMinutes = (min: number) =>
    isoToBerlinInput(new Date(Math.ceil((nowMs + min * 60_000) / QUARTER) * QUARTER).toISOString());
  const today = berlinDateISO(new Date(nowMs).toISOString());
  const nowWall = isoToBerlinInput(new Date(nowMs).toISOString());
  const tomorrow = addDaysISO(today, 1);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = So
  const nextWorkday = weekday === 5 ? addDaysISO(today, 3) : weekday === 6 ? addDaysISO(today, 2) : tomorrow;
  const nextLabel = nextWorkday === tomorrow ? "Morgen" : "Montag";
  const presets = [
    { label: "In 1 Std", value: inMinutes(60) },
    { label: "In 2 Std", value: inMinutes(120) },
  ];
  if (`${today}T17:00` > nowWall) presets.push({ label: "Heute 17:00", value: `${today}T17:00` });
  presets.push(
    { label: `${nextLabel} 9:00`, value: `${nextWorkday}T09:00` },
    { label: `${nextLabel} 14:00`, value: `${nextWorkday}T14:00` },
  );
  return presets;
}

/** Die nächsten fünf Werktage (Berliner Kalender) für die Termin-Schnellwahl. */
function naechsteWerktage(nowMs: number): { iso: string; label: string }[] {
  const out: { iso: string; label: string }[] = [];
  let day = berlinDateISO(new Date(nowMs).toISOString());
  while (out.length < 5) {
    day = addDaysISO(day, 1);
    const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const p = formatTerminParts(new Date(`${day}T12:00:00Z`).toISOString());
    out.push({ iso: day, label: p?.date ?? day });
  }
  return out;
}

const HIST_LABEL: Record<string, string> = {
  termin: "Termin",
  rueckruf: "Rückruf vereinbart",
  nicht_erreicht: "Nicht erreicht",
  kein_termin: "Kein Termin",
  dead: "Tot",
  kein_ergebnis: "Kein Ergebnis",
};

type Tray = "termin" | "rueckruf" | "tot" | "ne3" | null;
type Verlauf = { rows: PhoneHistoryRow[]; available: boolean };
type Toast = { key: number; text: string; name: string; undo: boolean };
type Pending = { key: number; id: string; timer: ReturnType<typeof setTimeout>; run: () => void; revert: () => void };

/**
 * `leads` müssen NICHT aus einer einzigen Liste stammen: Die abgeleitete
 * „Setting No-Show"-Liste (/telefon/setting-no-show) sammelt Leads aus allen
 * Listen des Inhabers. Jede Aktion läuft deshalb über die `list_id` des
 * jeweiligen Leads, nie über eine Liste der Seite. In einer echten Liste ist
 * beides dasselbe.
 */
export function CallModeRunner({
  leads,
  empty,
  titel,
  untertitel,
  exitHref = "/telefon",
  heute = null,
  defaultStatus = "alle",
}: {
  leads: PhoneLead[];
  /** Leerzustand, wenn gar kein Lead da ist. Ohne Angabe: der Text einer Importliste. */
  empty?: { title: string; text: string };
  /** Name der Liste in der Kopfleiste. */
  titel?: string;
  /** Zweite Zeile unter dem Namen (Listenart, Testarm …). */
  untertitel?: string;
  /** Wohin „Beenden" führt. */
  exitHref?: string;
  /** Zähler des Tages vom Server (lib/telefonHeute.ts); `null` = Anruf-Log nicht lesbar. */
  heute?: TelefonHeute | null;
  /** Statusfilter ohne `?status=`. */
  defaultStatus?: StatusFilter;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [overrides, setOverrides] = useState<Record<string, Partial<PhoneLead>>>({});
  // `?status=` und `?lead=` öffnen den Call-Modus direkt an der richtigen
  // Stelle — z. B. aus der Lead-Tabelle der Listenseite.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const raw = searchParams.get("status");
    return FILTERS.some((f) => f.value === raw) ? (raw as StatusFilter) : defaultStatus;
  });
  const [search, setSearch] = useState("");
  const [currentId, setCurrentId] = useState<string | null>(() => searchParams.get("lead"));
  const [error, setError] = useState<string | null>(null);
  // Neutraler Hinweis (kein Fehler): z. B. „nach dem 3. Nicht erreicht auf Tot
  // gestellt". Ohne ihn verschwände der Lead aus der Erwartung des Setters.
  const [notice, setNotice] = useState<string | null>(null);
  const [tray, setTray] = useState<Tray>(null);
  const [callbackAt, setCallbackAt] = useState("");
  const [totGrund, setTotGrund] = useState("");
  const [termin, setTermin] = useState<{ at: string; kind: "link" | "telefon"; link: string; phone: string; error: string | null }>(
    { at: "", kind: "telefon", link: "", phone: "", error: null },
  );
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog } = useConfirm();
  // Was in dieser Session schon ein Ergebnis bekam: Lead-ID → Ergebnis-Wort.
  // Bleibt blass an seinem Platz stehen, statt aus der Liste zu verschwinden.
  const [erledigt, setErledigt] = useState<Record<string, string>>({});
  const [gruppen, setGruppen] = useState<Record<string, Gruppe>>({});
  const [verlauf, setVerlauf] = useState<Record<string, Verlauf>>({});
  const [toast, setToast] = useState<Toast | null>(null);
  const [kopiert, setKopiert] = useState(false);
  // Zähler: Stand des Servers beim Öffnen + was in dieser Session gespeichert
  // wurde. Der Server-Stand wird bewusst nur EINMAL übernommen — jede Action
  // revalidiert die Seite, ein neu übernommener Stand plus Session-Delta
  // zählte doppelt.
  const [basis] = useState(heute);
  const [delta, setDelta] = useState({ anwahlen: 0, entscheider: 0, termine: 0 });
  // „Jetzt" für die Rückruf-Schnellwahl und die Termin-Tage — erst beim
  // Öffnen gelesen, nicht im Render (react-hooks/purity).
  const [presetNow, setPresetNow] = useState<number | null>(null);

  const pendingRef = useRef<Pending | null>(null);
  const toastKey = useRef(0);
  const callLinkRef = useRef<HTMLAnchorElement>(null);
  const historyInFlight = useRef<Set<string>>(new Set());

  // Fokus-Modus: Solange der Dialer offen ist, weichen Seitenleiste und
  // Tab-Leiste (globals.css §10, `body[data-dialer]`).
  useEffect(() => {
    document.body.dataset.dialer = "1";
    return () => {
      delete document.body.dataset.dialer;
    };
  }, []);

  // Uhr für die Reihenfolge (Muster TermineBoard): `null` bis zum ersten Tick,
  // damit Server und Browser dieselbe Liste rendern.
  const [jetzt, setJetzt] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setJetzt(Date.now());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const merged = useMemo(() => leads.map((l) => ({ ...l, ...(overrides[l.id] ?? {}) })), [leads, overrides]);

  // Session-Gruppe beim ersten Auftauchen festschreiben (Render-Phasen-Update
  // statt setState im Effect; greift nur, solange Leads ohne Gruppe da sind).
  if (jetzt !== null) {
    const fehlend = merged.filter((l) => !(l.id in gruppen));
    if (fehlend.length > 0) {
      const neu: Record<string, Gruppe> = { ...gruppen };
      for (const l of fehlend) neu[l.id] = gruppeFuer(l, jetzt);
      setGruppen(neu);
    }
  }

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      alle: merged.length,
      offen: 0,
      aktiv: 0,
      rueckruf: 0,
      nicht_erreicht: 0,
      kein_termin: 0,
      termin: 0,
      dead: 0,
    };
    for (const l of merged) {
      counts[l.status] += 1;
      if (OFFEN.has(l.status)) counts.offen += 1;
    }
    return counts;
  }, [merged]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const passt = (l: PhoneLead) =>
      l.id in erledigt ||
      statusFilter === "alle" ||
      (statusFilter === "offen" ? OFFEN.has(l.status) : l.status === statusFilter);
    const gefiltert = merged.filter(
      (l) =>
        passt(l) &&
        (!q ||
          (l.company ?? "").toLowerCase().includes(q) ||
          (l.phone ?? "").toLowerCase().includes(q) ||
          (l.decider_name ?? "").toLowerCase().includes(q)),
    );
    if (jetzt === null) return gefiltert;
    // Session-Reihenfolge (E8): Rückruf fällig → Wiederholen → neu. Innerhalb
    // einer Gruppe bleibt die Reihenfolge der Liste (stabile Sortierung).
    const rang = (l: PhoneLead) => GRUPPE_RANG[gruppen[l.id] ?? "neu"];
    const treffer = gefiltert
      .map((l, i) => ({ l, i }))
      .sort((a, b) => rang(a.l) - rang(b.l) || a.i - b.i)
      .map((x) => x.l);
    // Fällige Rückrufe zuerst, nach verabredeter Uhrzeit (Prüfliste O4). 14 von
    // 17 Rückrufen waren überfällig, weil sie nur in einem Reiter standen, den
    // niemand öffnete.
    const faellig = (l: PhoneLead) => gruppen[l.id] === "rueckruf";
    const vorn = treffer
      .filter(faellig)
      .sort((a, b) => (a.callback_at ?? "").localeCompare(b.callback_at ?? ""));
    return [...vorn, ...treffer.filter((l) => !faellig(l))];
  }, [merged, statusFilter, search, jetzt, gruppen, erledigt]);

  const idxRaw = currentId ? filtered.findIndex((l) => l.id === currentId) : -1;
  const currentIndex = idxRaw >= 0 ? idxRaw : 0;
  const current = filtered.length > 0 ? filtered[currentIndex] : null;
  const offenInSession = filtered.filter((l) => !(l.id in erledigt)).length;

  /** Einen Lead in den Fokus holen — ein offenes Fach im Dock gehört zum alten. */
  function waehle(id: string | null) {
    setCurrentId(id);
    setTray(null);
  }
  function goto(i: number) {
    const t = filtered[i];
    if (t) waehle(t.id);
  }

  // Verlauf des aktuellen Leads nachladen (und den nächsten gleich mit).
  const nextId = filtered[currentIndex + 1]?.id ?? null;
  useEffect(() => {
    for (const id of [current?.id, nextId]) {
      if (!id || id in verlauf || historyInFlight.current.has(id)) continue;
      historyInFlight.current.add(id);
      void loadPhoneLeadHistory(id)
        .then((res) => setVerlauf((v) => ({ ...v, [id]: res })))
        .catch(() => setVerlauf((v) => ({ ...v, [id]: { rows: [], available: false } })))
        .finally(() => historyInFlight.current.delete(id));
    }
  }, [current?.id, nextId, verlauf]);

  const currentVerlauf = current ? verlauf[current.id] : undefined;
  // Dieselbe Serie wie `setPhoneLeadOutcome`: die letzten zwei Anwahlen nach
  // attempt_no, beide „Nicht erreicht" ⇒ das nächste „Nicht erreicht" beendet.
  const drittesNichtErreicht =
    !!currentVerlauf?.available &&
    currentVerlauf.rows.length >= 2 &&
    currentVerlauf.rows.slice(0, 2).every((r) => r.outcome === "nicht_erreicht");

  // ── Virtualisierte Warteschlange mit Gruppenköpfen ──
  type Zeile = { typ: "kopf"; gruppe: Gruppe; anzahl: number } | { typ: "lead"; lead: PhoneLead; index: number };
  const zeilen = useMemo(() => {
    const out: Zeile[] = [];
    const anzahl: Record<Gruppe, number> = { rueckruf: 0, wiederholen: 0, neu: 0 };
    for (const l of filtered) anzahl[gruppen[l.id] ?? "neu"] += 1;
    let letzte: Gruppe | null = null;
    filtered.forEach((l, index) => {
      const g = gruppen[l.id] ?? "neu";
      if (g !== letzte && jetzt !== null) {
        out.push({ typ: "kopf", gruppe: g, anzahl: anzahl[g] });
        letzte = g;
      }
      out.push({ typ: "lead", lead: l, index });
    });
    return out;
  }, [filtered, gruppen, jetzt]);

  const queueRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: zeilen.length,
    getScrollElement: () => queueRef.current,
    estimateSize: (i) => (zeilen[i]?.typ === "kopf" ? QUEUE_HEAD_HEIGHT : QUEUE_ROW_HEIGHT),
    overscan: 10,
  });

  // Aktiven Lead beim Weiterblättern in der Warteschlange sichtbar halten.
  const activeId = current?.id ?? null;
  useEffect(() => {
    if (!activeId) return;
    const i = zeilen.findIndex((z) => z.typ === "lead" && z.lead.id === activeId);
    if (i >= 0) rowVirtualizer.scrollToIndex(i, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Toast ohne Rückgängig verschwindet von selbst.
  useEffect(() => {
    if (!toast || toast.undo) return;
    const t = setTimeout(() => setToast((x) => (x?.key === toast.key ? null : x)), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Ein zurückgehaltenes Ergebnis darf nie verloren gehen: Beim Verlassen der
  // Seite (Navigation in der App) und beim Schließen des Tabs wird es sofort
  // gespeichert. Der Browser fragt beim Schließen zusätzlich nach.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      const p = pendingRef.current;
      if (!p) return;
      clearTimeout(p.timer);
      pendingRef.current = null;
      p.run();
      e.preventDefault();
    }
    // Tab geht in den Hintergrund (Handy: Tipp auf die Nummer, App-Wechsel):
    // sofort speichern. Ein verworfener Hintergrund-Tab führt sonst keinen
    // Timer mehr aus, und das Ergebnis wäre weg (Ablauf-Prüfung 27.11.).
    function onHidden() {
      if (document.visibilityState !== "hidden") return;
      const p = pendingRef.current;
      if (!p) return;
      clearTimeout(p.timer);
      pendingRef.current = null;
      p.run();
      // Gespeichert ist gespeichert: kein „Rückgängig" mehr anbieten.
      setToast((t) => (t ? { ...t, undo: false } : t));
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onHidden);
      const p = pendingRef.current;
      if (p) {
        clearTimeout(p.timer);
        pendingRef.current = null;
        p.run();
      }
    };
  }, []);

  function setField(id: string, patch: Partial<PhoneLead>) {
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function zeigeToast(text: string, name: string, undo: boolean) {
    toastKey.current += 1;
    setToast({ key: toastKey.current, text, name, undo });
    return toastKey.current;
  }

  /**
   * Optimistisch in die Overrides schreiben + speichern. Schlägt der Save fehl,
   * werden die betroffenen Felder zurückgerollt, damit die UI nie
   * Ungespeichertes als gespeichert anzeigt.
   */
  function setAndSave(id: string, uiPatch: Partial<PhoneLead>, savePatch: Partial<PhoneLeadInput>) {
    const lead = merged.find((l) => l.id === id);
    const prevPatch: Partial<PhoneLead> = {};
    if (lead) {
      for (const k of Object.keys(uiPatch) as (keyof PhoneLead)[]) {
        (prevPatch as Record<string, unknown>)[k] = lead[k];
      }
    }
    setField(id, uiPatch);
    // Bewusst AUSSERHALB von startTransition: Ein Feld-Save sperrte sonst die
    // Ergebnis-Knöpfe und die Tasten 1–5 — lautlos.
    void (async () => {
      const res = await updatePhoneLead(id, lead?.list_id ?? "", savePatch);
      if (res.error) {
        setError(res.error);
        if (lead) setField(id, prevPatch);
      } else {
        setError(null);
      }
    })();
  }

  /** Nach einem Ergebnis zum nächsten Lead, der in dieser Session noch offen ist. */
  function advance() {
    const rest = filtered.slice(currentIndex + 1).find((l) => !(l.id in erledigt));
    const vorher = filtered.slice(0, currentIndex).find((l) => !(l.id in erledigt));
    waehle(rest?.id ?? vorher?.id ?? current?.id ?? null);
  }

  /** Ein zurückgehaltenes Ergebnis sofort speichern (nächstes Ergebnis, Verlassen). */
  function flushPending() {
    const p = pendingRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    pendingRef.current = null;
    p.run();
  }

  /** T1: Rückgängig verwirft das zurückgehaltene Ergebnis — kein Serveraufruf. */
  function undo() {
    const p = pendingRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    pendingRef.current = null;
    p.revert();
    setToast(null);
  }

  function markErledigt(id: string, label: string | null) {
    setErledigt((prev) => {
      const next = { ...prev };
      if (label === null) delete next[id];
      else next[id] = label;
      return next;
    });
  }

  /**
   * Ergebnis setzen. Der nächste Lead steht SOFORT da; gespeichert wird nach
   * UNDO_MS (T1) — Status, Routing-Liste, Anruf-Log, ggf. Recycling, alles in
   * `setPhoneLeadOutcome`. Schlägt das Speichern fehl, wird der Lead
   * zurückgesetzt und die Meldung nennt ihn beim Namen: Der Setter steht dann
   * schon beim nächsten und muss wissen, WELCHER nicht gespeichert wurde.
   * Server Actions laufen seriell, schnelle Ergebnisse überholen sich nicht.
   */
  function applyOutcome(
    outcome: "rueckruf" | "nicht_erreicht" | "kein_termin" | "dead",
    callbackAtVal?: string,
    grund?: string,
  ) {
    if (!current) return;
    flushPending();
    const id = current.id;
    const listId = current.list_id;
    const name = current.company ?? current.phone ?? "Lead";
    const prev = { status: current.status, callback_at: current.callback_at };
    const notizVorher = current.notes;
    const entscheider = current.decider_reached === true || outcome === "kein_termin";
    const label =
      outcome === "rueckruf" && callbackAtVal
        ? `Rückruf ${formatTermin(berlinInputToIso(callbackAtVal)) ?? ""}`.trim()
        : outcome === "nicht_erreicht" && drittesNichtErreicht
          ? "Nicht erreicht · Lead beendet"
          : OUTCOME_LABEL[outcome];

    // callback_at hält in der DB echtes UTC; das Feld liefert Berlin-Wandzeit.
    // Der optimistische Override muss dieselbe Einheit tragen wie die Serverzeile.
    setField(id, {
      status: outcome,
      ...(callbackAtVal ? { callback_at: berlinInputToIso(callbackAtVal) } : {}),
    });
    markErledigt(id, label);
    setError(null);
    setNotice(null);
    setCallbackAt("");
    setTotGrund("");
    advance();

    const run = () => {
      void (async () => {
        // E8: Der Grund für „Tot" hat keine Spalte — er steht in der Notiz.
        if (outcome === "dead" && grund?.trim()) {
          const zeile = `Tot: ${grund.trim()}`;
          const notes = notizVorher?.trim() ? `${notizVorher.trimEnd()}\n${zeile}` : zeile;
          const r = await updatePhoneLead(id, listId, { notes });
          if (!r.error) setField(id, { notes });
        }
        const res = await setPhoneLeadOutcome({
          leadId: id,
          listId,
          outcome,
          callbackAt: callbackAtVal ?? null,
        });
        setToast((t) => (t?.key === key ? null : t));
        if (res.error) {
          setField(id, prev);
          markErledigt(id, null);
          setError(`„${name}" wurde nicht gespeichert: ${res.error}`);
          return;
        }
        if (res.autoDead) {
          setNotice(`„${name}" war 3-mal hintereinander nicht erreichbar und steht jetzt auf Tot.`);
        }
        // attemptNo kommt aus dem Anruf-Log — fehlt es (fail-soft), bleibt der
        // bisherige Zähler stehen, statt eine Zahl zu erfinden.
        if (res.autoDead || res.attemptNo != null) {
          setField(id, {
            ...(res.autoDead ? { status: "dead" as const } : {}),
            ...(res.attemptNo != null ? { call_attempt: res.attemptNo } : {}),
          });
        }
        if (res.attemptNo != null) {
          setDelta((d) => ({ ...d, anwahlen: d.anwahlen + 1, entscheider: d.entscheider + (entscheider ? 1 : 0) }));
        }
        setVerlauf((v) => {
          const n = { ...v };
          delete n[id];
          return n;
        });
      })();
    };
    const key = zeigeToast(label, name, true);
    pendingRef.current = {
      key,
      id,
      run,
      revert: () => {
        setField(id, prev);
        markErledigt(id, null);
        waehle(id);
      },
      timer: setTimeout(() => {
        if (pendingRef.current?.key !== key) return;
        pendingRef.current = null;
        run();
      }, UNDO_MS),
    };
  }

  /** Fach im Dock öffnen (Klick und Taste nehmen denselben Weg). */
  function openTray(t: Exclude<Tray, null>) {
    if (!current) return;
    if (tray === t) return setTray(null);
    if (t === "rueckruf") {
      setCallbackAt(isoToBerlinInput(current.callback_at));
      setPresetNow(Date.now());
    }
    if (t === "termin") {
      setPresetNow(Date.now());
      setTermin({
        at: isoToBerlinInput(current.appointment_at),
        kind: "telefon",
        // Vorausgefüllt, damit „Telefon" ein Klick ist statt Abtippen.
        phone: current.phone ?? "",
        link: current.meet_link ?? "",
        error: null,
      });
    }
    if (t === "tot") setTotGrund("");
    setTray(t);
  }

  // `?aktion=termin` (aus „Heute“, Knopf „Termin“ an einem Rückruf): Der
  // angesprungene Lead öffnet gleich mit dem Termin-Fach — ein Klick statt
  // sechs (Prüfung 28.11.). Nur einmal, nur für genau diesen Lead.
  const aktionErledigt = useRef(false);
  useEffect(() => {
    if (aktionErledigt.current || jetzt === null || !current) return;
    if (searchParams.get("aktion") !== "termin" || current.id !== searchParams.get("lead")) return;
    aktionErledigt.current = true;
    openTray("termin");
    // openTray liest nur `current` und setzt Zustand — einmalig beim Öffnen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jetzt, current]);

  /** „Nicht erreicht": beim dritten in Folge fragt das Dock nach. */
  function nichtErreicht() {
    if (drittesNichtErreicht) openTray("ne3");
    else applyOutcome("nicht_erreicht");
  }

  function skip() {
    if (!current) return;
    const name = current.company ?? current.phone ?? "Lead";
    goto(currentIndex + 1);
    zeigeToast("übersprungen · bleibt in der Liste", name, false);
  }

  /**
   * Termin legen — inline statt im Dialog. Läuft wie bisher über
   * `convertPhoneLeadToSetting` (Setting anlegen, Lead auf Termin, Anruf-Log)
   * und wird SOFORT gespeichert: Er ist ein Formular mit Pflichtfeldern, kein
   * Tastendruck, und ließe sich nur über das Löschen des Settings zurücknehmen.
   */
  function saveTermin() {
    if (!current) return;
    const at = termin.at.trim();
    const link = termin.link.trim();
    const nummer = termin.phone.trim();
    if (!at || !at.includes("T")) return setTermin((t) => ({ ...t, error: "Bitte Tag und Uhrzeit wählen." }));
    if (termin.kind === "link" && !link)
      return setTermin((t) => ({ ...t, error: "Bitte den Termin-Link eintragen oder Art auf Telefon stellen." }));
    if (termin.kind === "telefon" && !nummer)
      return setTermin((t) => ({ ...t, error: "Bitte die Rufnummer eintragen — ohne sie kann niemand einspringen." }));
    flushPending();
    const lead = current;
    startTransition(async () => {
      const res = await convertPhoneLeadToSetting({
        phoneLeadId: lead.id,
        listId: current.list_id,
        meetLink: termin.kind === "link" ? link : null,
        phone: termin.kind === "telefon" ? nummer : null,
        meetingKind: termin.kind,
        appointmentAt: at,
      });
      if (res.error) {
        setTermin((t) => ({ ...t, error: res.error ?? "Termin wurde nicht gespeichert." }));
        return;
      }
      const label = `Termin ${formatTermin(berlinInputToIso(at)) ?? ""}`.trim();
      setField(lead.id, { status: "termin", appointment_set: true });
      markErledigt(lead.id, label);
      // Ein bestehendes Setting neu terminiert (No-Show) ist eine Anwahl, aber
      // kein neu GELEGTER Termin.
      const neu = lead.status !== "termin";
      setDelta((d) => ({
        anwahlen: d.anwahlen + 1,
        entscheider: d.entscheider + 1,
        termine: d.termine + (neu ? 1 : 0),
      }));
      setVerlauf((v) => {
        const n = { ...v };
        delete n[lead.id];
        return n;
      });
      advance();
      zeigeToast(label, lead.company ?? lead.phone ?? "Lead", false);
      router.refresh();
    });
  }

  /** Aktuellen Lead nach Bestätigung endgültig löschen, dann weiterspringen. */
  async function handleDeleteLead() {
    if (!current) return;
    const ok = await confirm({
      title: "Lead löschen?",
      message: `"${current.company ?? current.phone ?? "Lead"}" endgültig löschen? Das kann nicht rückgängig gemacht werden.`,
      confirmLabel: "Löschen",
      destructive: true,
    });
    if (!ok) return;
    const id = current.id;
    const listId = current.list_id;
    startTransition(async () => {
      const res = await deletePhoneLead(id, listId);
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      advance();
      router.refresh();
    });
  }

  async function copyNumber() {
    if (!current?.phone) return;
    try {
      await navigator.clipboard.writeText(current.phone);
      setKopiert(true);
      setTimeout(() => setKopiert(false), 1500);
    } catch {
      /* Zwischenablage gesperrt — die Nummer steht groß daneben. */
    }
  }

  // Tastatur: ← → ↑ ↓ blättern, 1–5 Ergebnis, S überspringen, Leertaste wählt,
  // Z nimmt das letzte Ergebnis zurück, Esc schließt das Fach. Nichts davon
  // greift, während in einem Feld getippt wird — sonst löste die „4" in einer
  // Telefonnummer einen toten Lead aus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && tray) {
        setTray(null);
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement | null)?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        return goto(currentIndex - 1);
      }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        return goto(currentIndex + 1);
      }
      if (e.key === "z" || e.key === "Z") {
        if (pendingRef.current) {
          e.preventDefault();
          undo();
        }
        return;
      }
      if (!current || isPending) return;
      if (e.key === " " && (e.target as HTMLElement | null)?.tagName !== "BUTTON") {
        e.preventDefault();
        callLinkRef.current?.click();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        skip();
      } else if (e.key === OUTCOME_KEYS.termin) {
        e.preventDefault();
        openTray("termin");
      } else if (e.key === OUTCOME_KEYS.rueckruf) {
        e.preventDefault();
        openTray("rueckruf");
      } else if (e.key === OUTCOME_KEYS.nicht_erreicht) {
        e.preventDefault();
        nichtErreicht();
      } else if (e.key === OUTCOME_KEYS.dead) {
        e.preventDefault();
        openTray("tot");
      } else if (e.key === OUTCOME_KEYS.kein_termin) {
        e.preventDefault();
        applyOutcome("kein_termin");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, filtered, current, isPending, tray, drittesNichtErreicht, erledigt]);

  const z = basis ? { anwahlen: basis.anwahlen + delta.anwahlen, entscheider: basis.entscheider + delta.entscheider, termine: basis.termine + delta.termine } : null;
  const ziel = basis?.tagesziel ?? 0;
  const gruppeCurrent = current ? (gruppen[current.id] ?? "neu") : null;
  const telHref = current?.phone ? `tel:${current.phone.replace(/[^\d+]/g, "")}` : null;

  return (
    <div className="cm">
      {/* ══ Kopfleiste ══ */}
      <header className="cm-bar glass">
        <div className="cm-bar-who">
          <span className="cm-bar-icon" aria-hidden>
            <Phone size={16} />
          </span>
          <div style={{ minWidth: 0 }}>
            <b>{titel ?? "Call-Modus"}</b>
            <small className="tnum">
              {[untertitel, filtered.length > 0 ? `${currentIndex + 1} von ${filtered.length}` : null, offenInSession < filtered.length ? `${filtered.length - offenInSession} erledigt` : null]
                .filter(Boolean)
                .join(" · ")}
            </small>
          </div>
        </div>
        {z && (
          <div className="cm-sess" aria-label="Heute">
            <div>
              <b className="tnum">{z.anwahlen}</b>
              <small>Anwahlen</small>
            </div>
            <div>
              <b className="tnum">{z.entscheider}</b>
              <small>Entscheider</small>
            </div>
            <div data-acc="">
              <b className="tnum">{z.termine}</b>
              <small>Termine</small>
            </div>
            {ziel > 0 && (
              <div className="cm-goal">
                <small>
                  <span>Tagesziel</span>
                  <span className="tnum">
                    {z.anwahlen} / {ziel}
                  </span>
                </small>
                <div className="cm-meter">
                  <i data-done={z.anwahlen >= ziel ? "" : undefined} style={{ width: `${Math.min(100, (z.anwahlen / ziel) * 100)}%` }} />
                </div>
              </div>
            )}
          </div>
        )}
        <div className="cm-bar-acts">
          <SessionUhr />
          <Link className="ui-btn" data-variant="secondary" data-size="sm" href={exitHref} style={{ minHeight: 30, padding: "0 12px" }}>
            <X size={14} aria-hidden /> Beenden
          </Link>
        </div>
      </header>

      {notice && !error && (
        <div role="status" className="cm-banner">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="cm-banner" data-tone="error">
          {error}
        </div>
      )}

      {leads.length === 0 ? (
        <div className="card dot-grid">
          <div className="empty-state">
            <Phone size={24} />
            <div style={{ fontSize: "var(--fs-md)", fontWeight: "var(--fw-medium)", color: "var(--text-primary)" }}>
              {empty?.title ?? "Keine Leads in dieser Liste"}
            </div>
            <p style={{ fontSize: "var(--fs-base)", color: "var(--text-muted)", margin: 0 }}>
              {empty?.text ?? "Importiere eine CSV auf der Telefon-Übersicht — die Leads landen dann hier im Call-Mode."}
            </p>
          </div>
        </div>
      ) : (
        <div className="cm-grid">
          {/* ══ Mitte: der Lead ══ */}
          <section className="card cm-stage" key={current?.id ?? "leer"}>
            {!current ? (
              <div className="empty-state">
                <Search size={22} />
                <div style={{ fontSize: "var(--fs-md)", fontWeight: "var(--fw-medium)", color: "var(--text-primary)" }}>
                  Keine Leads für diesen Filter
                </div>
                <p style={{ fontSize: "var(--fs-base)", color: "var(--text-muted)", margin: 0 }}>
                  Filter oder Suche anpassen, um weitere Leads zu sehen.
                </p>
              </div>
            ) : (
              <>
                <div className="cm-top">
                  {gruppeCurrent === "rueckruf" && current.callback_at ? (
                    <span className="badge" data-tone="warning">
                      <Clock size={12} /> Rückruf {formatTerminParts(current.callback_at)?.time}
                    </span>
                  ) : gruppeCurrent === "neu" ? (
                    <span className="badge" data-tone="accent">
                      Erstanruf
                    </span>
                  ) : (
                    <span className="badge badge-gray tnum">{(current.call_attempt ?? 0) + 1}. Anruf</span>
                  )}
                  <span className="badge badge-gray" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <StatusDot status={current.status} /> {STATUS_STYLE[current.status].label}
                  </span>
                  {current.target_group && <span className="badge badge-gray">{current.target_group}</span>}
                  {current.id in erledigt && (
                    <span className="badge" data-tone="success">
                      <Check size={12} /> {erledigt[current.id]}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    onClick={handleDeleteLead}
                    icon={<Trash2 size={13} />}
                    aria-label="Lead löschen"
                    title="Lead löschen"
                    style={{ marginLeft: "auto", color: "var(--text-muted)" }}
                  />
                </div>

                <h2 className="cm-firm" style={{ overflowWrap: "anywhere" }}>
                  {current.company || "Unbekannte Firma"}
                </h2>
                <div className="cm-who">
                  {current.decider_name && (
                    <span>
                      <User size={14} aria-hidden /> {current.decider_name}
                    </span>
                  )}
                  {current.website && (
                    <a
                      href={current.website.startsWith("http") ? current.website : `https://${current.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={current.website}
                    >
                      <Globe size={14} aria-hidden /> {current.website}
                    </a>
                  )}
                </div>

                {/* Die Nummer: die eine Handlung, die den Bildschirm verlässt. */}
                <div className="cm-dial">
                  <div style={{ minWidth: 0 }}>
                    {current.phone ? (
                      <a className="cm-nr tnum" href={`tel:${current.phone.replace(/[^\d+]/g, "")}`}>
                        {current.phone}
                      </a>
                    ) : (
                      <span className="cm-nr" style={{ color: "var(--text-muted)", fontSize: 18 }}>
                        Keine Telefonnummer
                      </span>
                    )}
                    <div className="cm-dial-sub">
                      {current.phone && (
                        <span className="cm-kbd-hint">
                          <span className="dialer-kbd">Leertaste</span> wählt
                        </span>
                      )}
                      {current.callback_at && current.status === "rueckruf" && gruppeCurrent !== "rueckruf" && (
                        <span>Rückruf {formatTermin(current.callback_at)}</span>
                      )}
                    </div>
                  </div>
                  {telHref && (
                    <div className="cm-dial-btns">
                      <a ref={callLinkRef} className="ui-btn cm-callbtn" data-variant="primary" href={telHref}>
                        <Phone size={18} aria-hidden /> Anrufen
                      </a>
                      <button
                        type="button"
                        className="ui-btn cm-copy"
                        data-variant="secondary"
                        onClick={copyNumber}
                        title="Nummer kopieren"
                        aria-label="Nummer kopieren"
                      >
                        {kopiert ? <Check size={16} /> : <Copy size={16} />}
                      </button>
                    </div>
                  )}
                </div>

                {/* Letzter Verlauf aus dem Anruf-Log. */}
                {currentVerlauf?.available && currentVerlauf.rows.length > 0 && (
                  <div className="cm-hist">
                    <History size={14} aria-hidden />
                    {currentVerlauf.rows.slice(0, 3).map((r, i) => {
                      const p = formatTerminParts(r.called_at);
                      return (
                        <span key={`${r.attempt_no}-${i}`}>
                          <span className="tnum">{p ? `${p.date} ${p.time}` : ""}</span> · {HIST_LABEL[r.outcome] ?? r.outcome}
                        </span>
                      );
                    })}
                  </div>
                )}
                {drittesNichtErreicht && (
                  <div className="cm-warn3" role="note">
                    <TriangleAlert size={15} aria-hidden />
                    Zweimal in Folge nicht erreicht. Ein drittes „Nicht erreicht“ beendet den Lead.
                  </div>
                )}

                {/* ── Gesprächsverlauf ──
                    Zwei Selektoren, mehr nicht: Gatekeeper (freiwillig) und
                    Entscheider. Pitch-Schritt, Abbruch-Gründe und Leitfaden
                    sind mit dem Release gefallen (docs §0.3). „Termin" und
                    „Kein Termin" setzen den Entscheider ohnehin selbst (N5). */}
                <div className="cm-steps">
                  <div className="cm-step">
                    <div>
                      <label className="dialer-label">Gatekeeper erreicht?</label>
                      <span className="cm-optional">freiwillig</span>
                    </div>
                    <Chips
                      value={current.gatekeeper_reached}
                      options={[
                        { value: "nein", label: "Nein", neg: true },
                        { value: "ja", label: "Über Gatekeeper" },
                        { value: "direkt", label: "Direkt" },
                      ]}
                      onChange={(v) => {
                        setAndSave(current.id, { gatekeeper_reached: v }, { gatekeeper_reached: v });
                      }}
                    />
                  </div>
                  <div className="cm-step">
                    <div>
                      <label className="dialer-label">Entscheider erreicht?</label>
                    </div>
                    <Chips
                      value={current.decider_reached === null ? null : current.decider_reached ? "ja" : "nein"}
                      options={[
                        { value: "ja", label: "Ja" },
                        { value: "nein", label: "Nein", neg: true },
                      ]}
                      onChange={(v) => {
                        // Kein Entscheider am Apparat ⇒ es kann auch kein Pitch
                        // durchgekommen sein. Das Pitch-Feld hat keine Bedienung
                        // mehr; die Kaskade bleibt trotzdem stehen, sonst bliebe
                        // nach einem zurückgenommenen „Ja" eine unmögliche
                        // Kombination in der Zeile.
                        if (v === "ja") {
                          setAndSave(current.id, { decider_reached: true }, { decider_reached: true });
                        } else if (v === "nein") {
                          setAndSave(
                            current.id,
                            { decider_reached: false, pitch_delivered: false },
                            { decider_reached: false, pitch_delivered: false },
                          );
                        } else {
                          setAndSave(current.id, { decider_reached: null }, { decider_reached: null });
                        }
                      }}
                    />
                  </div>
                </div>

                <NotesField
                  key={current.id}
                  value={current.notes}
                  onCommit={(next) => setAndSave(current.id, { notes: next }, { notes: next })}
                />
              </>
            )}
          </section>

          {/* ══ Links: Als Nächstes ══ */}
          <section className="card cm-queue">
            <header className="cm-queue-head">
              <h2>Als Nächstes</h2>
              <span className="tnum">{offenInSession} offen</span>
            </header>
            <div className="cm-queue-tools">
              <select
                className="input"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                aria-label="Welche Leads"
              >
                {FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label} ({statusCounts[f.value]})
                  </option>
                ))}
              </select>
              <div style={{ position: "relative" }}>
                <Search size={13} className="cm-search-icon" aria-hidden />
                <input
                  className="input"
                  type="search"
                  enterKeyHint="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Firma / Telefon suchen…"
                  style={{ paddingLeft: 30 }}
                />
              </div>
            </div>
            <div ref={queueRef} className="cm-q">
              <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
                {rowVirtualizer.getVirtualItems().map((vi) => {
                  const zeile = zeilen[vi.index];
                  if (!zeile) return null;
                  if (zeile.typ === "kopf") {
                    return (
                      <div
                        key={`kopf-${zeile.gruppe}`}
                        className="cm-qh"
                        style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}
                      >
                        <span>{GRUPPE_LABEL[zeile.gruppe]}</span>
                        <span className="tnum">{zeile.anzahl}</span>
                      </div>
                    );
                  }
                  const l = zeile.lead;
                  const active = current?.id === l.id;
                  const g = gruppen[l.id] ?? "neu";
                  const done = l.id in erledigt;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      className="cm-qi"
                      data-active={active ? "true" : undefined}
                      data-done={done ? "" : undefined}
                      onClick={() => waehle(l.id)}
                      style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}
                    >
                      <span className="cm-mark" data-gold={g === "rueckruf" && !done ? "" : undefined} />
                      <span style={{ minWidth: 0 }}>
                        <span
                          // Die Zeile hat eine feste Höhe (Virtualisierung), der
                          // Name wird also gekürzt. Der volle steht im Titel —
                          // und ungekürzt in der Karte daneben.
                          title={l.company || l.phone || undefined}
                          className="cm-qi-t1"
                        >
                          {l.company || l.phone || "—"}
                        </span>
                        <span className="cm-qi-t2 tnum">{l.decider_name ?? l.phone ?? "keine Nummer"}</span>
                      </span>
                      <span className="cm-qi-tm tnum" data-gold={g === "rueckruf" && !done ? "" : undefined}>
                        {done
                          ? erledigt[l.id]
                          : g === "rueckruf"
                            ? (formatTerminParts(l.callback_at)?.time ?? "")
                            : g === "wiederholen"
                              ? `${(l.call_attempt ?? 0) + 1}. Anruf`
                              : "neu"}
                      </span>
                    </button>
                  );
                })}
              </div>
              {filtered.length === 0 && (
                <p style={{ fontSize: "var(--fs-base)", color: "var(--text-muted)", textAlign: "center", padding: "var(--sp-7) var(--sp-5)" }}>
                  Keine Treffer.
                </p>
              )}
            </div>
          </section>
        </div>
      )}

      {/* ══ Ergebnis-Dock ══ */}
      {current && (
        <div className="cm-dock glass dense" role="toolbar" aria-label="Ergebnis des Anrufs">
          {tray === "termin" && (
            <div className="cm-tray">
              <h4>
                <CalendarPlus size={15} aria-hidden /> Erstgespräch legen
                <small>{current.decider_name ?? current.company ?? ""}</small>
              </h4>
              {presetNow != null && (
                <div className="cm-tray-row">
                  <span className="cm-tray-lb">Tag</span>
                  <div className="cm-chips">
                    {naechsteWerktage(presetNow).map((d) => (
                      <button
                        key={d.iso}
                        type="button"
                        className="cm-chip"
                        aria-pressed={termin.at.startsWith(d.iso)}
                        onClick={() =>
                          setTermin((t) => ({ ...t, at: `${d.iso}T${t.at.split("T")[1] || "10:00"}`, error: null }))
                        }
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="cm-tray-row">
                <span className="cm-tray-lb">Uhrzeit</span>
                <div className="cm-chips">
                  {TERMIN_ZEITEN.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="cm-chip"
                      aria-pressed={termin.at.endsWith(`T${s}`)}
                      disabled={!termin.at}
                      onClick={() => setTermin((t) => ({ ...t, at: `${t.at.split("T")[0]}T${s}`, error: null }))}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div className="cm-tray-row">
                <span className="cm-tray-lb">Genau</span>
                <DateTimeField
                  id="cm-termin-at"
                  value={termin.at}
                  onChange={(v) => setTermin((t) => ({ ...t, at: v, error: null }))}
                  ariaLabel="Termin"
                  style={{ width: 320, maxWidth: "100%" }}
                />
              </div>
              <div className="cm-tray-row">
                <span className="cm-tray-lb">Art</span>
                <Segmented<"telefon" | "link">
                  options={[
                    { value: "telefon", label: "Telefon" },
                    { value: "link", label: "Meet-Link" },
                  ]}
                  value={termin.kind}
                  onChange={(k) => setTermin((t) => ({ ...t, kind: k, error: null }))}
                  ariaLabel="Termin-Art"
                />
                {termin.kind === "telefon" ? (
                  <input
                    className="input cm-field"
                    type="tel"
                    placeholder="+49 …"
                    value={termin.phone}
                    onChange={(e) => setTermin((t) => ({ ...t, phone: e.target.value, error: null }))}
                    aria-label="Rufnummer für den Termin"
                  />
                ) : (
                  <input
                    className="input cm-field"
                    type="url"
                    placeholder="https://meet.google.com/…"
                    value={termin.link}
                    onChange={(e) => setTermin((t) => ({ ...t, link: e.target.value, error: null }))}
                    aria-label="Termin-Link"
                  />
                )}
              </div>
              {termin.error && <p className="cm-tray-err">{termin.error}</p>}
              <div className="cm-tray-fin">
                <Button variant="ghost" size="sm" onClick={() => setTray(null)}>
                  Abbrechen
                </Button>
                <Button variant="primary" size="sm" loading={isPending} onClick={saveTermin} icon={<Check size={14} />}>
                  Termin legen{termin.at.includes("T") ? ` · ${formatTermin(berlinInputToIso(termin.at)) ?? ""}` : ""}
                </Button>
              </div>
            </div>
          )}
          {tray === "rueckruf" && (
            <div className="cm-tray">
              <h4>
                <PhoneForwarded size={15} aria-hidden /> Rückruf vereinbaren
                <small>wird auf die Minute fällig · der Lead wandert in die Rückruf-Liste des Inhabers</small>
              </h4>
              <div className="cm-tray-row">
                {presetNow != null && (
                  <div className="cm-chips" role="group" aria-label="Schnellwahl">
                    {callbackPresets(presetNow).map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        className="cm-chip"
                        aria-pressed={callbackAt === p.value}
                        onClick={() => setCallbackAt(p.value)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}
                <DateTimeField
                  id="callback-at"
                  value={callbackAt}
                  onChange={setCallbackAt}
                  ariaLabel="Rückruf"
                  style={{ width: 320, maxWidth: "100%" }}
                />
              </div>
              <div className="cm-tray-fin">
                <Button variant="ghost" size="sm" onClick={() => setTray(null)}>
                  Abbrechen
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!callbackAt.includes("T")}
                  onClick={() => applyOutcome("rueckruf", callbackAt)}
                  icon={<Check size={14} />}
                >
                  Rückruf speichern
                </Button>
              </div>
            </div>
          )}
          {tray === "tot" && (
            <div className="cm-tray">
              <h4>
                <PhoneOff size={15} aria-hidden /> Tot
                <small>kommt später als Wiedervorlage zurück · der Grund steht danach in der Notiz</small>
              </h4>
              <div className="cm-tray-row">
                <div className="cm-chips">
                  {TOT_GRUENDE.map((g) => (
                    <button
                      key={g}
                      type="button"
                      className="cm-chip"
                      aria-pressed={totGrund === g}
                      onClick={() => setTotGrund((x) => (x === g ? "" : g))}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                <input
                  className="input cm-field"
                  value={TOT_GRUENDE.includes(totGrund) ? "" : totGrund}
                  onChange={(e) => setTotGrund(e.target.value)}
                  placeholder="Eigener Grund (freiwillig)"
                  aria-label="Grund für Tot"
                />
              </div>
              <div className="cm-tray-fin">
                <Button variant="ghost" size="sm" onClick={() => setTray(null)}>
                  Abbrechen
                </Button>
                <Button variant="danger" size="sm" onClick={() => applyOutcome("dead", undefined, totGrund)} icon={<X size={14} />}>
                  Lead beenden
                </Button>
              </div>
            </div>
          )}
          {tray === "ne3" && (
            <div className="cm-tray">
              <h4>
                <TriangleAlert size={15} aria-hidden /> Dritter Fehlversuch in Folge
                <small>„Nicht erreicht“ beendet {current.company ?? "den Lead"} jetzt automatisch</small>
              </h4>
              <div className="cm-tray-fin">
                <Button variant="ghost" size="sm" onClick={() => setTray(null)}>
                  Abbrechen
                </Button>
                <Button variant="danger" size="sm" onClick={() => applyOutcome("nicht_erreicht")} icon={<Check size={14} />}>
                  Trotzdem speichern
                </Button>
              </div>
            </div>
          )}

          {/* Am Handy liegt Anrufen mit im Dock — im Daumenbereich, egal wie
              weit die Karte gescrollt ist. Am Desktop steht es an der Nummer. */}
          {telHref && (
            <a className="cm-dock-call" href={telHref}>
              <Phone size={18} aria-hidden /> Anrufen <span className="tnum">{current.phone}</span>
            </a>
          )}
          <div className="cm-outs">
            <button
              type="button"
              className="dialer-outcome"
              data-tone="won"
              aria-expanded={tray === "termin"}
              disabled={isPending}
              onClick={() => openTray("termin")}
            >
              <CalendarPlus size={15} /> Termin
              <span className="dialer-kbd">{OUTCOME_KEYS.termin}</span>
            </button>
            <button
              type="button"
              className="dialer-outcome"
              aria-expanded={tray === "rueckruf"}
              disabled={isPending}
              onClick={() => openTray("rueckruf")}
            >
              <span className="dialer-outcome-dot" style={{ background: STATUS_STYLE.rueckruf.color }} />
              <PhoneForwarded size={15} /> Rückruf
              <span className="dialer-kbd">{OUTCOME_KEYS.rueckruf}</span>
            </button>
            <button
              type="button"
              className="dialer-outcome"
              aria-expanded={tray === "ne3"}
              disabled={isPending}
              onClick={nichtErreicht}
            >
              <span className="dialer-outcome-dot" style={{ background: STATUS_STYLE.nicht_erreicht.color }} />
              <Voicemail size={15} /> Nicht erreicht
              <span className="dialer-kbd">{OUTCOME_KEYS.nicht_erreicht}</span>
            </button>
            <button
              type="button"
              className="dialer-outcome"
              aria-expanded={tray === "tot"}
              disabled={isPending}
              onClick={() => openTray("tot")}
            >
              <span className="dialer-outcome-dot" style={{ background: STATUS_STYLE.dead.color }} />
              <PhoneOff size={15} /> Tot
              <span className="dialer-kbd">{OUTCOME_KEYS.dead}</span>
            </button>
            {/* Entscheider war dran, will aber keinen Termin. Ohne Rückfrage
                wie „Nicht erreicht": Der Lead wird nur in die Kein-Termin-Liste
                des Inhabers sortiert, nicht beendet. */}
            <button
              type="button"
              className="dialer-outcome"
              disabled={isPending}
              onClick={() => applyOutcome("kein_termin")}
            >
              <span className="dialer-outcome-dot" style={{ background: STATUS_STYLE.kein_termin.color }} />
              <CalendarX size={15} /> Kein Termin
              <span className="dialer-kbd">{OUTCOME_KEYS.kein_termin}</span>
            </button>
            <button
              type="button"
              className="dialer-outcome cm-skip"
              onClick={skip}
              disabled={filtered.length < 2}
              title="Überspringen (S)"
            >
              <SkipForward size={15} /> Überspringen
              <span className="dialer-kbd">S</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Toast mit Rückgängig (T1) ── */}
      {toast && (
        <div className="cm-toast glass dense" role="status" key={toast.key}>
          <span>
            <b>{toast.name}</b> · {toast.text}
          </span>
          {toast.undo && (
            <button type="button" className="ui-btn" data-variant="secondary" data-size="sm" onClick={undo}>
              Rückgängig <span className="dialer-kbd">Z</span>
            </button>
          )}
          {toast.undo && <i className="cm-toast-bar" style={{ animationDuration: `${UNDO_MS}ms` }} aria-hidden />}
        </div>
      )}

      {/* ── Bestätigungsdialog (Lead löschen) ── */}
      {dialog}
    </div>
  );
}
