import Link from "next/link";
import { DROPOUT_LISTS, type DropoutListKey } from "@/lib/dropoutLists";

// Umschaltung zwischen den sechs Ablage-Ansichten.
//
// Bewusst `Link`s statt Knöpfen mit `router.replace` wie in der Analyse-
// Filterleiste: Dort hängen sieben Filter aneinander, die sich beim Tabwechsel
// gegenseitig aufräumen müssen — hier gibt es genau EINEN Parameter. Als Links
// bleibt die Leiste eine Server-Komponente, die Ansichten sind teilbar und
// stehen im Verlauf des Browsers.
//
// Optik ist die Flow-Tab-Leiste der Analyse (.tab-scroller/.ui-tab,
// COMPONENTS.md §10.3): Text mit Orange-Unterstrich, auf schmalen Viewports
// scrollt die Reihe, statt umzubrechen.

export function AblageNav({
  active,
  counts,
}: {
  active: DropoutListKey;
  /** Fehlt ein Zähler (Abfrage fehlgeschlagen), bleibt der Reiter ohne Pille. */
  counts: Partial<Record<DropoutListKey, number>>;
}) {
  return (
    <nav className="tab-scroller" aria-label="Ablage-Listen">
      {DROPOUT_LISTS.map((l) => {
        const isActive = l.key === active;
        const count = counts[l.key];
        return (
          <Link
            key={l.key}
            href={`/ablage?liste=${l.key}`}
            className="ui-tab"
            data-active={isActive}
            aria-current={isActive ? "page" : undefined}
            title={l.meta}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--sp-3)",
              flexShrink: 0,
              whiteSpace: "nowrap",
              textDecoration: "none",
            }}
          >
            {l.tab}
            {/* Nur die eine Liste mit offener Handlung trägt eine hervorgehobene
                Zahl — dieselbe, die auch als einzige ein Badge in der
                Seitenleiste bekommt. Ohne diesen Unterschied sähen sechs
                gleichaussehende Zahlen so aus, als warte überall Arbeit. */}
            {count != null && (
              <span className="count-pill" data-tone={l.openAction && count > 0 ? "accent" : undefined}>
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
