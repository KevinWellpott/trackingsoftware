"use client";

import { setDataViewForm, signOut } from "@/app/actions/workspace";
import { setActiveOrgForm } from "@/app/actions/platform";
import { createListForm } from "@/app/actions/lists";
import { SearchTrigger } from "@/components/search/SearchDialog";
import { ViewTree } from "@/components/listen/ViewTree";
import type { ViewNode } from "@/lib/listViews";
import { ABLAGE_COUNT_LABEL, type NavCount, type NavCounts } from "@/lib/navCounts";
import {
  Archive,
  BarChart2,
  Building2,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  GitCompare,
  Inbox,
  LineChart,
  LogOut,
  Phone,
  PieChart,
  Plus,
  Settings,
  ShieldCheck,
  Users,
  Wrench,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useId, useRef, useState, useSyncExternalStore } from "react";
import { AnchoredPopover, useAnchor } from "@/components/ui/AnchoredPopover";
import { ManualAppointmentModal } from "@/components/appointment/ManualAppointmentModal";
import { ownerInitials } from "@/lib/ownerColor";

// Sidebar im Ember-Glass-System (COMPONENTS.md §10.1):
// 248px, Flaeche surface-2 (SOLID — kein Glas im Body), rechte Kante als
// 1px-Linie. Nav-Item 36px mit 2px-Orange-Rail im Aktiv-Zustand.
//
// FARBREGEL DIESER DATEI: ausschliesslich Graustufen + Orange. Keine Kanal-,
// Owner- oder Semantikfarben — die Navigation ist die ruhigste Flaeche der
// App, Orange markiert allein „hier bist du" bzw. „das ist aktiv".
//
// EINE dokumentierte Ausnahme: der Ueberfaellig-Ton der Aufgaben-Zaehler
// (.count-pill[data-tone="overdue"], Gold). Ohne ihn saehe „drei Aufgaben
// warten" genauso aus wie „drei sind zu spaet", und der Zaehler verlaere
// genau das, wofuer er da ist. Es ist der vorhandene Semantik-Ton aus
// globals.css, kein neuer — und er kommt nur an einer Stelle vor, an der eine
// Zahl steht.

// GLIEDERUNG (Rueckmeldung aus dem ersten produktiven Tag: „super unsortiert").
// Vorher lagen rund zwanzig Zeilen auf EINER Ebene — Dashboard, Analyse,
// Vergleich, Termine, drei Aufgaben-Seiten, zwei Listen-Abschnitte, Export,
// Einstellungen, Admin. Jetzt tragen sie fuenf benannte, aufklappbare Bloecke,
// geschnitten nach dem Arbeitstag und nicht nach dem Datenmodell:
//
//   (ohne Block)  Suche · Dashboard · Termin buchen  — Einstieg, kein Thema
//   Meine Arbeit  Termine · Nachfassen · Ablage
//   LinkedIn      Pitch-Listen + Ansichten
//   Telefon       Telefonlisten
//   Auswertung    Team · Analyse · Vergleich
//   Verwaltung    Export · Einstellungen · Organisationen
//
// ALLE FUENF STARTEN ZUGEKLAPPT (SECTION_DEFAULT_OPEN). Damit ist die Leiste
// beim ersten Blick eine Gliederung und keine Liste — den Ueberblick „was
// liegt heute an" gibt statt ihrer der Quicklink-Streifen auf dem Dashboard
// (components/dashboard/QuickLinks.tsx). Die beiden gehoeren zusammen: Ohne
// die Quicklinks haette das Zuklappen dem Nutzer den Tageseinstieg genommen,
// ohne das Zuklappen waeren die Quicklinks eine dritte Kopie derselben Zeilen.
//
// „Meine Arbeit" fasst zusammen, was taeglich anfaellt: /termine = wer steht
// an, /nachfassen = was ist heute faellig, /ablage = was ist herausgefallen.
// Getrennt in der Navigation waeren das drei unabhaengige Werkzeuge, von denen
// man zwei nie oeffnet.
//
// /erinnerungen stand hier bis zum Rueckbau als vierte Zeile — die
// stundengenaue Kaskade vor einem Termin. Sie ist ersatzlos gefallen (die Route
// leitet auf /termine weiter): „Wer offen ist, wird jeden Tag kontaktiert" ist
// eine Tagesfrage, und drei aehnlich klingende Zeilen fuer drei Zeitkoernungen
// waren genau der Ueberbau, den der Rueckbau abraeumt.

/** Ab wie vielen Listen die Sidebar auf die Uebersichtsseite verweist. */
const SIDEBAR_LIST_CAP = 7;

/**
 * Liegt `pathname` auf `href` oder darunter? Die eine Aktiv-Regel der Datei —
 * `NavLink` faerbt danach seine Zeile, die Bloecke entscheiden danach, ob die
 * geoeffnete Seite in ihnen steckt. Zwei Fassungen davon liefen frueher oder
 * spaeter auseinander, und dann faerbte eine Zeile aktiv, deren Block sich
 * zuklappen liess.
 */
function matchesHref(pathname: string, href: string, exact = false): boolean {
  if (exact) return pathname === href;
  return pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
}

/** Steckt die geoeffnete Seite in einem dieser Zweige? */
function containsActive(pathname: string, hrefs: readonly string[]): boolean {
  return hrefs.some((h) => matchesHref(pathname, h));
}

// Welche Routen zu welchem Block gehoeren. Praefixe, keine exakten Adressen:
// /lists/<id>, /ansicht/<id> und /analyse/vergleich sollen ihren Block genauso
// aufgeklappt halten wie die Uebersichtsseite darueber.
const ARBEIT_HREFS = ["/termine", "/nachfassen", "/ablage"] as const;
const LINKEDIN_HREFS = ["/listen", "/lists", "/ansicht"] as const;
const TELEFON_HREFS = ["/telefon"] as const;
const AUSWERTUNG_HREFS = ["/team", "/analyse"] as const;
const VERWALTUNG_HREFS = ["/export", "/settings", "/admin"] as const;

/**
 * Mehrere Zaehler zu einem zusammenfassen — fuer das Abzeichen am zugeklappten
 * Block und fuer den Punkt am mobilen Menue-Knopf.
 *
 * `null` bleibt `null`, solange KEIN Zweig eine Zahl hat: „nicht ermittelbar"
 * darf nicht als beruhigende 0 durchgehen (lib/navCounts.ts). Liefert nur ein
 * Teil der Zweige eine Zahl, wird diese Summe gezeigt — eine Teilzahl ist hier
 * besser als gar keine Nachricht, denn die Einzelzeilen darunter sagen ohnehin,
 * welcher Zweig schweigt.
 */
export function sumNavCounts(counts: (NavCount | null | undefined)[]): NavCount | null {
  let total = 0;
  let overdue = 0;
  let known = false;
  for (const c of counts) {
    if (!c) continue;
    known = true;
    total += c.total;
    overdue += c.overdue;
  }
  return known ? { total, overdue } : null;
}

