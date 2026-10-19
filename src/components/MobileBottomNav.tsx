"use client";

import { BarChart2, CalendarDays, Menu, MessageSquare, Phone } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Untere Tab-Leiste fuer das Handy. Vorher lag die KOMPLETTE Navigation hinter
// dem Menue-Knopf oben rechts — also am weitesten vom Daumen entfernt, und
// jeder Wechsel zwischen Terminliste und Call-Modus kostete zwei Beruehrungen
// plus Suchen im Drawer. Vier Ziele, die man mehrmals am Tag ansteuert, stehen
// jetzt direkt unten; alles Weitere bleibt im Drawer („Mehr").
//
// Auswahl der vier: die Arbeitsflaechen, keine Auswertungen. Analyse, Team,
// Recycling und Ablage oeffnet man selten genug fuer den Umweg ueber „Mehr".

type Tab = {
  href: string;
  label: string;
  icon: typeof Phone;
  /** Pfad-Praefixe, unter denen der Tab als aktiv gilt. */
  match: (path: string) => boolean;
};

const TABS: Tab[] = [
  { href: "/", label: "Start", icon: BarChart2, match: (p) => p === "/" },
  {
    href: "/termine",
    label: "Termine",
    icon: CalendarDays,
    match: (p) => p.startsWith("/termine") || p.startsWith("/setting") || p.startsWith("/closing"),
  },
  { href: "/telefon", label: "Telefon", icon: Phone, match: (p) => p.startsWith("/telefon") },
  {
    href: "/listen",
    label: "LinkedIn",
    icon: MessageSquare,
    match: (p) => p.startsWith("/listen") || p.startsWith("/lists") || p.startsWith("/ansicht"),
  },
];

export function MobileBottomNav({
  onOpenMenu,
  menuDot,
}: {
  onOpenMenu: () => void;
  /** Ton des Punkts am „Mehr"-Tab — `null` = nichts offen. */
  menuDot: "overdue" | "pending" | null;
}) {
  const pathname = usePathname() ?? "/";

  return (
    <nav className="mobile-bottom-nav glass-nav" aria-label="Hauptnavigation">
      {TABS.map((t) => {
        const active = t.match(pathname);
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className="mobile-bottom-nav-item"
            data-active={active ? "true" : undefined}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={20} aria-hidden />
            <span>{t.label}</span>
          </Link>
        );
      })}
      <button type="button" className="mobile-bottom-nav-item" onClick={onOpenMenu} aria-label="Weitere Bereiche">
        <span style={{ position: "relative", display: "inline-flex" }}>
          <Menu size={20} aria-hidden />
          {menuDot && (
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: -2,
                right: -4,
                width: 7,
                height: 7,
                borderRadius: "var(--r-full)",
                // Gold heisst „zu spaet", Orange nur „da liegt etwas" — wie in
                // der Seitenleiste.
                background: menuDot === "overdue" ? "var(--warning-fg)" : "var(--orange-500)",
              }}
            />
          )}
        </span>
        <span>Mehr</span>
      </button>
    </nav>
  );
}
