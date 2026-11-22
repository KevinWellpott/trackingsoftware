"use client";

import { cloneElement, isValidElement, useId, type ComponentProps, type ReactElement } from "react";
import { Field } from "@/components/ui/Input";

// `Field` setzt sein Label neben das Eingabefeld, verbindet es aber nur mit
// einer von Hand vergebenen ID. Hier bekommt das Feld sie von selbst: Der
// Screenreader liest den Namen, ein Tipp aufs Label trifft das Feld.

export function Feld({ children, htmlFor, ...rest }: ComponentProps<typeof Field>) {
  const auto = useId();
  // Nur Komponenten (Input, Textarea, Select, DatePicker); ein Wrapper-div ist kein Ziel.
  if (htmlFor || !isValidElement(children) || typeof children.type === "string") {
    return (
      <Field htmlFor={htmlFor} {...rest}>
        {children}
      </Field>
    );
  }
  const feld = children as ReactElement<{ id?: string }>;
  const id = feld.props.id ?? auto;
  return (
    <Field htmlFor={id} {...rest}>
      {cloneElement(feld, { id })}
    </Field>
  );
}
