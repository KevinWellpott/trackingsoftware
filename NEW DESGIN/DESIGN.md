# Titan Design System — „Ember Glass"

> **Status:** v1 · 2026-07 · verbindlich für die **CRM/Akquise-Produktlinie**
> **Dateien:** `DESIGN.md` (dieses Dokument) · `COMPONENTS.md` (CRM-Komponenten) · `tokens.css` (Custom Properties) · `style-tile.html` (Live-Vorschau)
> **Herkunft:** abgeleitet aus dem **LinkedIn-Banner** (`titan-landing-v2/LinkedIN/titan-linkedin-banner-v2.png`) und der **titan-landing-v2 Landing Page** — Near-Black, `titan.`-Wortmarke, Orange `#F97316`, 1px-Border-Ästhetik, Liquid Glass. Schrift: **Inter** (bewusste Abweichung von Geist auf der Landing Page).

**Geltungsbereich:** Dieses Dokument ist verbindlich für die CRM/Akquise-Produktlinie (titan-tracking und verwandte interne Tools). „Sapphire Editorial" (`titan-os/design/Design.md`) bleibt unverändert verbindlich für Editorial-/Marketing-Projekte. Dieses Dokument ersetzt es nicht — es steht daneben. Die Token-Namen (`--surface-*`, `--text-*`, `--stage-*` …) sind kompatibel zu `titan-tracking/src/styles/theme.crm.css`, damit die App per Werte-Tausch migrieren kann, ohne Namen anzufassen.

**Theme:** ausschließlich **Dark**. Es gibt keinen Light Mode. `color-scheme: dark` ist im Token-File gesetzt.

---

## 1. Brand Direction & Tonalität

**Leitsatz:** *Werkzeug, nicht Bühne — ruhige Dichte mit einem Funken Orange.*

Ember Glass ist das Interface eines Vertriebs-Werkzeugs, das täglich stundenlang offen ist. Es sieht aus wie das LinkedIn-Banner anfühlt: ein fast schwarzer Raum, in dem genau eine Farbe glüht. Die Fläche ist ruhig und dicht, Struktur entsteht durch 1px-Linien und Leuchtdichte-Stufen, nicht durch Schatten oder Buntheit. Liquid Glass ist das Material der obersten Schicht — Navigation, Paletten, Popover — nicht die Tapete.

**Drei Worte:** schlicht · präzise · glühend.

**Was wir vermeiden:** Neonfarben, Schatten-Stapel, mehr als eine Akzentfarbe pro View, Weight 700, Glas auf allem, verspielte Illustrationen, Hype-Sprache.

---

## 2. Design-Prinzipien

1. **Tiefe durch Leuchtdichte, nie durch Schatten.** Ebene = Surface-Stufe (`--surface-0…4`). Je höher die Schicht, desto heller die Fläche.
2. **1px-Linien statt Elevation.** Struktur kommt aus `--border-subtle/default/strong` und Dividern — wie der `border-x`-Rahmen der Landing Page.
3. **Orange ist Signal, kein Dekor.** Akzent-Budget: ein Primär-CTA pro View, Orange-Text nur für Eyebrows, Links und aktive States. Siehe Abschnitt 3.8.
4. **Glas spart man sich auf.** Max. 3 Glasflächen pro Viewport, nie in scrollenden Zeilen. Siehe Abschnitt 4.
5. **Dichte mit Ruhe.** 32px-Controls und 36px-Zeilen, aber großzügiger Weißraum *zwischen* Blöcken (`--sp-9…12`).
6. **Nie 700.** Hierarchie entsteht über Größe und 500/600, nicht über Fettdruck.
7. **Ziffern immer tabellarisch.** `font-variant-numeric: tabular-nums` in Tabellen, KPIs und überall, wo Zahlen untereinander stehen.
8. **Kontrast ist Pflicht.** Bedeutungstragender Text ≥ WCAG AA gegen seinen Untergrund — die gemessenen Werte stehen in Abschnitt 3.2 und gelten als Untergrenze.

---

## 3. Farbsystem

### 3.1 Canvas & Surface-Rampe

| Token | Hex | Ebene / Einsatz |
|-------|-----|-----------------|
| `--surface-0` | `#0A0A0B` | Canvas · Seitenhintergrund (Brand-Wert der Landing Page) |
| `--surface-1` | `#101013` | Table-Header · leicht erhabene Panels |
| `--surface-2` | `#151519` | Cards (solid) · Sidebar |
| `--surface-3` | `#1B1B20` | Hover-Füllungen · Popover-Fallback |
| `--surface-4` | `#212127` | Dialoge · Command Palette (oberste Ebene) |
| `--surface-scrim` | `rgba(10,10,11,0.72)` | Overlay-Scrim hinter Dialogen/Palette |

**Regel:** Eine Interaktion, die etwas „anhebt" (Hover, Fokus auf Zeile), springt genau **eine** Surface-Stufe nach oben. Nie zwei.

### 3.2 Text-Hierarchie (gemessene Kontraste auf `--surface-0`)

| Token | Hex | Kontrast | Einsatz |
|-------|-----|----------|---------|
| `--text-primary` | `#FAFAFA` | 18.9:1 | Headlines, Tabellen-Werte, KPI-Zahlen |
| `--text-secondary` | `#B5B5B5` | 9.6:1 | Beschreibungen, Labels, Sekundärinfos |
| `--text-muted` | `#8A8B90` | 5.8:1 | Meta-Text, Achsenbeschriftung, Timestamps |
| `--text-disabled` | `#55565C` | 2.7:1 | **nur** Disabled-Zustände — trägt nie Bedeutung |
| `--text-on-accent` | `#FFFFFF` | — | nur auf dem CTA-Gradient, ≥ 14px/600 (siehe Abschnitt 3.8) |

