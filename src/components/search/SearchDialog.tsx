"use client";

import { globalSearch, type SearchHit, type SearchKind } from "@/app/actions/search";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SETTING_STATUS_LABEL } from "@/lib/settingLabels";
import { AlertTriangle, Handshake, MessageSquare, Phone, Search, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

// Globale Suche. Ausloeser: Lupe in Sidebar/Mobile-Header oder Strg/Cmd+Shift+F.
//
// Warum NICHT Strg/Cmd+K: das ist bereits der Schnell-Track (QuickAddLinkedIn).
// Ein bestehendes Kuerzel umzubelegen kostet mehr, als es bringt.
//
// Die Abfrage laeuft entprellt gegen eine Server-Action. Jede Antwort traegt
// ihre laufende Nummer; nur die jeweils letzte darf das Ergebnis setzen —
// sonst ueberschreibt eine langsame frühere Antwort eine schnellere spaetere.

const DEBOUNCE_MS = 220;

// Die Quelle steht als Text daneben — eine eigene Farbe je Kanal traegt hier
// nichts bei und bringt vier weitere Hues ins Bild. Icons bleiben grau.
const KIND_META: Record<SearchKind, { label: string; icon: React.ReactNode }> = {
  contact: { label: "LinkedIn", icon: <MessageSquare size={13} /> },
  phone_lead: { label: "Telefon", icon: <Phone size={13} /> },
  setting: { label: "Setting", icon: <Users size={13} /> },
  closing: { label: "Closing", icon: <Handshake size={13} /> },
};

const KIND_ORDER: SearchKind[] = ["contact", "phone_lead", "setting", "closing"];

/** Status-Rohwerte lesbar machen; Listennamen bleiben, wie sie sind. */
function contextLabel(hit: SearchHit): string | null {
  if (!hit.context) return null;
  if (hit.kind === "setting") return SETTING_STATUS_LABEL[hit.context as keyof typeof SETTING_STATUS_LABEL] ?? hit.context;
  if (hit.kind === "closing") return hit.context.charAt(0).toUpperCase() + hit.context.slice(1);
  return hit.context;
}

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [searched, setSearched] = useState(false);
  // Fehlschlag getrennt von „nichts gefunden": beides sah frueher gleich aus,
  // und ein abgelaufener Cookie oder ein Timeout blieb dadurch unsichtbar.
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  // Beim Schliessen zuruecksetzen, damit der naechste Aufruf leer startet.
  // Waehrend des Renderns statt im Effekt — ein Effekt wuerde nach dem Paint
  // eine zweite Renderrunde ausloesen.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setQuery("");
      setHits([]);
      setTruncated(false);
      setSearched(false);
      setFailed(false);
    }
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function onQuery(value: string) {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    const mine = ++seq.current;
    if (value.trim().length < 2) {
      setHits([]);
      setSearched(false);
      setFailed(false);
      return;
    }
    timer.current = setTimeout(() => {
      startTransition(async () => {
        try {
          const res = await globalSearch(value);
          if (mine !== seq.current) return; // veraltete Antwort verwerfen
          setHits(res.hits);
          setTruncated(res.truncated);
          setFailed(res.failed);
          setSearched(true);
        } catch {
          // Netzwerk-/Serverfehler der Action selbst. Ohne diesen Zweig bliebe
          // das alte Ergebnis stehen und der Fehler waere nicht zu bemerken.
          if (mine !== seq.current) return;
          setHits([]);
          setTruncated(false);
          setFailed(true);
          setSearched(true);
        }
      });
    }, DEBOUNCE_MS);
  }

  function go(href: string) {
    onClose();
    router.push(href);
  }

  const groups = KIND_ORDER.map((k) => ({ kind: k, items: hits.filter((h) => h.kind === k) })).filter(
    (g) => g.items.length > 0,
  );

  return (
    <Modal open={open} onClose={onClose} title="Suche" subtitle="Kontakte, Leads und Termine über alle Listen" width={560}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
        <div style={{ position: "relative" }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: "0.75rem",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-subtle)",
              pointerEvents: "none",
            }}
          />
          <Input
            autoFocus
            type="search"
            placeholder="Name, Firma oder Telefonnummer…"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            aria-label="Suchbegriff"
            style={{ paddingLeft: "2.25rem" }}
          />
        </div>

        {query.trim().length > 0 && query.trim().length < 2 && (
          <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
            Mindestens zwei Zeichen.
          </p>
        )}

        {/* Fehlschlag hat Vorrang vor dem Leer-Text: „nichts gefunden" waere
            hier eine Falschaussage — gesucht wurde gar nicht zu Ende. */}
        {searched && failed && (
          <div
            role="status"
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "var(--sp-3)",
              padding: "var(--sp-4) var(--sp-5)",
              borderRadius: "var(--r-sm)",
              background: "var(--danger-bg)",
              border: "1px solid var(--danger)",
            }}
          >
            <AlertTriangle size={14} color="var(--danger-fg)" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
            <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--danger-fg)" }}>
              {groups.length > 0
                ? "Ein Teil der Suche ist fehlgeschlagen — das Ergebnis kann unvollständig sein."
                : "Suche fehlgeschlagen. Bitte erneut versuchen; besteht der Fehler weiter, ist die Sitzung womöglich abgelaufen."}
            </p>
          </div>
        )}

        {searched && !failed && groups.length === 0 && (
          <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
            Nichts gefunden für &bdquo;{query.trim()}&ldquo;.
          </p>
        )}

        {groups.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)", maxHeight: "56dvh", overflowY: "auto" }}>
            {groups.map((g) => {
              const meta = KIND_META[g.kind];
              return (
                <section key={g.kind}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", marginBottom: "var(--sp-4)" }}>
                    <span style={{ color: "var(--text-muted)", display: "inline-flex" }}>{meta.icon}</span>
                    <span className="eyebrow eyebrow-muted">{meta.label}</span>
                    <span className="count-pill">{g.items.length}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {g.items.map((h) => (
                      <button
                        key={`${h.kind}-${h.id}`}
                        type="button"
                        onClick={() => go(h.href)}
                        className="lbv2-editable"
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: "var(--sp-4)",
                          width: "100%",
                          textAlign: "left",
                          background: "none",
                          border: "none",
                          borderRadius: "var(--r-sm)",
                          padding: "var(--sp-4) var(--sp-5)",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "var(--fs-base)",
                            fontWeight: 500,
                            color: "var(--text-primary)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {h.title}
                        </span>
                        {h.subtitle && (
                          <span
                            style={{
                              fontSize: "var(--fs-xs)",
                              color: "var(--text-muted)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {h.subtitle}
                          </span>
                        )}
                        {/* Der eigentliche Mehrwert: WO der Treffer liegt. */}
                        {contextLabel(h) && (
                          <span
                            style={{
                              marginLeft: "auto",
                              flexShrink: 0,
                              fontSize: "var(--fs-2xs)",
                              color: "var(--text-subtle)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {contextLabel(h)}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {truncated && (
          // Stille Kappung waere schlimmer als der Hinweis: sonst liest sich
          // ein unvollstaendiges Ergebnis wie ein vollstaendiges.
          <p style={{ margin: 0, fontSize: "var(--fs-2xs)", color: "var(--text-subtle)" }}>
            Nur die ersten 25 Treffer je Bereich — Suchbegriff verfeinern für vollständige Ergebnisse.
          </p>
        )}
      </div>
    </Modal>
  );
}

/**
 * Lupe + Dialog + Tastenkürzel als eine Einheit.
 *
 * `nav` ist die Sidebar-Zeile, `icon` der runde Knopf im Mobile-Header. Das
 * Kürzel haengt am Trigger, nicht am Dialog — es soll auch greifen, solange
 * der Dialog nie geoeffnet wurde.
 */
export function SearchTrigger({
  variant = "nav",
  onNavigate,
}: {
  variant?: "nav" | "icon";
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const navStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "var(--sp-4)",
    width: "100%",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    textAlign: "left",
  };

  const iconStyle: React.CSSProperties = {
    background: "transparent",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--r-full)",
    cursor: "pointer",
    color: "var(--text-secondary)",
    width: 36,
    height: 36,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Suchen (Strg/Cmd+Shift+F)"
        aria-label="Suchen"
        className={variant === "nav" ? "sidebar-link" : undefined}
        style={variant === "nav" ? navStyle : iconStyle}
      >
        <Search size={variant === "nav" ? 16 : 18} style={{ flexShrink: 0 }} />
        {variant === "nav" && <span style={{ flex: 1 }}>Suchen</span>}
      </button>
      <SearchDialog
        open={open}
        onClose={() => {
          setOpen(false);
          onNavigate?.();
        }}
      />
    </>
  );
}
