"use client";

import { useState } from "react";
import { ArrowRightLeft, Pencil } from "lucide-react";
import { renameOrganizationForm, setActiveOrgForm } from "@/app/actions/platform";
import { Button, IconButton } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { DeleteOrgButton } from "@/components/admin/DeleteOrgButton";

/**
 * Zeilen-Aktionen der Organisationstabelle als eingeblendete Icons.
 *
 * Vorher standen hier drei beschriftete Knoepfe UND ein dauerhaft sichtbares
 * Namensfeld in jeder Zeile. Die Aktionsspalte war damit breiter als die Daten,
 * die sie begleitet, und das Wichtigste einer Tabelle — der Vergleich der
 * Zeilen untereinander — ging zwischen Bedienelementen unter.
 *
 * Jetzt: Icons, die beim Ueberfahren der Zeile erscheinen (`.row-actions` in
 * globals.css). Das Umbenennen liegt im Dialog statt inline — ein Textfeld pro
 * Zeile ist ein Formular, das man nie ausfuellen will, und es zwang die Zeile
 * auf die Hoehe eines Eingabefelds.
 *
 * Barrierefreiheit: Die Icons sind nur optisch ausgeblendet, nie aus dem
 * Fokus-Fluss. `:focus-within` blendet sie beim Tabben ein, und auf Geraeten
 * ohne Hover stehen sie dauerhaft — ohne das waeren sie auf Touch unerreichbar.
 */
export function OrgRowActions({
  workspaceId,
  workspaceName,
  memberCount,
  isActive,
  isHome,
  membersHref,
}: {
  workspaceId: string;
  workspaceName: string;
  memberCount: number;
  /** Die gerade aktive Organisation — dorthin kann man nicht wechseln. */
  isActive: boolean;
  /** Die eigene Organisation — sie ist grundsaetzlich nicht loeschbar. */
  isHome: boolean;
  membersHref: string;
}) {
  const [renaming, setRenaming] = useState(false);

  return (
    <div
      className="row-actions"
      style={{ display: "flex", gap: "var(--sp-2)", justifyContent: "flex-end", alignItems: "center" }}
    >
      <IconButton
        label={`„${workspaceName}" umbenennen`}
        icon={<Pencil size={15} />}
        onClick={() => setRenaming(true)}
      />

      {!isActive && (
        <form action={setActiveOrgForm}>
          <input type="hidden" name="workspace_id" value={workspaceId} />
          <IconButton
            type="submit"
            label={`Zu „${workspaceName}" wechseln`}
            tone="accent"
            icon={<ArrowRightLeft size={15} />}
          />
        </form>
      )}

      {/* Loeschen behaelt seinen dreistufigen Dialog samt Vorschau und
          Namensabgleich — nur der Ausloeser ist ein Icon. Die eigene
          Organisation zeigt gar keinen Knopf. */}
      {!isHome && (
        <DeleteOrgButton
          asIcon
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          memberCount={memberCount}
          isHome={false}
          membersHref={membersHref}
        />
      )}

      <Modal
        open={renaming}
        onClose={() => setRenaming(false)}
        title={`„${workspaceName}" umbenennen`}
        subtitle="Der Name erscheint im Organisations-Umschalter und in allen Übersichten."
        width={420}
      >
        <form
          action={renameOrganizationForm}
          style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}
        >
          <input type="hidden" name="workspace_id" value={workspaceId} />
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
            <label
              htmlFor={`org-name-${workspaceId}`}
              className="eyebrow eyebrow-muted"
            >
              Name
            </label>
            <input
              id={`org-name-${workspaceId}`}
              name="name"
              defaultValue={workspaceName}
              className="ui-input"
              autoFocus
              required
            />
          </div>
          <div style={{ display: "flex", gap: "var(--sp-4)", justifyContent: "flex-end", flexWrap: "wrap" }}>
            <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>
              Abbrechen
            </Button>
            <Button type="submit" variant="primary">
              Speichern
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
