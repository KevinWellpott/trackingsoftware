"use client";

import { useState, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "dark" ? "dark" : "light";
}

// Hydration-sicher ohne setState-im-Effect: Server/Hydration → false, danach true.
const emptySubscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>("light");
  const mounted = useMounted();

  // Nach der Hydration einmalig mit dem echten data-theme synchronisieren
  // (Render-Phase-Update statt setState-im-Effect; hydration-sicher, da der
  // erste Client-Render identisch zum Server bleibt).
  const [synced, setSynced] = useState(false);
  if (mounted && !synced) {
    setSynced(true);
    const actual = getInitialTheme();
    if (actual !== theme) setTheme(actual);
  }

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
      // Cookie für evtl. serverseitige Nutzung
      document.cookie = `theme=${next};path=/;max-age=31536000;samesite=lax`;
    } catch {
      /* ignore */
    }
  }

  const isDark = theme === "dark";
  const label = isDark ? "Hell" : "Dunkel";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Zu ${label}modus wechseln`}
      title={`Zu ${label}modus wechseln`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        width: compact ? 34 : "100%",
        justifyContent: compact ? "center" : "flex-start",
        height: 34,
        padding: compact ? 0 : "0 0.75rem",
        borderRadius: "var(--radius-md)",
        background: "transparent",
        border: "1px solid var(--border)",
        color: "var(--text-muted)",
        fontSize: "0.8125rem",
        fontWeight: 500,
        cursor: "pointer",
        transition: "background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast)",
        opacity: mounted ? 1 : 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--surface-200)";
        e.currentTarget.style.color = "var(--text-primary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--text-muted)";
      }}
    >
      {isDark ? <Sun size={15} /> : <Moon size={15} />}
      {!compact && <span>{label}modus</span>}
    </button>
  );
}
