"use client";

import { Menu } from "lucide-react";
import { useState } from "react";
import { MobileDrawer } from "./Sidebar";

// Topbar (COMPONENTS.md §10.2): 56px, Glass-Nav-Rezept, sticky. Sie blendet
// bei Scroll nicht aus — das hier ist eine App, kein Marketing-Header.
// Auf Mobile traegt sie zusaetzlich den Drawer-Trigger.

type Props = {
  workspaceName: string;
  username: string;
  workspaceId: string;
  lists: { id: string; name: string; owner_name: string | null }[];
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
};

export function MobileHeader({ workspaceName, username, workspaceId, lists, phoneLists, dataScope, dataView }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);

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
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Menü öffnen"
          style={{
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
        </button>
      </header>

      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        workspaceName={workspaceName}
        username={username}
        workspaceId={workspaceId}
        lists={lists}
        phoneLists={phoneLists}
        dataScope={dataScope}
        dataView={dataView}
      />
    </>
  );
}
