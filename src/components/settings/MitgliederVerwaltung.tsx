"use client";

// Mitglieder einer Organisation verwalten (28.11.): eine ruhige Liste, je
// Mitglied ein Dialog „Bearbeiten“ mit Name, Rechten, Passwort, Zugang und
// Löschen. Dieselbe Komponente steht in /settings (aktive Organisation) und
// in /admin/org/[id] (Plattform-Admins, beliebige Organisation) — die Server
// Actions prüfen die Berechtigung selbst (`verwaltung()` in actions/workspace.ts).

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { Ban, Check, Copy, KeyRound, Pencil, RefreshCw, ShieldCheck, Trash2, UserCog } from "lucide-react";
import {
  deleteUser,
  renameUser,
  setUserGesperrt,
  setUserPassword,
  updateUserRole,
  updateUserScope,
  type MitgliedInfo,
} from "@/app/actions/workspace";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Segmented } from "@/components/ui/Segmented";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { InfoPopover } from "@/components/ui/InfoPopover";
import { ownerColor } from "@/lib/ownerColor";
import { PASSWORT_MIN, erzeugePasswort, passwortFehler, zuletztText } from "@/lib/mitglieder";

type Meldung = { text: string; fehler?: boolean } | null;

function Abschnitt({ titel, hinweis, children }: { titel: string; hinweis?: string; children: ReactNode }) {
  return (
    <section className="mv-abschnitt">
      <div className="mv-abschnitt-kopf">
        <h3>{titel}</h3>
        {/* Erklärung im Info-Icon, nicht als Absatz (Regel 28.11.). */}
        {hinweis && (
          <InfoPopover label={`${titel}: Erklärung`} width={300}>
            {hinweis}
          </InfoPopover>
        )}
      </div>
      {children}
    </section>
  );
}

