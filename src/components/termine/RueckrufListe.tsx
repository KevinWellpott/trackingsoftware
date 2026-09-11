"use client";

import { formatTerminParts } from "@/lib/apptTime";
import { DRAN_TONE } from "@/lib/dranRegel";
import { dueRefAt, isOverdue } from "@/lib/dueState";
import { ownerColor, ownerInitials } from "@/lib/ownerColor";
import type { RueckrufAufgabe } from "@/lib/termine";
import { Phone, PhoneCall } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

// Der dritte Reiter: fällige Telefon-Rückrufe.
//
// WARUM ER HIER STEHT UND NICHT BEI DEN TERMINEN: Ein Rückruf ist die einzige
// Aufgabe der ganzen Software mit einer MIT DEM LEAD VERABREDETEN Uhrzeit
// (docs §1, §6) — „Dienstag um 14 Uhr" ist ein Versprechen, kein Tagesziel.
// Alles andere in diesem Bereich ist tagesgenau. Beides in eine Tabelle zu
// mischen hieße, entweder die Uhrzeit zu verlieren oder allen anderen Zeilen
// eine Genauigkeit anzudichten, die sie nicht haben.
//
// Genau deshalb entscheidet hier `isOverdue(..., "moment")` über das Gold und
// nicht der Kalendertag: Ein Rückruf ist in der Minute nach der verabredeten
// Zeit versäumt, ein Follow-up erst am Folgetag. Die Unterscheidung steht in
// src/lib/dueState.ts und wird von hier gelesen statt nachgebaut.
//
// KEIN „Genervt"-Stempel: Migration 0041 legt die beiden Nachfass-Spalten nur
// auf den Termin-Tabellen an, und das ist richtig — ein Rückruf wird nicht
// abgehakt, sondern GEFÜHRT. Der Weg dorthin ist der Call-Modus in seiner
// Liste, und dort entsteht auch der Eintrag im Anruf-Log (docs §3).