// ── Aufklapp-Zustand der Bloecke ───────────────────────────────────────────
// Er gehoert NICHT in die URL (er aendert keine Zahl, nur die Ansicht) und muss
// trotzdem den Seitenwechsel ueberleben — sonst klappt man bei jedem Klick neu
// auf, und die Gliederung waere schlimmer als keine. Dieselbe Mechanik wie die
// Filterleiste des Analyse-Bereichs (AnalyseFilterBar.tsx): ein externer Store
// mit `useSyncExternalStore`, Server-Snapshot = Vorgabewert, danach zieht React
// den echten Wert nach — ohne Hydrations-Konflikt und ohne die zweite
// Render-Runde eines `useEffect`+`setState`-Paars.
//
// EIN Schluessel fuer alle Bloecke statt fuenf: ein Schreibvorgang, ein Event —
// und auf Mobil stehen Desktop-Leiste und Drawer gleichzeitig im DOM, beide
// haengen so an derselben Wahrheit.
const SECTION_KEY = "sidebar:sections-open";
const SECTION_EVENT = "sidebar:sections-open-change";

/**
 * Vorbelegung ALLER Bloecke — zugeklappt, ohne Ausnahme.
 *
 * WARUM EINE KONSTANTE UND KEIN PROP: Ein `defaultOpen` je Block waere die
 * Einladung, die Regel bei der naechsten Zeile still wieder aufzuweichen; die
 * Vorbelegung ist eine Entscheidung ueber die Leiste, nicht ueber einen Block.
 *
 * WIE SIE SICH ZUM GESPEICHERTEN ZUSTAND VERHAELT: Der gespeicherte gewinnt.
 * `writeSectionOpen` laeuft ausschliesslich im Klick-Handler des Kopfes (und
 * beim „Neue Liste"-Knopf, der den Block dafuer aufklappen muss) — ein
 * Eintrag im localStorage ist also IMMER eine bewusste Entscheidung eines
 * Menschen, nie ein mitgeschriebener Anfangszustand. Ihn zugunsten der neuen
 * Vorbelegung zu verwerfen (Schluesselwechsel, Migration) hiesse, genau das
 * wegzuwerfen, was Anforderung 3 schuetzt. Und teuer ist das Nichtstun nicht:
 * Wer die Leiste noch nie angefasst hat, hat gar keinen Eintrag und bekommt
 * die neue Vorgabe; wer einen hat, hat fuer genau diesen Block schon gesagt,
 * wie er ihn haben will.
 */
const SECTION_DEFAULT_OPEN = false;

/** Fallback, wenn localStorage blockiert ist (Private Mode) — dann eben nur fuer diese Sitzung. */
let sectionCache: Record<string, boolean> | null = null;

function readSections(): Record<string, boolean> {
  if (sectionCache) return sectionCache;
  const parsed: Record<string, boolean> = {};
  try {
    const raw = localStorage.getItem(SECTION_KEY);
    if (raw) {
      const obj: unknown = JSON.parse(raw);
      if (obj && typeof obj === "object") {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (typeof v === "boolean") parsed[k] = v;
        }
      }
    }
  } catch {
    /* blockiert oder kaputter Wert: Vorgabewerte, keine Ausnahme */
  }
  sectionCache = parsed;
  return parsed;
}

function subscribeSections(onChange: () => void) {
  // "storage" deckt andere Tabs ab (deren Schreibvorgang unser Abbild
  // entwertet), das eigene Event diesen hier.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== SECTION_KEY) return;
    sectionCache = null;
    onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(SECTION_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SECTION_EVENT, onChange);
  };
}

/** Der gespeicherte Zustand EINES Blocks; ohne Eintrag gilt die Vorbelegung. */
function readSectionOpen(id: string): boolean {
  const v = readSections()[id];
  return typeof v === "boolean" ? v : SECTION_DEFAULT_OPEN;
}

/**
 * Server-Schnappschuss fuer `useSyncExternalStore`: Auf dem Server gibt es kein
 * localStorage, dort gilt die Vorbelegung. Modulweit konstant, damit die
 * Referenz stabil bleibt — ein je Render neu gebautes Lambda zwaenge React in
 * eine zusaetzliche Runde.
 */
const readSectionDefault = (): boolean => SECTION_DEFAULT_OPEN;

function writeSectionOpen(id: string, next: boolean): void {
  const state = { ...readSections(), [id]: next };
  sectionCache = state;
  try {
    localStorage.setItem(SECTION_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(SECTION_EVENT));
}

type SidebarList = { id: string; name: string; owner_name: string | null };
type SidebarPhoneList = {
  id: string;
  name: string;
  owner_name: string | null;
  list_kind: "akquise" | "rueckruf" | "nicht_erreicht";
};
type DataScope = "workspace" | "own";
type DataViewUser = { user_id: string; username: string; data_scope: DataScope };
type DataViewState = {
  canSwitch: boolean;
  activeUserId: string | null;
  activeLabel: string;
  users: DataViewUser[];
};

/**
 * Organisations-Umschalter — nur fuer Plattform-Admins befuellt. Die aeussere
 * Grenze: waehrend die Datensicht innerhalb EINER Organisation die Person
 * wechselt, wechselt dies die Organisation selbst.
 */
type OrgSwitchState = {
  activeId: string;
  activeName: string;
  homeId: string | null;
  isForeign: boolean;
  orgs: { id: string; name: string }[];
};

type Props = {
  workspaceName: string;
  username: string;
  workspaceId: string;
  /** Faellige Aufgaben je Eintrag; `null` je Zweig = nicht ermittelbar. */
  navCounts?: NavCounts;
  lists: SidebarList[];
  /** Smart-View-Baum unter der LinkedIn-Sektion. */
  viewTree?: ViewNode[];
  phoneLists?: SidebarPhoneList[];
  dataScope?: DataScope;
  dataView?: DataViewState;
  orgSwitch?: OrgSwitchState;
  onClose?: () => void;
};

// LinkedIn-Glyphe (lucide fuehrt keine Brand-Icons mehr). Sie erbt die
// Textfarbe ihrer Zeile — die Sidebar ist monochrom, LinkedIn-Blau haette
// hier nichts zu suchen.
function LinkedInIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.55C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}

