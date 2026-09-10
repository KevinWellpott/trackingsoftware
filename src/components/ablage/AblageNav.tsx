import Link from "next/link";
import { DROPOUT_LISTS, type DropoutListKey } from "@/lib/dropoutLists";

// Umschaltung zwischen den beiden Ablage-Ansichten.
//
// Bewusst `Link`s statt Knöpfen mit `router.replace` wie in der Analyse-
// Filterleiste: Dort hängen sieben Filter aneinander, die sich beim Tabwechsel
// gegenseitig aufräumen müssen — hier gibt es genau EINEN Parameter. Als Links
// bleibt die Leiste eine Server-Komponente, die Ansichten sind teilbar und
// stehen im Verlauf des Browsers.
//
// OHNE ZÄHLER, seit aus sechs Reitern zwei geworden sind. Zwei Gründe, und der
// zweite ist der schwerere:
//  · Die eine Zahl, die etwas verlangte, ist weg. Sie hing an „Ersatztermin
//    steht aus" — der einzigen Ablage-Liste mit offener Handlung, und die steht
//    jetzt in der Hauptliste. Was bleibt, ist Archiv, und ein Archiv mahnt
//    nicht: Eine Zahl, die man nicht abarbeiten kann, ist kein Hinweis.
//  · „Ausgeschieden" ließe sich gar nicht ehrlich zählen, ohne es zu laden.
//    Die Ansicht legt vier RPC-Aufrufe zusammen und entdoppelt sie; die Summe
//    der vier Einzelzähler wäre größer als die Liste darunter (dieselbe Zeile
//    kann in mehreren Quellen stehen). Eine Zahl, die der Liste widerspricht,
//    ist schlimmer als keine.
// Wie viele Vorgänge die geöffnete Ansicht trägt, steht weiterhin im Seitenkopf
// — dort ist es die Zahl der Zeilen, die man wirklich sieht.
//
// Optik ist die Flow-Tab-Leiste der Analyse (.tab-scroller/.ui-tab,
// COMPONENTS.md §10.3): Text mit Orange-Unterstrich, auf schmalen Viewports
// scrollt die Reihe, statt umzubrechen.

export function AblageNav({ active }: { active: DropoutListKey }) {
  return (
    <nav className="tab-scroller" aria-label="Ablage-Listen">
      {DROPOUT_LISTS.map((l) => {
        const isActive = l.key === active;
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
          </Link>
        );
      })}
    </nav>
  );
}