**Boden-Regel:** `--text-muted` ist die dunkelste Stufe für bedeutungstragenden Text (5.8:1 auf Canvas, 4.8:1 auf `--surface-4` — beides AA). Alles darunter ist dekorativ oder disabled.

### 3.3 Border-Stufen

| Token | Wert | Einsatz |
|-------|------|---------|
| `--border-subtle` | `rgba(255,255,255,0.06)` | Zeilen-Hairlines in Tabellen/Listen |
| `--border-default` | `rgba(255,255,255,0.10)` | Standard — Cards, Inputs, Divider (Brand-Wert) |
| `--border-strong` | `rgba(255,255,255,0.16)` | Controls im Hover, betonte Rahmen |
| `--border-accent` | `rgba(249,115,22,0.40)` | aktive/selektierte Panels |

### 3.4 Akzent: Orange-Rampe

| Token | Hex | Rolle |
|-------|-----|-------|
| `--orange-200` | `#FED7AA` | hellste Stufe (Text auf Orange-Tints) |
| `--orange-300` | `#FDBA74` | Akzent-Text hell (11.7:1 auf Canvas) |
| `--orange-400` | `#FB923C` | Hover-Stufe |
| **`--orange-500`** | **`#F97316`** | **KERN · Markenorange** (7.1:1 als Text auf Canvas) |
| `--orange-600` | `#EA580C` | Gradient-Ende, Button-Ring, Chart-Slot |
| `--orange-700` | `#C2410C` | tiefe Stufe (sequenzielle Rampe) |
| `--orange-900` | `#7C2D12` | sehr tief (sequenzielle Rampe) |
| `--orange-950` | `#431407` | tiefste Stufe (sequenzielle Rampe) |
| `--amber-glow` | `#FFB02C` | **nur dekorativ** — Glows, Gradienten |
| `--ember` | `#FF3D00` | **nur dekorativ** — Glows, Gradienten |

Semantische Aliase: `--accent` (= 500) · `--accent-hover` (= 400) · `--accent-active` (= 600) · `--accent-muted` (`rgba(249,115,22,0.10)` für Tints und Selected-Rows).

### 3.5 Semantische Farben (entsättigt für Dark-UI)

| Rolle | Kern | Text (`-fg`) | Fläche (`-bg`) |
|-------|------|--------------|----------------|
| Success | `--success` `#3FB37F` | `#7ED9AC` (7.5:1) | `rgba(63,179,127,0.10)` |
| Warning | `--warning` `#D1A24F` | `#E4C687` (8.5:1) | `rgba(209,162,79,0.10)` |
| Danger | `--danger` `#D65A52` | `#EC9A93` (5.1:1) | `rgba(214,90,82,0.10)` |
| Info | `--info` `#4E80D6` | `#9DB9EA` | `rgba(78,128,214,0.12)` |

> **Regel: Warning ≠ Akzent.** Warning ist **Gold** (Hue ~85°), Markenorange (~47°) trägt **niemals** Status. Wer eine überfällige Aufgabe orange färbt, zerstört das Akzent-Budget. Status wird zusätzlich immer durch Icon oder Text getragen, nie durch Farbe allein.

### 3.6 Pipeline- & Kanalfarben

| Token | Hex | Kanal / Modul |
|-------|-----|----------------|
| `--stage-telefon` | `#4E80D6` | Telefon-Kaltakquise (Steel-Blau) |
| `--stage-linkedin` | `#0D9488` | LinkedIn-Outreach (Teal) |
| `--stage-setting` | `#8B5CF6` | Setting (Violett) |
| `--stage-closing` | `#3FA36F` | Closing (Grün) |
| `--stage-nachfassen` | `#D1A24F` | Nachfassen (Gold — bewusst Warning-Familie: Dringlichkeit) |
| `--stage-heute` | `#F97316` | Heute/Fokus (= Markenorange, der einzige Stage mit Akzentfarbe) |

Kanalfarben erscheinen als **8px-Dots und Badge-Tints**, nie als Flächenfarbe.

**Eine Bedeutung pro Farbe — auch über Views hinweg.** Grün heißt in der gesamten App „gewonnen", Rot „verloren/nicht erschienen", Gold „nachfassen", Neutral „offen". Das gilt für die Ergebnis-Pills (Abschnitt 5.2) **und** für die Termin-Chips im Kalender: dort kodiert die Farbe den **Status**, nicht den Termintyp.

> **Warum nicht nach Typ einfärben:** Solange Closing-Termine pauschal grün waren, war ein *verlorenes* Closing ein grüner Chip mit rotem Status-Badge daneben — zwei widersprüchliche Signale am selben Objekt. Setting vs. Closing steht deshalb als Text im Chip; bei sehr kurzen Slots als Kürzel „S"/„C". Kategorien (Typ, Quelle) tragen nie einen Semantik-Ton, Zustände nie eine Kanalfarbe.

**Badge-Budget:** Höchstens **ein** farbiges Element pro Zeile. Ist der Status gesetzt, gehört ihm die Farbe; Quelle läuft als Kanal-Dot, Beträge als Zahl, der Typ als stiller Text. Vier nebeneinanderstehende Pills sind ein Symptom, kein Layout.

