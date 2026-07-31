"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRightLeft } from "lucide-react";
import { moveUser, previewMoveUser, type MovePreview } from "@/app/actions/platform";
import { Button } from "@/components/ui/Button";

// Nutzer in eine andere Organisation verschieben — immer zweistufig:
// erst Vorschau (reine Leseoperation), dann Bestaetigung. Der Umzug beruehrt
// bis zu 14 Tabellen; ihn ohne Vorschau auszuloesen waere ein Blindflug.

const COUNT_LABELS: Record<string, string> = {
  lists: "LinkedIn-Listen",
  contacts: "Kontakte",
  list_views: "Smart Views",
  phone_lists: "Telefonlisten",
  phone_leads: "Telefon-Leads",
  csv_imports: "CSV-Importe",
  setting_calls: "Setting-Termine",
  closing_calls: "Closing-Termine",
  organic_lists: "Organic-Listen",
  organic_posts: "Organic-Posts",
  performance_targets: "Ziele",
  followup_templates: "FU-Vorlagen",
};

export function MoveUserButton({
  userId,
  username,
  targets,
}: {
  userId: string;
  username: string;
  targets: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const [preview, setPreview] = useState<MovePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (targets.length === 0) {
    return (
      <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>
        Keine andere Organisation vorhanden
      </span>
    );
  }

  function handlePreview() {
    setError(null);
    startTransition(async () => {
      const res = await previewMoveUser(userId, targetId);
      if (res.error) setError(res.error);
      else setPreview(res.preview ?? null);
    });
  }

  function handleConfirm() {
    if (!preview) return;
    setError(null);
    startTransition(async () => {
      const res = await moveUser(userId, targetId, preview.counts);
      if (res.error) {
        setError(res.error);
      } else {
        setPreview(null);
        router.refresh();
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={targetId}
          onChange={(e) => {
            setTargetId(e.target.value);
            setPreview(null);
          }}
          aria-label={`Zielorganisation für ${username}`}
          className="ui-input"
          style={{ width: 200 }}
        >
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <Button type="button" variant="secondary" size="sm" onClick={handlePreview} disabled={isPending}>
          <ArrowRightLeft size={13} /> Vorschau
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            background: "var(--danger-bg)",
            borderLeft: "2px solid var(--danger)",
            borderRadius: "var(--r-sm)",
            padding: "var(--sp-4) var(--sp-5)",
            fontSize: "var(--fs-xs)",
            color: "var(--danger-fg)",
          }}
        >
          {error}
        </div>
      )}

      {preview && (
        <div
          style={{
            border: "1px solid var(--border-default)",
            borderRadius: "var(--r-md)",
            padding: "var(--sp-6)",
            background: "var(--surface-1)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--sp-5)",
          }}
        >
          <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-primary)" }}>
            <strong>{preview.username}</strong> zieht von{" "}
            <strong>{preview.source_workspace}</strong> nach{" "}
            <strong>{preview.target_workspace}</strong>.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
              gap: "var(--sp-3) var(--sp-5)",
            }}
          >
            {Object.entries(preview.counts)
              .filter(([, n]) => n > 0)
              .map(([key, n]) => (
                <div key={key} style={{ display: "flex", justifyContent: "space-between", gap: "var(--sp-3)", fontSize: "var(--fs-xs)" }}>
                  <span style={{ color: "var(--text-muted)" }}>{COUNT_LABELS[key] ?? key}</span>
                  <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{n}</span>
                </div>
              ))}
          </div>

          {Object.values(preview.counts).every((n) => n === 0) && (
            <p style={{ margin: 0, fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
              Es werden keine Daten verschoben — nur die Mitgliedschaft wechselt.
            </p>
          )}

          {preview.warnings.length > 0 && (
            <div
              style={{
                background: "var(--warning-bg)",
                borderLeft: "2px solid var(--warning)",
                borderRadius: "var(--r-sm)",
                padding: "var(--sp-4) var(--sp-5)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--sp-3)",
              }}
            >
              {preview.warnings.map((w) => (
                <div key={w.code} style={{ display: "flex", gap: "var(--sp-3)", alignItems: "flex-start" }}>
                  <AlertTriangle size={13} color="var(--warning-fg)" style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: "var(--fs-xs)", color: "var(--warning-fg)" }}>{w.text}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: "var(--sp-4)" }}>
            <Button type="button" variant="danger" size="sm" onClick={handleConfirm} disabled={isPending}>
              {isPending ? "Verschiebe …" : "Jetzt verschieben"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPreview(null)} disabled={isPending}>
              Abbrechen
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
