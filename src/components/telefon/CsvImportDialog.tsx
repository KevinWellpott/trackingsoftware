"use client";

import { importPhoneCsv } from "@/app/actions/phone";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { FileUp, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

// CSV-Import (Google-Maps-Export) für Telefonlisten: Datei hochladen,
// optionaler Listenname, Branche. Nur Firma/Telefon/Website werden gemappt.
// Import ist immer personenbezogen: Nicht-Admins importieren als sie selbst,
// nur Admins mit mehreren Nutzern können den Inhaber wählen.
//
// Die Branche ist der Moment, an dem sie überhaupt bekannt ist: Wer eine Liste
// scrapt, weiß, wonach er gesucht hat — hinterher steht sie in keiner Zeile
// mehr. Ohne dieses Feld bleibt die Auswertung „welche Branche konvertiert"
// für immer leer, weil niemand 400 Leads einzeln nachpflegt.

type UserOption = { user_id: string; username: string };

type ImportResult = {
  imported: number;
  duplicates: number;
  total: number;
  listId?: string;
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-muted)",
  marginBottom: "0.375rem",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--surface-50)",
  border: "1px solid var(--border-bright)",
  borderRadius: "var(--radius-sm)",
  padding: "0.5rem 0.75rem",
  fontSize: "0.875rem",
  color: "var(--text-primary)",
  outline: "none",
};