### 3.7 Datenvisualisierung

**Kategoriale Palette — fixe Slot-Reihenfolge, nie umsortieren:**

| Slot | Token | Hex |
|------|-------|-----|
| 1 | `--viz-1` | `#EA580C` (Orange — Marken-Slot) |
| 2 | `--viz-2` | `#4E80D6` (Steel-Blau) |
| 3 | `--viz-3` | `#3FA36F` (Grün) |
| 4 | `--viz-4` | `#D946EF` (Fuchsia) |
| 5 | `--viz-5` | `#0D9488` (Teal) |
| 6 | `--viz-6` | `#8B5CF6` (Violett) |

Die Palette ist **computational validiert** (Dark Mode auf `#0A0A0B`): alle Farben ≥ 3:1 Kontrast zum Canvas, benachbarte Slots CVD-unterscheidbar (worst-case ΔE 14.5 bei Ziel ≥ 8). Deshalb: Reihenfolge nie ändern, keine Farbe „mal eben tauschen" — das bricht die Validierung. Bei Scatter/Small-Multiples max. 3 Serien.

**Sequenzielle Rampe** (eine Hue — für Funnels, Heatmaps, Intensität):
`#431407 → #7C2D12 → #C2410C → #EA580C → #F97316 → #FDBA74`

**Divergierend** (für Abweichung vom Ziel): `#4E80D6` ← `#6E7076` (Neutral-Mitte) → `#EA580C`

Hilfstoken: `--viz-grid` `rgba(255,255,255,0.06)` · `--viz-axis` = `--text-muted`.

> **Chart-Orange ≠ UI-Orange:** Serien-Slot 1 ist `#EA580C` (liegt im Helligkeitsband für Dark-Charts), der UI-Akzent bleibt `#F97316`.

### 3.8 Anwendungsregeln (Akzent-Budget)

- **Ein** Primär-CTA (Signature-Pill — Gradienten in Abschnitt 5, Spezifikation in COMPONENTS.md 2.1) pro View. Alle weiteren Aktionen: Sekundär/Ghost.
- Orange-**Text** nur für: Eyebrows, Links, aktive Nav-States, das eine Gradient-Wort (`--grad-text-accent`, max. 1 pro View).
- Orange-**Flächen** nur als Tint (`--accent-muted`) — Selected-Rows, aktive Filter-Chips — plus 2px-Rail links.
- **Kontrast-Fakten zum CTA:** Weiß auf `--orange-500` = **2.8:1** (unter AA-Large), auf `--orange-600` = 3.6:1. Deshalb: Der weiße Text der Signature-Pill ist nur zulässig bei ≥ 14px/600 auf dem Gradient (dessen untere Hälfte `#EA580C` die 3:1-Grenze für Large Text erfüllt) — und die Pill bleibt der **eine** Brand-CTA pro View. Für kleine Bestätigungs-Chips gilt die barrierefreie Alternative: **dunkler Text (`#0A0A0B`) auf Orange** (7.1:1).

---

## 4. Material: Liquid Glass

Auf der dunklen Basis ist Glas ein **rauchgraues, halbtransparentes Material** mit rückwärtigem Blur, 1px-Border und einer hellen Licht-Lippe an der Oberkante. Ohne Border + Lippe ist Glas auf Near-Black unsichtbar — beides ist Pflicht.

### 4.1 Anatomie

| Schicht | Token | Zweck |
|---------|-------|-------|
| Füllung | `--glass-bg` / `--glass-bg-nav` / `--glass-bg-popover` | halbtransparentes Dunkelgrau |
| Blur | `--glass-blur-sm/md/lg` (8/16/24px) | `backdrop-filter`, rückwärtig |
| Sättigung | `--glass-saturate` (1.5) | **nur** Popover/Palette — lässt Farben hinter dem Glas leuchten |
| Border | `--glass-border` `rgba(255,255,255,0.10)` | Kante gegen den Canvas |
| Licht-Lippe | `--glass-lip` `inset 0 1px 0 rgba(255,255,255,0.08)` | simulierte Lichtkante oben |
| Sheen | `--grad-sheen` | optionaler diagonaler Glanz-Overlay (Hero-Karten) |

### 4.2 Die drei Rezepte

```css
/* Glass-Nav — Topbar, Sticky-Table-Header */
.glass-nav {
  background: var(--glass-bg-nav);                  /* rgba(10,10,11,0.80) */
  -webkit-backdrop-filter: blur(var(--glass-blur-md));
  backdrop-filter: blur(var(--glass-blur-md));      /* 16px */
  border-bottom: 1px solid var(--glass-border);
}

/* Glass-Card — hervorgehobene Karten (Handoff, Fokus-Karte) */
.glass-card {
  background: var(--glass-bg);                      /* rgba(23,23,23,0.60) */
  -webkit-backdrop-filter: blur(var(--glass-blur-md));
  backdrop-filter: blur(var(--glass-blur-md));
  border: 1px solid var(--glass-border);
  border-radius: var(--r-xl);                       /* 16px */
  box-shadow: var(--glass-lip);
}

/* Glass-Popover — Dropdowns, Tooltips, Command Palette */
.glass-popover {
  background: var(--glass-bg-popover);              /* rgba(21,21,25,0.75) */
  -webkit-backdrop-filter: blur(var(--glass-blur-lg)) saturate(var(--glass-saturate));
  backdrop-filter: blur(var(--glass-blur-lg)) saturate(var(--glass-saturate));
  border: 1px solid var(--glass-border);
  border-radius: var(--r-lg);                       /* 14px */
  box-shadow: var(--glass-lip), var(--shadow-overlay);
}
```

