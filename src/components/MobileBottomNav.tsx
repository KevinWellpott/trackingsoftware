"use client";

import type { NavCount } from "@/lib/navCounts";
import { CalendarDays, ListTodo, Menu, Phone } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Untere Tab-Leiste fuer das Handy (Redesign Phase 4): Heute · Kalender ·
// Telefon · Mehr — wie im Prototyp. Vorher lag die KOMPLETTE Navigation
// hinter dem Menue-Knopf oben rechts, am weitesten vom Daumen entfernt.
//
// Auswahl der drei: die Arbeitsflaechen des Tages. „Heute" ist der
// Nachfass-Eingang (/nachfassen), „Kalender" die Termine (/termine), Telefon
// der Call-Modus-Einstieg. Alles Weitere (Uebersicht, LinkedIn, Vertrieb,
// Auswertung) liegt im Blatt hinter „Mehr".
//
// Der Zaehler steht an „Heute" und zaehlt DIESELBE Menge wie die Seite und die
// Seitenleiste (`getNavCounts()`, docs §5.4). `null` heisst „nicht
// ermittelbar" — dann kein Abzeichen, nie eine 0.
//
// Im Call-Modus weicht die Leiste (`body[data-dialer]`, globals.css).

type Tab = {
  href: string;
  label: string;
  icon: typeof Phone;
  /** Pfad-Praefixe, unter denen der Tab als aktiv gilt. */
  match: (path: string) => boolean;
};

const TABS: Tab[] = [
  { href: "/nachfassen", label: "Heute", icon: ListTodo, match: (p) => p.startsWith("/nachfassen") },
  { href: "/termine", label: "Kalender", icon: CalendarDays, match: (p) => p.startsWith("/termine") },
  { href: "/telefon", label: "Telefon", icon: Phone, match: (p) => p.startsWith("/telefon") },
];

export function MobileBottomNav({
  onOpenMenu,
  heute,
}: {
  onOpenMenu: () => void;
  /** Zaehler am Tab „Heute" — `null` = nicht ermittelbar (kein Abzeichen). */
  heute: NavCount | null;
}) {
  const pathname = usePathname() ?? "/";
  const mehrAktiv = !TABS.some((t) => t.match(pathname));
  const shows = Boolean(heute && heute.total > 0);

  return (
    <nav className="mobile-bottom-nav glass" aria-label="Hauptnavigation">
      {TABS.map((t) => {
        const active = t.match(pathname);
        const Icon = t.icon;
        const zaehler = t.href === "/nachfassen" && shows ? heute! : null;
        return (
          <Link
            key={t.href}
            href={t.href}
            className="mobile-bottom-nav-item"
            data-active={active ? "true" : undefined}
            aria-current={active ? "page" : undefined}
          >
            <span style={{ position: "relative", display: "inline-flex" }}>
              <Icon size={20} aria-hidden />
              {zaehler && (
                <span
                  className="count-pill mobile-tab-count"
                  data-tone={zaehler.overdue > 0 ? "overdue" : undefined}
                  aria-label={`${zaehler.total} fällig${zaehler.overdue > 0 ? `, davon ${zaehler.overdue} überfällig` : ""}`}
                >
                  {zaehler.total}
                </span>
              )}
            </span>
            <span>{t.label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        className="mobile-bottom-nav-item"
        data-active={mehrAktiv ? "true" : undefined}
        onClick={onOpenMenu}
        aria-label="Weitere Bereiche"
      >
        <Menu size={20} aria-hidden />
        <span>Mehr</span>
      </button>
    </nav>
  );
}
