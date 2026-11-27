# Design — „Liquid Glass" (ab Release Dezember 2026)

Löst `NEW DESGIN/DESIGN.md` („Ember Glass", nur dunkel) ab. Visuelle Quelle ist der abgenommene
Prototyp (`D:\Tracking\redesign-liquid-glass\prototyp.html`, nicht im Repo); fachliche Quelle
bleibt `docs/data-model.md` — sie geht der Optik immer vor.

## Wo was steht

| Was | Datei |
|---|---|
| Tokens, Glas-Rezept, Komponenten, Kalender, Motion | `src/app/globals.css` (Inhaltsverzeichnis im Kopf; §10 Telefon/Call-Modus, §11 Navigation/Ansichten) |
| Hell/Dunkel, Glas/Solide | `src/lib/appearance.ts` (Cookies `tt-theme`, `tt-material`), Pre-Paint-Script in `src/app/layout.tsx`, Umschalter `src/components/ui/Appearance.tsx` |
| Zeiger-Glanz auf Glas | `src/components/ui/GlassPointer.tsx` (setzt `--lx`) |
| Diagrammfarben | `src/lib/viz.ts` → `var(--viz-*)` |
| Status-Rahmen der Termin-Chips | `src/lib/terminMeta.ts` (`outlineFor`) — die einzige Quelle |

## Regeln, die nicht verhandelbar sind

1. **Arbeit liegt auf festem Papier (`.card`), Werkzeuge sind Glas (`.glass`).** Glas tragen nur
   Seitenleiste, Kopfleiste, Tab-Leiste, Popover, Suche, das Ergebnis-Dock im Call-Modus.
   Höchstens vier Glasflächen gleichzeitig, nie auf scrollenden Zeilen, nie den Unschärferadius
   animieren. `data-material="solid"` ersetzt Glas durch deckende Flächen (Barrierefreiheit,
   schwache Geräte).
2. **Orange (`--accent`) ist Aktion, kein Dekor** — ein Primärknopf je Ansicht. Text auf Orange ist
   dunkle Tinte (`--on-accent`, Entscheidung E1), nicht Weiß.
3. **Gold (`--gold`) heißt „du bist dran"** — und nur das. Markenorange trägt nie Status.
4. **Rot (fremde Organisation) und Orange (fremde Datensicht) sind Status** und sitzen als
   Kontextzeile unter dem Personenmenü; sie werden nicht wegdesignt.
5. **Termin-Art ist Tönung, Status ist Rahmen:** Setting violett (`--set-tint`/`--set-ink`),
   Closing petrol (`--clo-tint`/`--clo-ink`); durchgezogen / gestrichelt / abgeblendet aus
   `outlineFor`. Eine Absage ist ein eigener Pill „Abgesagt".
6. **Keine festen Farben in Komponenten.** Hex-Werte nur in den Token-Blöcken; Tests prüfen das
   für Seitenleiste und Dashboard.
7. **Nie Schriftgewicht 700.** Schrift Inter (optische Größen).
8. **Hell ist vollwertig:** jeder Token hat einen Hell-Wert in `:root[data-theme="light"]`,
   Text erreicht mindestens 4,5:1 gegen das Lichtfeld. Auf Glas steigt die gedämpfte Textstufe
   eine Stufe (`.glass` setzt `--text-muted` auf `--text-secondary`).
9. **Zahlen ehrlich:** „—" statt 0, wo es keine Basis gibt; Beträge mit zwei Nachkommastellen und
   gedämpftem €-Zeichen (`components/umsatz/Betrag.tsx`); DMs und Anwahlen werden nie addiert.

## Legacy-Brücke

Alte Variablennamen (`--surface-*`, `--text-*`, `--accent-*` …) zeigen auf die neuen Werte
(§2 in `globals.css`). Neue Komponenten benutzen die neuen Namen; die Brücke fällt, sobald keine
Datei mehr einen alten Namen liest.