### 4.3 Glas vs. Solid — Entscheidungstabelle

| Glas ✅ | Solid ❌→ `--surface-*` |
|---------|------------------------|
| Topbar / Navigation | Tabellenzeilen, Listen-Items |
| Sticky-Table-Header | Formulare, Settings-Panels |
| Command Palette (⌘K) | Sidebar-Body |
| Popover, Dropdown, Tooltip | alles, was scrollt |
| **eine** Hero-/Handoff-Karte pro View | Standard-Cards im Grid |

### 4.4 Fallback & Performance

- `@supports not (backdrop-filter …)` → Glasflächen werden deckend (`--surface-2/0/3`), bereits in `tokens.css` hinterlegt.
- **Max. 3 Glasflächen pro Viewport.** Blur ist teuer — nie in wiederholten Elementen (Zeilen, Cards im Grid).
- Hinter Glas braucht es Struktur (Dot-Grid, Chart, Inhalt) — sonst wirkt der Blur nicht.
- Kein Glas auf Glas.

---

## 5. Gradienten-Katalog

Das Highlight-Farbpaar stammt direkt aus dem Dark Theme der Landing Page: `--gradient-primary` `#FDBA4C` (Amber) und `--gradient-secondary` `#C2340F` (tiefes Ember-Rot).

| Token | Wert | Verwendung |
|-------|------|-----------|
| `--grad-cta` | `linear-gradient(180deg, #F97316, #EA580C)` | Signature-Pill (Default) |
| `--grad-cta-hover` | `linear-gradient(180deg, #FB923C, #F97316)` | Signature-Pill (Hover) |
| `--grad-won` | `linear-gradient(180deg, #3FB37F, #2E9A6A)` | Ergebnis-Pill „Gewonnen" (Abschnitt 5.2) |
| `--grad-won-hover` | `linear-gradient(180deg, #56C795, #3FB37F)` | dto. Hover |
| `--grad-lost` | `linear-gradient(180deg, #D65A52, #BE4239)` | Ergebnis-Pill „Verloren" |
| `--grad-lost-hover` | `linear-gradient(180deg, #E27B74, #D65A52)` | dto. Hover |
| `--grad-neutral` | `linear-gradient(180deg, #FAFAFA, #DEDEE2)` | Ergebnis-Pill neutral/weiß |
| `--grad-neutral-hover` | `linear-gradient(180deg, #FFFFFF, #ECECEF)` | dto. Hover |
| `--grad-ember` | Radial `rgba(255,176,44,0.16) → rgba(255,61,0,0.06) → transparent` | dezenter Glüh-Header hinter Dashboard-/Hero-Bereichen |
| `--grad-ribbon` | Radial `#FFB147 → rgba(209,1,1,0.40)` | **nur Marketing-Momente** (Banner-Ribbon) — nie im App-UI |
| `--grad-text-accent` | **Radial** `#FDBA4C → rgba(194,52,15,0.40)` | das eine Gradient-Wort/-Zahl pro View (per `background-clip: text`) — exakt das `<Highlight>`-Treatment der Landing Page (dort `bg-radial from-gradient-primary to-gradient-secondary/40`) |
| `--grad-section` | Radial `rgba(249,115,22,0.10) → transparent 70%` bei `50% 0%` | Sektions-Akzent hinter hervorgehobenen Bereichen — das Landing-Muster `bg-radial-[at_50%_0%] from-primary/10`; für die Unten-Variante Position spiegeln |
| `--grad-cta-glow` | Radial `rgba(255,176,44,0.40) → rgba(255,61,0,0.04) → transparent` bei `45% 90%` | CTA-Glow-Stapel der Landing — hinter dem Abschluss-/Login-Moment, nach unten maskiert |
| `--grad-fade-bottom` | `rgba(10,10,11,0) → #0A0A0B` | Scroll-Masken, Listen-Ausblendungen |
| `--grad-sheen` | `135deg, rgba(255,255,255,0.06) → transparent 40%` | Glanz-Overlay auf Glass-Hero-Karten |

**Gradient-Text-Rezept:**

```css
.accent-word {
  background: var(--grad-text-accent);
  -webkit-background-clip: text; background-clip: text;
  color: transparent;
}
```

### 5.1 Control-Material (gilt für **alle** Buttons)

Jedes Control der App teilt dieselbe Materialsprache — daran erkennt man sie als Familie:

- **Form:** Pill (`--r-full`). Ausnahmslos, von der Signature-Pill bis zum Filter-Chip.
- **Licht von oben:** Licht-Lippe an der Oberkante (`--lip-control`, auf farbigen Füllungen `rgba(255,255,255,0.20)`).
- **Hairline:** 1px-Inset in der tiefen Stufe der eigenen Füllung.
- **Hover:** Gradient rückt eine Stufe heller, nie ein Farbwechsel.
- **Press:** `scale(0.98)`.

**Unterschieden wird ausschließlich über die Füllung** — nicht über Form, Größe oder Radius:

