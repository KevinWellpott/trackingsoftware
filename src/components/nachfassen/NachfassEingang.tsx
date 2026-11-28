"use client";

// Der Nachfass-Eingang (Plan M5) — EIN Ort für Termine ohne nächsten Schritt,
// Telefon-Rückrufe und fällige Recycling-Leads. Jede Zeile trägt „Nächster
// Kontakt am"; erledigt wird in einem Schritt: Ergebnis protokollieren und das
// nächste Datum setzen (vorbelegt).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { AtSign, CalendarPlus, Check, Mail, MoreHorizontal, Phone, PhoneCall, Skull, Undo2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
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
import { berlinDateISO, formatTerminParts } from "@/lib/apptTime";
import { dayDiff, lastContactLabel } from "@/lib/contactGap";
import {
  AUFGEBEN_AB_VERSUCHEN,
  GRUPPEN_LABEL,
  REITER_GRUPPEN,
  SAMMEL_PAKET,
  SEITE_GROESSE,
  plusWerktage,
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

/** „Do 19.11. · 10:30“ — kurz, ohne Jahr und „Uhr“. */
function kurzTermin(iso: string): string {
  const t = formatTerminParts(iso);
  return t ? `${t.date} · ${t.time}` : iso;
}

/**
 * Wann — ohne Wörter, die Gruppe und Badge schon sagen (28.11.): kein
 * „Termin“, kein „Rückruf“, kein „kein Ergebnis“, kein „kein nächster
 * Schritt“. `null` = nichts zu sagen (sofort fällig, ohne Datum).
 */
function faelligText(e: NachfassAnzeige, today: string): string | null {
  if (e.ergebnisFehlt) return e.terminAt ? kurzTermin(e.terminAt) : null;
  if (!e.faelligAm) return null;
  if (e.koernung === "minute") return kurzTermin(e.faelligAm);
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
  alle,
  gruppe,
  auswahl,
  onAuswahl,
  onDone,
  onError,
}: {
  e: NachfassAnzeige;
  today: string;
  nowMs: number;
  /** Organisations-Ansicht: Wer hat terminiert, wer hat geführt. */
  alle: boolean;
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
  const { anchor: mehrAnchor, ref: mehrRef, toggle: mehrToggle, close: mehrClose } = useAnchor();
  const { confirm, dialog } = useConfirm();
  const [pending, start] = useTransition();
  const versuche = versucheInFolge(e.kontakte);
  const dran =
    gruppe !== "aufraeumen" && gruppe !== "wartet" && gruppe !== "demnaechst" && gruppe !== "wiedervorlage" && istJetztDran(e, today, nowMs);
  const listId = e.quelle === "rueckruf" ? e.href?.split("/").pop() ?? "" : "";
  // Rückruf direkt im Call-Modus öffnen, genau auf diesem Lead (Punkt 4) —
  // „Beenden“ führt nach „Heute“ zurück. `aktion=termin` öffnet dort gleich
  // das Termin-Fach.
  const callModus = listId ? `/telefon/${listId}?lead=${e.id}&from=nachfassen` : null;

  const letzter = e.letzterKontakt
    ? `zuletzt ${lastContactLabel(dayDiff(berlinDateISO(e.letzterKontakt.at), today))}${
        e.letzterKontakt.vonName ? ` (${e.letzterKontakt.vonName}, ${e.letzterKontakt.ergebnis === "erreicht" ? "erreicht" : "nicht erreicht"})` : ""
      }`
    : null;

  const telefonAktion = (outcome: "nicht_erreicht" | "kein_termin" | "dead", label: string) =>
    start(async () => {
      const res = await setPhoneLeadOutcome({ leadId: e.id, listId, outcome });
      if (res.error) onError(res.error);
      // Der dritte „Nicht erreicht" in Folge beendet den Lead (NICHT_ERREICHT_LIMIT).
      else if (res.autoDead) onDone(null, `${e.name}: dreimal nicht erreicht — als tot markiert, kommt später als Wiedervorlage zurück`);
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
      {/* Zwei Zeilen (28.11.): oben Name und Status-Badge, darunter Firma
          (gekürzt), Fälligkeit und Kontaktwege. */}
      <div className="nf-text">
        <div className="nf-kopf">
          {e.quelle === "termin" && e.href ? (
            // Zur Detailseite — dort stehen Qualifizierung und Closing anlegen.
            <Link href={e.href} className="nf-name" data-dran={dran || undefined}>
              {e.name}
            </Link>
          ) : (
            <span className="nf-name" data-dran={dran || undefined}>
              {e.name}
            </span>
          )}
          <span className="nf-badge" data-ton={e.ton}>
            <span>{e.typ}</span>
            {e.stand && <strong>{e.stand}</strong>}
          </span>
        </div>
        {/* Meta-Zeile: jedes Stück bleibt am Stück (kein Umbruch zwischen
            Symbol und Nummer), die Trenner setzt das CSS (.nf-meta). */}
        <div className="nf-meta">
          {e.firma && e.firma.trim().toLowerCase() !== e.name.trim().toLowerCase() && (
            <span className="nf-firma" title={e.firma}>
              {e.firma}
            </span>
          )}
          {faelligText(e, today) && <span style={{ color: dran ? DRAN_TONE.fg : undefined }}>{faelligText(e, today)}</span>}
          {versuche > 0 && <span>Versuch {versuche + 1}</span>}
          {e.recycle && e.recycle.attempt > 0 && <span>{e.recycle.attempt}. Wiedervorlage</span>}
          {letzter && <span>{letzter}</span>}
          {alle &&
            e.rollen.map((r) => (
              <span key={r.label} className="nf-rolle">
                {r.label} <strong>{r.name}</strong>
              </span>
            ))}
          {e.telefon && (
            <a href={`tel:${e.telefon}`} className="nf-kontakt">
              <Phone size={11} aria-hidden /> {e.telefon}
            </a>
          )}
          {e.email && (
            <a href={`mailto:${e.email}`} className="nf-kontakt" title={e.email}>
              <Mail size={11} aria-hidden /> Mail
            </a>
          )}
          {e.linkedinUrl && (
            <a href={e.linkedinUrl} target="_blank" rel="noreferrer" className="nf-kontakt">
              <AtSign size={11} aria-hidden /> LinkedIn
            </a>
          )}
        </div>
        {versuche >= AUFGEBEN_AB_VERSUCHEN && e.quelle !== "rueckruf" && (
          <div style={{ fontSize: "var(--fs-sm)", color: "var(--warning-fg)" }}>
            {versuche}× nicht erreicht. Auf „Tot“ setzen? Er kommt nach der Wartezeit als Wiedervorlage zurück.
          </div>
        )}
      </div>
      {/* Aktionen (28.11.): links die Nebenhandlungen (umrandet), rechts die
          EINE Haupthandlung (gefüllt), dahinter durch einen Strich getrennt die
          seltenen als Symbol — Tot und Details. Nichts mehr halb ausgegraut. */}
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
            <span ref={rueckrufRef as React.RefObject<HTMLSpanElement>}>
              <Button size="sm" variant="secondary" onClick={rueckrufToggle} title="Rückruf auf eine andere Zeit legen">
                Verschieben
              </Button>
            </span>
            {callModus && (
              <span data-nf-key="t">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<CalendarPlus size={13} />}
                  onClick={() => router.push(`${callModus}&aktion=termin`)}
                  title="Termin legen (T)"
                >
                  Termin
                </Button>
              </span>
            )}
            {callModus ? (
              // Anrufen = Call-Modus auf genau diesem Lead: Wählen, Ergebnis und
              // Termin an einem Ort (Punkt 4).
              <span data-nf-key="e">
                <Button size="sm" variant="primary" icon={<PhoneCall size={13} />} onClick={() => router.push(callModus)}>
                  Anrufen
                </Button>
              </span>
            ) : (
              e.telefon && (
                <a href={`tel:${e.telefon}`} className="ui-btn" data-variant="primary" data-size="sm">
                  <PhoneCall size={13} /> Anrufen
                </a>
              )
            )}
            <span className="nf-ra-sep" aria-hidden />
            <span ref={mehrRef as React.RefObject<HTMLSpanElement>}>
              <IconButton label="Weitere Ergebnisse: Nicht erreicht, Kein Termin" icon={<MoreHorizontal size={15} />} size={30} onClick={mehrToggle} />
            </span>
          </>
        ) : (
          <>
            {e.telefon && (
              // Wählen direkt aus der Zeile (Punkt 3); danach „Kontakt eintragen“.
              <a href={`tel:${e.telefon}`} className="ui-btn" data-variant="secondary" data-size="sm" title={e.telefon}>
                <PhoneCall size={13} /> Anrufen
              </a>
            )}
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
            <span ref={kontaktRef as React.RefObject<HTMLSpanElement>} data-nf-key="e">
              <Button size="sm" variant="primary" icon={<Check size={13} />} onClick={kontaktToggle} title="Kontakt eintragen (E)">
                Kontakt eintragen
              </Button>
            </span>
            <span className="nf-ra-sep" aria-hidden />
            <IconButton
              label="Tot — kommt nach der Wartezeit als Wiedervorlage zurück"
              icon={<Skull size={15} />}
              size={30}
              tone="danger"
              onClick={async () => {
                const ok = await confirm({
                  title: "Auf „Tot“ setzen?",
                  message:
                    e.quelle === "termin"
                      ? `${e.name} wird als tot markiert und kommt nach der Wartezeit als Wiedervorlage zurück.`
                      : `${e.name} bleibt tot; die nächste Wiedervorlage kommt nach der Wartezeit.`,
                  confirmLabel: "Tot",
                  destructive: true,
                });
                if (!ok) return;
                start(async () => {
                  const res = await aufgeben(e.art, e.id, e.quelle);
                  if (res.error) onError(res.error);
                  else onDone(null, `${e.name}: tot`);
                });
              }}
            />
          </>
        )}
        {e.ergebnisFehlt && <span className="nf-ra-sep" aria-hidden />}
        <LeadDossierLink kind={e.art} id={e.id} iconOnly />
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
      {mehrAnchor && (
        <AnchoredPopover anchor={mehrAnchor} onClose={mehrClose} label="Weitere Ergebnisse" width={220} align="end">
          <div className="nf-menue">
            <button
              type="button"
              onClick={() => {
                mehrClose();
                telefonAktion("nicht_erreicht", "nicht erreicht");
              }}
            >
              Nicht erreicht
            </button>
            <button
              type="button"
              onClick={() => {
                mehrClose();
                telefonAktion("kein_termin", "kein Termin");
              }}
            >
              Kein Termin
            </button>
          </div>
        </AnchoredPopover>
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
  // Vorgabe: nächster Werktag — mit „heute“ sprang der ganze Stapel auf
  // einmal nach „Fällig“ (Prüfung 28.11.).
  const [sammelTag, setSammelTag] = useState<string | null>(() => plusWerktage(today, 1));
  const [fortschritt, setFortschritt] = useState<{ fertig: number; gesamt: number } | null>(null);
  const [sichtbar, setSichtbar] = useState(SEITE_GROESSE);
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
  const wiedervorlageAnzahl = alleGruppen.get("wiedervorlage")?.length ?? 0;

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
    // Eigener Reiter, nie im Badge (Punkt 8). Immer sichtbar: Er ist auch der
    // Weg zur Ablage, seit die keinen Navigationspunkt mehr hat.
    { value: "wiedervorlage" as const, label: `Wiedervorlage ${wiedervorlageAnzahl}` },
  ];

  const sichtbareGruppen = REITER_GRUPPEN[props.reiter];
  // Sammelaktion gibt es dort, wo viele Alt- oder Wiedervorlage-Vorgänge auf
  // einmal zu sichten sind.
  const sammelGruppe: NachfassGruppe | null =
    props.reiter === "aufraeumen" ? "aufraeumen" : props.reiter === "wiedervorlage" ? "wiedervorlage" : null;
  const sammelListe = sammelGruppe ? gruppen.get(sammelGruppe) ?? [] : [];

  const sammel = async (aktion: "nochmal" | "aufgeben" | "sperren") => {
    const ziel = sammelListe.filter((e) => auswahl.has(e.key));
    if (ziel.length === 0) return;
    if (aktion !== "nochmal") {
      const ok = await confirm({
        title: aktion === "aufgeben" ? `${ziel.length} auf „Tot“ setzen?` : `${ziel.length} sperren?`,
        message:
          aktion === "aufgeben"
            ? "Die Vorgänge werden als tot markiert und kommen nach der Wartezeit als Wiedervorlage zurück."
            : "Die Vorgänge kommen auf die Sperrliste und werden nie wieder vorgelegt.",
        confirmLabel: aktion === "aufgeben" ? "Tot" : "Sperren",
        destructive: true,
      });
      if (!ok) return;
    }
    start(async () => {
      // In Paketen (SAMMEL_PAKET) mit Fortschritt: Jeder Aufruf bleibt kurz,
      // und ein Fehler mitten im Stapel lässt die erledigten stehen.
      let ok = 0;
      const fehler = new Set<string>();
      setFortschritt({ fertig: 0, gesamt: ziel.length });
      for (let i = 0; i < ziel.length; i += SAMMEL_PAKET) {
        const paket = ziel.slice(i, i + SAMMEL_PAKET);
        try {
          const res = await sammelAktion(
            paket.map((e) => ({ art: e.art, id: e.id, quelle: e.quelle })),
            aktion,
            sammelTag ?? plusWerktage(today, 1),
          );
          ok += res.ok;
          for (const f of res.fehler) fehler.add(f);
        } catch {
          fehler.add("Ein Paket konnte nicht gespeichert werden.");
        }
        setFortschritt({ fertig: Math.min(ziel.length, i + paket.length), gesamt: ziel.length });
      }
      setFortschritt(null);
      setAuswahl(new Set());
      setToast({
        text: fehler.size ? `${ok} erledigt, Fehler: ${[...fehler].join(" · ")}` : `${ok} erledigt`,
        undo: null,
        fehler: fehler.size > 0,
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
          eintragen&ldquo; und „Tot&ldquo; funktionieren aber erst danach.
        </div>
      )}
      {!props.vollstaendig && (
        <div className="card" style={{ padding: "var(--sp-6)", color: "var(--danger-fg)", fontSize: "var(--fs-sm)" }}>
          Ein Teil der Vorgänge konnte nicht geladen werden — diese Liste ist unvollständig. Bitte die Seite neu
          laden.
        </div>
      )}
      {!props.recyclingVerfuegbar && props.reiter === "wiedervorlage" && (
        <div className="card" style={{ padding: "var(--sp-6)", color: "var(--warning-fg)", fontSize: "var(--fs-sm)" }}>
          Die Wiedervorlagen konnten nicht geladen werden — sie fehlen in dieser Liste.
        </div>
      )}

      {/* Reiter und Filter — vorn die Personenachse (28.11.): meine Vorgänge
          oder die der ganzen Organisation, dort mit „terminiert“/„geführt“. */}
      {props.darfAlle && (
        <div className="nf-wer">
          <Segmented
            options={[
              { value: "mein", label: "Meine" },
              { value: "alle", label: "Ganze Organisation" },
            ]}
            value={props.wer}
            onChange={(v) => setParam("wer", v === "mein" ? null : v)}
            size="md"
            ariaLabel="Person"
          />
        </div>
      )}
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
          ]}
          value={props.filter}
          onChange={(v) => setParam("quelle", v === "alle" ? null : v)}
          size="sm"
          ariaLabel="Quelle"
        />
      </div>

      {sammelGruppe && (
        <div className="card" style={{ padding: "var(--sp-6) var(--sp-7)", display: "grid", gap: "var(--sp-4)" }}>
          <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-secondary)" }}>
            {sammelGruppe === "aufraeumen" ? (
              <>
                Altbestand vor dem Start des Eingangs: Vorgänge, deren letztes Lebenszeichen mehr als 14 Tage vor dem
                Stichtag liegt und die seitdem niemand angefasst hat. Einmal sichten — danach startet „Fällig&ldquo;
                sauber. Noch {sammelListe.length} offen.
              </>
            ) : (
              <>
                Tote Leads, deren Wartezeit um ist — ein neuer Versuch lohnt sich. Sie zählen nicht im Badge; arbeite
                sie ab, wenn „Fällig&ldquo; leer ist. {sammelListe.length} fällig.{" "}
                <Link href="/ablage" style={{ color: "var(--accent-text)" }}>
                  Ablage &amp; Sperrliste
                </Link>
              </>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)", alignItems: "center" }}>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setAuswahl(auswahl.size === sammelListe.length ? new Set() : new Set(sammelListe.map((e) => e.key)))
              }
            >
              {auswahl.size === sammelListe.length && sammelListe.length > 0 ? "Keine auswählen" : "Alle auswählen"}
            </Button>
            <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)" }} role="status">
              {fortschritt ? `${fortschritt.fertig} von ${fortschritt.gesamt} erledigt …` : `${auswahl.size} ausgewählt`}
            </span>
            <span style={{ marginLeft: "auto", display: "inline-flex", gap: "var(--sp-3)", alignItems: "center" }}>
              <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>Nächster Kontakt</span>
              <DatePicker value={sammelTag} onChange={setSammelTag} shortFormat />
              <Button size="sm" variant="primary" disabled={!auswahl.size} loading={pending} onClick={() => sammel("nochmal")}>
                Nochmal versuchen
              </Button>
              <Button size="sm" variant="secondary" disabled={!auswahl.size || pending} onClick={() => sammel("aufgeben")}>
                Tot
              </Button>
              <Button size="sm" variant="danger" disabled={!auswahl.size || pending} onClick={() => sammel("sperren")}>
                Sperren
              </Button>
            </span>
          </div>
        </div>
      )}

      {sichtbareGruppen.map((g) => {
        const voll = gruppen.get(g) ?? [];
        if (voll.length === 0) return null;
        // Lange Reiter seitenweise (Wiedervorlage im Januar: vierstellig).
        const liste = voll.slice(0, sichtbar);
        return (
          <section key={g} className="card nf-gruppe" style={{ overflow: "hidden" }}>
            {/* Gruppenkopf ohne Band (Prototyp `tr.grp`): ruhiger Text,
                Gold nur dort, wo die Gruppe selbst „zu spät" sagt. */}
            <div className="nf-grp" data-ton={g === "ueberfaellig" || g === "ergebnis_fehlt" ? "dran" : undefined}>
              {GRUPPEN_LABEL[g]}
              <span>{voll.length}</span>
            </div>
            {liste.map((e) => (
              <Zeile
                key={e.key}
                e={e}
                today={today}
                nowMs={nowMs}
                alle={props.wer === "alle"}
                gruppe={g}
                auswahl={auswahl.has(e.key)}
                onAuswahl={
                  g === sammelGruppe
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
            {voll.length > liste.length && (
              <div style={{ padding: "var(--sp-5) var(--sp-7)", display: "flex", gap: "var(--sp-4)", alignItems: "center" }}>
                <Button size="sm" variant="secondary" onClick={() => setSichtbar((n) => n + SEITE_GROESSE)}>
                  Weitere {Math.min(SEITE_GROESSE, voll.length - liste.length)} anzeigen
                </Button>
                <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
                  {liste.length} von {voll.length}
                </span>
              </div>
            )}
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
            : props.reiter === "wiedervorlage"
              ? "Keine Wiedervorlage fällig."
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
