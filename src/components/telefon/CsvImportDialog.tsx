"use client";

import { importPhoneCsv } from "@/app/actions/phone";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { FileUp, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

// CSV-Import für Telefonlisten: Datei hochladen, optionaler Listenname,
// Branche, Testarm. Gemappt werden Firma, Telefon, Website, Ansprechpartner
// und E-Mail (Spaltenkoepfe: src/lib/phone-csv.ts).
// Import ist immer personenbezogen: Wer Mitglied der aktiven Organisation ist,
// importiert als er selbst; Admins koennen einen anderen Inhaber waehlen — und
// MUESSEN es, wenn sie selbst kein Mitglied sind (Plattform-Admin in fremder
// Organisation, siehe resolveListOwner in actions/phone.ts).
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

// Labels und Felder kommen aus dem System (.dialer-label / .input), damit der
// Dialog dieselbe Typografie und dieselben Fokus-Ringe traegt wie der
// Call-Mode dahinter. Vorher definierte er beides selbst — mit anderer
// Schriftgroesse, anderem Radius und anderer Rahmenfarbe als der Rest.
const hintStyle: React.CSSProperties = {
  margin: "var(--sp-3) 0 0",
  fontSize: "var(--fs-2xs)",
  color: "var(--text-muted)",
  lineHeight: "var(--lh-base)",
};

export function CsvImportDialog({
  users,
  me,
  isAdmin,
  orgName,
  isForeignOrg = false,
  targetGroups = [],
  scriptLabels = [],
}: {
  users: UserOption[];
  me: UserOption;
  isAdmin: boolean;
  /** Name der AKTIVEN Organisation — die Liste entsteht dort, nicht „bei mir". */
  orgName: string;
  /** Plattform-Admin in fremder Organisation: dort ist er kein Mitglied. */
  isForeignOrg?: boolean;
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

  // Darf ich die Liste überhaupt selbst besitzen? Nur, wenn ich Mitglied der
  // AKTIVEN Organisation bin. Ein Plattform-Admin ist das in einer Kunden-Org
  // nicht (§2) — sein Name als `owner_name` macht die Liste heimatlos: Sie
  // zählt in keiner Telefon-RPC mit und verschwindet, sobald eine Datensicht
  // aktiv ist. Vorher hing die Auswahl an `users.length > 1`, weshalb genau die
  // Ein-Personen-Organisation (der Regelfall beim Kunden) still auf mich fiel.
  const canOwnSelf = users.some((u) => u.user_id === me.user_id);
  const showOwnerSelect = !canOwnSelf || (isAdmin && users.length > 1);
  const noMembers = users.length === 0;
  const [ownerUserId, setOwnerUserId] = useState(() =>
    canOwnSelf ? me.user_id : (users[0]?.user_id ?? ""),
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
    if (noMembers) {
      setError(`„${orgName}" hat noch kein Mitglied, dem die Liste gehören könnte.`);
      return;
    }
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
      {/* Der eine Primaer-CTA dieser View — deshalb `variant="primary"`
          aus der Button-Familie statt eines nachgebauten Gradienten. */}
      <Button
        variant="primary"
        size="sm"
        icon={<Upload size={14} />}
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        CSV importieren
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Telefonliste importieren"
        subtitle="Google-Maps-CSV → neue Akquise-Liste"
        width={460}
      >
        {result ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
            <div
              style={{
                background: "var(--success-bg)",
                border: "1px solid var(--color-success-border)",
                borderRadius: "var(--r-md)",
                padding: "var(--sp-6) var(--sp-7)",
                color: "var(--success-fg)",
                fontSize: "var(--fs-base)",
                fontWeight: "var(--fw-medium)",
                lineHeight: "var(--lh-base)",
              }}
            >
              <span className="tnum">{result.imported}</span> importiert,{" "}
              <span className="tnum">{result.duplicates}</span> Duplikate übersprungen (von{" "}
              <span className="tnum">{result.total}</span> Zeilen)
            </div>
            <div style={{ display: "flex", gap: "var(--sp-4)" }}>
              {result.listId && (
                <Link
                  href={`/telefon/${result.listId}`}
                  onClick={() => setOpen(false)}
                  className="ui-btn"
                  data-variant="primary"
                  style={{
                    flex: 1,
                    justifyContent: "center",
                    background: "var(--grad-cta)",
                    color: "var(--text-on-accent)",
                    border: "none",
                    textDecoration: "none",
                  }}
                >
                  Zur Liste →
                </Link>
              )}
              <Button variant="secondary" onClick={reset}>
                Weitere importieren
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-7)" }}>
            {/* Ziel-Organisation immer nennen. Der Import legt eine Liste in der
                AKTIVEN Organisation an — steht man in einer fremden, ist das die
                folgenreichste Angabe des ganzen Dialogs und stand bisher nirgends. */}
            <div
              style={{
                fontSize: "var(--fs-xs)",
                lineHeight: "var(--lh-base)",
                color: isForeignOrg ? "var(--danger-fg)" : "var(--text-muted)",
                background: isForeignOrg ? "var(--danger-bg)" : "var(--surface-1)",
                border: `1px solid ${isForeignOrg ? "var(--color-error-border)" : "var(--border-default)"}`,
                borderRadius: "var(--r-sm)",
                padding: "var(--sp-4) var(--sp-6)",
              }}
            >
              Ziel-Organisation: <strong>{orgName}</strong>
              {isForeignOrg && " — fremde Organisation. Die Liste gehört dort einem ihrer Mitglieder, nicht dir."}
            </div>

            {noMembers ? (
              <div>
                <span className="dialer-label">Inhaber</span>
                <div style={{ fontSize: "var(--fs-sm)", color: "var(--danger-fg)", lineHeight: "var(--lh-base)" }}>
                  &bdquo;{orgName}&ldquo; hat noch kein Mitglied. Lege dort zuerst einen Nutzer an — ohne
                  Inhaber wäre die Liste in keiner Auswertung sichtbar.
                </div>
              </div>
            ) : showOwnerSelect ? (
              <div>
                <label htmlFor="csv-owner" className="dialer-label">
                  Inhaber
                </label>
                <Select
                  id="csv-owner"
                  value={ownerUserId}
                  onChange={setOwnerUserId}
                  ariaLabel="Inhaber"
                  options={users.map((u) => ({ value: u.user_id, label: u.username }))}
                />
                {!canOwnSelf && (
                  <p style={hintStyle}>
                    Du bist in dieser Organisation kein Mitglied und kannst dort nichts besitzen. Alle
                    Zahlen dieser Liste zählen bei der gewählten Person.
                  </p>
                )}
              </div>
            ) : (
              <div>
                <span className="dialer-label">Inhaber</span>
                <div style={{ fontSize: "var(--fs-base)", fontWeight: "var(--fw-medium)", color: "var(--text-primary)" }}>
                  Import als: {me.username}
                </div>
              </div>
            )}

            <div>
              <label htmlFor="csv-file" className="dialer-label">
                CSV-Datei
              </label>
              <input
                id="csv-file"
                type="file"
                accept=".csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="input"
                style={{ cursor: "pointer", padding: "var(--sp-3) var(--sp-5)" }}
              />
            </div>

            <div>
              <label htmlFor="csv-list-name" className="dialer-label">
                Listenname (optional)
              </label>
              <input
                id="csv-list-name"
                type="text"
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                placeholder="Standard: Dateiname"
                className="input"
              />
            </div>

            <div>
              <label htmlFor="csv-target-group" className="dialer-label">
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
                className="input"
              />
              <datalist id="csv-target-group-options">
                {targetGroups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
              <p style={hintStyle}>
                Wird auf alle Leads dieses Imports gestempelt und macht den
                Branchen-Vergleich in der Analyse möglich. Eine CSV-Spalte
                <strong> branche</strong> bzw. <strong>zielgruppe</strong> hat pro Zeile Vorrang.
              </p>
            </div>

            <div>
              <label htmlFor="csv-script-label" className="dialer-label">
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
                className="input"
              />
              <datalist id="csv-script-label-options">
                {scriptLabels.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
              <p style={hintStyle}>
                Wird auf jeden Lead gestempelt und bleibt dort, auch wenn er
                später in &bdquo;Rückruf&ldquo; oder &bdquo;Nicht erreicht&ldquo; wandert.
                Ohne diesen Stempel fielen genau die schlechten Ausgänge aus dem Test.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                gap: "var(--sp-4)",
                alignItems: "flex-start",
                background: "var(--surface-1)",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--r-sm)",
                padding: "var(--sp-5) var(--sp-6)",
                fontSize: "var(--fs-xs)",
                color: "var(--text-muted)",
                lineHeight: "var(--lh-base)",
              }}
            >
              <FileUp size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                Übernommen werden <strong>Firma</strong>, <strong>Telefonnummer</strong>, <strong>Website</strong>,{" "}
                <strong>Ansprechpartner</strong> (Spalte &bdquo;GF Name&ldquo; / &bdquo;Ansprechpartner&ldquo;) und{" "}
                <strong>E-Mail</strong>.
                Bereits vorhandene Telefonnummern des Inhabers werden als Duplikate übersprungen.
              </span>
            </div>

            {error && (
              <div
                style={{
                  fontSize: "var(--fs-sm)",
                  color: "var(--danger-fg)",
                  background: "var(--danger-bg)",
                  border: "1px solid var(--color-error-border)",
                  borderRadius: "var(--r-sm)",
                  padding: "var(--sp-4) var(--sp-6)",
                  lineHeight: "var(--lh-base)",
                }}
              >
                {error}
              </div>
            )}

            <Button type="submit" variant="primary" disabled={noMembers} loading={isPending}>
              Importieren
            </Button>
          </form>
        )}
      </Modal>
    </>
  );
}
