"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowRightLeft, Trash2 } from "lucide-react";
import {
  deleteOrganization,
  previewDeleteOrganization,
  type DeletePreview,
} from "@/app/actions/platform";
import { Button, IconButton, type ButtonSize } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

// Organisation loeschen — die destruktivste Aktion der App. An `workspaces`
// haengen 15 Fremdschluessel mit `on delete cascade`; es geht der komplette
// Datenbestand mit, und es gibt kein Undo.
//
// Deshalb drei Stufen: Dialog oeffnen -> Vorschau, was verschwindet -> Namen
// abtippen. Die Datenbank verweigert zusaetzlich, solange noch Mitglieder da
// sind (Migration 0027, Sicherung 1) — der Dialog sagt das vorher und bietet
// den Weg zum Verschieben gleich mit an, statt den Admin in einen rohen
// DB-Fehler laufen zu lassen.
//
// Als Dialog (statt aufklappendem Block), damit derselbe Knopf sowohl in der
// Organisationstabelle auf /admin als auch in der Gefahrenzone der Detailseite
// funktioniert. Zwei Loesch-Wege mit unterschiedlichem Verhalten waeren genau
// bei der gefaehrlichsten Aktion die schlechteste Idee.

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
  membersHref,
  afterDeleteHref,
  size = "md",
  asIcon = false,
}: {
  workspaceId: string;
  workspaceName: string;
  memberCount: number;
  isHome: boolean;
  /** Ziel fuer „Mitglieder verschieben"; ohne Angabe steht die Liste schon auf der Seite. */
  membersHref?: string;
  /** Wohin nach dem Loeschen? Ohne Angabe wird nur die aktuelle Seite neu geladen. */
  afterDeleteHref?: string;
  /**
   * Groesse des Ausloesers. Default `md` (= --h-control) fluchtet mit den
   * uebrigen Controls einer Tabellenzeile; die Gefahrenzone nutzt `lg`, weil
   * dort dieselbe 40px-Pille steht wie in ui/DangerZone.
   */
  size?: ButtonSize;
  /** Ausloeser als Icon statt als beschrifteter Knopf (Tabellenzeilen). */
  asIcon?: boolean;
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

  const blocked = memberCount > 0;

  function close() {
    setOpen(false);
    setPreview(null);
    setConfirmText("");
    setError(null);
  }

  function openDialog() {
    setOpen(true);
    setError(null);
    // Bei blockierter Organisation gar nicht erst laden: die Vorschau waere
    // eine Liste von Daten, die ohnehin nicht geloescht werden koennen.
    if (blocked) return;
    startTransition(async () => {
      const res = await previewDeleteOrganization(workspaceId);
      if (res.error) setError(res.error);
      else setPreview(res.preview ?? null);
    });
  }

  const totalRows = preview ? Object.values(preview.counts).reduce((a, b) => a + b, 0) : 0;
  const confirmed = confirmText.trim() === workspaceName;

  return (
    <>
      {asIcon ? (
        // In der Tabellenzeile traegt das Icon die Aktion: drei beschriftete
        // Knoepfe pro Zeile machten die Spalte breiter als die Daten daneben.
        // Der Dialog danach ist derselbe — die Sicherheitsnetze haengen dort,
        // nicht am Ausloeser.
        <IconButton
          label="Organisation löschen"
          tone="danger"
          icon={<Trash2 size={15} />}
          onClick={openDialog}
        />
      ) : (
        <Button type="button" variant="danger" size={size} onClick={openDialog}>
          <Trash2 size={14} /> Löschen
        </Button>
      )}

      <Modal
        open={open}
        onClose={close}
        title={`„${workspaceName}" löschen?`}
        subtitle={blocked ? undefined : "Unwiderruflich — es gibt kein Undo."}
        width={520}
        closeOnBackdrop={!isPending}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
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

          {blocked ? (
            <>
              <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                Diese Organisation hat noch {memberCount}{" "}
                {memberCount === 1 ? "Mitglied" : "Mitglieder"}. Solange jemand darin
                ist, verweigert die Datenbank das Löschen — sonst blieben verwaiste
                Logins zurück, die sich zwar anmelden können, aber in keiner
                Organisation mehr sind.
              </p>
              <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                Verschiebe die {memberCount === 1 ? "Person" : "Personen"} zuerst in
                eine andere Organisation oder lösche sie. Danach lässt sich die
                Organisation hier entfernen.
              </p>
              {/* Dialog-Fusszeile rechtsbuendig und in Standardgroesse — wie in
                  ui/ConfirmDialog. Die kleinen sm-Knoepfe fielen ausgerechnet im
                  gefaehrlichsten Dialog der App aus der Reihe. */}
              <div style={{ display: "flex", gap: "var(--sp-4)", justifyContent: "flex-end", flexWrap: "wrap" }}>
                {membersHref && (
                  <Link href={membersHref} style={{ textDecoration: "none" }}>
                    <Button type="button" variant="secondary">
                      <ArrowRightLeft size={14} /> Mitglieder verschieben
                    </Button>
                  </Link>
                )}
                <Button type="button" variant="ghost" onClick={close}>
                  Schließen
                </Button>
              </div>
            </>
          ) : (
            <>
              {!preview && !error && (
                <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
                  Bestand wird geprüft …
                </p>
              )}

              {preview && (
                <>
                  {totalRows === 0 ? (
                    <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-secondary)" }}>
                      <strong>{preview.workspace}</strong> ist leer — es gehen keine
                      Daten verloren.
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
                        <AlertTriangle
                          size={14}
                          color="var(--danger-fg)"
                          style={{ flexShrink: 0, marginTop: 2 }}
                        />
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
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                gap: "var(--sp-3)",
                                fontSize: "var(--fs-xs)",
                              }}
                            >
                              <span style={{ color: "var(--text-muted)" }}>
                                {COUNT_LABELS[key] ?? key}
                              </span>
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
                      Zum Bestätigen{" "}
                      <strong style={{ color: "var(--text-primary)" }}>{workspaceName}</strong>{" "}
                      eintippen
                    </label>
                    <input
                      id="confirm-org-name"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      autoComplete="off"
                      className="ui-input"
                      style={{ width: 260, maxWidth: "100%" }}
                    />
                  </div>
                </>
              )}

              <div style={{ display: "flex", gap: "var(--sp-4)", justifyContent: "flex-end", flexWrap: "wrap" }}>
                <Button type="button" variant="ghost" disabled={isPending} onClick={close}>
                  Abbrechen
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={!preview || !confirmed || isPending}
                  onClick={() => {
                    if (!preview) return;
                    setError(null);
                    startTransition(async () => {
                      // Die Zahlen der Vorschau gehen mit: hat sich der Bestand
                      // seither geaendert, bricht die Datenbank ab, statt etwas
                      // anderes zu loeschen als bestaetigt (Migration 0027).
                      const res = await deleteOrganization(workspaceId, preview.counts);
                      if (res.error) {
                        setError(res.error);
                        return;
                      }
                      close();
                      if (afterDeleteHref) router.push(afterDeleteHref);
                      else router.refresh();
                    });
                  }}
                >
                  {isPending ? "Lösche …" : "Endgültig löschen"}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
