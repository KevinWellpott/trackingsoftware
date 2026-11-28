"use client";

// Die Trend-Diagramme des Dashboards — standardmäßig ZUGEKLAPPT (28.11.).
// Man öffnet sie absichtlich; der Zustand bleibt je Gerät gespeichert
// (localStorage), wie bei den Bereichen der Seitenleiste.

import { useSyncExternalStore, type ReactNode } from "react";
import { ChevronDown, ChevronRight, TrendingUp } from "lucide-react";

const KEY = "dashboard:trends-open";
const EVENT = "dashboard:trends-open-change";

function lesen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
function abonnieren(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT, onChange);
  };
}
/** Server-Schnappschuss: zugeklappt. */
const zu = (): boolean => false;

export function TrendBereich({ meta, children }: { meta: string; children: ReactNode }) {
  const offen = useSyncExternalStore(abonnieren, lesen, zu);
  const umschalten = () => {
    try {
      localStorage.setItem(KEY, offen ? "0" : "1");
    } catch {
      /* blockiert: dann nur bis zum Neuladen */
    }
    window.dispatchEvent(new Event(EVENT));
  };
  const Chevron = offen ? ChevronDown : ChevronRight;
  return (
    <section className="dash-trends" data-offen={offen || undefined}>
      <button type="button" className="card dash-trends-kopf" onClick={umschalten} aria-expanded={offen}>
        <Chevron size={16} aria-hidden />
        <TrendingUp size={16} aria-hidden />
        <span className="dash-trends-titel">Trends</span>
        <span className="dash-trends-meta">{meta}</span>
        <span className="dash-trends-aktion">{offen ? "Einklappen" : "Ausklappen"}</span>
      </button>
      {offen && <div className="dash-trends-inhalt">{children}</div>}
    </section>
  );
}
