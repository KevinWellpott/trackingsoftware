"use client";

import { useEffect, useState } from "react";

// App-Breakpoint: 768px (siehe globals.css @media (max-width: 767px)).
// SSR-sicher: Default false → Server & erster Client-Render sind identisch
// (Desktop), danach flippt der Effect auf Mobile, falls zutreffend.
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return isMobile;
}
