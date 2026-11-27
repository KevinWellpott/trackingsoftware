// Darstellung je Geraet (Entscheidung E5): zwei Cookies, keine Datenbank.
//
//   tt-theme     system | light | dark   — Vorgabe „system"
//   tt-material  glass  | solid          — Vorgabe „glass"
//
// Gelesen im Root-Layout (Server), geschrieben vom Popover „Darstellung"
// direkt im Browser (components/ui/Appearance.tsx). Ein Cookie statt
// localStorage, damit der Server schon im ersten HTML den richtigen Wert
// setzt — sonst blitzte bei jedem Laden kurz der falsche Modus auf.
//
// Diese Datei ist bewusst ohne Server- oder Client-Abhaengigkeit: Layout und
// Popover importieren dieselben Namen und dieselbe Pruefung.

export const THEME_COOKIE = "tt-theme";
export const MATERIAL_COOKIE = "tt-material";

export type ThemePref = "system" | "light" | "dark";
export type MaterialPref = "glass" | "solid";

/** Canvas je Modus — fuer die Browser-Leiste (viewport.themeColor). Muss mit
    `--canvas` in globals.css uebereinstimmen. */
export const CANVAS_COLOR = { light: "#eef0f5", dark: "#08080b" } as const;

/** Ein Jahr — die Wahl gehoert zum Geraet, nicht zur Sitzung. */
export const APPEARANCE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseThemePref(value: string | null | undefined): ThemePref {
  return value === "light" || value === "dark" ? value : "system";
}

export function parseMaterialPref(value: string | null | undefined): MaterialPref {
  return value === "solid" ? "solid" : "glass";
}

/**
 * Laeuft als Inline-Skript im <head>, VOR dem ersten Paint.
 *
 * `data-theme` gehoert allein diesem Skript (und danach dem Popover) — React
 * rendert nur `data-theme-pref`. Wuerde der Server `data-theme` mitrendern,
 * entfernte React das Attribut beim naechsten Server-Render wieder, sobald
 * jemand auf „System" zurueckschaltet, und die Seite fiele mitten in der
 * Sitzung auf Dunkel zurueck.
 *
 * Bei „System" folgt die Seite einem Wechsel des Betriebssystems live.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var d=document.documentElement;var m=window.matchMedia("(prefers-color-scheme: light)");var a=function(){var p=d.getAttribute("data-theme-pref");d.setAttribute("data-theme",p==="light"||p==="dark"?p:(m.matches?"light":"dark"))};a();var l=function(){if(d.getAttribute("data-theme-pref")==="system")a()};if(m.addEventListener)m.addEventListener("change",l);else if(m.addListener)m.addListener(l)}catch(e){}})();`;

/** Der aufgeloeste Modus fuer eine Vorgabe — im Browser. */
export function resolveTheme(pref: ThemePref): "light" | "dark" {
  if (pref !== "system") return pref;
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