| Ebene | Füllung | Einsatz |
|---|---|---|
| Primär | `--grad-cta` (Markenorange) | der **eine** CTA pro View |
| Ergebnis | `--grad-won` · `--grad-lost` · `--grad-neutral` | terminale Entscheidungen (5.2) |
| Sekundär | `--grad-surface` | der Arbeits-Button für alles Übrige |
| Ghost | keine | Inline-Aktionen, Toolbars, Karten-Footer |
| Destruktiv | keine, nur Danger-Hairline | erst im Bestätigungs-Dialog gefüllt |

> **Warum nicht alles füllen:** Die Hierarchie aus Abschnitt 3.8 hängt daran, dass gefüllte **Farbe** knapp bleibt. Bekommt jeder Button einen farbigen Verlauf, schreit alles gleich laut und der CTA verschwindet in der Menge. Gleiches Material heißt gleiche Form und gleiches Licht — nicht gleiche Lautstärke.

**Größe bleibt kontextabhängig:** 40px (`--h-control-lg`) für Primär- und Ergebnis-Pills, 32px (`--h-control`) in Toolbars, 28px für Chips. Der Radius ändert sich dabei nie.

**Badges teilen das Material, nicht die Füllung.** Sie bekommen dieselbe Pill-Form und dasselbe Licht-Overlay, aber Tint statt Gradient-Farbe, Mikroschatten (`--shadow-chip`) statt Licht-Lippe und **keine** Hover-Reaktion. Ein Badge ist eine Aussage, kein Ziel — sieht es klickbar aus, wird es geklickt und tut nichts.

### 5.2 Ergebnis-Pills (terminale Entscheidungen)

**Zweck:** Ein Gespräch endet in genau einem von mehreren Ergebnissen — gewonnen, verloren, nachfassen. Diese Buttons erfassen den Ausgang; sie sind keine Status-Anzeige und keine Navigation.

**Abgrenzung zur Signature-Pill:** Baugleich in Form und Finish, aber **nicht** in Farbe. Die Signature-Pill ist der eine Brand-CTA pro View und bleibt Orange. Ergebnis-Pills tragen Semantikfarben — damit gilt weiterhin Abschnitt 3.5: **Markenorange trägt niemals Status.** Beide dürfen nebeneinander existieren, weil sie sich farblich nie überschneiden.

**Anatomie:** Pill → Gradient-Füllung → Licht-Lippe (oben) → Hairline-Inset in der tiefen Stufe → dunkles Label.

| Eigenschaft | Wert |
|---|---|
| Höhe | `--h-control-lg` 40px |
| Padding | 0 `--sp-8` (24px) |
| Radius | `--r-full` |
| Füllung | `--grad-won` · `--grad-lost` · `--grad-neutral` |
| Licht-Lippe | `inset 0 1px 0 rgba(255,255,255,0.20)` — auf Weiß `0.60` |
| Hairline | `inset 0 0 0 1px` in der tiefen Gradient-Stufe (`#2E9A6A` · `#BE4239` · `#CFCFD4`) |
| Text | **`#0A0A0B`** · 14px · 600 · `--ls-tight` |

**Kontrast — warum dunkler Text Pflicht ist:** Weiß auf `--success` `#3FB37F` liegt bei ~2:1, auf `--danger` `#D65A52` bei ~3:1 — beides unbrauchbar. `#0A0A0B` bringt auf allen drei Füllungen **> 7:1**. Auf Ergebnis-Pills gibt es deshalb keinen weißen Text, auch nicht als Ausnahme.

**Zustände:** Hover → `*-hover`-Gradient (beide Stopps eine Stufe heller) · Active `scale(0.98)` · **Gesetztes Ergebnis** → zusätzlich `outline: 2px solid <Kernfarbe>` mit `outline-offset: 2px`. Der Ring ist nötig, weil alle Pills dauerhaft gefüllt sind und die Füllung den gewählten Zustand nicht mehr unterscheiden kann.

**Do / Don't:** ✅ als geschlossene Gruppe rechts in der Ergebnis-Leiste · ✅ Klick auf das bereits gesetzte Ergebnis öffnet den Dialog erneut (Nachtragen) · ❌ nie an einen laufenden Autosave koppeln — sie öffnen nur einen Dialog · ❌ nie in Tabellenzeilen · ❌ keine Trophäen-/Daumen-Icons; die Labels tragen die Bedeutung allein.

**Referenz-Route:** `/closing/[id]` — Ergebnis-Leiste.

---

### 5.3 Selektoren & Datumsfelder

**Grundsatz: keine nativen Auswahl-Controls.** Ein `<select>` lässt sich nur im geschlossenen Zustand gestalten — die aufgeklappte Optionsliste zeichnet das Betriebssystem, ebenso den Kalender von `<input type="date">`. Beides bricht aus dem Branding aus, und zwar genau in dem Moment, in dem der Nutzer hinsieht. Die App nutzt deshalb durchgängig eigene Komponenten:

| Komponente | Ersetzt | Einsatz |
|---|---|---|
| `ui/Select` | `<select>` | Alle Dropdowns. `FormSelect` für `<form action>` (schreibt ein `<input type="hidden">`) |
| `ui/DatePicker` | `<input type="date">` | Reine Kalendertage — Wiedervorlage, Zeitraum, Vertragsstart |
| `ui/DateTimeField` | `<input type="datetime-local">` | Termine mit Uhrzeit |
| `ui/CalendarPopover` | — | Der geteilte Monatskalender beider Datums-Komponenten |
| `ui/AnchoredPopover` | — | Gemeinsamer Unterbau: Portal, Positionierung, Schließen |

