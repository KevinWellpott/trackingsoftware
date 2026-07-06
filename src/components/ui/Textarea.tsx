"use client";

import {
  type TextareaHTMLAttributes,
  useCallback,
  useEffect,
  useRef,
} from "react";

// Token-gestyltes Textarea (.ui-input in globals.css).
// Optional autoGrow: Höhe passt sich dem Inhalt an.

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Höhe wächst automatisch mit dem Inhalt. */
  autoGrow?: boolean;
}

export function Textarea({ autoGrow = false, className, style, onInput, ...rest }: TextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`; // +2 für die Border
  }, []);

  // Bei kontrollierten Textareas auch auf value-Änderungen reagieren.
  useEffect(() => {
    if (autoGrow) resize();
  }, [autoGrow, resize, rest.value]);

  return (
    <textarea
      {...rest}
      ref={ref}
      rows={rest.rows ?? 3}
      onInput={(e) => {
        if (autoGrow) resize();
        onInput?.(e);
      }}
      className={className ? `ui-input ${className}` : "ui-input"}
      style={{
        resize: autoGrow ? "none" : "vertical",
        ...(autoGrow ? { overflow: "hidden" } : null),
        ...style,
      }}
    />
  );
}
