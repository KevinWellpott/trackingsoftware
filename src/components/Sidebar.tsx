"use client";

import { setDataViewForm, signOut } from "@/app/actions/workspace";
import { setActiveOrgForm } from "@/app/actions/platform";
import { createListForm } from "@/app/actions/lists";
import { SearchTrigger } from "@/components/search/SearchDialog";
import { type NavCount, type NavCounts } from "@/lib/navCounts";
import {
  Archive,
  Handshake,
  LayoutDashboard,
  ListTodo,
  MessagesSquare,
  UserX,
  Wallet,
  ListChecks,
  Building2,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Download,
  GitCompare,
  LineChart,
  LogOut,
  Phone,
  Plus,
  Settings,
  ShieldCheck,
  Users,
  Wrench,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { AnchoredPopover, useAnchor } from "@/components/ui/AnchoredPopover";
import { ManualAppointmentModal } from "@/components/appointment/ManualAppointmentModal";
import { ownerInitials } from "@/lib/ownerColor";
import { AppearanceButton } from "@/components/ui/Appearance";

// Seitenleiste im Liquid-Glass-System: ein schwebendes Glas-Tablett (240px,
// Radius 26, 10px vom Rand — Flaeche und Rahmen setzt die Shell in
// app/(dashboard)/layout.tsx bzw. MobileDrawer unten). Oben steht NUR die
// Wortmarke und die Suche; Organisation und Datensicht liegen im
// Personenmenue unten (Entscheidung vom 27.11.). Aktive Zeile = Glas-Daumen
// mit Akzent-Icon (globals.css §6.7).
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

// GLIEDERUNG (Redesign „Liquid Glass", Phase 4 — Prototyp-Navigation).
// Vorher trug die Leiste fuenf aufklappbare Bloecke („Meine Arbeit",
// LinkedIn, Telefon, Auswertung, Verwaltung), alle zugeklappt, und den
// Tageseinstieg gab ein Quicklink-Streifen auf dem Dashboard. Jetzt steht der
// Einstieg selbst oben und offen, darunter benannte Gruppen:
//
//   (ohne Gruppe)  Suche · Übersicht · Heute · Kalender · Termin buchen
//   Akquise        Telefon · LinkedIn   (aufklappbar, mit ihren Listenbaeumen)
//   Vertrieb       Setting · Closing · No-Shows · Ablage
//   Kunden         Kunden · Umsatz & Collect · Vorlagen  (nur Titan, intern?.kunden)
//   Auswertung     Analyse · Vergleich · Team (nur Owner mit Team-Sicht)
//   Verwaltung     Export · Einstellungen · Organisationen (aufklappbar, unten)
//
// „Heute" ist der Nachfass-Eingang /nachfassen (er enthaelt Rueckrufe und
// Recycling), „Kalender" ist /termine — die Entscheidung des Nachfass-Plans
// schlaegt die Reiter-Idee des Redesign-Plans. Jede Zeile traegt einen
// Tooltip, der die FRAGE nennt, die sie beantwortet.
//
// AUFKLAPPBAR BLEIBEN NUR DREI: die zwei Listenbaeume (sie wachsen mit jeder
// Liste) und die Verwaltung. Alle starten zugeklappt (SECTION_DEFAULT_OPEN),
// der Block mit der geoeffneten Seite bleibt offen.
//
// /erinnerungen stand hier bis zum Rueckbau als Zeile — die stundengenaue
// Kaskade vor einem Termin. Sie ist ersatzlos gefallen: „Wer offen ist, wird
// jeden Tag kontaktiert" ist eine Tagesfrage.

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
const LINKEDIN_HREFS = ["/listen", "/lists"] as const;
const TELEFON_HREFS = ["/telefon"] as const;
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
  list_kind: "akquise" | "rueckruf" | "nicht_erreicht" | "kein_termin";
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
  phoneLists?: SidebarPhoneList[];
  dataScope?: DataScope;
  dataView?: DataViewState;
  orgSwitch?: OrgSwitchState;
  /** Interne Titan-Bereiche (Migration 0047) — undefined/false außerhalb von Titan. */
  intern?: InternNav;
  onClose?: () => void;
};

