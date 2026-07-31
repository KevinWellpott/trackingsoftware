"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRightLeft, UserPlus } from "lucide-react";
import {
  moveUser,
  previewMoveUser,
  type MovableUser,
  type MovePreview,
} from "@/app/actions/platform";
import { Button } from "@/components/ui/Button";

// Nutzer zwischen Organisationen verschieben — immer zweistufig: erst Vorschau
// (reine Leseoperation), dann Bestaetigung. Der Umzug beruehrt bis zu 14
// Tabellen; ihn ohne Vorschau auszuloesen waere ein Blindflug.
//
// Zwei Richtungen, weil man je nach Situation anders denkt:
//   MoveUserButton  — "schieb DIESE Person woandershin" (auf der Mitgliederzeile)
//   PullUserPanel   — "hol jemanden HIERHER" (unten auf der Zielorganisation)
// Beide nutzen dieselbe Vorschau und dieselben Server-Actions.

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

function PreviewPanel({
  preview,
  isPending,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  preview: MovePreview;
  isPending: boolean;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const nothingToMove = Object.values(preview.counts).every((n) => n === 0);

  return (
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

      {nothingToMove ? (
        <p style={{ margin: 0, fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
          Es werden keine Daten verschoben — nur die Mitgliedschaft wechselt.
        </p>
      ) : (
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
        <Button type="button" variant="danger" size="sm" onClick={onConfirm} disabled={isPending}>
          {isPending ? "Verschiebe …" : confirmLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
          Abbrechen
        </Button>
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
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
      {message}
    </div>
  );
}

/** Richtung „weg von hier" — sitzt auf der Mitgliederzeile. */
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
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const [preview, setPreview] = useState<MovePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (targets.length === 0) return null;

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <ArrowRightLeft size={13} /> Verschieben
      </Button>
    );
  }

  return (
    <div style={{ flexBasis: "100%", display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
          {username} verschieben nach
        </span>
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
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await previewMoveUser(userId, targetId);
              if (res.error) setError(res.error);
              else setPreview(res.preview ?? null);
            });
          }}
        >
          Vorschau
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => {
            setOpen(false);
            setPreview(null);
            setError(null);
          }}
        >
          Schließen
        </Button>
      </div>

      {error && <ErrorBox message={error} />}

      {preview && (
        <PreviewPanel
          preview={preview}
          isPending={isPending}
          confirmLabel="Jetzt verschieben"
          onCancel={() => setPreview(null)}
          onConfirm={() => {
            setError(null);
            startTransition(async () => {
              const res = await moveUser(userId, targetId, preview.counts);
              if (res.error) {
                setError(res.error);
              } else {
                setPreview(null);
                setOpen(false);
                router.refresh();
              }
            });
          }}
        />
      )}
    </div>
  );
}

/** Richtung „hierher holen" — sitzt unten auf der Zielorganisation. */
export function PullUserPanel({
  workspaceId,
  workspaceName,
  candidates,
}: {
  workspaceId: string;
  workspaceName: string;
  candidates: MovableUser[];
}) {
  const router = useRouter();
  const [userId, setUserId] = useState(candidates[0]?.user_id ?? "");
  const [preview, setPreview] = useState<MovePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (candidates.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-subtle)" }}>
        Es gibt keine Nutzer in anderen Organisationen, die du hierher holen könntest.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
      <div style={{ display: "flex", gap: "var(--sp-5)", alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <label
            htmlFor="pull-user"
            style={{
              display: "block",
              fontSize: "var(--fs-xs)",
              fontWeight: 500,
              color: "var(--text-secondary)",
              marginBottom: "var(--sp-3)",
            }}
          >
            Nutzer
          </label>
          <select
            id="pull-user"
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
              setPreview(null);
            }}
            className="ui-input"
            style={{ width: "100%" }}
          >
            {candidates.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.username} — aktuell in {u.current_workspace}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await previewMoveUser(userId, workspaceId);
              if (res.error) setError(res.error);
              else setPreview(res.preview ?? null);
            });
          }}
        >
          <ArrowRightLeft size={13} /> Vorschau
        </Button>
      </div>

      {error && <ErrorBox message={error} />}

      {preview && (
        <PreviewPanel
          preview={preview}
          isPending={isPending}
          confirmLabel={`Jetzt nach ${workspaceName} verschieben`}
          onCancel={() => setPreview(null)}
          onConfirm={() => {
            setError(null);
            startTransition(async () => {
              const res = await moveUser(userId, workspaceId, preview.counts);
              if (res.error) {
                setError(res.error);
              } else {
                setPreview(null);
                router.refresh();
              }
            });
          }}
        />
      )}

      <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-subtle)", display: "flex", gap: "var(--sp-3)", alignItems: "flex-start" }}>
        <UserPlus size={13} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          Die Person wechselt mitsamt ihren Listen, Kontakten, Leads und Terminen
          hierher. Ihr Login bleibt unverändert — sie sieht nach dem nächsten
          Aufruf einfach diese Organisation.
        </span>
      </p>
    </div>
  );
}