function NavLink({
  href,
  icon: Icon,
  label,
  onClick,
  exact = false,
  title,
  count,
  countLabel,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  onClick?: () => void;
  /** Nur die Route selbst faerbt aktiv — noetig, wenn eine Unterseite eine
      eigene Zeile hat (/analyse vs. /analyse/vergleich), sonst leuchten beide. */
  exact?: boolean;
  /** Tooltip — vor allem fuer Zeilen, die sich vom Namen her aehneln
      (Nachfassen vs. Ablage) und ohne Erklaerung verwechselbar waeren. */
  title?: string;
  /** Faellige Aufgaben. `null` = nicht ermittelbar, 0 = nichts faellig —
      beide zeigen KEIN Abzeichen (eine 0 neben jedem Eintrag ist Rauschen,
      und eine 0 ohne Datengrundlage waere obendrein gelogen). */
  count?: NavCount | null;
  /**
   * Was gezaehlt wird, als [Einzahl, Mehrzahl] — vollstaendig ausformuliert
   * („Aufgabe faellig", „Absage ohne eingetragenen Ersatztermin"). Bewusst
   * kein festes Verb im Code: Der Ablage-Zaehler zaehlt keine Faelligkeiten,
   * und „3 Absagen faellig" waere schlicht falsch.
   */
  countLabel?: [singular: string, plural: string];
}) {
  const pathname = usePathname();
  // Aktiv auch auf Unterseiten (/setting/abc → „Setting"); "/" nur exakt.
  const isActive = matchesHref(pathname, href, exact);
  const shows = Boolean(count && count.total > 0);
  const overdue = Boolean(count && count.overdue > 0);
  const noun = count && count.total === 1 ? (countLabel?.[0] ?? "Eintrag") : (countLabel?.[1] ?? "Einträge");
  // Der Zaehler haengt seine Erklaerung an den Tooltip der Zeile, statt eine
  // zweite zu erfinden: zwei Tooltips uebereinander sind einer zu viel.
  const countTitle = shows
    ? `${count!.total} ${noun}${count!.overdue > 0 ? `, davon ${count!.overdue} überfällig` : ""}`
    : null;
  const fullTitle = [title, countTitle].filter(Boolean).join(" — ") || undefined;

  return (
    <Link href={href} onClick={onClick} className={`sidebar-link${isActive ? " active" : ""}`} title={fullTitle}>
      <Icon size={16} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      {shows && (
        <span
          className="count-pill"
          data-tone={overdue ? "overdue" : undefined}
          style={{ flexShrink: 0 }}
          aria-label={countTitle ?? undefined}
        >
          {count!.total}
        </span>
      )}
    </Link>
  );
}

/**
 * Listeneintrag: Punkt + Name. Der Punkt kodiert nur „aktiv" (Orange) vs.
 * „inaktiv" (Grau) — welcher Kanal gemeint ist, sagt der Abschnittskopf
 * darueber, nicht eine zweite Farbe.
 */
function ListRow({
  href,
  name,
  badge,
  title,
  onClick,
}: {
  href: string;
  name: string;
  badge?: { label: string } | null;
  title?: string;
  onClick?: () => void;
}) {
  const pathname = usePathname();
  const isActive = pathname === href;
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`sidebar-link${isActive ? " active" : ""}`}
      style={{ paddingLeft: "var(--sp-8)", height: 32, fontSize: "var(--fs-sm)", fontWeight: 400 }}
      title={title ?? name}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "var(--r-full)",
          flexShrink: 0,
          background: isActive ? "var(--orange-500)" : "var(--text-disabled)",
        }}
      />
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {name}
      </span>
      {badge && (
        <span
          style={{
            fontSize: "var(--fs-2xs)",
            fontWeight: 500,
            letterSpacing: "0.04em",
            color: "var(--text-secondary)",
            background: "var(--surface-3)",
            borderRadius: "var(--r-full)",
            padding: "1px 6px",
            flexShrink: 0,
          }}
        >
          {badge.label}
        </span>
      )}
    </Link>
  );
}

// Die Kuerzel tragen die Bedeutung; der Tooltip der Zeile schreibt sie aus.
const PHONE_KIND_BADGE: Record<"rueckruf" | "nicht_erreicht", { label: string }> = {
  rueckruf: { label: "RR" },
  nicht_erreicht: { label: "NE" },
};

// ---------------------------------------------------------------------------
// Kontext-Umschalter
// ---------------------------------------------------------------------------
// Frueher waren das vier Elemente: zwei Banner ("du bist in Org X" / "du siehst
// die Daten von Y") plus zwei dauerhaft aufgeklappte Listen zum Wechseln. Sie
// sagen dasselbe, also sind sie jetzt EIN Element pro Achse: eine 36px-Zeile,
// die den aktiven Kontext zeigt und ihn per Klick aufklappt. Der Zustand steckt
// in der Faerbung — neutral = Normalfall, Orange = fremde Datensicht,
// Rot = fremde Organisation.
//
// Die Auswahlliste liegt bewusst NICHT im Textfluss der Sidebar. Als Kind des
// Kontext-Blocks wuchs sie beim Aufklappen um bis zu 240px und schob die
// komplette Navigation darunter nach unten — bei zwei Umschaltern uebereinander
// sprang sie zweimal, und der Eintrag, auf den man gerade zielte, war weg.
// Sie rendert deshalb als Portal-Popover (position: fixed) ueber der Seite,
// genau wie Select, DatePicker und CalendarPopover. Aufklappen veraendert das
// Layout der Sidebar damit gar nicht mehr.

type ContextTone = "neutral" | "accent" | "danger";

const CONTEXT_PALETTE: Record<
  ContextTone,
  { border: string; background: string; fg: string; caption: string }
> = {
  neutral: {
    border: "var(--border-default)",
    background: "var(--surface-1)",
    fg: "var(--text-secondary)",
    caption: "var(--text-muted)",
  },
  accent: {
    border: "var(--border-accent)",
    background: "var(--accent-muted)",
    fg: "var(--orange-300)",
    caption: "var(--orange-300)",
  },
  danger: {
    border: "var(--danger)",
    background: "var(--danger-bg)",
    fg: "var(--danger-fg)",
    caption: "var(--danger-fg)",
  },
};

/**
 * Mindestbreite des Popovers. Der Trigger misst in der 248px-Sidebar rund
 * 224px; weil das Popover als Overlay ueber der Seite liegt, darf es die
 * Sidebar-Kante ueberragen — lange Organisations- und Nutzernamen bleiben so
 * lesbar, statt sofort in die Ellipse zu laufen. AnchoredPopover haelt es
 * ausserdem immer im Viewport (Rand-Clamping), auch im Mobil-Panel.
 */
const CONTEXT_POPOVER_WIDTH = 264;
/** Danach scrollt die Liste — DESIGN.md §5.3: Popover max. 288px hoch. */
const CONTEXT_POPOVER_MAX_HEIGHT = 288;

