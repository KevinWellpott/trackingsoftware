# Ember Glass — CRM-Komponenten

> **Status:** v1 · 2026-07 · gehört zu `DESIGN.md` (Regeln & Tokens) und `tokens.css` (Werte)
> **Geltungsbereich:** CRM/Akquise-Produktlinie — Referenz-Routen aus titan-tracking: `/telefon`, `/linkedin`, `/setting`, `/closing`, `/nachfassen`, `/heute`, `/auswertung`, `/admin`.

---

## 1. Lesart & Spez-Format

Jede Komponente wird in festen Blöcken beschrieben:

- **Zweck** — wofür sie existiert
- **Anatomie** — ihre Teile, von außen nach innen
- **Spezifikation** — Maße, Farben, Typo als Token-Tabelle
- **Zustände** — Default / Hover / Active / Focus / Selected / Disabled / Loading / Empty (soweit zutreffend)
- **Verhalten** — Maus, Keyboard, Touch
- **Do / Don't**
- **Referenz-Route** — wo sie in titan-tracking primär vorkommt

Alle Werte referenzieren `tokens.css`. Steht ein Wert nicht dort, gehört er nicht ins UI.

---

## 2. Buttons

### 2.1 Primär — „Signature Pill"

**Zweck:** Der eine Brand-CTA pro View („Anrufen", „Erstgespräch anfragen", „Übergeben").

**Anatomie:** Pill → Gradient-Füllung → Licht-Lippe (oben) → Hairline-Inset → Außenring → Label (+ optionales Icon links).

**Spezifikation:**

| Eigenschaft | Wert |
|---|---|
| Höhe | `--h-control-lg` 40px (Standalone) · `--h-control` 32px (in Toolbars) |
| Padding | 0 `--sp-8` (24px) |
| Radius | `--r-full` |
| Füllung | `--grad-cta` (`#F97316 → #EA580C`) |
| Insets | `--shadow-btn-primary` (Lippe `rgba(255,255,255,0.086)` + Hairline `#EA580C`) |
| Ring | `0 0 0 2px var(--orange-600)` |
| Text | `--text-on-accent` · 14px · 600 |

**Zustände:** Hover `--grad-cta-hover` + `--glow-accent` · Active `scale(0.98)` + `--accent-active` · Focus Doppelring (DESIGN.md 12) · Disabled: Füllung `--surface-3`, Text `--text-disabled`, keine Insets · Loading: Spinner ersetzt Icon, Label bleibt.

**Verhalten:** Enter/Space löst aus; bei Loading kein Doppel-Submit.

**Do / Don't:** ✅ genau einer pro View · ❌ nie in Tabellenzeilen oder Listen · ❌ nie mit kleinerem Text als 14px/600 (Kontrast-Regel DESIGN.md 3.8).

**Referenz-Route:** `/telefon` (Anruf starten), `/heute`.

### 2.2 Sekundär

Fläche `--surface-2`, Border `--border-default`, Text `--text-primary` 500, Radius `--r-md`, Höhe `--h-control`. Hover: `--surface-3` + `--border-strong`. Der Arbeits-Button für alles Nicht-Primäre.

### 2.3 Ghost / Quiet

Transparent, Text `--orange-300` 500 (Akzent-Aktionen) oder `--text-secondary` (neutrale Aktionen). Hover: Fläche `--surface-1`. Für Inline-Aktionen, Toolbars, Karten-Footer.

### 2.4 Destruktiv

Wie Sekundär, aber Border `--danger` bei 40 % und Text `--danger-fg`. Erst im Bestätigungs-Dialog wird die Fläche `--danger` mit dunklem Text. **Nie Orange für destruktive Aktionen.**

### 2.5 Icon-Button

32×32px (`--h-control`), Radius `--r-md`, Icon 16px Lucide (Override DESIGN.md 7). Ghost-Stil; Hover `--surface-1`. Immer mit `aria-label` und Tooltip.

### 2.6 Größen

| Größe | Höhe | Padding | Text |
|---|---|---|---|
| sm | 28px | 0 12px | 13px |
| md | 32px (`--h-control`) | 0 16px | 14px |
| lg | 40px (`--h-control-lg`) | 0 24px | 14px |

---

## 3. Formulare

### 3.1 Input

**Spezifikation:** Höhe `--h-control` · Fläche `--surface-1` · Border `--border-default` · Radius `--r-md` · Text 14px `--text-primary` · Placeholder `--text-muted` · Padding 0 `--sp-5`.

**Zustände:** Hover `--border-strong` · Focus `border-color: var(--orange-500)` + `box-shadow: 0 0 0 3px var(--accent-muted)` · Error: Border `--danger` + Fehlertext 12px `--danger-fg` darunter (nie nur Farbe — immer Text) · Disabled `--surface-0` + `--text-disabled`.

### 3.2 Select / Combobox

Wie Input + Chevron 16px `--text-muted` rechts. Dropdown-Menü = **Glass-Popover** (DESIGN.md 4.2), Option-Höhe 32px, aktive Option `--surface-3`, gewählte Option mit Check-Icon in `--orange-500`.

### 3.3 Textarea

Wie Input, min. 3 Zeilen, `--lh-base`, Padding `--sp-5`. Auto-Resize bis max. 10 Zeilen (z. B. Übergabe-Notizen).

### 3.4 Checkbox / Radio

16×16px, Radius `--r-xs` (Checkbox) / `--r-full` (Radio), Border `--border-strong`. Checked: Füllung `--orange-500`, Häkchen/Punkt in `#0A0A0B` (dunkel auf Orange = 7.1:1 — die barrierefreie Variante). Fokus: Doppelring.

### 3.5 Switch

36×20px, Track `--surface-3` → an: `--orange-500`. Thumb 16px `#FAFAFA`, Bewegung `--dur-1` / `--ease-in-out`.

### 3.6 Segmented Control

Container: Pill (`--r-full`), Fläche `--surface-1`, Border `--border-default`, Padding `--sp-1`. **Aktives Segment: Orange-Pill** (`--orange-500`) mit dunklem Text `#0A0A0B` (7.1:1 — die barrierefreie Variante des Landing-Track-Switchers, dessen aktive Pill ebenfalls `bg-primary` ist); inaktiv `--text-muted`, Hover `--text-primary`. Die aktive Pill gleitet per Layout-Animation zwischen den Segmenten (Landing: Spring `stiffness 400, damping 34`). Für Zeitraum-Umschalter („Heute / Woche / Monat") in `/auswertung`. Pfeiltasten wechseln Segmente.

### 3.7 Inline-Edit (Tabellenzelle)

Doppelklick oder Enter macht Zelle editierbar: Zelle erhält Input-Stil in Zeilenhöhe, Rest der Zeile bleibt stehen. Esc verwirft, Enter speichert, Tab springt zur nächsten editierbaren Zelle.

### 3.8 Formular-Layout

Label über dem Feld (12px, 500, `--text-secondary`), Abstand `--sp-3`; Feldgruppen-Abstand `--sp-7`. In `/admin`: Label links (200px Spalte) / Feld rechts. Pflichtfelder mit „*" in `--danger-fg`.

---

## 4. Badges & Status

### 4.1 Stage-Badge

**Zweck:** Pipeline-Phase eines Leads auf einen Blick.

**Anatomie:** Pill → 6px-Dot in Stagefarbe → Label.

**Spezifikation:** Höhe 22px · Padding 0 `--sp-4` · Radius `--r-full` · Fläche: Stagefarbe bei 10 % (z. B. `rgba(78,128,214,0.10)`) · `--shadow-badge` · Text 12px 500 `--text-secondary` · Dot `--stage-*`.

**Do / Don't:** ✅ Dot + Label immer zusammen (CVD) · ❌ nie Vollflächen in Stagefarbe.

### 4.2 Outcome-Badge

Für Ergebnisse: **gewonnen** (`--success-fg`/`--success-bg`), **verloren** (`--danger-fg`/`--danger-bg`), **offen** (`--text-secondary`/`--surface-2`), **überfällig** (`--warning-fg`/`--warning-bg`). Gleiche Maße wie Stage-Badge, mit 12px-Icon statt Dot (Check/X/Kreis/Uhr).

### 4.3 Kanal-Dot

8px-Kreis in `--stage-telefon/-linkedin/…` — als kleinste Kanal-Kennung in Queues und Tabellen. Immer mit Tooltip (Kanalname).

### 4.4 Zähler (Queue-Count)

Pill 18px hoch, min-width 18px, Fläche `--surface-3`, Text 11px 600 `tabular-nums` `--text-secondary`. Bei überfälligen Items: `--warning-bg` + `--warning-fg`. Sitzt rechts am Nav-Item.

### 4.5 Fälligkeits-Badge

„Heute" → `--accent-muted` + `--orange-300` · „Überfällig (n Tage)" → `--warning-bg` + `--warning-fg` · Zukunft → `--surface-2` + `--text-muted`. Immer mit relativem Text („seit 3 Tagen"), nie nur Farbe.

### 4.6 Header-Badge

Das Badge-Muster der Landing Page (`HeaderBadge`): Pill, Fläche `--surface-2`, `--shadow-badge`, Padding `--sp-3` `--sp-6`, Icon 16px + Text 14px 500 `--text-primary`. Im Produkt für Kontext-Anzeigen über Titeln — z. B. aktiver Pitch, Workspace, „25+ Anrufe heute". Max. einer pro View-Kopf.

### 4.7 Check-Bullet-Liste

Das Aufzählungs-Muster der Landing Page: 20px-Kreis (`--r-full`) in `--accent-muted` mit 12px-Check-Icon in `--orange-500`, daneben Text 14px `--text-secondary`, Zeilenabstand `--sp-5`. Für Vorteils-/Ergebnislisten (Onboarding, Leerzustände, Feature-Erklärungen) — nicht für Aufgaben (das ist die Checkbox).

---

## 5. Karten

### 5.1 Solid Card (Standard)

Fläche `--surface-2` · Border `--border-default` · Radius `--r-lg` 14px · Padding `--sp-8` 24px · Titel 16px 600 · **kein Schatten**. Hover (wenn klickbar): `--surface-3` in `--dur-1`.

### 5.2 Glass Card

Rezept `glass-card` aus DESIGN.md 4.2 — Radius `--r-xl`, optional `--grad-sheen` und Corner-Plus-Ticks (DESIGN.md 7). **Max. eine pro View**, für das hervorgehobene Element.

### 5.3 Handoff-Karte (Setter → Closer)

**Zweck:** Übergabe eines qualifizierten Leads mit allem, was der Closer braucht.

**Anatomie:** Glass Card → Kontaktkopf (Name 16px/600, Firma 13px `--text-secondary`, Kanal-Dot) → Stage-Badge → Qualifizierungs-Fakten als Key-Value-Liste (Label 12px `--text-muted` / Wert 14px `--text-primary`, Zeilenabstand `--sp-5`) → Übergabe-Notiz (Textarea-Inhalt, `--surface-1`-Kasten, Radius `--r-md`) → Footer mit Signature-Pill „Übernehmen" + Ghost „Zurückgeben".

**Referenz-Route:** `/setting` → `/closing`.

### 5.4 Script-Panel (Gesprächsleitfaden)

**Zweck:** Leitfaden neben der Anruf-Queue — lesen, nicht bedienen.

**Anatomie:** Solid Card, sticky (`top: calc(var(--h-topbar) + var(--sp-6))`) → Titel + Eyebrow („LEITFADEN") → nummerierte Schritte (Nummer 12px 600 `--orange-500`, Text 14px `--lh-base`) → Einwand-Akkordeons (Trigger 14px 500, Chevron; Inhalt `--text-secondary`) → Copy-Button (Icon-Button) je Textbaustein.

**Verhalten:** Akkordeons einzeln öffnbar; Copy zeigt 1,5s-Bestätigung („Kopiert") als Tooltip.

**Referenz-Route:** `/telefon`, `/setting`, `/closing`.

### 5.5 Kontakt-/Lead-Karte

Kompakt für Drawer-Kopf und `/heute`: Avatar-Kreis 36px (`--surface-3`, Initialen 13px 600) → Name/Firma → Kanal-Dot + Stage-Badge → Quick-Actions (Icon-Buttons: Anrufen, E-Mail, Notiz).

---

## 6. Datentabelle (dicht)

**Zweck:** Das Arbeitspferd — Leads, Aktivitäten, Nutzer.

**Anatomie:** Sticky-Header (Glass-Nav-Rezept) → Zeilen mit `--border-subtle`-Hairlines → Zellen → Row-Actions (rechts, hover-revealed) → Fußzeile (Pagination/Summen).

**Spezifikation:**

| Eigenschaft | Wert |
|---|---|
| Zeilenhöhe | `--h-row` 36px · kompakt `--h-row-compact` 32px |
| Zellpadding | 0 `--sp-5` (12px) · kompakt 0 `--sp-4` (8px) |
| Header | Glass-Nav-Rezept · Text 12px 500 uppercase `--ls-eyebrow` `--text-muted` |
| Zelltext | 14px 400 `--text-primary` · Sekundärspalten `--text-secondary` |
| Zahlen | rechtsbündig · 500 · `tabular-nums` |
| Trennung | nur horizontale Hairlines `--border-subtle` — keine vertikalen Linien, keine Zebra-Streifen |

**Zustände:** Hover `--surface-1` (`--dur-1`) · Selected `--accent-muted` + 2px-Orange-Rail links + Checkbox checked · Focus (Keyboard) Doppelring um die Zeile · Loading: Skeleton-Zeilen (Abschnitt 14.2) · Empty: Leerzustand (Abschnitt 14.1).

**Verhalten:** Klick auf Header sortiert (Pfeil 12px in `--orange-500` bei aktiver Sortierung) · ↑↓ navigiert Zeilen, Enter öffnet Drawer, Space toggelt Auswahl · Shift-Klick für Bereichsauswahl · Row-Actions erscheinen bei Hover/Fokus als Icon-Buttons.

**Auswahl & Bulk-Bar:** Bei ≥ 1 Auswahl erscheint unten eine fixierte Glass-Popover-Leiste: „n ausgewählt" + Aktionen (Ghost-Buttons) + „Auswahl aufheben". Zählt zum Glas-Budget.

**Pagination:** Ab ~200 Zeilen virtualisieren; Fußzeile zeigt „1–50 von 1.234" (`tabular-nums`).

**Do / Don't:** ✅ Zahlen rechts, Text links · ❌ keine Buttons mit Füllung in Zeilen · ❌ kein Glas auf Zeilen.

**Referenz-Route:** `/setting`, `/closing`, `/admin`.

---

## 7. Work-Queue & Listen

**Zweck:** Abarbeitbare Aufgabenlisten — der Kern von `/telefon`, `/linkedin`, `/nachfassen`.

**Anatomie (Queue-Item):** Zeile 44px (Touch-Target) → Checkbox → Name (14px 500) + Firma (13px `--text-secondary`) → Kanal-Dot → Stage-Badge → Fälligkeits-Badge → Quick-Actions (hover-revealed: Anrufen/Nachricht, Verschieben, Erledigt).

**Gruppierung:** Sticky-Gruppenköpfe „Überfällig" / „Heute" / „Später" — 12px uppercase `--text-muted` + Zähler-Badge; „Überfällig"-Zähler in Warning-Farben.

**Verhalten (Abarbeiten-Flow):** ↑↓ wählt, Enter öffnet, **E** erledigt, **S** überspringt (konfigurierbar). Erledigte Items sliden aus (`--dur-2`), der Fokus rückt automatisch aufs nächste. Smart-Queue-Sortierung (Fälligkeit → Priorität) wird nie durch Animation verschleiert.

**Zustände:** Aktives Item (in Bearbeitung) = Selected-Stil (Orange-Rail); erledigt = kurz `--success-bg`-Flash, dann raus.

**Referenz-Route:** `/telefon` (7 Work-Lists + Smart Queue), `/nachfassen` (FU1/2/3-Kadenz), `/linkedin`.

---

## 8. KPI-Stat-Tiles

**Zweck:** Kennzahlen-Kopfzeile in `/auswertung` und `/heute`.

**Anatomie:** Solid Card → Eyebrow-Label → Zahl → Delta-Chip → optionale Sparkline.

**Spezifikation:** Zahl `--fs-2xl` 28px (Dashboard-Hero `--fs-3xl` 36px) · 600 · `--ls-display` · `tabular-nums` · `--text-primary`. Label: Eyebrow-Moment (12px uppercase `--orange-500`). Delta-Chip: Pill 18px, ▲/▼-Icon 12px + Prozentwert 12px 500 in `--success-fg`/`--danger-fg` auf `--success-bg`/`--danger-bg` — **Icon + Vorzeichen immer dabei, nie Farbe allein**. Sparkline: 1.5px-Linie in `--viz-1`, keine Achsen, Höhe 32px.

**Layout:** 2–4 Tiles pro Reihe, gleiche Höhe, Gap `--sp-6`. Genau **eine** Zahl pro View darf das Gradient-Wort-Treatment (`--grad-text-accent`) tragen.

**Referenz-Route:** `/auswertung`, `/heute`.

---

## 9. Charts (Recharts)

- **Serienfarben:** fixe Slot-Reihenfolge `--viz-1…6` — Serie 1 bekommt immer `#EA580C`, Serie 2 `#4E80D6` usw. Nie nach Rang oder Laune umfärben (Validierung, DESIGN.md 3.7). Als JS-Konstante einbinden (DESIGN.md 14).
- **Grid & Achsen:** Gridlines `--viz-grid` (nur horizontal), Achsentext 11px `--viz-axis`, keine Achsenlinien, keine Ticks.
- **Balken:** Radius 4px nur oben, 2px-Gap zwischen gestapelten Segmenten, Kategorie-Abstand ≥ 30 % der Balkenbreite.
- **Linien:** 2px, Punkte nur bei Hover (≥ 8px Hit-Area); Flächenfüllung (Area) max. 10 % Deckung derselben Farbe.
- **Funnel/Pipeline:** **ordinale Orange-Rampe** (sequenzielle Rampe aus DESIGN.md 3.7) — eine Hue in Helligkeitsstufen, nicht die kategoriale Palette.
- **Tooltip:** Glass-Popover-Rezept, Werte `tabular-nums`, de-DE-Format.
- **Regeln:** eine Y-Achse pro Chart · Legende ab 2 Serien (12px, Dot + Label) · leere Charts zeigen Leerzustand, nie leere Achsen.

**Referenz-Route:** `/auswertung` (Recharts-Dashboards).

---

## 10. Navigation

### 10.1 Sidebar

**Spezifikation:** Breite `--w-sidebar` 248px, kollabiert `--w-rail` 64px · Fläche `--surface-2` (solid — kein Glas) · rechte Kante `--border-default`. Kopf: Wortmarke `titan.` (DESIGN.md 7). Nav-Item: Höhe 36px, Radius `--r-md`, Icon 16px + Label 14px 500 `--text-secondary`, Zähler-Badge rechts (Abschnitt 4.4).

**Zustände:** Hover `--surface-3` · **Aktiv:** 2px-Orange-Rail links + Text/Icon `--text-primary`, Fläche `--accent-muted`. Kanal-Icons in `/telefon`/`/linkedin`-Items tragen ihren Kanal-Dot.

**Verhalten:** Kollaps-Toggle unten; im Rail-Modus Tooltips rechts. Auf Mobile: Off-Canvas mit `--surface-scrim`.

### 10.2 Topbar

Höhe `--h-topbar` 56px · **Glass-Nav-Rezept** (DESIGN.md 4.2). Links Breadcrumb, Mitte/rechts: ⌘K-Trigger (Sekundär-Button-Optik mit Kbd-Chip „⌘K"), Benachrichtigungen, Avatar. Blendet bei Scroll nicht aus (App, nicht Marketing).

### 10.3 Tabs

Textzeile 14px 500, aktiver Tab `--text-primary` + 2px-Underline `--orange-500`, inaktiv `--text-muted`. Underline gleitet per Layout-Animation (`--dur-2` / `--ease-out`). Für Untergliederung in Drawern und `/admin`.

### 10.4 Breadcrumb

13px, Trenner „/" in `--text-disabled`, letztes Element `--text-primary` 500, Rest `--text-muted` als Links.

---

## 11. Command Palette (⌘K)

**Zweck:** Schnellzugriff — Navigation, Aktionen, Kontakt-Suche, Quick-Add.

**Anatomie:** Scrim `--surface-scrim` → Panel (Glass-Popover-Rezept, `--glass-blur-lg` + `saturate(1.5)`) → Eingabefeld (48px, 16px Text, kein Border — nur Hairline unten) → Gruppen („Navigation" / „Aktionen" / „Kontakte", Gruppenkopf 11px uppercase `--text-muted`) → Ergebniszeilen 40px → Fußzeile mit Kbd-Hinweisen.

**Spezifikation:** Breite 560px · max-Höhe 60vh · Radius `--r-xl` · `--shadow-overlay` · Ergebniszeile: Icon 16px + Titel 14px + Meta 12px `--text-muted`; aktive Zeile `--surface-3` + Orange-Rail. Kbd-Chips: 20px hoch, `--surface-1`, Border `--border-default`, Radius `--r-xs`, 11px `--font-mono`.

**Verhalten:** ⌘K/Ctrl-K öffnet · Eintritt `scale(0.98)→1` + Fade (`--dur-3` / `--ease-spring`) · ↑↓ navigiert, Enter führt aus, Esc schließt · Tippen filtert fuzzy; Quick-Add („+ Neuer Lead …") stets als letzte Aktion.

**Referenz-Route:** global; Quick-Add primär `/linkedin`.

---

## 12. Filter & Toolbar

**Anatomie der Listen-Toolbar:** Suchfeld (Input mit Lupe, 240px) → Filter-Chips → Zeitraum-Segmented-Control → rechts: Dichte-Umschalter (Icon-Button), Spalten-Konfiguration, Export (Ghost).

**Filter-Chip:** Pill 28px, `--surface-1`, Border `--border-default`, Text 13px 500. **Aktiv:** `--accent-muted`-Füllung, Border `--border-accent`, Text `--orange-300`, X-Icon zum Entfernen. „+ Filter"-Chip öffnet Glass-Popover mit Feldauswahl.

**Saved Views:** Dropdown links über der Tabelle (Select-Optik): „Alle offenen", „Meine Woche", … — speichert Filter + Sortierung + Spalten.

**Do / Don't:** ✅ aktive Filter immer sichtbar als Chips · ❌ nie Filter in Menüs verstecken, die den Tabelleninhalt unsichtbar einschränken.

---

## 13. Overlays

### 13.1 Dialog

Fläche **`--surface-4`** (solid — Inhalte müssen ruhig lesbar sein) · Radius `--r-xl` · `--shadow-overlay` · Scrim `--surface-scrim` · Breite 480px (Bestätigungen) / 640px (Formulare) · Kopf 16px 600, Fußzeile rechtsbündig: Ghost („Abbrechen") + Sekundär/Signature. Destruktive Dialoge: Titel-Icon `--danger-fg`, Bestätigungs-Button Abschnitt 2.4. Eintritt `--dur-3` / `--ease-spring`; Esc schließt, Fokus-Trap.

### 13.2 Drawer / Sheet (Lead-Detail)

Von rechts, Breite 480px · Fläche `--surface-2` · linke Kante `--border-default` · Kopf: Lead-Karte (Abschnitt 5.5) · Inhalt in Tabs (Abschnitt 10.3): Aktivität / Details / Notizen. Tabelle bleibt sichtbar und bedienbar (kein Scrim) — Drawer ist Arbeitsfläche, kein Modal.

### 13.3 Popover / Dropdown

Glass-Popover-Rezept · min-Breite 200px · Item-Höhe 32px · Eintritt `translateY(4px)` + Fade (`--dur-2`). Destruktive Items in `--danger-fg`, durch Hairline abgetrennt.

### 13.4 Toast

Unten rechts, Breite 360px, Fläche `--surface-4`, Radius `--r-lg`, `--shadow-overlay`, linker 2px-Rail in Semantikfarbe, Icon + Text 14px, optional eine Aktion (Ghost). Auto-Dismiss 5s (Erfolg) / manuell (Fehler). Max. 3 gestapelt.

### 13.5 Tooltip

Glass-Popover-Rezept, Padding `--sp-3` `--sp-5`, Text 12px, Delay 400ms, Radius `--r-sm`. Nur Fakten — nie interaktive Inhalte.

---

## 14. Feedback & Leerzustände

### 14.1 Empty State

Zentriert in der Fläche: Icon 24px `--text-muted` (Lucide-Override) → ein Satz Zustand (14px `--text-secondary`) → **eine** Aktion (Sekundär-Button). Ton: DESIGN.md 13 („Keine Anrufe für heute. Importiere eine Liste."). Kein Illustrations-Kitsch.

### 14.2 Skeleton

Blöcke in `--surface-1` mit Schimmer-Sweep nach `--surface-2` (`--dur-3`-Loop, `--ease-in-out`) — **kein** Grau-Puls, keine Spinner in Flächen. Formen entsprechen dem echten Layout (Zeilen 36px, Tile-Zahl 28px).

### 14.3 Error-Banner

Volle Breite über dem Inhalt: `--danger-bg`, linker 2px-Rail `--danger`, Icon + Text 14px `--danger-fg`, Aktion „Erneut versuchen" (Ghost). Formularfehler zusätzlich am Feld (Abschnitt 3.1).

### 14.4 Ladezustände

Erst-Load: Skeleton. Nachladen (Filterwechsel): Inhalt bleibt, Opacity 0.6 + dünner Progress (2px, `--orange-500`) an der Oberkante der Fläche. Buttons: Spinner im Button (Abschnitt 2.1).

---

## 15. Admin-Muster

- **Settings-Layout:** Zweispaltig — Label + Beschreibung links (max. 280px, Label 14px 500, Beschreibung 13px `--text-muted`), Controls rechts. Sektionen durch `--border-default`-Divider + `--sp-9`.
- **Nutzer-Tabelle:** Standard-Tabelle (Abschnitt 6) mit Avatar, Name, Rolle (Badge), Status (Outcome-Badge-Muster), letzter Login (`--text-muted`).
- **Rollen-Matrix:** Tabelle mit Checkbox-Zellen (Abschnitt 3.4), Zeilen = Rechte, Spalten = Rollen; Spaltenköpfe sticky.
- **Custom Fields / Stages:** sortierbare Listen (Drag-Handle-Icon `--text-disabled`), Stage-Zeilen zeigen ihren Farb-Dot; neue Stages wählen aus den definierten `--stage-*`-Tönen — keine freien Farbwähler.
- **Danger-Zone:** eigene Card am Seitenende, Border `--danger` bei 40 %, Titel `--danger-fg`, destruktive Buttons Abschnitt 2.4. **Nie Orange.**

**Referenz-Route:** `/admin` (Nutzer, Rollen-Matrix, Custom Fields, Stages, Benchmarks).

---

## 16. Routen-Blaupausen

| Route | Komposition |
|---|---|
| **`/telefon`** | Toolbar (Abschnitt 12) + Work-Queue (Abschnitt 7, Smart-Queue-Sortierung) links · Script-Panel (Abschnitt 5.4) sticky rechts · Signature-Pill „Anrufen" im aktiven Item · Outcome-Erfassung als Button-Reihe (Sekundär: „Erreicht", „Mailbox", „Termin", …) |
| **`/linkedin`** | Workspace pro Nutzer×Pitch: Queue (Abschnitt 7) + Nachrichten-Templates im Script-Panel-Muster · ⌘K-Quick-Add (Abschnitt 11) · Reply-Erfassung im Drawer (Abschnitt 13.2) · FU-Kadenz (3/6/9 Tage) über Fälligkeits-Badges (Abschnitt 4.5) |
| **`/setting`** | Tabelle (Abschnitt 6) qualifizierter Leads + Drawer (Abschnitt 13.2) · Übergabe erzeugt Handoff-Karte (Abschnitt 5.3) |
| **`/closing`** | Handoff-Karten-Eingang (Glass Card, Abschnitt 5.3) + Tabelle laufender Deals + Script-Panel · Outcome-Badges (Abschnitt 4.2) |
| **`/nachfassen`** | Fälligkeitsgruppierte Queue (Abschnitt 7: Überfällig / Heute / Später) · Fälligkeits-Badges · Quick-Action „Nachfassen" |
| **`/heute`** | KPI-Reihe (Abschnitt 8) oben · gemischte Tages-Queue über alle Kanäle (Kanal-Dots Abschnitt 4.3) · eine Fokus-Karte (Glass, Abschnitt 5.2) für den nächsten fälligen Schritt |
| **`/auswertung`** | Filter-Toolbar (Abschnitt 12, Zeitraum-Segmented) · KPI-Grid (Abschnitt 8) · Recharts-Charts (Abschnitt 9: Funnel in Orange-Rampe, Serien in Viz-Slots) · Benchmark-Tabelle (Abschnitt 6) |
| **`/admin`** | Settings-Layout, Nutzer-Tabelle, Rollen-Matrix, Custom Fields/Stages, Danger-Zone (Abschnitt 15) |
