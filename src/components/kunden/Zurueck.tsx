"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { ArrowLeft } from "lucide-react";

// Rückweg aus der Kundenakte dorthin, wo man herkam: die Kundenliste mit
// ihren Filtern oder eine Umsatz-Ansicht. Die Listen merken sich ihre Adresse
// für die Sitzung, die Akte liest sie.
//
// Nur eigene Pfade: Der Wert landet in einem href, ein Fremdwert wäre ein
// offener Weiterleitungspunkt (siehe BackLink).

const SCHLUESSEL = "ks-herkunft";
const ERLAUBT = /^\/(kunden|umsatz)(\?[^\\]*)?$/;

type Herkunft = { href: string; label: string };

function roh(): string | null {
  try {
    return sessionStorage.getItem(SCHLUESSEL);
  } catch {
    return null;
  }
}

function lies(text: string | null): Herkunft | null {
  try {
    const h = JSON.parse(text ?? "null") as Herkunft | null;
    return h && typeof h.href === "string" && ERLAUBT.test(h.href) && (h.label === "Kunden" || h.label === "Umsatz") ? h : null;
  } catch {
    return null;
  }
}

/** Merkt sich die aktuelle Listen-Adresse samt Filtern. */
export function HerkunftMerken({ label }: { label: "Kunden" | "Umsatz" }) {
  useEffect(() => {
    const merke = () => {
      const href = window.location.pathname + window.location.search;
      if (!ERLAUBT.test(href)) return;
      try {
        sessionStorage.setItem(SCHLUESSEL, JSON.stringify({ href, label }));
      } catch {
        // Ohne Speicher führt der Pfeil eben zur Liste ohne Filter.
      }
    };
    merke();
    // Filter wechseln per Link ohne Remount; der Klick in die Akte liest den Stand davor.
    window.addEventListener("click", merke, true);
    return () => window.removeEventListener("click", merke, true);
  }, [label]);
  return null;
}

const keinAbo = () => () => {};

export function ZurueckZurListe() {
  // Der Server kennt den Speicher nicht und rendert den Standard; der Browser zieht nach.
  const text = useSyncExternalStore(keinAbo, roh, () => null);
  const ziel = lies(text) ?? { href: "/kunden", label: "Kunden" };
  return (
    <Link
      href={ziel.href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        alignSelf: "flex-start",
        fontSize: "var(--fs-sm)",
        color: "var(--text-muted)",
        textDecoration: "none",
      }}
    >
      <ArrowLeft size={14} />
      {ziel.label}
    </Link>
  );
}
