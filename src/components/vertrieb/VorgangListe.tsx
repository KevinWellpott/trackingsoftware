"use client";

// Die Listen /setting und /closing (Redesign Phase 4): alle Termin-Zeilen
// EINER Art, geschnitten nach Ergebnis.
//
// Datenquelle und Ableitung sind die des Kalenders — `buildEvents`
// (src/lib/termine.ts) liefert je Zeile den abgeleiteten Zustand, Rahmen,
// Zuweisung und „Durchgeführt von". Diese Datei rechnet nichts davon neu,
// sie schneidet nur: Segment (src/lib/vorgangSegmente.ts), Personenachse
// (`?wer=`, wie /termine) und Suche.
//
// Die Handgriffe einer Zeile sind dieselben wie in der Terminliste
// (useTerminHandgriffe): Genervt · Termin · Tot, und für einen begonnenen
// Termin ohne Ergebnis die Ergebnis-Schnellknöpfe.

import { Segmented } from "@/components/ui/Segmented";
import { TerminAktionen } from "@/components/termine/TerminAktionen";
import { formatTerminParts } from "@/lib/apptTime";
import { istBearbeitbar, TERMIN_ZUSTAND_LABEL, type TerminZustand } from "@/lib/dranRegel";
import { buildEvents, type TerminEvent, type WithCancellation } from "@/lib/termine";
import type { ClosingCall, SettingCall } from "@/lib/types";
import {
  CLOSING_SEGMENTE,
  closingSegmentVon,
  SETTING_SEGMENTE,
  settingSegmentVon,
  type ClosingSegment,
  type SettingSegment,
} from "@/lib/vorgangSegmente";
import { EUR_FMT } from "@/lib/terminMeta";
import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useTerminHandgriffe } from "./useTerminHandgriffe";

type Segment = SettingSegment | ClosingSegment;

/**
 * Beschriftung des Zustands in DIESER Liste. Zwei Wörter weichen von
 * `TERMIN_ZUSTAND_LABEL` ab, und zwar mit Absicht: „Offen" hieße hier neben
 * dem Segment „Ohne Ergebnis" etwas anderes als der gespeicherte Status
 * `offen` (docs §1) — deshalb „Kein Termin", wie im Prototyp.
 */
const ZUSTAND_TEXT: Partial<Record<TerminZustand, string>> = {
  offen: "Kein Termin",
  show: "Erschienen, ohne Ergebnis",
  no_show: "Nicht erschienen",
};

/** Punktfarbe des Status — höchstens EIN farbiges Element je Zeile. */
function punktTon(z: TerminZustand): "green" | "red" | "ring" | undefined {
  if (z === "close" || z === "qualifiziert" || z === "closing_gelegt") return "green";
  if (z === "tot" || z === "kein_close" || z === "nicht_qualifiziert" || z === "no_show") return "red";
  if (z === "show") return "ring";
  return undefined;
}

export function zustandText(e: TerminEvent): string {
  if (e.kind === "closing" && e.status === "nachfassen" && e.zustand !== "verlegt") return "Nachfassen";
  return ZUSTAND_TEXT[e.zustand] ?? TERMIN_ZUSTAND_LABEL[e.zustand];
}

