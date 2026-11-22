"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

// Navigation des Kundenspace. Filter, Reiter und Monat stehen in der URL (U3),
// deshalb sind das Links und kein Client-State.

export type NavEintrag = { key: string; label: string; href: string; zahl?: number | null; warnung?: boolean };

export function Reiter({ eintraege, aktiv, label }: { eintraege: NavEintrag[]; aktiv: string; label: string }) {
  const leiste = useRef<HTMLElement>(null);
  // Am Handy läuft die Leiste über: Der aktive Reiter gehört ins Bild.
  useEffect(() => {
    const el = leiste.current;
    const an = el?.querySelector<HTMLElement>('[data-active="true"]');
    if (!el || !an) return;
    const box = el.getBoundingClientRect();
    const r = an.getBoundingClientRect();
    if (r.left < box.left || r.right > box.right - 28) el.scrollLeft += r.left - box.left - (box.width - r.width) / 2;
  }, [aktiv]);
  return (
    <nav ref={leiste} aria-label={label} className="tab-scroller">
      {eintraege.map((e) => (
        <Link
          key={e.key}
          href={e.href}
          className="ui-tab ks-reiter"
          data-active={e.key === aktiv}
          aria-current={e.key === aktiv ? "page" : undefined}
        >
          {e.label}
          {e.zahl ? <span className="ks-zahl">{e.zahl}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export function Chips({ eintraege, aktiv, label }: { eintraege: NavEintrag[]; aktiv: string; label: string }) {
  return (
    <nav aria-label={label} className="ks-chips">
      {eintraege.map((e) => (
        <Link
          key={e.key}
          href={e.href}
          scroll={false}
          className="ks-chip"
          data-active={e.key === aktiv}
          data-warnung={e.warnung && !!e.zahl ? "true" : undefined}
          aria-current={e.key === aktiv ? "true" : undefined}
        >
          {e.label}
          {e.zahl !== undefined && e.zahl !== null && <span className="ks-zahl">{e.zahl}</span>}
        </Link>
      ))}
    </nav>
  );
}