**Anatomie:** Trigger im `.field-trigger`-Kasten (identische Box wie `.ui-input`, damit Text-, Auswahl- und Datumsfelder in einer Zeile fluchten) → aufklappende Liste als **Glass-Popover** nach Rezept 4.2. Dropdowns sind Glas, Dialoge solid — der Selektor folgt derselben Regel wie jedes andere Popover.

| Eigenschaft | Wert |
|---|---|
| Trigger-Höhe | `--h-control` 32px |
| Trigger-Radius | `--r-md` |
| Chevron / Icon | 14px, `--text-muted`, Chevron dreht beim Öffnen 180° |
| Fokus | `--orange-500` Rand + `0 0 0 3px --accent-muted` |
| Offen | Rand `--orange-500` (`[aria-expanded="true"]`) |
| Option gewählt | `--accent-muted` Fläche · `--orange-300` Text · Häkchen 13px |
| Option aktiv (Tastatur/Hover) | `--surface-2`, kein Orange |
| Popover | max. 288px hoch, danach scrollt die Liste |

**Warum Orange hier erlaubt ist:** Die Auswahl-Markierung ist ein **UI-Zustand**, kein Status am Datensatz — dieselbe Rolle wie der gewählte Tag im Kalender. Abschnitt 3.5 bleibt unberührt: kein Selektor färbt jemals ein Ergebnis.

**Portal-Pflicht:** Die Popover rendern über ein Portal mit `position: fixed`. Selektoren stehen u. a. in der virtualisierten Kontakt-Tabelle und in Modals; absolut positioniert würden sie am nächsten `overflow`-Container abgeschnitten.

**Tastatur:** Fokus bleibt auf dem Trigger (`aria-activedescendant`-Muster). ↑/↓ bewegen, Enter wählt, Escape schließt, Tab verlässt. Das vermeidet Fokus-Umhängen und funktioniert in Modals ohne Sonderfall.

**Uhrzeit:** `DateTimeField` ist Datum-Button + echtes Textfeld in einer Hülle; der Fokusring liegt auf der Hülle (`:focus-within`), sonst blinkte er beim Wechsel zweimal auf. Das Textfeld schlägt Viertelstunden vor, akzeptiert aber Freitext — `9`, `930` und `9:30` ergeben alle `09:30`. Termine liegen fast immer auf der Viertelstunde, krumme Zeiten müssen trotzdem tippbar bleiben.

**Wertformat:** `DateTimeField` liefert exakt das Format des nativen Inputs (`2026-07-27T10:00`, Berlin-Wandzeit). Umgerechnet wird ausschließlich in `src/lib/apptTime.ts` — nie mit `new Date(input).toISOString()`.

**Do / Don't:** ✅ `DatePicker` für `date`-Spalten, `DateTimeField` nur wo die Uhrzeit fachlich zählt · ❌ nie ein natives `<select>` oder `<input type="date">` neu einbauen · ❌ Auswahl-Orange nie zur Status-Aussage umdeuten.

**Sicherheitsnetz:** `globals.css` §6.5b gestaltet verbliebene native Controls (eigener Chevron, Marken-Flächen, entsättigtes Kalender-Icon). Das ist Absicherung, kein Freibrief — neue Felder nehmen die Komponenten.

**Referenz-Routen:** `/lists/[id]` (Kategorie-Spalte) · `/setting/[id]` (Closing-Termin) · `/analyse` (freier Zeitraum).

---

## 6. Typografie: Inter

### 6.1 Laden

Nur die Gewichte **400 · 500 · 600**, `font-display: swap`.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
```

In Next.js-Apps stattdessen `next/font/google` (`Inter({ subsets: ["latin"], weight: ["400","500","600"] })`). Fallback-Stack: `--font-sans` = `"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`.

### 6.2 Gewichte-Regel

**Nie 700.** Hierarchie entsteht über Größe + 500/600 — wie auf der Landing Page (dort gibt es ebenfalls kein Bold). 400 für Fließtext und Zellen, 500 für Labels/Buttons, 600 für Titel und Zahlen.

### 6.3 Type-Scale (App-Dichte)

| Token | Größe | Einsatz |
|-------|-------|---------|
| `--fs-2xs` | 11px | Achsenbeschriftung, Kbd-Chips |
| `--fs-xs` | 12px | Eyebrows, Badges, Meta |
| `--fs-sm` | 13px | kompakte Tabellenzellen, Hilfetexte |
| `--fs-base` | 14px | Body, Zellen, Controls — die Arbeitsgröße |
| `--fs-md` | 16px | Card-Titel, betonter Body |
| `--fs-lg` | 18px | Sektions-Titel |
| `--fs-xl` | 22px | Seiten-Titel |
| `--fs-2xl` | 28px | KPI-Zahl |
| `--fs-3xl` | 36px | KPI-Zahl groß, Dashboard-Hero |

Zeilenhöhen: `--lh-tight` 1.15 (Zahlen/Titel) · `--lh-snug` 1.3 (Card-Titel) · `--lh-base` 1.5 (Body).

### 6.4 Type-Moments

