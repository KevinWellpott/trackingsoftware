"use client";

import { formatTerminParts } from "@/lib/apptTime";
import type { PhoneLead, PhoneLeadStatus } from "@/lib/types";
import { Phone, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

// Listenseite /telefon/[listId] (Redesign Phase 5): Status-Reiter mit Zahlen
// und die Leads mit Anrufzahl und nächstem Schritt. Durchtelefoniert wird im
// Call-Modus (`?modus=anrufen`); „Anrufen" an einer Zeile öffnet ihn genau bei
// diesem Lead.

type Reiter = "alle" | "neu" | "rueckruf" | "nicht_erreicht" | "kein_termin" | "termin" | "dead";

const REITER: { value: Reiter; label: string }[] = [
  { value: "alle", label: "Alle" },
  { value: "neu", label: "Noch nie angerufen" },
  { value: "rueckruf", label: "Rückruf" },
  { value: "nicht_erreicht", label: "Nicht erreicht" },
  { value: "kein_termin", label: "Kein Termin" },
  { value: "termin", label: "Termin" },
  { value: "dead", label: "Tot" },
];

const STATUS: Record<PhoneLeadStatus, { label: string; color: string }> = {
  aktiv: { label: "Offen", color: "var(--text-muted)" },
  rueckruf: { label: "Rückruf", color: "var(--info)" },
  nicht_erreicht: { label: "Nicht erreicht", color: "var(--warning)" },
  kein_termin: { label: "Kein Termin", color: "var(--text-subtle)" },
  termin: { label: "Termin", color: "var(--success)" },
  dead: { label: "Tot", color: "var(--danger)" },
};

const OFFEN: ReadonlySet<PhoneLeadStatus> = new Set(["aktiv", "rueckruf", "nicht_erreicht"]);

/** Noch nie angerufen: kein Erstkontakt, kein Versuch, kein Ergebnis. */
export function nieAngerufen(l: Pick<PhoneLead, "first_call_at" | "call_attempt" | "status">): boolean {
  return !l.first_call_at && !(l.call_attempt ?? 0) && l.status === "aktiv";
}

const SEITE = 200;

export function PhoneListOverview({
  leads,
  listId,
  jetztMs,
}: {
  leads: PhoneLead[];
  listId: string;
  /** Referenzzeit vom Server — Rückruf „fällig" ohne Uhr im Render. */
  jetztMs: number;
}) {
  const [reiter, setReiter] = useState<Reiter>("alle");
  const [suche, setSuche] = useState("");
  const [limit, setLimit] = useState(SEITE);

  const counts = useMemo(() => {
    const c: Record<Reiter, number> = { alle: leads.length, neu: 0, rueckruf: 0, nicht_erreicht: 0, kein_termin: 0, termin: 0, dead: 0 };
    for (const l of leads) {
      if (nieAngerufen(l)) c.neu += 1;
      if (l.status !== "aktiv") c[l.status] += 1;
    }
    return c;
  }, [leads]);

  const zeilen = useMemo(() => {
    const q = suche.trim().toLowerCase();
    return leads.filter(
      (l) =>
        (reiter === "alle" || (reiter === "neu" ? nieAngerufen(l) : l.status === reiter)) &&
        (!q ||
          (l.company ?? "").toLowerCase().includes(q) ||
          (l.decider_name ?? "").toLowerCase().includes(q) ||
          (l.phone ?? "").toLowerCase().includes(q)),
    );
  }, [leads, reiter, suche]);

  return (
    <section className="card tel-card">
      <header className="tel-card-head" style={{ flexWrap: "wrap" }}>
        <div className="tel-tabs" role="tablist" aria-label="Status">
          {REITER.map((r) => (
            <button
              key={r.value}
              type="button"
              role="tab"
              aria-selected={reiter === r.value}
              onClick={() => {
                setReiter(r.value);
                setLimit(SEITE);
              }}
            >
              {r.label} <span className="tnum">{counts[r.value].toLocaleString("de-DE")}</span>
            </button>
          ))}
        </div>
        <div style={{ position: "relative", marginLeft: "auto", minWidth: 200 }}>
          <Search size={13} className="cm-search-icon" aria-hidden />
          <input
            className="input tel-search"
            type="search"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder="Firma, Name, Nummer…"
            aria-label="Leads suchen"
            style={{ paddingLeft: 30 }}
          />
        </div>
      </header>

      {zeilen.length === 0 ? (
        <p className="tel-empty">Keine Leads in diesem Reiter.</p>
      ) : (
        <div className="tel-tw">
          <table className="tel-table">
            <thead>
              <tr>
                <th>Firma</th>
                <th>Status</th>
                <th className="r">Anrufe</th>
                <th>Nächster Schritt</th>
                <th className="r" aria-label="Aktion" />
              </tr>
            </thead>
            <tbody>
              {zeilen.slice(0, limit).map((l) => {
                const s = STATUS[l.status];
                const faellig = l.status === "rueckruf" && !!l.callback_at && Date.parse(l.callback_at) <= jetztMs;
                const cb = formatTerminParts(l.callback_at);
                const ap = formatTerminParts(l.appointment_at);
                const naechster =
                  l.status === "rueckruf" && cb
                    ? `Rückruf ${cb.date} ${cb.time}`
                    : l.status === "termin" && ap
                      ? `Erstgespräch ${ap.date} ${ap.time}`
                      : OFFEN.has(l.status)
                        ? nieAngerufen(l)
                          ? "Erstanruf"
                          : "Wiederholen"
                        : null;
                const href = `/telefon/${listId}?modus=anrufen&lead=${l.id}${OFFEN.has(l.status) ? "" : `&status=${l.status}`}`;
                return (
                  <tr key={l.id}>
                    <td className="tel-main">
                      <span className="tel-nm">{l.company || l.phone || "—"}</span>
                      {l.decider_name && <span className="tel-co">{l.decider_name}</span>}
                    </td>
                    <td>
                      <span className="tel-st">
                        <i style={{ background: s.color }} />
                        {nieAngerufen(l) ? "Noch nie angerufen" : s.label}
                        {l.status === "nicht_erreicht" && (l.call_attempt ?? 0) > 0 ? ` · ${l.call_attempt}×` : ""}
                      </span>
                    </td>
                    <td className="r tnum tel-muted">{l.call_attempt ?? 0}</td>
                    <td className={`tnum ${faellig ? "tel-gold" : naechster ? "" : "tel-faint"}`}>
                      {faellig ? `Rückruf fällig · ${cb?.time ?? ""}` : (naechster ?? "—")}
                    </td>
                    <td className="r">
                      <Link className="ui-btn" data-variant="ghost" data-size="sm" href={href} style={{ minHeight: 28, padding: "0 10px" }}>
                        <Phone size={13} aria-hidden /> Anrufen
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {zeilen.length > limit && (
            <div style={{ padding: "10px 16px 14px", textAlign: "center" }}>
              <button type="button" className="btn-secondary" onClick={() => setLimit((n) => n + SEITE)}>
                Weitere {Math.min(SEITE, zeilen.length - limit).toLocaleString("de-DE")} von{" "}
                {(zeilen.length - limit).toLocaleString("de-DE")} anzeigen
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