export function RueckrufListe({
  aufgaben,
  verfuegbar,
}: {
  aufgaben: RueckrufAufgabe[];
  /**
   * `false` = die Abfrage ist gescheitert. Muster `loadCallAttempts` (docs
   * §5.1): „nicht ermittelbar" darf nicht wie „nichts zu tun" aussehen — sonst
   * hält jemand eine kaputte Verbindung für einen ruhigen Tag.
   */
  verfuegbar: boolean;
}) {
  // „Jetzt" für die Überfällig-Frage: Muster ErinnerungenBoard — ein direkter
  // Date.now()-Aufruf im Render-Körper ist unrein (react-hooks/purity),
  // stattdessen minütlich per Effekt nachführen.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const rows = useMemo(
    () => [...aufgaben].sort((a, b) => a.callbackAt.localeCompare(b.callbackAt)),
    [aufgaben],
  );

  if (!verfuegbar) {
    return (
      <div className="card dot-grid">
        <div className="empty-state">
          <PhoneCall size={24} aria-hidden />
          <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: "var(--text-primary)" }}>
            Rückrufe nicht ermittelbar
          </div>
          <p style={{ maxWidth: 420 }}>
            Die Telefon-Daten konnten nicht geladen werden. Das heißt nicht, dass keine Rückrufe anstehen — bitte die
            Seite neu laden.
          </p>
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="card dot-grid">
        <div className="empty-state">
          <PhoneCall size={24} aria-hidden />
          <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: "var(--text-primary)" }}>Keine Rückrufe</div>
          <p style={{ maxWidth: 420 }}>
            Ein Rückruf entsteht im Call-Modus, sobald ein Lead auf „Rückruf“ gesetzt wird — mit der Uhrzeit, die
            verabredet wurde.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="table-scroll"
      // Wie in der Arbeitsliste daneben: `overflowX: "auto"` statt
      // `overflow: "hidden"`. Der Inline-Stil schlug die einzige
      // `.table-scroll`-Regel, und damit war auf schmalen Fenstern die
      // Rufnummer — der eine Handgriff dieser Tabelle — nicht erreichbar.
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        overflowX: "auto",
        background: "var(--surface-100)",
      }}
    >
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 176 }}>Verabredet</th>
            <th>Firma / Entscheider</th>
            <th style={{ width: 132 }}>Person</th>
            <th style={{ width: 172 }}>Anrufen</th>
            <th style={{ width: 180 }}>Liste</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            // Vor dem ersten Effekt-Tick behauptet die Zeile keine
            // Dringlichkeit — lieber eine Sekunde ohne Gold als eine falsche.
            const faellig = nowMs != null && isOverdue(r.callbackAt, "moment", dueRefAt(nowMs));
            const zeit = formatTerminParts(r.callbackAt);
            return (
              <tr key={r.id}>
                <td
                  style={
                    faellig
                      ? { background: DRAN_TONE.bg, boxShadow: `inset 2px 0 0 ${DRAN_TONE.border}` }
                      : undefined
                  }
                >
                  <span
                    className="tnum"
                    style={{
                      display: "inline-flex",
                      alignItems: "baseline",
                      gap: "var(--sp-3)",
                      color: faellig ? DRAN_TONE.fg : "var(--text-secondary)",
                    }}
                    title={faellig ? "Die verabredete Zeit ist vorbei." : undefined}
                  >
                    {zeit?.date}
                    <span style={{ color: faellig ? "inherit" : "var(--text-primary)", fontWeight: 600 }}>
                      {zeit?.time}
                    </span>
                  </span>
                </td>

                <td>
                  <span style={{ display: "inline-flex", alignItems: "baseline", gap: "var(--sp-4)", minWidth: 0 }}>
                    <span
                      style={{
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.company ?? "Unbenannte Firma"}
                    </span>
                    {r.decider && (
                      <span
                        style={{
                          fontSize: "var(--fs-xs)",
                          color: "var(--text-muted)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.decider}
                      </span>
                    )}
                  </span>
                </td>

                <td>
                  {r.ownerName ? (
                    <OwnerCell username={r.ownerName} />
                  ) : (
                    <span style={{ color: "var(--text-disabled)" }}>—</span>
                  )}
                </td>

                {/* Die Nummer IST der Handgriff — anders als beim Termin gibt es
                    hier nichts abzuhaken, sondern etwas zu tun. */}
                <td>
                  {r.phone ? (
                    <a
                      href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}
                      className="badge badge-gray tnum"
                      style={{ textDecoration: "none" }}
                      title="Anrufen"
                    >
                      <Phone size={11} /> {r.phone}
                    </a>
                  ) : (
                    <span style={{ color: "var(--text-disabled)" }}>keine Nummer</span>
                  )}
                </td>

                {/* Abgehakt wird im Call-Modus der Liste: Nur dort entsteht der
                    Eintrag im Anruf-Log, und nur dort steht der Leitfaden. */}
                <td>
                  {r.listId ? (
                    <Link
                      href={`/telefon/${r.listId}`}
                      className="badge"
                      style={{
                        textDecoration: "none",
                        color: "var(--orange-300)",
                        backgroundColor: "var(--accent-muted)",
                        border: "1px solid var(--border-accent)",
                      }}
                    >
                      <PhoneCall size={11} /> {r.listName ?? "Zur Liste"}
                    </Link>
                  ) : (
                    <span style={{ color: "var(--text-disabled)" }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Wie in der Arbeitsliste — hier ist die Person aber der LISTEN-Owner (docs §2). */
function OwnerCell({ username }: { username: string }) {
  const oc = ownerColor(username);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)", minWidth: 0 }}>
      <span
        aria-hidden
        style={{
          width: 20,
          height: 20,
          flexShrink: 0,
          borderRadius: "var(--r-full)",
          background: oc.bg,
          color: oc.fg,
          boxShadow: `inset 0 0 0 1px ${oc.fg}`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "var(--fs-2xs)",
          fontWeight: 600,
        }}
      >
        {ownerInitials(username)}
      </span>
      <span
        style={{
          fontSize: "var(--fs-sm)",
          color: "var(--text-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {username}
      </span>
    </span>
  );
}
