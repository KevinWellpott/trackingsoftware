"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { motion, useMotionTemplate, useMotionValue } from "motion/react";
import { cn } from "@/lib/utils";

interface MagicCardProps {
  children?: React.ReactNode;
  className?: string;
  gradientSize?: number;
  gradientColor?: string;
  gradientOpacity?: number;
  style?: React.CSSProperties;
}

export function MagicCard({
  children,
  className,
  gradientSize = 240,
  gradientColor = "#6366f120",
  style,
}: MagicCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(-gradientSize);
  const mouseY = useMotionValue(-gradientSize);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const rect = e.currentTarget.getBoundingClientRect();
      mouseX.set(e.clientX - rect.left);
      mouseY.set(e.clientY - rect.top);
    },
    [mouseX, mouseY],
  );

  const reset = useCallback(() => {
    mouseX.set(-gradientSize);
    mouseY.set(-gradientSize);
  }, [mouseX, mouseY, gradientSize]);

  useEffect(() => {
    reset();
  }, [reset]);

  const background = useMotionTemplate`radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px, ${gradientColor}, transparent 80%)`;

  return (
    <div
      ref={cardRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={reset}
      className={cn("relative overflow-hidden", className)}
      style={style}
    >
      <motion.div
        style={{ background, position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0, borderRadius: "inherit" }}
      />
      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
    </div>
  );
}
