"use client";

import { useEffect, useState } from "react";

// Umgehung eines Fehlers in Next 16.2.x / React (gemessen am 22.11.2026).
//
// Unter einer `loading.tsx` kann die Transition nach einer Server Action
// hängen bleiben: Die Antwort ist da, gerendert wird sie erst beim nächsten
// beliebigen Update, also wenn jemand tippt oder klickt. Im Kundenspace traf
// das 27 von 42 Aktionen. Mit Next 16.4.6 tritt es nicht auf (0 von 36), mit
// 16.2.12 weiterhin. Nach einem Upgrade kann diese Datei samt ihrer Aufrufe weg.
//
// Die Komponente lebt im Layout und nicht im Dialog: Der schließt sich nach
// der Aktion und nähme den Anstoß mit.

const EREIGNIS = "ks:aktion-fertig";
// Früh und oft für den Normalfall, dann ausdünnend für langsame Geräte.
const ANSTOESSE_MS = [30, 100, 250, 500, 1000, 2000, 4000, 8000];

/** Nach jedem `await` auf eine Server Action des Kundenspace aufrufen. */
export function aktionFertig() {
  window.dispatchEvent(new Event(EREIGNIS));
}

export function AktionsPuls() {
  const [, setPuls] = useState(0);
  useEffect(() => {
    const uhren = new Set<ReturnType<typeof setTimeout>>();
    const los = () => {
      for (const ms of ANSTOESSE_MS) {
        const uhr = setTimeout(() => {
          uhren.delete(uhr);
          setPuls((n) => n + 1);
        }, ms);
        uhren.add(uhr);
      }
    };
    window.addEventListener(EREIGNIS, los);
    return () => {
      window.removeEventListener(EREIGNIS, los);
      uhren.forEach(clearTimeout);
    };
  }, []);
  return null;
}
