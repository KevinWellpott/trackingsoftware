# QA-Checkliste — Tracking Software 2.0

Stand: Branch `tracking-software-2.0`. Durchführen mit `npm run dev`, auf **Desktop** und **Mobil** (DevTools 360×800 oder echtes Handy), jeweils in **Hell + Dunkel** (Umschalter in der Sidebar).

## 0. Voraussetzungen
- [ ] Migration `supabase/migrations/20260404000010_tracking_2_perf.sql` im Supabase-SQL-Editor ausgeführt (Indizes, `rpc_phone_list_counts`, `closing_calls.meet_link` + `call_at→timestamptz`). Ohne sie zeigt die Telefon-Übersicht 0-Counts und Closing-Termine speichern keine Uhrzeit.
- [ ] Migration `supabase/migrations/20260404000011_tracking_2_fixes.sql` ausgeführt (FKs → profiles, Simon = Owner, `followup_templates`, `rpc_owner_day_metrics`). Ohne sie: Setting/Closing ohne Assignee-Namen, Dashboard-KPIs = 0, kein /team für Simon.

## 0b. Feedback-Umbau (neu zu prüfen)
- [ ] **`/` = persönliches Dashboard**: nur eigene Zahlen (KPIs, Ziele, Trend, persönlicher Funnel, Telefon); Perioden-Umschalter Woche/Monat/Jahr; keine Emojis.
- [ ] **`/team`** (nur Kevin + Simon): Wochenduell + Duell-Verlauf, Team-Vergleichskarten, „Dashboard ansehen" wechselt die Datensicht → persönliches Dashboard des Mitglieds; Banner „Zurück zu meinen Daten"; als Member → Redirect auf /.
- [ ] **Sidebar**: nur eigene Listen (flach, keine Owner-Ordner); Admins sehen „Team-Ansicht"-Sektion; CRM + Organic weg (alte URLs leiten auf / um).
- [ ] **Nachfassen**: nur eigene Leads, nur letzte 7 Tage (Hinweis „X ältere ausgeblendet" + „Ältere anzeigen"), FU1/FU2/FU3-Filter, Texte aus eigenen Vorlagen.
- [ ] **Einstellungen**: Follow-up-Vorlagen-Editor (FU1–3, {name}-Platzhalter, leer = Standard).
- [ ] **Telefon-Import**: ohne Admin-Rechte kein Owner-Select („Import als: …"); als Admin Auswahl vorhanden.
- [ ] **Setting/Closing**: kein Crash mehr; Assignee-Namen erscheinen (nach Migration 0011).

## 1. Datenintegrität (Bestandsdaten-Beweis)
Im Supabase-SQL-Editor ausführen — die Werte müssen dem bekannten Stand entsprechen (Referenz: 2168 Kontakte beim 2.0-Start) und dürfen sich durch das Update **nicht** verändert haben:
```sql
select count(*) as contacts_total from contacts;

select l.owner_name, count(*) as dms
from contacts c join lists l on l.id = c.list_id
group by 1 order by 1;

select count(*) filter (where appointment_set) as termine, count(*) as gesamt
from contacts;
```
- [ ] Zahlen identisch zum Stand vor dem Update
- [ ] Dashboard: Wochenduell + Terminquote zeigen dieselben Werte wie vor dem Update

## 2. LinkedIn-Flow
- [ ] Liste öffnen: Desktop = Raster, **Mobil = gestapelte Karten** (kein horizontales Scrollen, Tippziele groß)
- [ ] Schnell-Track: FAB unten rechts bzw. Strg/Cmd+K — nur auf Dashboard/Listen/Nachfassen sichtbar; Mehrfach-Anlage ohne Modal-Schließen
- [ ] Termin=Ja → Modal erzwingt Meet-Link + Datum/Uhrzeit → Eintrag erscheint in `/setting`
- [ ] Termin entfernen → **themed Dialog** (kein Browser-confirm); Kontakt zurück im FU-Flow? (Nein — bewusst: `next_follow_up_at` bleibt leer)
- [ ] Kontakt löschen → themed Dialog
- [ ] Liste mit >1000 Zeilen: Summen im Fuß korrekt (kein 1000er-Cap), flüssiges Scrollen

## 3. Telefon-Flow
- [ ] CSV-Import (Google-Maps-Export): nur Firma/Telefon/Website; Duplikate übersprungen; Ergebnis mit Link zur Liste
- [ ] Übersicht: Status-Counts je Liste korrekt (nach Migration 0010), Gesamt im Header
- [ ] Call-Mode: ein Lead groß, klick-to-call; Tippen in Textfelder ruckelfrei (kein Re-Filter pro Taste)
- [ ] Rückruf ohne Datum+Uhrzeit → blockiert; mit → Lead wandert in „Rückruf"-Liste
- [ ] Nicht erreicht → eigene Liste; Toter Lead → themed Dialog; Termin → Setting-Eintrag
- [ ] Seitenliste springt zum aktiven Lead (Weiter/Zurück, Pfeiltasten), auch bei tausenden Leads flüssig
- [ ] Telefon-Dashboard: Metriken je Person + global, Wochenziel-Balken

## 4. Setting-Flow
- [ ] Queue: Suche (Name/Firma), Meine/Alle, Status-Filter, Termin-Zeit, Meet-Button
- [ ] Editor: ScriptRunner speichert pro Block (gespeichert ✓), Fortschrittsbalken; Zusatznotizen prominent
- [ ] Assignee-Multi-Select: per Tastatur bedienbar (Pfeile/Enter/Escape)
- [ ] Qualifizierung (Show, Budget, Pain/Wärme 1–10 — auf Touch groß genug)
- [ ] „Closing anlegen" → danach **„Zum Closing →"**-Link funktioniert

## 5. Closing-Flow
- [ ] **Termin (Datum+Uhrzeit) + Meet-Link im Editor setzbar** — Queue + Header zeigen beides (kein permanentes „Kein Termin" mehr)
- [ ] Neues Closing übernimmt Termin/Meet-Link aus dem Setting (falls dort gesetzt)
- [ ] Setting-Kontext read-only sichtbar (Script-Antworten des Setters)
- [ ] Gewonnen (Deal-Volumen, Zahlung, Start) → erscheint im CRM **und** im Dashboard-Funnel-Umsatz
- [ ] Verloren erzwingt Grund; Nachfassen erzwingt Wiedervorlage-Datum

## 6. Nachfassen
- [ ] Fällige LinkedIn-FUs (3/5/7 Tage) mit Kopier-Text; „Erledigt → nächste Stufe" / „Beantwortet"
- [ ] Telefon-Rückrufe erscheinen zur gesetzten Uhrzeit; Closing-Nachfassen zum Datum
- [ ] Terminierte Leads erscheinen NICHT; `/follow-up` leitet auf `/nachfassen` um

## 7. Dashboard
- [ ] Funnel-Sektion: Anrufe (KW) → Termine → Closings → Gewonnen → **Umsatz €**; Karten verlinken in die Bereiche
- [ ] Telefon-Woche je Owner mit Owner-Farben (gleiche Person = gleiche Farbe wie überall)
- [ ] Alle bisherigen LinkedIn-Panels unverändert (Duell, Quote, Ziele, Insights)

## 8. Design/Responsive-Gegencheck
- [ ] Dunkelmodus: keine „ausgewaschenen" hellen Flächen — Owner-Farben, Motivations-/Insight-Karten, Edit-Felder adaptieren
- [ ] 360px-Breite: nirgends horizontales Scrollen der Seite (Ausnahme: bewusste Scroller wie Wochen-Historie)
- [ ] Sidebar-Drawer über dem FAB; FAB verdeckt keine Inhalte (Bottom-Padding)
- [ ] Navigation markiert auch Detailseiten (z. B. `/setting/<id>` hebt „Setting" hervor)
- [ ] Export: Filter + Vorschau untereinander auf Mobil; Funnel-Exporte (Telefon/Setting/Closing) laden vollständige CSVs

## 9. Automatische Checks (bei jeder Änderung)
```bash
npm run build        # muss grün sein
npx tsc --noEmit     # 0 Fehler
```
