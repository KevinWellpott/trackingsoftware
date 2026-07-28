"use client";

import { createListView, updateListView } from "@/app/actions/listViews";
import { DatePicker } from "@/components/ui/DatePicker";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select, type SelectOption } from "@/components/ui/Select";
import { SELECTABLE_CATEGORIES } from "@/lib/categories";
import type { ViewFilters } from "@/lib/listViews";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

// Editor fuer Ordner und Smart Views.
//
// Ein Knoten ohne einen einzigen gesetzten Filter ist ein reiner ORDNER — er
// gruppiert nur. Sobald etwas gefiltert wird, loest er zu einer Kontaktmenge
// auf. Der Nutzer muss das nicht wissen: er setzt Filter oder eben nicht.

export type ViewOption = { id: string; name: string; depth: number };

type TriState = "egal" | "ja" | "nein";

function triFrom(v: boolean | undefined): TriState {
  return v === undefined ? "egal" : v ? "ja" : "nein";
}
function triTo(v: TriState): boolean | undefined {
  return v === "egal" ? undefined : v === "ja";
}

const chip = (active: boolean): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--sp-3)",
  height: 28,
  padding: "0 var(--sp-5)",
  borderRadius: "var(--r-full)",
  fontSize: "var(--fs-sm)",
  fontWeight: 500,
  fontFamily: "inherit",
  cursor: "pointer",
  border: `1px solid ${active ? "var(--border-accent)" : "var(--border-default)"}`,
  background: active ? "var(--accent-muted)" : "var(--surface-1)",
  color: active ? "var(--orange-300)" : "var(--text-muted)",
});

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <div>
        <span className="eyebrow eyebrow-muted">{label}</span>
        {hint && (
          <span style={{ marginLeft: "var(--sp-4)", fontSize: "var(--fs-2xs)", color: "var(--text-subtle)" }}>{hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function TriToggle({ value, onChange }: { value: TriState; onChange: (v: TriState) => void }) {
  return (
    <div style={{ display: "flex", gap: "var(--sp-3)" }}>
      {(["egal", "ja", "nein"] as TriState[]).map((v) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={value === v} style={chip(value === v)}>
          {v === "egal" ? "Egal" : v === "ja" ? "Ja" : "Nein"}
        </button>
      ))}
    </div>
  );
}

export function ViewEditorModal({
  open,
  onClose,
  lists,
  parents,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  lists: { id: string; name: string }[];
  /** Waehlbare Elternknoten (bereits um sich selbst und Nachfahren bereinigt). */
  parents: ViewOption[];
  /** Gesetzt = Bearbeiten, sonst Anlegen. */
  initial?: { id: string; name: string; parentId: string | null; filters: ViewFilters | null };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const f = initial?.filters ?? null;
  const [name, setName] = useState(initial?.name ?? "");
  const [parentId, setParentId] = useState(initial?.parentId ?? "");
  const [listIds, setListIds] = useState<string[]>(f?.listIds ?? []);
  const [categories, setCategories] = useState<string[]>(f?.categories ?? []);
  const [fuStages, setFuStages] = useState<number[]>(f?.fuStages ?? []);
  const [dueOnly, setDueOnly] = useState(f?.dueOnly ?? false);
  const [answered, setAnswered] = useState<TriState>(triFrom(f?.answered));
  const [appointmentSet, setAppointmentSet] = useState<TriState>(triFrom(f?.appointmentSet));
  const [blocked, setBlocked] = useState<TriState>(triFrom(f?.blocked));
  const [pitchedFrom, setPitchedFrom] = useState(f?.pitchedFrom ?? "");
  const [pitchedTo, setPitchedTo] = useState(f?.pitchedTo ?? "");

  function toggle<T>(arr: T[], v: T, set: (n: T[]) => void) {
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  }

  function collect(): ViewFilters | null {
    const out: ViewFilters = {};
    if (listIds.length) out.listIds = listIds;
    if (categories.length) out.categories = categories;
    if (fuStages.length) out.fuStages = fuStages;
    if (dueOnly) out.dueOnly = true;
    if (triTo(answered) !== undefined) out.answered = triTo(answered);
    if (triTo(appointmentSet) !== undefined) out.appointmentSet = triTo(appointmentSet);
    if (triTo(blocked) !== undefined) out.blocked = triTo(blocked);
    if (pitchedFrom) out.pitchedFrom = pitchedFrom;
    if (pitchedTo) out.pitchedTo = pitchedTo;
    // Nichts gesetzt = reiner Ordner.
    return Object.keys(out).length ? out : null;
  }

  function submit() {
    if (!name.trim()) {
      setError("Bitte einen Namen angeben.");
      return;
    }
    setError(null);
    const payload = { name: name.trim(), parentId: parentId || null, filters: collect() };
    startTransition(async () => {
      const res = initial ? await updateListView(initial.id, payload) : await createListView(payload);
      if (res.error) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
      if (!initial && "viewId" in res && res.viewId) router.push(`/ansicht/${res.viewId}`);
    });
  }

  const parentOptions: SelectOption[] = [
    { value: "", label: "— Oberste Ebene —", color: "var(--text-muted)" },
    // Einrueckung macht die Hierarchie im flachen Dropdown sichtbar.
    ...parents.map((p) => ({ value: p.id, label: `${"  ".repeat(p.depth)}${p.name}` })),
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? "Ansicht bearbeiten" : "Neue Ansicht"}
      subtitle="Ohne Filter entsteht ein reiner Ordner zum Gruppieren."
      width={560}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-7)" }}>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Neues Offer" autoFocus />
        </Field>

        <Field label="Liegt in">
          <Select value={parentId} onChange={setParentId} options={parentOptions} ariaLabel="Übergeordneter Ordner" />
        </Field>

        <div style={{ height: 1, background: "var(--border-default)" }} />

        <Field label="Listen" hint="leer = alle">
          <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
            {lists.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => toggle(listIds, l.id, setListIds)}
                aria-pressed={listIds.includes(l.id)}
                style={chip(listIds.includes(l.id))}
              >
                {l.name}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Kategorie" hint="leer = alle">
          <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
            {SELECTABLE_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggle(categories, c as string, setCategories)}
                aria-pressed={categories.includes(c)}
                style={chip(categories.includes(c))}
              >
                {c}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Follow-up-Stufe" hint="zuletzt gesendet">
          <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
            {[0, 1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => toggle(fuStages, n, setFuStages)}
                aria-pressed={fuStages.includes(n)}
                style={chip(fuStages.includes(n))}
              >
                {n === 0 ? "Kein FU" : `FU${n}`}
              </button>
            ))}
            <button type="button" onClick={() => setDueOnly(!dueOnly)} aria-pressed={dueOnly} style={chip(dueOnly)}>
              Nur fällige
            </button>
          </div>
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "var(--sp-6)" }}>
          <Field label="Geantwortet">
            <TriToggle value={answered} onChange={setAnswered} />
          </Field>
          <Field label="Termin">
            <TriToggle value={appointmentSet} onChange={setAppointmentSet} />
          </Field>
          <Field label="Blockiert">
            <TriToggle value={blocked} onChange={setBlocked} />
          </Field>
        </div>

        <Field label="Pitch-Datum" hint="optional">
          <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "center" }}>
            <DatePicker
              variant="input"
              value={pitchedFrom || null}
              onChange={(v) => setPitchedFrom(v ?? "")}
              clearable
              placeholder="Von"
            />
            <span style={{ color: "var(--text-muted)" }}>–</span>
            <DatePicker
              variant="input"
              value={pitchedTo || null}
              onChange={(v) => setPitchedTo(v ?? "")}
              clearable
              placeholder="Bis"
            />
          </div>
        </Field>

        {error && (
          <div
            style={{
              background: "var(--color-error-bg)",
              border: "1px solid var(--color-error-border)",
              color: "var(--color-error-text)",
              borderRadius: "var(--radius-sm)",
              padding: "0.5rem 0.75rem",
              fontSize: "0.75rem",
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: "var(--sp-4)" }}>
          <button type="button" className="btn-primary" onClick={submit} disabled={isPending}>
            {initial ? "Speichern" : "Anlegen"}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={isPending}>
            Abbrechen
          </button>
        </div>
      </div>
    </Modal>
  );
}
