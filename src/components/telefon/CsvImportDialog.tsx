"use client";

import { importPhoneCsv } from "@/app/actions/phone";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { FileUp, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

// CSV-Import (Google-Maps-Export) für Telefonlisten: Datei hochladen,
// optionaler Listenname. Nur Firma/Telefon/Website werden gemappt.
// Import ist immer personenbezogen: Nicht-Admins importieren als sie selbst,
// nur Admins mit mehreren Nutzern können den Inhaber wählen.

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
}: {
  users: UserOption[];
  me: UserOption;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Owner-Auswahl nur für Admins mit mehreren Nutzern — sonst immer "ich selbst".
  const showOwnerSelect = isAdmin && users.length > 1;
  const [ownerUserId, setOwnerUserId] = useState(() =>
    users.some((u) => u.user_id === me.user_id) || !showOwnerSelect ? me.user_id : users[0].user_id,
  );
  const [listName, setListName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setFile(null);
    setListName("");
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