| Moment | Spezifikation |
|--------|---------------|
| **Hero-Headline** (Login, Onboarding, Empty-Hero) | Inter 600 · 28–36px · `--ls-headline` −0.05em (tracking-tighter der Landing) · ein Wort mit `--grad-text-accent` |
| **Seiten-Titel** | Inter 600 · `--fs-xl` 22px · `--ls-display` −0.025em · `--text-primary` |
| **Card-Titel** | Inter 600 · `--fs-md` 16px · `--ls-tight` −0.01em |
| **Body / Zelle** | Inter 400 · `--fs-base` 14px · `--lh-base` |
| **Tabellen-Wert (Zahl)** | Inter 500 · 14px · `tabular-nums` · rechtsbündig |
| **Eyebrow** | Inter 500 · `--fs-xs` 12px · uppercase · `--ls-eyebrow` +0.08em · `--orange-500` |
| **KPI-Zahl** | Inter 600 · `--fs-2xl/3xl` · `--ls-display` · `tabular-nums` · `--text-primary` |
| **Meta/Timestamp** | Inter 400 · 12px · `--text-muted` |

### 6.5 Ziffern & Formate (de-DE)

- `font-variant-numeric: tabular-nums` in Tabellen, KPIs, Zahlenkolonnen — pro Komponente setzen, nicht global.
- Währung: `1.234,56 €` · Datum: `27.07.2026` · Uhrzeit: `14:30` · Telefon: `+49 5733 …`
- IDs/Hashes in `--font-mono`.

---

## 7. Struktur & Ikonografie

- **1px-Rahmen-Ästhetik:** Der App-Rahmen und Sektionsgrenzen sind `--border-default`-Linien (`border-x`-Seitenrahmen, `divide-y` zwischen Blöcken) — direkt von der Landing Page übernommen.
- **Corner-Plus-Ticks:** vier 1px/12px-Fadenkreuz-Marken in den Ecken hervorgehobener Panels, Farbe `--text-muted` bei 40 % Deckung. Sparsam — nur auf der Hero-/Glass-Karte.
- **Dot-Grid:** `--dot-grid` mit `background-size: 24px 24px` als subtile Struktur hinter Glas- und Leerbereichen (Banner-Motiv).
- **Icons: Lucide** mit globalem Override — dünn, scharf, technisch:

```css
svg.lucide {
  stroke-width: 1.5;
  stroke-linecap: square;
  stroke-linejoin: miter;
  stroke-miterlimit: 6;
}
```

- **Wortmarke:** lowercase `titan` + orangefarbener Punkt. Inter 600, `letter-spacing: -0.01em`:
  `titan<span style="color: var(--orange-500)">.</span>`

---

## 8. Spacing, Layout & Dichte

**12-Stufen-Skala:** `--sp-1…12` = 2 · 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 px.

- Komponenten-Innenpadding: `--sp-6` (16px), dichte Zellen `--sp-5`/`--sp-4`.
- Abstand zwischen Blöcken/Sektionen: `--sp-9…12` (32–64px).
- **Dichte-Tokens:** Control 32px (`--h-control`) / groß 40px · Tabellenzeile 36px (`--h-row`) / kompakt 32px · Topbar 56px · Sidebar 248px / Rail 64px · Touch-Target min. 44px (Mobile).
- **Grid:** 12 Spalten, Gutter `--sp-6`. Content-Maxbreite **1440px** (App-Views), 1200px für Doku-/Auswertungsseiten mit Lesetext.

---

## 9. Radius

| Token | Wert | Einsatz |
|-------|------|---------|
| `--r-xs` | 4px | Kbd-Chips, Mini-Elemente |
| `--r-sm` | 6px | Controls in Tabellen, Filter-Chips |
| `--r-md` | 10px | Inputs, Buttons, Nav-Items (Brand-Basiswert) |
| `--r-lg` | 14px | Cards |
| `--r-xl` | 16px | Modals, Glass-Panels |
| `--r-full` | ∞ | Pills, Badges, Signature-CTA |

---

## 10. Elevation & Tiefe

Tiefe = Leuchtdichte (Abschnitt 2, Prinzip 1). Es gibt genau **drei Schatten** — mehr nicht:

| Token | Wert | Einsatz |
|-------|------|---------|
| `--shadow-badge` | 1px-Rim + zwei Mikro-Schatten (heller Rim auf Dunkel) | Badges, Pills, Chips |
| `--shadow-overlay` | `0 16px 40px -12px rgba(0,0,0,0.55)` | Dialoge, Command Palette, Drawer |
| `--glow-accent` | `0 0 24px -4px rgba(249,115,22,0.35)` | Hover des Primär-CTA — der einzige farbige Glow |

Plus der Button-Inset `--shadow-btn-primary` (Licht-Lippe + `#EA580C`-Hairline) als Bestandteil der Signature-Pill. **Verboten:** gestapelte weiche Grau-Schatten, Schatten auf Zeilen/Listen, farbige Schatten außer `--glow-accent`.

---

## 11. Motion & Easing

| Token | Kurve | Einsatz |
|-------|-------|---------|
| `--ease-out` | `(0.22, 0.61, 0.36, 1)` | Standard — Fades, Moves |
| `--ease-in-out` | `(0.40, 0, 0.20, 1)` | Press, Toggles, Farbwechsel |
| `--ease-spring` | `(0.20, 0.90, 0.30, 1.15)` | Dialog/Palette-Eintritt (dezenter Overshoot) |

Dauern: `--dur-1` 120ms (Hover, Rows) · `--dur-2` 200ms (Dropdowns, Tooltips) · `--dur-3` 320ms (Dialoge, Palette).

