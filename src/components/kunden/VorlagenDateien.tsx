"use client";

// Dateien an einer Vorlage (Migration 0052, 28.11.): ziehen oder auswählen,
// mehrere auf einmal. Hochgeladen wird direkt in den privaten Bucket, danach
// trägt die Server Action die Datei an der Vorlage ein (Muster AblagePanel).

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Download, FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { Abschnitt } from "@/components/kunden/bausteine";
import { deleteVorlageDatei, registerVorlageDatei, vorlageDateiUrl } from "@/app/actions/kunden";
import { createClient } from "@/lib/supabase/client";
import { Button, IconButton } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { InfoPopover } from "@/components/ui/InfoPopover";
import { berlinDateISO } from "@/lib/apptTime";
import { ABLAGE_MAX_BYTES, VORLAGEN_BUCKET, formatBytes, sichererDateiname, type VorlageDatei } from "@/lib/kunden";

function datum(iso: string): string {
  const [y, m, d] = berlinDateISO(iso).split("-");
  return `${d}.${m}.${y}`;
}

export function VorlagenDateien({
  vorlageId,
  dateien,
  verfuegbar,
  offen,
  onUmschalten,
}: {
  vorlageId: string;
  dateien: VorlageDatei[];
  /** false = Migration 0052 fehlt. */
  verfuegbar: boolean;
  offen: boolean;
  onUmschalten: () => void;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [pending, start] = useTransition();
  const [fehler, setFehler] = useState<string | null>(null);
  const [fortschritt, setFortschritt] = useState<string | null>(null);
  const [ziehen, setZiehen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const hochladen = (liste: FileList | File[]) => {
    const files = Array.from(liste);
    if (files.length === 0) return;
    start(async () => {
      setFehler(null);
      const supabase = createClient();
      const fehlerListe: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setFortschritt(files.length > 1 ? `${i + 1} von ${files.length} …` : "Lädt hoch …");
        if (file.size > ABLAGE_MAX_BYTES) {
          fehlerListe.push(`${file.name}: größer als ${formatBytes(ABLAGE_MAX_BYTES)}`);
          continue;
        }
        const pfad = `${vorlageId}/${crypto.randomUUID()}-${sichererDateiname(file.name)}`;
        const { error: upErr } = await supabase.storage
          .from(VORLAGEN_BUCKET)
          .upload(pfad, file, { contentType: file.type || undefined, upsert: false });
        if (upErr) {
          fehlerListe.push(`${file.name}: ${upErr.message}`);
          continue;
        }
        const r = await registerVorlageDatei(vorlageId, {
          titel: file.name.replace(/\.[^.]+$/, ""),
          storage_path: pfad,
          dateiname: file.name,
          groesse_bytes: file.size,
          mime: file.type || null,
        });
        if (r.error) fehlerListe.push(`${file.name}: ${r.error}`);
      }
      setFortschritt(null);
      if (fehlerListe.length) setFehler(fehlerListe.join(" · "));
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    });
  };

  const herunterladen = (id: string) =>
    start(async () => {
      const r = await vorlageDateiUrl(id);
      if (r.error || !r.url) setFehler(r.error ?? "Kein Link.");
      else window.location.href = r.url;
    });

  return (
    <Abschnitt
      offen={offen}
      onUmschalten={onUmschalten}
      titel="Dateien"
      zahl={dateien.length}
      icon={<Paperclip size={15} aria-hidden className="vd-icon" />}
      info={
        <InfoPopover label="Dateien an der Vorlage" width={300}>
          Unterlagen zu dieser Vorlage — Onboarding-PDF, Briefing, Präsentation. Höchstens {formatBytes(ABLAGE_MAX_BYTES)} je
          Datei. Nur für das Titan-Team sichtbar.
        </InfoPopover>
      }
      aktion={
        <>
          <Button
            size="sm"
            variant="secondary"
            icon={<Upload size={13} aria-hidden />}
            disabled={!verfuegbar || pending}
            onClick={() => inputRef.current?.click()}
          >
            {fortschritt ?? "Datei hochladen"}
          </Button>
          <input ref={inputRef} type="file" multiple hidden onChange={(e) => e.target.files && hochladen(e.target.files)} />
        </>
      }
    >
      {dialog}
      {!verfuegbar ? (
        <p className="vd-hinweis">Migration 0052 ist noch nicht eingespielt — danach lassen sich hier Dateien hochladen.</p>
      ) : (
        <div
          className="vd-zone"
          data-ziehen={ziehen || undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setZiehen(true);
          }}
          onDragLeave={() => setZiehen(false)}
          onDrop={(e) => {
            e.preventDefault();
            setZiehen(false);
            if (e.dataTransfer.files?.length) hochladen(e.dataTransfer.files);
          }}
        >
          {dateien.length === 0 ? (
            <button type="button" className="vd-leer" onClick={() => inputRef.current?.click()} disabled={pending}>
              <Upload size={18} aria-hidden />
              <span>{fortschritt ?? "Dateien hierher ziehen oder klicken"}</span>
            </button>
          ) : (
            <>
              <ul className="vd-liste">
                {dateien.map((d) => (
                  <li key={d.id}>
                    <FileText size={16} aria-hidden className="vd-icon" />
                    <span className="vd-text">
                      <span className="vd-titel">{d.titel}</span>
                      <span className="vd-meta">
                        {d.dateiname} · {formatBytes(d.groesse_bytes)} · {datum(d.created_at)}
                      </span>
                    </span>
                    <IconButton label={`${d.titel} herunterladen`} icon={<Download size={15} />} size={30} onClick={() => herunterladen(d.id)} />
                    <IconButton
                      label={`${d.titel} löschen`}
                      icon={<Trash2 size={15} />}
                      size={30}
                      tone="danger"
                      onClick={async () => {
                        const ok = await confirm({
                          title: "Datei löschen?",
                          message: `„${d.titel}“ wird endgültig entfernt.`,
                          confirmLabel: "Löschen",
                          destructive: true,
                        });
                        if (!ok) return;
                        start(async () => {
                          const r = await deleteVorlageDatei(d.id);
                          if (r.error) setFehler(r.error);
                          router.refresh();
                        });
                      }}
                    />
                  </li>
                ))}
              </ul>
              <p className="vd-ablegen">{fortschritt ?? "Weitere Dateien einfach hierher ziehen."}</p>
            </>
          )}
        </div>
      )}
      {fehler && (
        <p className="vd-fehler" role="alert">
          {fehler}
        </p>
      )}
    </Abschnitt>
  );
}
