"use client";

import { ViewEditorModal, type ViewOption } from "@/components/listen/ViewEditorModal";
import type { ViewNode } from "@/lib/listViews";
import { ChevronRight, Filter, FolderClosed, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

// Ansichten-Baum in der Seitenleiste.
//
// Ein Knoten mit Filtern ist eine Ansicht (Trichter-Symbol), einer ohne ein
// reiner Ordner (Ordner-Symbol). Ordner mit Kindern lassen sich einklappen;
// beides bleibt anklickbar — auch ein Ordner hat eine Seite, die seine
// Unterordner zeigt.

const INDENT_PER_LEVEL = 12;

function TreeRow({
  node,
  depth,
  onNavigate,
}: {
  node: ViewNode;
  depth: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const href = `/ansicht/${node.id}`;
  const isActive = pathname === href;
  const hasChildren = node.children.length > 0;
  const isFolder = !node.filters;
  // Enthaelt der Teilbaum die offene Ansicht, startet der Ordner aufgeklappt.
  const [open, setOpen] = useState(() => containsPath(node, pathname));

  return (
    <>
      <div style={{ display: "flex", alignItems: "center" }}>
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Zuklappen" : "Aufklappen"}
            aria-expanded={open}
            style={{
              marginLeft: `calc(var(--sp-6) + ${depth * INDENT_PER_LEVEL}px)`,
              width: 16,
              height: 16,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "var(--text-disabled)",
              flexShrink: 0,
            }}
          >
            <ChevronRight
              size={12}
              style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform var(--transition-fast)" }}
            />
          </button>
        ) : (
          <span style={{ marginLeft: `calc(var(--sp-6) + ${depth * INDENT_PER_LEVEL}px)`, width: 16, flexShrink: 0 }} />
        )}
        <Link
          href={href}
          onClick={onNavigate}
          className={`sidebar-link${isActive ? " active" : ""}`}
          style={{ flex: 1, minWidth: 0, paddingLeft: "var(--sp-3)", height: 30, fontSize: "var(--fs-sm)", fontWeight: 400 }}
          title={node.name}
        >
          {isFolder ? (
            <FolderClosed size={12} style={{ flexShrink: 0, color: "var(--text-disabled)" }} />
          ) : (
            <Filter size={12} style={{ flexShrink: 0, color: isActive ? "var(--orange-500)" : "var(--text-disabled)" }} />
          )}
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.name}</span>
        </Link>
      </div>
      {hasChildren && open && (
        <div>
          {node.children.map((c) => (
            <TreeRow key={c.id} node={c} depth={depth + 1} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </>
  );
}

/** Liegt die aktuell offene Route irgendwo in diesem Teilbaum? */
function containsPath(node: ViewNode, pathname: string): boolean {
  if (pathname === `/ansicht/${node.id}`) return true;
  return node.children.some((c) => containsPath(c, pathname));
}

/** Baum → flache Liste mit Tiefe, fuer die Eltern-Auswahl im Editor. */
function flatten(nodes: ViewNode[], depth = 0): ViewOption[] {
  return nodes.flatMap((n) => [{ id: n.id, name: n.name, depth }, ...flatten(n.children, depth + 1)]);
}

export function ViewTree({
  tree,
  lists,
  onNavigate,
}: {
  tree: ViewNode[];
  lists: { id: string; name: string }[];
  onNavigate?: () => void;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <>
      {tree.map((n) => (
        <TreeRow key={n.id} node={n} depth={0} onNavigate={onNavigate} />
      ))}

      <button
        type="button"
        onClick={() => setCreating(true)}
        className="sidebar-link"
        style={{
          width: "100%",
          border: "none",
          background: "none",
          cursor: "pointer",
          color: "var(--text-muted)",
          textAlign: "left",
          paddingLeft: "calc(var(--sp-6) + 16px + var(--sp-3))",
          height: 30,
          fontSize: "var(--fs-sm)",
          fontFamily: "inherit",
        }}
        title="Ordner oder gefilterte Ansicht anlegen"
      >
        <Plus size={12} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1 }}>Neue Ansicht</span>
      </button>

      {creating && (
        <ViewEditorModal open onClose={() => setCreating(false)} lists={lists} parents={flatten(tree)} />
      )}
    </>
  );
}
