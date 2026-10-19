"use client";

import { SearchTrigger } from "@/components/search/SearchDialog";
import type { ViewNode } from "@/lib/listViews";
import type { NavCounts } from "@/lib/navCounts";
import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { MobileBottomNav } from "./MobileBottomNav";
import { MobileDrawer, sumNavCounts } from "./Sidebar";

// Topbar (COMPONENTS.md §10.2): 56px, Glass-Nav-Rezept, sticky. Sie blendet
// bei Scroll nicht aus — das hier ist eine App, kein Marketing-Header.
// Auf Mobile traegt sie zusaetzlich den Drawer-Trigger.
//
// Der Punkt am „Mehr"-Tab der unteren Leiste ist die mobile Haelfte der Aufgaben-Zaehler: Auf
// dem Desktop stehen sie in der Seitenleiste, hier liegt die komplette
// Navigation hinter einem Knopf. Ohne den Punkt waere die Zahl auf genau dem
// Geraet unsichtbar, auf dem sie am ehesten gebraucht wird. Bewusst nur ein
// Punkt und keine Zahl: WELCHER Eintrag etwas hat, steht eine Beruehrung
// weiter — mehrere Zahlen auf einem 36px-Knopf waeren keine.

type Props = {
  workspaceName: string;
  username: string;
  workspaceId: string;
  lists: { id: string; name: string; owner_name: string | null }[];
  viewTree?: ViewNode[];
  phoneLists?: {
    id: string;
    name: string;
    owner_name: string | null;
    list_kind: "akquise" | "rueckruf" | "nicht_erreicht" | "kein_termin";
  }[];
  dataScope?: "workspace" | "own";
  dataView?: {
    canSwitch: boolean;
    activeUserId: string | null;
    activeLabel: string;
    users: { user_id: string; username: string; data_scope: "workspace" | "own" }[];
  };
  orgSwitch?: {
    activeId: string;
    activeName: string;
    homeId: string | null;
    isForeign: boolean;
    orgs: { id: string; name: string }[];
  };
  navCounts?: NavCounts;
};

export function MobileHeader({ workspaceName, username, workspaceId, lists, viewTree, phoneLists, dataScope, dataView, orgSwitch, navCounts }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Seitenwechsel schliesst den Drawer — auch über Wege, die selbst kein
  // onClose rufen (Suche, Dialoge, Zurück-Taste). Muster „State beim Rendern
  // nachführen" statt Effekt, damit kein offener Frame dazwischen liegt.
  const pathname = usePathname();
  const [drawerPath, setDrawerPath] = useState(pathname);
  if (pathname !== drawerPath) {
    setDrawerPath(pathname);
    if (drawerOpen) setDrawerOpen(false);
  }

  // Dieselbe Zusammenfassung wie am zugeklappten Block „Meine Arbeit" in der
  // Seitenleiste (sumNavCounts, Sidebar.tsx) — zwei eigene Summen waeren zwei
  // Gelegenheiten, dieselbe Zahl unterschiedlich zu bilden.
  // Der Ablage-Zweig ist mit seiner Liste gefallen (lib/navCounts.ts); die
  // Summenform bleibt, damit sich der naechste Zaehler an EINER Stelle einhaengt.
  const pending = sumNavCounts([navCounts?.nachfassen]);
  const total = pending?.total ?? 0;
  const overdue = pending?.overdue ?? 0;

  return (
    <>
      <header
        className="glass-nav"
        style={{
          height: "var(--h-topbar)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 var(--sp-6)",
          // viewportFit "cover" (app/layout.tsx): ohne diesen Abstand laege
          // der Kopf im Vollbild-Modus unter Notch und Statusleiste.
          paddingTop: "env(safe-area-inset-top)",
          boxSizing: "content-box",
          position: "sticky",
          top: 0,
          zIndex: 30,
        }}
      >
        <Link href="/" className="wordmark" style={{ fontSize: "var(--fs-md)", textDecoration: "none" }}>
          titan
        </Link>
        {/* Suche direkt im Header — sie ueber den Drawer zu verstecken
            waere genau der Umweg, den sie abschaffen soll. Der Menue-Knopf
            ist in die untere Tab-Leiste gewandert („Mehr"), in Daumenreichweite;
            nur im Fokus-Modus des Dialers, wo die Tab-Leiste weicht, steht er
            wieder hier oben (globals.css, `.header-menu-btn`) — sonst gaebe es
            aus dem Call-Modus keinen Weg in die Navigation. */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
          <SearchTrigger variant="icon" />
          <button
            type="button"
            className="header-menu-btn"
            onClick={() => setDrawerOpen(true)}
            aria-label="Menü öffnen"
          >
            <Menu size={18} />
          </button>
        </div>
      </header>

      <MobileBottomNav
        onOpenMenu={() => setDrawerOpen(true)}
        menuDot={total > 0 ? (overdue > 0 ? "overdue" : "pending") : null}
      />

      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
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
      />
    </>
  );
}
