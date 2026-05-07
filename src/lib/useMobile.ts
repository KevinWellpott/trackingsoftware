"use client";
import { useSyncExternalStore } from "react";

export function useMobile(breakpoint = 768) {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
      mq.addEventListener("change", onStoreChange);
      return () => mq.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(`(max-width: ${breakpoint}px)`).matches,
    () => false,
  );
}