function MitgliedDialog({
  m,
  ich,
  workspaceId,
  onClose,
}: {
  m: MitgliedInfo;
  ich: boolean;
  workspaceId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [pending, start] = useTransition();
  const [meldung, setMeldung] = useState<Meldung>(null);
  const [name, setName] = useState(m.username);
  const [passwort, setPasswort] = useState("");
  const [kopiert, setKopiert] = useState(false);

  const fuehreAus = (arbeit: () => Promise<{ error?: string }>, erfolg: string, danach?: () => void) =>
    start(async () => {
      setMeldung(null);
      const res = await arbeit();
      if (res.error) {
        setMeldung({ text: res.error, fehler: true });
        return;
      }
      setMeldung({ text: erfolg });
      router.refresh();
      danach?.();
    });

  const pwFehler = passwort ? passwortFehler(passwort) : null;

  return (
    <Modal open onClose={onClose} title={m.username} subtitle="Mitglied bearbeiten" width={520}>
      {dialog}
      <div style={{ display: "grid", gap: "var(--sp-7)" }}>
        {meldung && (
          <div role={meldung.fehler ? "alert" : "status"} className="mv-meldung" data-fehler={meldung.fehler || undefined}>
            {meldung.fehler ? null : <Check size={14} aria-hidden />} {meldung.text}
          </div>
        )}

        <Abschnitt titel="Name" hinweis="Der Name ist zugleich der Login. Nach einer Änderung meldet sich die Person mit dem neuen Namen an.">
          <form
            className="mv-zeile"
            onSubmit={(ev) => {
              ev.preventDefault();
              fuehreAus(() => renameUser(m.user_id, name, workspaceId), `Umbenannt in „${name.trim()}“.`);
            }}
          >
            <input className="ui-input" value={name} onChange={(ev) => setName(ev.target.value)} aria-label="Name" style={{ fontSize: 16 }} />
            <Button type="submit" variant="secondary" size="sm" loading={pending} disabled={!name.trim() || name.trim() === m.username}>
              Speichern
            </Button>
          </form>
        </Abschnitt>

        <Abschnitt titel="Rechte">
          <div className="mv-recht">
            <div className="mv-recht-label">
              <strong>Rolle</strong>
              <InfoPopover label="Rolle: Erklärung" width={280}>
                Owner verwalten Mitglieder, Ziele und Einstellungen.
              </InfoPopover>
            </div>
            {ich ? (
              <span className="mv-fest">{m.role === "owner" ? "Owner" : "Mitglied"} · eigene Rolle fest</span>
            ) : (
              <Segmented
                options={[
                  { value: "member", label: "Mitglied" },
                  { value: "owner", label: "Owner" },
                ]}
                value={m.role}
                onChange={(v) =>
                  fuehreAus(() => updateUserRole(m.user_id, v, workspaceId), v === "owner" ? "Jetzt Owner." : "Jetzt Mitglied.")
                }
                ariaLabel="Rolle"
              />
            )}
          </div>
          <div className="mv-recht">
            <div className="mv-recht-label">
              <strong>Datensicht</strong>
              <InfoPopover label="Datensicht: Erklärung" width={280}>
                Nur eigene: sieht ausschließlich eigene Listen, Termine und Zahlen.
              </InfoPopover>
            </div>
            <Segmented
              options={[
                { value: "workspace", label: "Alle Daten" },
                { value: "own", label: "Nur eigene" },
              ]}
              value={m.data_scope}
              onChange={(v) =>
                fuehreAus(() => updateUserScope(m.user_id, v, workspaceId), v === "own" ? "Sieht jetzt nur eigene Daten." : "Sieht jetzt alle Daten.")
              }
              ariaLabel="Datensicht"
            />
          </div>
        </Abschnitt>

        <Abschnitt
          titel="Passwort"
          hinweis={ich ? "Dein eigenes Passwort änderst du unter „Mein Konto“ in den Einstellungen." : `Neues Passwort setzen und der Person sicher mitteilen. Mindestens ${PASSWORT_MIN} Zeichen.`}
        >
          {!ich && (
            <form
              className="mv-zeile"
              onSubmit={(ev) => {
                ev.preventDefault();
                fuehreAus(() => setUserPassword(m.user_id, passwort, workspaceId), "Neues Passwort gesetzt — bitte der Person mitteilen.");
              }}
            >
              <input
                className="ui-input"
                value={passwort}
                onChange={(ev) => {
                  setPasswort(ev.target.value);
                  setKopiert(false);
                }}
                placeholder="Neues Passwort"
                autoComplete="new-password"
                spellCheck={false}
                aria-label="Neues Passwort"
                style={{ fontSize: 16, fontFamily: "var(--font-mono-stack)" }}
              />
              <Button type="button" variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={() => setPasswort(erzeugePasswort())} title="Zufälliges Passwort erzeugen">
                Erzeugen
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={kopiert ? <Check size={13} /> : <Copy size={13} />}
                disabled={!passwort}
                onClick={async () => {
                  await navigator.clipboard.writeText(passwort).catch(() => {});
                  setKopiert(true);
                }}
                title="Kopieren"
              >
                {kopiert ? "Kopiert" : "Kopieren"}
              </Button>
              <Button type="submit" variant="primary" size="sm" icon={<KeyRound size={13} />} loading={pending} disabled={!passwort || Boolean(pwFehler)}>
                Setzen
              </Button>
            </form>
          )}
          {pwFehler && <div className="mv-hinweis">{pwFehler}</div>}
        </Abschnitt>

        {!ich && (
          <Abschnitt
            titel="Zugang"
            hinweis={m.gesperrt ? "Gesperrt: Die Person kann sich nicht anmelden. Daten und Zuordnungen bleiben unverändert." : "Sperren verhindert die Anmeldung, ohne Daten zu löschen — z. B. bei Pause oder Austritt."}
          >
            <div className="mv-zeile">
              {m.gesperrt ? (
                <Button variant="secondary" size="sm" icon={<ShieldCheck size={13} />} loading={pending} onClick={() => fuehreAus(() => setUserGesperrt(m.user_id, false, workspaceId), "Zugang wieder frei.")}>
                  Entsperren
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Ban size={13} />}
                  loading={pending}
                  onClick={async () => {
                    const ok = await confirm({
                      title: `${m.username} sperren?`,
                      message: "Die Person kann sich danach nicht mehr anmelden. Entsperren geht jederzeit.",
                      confirmLabel: "Sperren",
                      destructive: true,
                    });
                    if (ok) fuehreAus(() => setUserGesperrt(m.user_id, true, workspaceId), "Zugang gesperrt.");
                  }}
                >
                  Sperren
                </Button>
              )}
            </div>
          </Abschnitt>
        )}

        {!ich && (
          <Abschnitt titel="Löschen" hinweis="Entfernt das Konto endgültig. Listen und Termine bleiben erhalten und stehen danach ohne Inhaber da.">
            <div className="mv-zeile">
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 size={13} />}
                loading={pending}
                onClick={async () => {
                  const ok = await confirm({
                    title: `${m.username} endgültig löschen?`,
                    message: "Das lässt sich nicht rückgängig machen. Wer nur pausiert, wird besser gesperrt.",
                    confirmLabel: "Löschen",
                    destructive: true,
                  });
                  if (ok) fuehreAus(() => deleteUser(m.user_id, workspaceId), "Gelöscht.", onClose);
                }}
              >
                Konto löschen
              </Button>
            </div>
          </Abschnitt>
        )}
      </div>
    </Modal>
  );
}

