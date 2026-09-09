"use client";

import { Menu } from "lucide-react";
import { SearchTrigger } from "@/components/search/SearchDialog";
import type { ViewNode } from "@/lib/listViews";
import type { NavCounts } from "@/lib/navCounts";
import { useState } from "react";
import { MobileDrawer } from "./Sidebar";

// Topbar (COMPONENTS.md §10.2): 56px, Glass-Nav-Rezept, sticky. Sie blendet
// bei Scroll nicht aus — das hier ist eine App, kein Marketing-Header.
// Auf Mobile traegt sie zusaetzlich den Drawer-Trigger.
//
// Der Punkt am Menue-Knopf ist die mobile Haelfte der Aufgaben-Zaehler: Auf
// dem Desktop stehen sie in der Seitenleiste, hier liegt die komplette
// Navigation hinter einem Knopf. Ohne den Punkt waere die Zahl auf genau dem
// Geraet unsichtbar, auf dem sie am ehesten gebraucht wird. Bewusst nur ein
// Punkt und keine Zahl: WELCHER Eintrag etwas hat, steht eine Beruehrung
// weiter — drei Zahlen auf einem 36px-Knopf waeren keine.

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
    list_kind: "akquise" | "rueckruf" | "nicht_erreicht";
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

  const pending = [navCounts?.nachfassen, navCounts?.erinnerungen, navCounts?.ablage];
  const total = pending.reduce((n, c) => n + (c?.total ?? 0), 0);
  const overdue = pending.reduce((n, c) => n + (c?.overdue ?? 0), 0);

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
          position: "sticky",
          top: 0,
          zIndex: 30,
        }}
      >
        <span className="wordmark" style={{ fontSize: "var(--fs-md)" }}>
          titan
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
          {/* Suche direkt im Header — sie ueber den Drawer zu verstecken
              waere genau der Umweg, den sie abschaffen soll. */}
          <SearchTrigger variant="icon" />
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label={total > 0 ? `Menü öffnen — ${total} offene Aufgaben` : "Menü öffnen"}
            title={
              total > 0
                ? `${total} offene Aufgaben${overdue > 0 ? `, davon ${overdue} überfällig` : ""}`
                : undefined
            }
            style={{
              position: "relative",
              background: "transparent",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--r-full)",
              cursor: "pointer",
              color: "var(--text-secondary)",
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Menu size={18} />
            {total > 0 && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  top: 5,
                  right: 5,
                  width: 7,
                  height: 7,
                  borderRadius: "var(--r-full)",
                  // Derselbe Semantik-Ton wie die Zaehler in der Seitenleiste:
                  // Gold heisst „zu spaet", Orange nur „da liegt etwas".
                  background: overdue > 0 ? "var(--warning-fg)" : "var(--orange-500)",
                }}
              />
            )}
          </button>
        </div>
      </header>

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
