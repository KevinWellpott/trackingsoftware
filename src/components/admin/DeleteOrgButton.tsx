"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
import {
  deleteOrganization,
  previewDeleteOrganization,
  type DeletePreview,
} from "@/app/actions/platform";
import { Button } from "@/components/ui/Button";

// Organisation loeschen — die destruktivste Aktion der App. An `workspaces`
// haengen 14 Fremdschluessel mit `on delete cascade`; es geht der komplette
// Datenbestand mit, und es gibt kein Undo.
//
// Deshalb drei Stufen: aufklappen -> Vorschau, was verschwindet -> Namen
// abtippen. Die Datenbank verweigert zusaetzlich, solange noch Mitglieder da
// sind (Migration 0027) — die UI sagt das aber vorher, statt den Nutzer in
// einen Fehler laufen zu lassen.

const COUNT_LABELS: Record<string, string> = {
  lists: "LinkedIn-Listen",
  contacts: "Kontakte",
  list_views: "Smart Views",
  phone_lists: "Telefonlisten",
  phone_leads: "Telefon-Leads",
  csv_imports: "CSV-Importe",
  setting_calls: "Setting-Termine",
  closing_calls: "Closing-Termine",
  call_assignees: "Zuweisungen",
  organic_lists: "Organic-Listen",
  organic_posts: "Organic-Posts",
  performance_targets: "Ziele",
  followup_templates: "FU-Vorlagen",
};

export function DeleteOrgButton({
  workspaceId,
  workspaceName,
  memberCount,
  isHome,
}: {
  workspaceId: string;
  workspaceName: string;
  memberCount: number;
  isHome: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (isHome) {
    return (
      <p style={{ margin: 0, fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>
        Die eigene Organisation kann nicht gelöscht werden.
      </p>
    );
  }

  if (memberCount > 0) {
    return (
      <p style={{ margin: 0, fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>
        Diese Organisation hat noch {memberCount}{" "}
        {memberCount === 1 ? "Mitglied" : "Mitglieder"}. Verschiebe oder lösche sie
        zuerst — danach lässt sich die Organisation löschen.
      </p>
    );
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="danger"
        size="sm"
        onClick={() => {
          setOpen(true);
          setError(null);
          startTransition(async () => {
            const res = await previewDeleteOrganization(workspaceId);
            if (res.error) setError(res.error);
            else setPreview(res.preview ?? null);
          });
        }}
      >
        <Trash2 size={13} /> Organisation löschen
      </Button>
    );
  }

  const totalRows = preview
    ? Object.values(preview.counts).reduce((a, b) => a + b, 0)
    : 0;
  const confirmed = confirmText.trim() === workspaceName;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
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
        <>
          {totalRows === 0 ? (
            <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-secondary)" }}>
              <strong>{preview.workspace}</strong> ist leer — es gehen keine Daten
              verloren.
            </p>
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  gap: "var(--sp-4)",
                  alignItems: "flex-start",
                  background: "var(--danger-bg)",
                  borderLeft: "2px solid var(--danger)",
                  borderRadius: "var(--r-sm)",
                  padding: "var(--sp-4) var(--sp-5)",
                }}
              >
                <AlertTriangle size={14} color="var(--danger-fg)" style={{ flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: "var(--fs-xs)", color: "var(--danger-fg)" }}>
                  Diese Daten werden unwiderruflich gelöscht. Es gibt kein Undo.
                </span>
              </div>
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
                    <div
                      key={key}
                      style={{ display: "flex", justifyContent: "space-between", gap: "var(--sp-3)", fontSize: "var(--fs-xs)" }}
                    >
                      <span style={{ color: "var(--text-muted)" }}>{COUNT_LABELS[key] ?? key}</span>
                      <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{n}</span>
                    </div>
                  ))}
              </div>
            </>
          )}

          <div>
            <label
              htmlFor="confirm-org-name"
              style={{
                display: "block",
                fontSize: "var(--fs-xs)",
                fontWeight: 500,
                color: "var(--text-secondary)",
                marginBottom: "var(--sp-3)",
              }}
            >
              Zum Bestätigen <strong style={{ color: "var(--text-primary)" }}>{workspaceName}</strong> eintippen
            </label>
            <input
              id="confirm-org-name"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              className="ui-input"
              style={{ width: 260 }}
            />
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: "var(--sp-4)" }}>
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={!preview || !confirmed || isPending}
          onClick={() => {
            if (!preview) return;
            setError(null);
            startTransition(async () => {
              const res = await deleteOrganization(workspaceId, preview.counts);
              if (res.error) setError(res.error);
              else router.push("/admin");
            });
          }}
        >
          {isPending ? "Lösche …" : "Endgültig löschen"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => {
            setOpen(false);
            setPreview(null);
            setConfirmText("");
            setError(null);
          }}
        >
          Abbrechen
        </Button>
      </div>
    </div>
  );
}