export type InternNav = { kunden: boolean; umsatz: boolean; meineUeberfaelligen?: NavCount | null };

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

/**
 * Gruppenkopf der Leiste (Prototyp `.navgrp`): ruhiger Text, nicht
 * aufklappbar. Gruppen ordnen; aufklappbar bleiben nur die Listenbäume und
 * die selten benutzte Verwaltung.
 */
function NavGroup({ label }: { label: string }) {
  return (
    <div className="side-navgrp" role="presentation">
      {label}
    </div>
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
const PHONE_KIND_BADGE: Record<"rueckruf" | "nicht_erreicht" | "kein_termin", { label: string }> = {
  rueckruf: { label: "RR" },
  nicht_erreicht: { label: "NE" },
  kein_termin: { label: "KT" },
};

// ---------------------------------------------------------------------------
// Person, Organisation, Datensicht
// ---------------------------------------------------------------------------
// Frueher standen zwei Kontext-Umschalter oben in der Leiste. Seit dem
// Liquid-Glass-Umbau liegen beide im Personenmenue UNTEN — oben steht nur noch
// die Wortmarke. Damit der Kontext dabei nicht unsichtbar wird, gilt:
//
//  · Solange ein FREMDER Kontext aktiv ist, steht er als farbige Zeile ueber
//    der Person, mit eigenem Zuruecksetzen-Knopf (StatusZeile). Rot (fremde
//    Organisation) steht ueber Orange (fremde Datensicht) — aeussere Grenze
//    zuerst (docs/data-model.md §2).
//  · Der Personen-Knopf selbst traegt denselben Ton als Rahmen.
//  · ForeignOrgBanner und ViewingBanner auf der Seite bleiben unberuehrt.
//
// Die Auswahl liegt als Portal-Popover (AnchoredPopover) ueber der Seite —
// Aufklappen veraendert das Layout der Leiste nicht.

/** Mindestbreite des Personenmenues; es darf die Leistenkante ueberragen. */
const PERSON_MENU_WIDTH = 264;
/** Danach scrollt das Menue — lange Organisations- und Teamlisten. */
const PERSON_MENU_MAX_HEIGHT = 480;

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
 * Ein aktiver fremder Kontext als farbige Zeile ueber der Person — nur, solange
 * er gilt. Der X-Knopf setzt ihn zurueck, ohne das Menue zu oeffnen.
 */
function StatusZeile({
  tone,
  icon,
  caption,
  label,
  reset,
}: {
  tone: "danger" | "accent";
  icon: React.ReactNode;
  caption: string;
  label: string;
  reset: React.ReactNode;
}) {
  return (
    <div className="side-ctx" data-tone={tone} title={`${caption}: ${label}`}>
      <span style={{ display: "flex", flexShrink: 0 }}>{icon}</span>
      <span className="side-ctx-text">
        <small>{caption}</small>
        <b>{label}</b>
      </span>
      {reset}
    </div>
  );
}

/**
 * Person unten in der Leiste: Avatar, Name, aktive Organisation. Klick oeffnet
 * das Menue mit Organisation (nur Plattform-Admins), Datensicht (nur Owner mit
 * Team-Sicht) und Abmelden.
 */
function PersonMenu({
  username,
  workspaceName,
  orgSwitch,
  dataView,
  teamUsers,
  canSwitchDataView,
  isForeignOrg,
  isImpersonating,
  pathname,
  onClose,
}: {
  username: string;
  workspaceName: string;
  orgSwitch?: OrgSwitchState;
  dataView?: DataViewState;
  teamUsers: DataViewUser[];
  canSwitchDataView: boolean;
  isForeignOrg: boolean;
  isImpersonating: boolean;
  pathname: string;
  onClose?: () => void;
}) {
  const { anchor, ref, toggle, close } = useAnchor();
  const isOpen = Boolean(anchor);
  // useId: Desktop-Leiste und Mobil-Blatt koennen gleichzeitig im DOM stehen.
  const panelId = `me-panel-${useId()}`;
  // AnchoredPopover schliesst schon beim mousedown ausserhalb — und der Knopf
  // liegt ausserhalb. Der folgende click oeffnete es sofort wieder; deshalb
  // merken wir uns beim Druecken, ob es offen war, und verschlucken genau
  // diesen einen click. Die Tastatur loest kein mousedown aus.
  const wasOpenOnPress = useRef(false);
  const tone = isForeignOrg ? "danger" : isImpersonating ? "accent" : undefined;
  const caption = orgSwitch?.activeName ?? workspaceName;

  return (
    <>
      <button
        ref={ref as React.RefObject<HTMLButtonElement>}
        type="button"
        className="side-me"
        data-tone={tone}
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
        title="Konto, Organisation und Datensicht"
      >
        <span className="side-avatar" aria-hidden="true">
          {username.charAt(0).toUpperCase()}
        </span>
        <span className="side-me-text">
          <b>{username}</b>
          <small>{caption}</small>
        </span>
        <ChevronsUpDown size={14} style={{ flexShrink: 0, opacity: 0.55 }} aria-hidden />
      </button>

      {anchor && (
        <AnchoredPopover
          anchor={anchor}
          onClose={close}
          id={panelId}
          label="Konto, Organisation und Datensicht"
          width={Math.max(Math.round(anchor.width), PERSON_MENU_WIDTH)}
          maxHeight={PERSON_MENU_MAX_HEIGHT}
          style={{ padding: "var(--sp-3)" }}
        >
          <div className="menu-list">
            {/* Organisation (aeussere Grenze) vor Datensicht (innere). */}
            {orgSwitch && (
              <>
                <div className="menu-h" data-tone={isForeignOrg ? "danger" : undefined}>
                  <Building2 size={12} aria-hidden /> Organisation
                </div>
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
                <hr className="menu-sep" />
              </>
            )}

            {canSwitchDataView && dataView && (
              <>
                <div className="menu-h" data-tone={isImpersonating ? "accent" : undefined}>
                  <Users size={12} aria-hidden /> Datensicht
                </div>
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
                <hr className="menu-sep" />
              </>
            )}

            <form action={signOut}>
              <button
                type="submit"
                className="sidebar-link"
                style={{
                  width: "100%",
                  color: "var(--text-secondary)",
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
        </AnchoredPopover>
      )}
    </>
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
          className="section-toggle"
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
    background: active ? "var(--orange-500)" : "var(--ctl)",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: active ? "var(--on-accent)" : "var(--text-muted)",
    transition: "background var(--transition-fast), color var(--transition-fast)",
    flexShrink: 0,
  };
  if (href) {
    return (
      <Link href={href} onClick={onClick} title={title} style={style} className="section-action">
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} title={title} style={style} className="section-action">
      {children}
    </button>
  );
}

export function SidebarContent({
  workspaceName,
  username,
  workspaceId,
  lists,
  phoneLists = [],
  dataScope = "workspace",
  dataView,
  orgSwitch,
  navCounts,
  intern,
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


  const isImpersonating = Boolean(dataView?.activeUserId);
  const teamUsers = (dataView?.users ?? []).filter((u) => u.username !== username);
  const canSwitchDataView = Boolean(dataView?.canSwitch) && teamUsers.length > 0;

  return (
    <div className="side-inner">
      {/* Kopf: NUR die Wortmarke (Entscheidung vom 27.11.: kein Org-Feld
          oben). Im Mobil-Blatt rechts das Schliessen. */}
      <div className="side-head">
        <Link href="/" onClick={onClose} className="wordmark" data-size="lg" style={{ textDecoration: "none" }}>
          titan
        </Link>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Menü schließen" className="side-iconbtn">
            <X size={18} />
          </button>
        )}
      </div>

      {/* Suche ueber ALLE Listen — direkt unter der Wortmarke, vor jeder
          Aufklappung. */}
      <div className="side-search">
        <SearchTrigger onNavigate={onClose} />
      </div>

      {/* Nav */}
      <nav className="side-nav">
        {/* ── Einstieg (ohne Gruppe) ──
            Übersicht · Heute · Kalender: die drei Flächen, mit denen der Tag
            beginnt (Redesign Phase 4). Sie liegen nie hinter einer Aufklappung.
            „Heute" ist der Nachfass-Eingang /nachfassen — Termine ohne
            nächsten Schritt, Rückrufe und Recycling in EINER Liste (Plan
            PLAN-nachfass-eingang.md); „Kalender" ist /termine. Route und Datei
            behalten ihre Namen, Lesezeichen und `?from=nachfassen` hängen daran. */}
        <NavLink
          href="/"
          icon={LayoutDashboard}
          label="Übersicht"
          onClick={onClose}
          title="Wie stehst du da? Kennzahlen des Zeitraums, wer heute dran ist und der Weg vom Termin zum Geld."
        />
        {/* Das einzige Abzeichen der Leiste (Entscheidung E2): Es zählt
            dieselbe Menge wie die Seite — überfällig + heute + „Ergebnis
            fehlt", ohne „Aufräumen" (src/lib/navCountsData.ts liest den Loader
            der Seite, docs §5.4). Es steht an einer Zeile, die nie hinter einer
            Aufklappung liegt — die Summe am zugeklappten Block brauchte es
            deshalb nicht mehr. */}
        <NavLink
          href="/nachfassen"
          icon={ListTodo}
          label="Heute"
          onClick={onClose}
          title="Wen musst du heute kontaktieren? Termine ohne nächsten Schritt, Telefon-Rückrufe und fällige Recycling-Leads — jeder mit seinem Datum für den nächsten Kontakt."
          count={navCounts?.nachfassen}
          countLabel={["Aufgabe fällig", "Aufgaben fällig"]}
        />
        <NavLink
          href="/termine"
          icon={CalendarDays}
          label="Kalender"
          onClick={onClose}
          title="Wann steht was an? Kalender und Terminliste — und bekommt jeder seine zwei Erinnerungen vor dem Termin."
        />

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
            color: "var(--accent-text)",
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

        {/* ── Akquise ──
            Die beiden Kanäle mit eigenem Volumen vor dem Termin. Sie behalten
            ihre Listenbäume — aufklappbar wie bisher, der Titel führt zur
            Übersicht des Kanals. */}
        <NavGroup label="Akquise" />
        <div className="side-akquise">
          {/* ── Telefon ── */}
          <CollapsibleSection
            id="telefon"
            icon={<Phone size={13} style={{ flexShrink: 0 }} />}
            label="Telefon"
            hasActive={containsActive(pathname, TELEFON_HREFS)}
            headerHref="/telefon"
            headerHrefTitle="Wen rufst du als Nächstes an? Telefon-Übersicht mit allen Listen und dem Call-Modus"
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
                      : l.list_kind === "kein_termin"
                        ? `${l.name} (Kein-Termin-Liste)`
                        : l.name
                }
                onClick={onClose}
              />
            ))}
            <ListRow
              href="/telefon/setting-no-show"
              name="Setting No-Show"
              badge={{ label: "NS" }}
              title="Terminierte Telefon-Leads, deren Erstgespräch auf „Nicht erschienen“ steht — zum erneuten Anrufen"
              onClick={onClose}
            />
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

          {/* ── LinkedIn ── */}
          <CollapsibleSection
            id="linkedin"
            icon={<LinkedInIcon size={13} />}
            label="LinkedIn"
            hasActive={containsActive(pathname, LINKEDIN_HREFS)}
            headerHref="/listen"
            headerHrefTitle="Wem schreibst du heute? Alle Pitch-Listen samt Archiv und fälligen Follow-ups"
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
                        color: "var(--on-accent)",
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
            {/* Abgeleitete Liste (src/lib/settingNoShow.ts) — keine Zeile in
                `lists`, deshalb fest hier statt aus dem Listen-Array. */}
            <ListRow
              href="/listen/setting-no-show"
              name="Setting No-Show"
              badge={{ label: "NS" }}
              title="Terminierte LinkedIn-Kontakte, deren Erstgespräch auf „Nicht erschienen“ steht"
              onClick={onClose}
            />
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

          </CollapsibleSection>

        </div>

        {/* ── Vertrieb ──
            Vom Termin bis zum Abschluss: die Erstgespräche, die Closings, wer
            nicht erschienen ist — und die Gegenrichtung, was herausgefallen ist. */}
        <NavGroup label="Vertrieb" />
        <NavLink
          href="/setting"
          icon={MessagesSquare}
          label="Setting"
          onClick={onClose}
          title="Wie stehen die Erstgespräche? Alle Settings nach Ergebnis — ohne Ergebnis, nicht erschienen, qualifiziert, nicht qualifiziert, tot."
        />
        <NavLink
          href="/closing"
          icon={Handshake}
          label="Closing"
          onClick={onClose}
          title="Wie stehen die Abschlussgespräche? Alle Closings nach Ergebnis — ohne Ergebnis, nachfassen, gewonnen, verloren."
        />
        {/* OHNE ZÄHLER: Ein No-Show-Badge müsste exakt dieselbe Menge zählen
            wie die Seite (strikt persönlich, jüngstes Setting je Lead) — also
            ihre Abfragen auf jeder Seite mitladen. Docs §5.4. */}
        <NavLink
          href="/no-shows"
          icon={UserX}
          label="No-Shows"
          onClick={onClose}
          title="Wer ist nicht erschienen und braucht einen neuen Termin? Erstgespräche und Closings mit No-Show, getrennt."
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
          // OHNE ZAEHLER, und zwar seit dem Rueckbau der Ablage. Uebrig sind
          // zwei Aktenschraenke, die nie auf null gehen; ein Badge darauf waere
          // eine Mahnung ohne Adressat (docs §5.4, ausfuehrlich in lib/navCounts.ts).
        />

        {/* ── Kunden ──
            Nur in der Titan-Organisation (intern_rechte(), Migration 0047):
            Kundenakten fürs Fulfillment, Vorlagen und, nur für Admins, der
            Umsatz. In einer Kunden-Organisation existiert die Gruppe nicht,
            auch nicht für einen Plattform-Admin, der dort gerade arbeitet:
            Titans eigene Zahlen gehören nicht in fremde Räume. */}
        {intern?.kunden && (
          <>
            <NavGroup label="Kunden" />
            <NavLink
              href="/kunden"
              // Praefix fuer die Akten, aber nicht fuer die Vorlagen: die haben ihre eigene Zeile.
              exact={pathname.startsWith("/kunden/vorlagen")}
              icon={Handshake}
              label="Kunden"
              onClick={onClose}
              title="Was steht beim nächsten Kunden an? Meeting mit Agenda, Checklisten und Übergabe je Kunde."
            />
            {intern.umsatz && (
              <NavLink
                href="/umsatz"
                icon={Wallet}
                label="Umsatz & Collect"
                onClick={onClose}
                title="Was kommt rein, was geht raus, was bleibt — und wer zahlt zu spät?"
                count={intern.meineUeberfaelligen}
                countLabel={["Kunde von dir zahlt zu spät", "Kunden von dir zahlen zu spät"]}
              />
            )}
            <NavLink
              href="/kunden/vorlagen"
              icon={ListChecks}
              label="Vorlagen"
              onClick={onClose}
              title="Aus welchen Vorlagen entstehen die Checklisten der Kunden?"
            />
          </>
        )}

        {/* ── Auswertung ──
            Der Rückblick, getrennt von der Tagesarbeit: Diese Seiten öffnet
            man absichtlich, nicht im Vorbeigehen. */}
        <NavGroup label="Auswertung" />
        {/* „Analyse" bewusst exakt: /analyse/vergleich hat eine eigene Zeile,
            sonst leuchteten dort beide gleichzeitig aktiv. */}
        <NavLink
          href="/analyse"
          icon={LineChart}
          label="Analyse"
          onClick={onClose}
          exact
          title="Was funktioniert? Kennzahlen je Kanal, Setting, Closing und der Trichter bis zum Umsatz."
        />
        <NavLink
          href="/analyse/vergleich"
          icon={GitCompare}
          label="Vergleich"
          onClick={onClose}
          title="Wie verhalten sich zwei Zahlen zueinander? Kennzahlen nach Person, Kanal oder Liste nebeneinander."
        />
        {/* Nur Owner mit Team-Sicht — dieselbe Regel wie /team selbst. */}
        {dataView?.canSwitch && (
          <NavLink
            href="/team"
            icon={Users}
            label="Team"
            onClick={onClose}
            title="Wie läuft die Woche im Team? Wochenduell und Team-Vergleich."
          />
        )}

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

      {/* Fuss: fremder Kontext als Status (Rot ueber Orange), darunter die
          Person mit Organisation/Datensicht im Menue und die Darstellung. */}
      <div className="side-foot">
        {isForeignOrg && orgSwitch && (
          <StatusZeile
            tone="danger"
            icon={<Building2 size={14} />}
            caption="Fremde Organisation"
            label={orgSwitch.activeName}
            reset={
              <ContextReset
                action={setActiveOrgForm}
                fields={[{ name: "workspace_id", value: "" }]}
                title="Zurück zur eigenen Organisation"
                color="var(--danger-fg)"
              />
            }
          />
        )}
        {isImpersonating && dataView && (
          <StatusZeile
            tone="accent"
            icon={<Users size={14} />}
            caption="Datensicht"
            label={dataView.activeLabel}
            reset={
              <ContextReset
                action={setDataViewForm}
                fields={[
                  { name: "next", value: pathname },
                  { name: "view_user_id", value: "" },
                ]}
                title="Datensicht zurücksetzen"
                color="var(--accent-text)"
              />
            }
          />
        )}
        {isOwnScope && <div className="side-note">Eigene Datensicht aktiv</div>}
        <div className="side-foot-row">
          <PersonMenu
            username={username}
            workspaceName={workspaceName}
            orgSwitch={canSwitchOrg ? orgSwitch : undefined}
            dataView={dataView}
            teamUsers={teamUsers}
            canSwitchDataView={canSwitchDataView}
            isForeignOrg={isForeignOrg}
            isImpersonating={isImpersonating}
            pathname={pathname}
            onClose={onClose}
          />
          <AppearanceButton />
        </div>
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
  phoneLists,
  dataScope,
  dataView,
  orgSwitch,
  navCounts,
  intern,
}: {
  open: boolean;
  onClose: () => void;
  workspaceName: string;
  username: string;
  workspaceId: string;
  lists: SidebarList[];
  phoneLists?: SidebarPhoneList[];
  dataScope?: DataScope;
  dataView?: DataViewState;
  orgSwitch?: OrgSwitchState;
  navCounts?: NavCounts;
  intern?: InternNav;
}) {
  // Offener Drawer: Seite dahinter festhalten (sonst scrollt beim Wischen im
  // Menue die Liste darunter mit) und Escape schliesst — wie jeder Dialog.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      {/* Scrim ueber dem FAB (zIndex 40), Panel darueber */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "var(--surface-scrim)", zIndex: 60 }} />
      <div className="side-sheet glass dense">
        <SidebarContent
          workspaceName={workspaceName}
          username={username}
          workspaceId={workspaceId}
          lists={lists}
          phoneLists={phoneLists}
          dataScope={dataScope}
          dataView={dataView}
          orgSwitch={orgSwitch}
          navCounts={navCounts}
          intern={intern}
          onClose={onClose}
        />
      </div>
    </>
  );
}