export function MitgliederVerwaltung({
  mitglieder,
  meId,
  workspaceId,
  extras,
}: {
  mitglieder: MitgliedInfo[];
  meId: string;
  /** Fehlt = aktive Organisation (/settings). */
  workspaceId?: string;
  /** Zusätzliche Knöpfe je Zeile (z. B. „Verschieben“ auf /admin/org/[id]). */
  extras?: Record<string, ReactNode>;
}) {
  const [offen, setOffen] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);
  // Erst im Browser lesen (Server und Client rendern dasselbe).
  useEffect(() => {
    const t = setTimeout(() => setNowMs(Date.now()), 0);
    return () => clearTimeout(t);
  }, []);
  const aktuell = mitglieder.find((m) => m.user_id === offen) ?? null;

  if (mitglieder.length === 0) return <div className="mv-leer">Noch keine Mitglieder.</div>;

  return (
    <div className="mv-liste">
      {mitglieder.map((m) => {
        const ich = m.user_id === meId;
        const farbe = ownerColor(m.username);
        return (
          <div key={m.user_id} className="mv-mitglied" data-gesperrt={m.gesperrt || undefined}>
            <span className="mv-avatar" style={{ background: farbe.bg, color: farbe.fg }} aria-hidden>
              {m.username[0]?.toUpperCase()}
            </span>
            <div className="mv-text">
              <div className="mv-name">
                {m.username}
                {ich && <span className="badge badge-gray">Du</span>}
                {m.plattformAdmin && <span className="badge badge-gray">Plattform-Admin</span>}
                {m.gesperrt && <span className="badge" data-tone="error">Gesperrt</span>}
              </div>
              <div className="mv-meta">
                <span>{m.role === "owner" ? "Owner" : "Mitglied"}</span>
                <span>{m.data_scope === "own" ? "nur eigene Daten" : "alle Daten"}</span>
                {nowMs != null && <span>{zuletztText(m.zuletztAngemeldet, nowMs)}</span>}
              </div>
            </div>
            <div className="mv-aktionen">
              {extras?.[m.user_id]}
              <Button size="sm" variant="secondary" icon={ich ? <UserCog size={13} /> : <Pencil size={13} />} onClick={() => setOffen(m.user_id)}>
                Bearbeiten
              </Button>
            </div>
          </div>
        );
      })}
      {aktuell && <MitgliedDialog m={aktuell} ich={aktuell.user_id === meId} workspaceId={workspaceId} onClose={() => setOffen(null)} />}
    </div>
  );
}