**Muster:**
- Row-Hover: Hintergrund `--surface-0 → --surface-1` in `--dur-1`.
- Dropdown: `opacity 0→1` + `translateY(4px)→0` in `--dur-2` / `--ease-out`.
- Dialog/Palette: `opacity` + `scale(0.98)→1` in `--dur-3` / `--ease-spring`.
- Toast: Slide-in von rechts, `--dur-2`.
- Nur `opacity` und `transform` animieren — nie `width/height/top`.
- `prefers-reduced-motion: reduce` → alle Dauern 0 (in `tokens.css` hinterlegt).

---

## 12. Interaktions-Zustände

| Zustand | Rezept |
|---------|--------|
| **Fokus** | Doppelring: `box-shadow: 0 0 0 2px var(--surface-0), 0 0 0 4px var(--ring-focus)` — sichtbar auf jeder Fläche |
| **Hover** | Fläche eine Surface-Stufe heller (`--dur-1`); Controls zusätzlich `--border-strong` |
| **Selected** | Tint `--accent-muted` + **2px-Orange-Rail** an der linken Kante + Text bleibt `--text-primary` |
| **Active/Pressed** | `transform: scale(0.98)` mit `--ease-in-out`; Signature-Pill wechselt auf `--accent-active` |
| **Disabled** | `--text-disabled`, Borders `--border-subtle`, `cursor: not-allowed` — keine Opacity-Reduktion auf ganzen Blöcken |
| **Loading** | Skeleton-Schimmer zwischen `--surface-1` und `--surface-2` (COMPONENTS.md, Abschnitt 14) |

---

## 13. Sprache & Microcopy

- **„du"**, direkt, anti-hype — wie die Landing Page („Wir beraten dich nicht nur. Wir bauen die Software dafür selbst.").
- Button-Beschriftungen sind **Verben**: „Anrufen", „Nachfassen", „Übergeben", „Speichern" — nie „OK" oder „Absenden".
- Leerzustände: ein Satz Zustand + eine Aktion. („Keine Anrufe für heute. Importiere eine Liste.")
- Keine Ausrufezeichen-Inflation, keine Emojis im App-UI.
- Zahlen und Daten immer im de-DE-Format (Abschnitt 6.5).

---

## 14. Token-Referenz & Einbindung

Alle Tokens leben in **`tokens.css`** als `:root`-Custom-Properties (Dark only, `color-scheme: dark`).

```html
<link rel="stylesheet" href="tokens.css">
```

**Tailwind v4 (CSS-first)** — Werte in den `@theme`-Block mappen; in titan-tracking ersetzt das die Werte in `theme.brand.css`/`theme.crm.css` bei **gleichbleibenden Namen**:

```css
@import "tailwindcss";
@theme {
  --color-surface-0: #0A0A0B;
  --color-surface-2: #151519;
  --color-accent: #F97316;
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  /* … Werte 1:1 aus tokens.css übernehmen */
}
```

**Recharts / JS** — Charts können CSS-Variablen nicht in allen Props lesen. Palette deshalb zusätzlich als Konstante:

```ts
export const VIZ = ["#EA580C", "#4E80D6", "#3FA36F", "#D946EF", "#0D9488", "#8B5CF6"];
export const VIZ_GRID = "rgba(255,255,255,0.06)";
export const VIZ_AXIS = "#8A8B90";
```

**Token-Bilanz:** 6 Surfaces · 5 Text-Stufen · 4 Borders · 10 Orange-Töne · 4×3 Semantik · 6 Stages · 6+2 Viz · 8 Glass · 7 Gradienten · 9 Font-Größen · 12 Spacing-Stufen · 8 Dichte-Maße · 6 Radii · 4 Schatten/Glows · 3 Easings + 3 Dauern.

---

## 15. Checkliste für neue Projekte

- [ ] `tokens.css` eingebunden, **Inter** (400/500/600) geladen — kein anderes Font-Gewicht, nie 700.
- [ ] Hintergrund `--surface-0`, Text `--text-primary`. **Dark only**, `color-scheme: dark`.
- [ ] Genau **eine** Akzentfarbe sichtbar: Orange. **Kein Blau als Akzent** (Blau existiert nur als `--info` und `--viz-2`/`--stage-telefon`).
- [ ] Ein Primär-CTA (Signature-Pill) pro View; alle weiteren Aktionen Sekundär/Ghost.
- [ ] **Warning ist Gold, nie Orange.** Status nie durch Farbe allein.
- [ ] Tiefe über Surface-Stufen; nur die drei erlaubten Schatten.
- [ ] Glas nur für Nav/Palette/Popover/eine Hero-Karte — max. 3 pro Viewport, Fallback geprüft.
- [ ] Tabellen: 36px-Zeilen, `tabular-nums`, Zahlen rechtsbündig, Hairlines `--border-subtle`.
- [ ] Viz-Farben in fixer Slot-Reihenfolge `--viz-1…6` — **Werte nicht ändern ohne Re-Validierung** (CVD + Kontrast).
- [ ] Lucide-Icons mit dem globalen Override aus Abschnitt 7 (stroke 1.5, square, miter).
- [ ] Motion über die 3 Easings/3 Dauern; `prefers-reduced-motion` respektiert.
- [ ] Kontrast ≥ AA für bedeutungstragenden Text; `--text-muted` ist die Untergrenze.
- [ ] Microcopy: „du", Verben auf Buttons, de-DE-Formate.