export function CsvImportDialog({
  users,
  me,
  isAdmin,
  targetGroups = [],
  scriptLabels = [],
}: {
  users: UserOption[];
  me: UserOption;
  isAdmin: boolean;
  /**
   * Bereits vergebene Branchen als Vorschlagsliste. Das ist der Anti-Chaos-
   * Mechanismus: Ohne sichtbare Vorschläge entstehen „Handwerk", „handwerker"
   * und „Handwerks-Betriebe" als drei Gruppen, und die Auswertung zerfällt.
   */
  targetGroups?: string[];
  /** Bereits vergebene Skript-Testarme — gleiche Anti-Chaos-Logik wie oben. */
  scriptLabels?: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Owner-Auswahl nur für Admins mit mehreren Nutzern — sonst immer "ich selbst".
  const showOwnerSelect = isAdmin && users.length > 1;
  const [ownerUserId, setOwnerUserId] = useState(() =>
    users.some((u) => u.user_id === me.user_id) || !showOwnerSelect ? me.user_id : users[0].user_id,
  );
  const [listName, setListName] = useState("");
  const [targetGroup, setTargetGroup] = useState("");
  const [scriptLabel, setScriptLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setFile(null);
    setListName("");
    setTargetGroup("");
    setScriptLabel("");
    setError(null);
    setResult(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const owner = showOwnerSelect ? users.find((u) => u.user_id === ownerUserId) : me;
    if (!owner) {
      setError("Bitte einen Inhaber auswählen.");
      return;
    }
    if (!file) {
      setError("Bitte eine CSV-Datei auswählen.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("owner_name", owner.username);
    fd.set("owner_user_id", owner.user_id);
    if (listName.trim()) fd.set("list_name", listName.trim());
    if (targetGroup.trim()) fd.set("target_group", targetGroup.trim());
    if (scriptLabel.trim()) fd.set("script_label", scriptLabel.trim());

    startTransition(async () => {
      const res = await importPhoneCsv(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setResult({
        imported: res.imported ?? 0,
        duplicates: res.duplicates ?? 0,
        total: res.total ?? 0,
        listId: res.listId,
      });
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.4rem",
          background: "var(--grad-cta)",
          color: "var(--text-on-accent)",
          boxShadow: "var(--shadow-btn-primary)",
          border: "none",
          borderRadius: "var(--r-full)",
          padding: "0.5rem 0.875rem",
          fontSize: "0.8125rem",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        <Upload size={14} /> CSV importieren
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Telefonliste importieren"
        subtitle="Google-Maps-CSV → neue Akquise-Liste"
        width={460}
      >
        {result ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
            <div
              style={{
                background: "var(--color-success-bg)",
                border: "1px solid var(--color-success-border)",
                borderRadius: "var(--radius-md)",
                padding: "0.875rem 1rem",
                color: "var(--color-success-text)",
                fontSize: "0.875rem",
                fontWeight: 600,
                lineHeight: 1.5,
              }}
            >
              {result.imported} importiert, {result.duplicates} Duplikate übersprungen (von {result.total} Zeilen)
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {result.listId && (
                <Link
                  href={`/telefon/${result.listId}`}
                  onClick={() => setOpen(false)}
                  style={{
                    flex: 1,
                    textAlign: "center",
                    background: "var(--grad-cta)",
                    color: "var(--text-on-accent)",
                    boxShadow: "var(--shadow-btn-primary)",
                    borderRadius: "var(--r-full)",
                    padding: "0.5rem 0.875rem",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  Zur Liste →
                </Link>
              )}
              <button
                type="button"
                onClick={reset}
                style={{
                  background: "var(--surface-150)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--r-full)",
                  padding: "0.5rem 0.875rem",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Weitere importieren
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {showOwnerSelect ? (
              <div>
                <label htmlFor="csv-owner" style={labelStyle}>
                  Inhaber
                </label>
                <Select
                  id="csv-owner"
                  value={ownerUserId}
                  onChange={setOwnerUserId}
                  ariaLabel="Inhaber"
                  options={users.map((u) => ({ value: u.user_id, label: u.username }))}
                />
              </div>
            ) : (
              <div>
                <span style={labelStyle}>Inhaber</span>
                <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-primary)" }}>
                  Import als: {me.username}
                </div>
              </div>
            )}

            <div>
              <label htmlFor="csv-file" style={labelStyle}>
                CSV-Datei
              </label>
              <input
                id="csv-file"
                type="file"
                accept=".csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                style={{ ...inputStyle, padding: "0.4rem 0.5rem", cursor: "pointer" }}
              />
            </div>

            <div>
              <label htmlFor="csv-list-name" style={labelStyle}>
                Listenname (optional)
              </label>
              <input
                id="csv-list-name"
                type="text"
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                placeholder="Standard: Dateiname"
                style={inputStyle}
              />
            </div>

            <div>
              <label htmlFor="csv-target-group" style={labelStyle}>
                Branche / Zielgruppe
              </label>
              {/* Freitext MIT Vorschlagsliste statt Dropdown: Ein geschlossenes
                  Set müsste jede neue Branche als Migration nachziehen, ein
                  reines Freitextfeld erzeugt fünf Schreibweisen. `list` gibt
                  beides — tippen erlaubt, Bestehendes steht zur Auswahl. */}
              <input
                id="csv-target-group"
                type="text"
                list="csv-target-group-options"
                value={targetGroup}
                onChange={(e) => setTargetGroup(e.target.value)}
                placeholder="z. B. Webdesigner, Handwerk"
                style={inputStyle}
              />
              <datalist id="csv-target-group-options">
                {targetGroups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
              <p style={{ margin: "0.375rem 0 0", fontSize: "0.6875rem", color: "var(--text-subtle)", lineHeight: 1.5 }}>
                Wird auf alle Leads dieses Imports gestempelt und macht den
                Branchen-Vergleich in der Analyse möglich. Eine CSV-Spalte
                <strong> branche</strong> bzw. <strong>zielgruppe</strong> hat pro Zeile Vorrang.
              </p>
            </div>

            <div>
              <label htmlFor="csv-script-label" style={labelStyle}>
                Testarm des Skripts
              </label>
              {/* Gleiche Begruendung wie bei der Branche: Freitext mit
                  Vorschlagsliste. Wer denselben Arm ein zweites Mal importiert,
                  waehlt ihn hier aus — nur so buendeln sich mehrere Importe zu
                  einem Arm mit tragfaehiger Fallzahl. */}
              <input
                id="csv-script-label"
                type="text"
                list="csv-script-label-options"
                value={scriptLabel}
                onChange={(e) => setScriptLabel(e.target.value)}
                placeholder="z. B. V1, Hard Opener"
                style={inputStyle}
              />
              <datalist id="csv-script-label-options">
                {scriptLabels.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
              <p style={{ margin: "0.375rem 0 0", fontSize: "0.6875rem", color: "var(--text-subtle)", lineHeight: 1.5 }}>
                Wird auf jeden Lead gestempelt und bleibt dort, auch wenn er
                später in &bdquo;Rückruf&ldquo; oder &bdquo;Nicht erreicht&ldquo; wandert.
                Ohne diesen Stempel fielen genau die schlechten Ausgänge aus dem Test.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "flex-start",
                background: "var(--surface-150)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                padding: "0.625rem 0.75rem",
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                lineHeight: 1.5,
              }}
            >
              <FileUp size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                Aus dem (unsortierten) Google-Maps-CSV werden nur <strong>Firma</strong>, <strong>Telefonnummer</strong> und{" "}
                <strong>Website</strong> übernommen. Bereits vorhandene Telefonnummern des Inhabers werden als Duplikate übersprungen.
              </span>
            </div>

            {error && (
              <div
                style={{
                  fontSize: "0.8125rem",
                  color: "var(--color-error-text)",
                  background: "var(--color-error-bg)",
                  border: "1px solid var(--color-error-border)",
                  borderRadius: "var(--radius-sm)",
                  padding: "0.5rem 0.75rem",
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isPending}
              style={{
                background: "var(--grad-cta)",
                color: "var(--text-on-accent)",
                boxShadow: "var(--shadow-btn-primary)",
                border: "none",
                borderRadius: "var(--r-full)",
                padding: "0.5625rem 1.125rem",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: isPending ? "default" : "pointer",
                opacity: isPending ? 0.6 : 1,
              }}
            >
              {isPending ? "Importiere…" : "Importieren"}
            </button>
          </form>
        )}
      </Modal>
    </>
  );
}
