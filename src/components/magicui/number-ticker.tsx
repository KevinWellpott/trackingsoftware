import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Formatierte Zahl — ohne Hochzähl-Animation.
 *
 * Die Komponente hat den Wert früher von 0 auf sein Ziel hochgefedert. Bei
 * einer einzelnen Heldenzahl ist das ein netter Effekt; in einer Analyse-Ansicht
 * mit zehn KPI-Kacheln zappeln zehn Zahlen gleichzeitig, und was man in der
 * ersten Sekunde sieht, sind zehn Nullen. Das erzeugt den Eindruck „hier
 * passiert viel", trägt aber keine Information — und verzögert genau die
 * Aussage, für die man die Seite geöffnet hat.
 *
 * Dazu kam ein handfester Mangel: Die Animation lief über `useSpring` und hat
 * als einzige Bewegung der App `prefers-reduced-motion` ignoriert. Die
 * CSS-Regel, die alle übrigen Übergänge stilllegt, konnte sie nicht erreichen.
 *
 * Der Name bleibt, damit die Aufrufstellen unverändert weiterlaufen. Ohne
 * Animation braucht es auch kein `"use client"` mehr — die Zahl rendert jetzt
 * serverseitig und steht schon im ersten Frame richtig da.
 */

// Die Animations-Props der Vorfassung (`startValue`, `direction`, `delay`)
// sind entfallen: Es gibt keine Aufrufstelle, die sie gesetzt hat, und als
// stille No-ops haetten sie nur vorgetaeuscht, dass sich hier noch etwas
// steuern laesst.
interface NumberTickerProps extends ComponentPropsWithoutRef<"span"> {
  value: number;
  decimalPlaces?: number;
}

export function NumberTicker({
  value,
  className,
  decimalPlaces = 0,
  ...props
}: NumberTickerProps) {
  const text = Intl.NumberFormat("de-DE", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  }).format(value);

  return (
    <span className={cn("inline-block tabular-nums", className)} {...props}>
      {text}
    </span>
  );
}