function ContextSwitcher({
  icon,
  caption,
  label,
  tone,
  reset,
  children,
}: {
  icon: React.ReactNode;
  caption: string;
  label: string;
  tone: ContextTone;
  /** Formular zum Zuruecksetzen — nur wenn ein Nicht-Standard-Kontext aktiv ist. */
  reset?: React.ReactNode;
  /** Render-Prop wie bei CollapsibleSection: die Zeilen brauchen `close`,
      um das Popover nach ihrer Auswahl wieder zuzuklappen. */
  children: (ctx: { close: () => void }) => React.ReactNode;
}) {
  // Gleiche Mechanik wie Select/DatePicker: Trigger-Rect merken, zweiter Klick
  // schliesst. AnchoredPopover uebernimmt Aussenklick, Escape, Scroll, Resize.
  const { anchor, ref, toggle, close } = useAnchor();
  const isOpen = Boolean(anchor);
  const c = CONTEXT_PALETTE[tone];
  const Chevron = isOpen ? ChevronDown : ChevronRight;
  // useId statt einer aus `caption` gebauten ID: Desktop-Sidebar und
  // Mobil-Panel koennen gleichzeitig im DOM stehen — die ID muss trotzdem
  // eindeutig bleiben.
  const panelId = `ctx-panel-${useId()}`;
  // AnchoredPopover schliesst bereits beim mousedown AUSSERHALB des Popovers —
  // und der Trigger liegt ausserhalb. Der darauffolgende click wuerde den
  // Umschalter also sofort wieder aufklappen; per Klick liesse er sich nie
  // schliessen. Wir merken uns deshalb beim Druecken, ob er offen war, und
  // verschlucken genau diesen einen click. Die Tastatur loest kein mousedown
  // aus, dort bleibt es beim normalen Umschalten.
  const wasOpenOnPress = useRef(false);

  return (
    <>
      {/* Kein `overflow: hidden` mehr: das brauchte frueher nur die Liste im
          Fluss (fuer die runden Ecken). Jetzt sitzt hier allein der Trigger —
          und der globale Fokusring ist ein Box-Shadow, den ein Overflow-Clip
          abgeschnitten haette. */}
      <div
        style={{
          border: `1px solid ${c.border}`,
          background: c.background,
          borderRadius: "var(--r-md)",
          display: "flex",
          alignItems: "center",
        }}
      >
        <button
          ref={ref as React.RefObject<HTMLButtonElement>}
          type="button"
          onMouseDown={() => {
            wasOpenOnPress.current = isOpen;
          }}
          onKeyDown={() => {
            wasOpenOnPress.current = false;
          }}
          onClick={() => {
            const swallow = wasOpenOnPress.current;
            wasOpenOnPress.current = false;
            if (!swallow) toggle();
          }}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-controls={isOpen ? panelId : undefined}
          title={`${caption}: ${label} — wechseln`}
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            height: 36,
            padding: "0 var(--sp-4)",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: c.fg,
            fontFamily: "inherit",
          }}
        >
          <span style={{ display: "flex", flexShrink: 0 }}>{icon}</span>
          <span style={{ flex: 1, minWidth: 0, textAlign: "left", lineHeight: 1.15 }}>
            <span
              style={{
                display: "block",
                fontSize: "var(--fs-2xs)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: c.caption,
                opacity: 0.75,
              }}
            >
              {caption}
            </span>
            <span
              style={{
                display: "block",
                fontSize: "var(--fs-sm)",
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </span>
          </span>
          <Chevron size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
        </button>
        {reset}
      </div>

      {anchor && (
        <AnchoredPopover
          anchor={anchor}
          onClose={close}
          id={panelId}
          label={`${caption} wechseln`}
          width={Math.max(Math.round(anchor.width), CONTEXT_POPOVER_WIDTH)}
          maxHeight={CONTEXT_POPOVER_MAX_HEIGHT}
          style={{
            padding: "var(--sp-2)",
            display: "flex",
            flexDirection: "column",
            gap: 1,
            // Der Umschalter traegt seinen Zustand in der Kante (rot = fremde
            // Organisation, orange = fremde Datensicht). Das Popover erbt sie,
            // sonst wirkte die Liste wie ein fremdes, neutrales Element —
            // ausgerechnet im gefaehrlichsten Zustand der App.
            borderColor: tone === "neutral" ? undefined : c.border,
          }}
        >
          {children({ close })}
        </AnchoredPopover>
      )}
    </>
  );
}

