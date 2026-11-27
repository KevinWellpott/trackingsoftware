"use client";

// Der Nachfass-Eingang (Plan M5) — EIN Ort für Termine ohne nächsten Schritt,
// Telefon-Rückrufe und fällige Recycling-Leads. Jede Zeile trägt „Nächster
// Kontakt am"; erledigt wird in einem Schritt: Ergebnis protokollieren und das
// nächste Datum setzen (vorbelegt).

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { CalendarPlus, Check, Phone, PhoneCall, Skull, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { DatePicker } from "@/components/ui/DatePicker";
import { DateTimeField } from "@/components/ui/DateTimeField";
import { AnchoredPopover, useAnchor } from "@/components/ui/AnchoredPopover";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { LeadDossierLink } from "@/components/lead/LeadDossierPanel";
import { ErgebnisSchnell } from "@/components/termine/ErgebnisSchnell";
import {
  aufgeben,
  kontaktEintragen,
  nachfassRueckgaengig,
  sammelAktion,
  type NachfassUndo,
} from "@/app/actions/nachfassKontakt";
import { setNeuerTermin } from "@/app/actions/followUpStamp";
import { setPhoneLeadOutcome } from "@/app/actions/phone";
import { DRAN_TONE } from "@/lib/dranRegel";
import { berlinDateISO, formatTermin } from "@/lib/apptTime";
import { dayDiff, lastContactLabel } from "@/lib/contactGap";
import {
  AUFGEBEN_AB_VERSUCHEN,
  GRUPPEN_LABEL,
  REITER_GRUPPEN,
  faelligkeitsTag,
  gruppiere,
  istJetztDran,
  kopfzahlen,
  schnellwahl,
  versucheInFolge,
  vorschlagNaechsterKontakt,
  type NachfassFilter,
  type NachfassGruppe,
  type NachfassReiter,
} from "@/lib/nachfassRegel";
import type { NachfassAnzeige, NachfassWer } from "@/lib/nachfassenData";

type Props = {
  eintraege: NachfassAnzeige[];
  heuteErledigt: number;
  protokollVerfuegbar: boolean;
  recyclingVerfuegbar: boolean;
  vollstaendig: boolean;
  today: string;
  nowMs: number;
  wer: NachfassWer;
  darfAlle: boolean;
  reiter: NachfassReiter;
  filter: NachfassFilter;
};

const KANAL_OPTIONEN = [
  { value: "anruf", label: "Anruf" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "mail", label: "Mail" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "sms", label: "SMS" },
] as const;
type Kanal = (typeof KANAL_OPTIONEN)[number]["value"];

const KANAL_SPEICHER = "pt-nachfass-kanal";

function tagDe(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}

function faelligText(e: NachfassAnzeige, today: string): string {
  if (e.ergebnisFehlt) return e.terminAt ? `Termin ${formatTermin(e.terminAt)} — kein Ergebnis` : "kein Ergebnis";
  if (!e.faelligAm) return "kein nächster Schritt";
  if (e.koernung === "minute") return `Rückruf ${formatTermin(e.faelligAm)}`;
  const tag = faelligkeitsTag(e, today);
  const diff = dayDiff(tag, today);
  if (diff === 0) return "heute";
  if (diff > 0) return `seit ${diff} ${diff === 1 ? "Tag" : "Tagen"} fällig`;
  return `am ${tagDe(tag)}`;
}

// ── Kontakt eintragen ─────────────────────────────────────────────────────

function KontaktPopover({
  e,
  today,
  anchor,
  onClose,
  onDone,
}: {
  e: NachfassAnzeige;
  today: string;
  anchor: DOMRect;
  onClose: () => void;
  onDone: (undo: NachfassUndo | null, text: string) => void;
}) {
  const [ergebnis, setErgebnis] = useState<"nicht_erreicht" | "erreicht">("nicht_erreicht");
  const [kanal, setKanal] = useState<Kanal | null>(() => {
    if (typeof window === "undefined") return null;
    const v = window.localStorage.getItem(KANAL_SPEICHER);
    return KANAL_OPTIONEN.some((k) => k.value === v) ? (v as Kanal) : null;
  });
  const [tag, setTag] = useState(() => vorschlagNaechsterKontakt("nicht_erreicht", today));
  const [tagGesetzt, setTagGesetzt] = useState(false);
  const [notiz, setNotiz] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const waehleErgebnis = (v: "nicht_erreicht" | "erreicht") => {
    setErgebnis(v);
    if (!tagGesetzt) setTag(vorschlagNaechsterKontakt(v, today));
  };

  const speichern = () => {
    setFehler(null);
    if (kanal) window.localStorage.setItem(KANAL_SPEICHER, kanal);
    start(async () => {
      const res = await kontaktEintragen({
        art: e.art,
        id: e.id,
        quelle: e.quelle === "recycling" ? "recycling" : "termin",
        ergebnis,
        kanal,
        notiz,
        naechsterKontaktAm: tag,
      });
      if (res.error) {
        setFehler(res.error);
        return;
      }
      onDone(res.undo ?? null, `${e.name}: ${ergebnis === "erreicht" ? "erreicht" : "nicht erreicht"}, nächster Kontakt ${tagDe(tag)}`);
    });
  };

  return (
    <AnchoredPopover anchor={anchor} onClose={onClose} label="Kontakt eintragen" width={340} align="end">
      <div
        style={{ display: "grid", gap: "var(--sp-5)", padding: "var(--sp-6)" }}
        onKeyDown={(ev) => {
          if (ev.key === "Enter" && !(ev.target instanceof HTMLTextAreaElement)) {
            ev.preventDefault();
            speichern();
          }
        }}
      >
        <div className="eyebrow eyebrow-muted">Ergebnis</div>
        <Segmented
          options={[
            { value: "nicht_erreicht", label: "Nicht erreicht" },
            { value: "erreicht", label: "Erreicht / Antwort" },
          ]}
          value={ergebnis}
          onChange={waehleErgebnis}
          size="sm"
          fullWidth
          ariaLabel="Ergebnis"
        />
        <div className="eyebrow eyebrow-muted">Kanal (optional)</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)" }}>
          {KANAL_OPTIONEN.map((k) => (
            <button
              key={k.value}
              type="button"
              className="chip"
              data-active={kanal === k.value}
              aria-pressed={kanal === k.value}
              onClick={() => setKanal(kanal === k.value ? null : k.value)}
              style={{
                padding: "2px 10px",
                borderRadius: "var(--r-full)",
                border: "1px solid var(--border-default)",
                background: kanal === k.value ? "var(--surface-3)" : "transparent",
                color: "var(--text-primary)",
                fontSize: "var(--fs-sm)",
                cursor: "pointer",
              }}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="eyebrow eyebrow-muted">Nächster Kontakt</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)", alignItems: "center" }}>
          {schnellwahl(today).map((s) => (
            <Button
              key={s.label}
              size="sm"
              variant={tag === s.tag ? "primary" : "secondary"}
              onClick={() => {
                setTag(s.tag);
                setTagGesetzt(true);
              }}
            >
              {s.label}
            </Button>
          ))}
          <DatePicker
            value={tag}
            onChange={(v) => {
              if (v) {
                setTag(v);
                setTagGesetzt(true);
              }
            }}
            shortFormat
          />
        </div>
        <textarea
          value={notiz}
          onChange={(ev) => setNotiz(ev.target.value)}
          placeholder="Notiz (optional)"
          rows={2}
          className="input"
          style={{ width: "100%", resize: "vertical", fontSize: 16 }}
        />
        {fehler && <div style={{ color: "var(--danger-fg)", fontSize: "var(--fs-sm)" }}>{fehler}</div>}
        <Button variant="primary" onClick={speichern} loading={pending} icon={<Check size={14} />}>
          Speichern
        </Button>
      </div>
    </AnchoredPopover>
  );
}

// ── Termin ansetzen ───────────────────────────────────────────────────────

function TerminPopover({
  e,
  anchor,
  onClose,
  onDone,
}: {
  e: NachfassAnzeige;
  anchor: DOMRect;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [wert, setWert] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <AnchoredPopover anchor={anchor} onClose={onClose} label="Neuen Termin ansetzen" width={320} align="end">
      <div style={{ display: "grid", gap: "var(--sp-5)", padding: "var(--sp-6)" }}>
        <div className="eyebrow eyebrow-muted">Neuer Termin</div>
        <DateTimeField value={wert} onChange={setWert} ariaLabel="Neuer Termin" />
        {fehler && <div style={{ color: "var(--danger-fg)", fontSize: "var(--fs-sm)" }}>{fehler}</div>}
        <Button
          variant="primary"
          loading={pending}
          disabled={!wert}
          onClick={() =>
            start(async () => {
              if (e.art !== "setting" && e.art !== "closing") return;
              const res = await setNeuerTermin(e.art, e.id, wert);
              if (res.error) setFehler(res.error);
              else onDone(`${e.name}: neuer Termin am ${tagDe(wert.slice(0, 10))}`);
            })
          }
        >
          Termin speichern
        </Button>
      </div>
    </AnchoredPopover>
  );
}

function RueckrufPopover({
  e,
  anchor,
  onClose,
  onDone,
}: {
  e: NachfassAnzeige;
  anchor: DOMRect;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [wert, setWert] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const listId = e.href?.split("/").pop() ?? "";
  return (
    <AnchoredPopover anchor={anchor} onClose={onClose} label="Rückruf verschieben" width={320} align="end">
      <div style={{ display: "grid", gap: "var(--sp-5)", padding: "var(--sp-6)" }}>
        <div className="eyebrow eyebrow-muted">Neuer Rückruf (zählt als Anwahl)</div>
        <DateTimeField value={wert} onChange={setWert} ariaLabel="Neuer Rückruf" />
        {fehler && <div style={{ color: "var(--danger-fg)", fontSize: "var(--fs-sm)" }}>{fehler}</div>}
        <Button
          variant="primary"
          loading={pending}
          disabled={!wert}
          onClick={() =>
            start(async () => {
              const res = await setPhoneLeadOutcome({ leadId: e.id, listId, outcome: "rueckruf", callbackAt: wert });
              if (res.error) setFehler(res.error);
              else onDone(`${e.name}: Rückruf ${tagDe(wert.slice(0, 10))} ${wert.slice(11, 16)}`);
            })
          }
        >
          Rückruf speichern
        </Button>
      </div>
    </AnchoredPopover>
  );
}

// ── Zeile ─────────────────────────────────────────────────────────────────

function Zeile({
  e,
  today,
  nowMs,
  gruppe,
  auswahl,
  onAuswahl,
  onDone,
  onError,
}: {
  e: NachfassAnzeige;
  today: string;
  nowMs: number;
  gruppe: NachfassGruppe;
  auswahl: boolean;
  onAuswahl: ((v: boolean) => void) | null;
  onDone: (undo: NachfassUndo | null, text: string) => void;
  onError: (text: string) => void;
}) {
  const router = useRouter();
  const { anchor: kontaktAnchor, ref: kontaktRef, toggle: kontaktToggle, close: kontaktClose } = useAnchor();
  const { anchor: terminAnchor, ref: terminRef, toggle: terminToggle, close: terminClose } = useAnchor();
  const { anchor: rueckrufAnchor, ref: rueckrufRef, toggle: rueckrufToggle, close: rueckrufClose } = useAnchor();
  const { confirm, dialog } = useConfirm();
  const [pending, start] = useTransition();
  const versuche = versucheInFolge(e.kontakte);
  const dran = gruppe !== "aufraeumen" && gruppe !== "wartet" && gruppe !== "demnaechst" && istJetztDran(e, today, nowMs);
  const listId = e.quelle === "rueckruf" ? e.href?.split("/").pop() ?? "" : "";

  const letzter = e.letzterKontakt
    ? `zuletzt ${lastContactLabel(dayDiff(berlinDateISO(e.letzterKontakt.at), today))}${
        e.letzterKontakt.vonName ? ` (${e.letzterKontakt.vonName}, ${e.letzterKontakt.ergebnis === "erreicht" ? "erreicht" : "nicht erreicht"})` : ""
      }`
    : null;

  const telefonAktion = (outcome: "nicht_erreicht" | "kein_termin" | "dead", label: string) =>
    start(async () => {
      const res = await setPhoneLeadOutcome({ leadId: e.id, listId, outcome });
      if (res.error) onError(res.error);
      else onDone(null, `${e.name}: ${label}`);
    });

  return (
    <div
      className="nachfass-zeile"
      data-nf-row=""
      data-dran={dran || undefined}
      style={{
        gridTemplateColumns: onAuswahl ? "auto 14px minmax(0,1fr) auto" : "14px minmax(0,1fr) auto",
        opacity: pending ? 0.5 : 1,
      }}
    >
      {onAuswahl && (
        <input
          type="checkbox"
          checked={auswahl}
          onChange={(ev) => onAuswahl(ev.target.checked)}
          aria-label={`${e.name} auswählen`}
        />
      )}
      {/* „Du bist dran": goldener Punkt mit Lichthof (`.dran-mark`, globals.css §6.9);
          sonst ein stiller Ring, damit die Namen fluchten. */}
      <span className="dran-mark" data-dran={dran ? "true" : undefined} aria-label={dran ? "Jetzt dran" : undefined} />
      <div style={{ minWidth: 0, display: "grid", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-3)", flexWrap: "wrap" }}>
          <span style={{ fontWeight: dran ? 600 : 550, color: "var(--text-primary)" }}>{e.name}</span>
          {e.firma && <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)" }}>{e.firma}</span>}
          <span
            style={{
              fontSize: "var(--fs-xs)",
              padding: "1px 8px",
              borderRadius: "var(--r-full)",
              border: "1px solid var(--border-default)",
              color: "var(--text-secondary)",
            }}
          >
            {e.kontext}
          </span>
          {e.recycle && (
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>Anlauf {e.recycle.attempt + 1}</span>
          )}
        </div>
        <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
          <span style={{ color: dran ? DRAN_TONE.fg : undefined }}>{faelligText(e, today)}</span>
          {versuche > 0 && <span>· Versuch {versuche + 1}</span>}
          {letzter && <span>· {letzter}</span>}
          {e.personName && <span>· {e.personName}</span>}
          {e.telefon && (
            <a href={`tel:${e.telefon}`} style={{ color: "var(--text-secondary)" }}>
              · <Phone size={11} style={{ verticalAlign: "-1px" }} /> {e.telefon}
            </a>
          )}
        </div>
        {versuche >= AUFGEBEN_AB_VERSUCHEN && e.quelle !== "rueckruf" && (
          <div style={{ fontSize: "var(--fs-sm)", color: "var(--warning-fg)" }}>
            {versuche}× nicht erreicht. Aufgeben? Er kommt nach der Wartezeit über das Recycling wieder.
          </div>
        )}
      </div>
      <div className="nf-ra">
        {e.ergebnisFehlt && (e.art === "setting" || e.art === "closing") ? (
          <ErgebnisSchnell
            kind={e.art}
            id={e.id}
            onDone={(text) => onDone(null, `${e.name}: ${text}`)}
            onError={onError}
          />
        ) : e.quelle === "rueckruf" ? (
          <>
            {e.telefon && (
              <a href={`tel:${e.telefon}`} className="btn-link-anrufen" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6, padding: "0 12px", minHeight: 28, borderRadius: "var(--r-md)", background: "var(--accent)", color: "var(--text-on-accent)", fontSize: "var(--fs-sm)", fontWeight: 500 }}>
                <PhoneCall size={13} /> Anrufen
              </a>
            )}
            <span ref={rueckrufRef as React.RefObject<HTMLSpanElement>}>
              <Button size="sm" variant="secondary" onClick={rueckrufToggle}>Verschieben</Button>
            </span>
            <Button size="sm" variant="ghost" onClick={() => telefonAktion("nicht_erreicht", "nicht erreicht")}>Nicht erreicht</Button>
            <Button size="sm" variant="ghost" onClick={() => telefonAktion("kein_termin", "kein Termin")}>Kein Termin</Button>
            {e.href && (
              <Button size="sm" variant="ghost" onClick={() => router.push(e.href!)}>
                Zur Liste
              </Button>
            )}
          </>
        ) : (
          <>
            <span ref={kontaktRef as React.RefObject<HTMLSpanElement>} data-nf-key="e">
              <Button size="sm" variant="primary" onClick={kontaktToggle} title="Kontakt eintragen (E)">
                Kontakt eintragen
              </Button>
            </span>
            {(e.art === "setting" || e.art === "closing") && e.quelle === "termin" && (
              <span ref={terminRef as React.RefObject<HTMLSpanElement>} data-nf-key="t">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<CalendarPlus size={13} />}
                  onClick={terminToggle}
                  title="Neuen Termin ansetzen (T)"
                >
                  Termin
                </Button>
              </span>
            )}
            {e.quelle === "recycling" && e.href && (
              <Button size="sm" variant="secondary" onClick={() => router.push(e.href!)}>
                Öffnen
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              icon={<Skull size={13} />}
              onClick={async () => {
                const ok = await confirm({
                  title: "Aufgeben?",
                  message:
                    e.quelle === "termin"
                      ? `${e.name} wird als tot markiert. Das Recycling holt ihn nach der Wartezeit wieder.`
                      : `Dieser Anlauf bei ${e.name} endet. Das Recycling plant den nächsten nach der Wartezeit.`,
                  confirmLabel: "Aufgeben",
                  destructive: true,
                });
                if (!ok) return;
                start(async () => {
                  const res = await aufgeben(e.art, e.id, e.quelle);
                  if (res.error) onError(res.error);
                  else onDone(null, `${e.name}: aufgegeben`);
                });
              }}
            >
              Aufgeben
            </Button>
          </>
        )}
        <LeadDossierLink kind={e.art} id={e.id} />
      </div>
      {kontaktAnchor && (
        <KontaktPopover
          e={e}
          today={today}
          anchor={kontaktAnchor}
          onClose={kontaktClose}
          onDone={(undo, text) => {
            kontaktClose();
            onDone(undo, text);
          }}
        />
      )}
      {terminAnchor && (
        <TerminPopover
          e={e}
          anchor={terminAnchor}
          onClose={terminClose}
          onDone={(text) => {
            terminClose();
            onDone(null, text);
          }}
        />
      )}
      {rueckrufAnchor && (
        <RueckrufPopover
          e={e}
          anchor={rueckrufAnchor}
          onClose={rueckrufClose}
          onDone={(text) => {
            rueckrufClose();
            onDone(null, text);
          }}
        />
      )}
      {dialog}
    </div>
  );
}

// ── Seite ─────────────────────────────────────────────────────────────────

export function NachfassEingang(props: Props) {
  const router = useRouter();
  const { eintraege, today, nowMs } = props;
  const [toast, setToast] = useState<{ text: string; undo: NachfassUndo | null; fehler?: boolean } | null>(null);
  const [auswahl, setAuswahl] = useState<Set<string>>(new Set());
  const [sammelTag, setSammelTag] = useState<string | null>(today);
  const [pending, start] = useTransition();
  const { confirm, dialog } = useConfirm();

  // Tastatur (Prototyp „Heute"): J/K wählen eine Zeile, E trägt einen
  // Kontakt ein, T setzt einen Termin. Bewusst über das DOM statt über
  // React-Zustand: Die Auswahl ist reine Bedienhilfe, sie ändert keine Zahl
  // und keine Zeile — und sie greift auf die vorhandenen Knöpfe durch, statt
  // die Aktionen ein zweites Mal zu verdrahten. In Eingabefeldern, mit
  // Zusatztasten und bei offenem Dialog/Popover tut sie nichts.
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const t = ev.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      const key = ev.key.toLowerCase();
      if (!["j", "k", "e", "t"].includes(key)) return;
      const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-nf-row]"));
      if (rows.length === 0) return;
      const cur = rows.findIndex((r) => r.dataset.selected === "true");
      if (key === "j" || key === "k") {
        ev.preventDefault();
        const next = cur === -1 ? 0 : Math.min(rows.length - 1, Math.max(0, cur + (key === "j" ? 1 : -1)));
        if (cur !== -1) delete rows[cur].dataset.selected;
        rows[next].dataset.selected = "true";
        rows[next].scrollIntoView({ block: "nearest" });
        return;
      }
      if (cur === -1) return;
      const knopf = rows[cur].querySelector<HTMLButtonElement>(`[data-nf-key="${key}"] button`);
      if (knopf) {
        ev.preventDefault();
        knopf.click();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 8000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const gefiltert = useMemo(
    () => (props.filter === "alle" ? eintraege : eintraege.filter((e) => e.quelle === props.filter)),
    [eintraege, props.filter],
  );
  const gruppen = useMemo(() => gruppiere(gefiltert, today, nowMs), [gefiltert, today, nowMs]);
  const alleGruppen = useMemo(() => gruppiere(eintraege, today, nowMs), [eintraege, today, nowMs]);
  const kopf = kopfzahlen(alleGruppen, props.heuteErledigt);
  const aufraeumenAnzahl = alleGruppen.get("aufraeumen")?.length ?? 0;

  const setParam = (key: string, value: string | null) => {
    const url = new URL(window.location.href);
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    router.push(`${url.pathname}${url.search}`);
  };

  const done = (undo: NachfassUndo | null, text: string) => {
    setToast({ text, undo });
    router.refresh();
  };

  const reiterOptionen: { value: NachfassReiter; label: string }[] = [
    { value: "faellig", label: `Fällig ${kopf.ueberfaellig + kopf.heute}` },
    { value: "demnaechst", label: `Demnächst ${kopf.dieseWoche}` },
    { value: "wartet", label: "Wartet" },
    ...(aufraeumenAnzahl > 0 || props.reiter === "aufraeumen"
      ? [{ value: "aufraeumen" as const, label: `Aufräumen ${aufraeumenAnzahl}` }]
      : []),
  ];

  const sichtbareGruppen = REITER_GRUPPEN[props.reiter];
  const imAufraeumen = props.reiter === "aufraeumen";
  const aufraeumListe = gruppen.get("aufraeumen") ?? [];

  const sammel = async (aktion: "nochmal" | "aufgeben" | "sperren") => {
    const ziel = aufraeumListe.filter((e) => auswahl.has(e.key));
    if (ziel.length === 0) return;
    if (aktion !== "nochmal") {
      const ok = await confirm({
        title: aktion === "aufgeben" ? `${ziel.length} aufgeben?` : `${ziel.length} sperren?`,
        message:
          aktion === "aufgeben"
            ? "Die Vorgänge werden als tot markiert; das Recycling holt sie nach der Wartezeit wieder."
            : "Die Vorgänge kommen auf die Sperrliste und werden nie wieder vorgelegt.",
        confirmLabel: aktion === "aufgeben" ? "Aufgeben" : "Sperren",
        destructive: true,
      });
      if (!ok) return;
    }
    start(async () => {
      const res = await sammelAktion(
        ziel.map((e) => ({ art: e.art, id: e.id, quelle: e.quelle })),
        aktion,
        sammelTag ?? today,
      );
      setAuswahl(new Set());
      setToast({
        text: res.fehler.length ? `${res.ok} erledigt, Fehler: ${res.fehler.join(" · ")}` : `${res.ok} erledigt`,
        undo: null,
        fehler: res.fehler.length > 0,
      });
      router.refresh();
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-7)" }}>
      {/* Kopfzahlen */}
      <div className="kpi-row" data-cols={4}>
        {[
          { label: "Überfällig", wert: kopf.ueberfaellig, ton: kopf.ueberfaellig > 0 ? DRAN_TONE.fg : undefined },
          { label: "Heute", wert: kopf.heute },
          { label: "Diese Woche", wert: kopf.dieseWoche },
          { label: "Heute erledigt", wert: kopf.heuteErledigt },
        ].map((k) => (
          <div key={k.label} className="card" style={{ padding: "var(--sp-6) var(--sp-7)" }}>
            <div className="eyebrow eyebrow-muted">{k.label}</div>
            <div className="kpi-value" style={{ fontSize: "var(--fs-2xl)", color: k.ton }}>
              {k.wert.toLocaleString("de-DE")}
            </div>
          </div>
        ))}
      </div>

      {!props.protokollVerfuegbar && (
        <div className="card" style={{ padding: "var(--sp-6)", color: "var(--warning-fg)", fontSize: "var(--fs-sm)" }}>
          Das Kontakt-Protokoll fehlt noch in der Datenbank (Migration 0049). Der Eingang zeigt alles, „Kontakt
          eintragen&ldquo; funktioniert aber erst danach.
        </div>
      )}
      {!props.vollstaendig && (
        <div className="card" style={{ padding: "var(--sp-6)", color: "var(--danger-fg)", fontSize: "var(--fs-sm)" }}>
          Ein Teil der Vorgänge konnte nicht geladen werden — diese Liste ist unvollständig. Bitte die Seite neu
          laden.
        </div>
      )}
      {!props.recyclingVerfuegbar && (
        <div className="card" style={{ padding: "var(--sp-6)", color: "var(--warning-fg)", fontSize: "var(--fs-sm)" }}>
          Die Recycling-Wiedervorlagen konnten nicht geladen werden — sie fehlen in dieser Liste.
        </div>
      )}

      {/* Reiter und Filter */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-5)", alignItems: "center" }}>
        <Segmented
          options={reiterOptionen}
          value={props.reiter}
          onChange={(v) => setParam("reiter", v === "faellig" ? null : v)}
          ariaLabel="Ansicht"
        />
        <Segmented
          options={[
            { value: "alle", label: "Alle" },
            { value: "termin", label: "Termine" },
            { value: "rueckruf", label: "Rückrufe" },
            { value: "recycling", label: "Recycling" },
          ]}
          value={props.filter}
          onChange={(v) => setParam("quelle", v === "alle" ? null : v)}
          size="sm"
          ariaLabel="Quelle"
        />
        {props.darfAlle && (
          <Segmented
            options={[
              { value: "mein", label: "Mein" },
              { value: "alle", label: "Alle Personen" },
            ]}
            value={props.wer}
            onChange={(v) => setParam("wer", v === "mein" ? null : v)}
            size="sm"
            ariaLabel="Person"
          />
        )}
      </div>

      {imAufraeumen && (
        <div className="card" style={{ padding: "var(--sp-6) var(--sp-7)", display: "grid", gap: "var(--sp-4)" }}>
          <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-secondary)" }}>
            Altbestand vor dem Start des Eingangs: Vorgänge, deren letztes Lebenszeichen mehr als 14 Tage vor dem
            Stichtag liegt und die seitdem niemand angefasst hat. Einmal sichten — danach startet „Fällig&ldquo;
            sauber. Noch {aufraeumListe.length} offen.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)", alignItems: "center" }}>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setAuswahl(auswahl.size === aufraeumListe.length ? new Set() : new Set(aufraeumListe.map((e) => e.key)))
              }
            >
              {auswahl.size === aufraeumListe.length && aufraeumListe.length > 0 ? "Keine auswählen" : "Alle auswählen"}
            </Button>
            <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>{auswahl.size} ausgewählt</span>
            <span style={{ marginLeft: "auto", display: "inline-flex", gap: "var(--sp-3)", alignItems: "center" }}>
              <DatePicker value={sammelTag} onChange={setSammelTag} shortFormat />
              <Button size="sm" variant="primary" disabled={!auswahl.size} loading={pending} onClick={() => sammel("nochmal")}>
                Nochmal versuchen
              </Button>
              <Button size="sm" variant="secondary" disabled={!auswahl.size} onClick={() => sammel("aufgeben")}>
                Aufgeben
              </Button>
              <Button size="sm" variant="danger" disabled={!auswahl.size} onClick={() => sammel("sperren")}>
                Sperren
              </Button>
            </span>
          </div>
        </div>
      )}

      {sichtbareGruppen.map((g) => {
        const liste = gruppen.get(g) ?? [];
        if (liste.length === 0) return null;
        return (
          <section key={g} className="card nf-gruppe" style={{ overflow: "hidden" }}>
            {/* Gruppenkopf ohne Band (Prototyp `tr.grp`): ruhiger Text,
                Gold nur dort, wo die Gruppe selbst „zu spät" sagt. */}
            <div className="nf-grp" data-ton={g === "ueberfaellig" || g === "ergebnis_fehlt" ? "dran" : undefined}>
              {GRUPPEN_LABEL[g]}
              <span>{liste.length}</span>
            </div>
            {liste.map((e) => (
              <Zeile
                key={e.key}
                e={e}
                today={today}
                nowMs={nowMs}
                gruppe={g}
                auswahl={auswahl.has(e.key)}
                onAuswahl={
                  g === "aufraeumen"
                    ? (v) =>
                        setAuswahl((prev) => {
                          const next = new Set(prev);
                          if (v) next.add(e.key);
                          else next.delete(e.key);
                          return next;
                        })
                    : null
                }
                onDone={done}
                onError={(text) => setToast({ text, undo: null, fehler: true })}
              />
            ))}
          </section>
        );
      })}

      {sichtbareGruppen.some((g) => (gruppen.get(g) ?? []).length > 0) && (
        <div className="keys nf-keys hide-on-mobile" aria-hidden>
          <span>
            <kbd>J</kbd>
            <kbd>K</kbd> Zeile wählen
          </span>
          <span>
            <kbd>E</kbd> Kontakt eintragen
          </span>
          <span>
            <kbd>T</kbd> Termin
          </span>
          <span style={{ marginLeft: "auto" }}>Gold: jetzt dran — fällig und noch nicht angefasst</span>
        </div>
      )}

      {sichtbareGruppen.every((g) => (gruppen.get(g) ?? []).length === 0) && (
        <div className="card" style={{ padding: "var(--sp-11) var(--sp-7)", textAlign: "center", color: "var(--text-secondary)" }}>
          {props.reiter === "faellig"
            ? "Nichts fällig. Wer offen ist, steht mit seinem nächsten Kontakt unter „Demnächst“ oder „Wartet“."
            : "Hier steht gerade nichts."}
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="glass-popover"
          style={{
            position: "fixed",
            bottom: "var(--sp-8)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 60,
            padding: "var(--sp-5) var(--sp-7)",
            borderRadius: "var(--r-lg)",
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-5)",
            color: toast.fehler ? "var(--danger-fg)" : "var(--text-primary)",
            maxWidth: "calc(100vw - 32px)",
          }}
        >
          <span style={{ fontSize: "var(--fs-sm)" }}>{toast.text}</span>
          {toast.undo && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Undo2 size={13} />}
              onClick={() => {
                const token = toast.undo!;
                setToast(null);
                start(async () => {
                  const res = await nachfassRueckgaengig(token);
                  setToast({ text: res.error ?? "Zurückgenommen.", undo: null, fehler: Boolean(res.error) });
                  router.refresh();
                });
              }}
            >
              Rückgängig
            </Button>
          )}
        </div>
      )}
      {dialog}
    </div>
  );
}
