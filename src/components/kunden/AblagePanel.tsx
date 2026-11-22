"use client";

import { useRef, useState, useTransition } from "react";
import { Download, ExternalLink, FileText, Link2, Trash2, Upload } from "lucide-react";
import { ablageDownloadUrl, addAblageLink, deleteAblage, registerAblageUpload } from "@/app/actions/kunden";
import { createClient } from "@/lib/supabase/client";
import { aktionFertig } from "@/components/kunden/AktionsPuls";
import { Button, IconButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { Segmented } from "@/components/ui/Segmented";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { formatDateDe } from "@/components/ui/DatePicker";
import { berlinDateISO } from "@/lib/apptTime";
import {
  ABLAGE_BUCKET,
  ABLAGE_MAX_BYTES,
  ABLAGE_TYPEN,
  ABLAGE_TYP_LABELS,
  formatBytes,
  type AblageEintrag,
  type AblageTyp,
} from "@/lib/kunden";

// Ablage je Kunde: Dateien (privater Bucket `kunden-ablage`) und Links
// (Drive-Ordner, Loom, Notion …). Dateien gehen DIREKT aus dem Browser in den
// Bucket — eine Server Action trägt höchstens 4,5 MB, ein Vertrags-PDF mit
// Anlagen oft mehr. Die Storage-Policy lässt nur Titan-Mitglieder hinein;
// die Server Action registriert danach die Zeile und prüft den Pfad.

const ALLE_TYPEN = ABLAGE_TYPEN.map((t) => ({ value: t, label: ABLAGE_TYP_LABELS[t] }));

function sichererDateiname(name: string): string {
  return name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").slice(-120) || "datei";
}

export function AblagePanel({
  kundeId,
  eintraege,
  namen,
  mitVertraegen,
}: {
  kundeId: string;
  eintraege: AblageEintrag[];
  namen: Record<string, string>;
  /** Verträge tragen Preise: ablegen und sehen nur Admins. */
  mitVertraegen: boolean;
}) {
  const TYP_OPTIONEN = mitVertraegen ? ALLE_TYPEN : ALLE_TYPEN.filter((t) => t.value !== "vertrag");
  const [modus, setModus] = useState<"datei" | "link">("datei");
  const [typ, setTyp] = useState<AblageTyp>("material");
  const [titel, setTitel] = useState("");
  const [url, setUrl] = useState("");
  const [filter, setFilter] = useState<AblageTyp | "">("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const { confirm, dialog } = useConfirm();

  const hochladen = (file: File) =>
    start(async () => {
      setError(null);
      if (file.size > ABLAGE_MAX_BYTES) {
        setError(`Die Datei ist größer als ${formatBytes(ABLAGE_MAX_BYTES)}. Bitte als Link ablegen.`);
        return;
      }
      const pfad = `${kundeId}/${typ === "vertrag" ? "vertrag/" : ""}${crypto.randomUUID()}-${sichererDateiname(file.name)}`;
      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from(ABLAGE_BUCKET)
        .upload(pfad, file, { contentType: file.type || undefined, upsert: false });
      if (upErr) {
        setError(`Hochladen fehlgeschlagen: ${upErr.message}`);
        return;
      }
      const r = await registerAblageUpload(kundeId, {
        typ,
        titel: titel || file.name,
        storage_path: pfad,
        dateiname: file.name,
        groesse_bytes: file.size,
        mime: file.type || null,
      });
      aktionFertig();
      if (r.error) setError(r.error);
      else setTitel("");
      if (fileRef.current) fileRef.current.value = "";
    });

  const linkSpeichern = () =>
    start(async () => {
      setError(null);
      const r = await addAblageLink(kundeId, { typ, titel, url });
      aktionFertig();
      if (r.error) setError(r.error);
      else {
        setTitel("");
        setUrl("");
      }
    });

  const oeffnen = (id: string) =>
    start(async () => {
      const r = await ablageDownloadUrl(id);
      aktionFertig();
      if (r.error || !r.url) setError(r.error ?? "Link konnte nicht erzeugt werden.");
      // Kein window.open: Nach einem await blockieren Browser das Popup. Der
      // signierte Link trägt `download`, die Seite bleibt also stehen.
      else window.location.assign(r.url);
    });

  const sichtbar = filter ? eintraege.filter((e) => e.typ === filter) : eintraege;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      {dialog}
      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
          <Segmented
            options={[
              { value: "datei", label: "Datei hochladen" },
              { value: "link", label: "Link ablegen" },
            ]}
            value={modus}
            onChange={setModus}
            size="sm"
            ariaLabel="Art der Ablage"
          />
          <div style={{ display: "flex", gap: "var(--sp-4)", flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ flex: "0 0 160px" }}>
              <Select value={typ} onChange={(v) => setTyp(v as AblageTyp)} options={TYP_OPTIONEN} ariaLabel="Typ" />
            </div>
            <Input aria-label="Titel" value={titel} onChange={(e) => setTitel(e.target.value)} placeholder={modus === "datei" ? "Titel (optional, sonst Dateiname)" : "Titel (optional)"} style={{ flex: "1 1 200px" }} />
            {modus === "link" ? (
              <>
                <Input aria-label="Link" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" style={{ flex: "2 1 240px" }} />
                <Button variant="secondary" icon={<Link2 size={15} />} loading={pending} disabled={!url.trim()} onClick={linkSpeichern}>
                  Ablegen
                </Button>
              </>
            ) : (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) hochladen(f);
                  }}
                />
                <Button variant="secondary" icon={<Upload size={15} />} loading={pending} onClick={() => fileRef.current?.click()}>
                  Datei wählen
                </Button>
              </>
            )}
          </div>
          {modus === "datei" && (
            <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
              Bis {formatBytes(ABLAGE_MAX_BYTES)} je Datei, nur für die Titan-Organisation lesbar, Verträge nur für Admins. Große Aufzeichnungen besser als Link.
            </div>
          )}
          {error && <div role="alert" style={{ color: "var(--danger-fg)", fontSize: "var(--fs-sm)" }}>{error}</div>}
        </div>
      </Card>

      <Card padding={0}>
        <div style={{ padding: "var(--sp-5) var(--sp-8)", borderBottom: "1px solid var(--border-default)", display: "flex", gap: "var(--sp-3)", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontWeight: 600, fontSize: "var(--fs-md)", marginRight: "var(--sp-4)" }}>Ablage</span>
          {[{ value: "" as const, label: "Alle" }, ...TYP_OPTIONEN].map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setFilter(o.value as AblageTyp | "")}
              className="ks-chip"
              data-active={filter === o.value}
              aria-pressed={filter === o.value}
            >
              {o.label}
              {o.value && ` ${eintraege.filter((e) => e.typ === o.value).length || ""}`}
            </button>
          ))}
        </div>
        {sichtbar.length === 0 ? (
          <div style={{ padding: "var(--sp-8)", color: "var(--text-muted)", fontSize: "var(--fs-sm)" }}>Nichts abgelegt.</div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {sichtbar.map((e) => (
              <li key={e.id} style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)", padding: "var(--sp-4) var(--sp-8)", borderBottom: "1px solid var(--border-subtle)" }}>
                {e.url ? <Link2 size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} aria-hidden /> : <FileText size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} aria-hidden />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-primary)", fontWeight: 500, fontSize: "var(--fs-sm)", textDecoration: "none" }}>
                      {e.titel}
                    </a>
                  ) : (
                    <button type="button" onClick={() => oeffnen(e.id)} style={{ background: "none", border: 0, padding: 0, color: "var(--text-primary)", fontWeight: 500, fontSize: "var(--fs-sm)", cursor: "pointer", textAlign: "left" }}>
                      {e.titel}
                    </button>
                  )}
                  <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
                    {[formatDateDe(berlinDateISO(e.created_at)), e.created_by_user_id ? namen[e.created_by_user_id] : null, e.dateiname && e.dateiname !== e.titel ? e.dateiname : null, formatBytes(e.groesse_bytes)]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <Badge tone="neutral">{ABLAGE_TYP_LABELS[e.typ]}</Badge>
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noopener noreferrer" aria-label="Link öffnen" title="Link öffnen" className="ui-btn ui-icon-btn" data-variant="ghost" style={{ width: 32, height: 32, minHeight: 32, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
                    <ExternalLink size={15} />
                  </a>
                ) : (
                  <IconButton label="Herunterladen" icon={<Download size={15} />} onClick={() => oeffnen(e.id)} />
                )}
                <IconButton
                  label="Entfernen"
                  tone="danger"
                  icon={<Trash2 size={15} />}
                  onClick={async () => {
                    if (await confirm({ title: `„${e.titel}“ entfernen?`, message: e.storage_path ? "Die Datei wird endgültig gelöscht." : undefined, confirmLabel: "Entfernen", destructive: true }))
                      start(async () => {
                        const r = await deleteAblage(e.id);
                        aktionFertig();
                        if (r.error) setError(r.error);
                      });
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