/** Eine Auswahlzeile innerhalb eines Kontext-Umschalters. */
function ContextOption({
  action,
  fields,
  label,
  badge,
  active,
  title,
  avatar,
  onDone,
}: {
  action: (formData: FormData) => void | Promise<void>;
  fields: { name: string; value: string }[];
  label: string;
  badge?: string;
  active: boolean;
  title: string;
  avatar: React.ReactNode;
  /** Popover schliessen. Siehe Kommentar an der `action`-Huelle unten. */
  onDone?: () => void;
}) {
  return (
    // Das Schliessen haengt bewusst HIER und nicht am onClick des Buttons:
    // React spielt Zustandsaenderungen aus einem Klick-Handler noch vor der
    // Standardaktion des Klicks aus — das Formular waere aus dem DOM, bevor
    // der Browser es abschickt, und der Wechsel liefe ins Leere. Erst die
    // Server-Action anstossen, dann zuklappen.
    <form
      action={(fd) => {
        const running = action(fd);
        onDone?.();
        return running;
      }}
    >
      {fields.map((f) => (
        <input key={f.name} type="hidden" name={f.name} value={f.value} />
      ))}
      <button
        type="submit"
        className={`sidebar-link${active ? " active" : ""}`}
        style={{
          width: "100%",
          border: "none",
          cursor: "pointer",
          background: active ? undefined : "none",
          fontSize: "var(--fs-sm)",
        }}
        title={title}
      >
        {/* Avatare bleiben grau — die Owner-Palette lebt in Dashboards und
            Charts, wo sie Datenreihen unterscheidet. */}
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: "var(--r-full)",
            background: active ? "var(--accent-muted)" : "var(--surface-3)",
            color: active ? "var(--orange-300)" : "var(--text-secondary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "var(--fs-2xs)",
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {avatar}
        </span>
        <span
          style={{
            flex: 1,
            textAlign: "left",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        {badge && (
          <span className="eyebrow eyebrow-muted" style={{ flexShrink: 0, fontSize: "var(--fs-2xs)" }}>
            {badge}
          </span>
        )}
      </button>
    </form>
  );
}

/**
 * Aktionszeile am Fuss eines Kontext-Umschalters.
 *
 * Der Org-Umschalter war reine Auswahl: man konnte wechseln, aber nichts tun.
 * Verwalten und Anlegen lagen auf /admin — einer Seite, die man nur ueber den
 * Fuss der Navigation findet. Diese Zeilen schliessen die Luecke genau dort,
 * wo die Frage aufkommt. Optisch bewusst leiser als eine Auswahlzeile: sie
 * fuehren weg, statt den Kontext zu wechseln.
 */
function ContextAction({
  href,
  icon,
  label,
  onClick,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="sidebar-link"
      style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}
      title={label}
    >
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: "var(--r-full)",
          background: "var(--surface-3)",
          color: "var(--text-secondary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span
        style={{
          flex: 1,
          textAlign: "left",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </Link>
  );
}

/** Kleiner X-Knopf rechts in einer Kontext-Zeile (Kontext zuruecksetzen). */
function ContextReset({
  action,
  fields,
  title,
  color,
}: {
  action: (formData: FormData) => void | Promise<void>;
  fields: { name: string; value: string }[];
  title: string;
  color: string;
}) {
  return (
    <form action={action} style={{ display: "flex", flexShrink: 0 }}>
      {fields.map((f) => (
        <input key={f.name} type="hidden" name={f.name} value={f.value} />
      ))}
      <button
        type="submit"
        title={title}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color,
          padding: "0 var(--sp-4) 0 0",
          display: "flex",
          alignItems: "center",
        }}
      >
        <X size={13} />
      </button>
    </form>
  );
}

/**
 * Einklappbarer Block: Eyebrow-Kopf + optionale Aktion rechts.
 *
 * Drei Eigenschaften, ohne die eine Gliederung mehr kostet als sie bringt:
 *
 *  1. WAS AKTIV IST, BLEIBT SICHTBAR. Steckt die geoeffnete Seite im Block
 *     (`hasActive`), bleibt er aufgeklappt und sein Schalter ist gesperrt —
 *     sichtbar gesperrt (`aria-disabled`, eigener Tooltip), nicht wirkungslos.
 *     Ein Klick, der nichts tut, ist schlimmer als einer, der fehlt. Steht der
 *     Block nur deswegen offen, faerbt sich sein Titel orange: „hier bist du"
 *     ist die einzige Bedeutung von Orange in dieser Datei.
 *  2. DER ZAEHLER UEBERLEBT DAS ZUKLAPPEN. Zugeklappt traegt der Kopf die
 *     Summe der Zaehler seiner Zeilen — im selben Ueberfaellig-Ton. Ein
 *     Abzeichen, das man nur nach dem Aufklappen sieht, ist keine Nachricht.
 *     Aufgeklappt entfaellt es: daneben stehen dann die Einzelzahlen.
 *  3. DER ZUSTAND UEBERLEBT DEN SEITENWECHSEL (siehe SECTION_KEY oben) — und
 *     er schlaegt die Vorbelegung, siehe SECTION_DEFAULT_OPEN.
 */
function CollapsibleSection({
  id,
  icon,
  label,
  hasActive = false,
  count,
  countLabel,
  action,
  headerHref,
  headerHrefTitle,
  onHeaderNavigate,
  children,
}: {
  /** Schluessel des gespeicherten Aufklapp-Zustands — stabil halten. */
  id: string;
  icon: React.ReactNode;
  label: string;
  /** Steckt die geoeffnete Seite in diesem Block? Dann bleibt er offen. */
  hasActive?: boolean;
  /** Summe der Zaehler dieses Blocks; `null` = nicht ermittelbar (kein Abzeichen). */
  count?: NavCount | null;
  /** Was gezaehlt wird, als [Einzahl, Mehrzahl] — fuer den Tooltip. */
  countLabel?: [singular: string, plural: string];
  action?: (ctx: { open: boolean; setOpen: (open: boolean) => void }) => React.ReactNode;
  /** Optionales Ziel hinter dem Abschnitts-Titel (z. B. LinkedIn → /listen). */
  headerHref?: string;
  headerHrefTitle?: string;
  onHeaderNavigate?: () => void;
  children: React.ReactNode;
}) {
  const stored = useSyncExternalStore(
    subscribeSections,
    useCallback(() => readSectionOpen(id), [id]),
    readSectionDefault,
  );
  const open = stored || hasActive;
  /** Offen, obwohl zugeklappt gespeichert — der Grund steht auf dem Bildschirm. */
  const forcedOpen = hasActive && !stored;
  const Chevron = open ? ChevronDown : ChevronRight;

  const badge = !open && count && count.total > 0 ? count : null;
  const noun = badge && badge.total === 1 ? (countLabel?.[0] ?? "Eintrag") : (countLabel?.[1] ?? "Einträge");
  const badgeTitle = badge
    ? `${badge.total} ${noun}${badge.overdue > 0 ? `, davon ${badge.overdue} überfällig` : ""}`
    : null;

  const toggleTitle = hasActive
    ? `${label} enthält die geöffnete Seite und bleibt aufgeklappt`
    : open
      ? `${label} einklappen`
      : `${label} ausklappen`;
  const titleClass = forcedOpen ? "eyebrow" : "eyebrow eyebrow-muted";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", padding: "var(--sp-6) var(--sp-3) var(--sp-3)" }}>
        <button
          type="button"
          onClick={() => {
            // Anforderung: ein zugeklappter Block, in dem die aktuelle Seite
            // steckt, ist ein Fehler. Also gar nicht erst zulassen.
            if (!hasActive) writeSectionOpen(id, !open);
          }}
          aria-expanded={open}
          // Kein `disabled`: ein deaktivierter Knopf nimmt in mehreren Browsern
          // auch die Maus-Ereignisse mit — und damit den Tooltip, der die
          // einzige Erklaerung dafuer ist, warum er nicht reagiert.
          aria-disabled={hasActive || undefined}
          title={toggleTitle}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            background: "none",
            border: "none",
            cursor: hasActive ? "default" : "pointer",
            padding: "0 var(--sp-2)",
            color: forcedOpen ? "var(--orange-300)" : "var(--text-muted)",
            flexShrink: 0,
          }}
        >
          <Chevron size={12} style={{ flexShrink: 0 }} />
          {icon}
        </button>
        {/* Der Titel fuehrt zur Uebersicht des Abschnitts. Das ersetzt die
            fruehere Extra-Zeile „Alle Listen" — eine Zeile weniger, und der
            Weg dorthin ist da, wo man ihn sucht. */}
        {headerHref ? (
          <Link
            href={headerHref}
            onClick={onHeaderNavigate}
            title={headerHrefTitle ?? label}
            className={titleClass}
            style={{
              flex: 1,
              minWidth: 0,
              textDecoration: "none",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </Link>
        ) : (
          <span
            className={titleClass}
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </span>
        )}
        {badge && (
          <span
            className="count-pill"
            data-tone={badge.overdue > 0 ? "overdue" : undefined}
            style={{ flexShrink: 0 }}
            title={badgeTitle ?? undefined}
            aria-label={badgeTitle ?? undefined}
          >
            {badge.total}
          </span>
        )}
        {action?.({ open, setOpen: (next) => writeSectionOpen(id, next) })}
      </div>
      {open && <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>{children}</div>}
    </div>
  );
}

