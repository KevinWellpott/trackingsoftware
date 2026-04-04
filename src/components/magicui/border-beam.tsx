"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";

interface BorderBeamProps {
  size?: number;
  duration?: number;
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
  className?: string;
  style?: React.CSSProperties;
  reverse?: boolean;
  initialOffset?: number;
  borderWidth?: number;
}

export const BorderBeam = ({
  className,
  size = 50,
  delay = 0,
  duration = 6,
  colorFrom = "#6366f1",
  colorTo = "#8b5cf6",
  style,
  reverse = false,
  initialOffset = 0,
  borderWidth = 1.5,
}: BorderBeamProps) => {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: "inherit",
        pointerEvents: "none",
        overflow: "hidden",
        border: `${borderWidth}px solid transparent`,
        ...style,
      }}
    >
      <motion.div
        className={cn("absolute aspect-square", className)}
        style={{
          width: size,
          offsetPath: `rect(0 auto auto 0 round ${borderWidth}px)`,
          background: `linear-gradient(to right, ${colorFrom}, ${colorTo})`,
          borderRadius: "inherit",
          filter: "blur(2px)",
          opacity: 0.8,
        }}
        initial={{ offsetDistance: `${initialOffset}%` }}
        animate={{ offsetDistance: reverse ? ["100%", "0%"] : ["0%", "100%"] }}
        transition={{
          duration,
          delay,
          ease: "linear",
          repeat: Infinity,
        }}
      />
    </div>
  );
};