export function VorgangListe({
  kind,
  settings,
  closings,
  members,
  today,
  scopeUserId,
  canSeeAll,
  segment,
}: {
  kind: "setting" | "closing";
  settings: WithCancellation<SettingCall>[];
  closings: WithCancellation<ClosingCall>[];
  members: { user_id: string; username: string }[];
  /** Berliner Kalendertag vom Server (docs §6). */
  today: string;
  /** `effective_user_id ?? user.id` — wessen Zeilen „Mein" zeigt. */
  scopeUserId: string;
  /** Nur ein Owner mit Team-Sicht darf „Alle" schalten. */
  canSeeAll: boolean;
  segment: Segment;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const wer = canSeeAll && sp.get("wer") === "alle" ? "alle" : "mein";
  const [suche, setSuche] = useState(sp.get("q") ?? "");
  const [fehler, setFehler] = useState<string | null>(null);

  // Uhr für Ergebnis-Schnellknöpfe und Erinnerungen — `null` bis zum ersten
  // Tick, damit Server und Browser dasselbe rendern (Muster TermineBoard).
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  const names = useMemo(() => new Map(members.map((m) => [m.user_id, m.username])), [members]);
  const alle = useMemo(() => {
    const { events, ohneTermin } = buildEvents(settings, closings, names, today, nowMs);
    return [...events, ...ohneTermin].filter((e) => e.kind === kind);
  }, [settings, closings, names, today, nowMs, kind]);

  const segmentVon = (e: TerminEvent): Segment =>
    kind === "setting" ? settingSegmentVon(e.zustand) : closingSegmentVon(e.zustand, e.status);

  // Personenachse wie /termine: wer gelegt hat, nach einem Gespräch ohne
  // Ergebnis wer es geführt hat (`erinnererOf`). „Alle" nur mit Team-Sicht.
  const sichtbar = useMemo(() => {
    const q = suche.trim().toLowerCase();
    return alle.filter((e) => {
      if (wer === "mein" && e.assignee?.user_id !== scopeUserId) return false;
      if (q && !`${e.title} ${e.company ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [alle, wer, scopeUserId, suche]);

  const zahlen = useMemo(() => {
    const m = new Map<Segment, number>();
    for (const e of sichtbar) m.set(segmentVon(e), (m.get(segmentVon(e)) ?? 0) + 1);
    m.set("alle", sichtbar.length);
    return m;
    // segmentVon hängt nur an `kind`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sichtbar, kind]);

  const zeilen = useMemo(() => {
    const rows = segment === "alle" ? sichtbar : sichtbar.filter((e) => segmentVon(e) === segment);
    // Ohne Ergebnis: nächster Termin zuerst, Zeilen ohne Termin oben. Sonst:
    // jüngster Termin zuerst — das zuletzt Entschiedene interessiert zuerst.
    const key = (e: TerminEvent) => `${e.dayISO ?? "0000-00-00"}T${String(e.startMin).padStart(4, "0")}`;
    const asc = segment === "ohne_ergebnis";
    return [...rows].sort((a, b) => (asc ? key(a).localeCompare(key(b)) : key(b).localeCompare(key(a))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sichtbar, segment, kind]);

  const { pendingFor, onGenervt, onNeuerTermin, onTot, ergebnisFuer, dialog } = useTerminHandgriffe(setFehler, nowMs);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(sp.toString());
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const optionen = (kind === "setting" ? SETTING_SEGMENTE : CLOSING_SEGMENTE).map((o) => ({
    value: o.value as Segment,
    label: `${o.label} ${(zahlen.get(o.value) ?? 0).toLocaleString("de-DE")}`,
  }));

  return (
    <section className="card vg-card">
      {dialog}
      <header className="vg-head">
        <Segmented
          options={optionen}
          value={segment}
          onChange={(v) => setParam("status", v === "ohne_ergebnis" ? null : v)}
          ariaLabel="Ergebnis"
        />
        <div className="vg-head-r">
          {canSeeAll && (
            <Segmented
              options={[
                { value: "mein", label: "Meine" },
                { value: "alle", label: "Alle" },
              ]}
              value={wer}
              onChange={(v) => setParam("wer", v === "mein" ? null : v)}
              size="sm"
              ariaLabel="Person"
            />
          )}
          <label className="vg-search">
            <Search size={14} aria-hidden />
            <input
              value={suche}
              onChange={(ev) => setSuche(ev.target.value)}
              onBlur={() => setParam("q", suche.trim() || null)}
              placeholder="Lead oder Firma"
              aria-label="Suchen"
            />
          </label>
        </div>
      </header>

      {fehler && <div className="vg-fehler">{fehler}</div>}

      {zeilen.length === 0 ? (
        <div className="vg-leer">
          {sichtbar.length === 0
            ? wer === "mein"
              ? "Hier steht nichts, das du gelegt hast."
              : "Hier steht noch nichts."
            : "In diesem Ausschnitt steht gerade nichts."}
        </div>
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
              {zeilen.map((e) => (
                <VorgangZeile
                  key={e.id}
                  e={e}
                  pending={pendingFor(e)}
                  ergebnis={ergebnisFuer(e)}
                  onGenervt={() => onGenervt(e)}
                  onNeuerTermin={(v) => onNeuerTermin(e, v)}
                  onTot={() => void onTot(e)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="keys">
        <span>Gold: eine der zwei Erinnerungen vor dem Termin ist offen.</span>
        <span>„Gelegt von“ nervt und erinnert · „Durchgeführt von“ bekommt das Gespräch in der Analyse.</span>
      </div>
    </section>
  );
}

export function VorgangZeile({
  e,
  from,
  zusatz,
  pending,
  ergebnis,
  onGenervt,
  onNeuerTermin,
  onTot,
}: {
  e: TerminEvent;
  /** Rückweg der Detailseite (`?from=`, components/ui/BackLink.tsx) — Vorgabe: die Termin-Art. */
  from?: string;
  /** Kleiner Hinweis hinter dem Namen (z. B. die Herkunft auf /no-shows). */
  zusatz?: string;
  pending: boolean;
  ergebnis: React.ReactNode;
  onGenervt: () => void;
  onNeuerTermin: (berlinInput: string) => void;
  onTot: () => void;
}) {
  const termin = formatTerminParts(e.at);
  const detail = `${e.href}?from=${from ?? e.kind}`;
  const ende = e.zustand === "tot" || e.zustand === "kein_close" || e.zustand === "close";
  const ton = punktTon(e.zustand);
  return (
    <tr
      data-dran={e.dran ? "true" : undefined}
      data-ended={ende ? "true" : undefined}
      style={{ opacity: pending ? 0.5 : 1 }}
    >
      <td className="c-mark">
        <span className="dran-mark" data-dran={e.dran ? "true" : undefined} aria-label={e.dran ? "Erinnerung offen" : undefined} />
      </td>
      <td>
        <Link href={detail} className="line1 vg-lead">
          <span className="nm">{e.title}</span>
          {e.company && <span className="co">{e.company}</span>}
          {zusatz && <span className="co">· {zusatz}</span>}
        </Link>
      </td>
      <td>
        <span className="status" data-tone={ton}>
          <i />
          {zustandText(e)}
        </span>
        {e.cancelled && (
          <span className="badge" style={{ marginLeft: 8 }}>
            Abgesagt
          </span>
        )}
        {e.zustand === "close" && e.dealVolume != null && (
          <span className="num faint" style={{ marginLeft: 8 }}>
            {EUR_FMT.format(e.dealVolume)}
          </span>
        )}
      </td>
      <td className={`num ${termin ? "muted" : "faint"}`}>{termin ? `${termin.date} ${termin.time}` : "—"}</td>
      <td className={e.assignee ? "muted" : "faint"}>{e.assignee?.username ?? "—"}</td>
      <td className={e.conductedBy ? "muted" : "faint"}>{e.conductedBy?.username ?? "—"}</td>
      <td className="r">
        <div className="ra">
          {ergebnis ??
            (istBearbeitbar(e.zustand) ? (
              <TerminAktionen
                event={e}
                pending={pending}
                onGenervt={onGenervt}
                onNeuerTermin={onNeuerTermin}
                onTot={onTot}
              />
            ) : (
              <Link href={detail} className="faint vg-detail">
                Details
              </Link>
            ))}
        </div>
      </td>
    </tr>
  );
}