/** Kleiner quadratischer Aktions-Button im Abschnitts-Kopf. */
function SectionAction({
  title,
  active = false,
  href,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const style: React.CSSProperties = {
    width: 22,
    height: 22,
    borderRadius: "var(--r-sm)",
    background: active ? "var(--orange-500)" : "var(--surface-3)",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: active ? "#0a0a0b" : "var(--text-muted)",
    transition: "background var(--transition-fast), color var(--transition-fast)",
    flexShrink: 0,
  };
  if (href) {
    return (
      <Link href={href} onClick={onClick} title={title} style={style}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} title={title} style={style}>
      {children}
    </button>
  );
}

export function SidebarContent({
  username,
  workspaceId,
  lists,
  viewTree = [],
  phoneLists = [],
  dataScope = "workspace",
  dataView,
  orgSwitch,
  navCounts,
  onClose,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const isOwnScope = dataScope === "own";
  // Der Umschalter gehoert allein den Plattform-Admins (fuer alle anderen ist
  // orgSwitch undefined, siehe (dashboard)/layout.tsx). Er erscheint jetzt auch
  // bei nur EINER Organisation: seit er Verwalten und Anlegen anbietet, ist er
  // nicht mehr nur Auswahl — und die zweite Organisation entsteht genau hier.
  const canSwitchOrg = Boolean(orgSwitch);
  const isForeignOrg = Boolean(orgSwitch?.isForeign);

  // Die Sidebar navigiert, sie inventarisiert nicht. Ab hier uebernehmen
  // /listen bzw. /telefon — beide zeigen ohnehin mehr (Archiv, Zaehler).
  const visibleLists = lists.slice(0, SIDEBAR_LIST_CAP);
  const hiddenListCount = lists.length - visibleLists.length;
  const visiblePhoneLists = phoneLists.slice(0, SIDEBAR_LIST_CAP);
  const hiddenPhoneCount = phoneLists.length - visiblePhoneLists.length;
  const [showNewList, setShowNewList] = useState(false);
  const [showManualAppt, setShowManualAppt] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // Das Abzeichen am zugeklappten Block „Meine Arbeit". Die Einzelzahlen
  // stehen weiter an ihren Zeilen; diese Summe erscheint NUR zugeklappt und
  // beantwortet dort die einzige Frage, die von aussen zaehlt: „liegt da
  // etwas, und ist etwas davon zu spaet?"
  const arbeitCount = sumNavCounts([navCounts?.nachfassen, navCounts?.ablage]);

  const isImpersonating = Boolean(dataView?.activeUserId);
  const teamUsers = (dataView?.users ?? []).filter((u) => u.username !== username);
  const canSwitchDataView = Boolean(dataView?.canSwitch) && teamUsers.length > 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--surface-2)",
      }}
    >
      {/* Kopf: Wortmarke. Sitzt auf Topbar-Hoehe, damit die Kanten fluchten. */}
      <div
        style={{
          height: "var(--h-topbar)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--sp-4)",
          padding: "0 var(--sp-6)",
          borderBottom: "1px solid var(--border-default)",
          flexShrink: 0,
        }}
      >
        <Link href="/" onClick={onClose} className="wordmark" style={{ textDecoration: "none" }}>
          titan
        </Link>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Menü schließen"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              padding: 4,
              display: "flex",
            }}
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Kontext-Block: Organisation (aeussere Grenze) ueber Datensicht
          (innere). Beide nur, wenn es etwas zu wechseln gibt — ein normales
          Mitglied sieht hier gar nichts. */}
      {(canSwitchOrg || canSwitchDataView) && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--sp-3)",
            padding: "var(--sp-5)",
            borderBottom: "1px solid var(--border-subtle)",
            flexShrink: 0,
          }}
        >
          {canSwitchOrg && orgSwitch && (
            <ContextSwitcher
              icon={<Building2 size={14} />}
              caption="Organisation"
              label={orgSwitch.activeName}
              tone={isForeignOrg ? "danger" : "neutral"}
              reset={
                isForeignOrg ? (
                  <ContextReset
                    action={setActiveOrgForm}
                    fields={[{ name: "workspace_id", value: "" }]}
                    title="Zurück zur eigenen Organisation"
                    color="var(--danger-fg)"
                  />
                ) : undefined
              }
            >
              {({ close }) => (
                <>
                  {orgSwitch.orgs.map((o) => (
                    <ContextOption
                      key={o.id}
                      action={setActiveOrgForm}
                      fields={[{ name: "workspace_id", value: o.id }]}
                      label={o.name}
                      badge={o.id === orgSwitch.homeId ? "eigen" : undefined}
                      active={o.id === orgSwitch.activeId}
                      title={o.id === orgSwitch.activeId ? `${o.name} — aktiv` : `Zu ${o.name} wechseln`}
                      avatar={<Building2 size={11} />}
                      onDone={close}
                    />
                  ))}
                  <div style={{ height: 1, background: "var(--border-subtle)", margin: "var(--sp-2) var(--sp-3)" }} />
                  <ContextAction
                    href="/admin"
                    icon={<ShieldCheck size={11} />}
                    label="Organisationen verwalten"
                    onClick={() => {
                      close();
                      onClose?.();
                    }}
                  />
                  <ContextAction
                    href="/admin#neue-organisation"
                    icon={<Plus size={11} />}
                    label="Neue Organisation"
                    onClick={() => {
                      close();
                      onClose?.();
                    }}
                  />
                </>
              )}
            </ContextSwitcher>
          )}

          {canSwitchDataView && dataView && (
            <ContextSwitcher
              icon={<Users size={14} />}
              caption="Datensicht"
              label={isImpersonating ? dataView.activeLabel : "Alle Daten"}
              tone={isImpersonating ? "accent" : "neutral"}
              reset={
                isImpersonating ? (
                  <ContextReset
                    action={setDataViewForm}
                    fields={[
                      { name: "next", value: pathname },
                      { name: "view_user_id", value: "" },
                    ]}
                    title="Datensicht zurücksetzen"
                    color="var(--orange-300)"
                  />
                ) : undefined
              }
            >
              {({ close }) => (
                <>
                  <ContextOption
                    action={setDataViewForm}
                    fields={[
                      { name: "next", value: pathname },
                      { name: "view_user_id", value: "" },
                    ]}
                    label="Alle Daten"
                    active={!isImpersonating}
                    title="Datensicht zurücksetzen"
                    avatar={<Users size={11} />}
                    onDone={close}
                  />
                  {teamUsers.map((u) => (
                    <ContextOption
                      key={u.user_id}
                      action={setDataViewForm}
                      fields={[
                        { name: "next", value: pathname },
                        { name: "view_user_id", value: u.user_id },
                      ]}
                      label={u.username}
                      active={u.user_id === dataView.activeUserId}
                      title={`Datensicht von ${u.username} anzeigen`}
                      avatar={ownerInitials(u.username)}
                      onDone={close}
                    />
                  ))}
                </>
              )}
            </ContextSwitcher>
          )}
        </div>
      )}

      {/* Nav */}
      <nav
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "var(--sp-5) var(--sp-5)",
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        {/* Suche ueber ALLE Listen — ein Name muss nicht mehr in drei, vier
            Listen einzeln gesucht werden. */}
        {/* Ohne Block: Suche, Heimweg und die eine Anlege-Aktion. Sie gehoeren
            zu keinem Thema, sondern sind der Einstieg — und duerfen deshalb
            nie hinter einer Aufklappung liegen. */}
        <SearchTrigger onNavigate={onClose} />
        <NavLink href="/" icon={BarChart2} label="Dashboard" onClick={onClose} />

        {/* Termin ohne Liste manuell buchen (Social Selling / alter Kontakt).
            Ghost-Akzent: die einzige Orange-Textaktion in der Navigation. */}
        <button
          type="button"
          onClick={() => setShowManualAppt(true)}
          className="sidebar-link"
          style={{
            width: "100%",
            border: "none",
            background: "none",
            cursor: "pointer",
            color: "var(--orange-300)",
            textAlign: "left",
          }}
          title="Termin ohne Liste manuell buchen"
        >
          <CalendarPlus size={16} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>Termin buchen</span>
        </button>
        <ManualAppointmentModal
          open={showManualAppt}
          onClose={() => setShowManualAppt(false)}
          onSaved={() => router.refresh()}
        />

        {/* ── Meine Arbeit ── */}
        {/* Kalender, Tages-Wiedervorlage und Ablage in EINEM Block: Sie
            beantworten dieselbe Frage auf verschiedenen Zeitkoernungen (docs
            §1) und werden genau deshalb staendig verwechselt. Nebeneinander
            erklaeren sie sich gegenseitig; verstreut waeren es drei Werkzeuge,
            von denen man zwei nie benutzt. Der Kopf traegt zugeklappt die
            Summe ihrer Zaehler — sonst haenge die einzige Benachrichtigung der
            App an einer Aufklappung. */}
        <CollapsibleSection
          id="arbeit"
          icon={<Inbox size={13} />}
          label="Meine Arbeit"
          hasActive={containsActive(pathname, ARBEIT_HREFS)}
          count={arbeitCount}
          countLabel={["offene Aufgabe", "offene Aufgaben"]}
        >
          <NavLink href="/termine" icon={CalendarDays} label="Termine" onClick={onClose} />
          {/* DIE TOOLTIPS SIND DIE ABGRENZUNG, nicht Beiwerk: Sie sind die
              einzige Stelle, an der jemand ohne Doku erfaehrt, welche der drei
              Zeilen welche Frage beantwortet. Deshalb muessen sie mitwandern,
              wenn sich eine Seite aendert — der Nachfassen-Tooltip nannte nach
              dem Wegfall des LinkedIn-Zweigs monatelang eine Quelle, die es
              dort nicht mehr gibt. */}
          <NavLink
            href="/nachfassen"
            icon={Clock}
            label="Nachfassen"
            onClick={onClose}
            title="Fällige Recycling-Versuche: Leads, die schon einmal aus dem Funnel gefallen sind — verlorene Closings, tote Telefon- und Erstgespräch-Leads, LinkedIn-Kontakte ohne Antwort. Telefon-Rückrufe sowie Setting- und Closing-Wiedervorlagen stehen in der Terminliste, LinkedIn-Follow-ups erledigt das Listen-Board."
            count={navCounts?.nachfassen}
            countLabel={["Aufgabe fällig", "Aufgaben fällig"]}
          />
          {/* Die Gegenrichtung zu den Zeilen darueber: dort steht, was noch
              ansteht — hier, was aus dem Funnel gefallen ist. Ohne diesen
              Bereich verschwaende ein abgesagter oder verlorener Vorgang
              lautlos; die Sperrliste darin ist die einzige Ansicht der App, die
              die Datensicht bewusst ignoriert. */}
          <NavLink
            href="/ablage"
            icon={Archive}
            label="Ablage"
            onClick={onClose}
            title="Ausgeschiedene Vorgänge: abgesagt, disqualifiziert, kein Close, No-Show ohne Antwort — plus die org-weite Sperrliste"
            // Bewusst NICHT die Summe aller sechs Listen: Fuenf davon sind ein
            // Aktenschrank, der nie auf null geht. Gezaehlt wird die eine Liste
            // mit offener Handlung (navCounts.ts).
            count={navCounts?.ablage}
            countLabel={ABLAGE_COUNT_LABEL}
          />
        </CollapsibleSection>

        {/* ── LinkedIn ── */}
        <CollapsibleSection
          id="linkedin"
          icon={<LinkedInIcon size={13} />}
          label="LinkedIn"
          hasActive={containsActive(pathname, LINKEDIN_HREFS)}
          headerHref="/listen"
          headerHrefTitle="Alle Listen (inkl. Archiv)"
          onHeaderNavigate={onClose}
          action={({ open, setOpen }) => (
            <SectionAction
              title="Neue Liste"
              active={showNewList && open}
              onClick={() => {
                if (!open) {
                  setOpen(true);
                  setShowNewList(true);
                } else {
                  setShowNewList((v) => !v);
                }
                setTimeout(() => nameRef.current?.focus(), 50);
              }}
            >
              <Plus size={12} />
            </SectionAction>
          )}
        >
          {showNewList && (
            <div
              style={{
                margin: "0 0 var(--sp-4)",
                background: "var(--surface-1)",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--r-md)",
                padding: "var(--sp-5)",
              }}
            >
              <form
                action={async (fd) => {
                  await createListForm(fd);
                  setShowNewList(false);
                }}
              >
                <input type="hidden" name="workspace_id" value={workspaceId} />
                <input
                  ref={nameRef}
                  name="name"
                  required
                  placeholder="Listenname…"
                  className="ui-input"
                  style={{ marginBottom: "var(--sp-4)", fontSize: "var(--fs-sm)" }}
                />
                <input type="hidden" name="owner_name" value={username} />
                <div style={{ display: "flex", gap: "var(--sp-2)" }}>
                  <button
                    type="submit"
                    style={{
                      flex: 1,
                      background: "var(--orange-500)",
                      color: "#0a0a0b",
                      border: "none",
                      borderRadius: "var(--r-full)",
                      height: 28,
                      fontSize: "var(--fs-xs)",
                      fontWeight: 600,
                      fontFamily: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    Anlegen
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNewList(false)}
                    aria-label="Abbrechen"
                    style={{
                      background: "var(--surface-3)",
                      color: "var(--text-muted)",
                      border: "none",
                      borderRadius: "var(--r-full)",
                      height: 28,
                      width: 28,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Lange Listen kappen: ab SIDEBAR_LIST_CAP uebernimmt /listen.
              Eine Sidebar mit 20 Zeilen ist keine Navigation mehr. */}
          {visibleLists.map((l) => (
            <ListRow key={l.id} href={`/lists/${l.id}`} name={l.name} onClick={onClose} />
          ))}
          {hiddenListCount > 0 && (
            <ListRow
              href="/listen"
              name={`${hiddenListCount} weitere …`}
              onClick={onClose}
              title="Alle Listen anzeigen"
            />
          )}
          {lists.length === 0 && (
            <p style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", padding: "var(--sp-2) var(--sp-8)" }}>
              Noch keine Listen.
            </p>
          )}

          {/* Gefilterte Ansichten und Ordner — additiv neben den echten
              Listen, die weiterhin die Heimat der Kontakte sind. Eigene
              Ueberschrift statt nur einer Trennlinie: sonst verschwimmen
              Listen und Ansichten zu einem einzigen langen Block. */}
          {viewTree.length > 0 && (
            <div style={{ marginTop: "var(--sp-4)" }}>
              <div
                className="eyebrow eyebrow-muted"
                style={{ padding: "0 var(--sp-3) var(--sp-2) var(--sp-8)", fontSize: "var(--fs-2xs)" }}
              >
                Ansichten
              </div>
              <ViewTree tree={viewTree} lists={lists} onNavigate={onClose} />
            </div>
          )}
        </CollapsibleSection>

        {/* ── Telefon ── */}
        <CollapsibleSection
          id="telefon"
          icon={<Phone size={13} style={{ flexShrink: 0 }} />}
          label="Telefon"
          hasActive={containsActive(pathname, TELEFON_HREFS)}
          headerHref="/telefon"
          headerHrefTitle="Telefon-Übersicht öffnen"
          onHeaderNavigate={onClose}
        >
          {visiblePhoneLists.map((l) => (
            <ListRow
              key={l.id}
              href={`/telefon/${l.id}`}
              name={l.name}
              badge={l.list_kind !== "akquise" ? PHONE_KIND_BADGE[l.list_kind] : null}
              title={
                l.list_kind === "rueckruf"
                  ? `${l.name} (Rückruf-Liste)`
                  : l.list_kind === "nicht_erreicht"
                    ? `${l.name} (Nicht-erreicht-Liste)`
                    : l.name
              }
              onClick={onClose}
            />
          ))}
          {hiddenPhoneCount > 0 && (
            <ListRow
              href="/telefon"
              name={`${hiddenPhoneCount} weitere …`}
              onClick={onClose}
              title="Telefon-Übersicht öffnen"
            />
          )}
          {phoneLists.length === 0 && (
            <p style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", padding: "var(--sp-2) var(--sp-8)" }}>
              Noch keine Listen.
            </p>
          )}
        </CollapsibleSection>

        {/* ── Auswertung ── */}
        {/* Der Rueckblick, getrennt von der Tagesarbeit darueber: Diese drei
            Seiten oeffnet man absichtlich, nicht im Vorbeigehen. Zusammen sind
            sie ausserdem die einzige Stelle, an der Team-Zahlen stehen. */}
        <CollapsibleSection
          id="auswertung"
          icon={<PieChart size={13} />}
          label="Auswertung"
          hasActive={containsActive(pathname, AUSWERTUNG_HREFS)}
        >
          {dataView?.canSwitch && <NavLink href="/team" icon={Users} label="Team" onClick={onClose} />}
          {/* „Analyse" bewusst exakt: /analyse/vergleich hat eine eigene Zeile,
              sonst leuchteten dort beide gleichzeitig aktiv. */}
          <NavLink href="/analyse" icon={LineChart} label="Analyse" onClick={onClose} exact />
          <NavLink href="/analyse/vergleich" icon={GitCompare} label="Vergleich" onClick={onClose} />
        </CollapsibleSection>

        <div style={{ flex: 1, minHeight: "var(--sp-7)" }} />

        {/* ── Verwaltung ── */}
        {/* Export, Einstellungen und die Organisationsverwaltung ruft man
            selten und gezielt auf — deshalb steht der Block unten, hinter dem
            Abstandhalter und einer Trennlinie. Zugeklappt startet er wie alle
            anderen auch (SECTION_DEFAULT_OPEN); frueher war er der einzige. */}
        <div style={{ borderTop: "1px solid var(--border-subtle)", marginTop: "var(--sp-4)" }}>
          <CollapsibleSection
            id="verwaltung"
            icon={<Wrench size={13} />}
            label="Verwaltung"
            hasActive={containsActive(pathname, VERWALTUNG_HREFS)}
          >
            <NavLink href="/export" icon={Download} label="Export (CSV)" onClick={onClose} />
            <NavLink href="/settings" icon={Settings} label="Einstellungen" onClick={onClose} />
            {/* Nur Plattform-Admins: Organisationen anlegen, Nutzer verschieben. */}
            {orgSwitch && (
              <NavLink href="/admin" icon={ShieldCheck} label="Organisationen" onClick={onClose} />
            )}
          </CollapsibleSection>
        </div>
      </nav>

      {/* Footer */}
      <div style={{ borderTop: "1px solid var(--border-default)", padding: "var(--sp-5)", flexShrink: 0 }}>
        {isOwnScope && (
          <div
            style={{
              marginBottom: "var(--sp-4)",
              border: "1px solid var(--border-default)",
              background: "var(--surface-1)",
              color: "var(--text-muted)",
              borderRadius: "var(--r-sm)",
              padding: "var(--sp-3) var(--sp-4)",
              fontSize: "var(--fs-xs)",
              fontWeight: 500,
            }}
          >
            Eigene Datensicht aktiv
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", padding: "0 var(--sp-3) var(--sp-4)" }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "var(--r-full)",
              background: "var(--surface-3)",
              color: "var(--text-secondary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "var(--fs-xs)",
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {username.charAt(0).toUpperCase()}
          </div>
          <span
            style={{
              fontSize: "var(--fs-sm)",
              fontWeight: 500,
              color: "var(--text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {username}
          </span>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="sidebar-link"
            style={{
              width: "100%",
              color: "var(--text-muted)",
              border: "none",
              background: "none",
              cursor: "pointer",
              fontSize: "var(--fs-sm)",
            }}
          >
            <LogOut size={15} />
            <span>Abmelden</span>
          </button>
        </form>
      </div>
    </div>
  );
}

export function MobileDrawer({
  open,
  onClose,
  workspaceName,
  username,
  workspaceId,
  lists,
  viewTree,
  phoneLists,
  dataScope,
  dataView,
  orgSwitch,
  navCounts,
}: {
  open: boolean;
  onClose: () => void;
  workspaceName: string;
  username: string;
  workspaceId: string;
  lists: SidebarList[];
  viewTree?: ViewNode[];
  phoneLists?: SidebarPhoneList[];
  dataScope?: DataScope;
  dataView?: DataViewState;
  orgSwitch?: OrgSwitchState;
  navCounts?: NavCounts;
}) {
  if (!open) return null;
  return (
    <>
      {/* Scrim ueber dem FAB (zIndex 40), Panel darueber */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "var(--surface-scrim)", zIndex: 60 }} />
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          width: "var(--w-sidebar)",
          zIndex: 70,
          borderRight: "1px solid var(--border-default)",
          boxShadow: "var(--shadow-overlay)",
        }}
      >
        <SidebarContent
          workspaceName={workspaceName}
          username={username}
          workspaceId={workspaceId}
          lists={lists}
          viewTree={viewTree}
          phoneLists={phoneLists}
          dataScope={dataScope}
          dataView={dataView}
          orgSwitch={orgSwitch}
          navCounts={navCounts}
          onClose={onClose}
        />
      </div>
    </>
  );
}
