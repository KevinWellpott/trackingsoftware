"use client";

// „Mein Konto“ — für JEDES Mitglied: Login-Name sehen und das eigene
// Passwort ändern. Das aktuelle Passwort wird serverseitig geprüft
// (`changeOwnPassword`). Den Namen ändert ein Owner (er ist zugleich der
// Login und hängt an Listen als Inhaber).

import { useState, useTransition } from "react";
import { Check, Eye, EyeOff, KeyRound } from "lucide-react";
import { changeOwnPassword } from "@/app/actions/workspace";
import { Button } from "@/components/ui/Button";
import { PASSWORT_MIN, passwortFehler } from "@/lib/mitglieder";

export function EigenesKonto({ username, rolle, organisation }: { username: string; rolle: string; organisation: string }) {
  const [aktuell, setAktuell] = useState("");
  const [neu, setNeu] = useState("");
  const [wiederholt, setWiederholt] = useState("");
  const [zeigen, setZeigen] = useState(false);
  const [meldung, setMeldung] = useState<{ text: string; fehler?: boolean } | null>(null);
  const [pending, start] = useTransition();

  const fehler = neu ? passwortFehler(neu) : null;
  const ungleich = wiederholt.length > 0 && neu !== wiederholt;
  const bereit = Boolean(aktuell && neu && !fehler && neu === wiederholt);
  const typ = zeigen ? "text" : "password";

  return (
    <div className="mv-konto">
      <div className="mv-konto-info">
        <span>Angemeldet als</span>
        <strong>{username}</strong>
        <span>
          {rolle} · {organisation}
        </span>
      </div>
      <form
        className="mv-konto-form"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!bereit) return;
          start(async () => {
            setMeldung(null);
            const res = await changeOwnPassword(aktuell, neu);
            if (res.error) {
              setMeldung({ text: res.error, fehler: true });
              return;
            }
            setAktuell("");
            setNeu("");
            setWiederholt("");
            setMeldung({ text: "Passwort geändert. Beim nächsten Login gilt das neue." });
          });
        }}
      >
        <label>
          <span>Aktuelles Passwort</span>
          <input className="ui-input" type={typ} value={aktuell} onChange={(e) => setAktuell(e.target.value)} autoComplete="current-password" style={{ fontSize: 16 }} />
        </label>
        <label>
          <span>Neues Passwort</span>
          <input className="ui-input" type={typ} value={neu} onChange={(e) => setNeu(e.target.value)} autoComplete="new-password" style={{ fontSize: 16 }} />
        </label>
        <label>
          <span>Neues Passwort wiederholen</span>
          <input className="ui-input" type={typ} value={wiederholt} onChange={(e) => setWiederholt(e.target.value)} autoComplete="new-password" style={{ fontSize: 16 }} />
        </label>
        <div className="mv-konto-fuss">
          <span className="mv-hinweis" data-fehler={Boolean(fehler || ungleich) || undefined}>
            {fehler ?? (ungleich ? "Die beiden neuen Passwörter stimmen nicht überein." : `Mindestens ${PASSWORT_MIN} Zeichen.`)}
          </span>
          <Button type="button" variant="ghost" size="sm" icon={zeigen ? <EyeOff size={13} /> : <Eye size={13} />} onClick={() => setZeigen((z) => !z)}>
            {zeigen ? "Verbergen" : "Anzeigen"}
          </Button>
          <Button type="submit" variant="primary" size="sm" icon={<KeyRound size={13} />} loading={pending} disabled={!bereit}>
            Passwort ändern
          </Button>
        </div>
        {meldung && (
          <div role={meldung.fehler ? "alert" : "status"} className="mv-meldung" data-fehler={meldung.fehler || undefined}>
            {!meldung.fehler && <Check size={14} aria-hidden />} {meldung.text}
          </div>
        )}
      </form>
    </div>
  );
}
