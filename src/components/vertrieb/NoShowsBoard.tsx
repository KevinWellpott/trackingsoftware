"use client";

// /no-shows (Redesign Phase 4): zwei Karten, Erstgespräch und Closing.
//
// Die MENGEN kommen vom Server und werden hier nicht neu gerechnet:
//  · Erstgespräch — strikt persönlich nach `gehoertMir` (src/lib/noShowsData.ts).
//    Eine Personenachse „Alle" gibt es dafür bewusst nicht, auch nicht für
//    einen Owner mit Team-Sicht (src/lib/settingNoShow.ts): Wer anruft, ist
//    der, der den Termin gelegt hat. Für die Liste eines Kollegen gibt es die
//    Datensicht.
//  · Closing — alle geladenen Closings mit abgeleitetem Zustand `no_show`
//    (`terminZustand`), Personenachse wie /termine (`?wer=`).
//
// Jede Zeile führt zur Detailseite und trägt die Handgriffe der Terminliste:
// Genervt · Termin (`setNeuerTermin`) · Tot (`markTerminDead`).

import { Segmented } from "@/components/ui/Segmented";
import { buildEvents, type TerminEvent, type WithCancellation } from "@/lib/termine";
import type { ClosingCall, SettingCall } from "@/lib/types";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useTerminHandgriffe } from "./useTerminHandgriffe";
import { VorgangZeile } from "./VorgangListe";

const HERKUNFT_LABEL = { telefon: "Telefon", linkedin: "LinkedIn", direkt: "direkt gebucht" } as const;

export function NoShowsBoard({
  settings,
  herkunft,
  closings,
  members,
  today,
  scopeUserId,
  canSeeAll,
}: {
  settings: WithCancellation<SettingCall>[];
  herkunft: Record<string, "telefon" | "linkedin" | "direkt">;
  closings: WithCancellation<ClosingCall>[];
  members: { user_id: string; username: string }[];
  today: string;
  scopeUserId: string;
  canSeeAll: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const wer = canSeeAll && sp.get("wer") === "alle" ? "alle" : "mein";
  const [fehler, setFehler] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  const names = useMemo(() => new Map(members.map((m) => [m.user_id, m.username])), [members]);
  const settingRows = useMemo(() => {
    const { events, ohneTermin } = buildEvents(settings, [], names, today, nowMs);
    return [...events, ...ohneTermin].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  }, [settings, names, today, nowMs]);
  const closingRows = useMemo(() => {
    const { events, ohneTermin } = buildEvents([], closings, names, today, nowMs);
    return [...events, ...ohneTermin]
      .filter((e) => e.zustand === "no_show")
      .filter((e) => wer === "alle" || e.assignee?.user_id === scopeUserId)
      .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  }, [closings, names, today, nowMs, wer, scopeUserId]);

  const h = useTerminHandgriffe(setFehler, nowMs);

  const setWer = (v: "mein" | "alle") => {
    const next = new URLSearchParams(sp.toString());
    if (v === "mein") next.delete("wer");
    else next.set("wer", v);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const tabelle = (rows: TerminEvent[], leer: string, zusatz?: (e: TerminEvent) => string | undefined) =>
    rows.length === 0 ? (
      <div className="vg-leer">{leer}</div>
    ) : (
      <div className="tw">
        <table className="data-table vg-table">
          <thead>
            <tr>
              <th style={{ width: 30 }} aria-label="Erinnerung" />
              <th>Lead</th>
              <th>Stand</th>
              <th>Termin</th>
              <th>Gelegt von</th>
              <th>Durchgeführt von</th>
              <th className="r" style={{ width: 300 }}>
                <span className="sr-only">Aktion</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <VorgangZeile
                key={e.id}
                e={e}
                from="no-shows"
                zusatz={zusatz?.(e)}
                pending={h.pendingFor(e)}
                ergebnis={h.ergebnisFuer(e)}
                onGenervt={() => h.onGenervt(e)}
                onNeuerTermin={(v) => h.onNeuerTermin(e, v)}
                onTot={() => void h.onTot(e)}
              />
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-7)" }}>
      {h.dialog}
      {fehler && <div className="vg-fehler card">{fehler}</div>}

      <section className="card vg-card">
        <header className="vg-head">
          <h2 className="vg-title">Erstgespräch</h2>
          <span className="vg-meta">{settingRows.length.toLocaleString("de-DE")} · nur, was du gelegt hast</span>
          <div className="vg-head-r">
            <Link href="/nachfassen" className="vg-link">
              In „Heute“ nachfassen <ArrowRight size={13} aria-hidden />
            </Link>
          </div>
        </header>
        {tabelle(
          settingRows,
          "Kein Erstgespräch auf No-Show. Wer nicht erschienen ist und einen neuen Termin hat, steht wieder im Kalender.",
          (e) => {
            const k = herkunft[e.refId];
            return k ? HERKUNFT_LABEL[k] : undefined;
          },
        )}
        <div className="keys">
          <span>
            Je Lead zählt das jüngste Erstgespräch. „Nicht erschienen, keine Antwort“ steht in der Ablage, nicht hier.
          </span>
        </div>
      </section>

      <section className="card vg-card">
        <header className="vg-head">
          <h2 className="vg-title">Closing</h2>
          <span className="vg-meta">{closingRows.length.toLocaleString("de-DE")}</span>
          {canSeeAll && (
            <div className="vg-head-r">
              <Segmented
                options={[
                  { value: "mein", label: "Meine" },
                  { value: "alle", label: "Alle" },
                ]}
                value={wer}
                onChange={setWer}
                size="sm"
                ariaLabel="Person"
              />
            </div>
          )}
        </header>
        {tabelle(closingRows, "Kein Closing auf No-Show.")}
      </section>
    </div>
  );
}
