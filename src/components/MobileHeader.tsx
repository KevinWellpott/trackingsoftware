"use client";

import { Menu, Zap } from "lucide-react";
import { useState } from "react";
import { MobileDrawer } from "./Sidebar";

type Props = {
  workspaceName: string;
  username: string;
  workspaceId: string;
  lists: { id: string; name: string; owner_name: string | null }[];
  organicLists?: { id: string; name: string; owner_name: string | null }[];
};

export function MobileHeader({ workspaceName, username, workspaceId, lists, organicLists }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <header
        style={{
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 1rem",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-0)",
          position: "sticky",
          top: 0,
          zIndex: 30,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "var(--radius-sm)",
              background: "var(--brand-500)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Zap size={14} color="white" fill="white" />
          </div>
          <span
            style={{
              fontSize: "0.9375rem",
              fontWeight: 700,
              color: "var(--text-primary)",
            }}
          >
            Pitch Tracker
          </span>
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Menü öffnen"
          style={{
            background: "none",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
            color: "var(--text-secondary)",
            padding: "0.375rem",
            display: "flex",
            alignItems: "center",
          }}
        >
          <Menu size={20} />
        </button>
      </header>

      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        workspaceName={workspaceName}
        username={username}
        workspaceId={workspaceId}
        lists={lists}
        organicLists={organicLists}
      />
    </>
  );
}
