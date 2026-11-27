"use client";

import { SunMoon } from "lucide-react";
import { useRef, useSyncExternalStore } from "react";
import {
  APPEARANCE_MAX_AGE,
  MATERIAL_COOKIE,
  THEME_COOKIE,
  parseMaterialPref,
  parseThemePref,
  resolveTheme,
  type MaterialPref,
  type ThemePref,
} from "@/lib/appearance";
import { AnchoredPopover, useAnchor } from "./AnchoredPopover";
import { Segmented } from "./Segmented";

// „Darstellung": Erscheinung (System · Hell · Dunkel) und Material (Glas ·
// Solide). Erreichbar ueber die Sonne unten in der Seitenleiste und gespiegelt
// in /settings. Gespeichert je Geraet als Cookie (lib/appearance.ts, E5) —
// geschrieben direkt im Browser, ohne Server-Roundtrip: Die Wahl wirkt sofort
// auf <html>, und der naechste Seitenaufruf liest denselben Wert serverseitig.

const CHANGE_EVENT = "tt-appearance-change";

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

function readTheme(): ThemePref {
  return parseThemePref(document.documentElement.getAttribute("data-theme-pref"));
}
function readMaterial(): MaterialPref {
  return parseMaterialPref(document.documentElement.getAttribute("data-material"));
}

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${APPEARANCE_MAX_AGE}; samesite=lax`;
}

export function setThemePref(pref: ThemePref) {
  const root = document.documentElement;
  root.setAttribute("data-theme-pref", pref);
  root.setAttribute("data-theme", resolveTheme(pref));
  writeCookie(THEME_COOKIE, pref);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function setMaterialPref(material: MaterialPref) {
  document.documentElement.setAttribute("data-material", material);
  writeCookie(MATERIAL_COOKIE, material);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Hell" },
  { value: "dark", label: "Dunkel" },
] as const;

const MATERIAL_OPTIONS = [
  { value: "glass", label: "Glas" },
  { value: "solid", label: "Solide" },
] as const;

/**
 * Die beiden Schalter. `serverTheme`/`serverMaterial` sind die Werte, die der
 * Server aus dem Cookie gelesen hat — sie tragen den ersten Render, bis der
 * Browser uebernimmt (ohne sie stuende in /settings kurz „System", obwohl
 * „Hell" gewaehlt ist).
 */
export function AppearanceControls({
  serverTheme = "system",
  serverMaterial = "glass",
}: {
  serverTheme?: ThemePref;
  serverMaterial?: MaterialPref;
}) {
  const theme = useSyncExternalStore(subscribe, readTheme, () => serverTheme);
  const material = useSyncExternalStore(subscribe, readMaterial, () => serverMaterial);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
      <div>
        <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-secondary)", marginBottom: "var(--sp-4)" }}>
          Erscheinung
        </p>
        <Segmented
          options={THEME_OPTIONS}
          value={theme}
          onChange={(v) => setThemePref(v)}
          ariaLabel="Erscheinung"
        />
      </div>
      <div>
        <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-secondary)", marginBottom: "var(--sp-4)" }}>
          Material
        </p>
        <Segmented
          options={MATERIAL_OPTIONS}
          value={material}
          onChange={(v) => setMaterialPref(v)}
          ariaLabel="Material"
        />
      </div>
      <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", lineHeight: "var(--lh-base)" }}>
        „Solide“ schaltet die Transparenz ab, auch in Safari und Firefox. Die Wahl gilt für dieses
        Gerät.
      </p>
    </div>
  );
}

/** Sonnen-Knopf mit Popover — unten in der Seitenleiste. */
export function AppearanceButton() {
  const { anchor, ref, toggle, close } = useAnchor();
  const open = Boolean(anchor);
  // Wie beim Personenmenue: Das Popover schliesst schon beim mousedown
  // ausserhalb — der folgende Klick auf den Knopf darf es nicht sofort wieder
  // oeffnen.
  const wasOpenOnPress = useRef(false);

  return (
    <>
      <button
        ref={ref as React.RefObject<HTMLButtonElement>}
        type="button"
        className="side-iconbtn"
        title="Darstellung"
        aria-label="Darstellung"
        aria-haspopup="dialog"
        aria-expanded={open}
        onMouseDown={() => {
          wasOpenOnPress.current = open;
        }}
        onKeyDown={() => {
          wasOpenOnPress.current = false;
        }}
        onClick={() => {
          const swallow = wasOpenOnPress.current;
          wasOpenOnPress.current = false;
          if (!swallow) toggle();
        }}
      >
        <SunMoon size={16} aria-hidden />
      </button>
      {anchor && (
        <AnchoredPopover anchor={anchor} onClose={close} label="Darstellung" width={272} style={{ padding: 14 }}>
          <p style={{ fontSize: "13.5px", fontWeight: 600, marginBottom: "var(--sp-4)" }}>Darstellung</p>
          <AppearanceControls />
        </AnchoredPopover>
      )}
    </>
  );
}
